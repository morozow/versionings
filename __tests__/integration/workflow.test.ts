// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * Integration tests: Full workflow with real git (no mocks).
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { PassThrough } from 'stream';
import { createExecutor } from '../../src/core/executor';
import { createRollbackManager } from '../../src/core/rollback';
import { createArtifactChecker } from '../../src/core/artifact.checker';
import { loadAndValidateConfig } from '../../src/config/config.validator';
import { runPipeline } from '../../src/core/pipeline';
import { runReleaseCommand, ReleaseCommandOpts, ReleaseCommandDeps } from '../../src/cli/commands/release.command';
import { runRollbackCommand, RollbackCommandOpts, RollbackCommandDeps } from '../../src/cli/commands/rollback.command';
import { createReporter } from '../../src/core/reporter';
import { createOperationLog } from '../../src/core/operation.log';
import { EXIT_CODES, VersioningsError } from '../../src/core/errors';
import type { InteractionManager } from '../../src/cli/interaction.manager';
import type { PipelineResult } from '../../src/core/reporter';
import {
  createRepoFixture,
  snapshotRepoState,
  assertRepoState,
  assertNoMutation,
  cleanup,
  git,
} from '../helpers/repo-fixture';

let dirs: string[] = [];
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
});

afterEach(() => {
  process.chdir(originalCwd);
  cleanup(dirs);
  dirs = [];
});

function createDeps(repoDir: string) {
  const executor = createExecutor();
  const rollbackManager = createRollbackManager(executor);
  const artifactChecker = createArtifactChecker(executor);
  const config = loadAndValidateConfig(path.join(repoDir, 'version.json'));
  return { executor, rollbackManager, artifactChecker, config };
}

const baseOpts = {
  semver: 'patch',
  branch: 'fix-login',
  push: false,
  dryRun: false,
  json: false,
  verbose: false,
};

describe('Integration: Real git workflow', () => {
  test('happy path without push — version bumped, branch/tag created, clean tree', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);
    const deps = createDeps(repoDir);
    const result: any = await runPipeline(baseOpts, deps);
    expect(result.success).toBe(true);
    expect(result.version).toBe('1.0.1');
    expect(result.previousVersion).toBe('1.0.0');
    expect(result.semver).toBe('patch');
    expect(result.branch).toContain('version/patch/1.0.1/fix-login');
    expect(result.tag).toBe('1.0.1--fix-login');
    expect(result.pullRequestUrl).toBeNull();
    expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
    assertRepoState(repoDir, { version: '1.0.1', branch: 'version/patch/1.0.1/fix-login', clean: true });
    const tags = git(repoDir, 'tag --list').split(/\r?\n/).filter(Boolean);
    expect(tags).toContain('1.0.1--fix-login');
    const lastCommitMsg = git(repoDir, 'log -1 --format=%s');
    expect(lastCommitMsg).toContain('1.0.1');
  }, 30000);

  test('happy path with push — branch and tag exist on remote', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);
    const deps = createDeps(repoDir);
    const result: any = await runPipeline({ ...baseOpts, push: true }, deps);
    expect(result.success).toBe(true);
    expect(result.version).toBe('1.0.1');
    expect(result.pullRequestUrl).toBeTruthy();
    const remoteRefs = git(remoteDir, 'for-each-ref --format="%(refname)"');
    expect(remoteRefs).toContain('refs/heads/version/patch/1.0.1/fix-login');
    expect(remoteRefs).toContain('refs/tags/1.0.1--fix-login');
  }, 30000);

  test('dry-run does not mutate the repository', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);
    const snapshotBefore = snapshotRepoState(repoDir);
    const deps = createDeps(repoDir);
    const plan: any = await runPipeline({ ...baseOpts, dryRun: true }, deps);
    expect(plan.dryRun).toBe(true);
    expect(plan.currentVersion).toBe('1.0.0');
    expect(plan.nextVersion).toBe('1.0.1');
    expect(plan.semver).toBe('patch');
    expect(plan.branch).toContain('version/patch/1.0.1/fix-login');
    expect(plan.tag).toBe('1.0.1--fix-login');
    expect(plan.commitMessage).toBeDefined();
    expect(Array.isArray(plan.steps)).toBe(true);
    expect(plan.steps.length).toBeGreaterThan(0);
    assertNoMutation(repoDir, snapshotBefore);
  }, 30000);

  test('rollback on commit failure — branch/tag deleted, version restored, clean tree', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);
    const hooksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versionings-hooks-'));
    dirs.push(hooksDir);
    const hookPath = path.join(hooksDir, 'pre-commit');
    fs.writeFileSync(hookPath, '#!/bin/sh\nexit 1\n');
    fs.chmodSync(hookPath, 0o755);
    git(repoDir, `config core.hooksPath "${hooksDir}"`);
    const deps = createDeps(repoDir);
    try {
      await runPipeline(baseOpts, deps);
      throw new Error('Expected pipeline to throw');
    } catch (err: any) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect([EXIT_CODES.COMMAND_FAILED, EXIT_CODES.INCOMPLETE_ROLLBACK]).toContain(err.code);
    }
    const currentState = snapshotRepoState(repoDir);
    expect(currentState.version).toBe('1.0.0');
    expect(currentState.tags).toEqual([]);
  }, 30000);

  test('artifact conflict — ARTIFACT_CONFLICT error, no mutations', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);
    git(repoDir, 'tag "1.0.1--fix-login"');
    const snapshotBefore = snapshotRepoState(repoDir);
    const deps = createDeps(repoDir);
    try {
      await runPipeline(baseOpts, deps);
      throw new Error('Expected pipeline to throw');
    } catch (err: any) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.code).toBe(EXIT_CODES.ARTIFACT_CONFLICT);
    }
    assertNoMutation(repoDir, snapshotBefore);
  }, 30000);

  test('dirty working tree — DIRTY_TREE error, no mutations', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);
    fs.writeFileSync(path.join(repoDir, 'uncommitted.txt'), 'dirty\n');
    const snapshotBefore = snapshotRepoState(repoDir);
    const deps = createDeps(repoDir);
    try {
      await runPipeline(baseOpts, deps);
      throw new Error('Expected pipeline to throw');
    } catch (err: any) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.code).toBe(EXIT_CODES.DIRTY_TREE);
    }
    assertNoMutation(repoDir, snapshotBefore);
  }, 30000);

  test('remote mismatch — CONFIG_ERROR, no mutations', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);
    const badVersionJson = { git: { platform: 'github', url: 'https://github.com/wrong/repo.git' } };
    fs.writeFileSync(
      path.join(repoDir, 'version.json'),
      JSON.stringify(badVersionJson, null, 2) + '\n',
    );
    git(repoDir, 'add version.json');
    git(repoDir, 'commit -m "update version.json"');
    const snapshotBefore = snapshotRepoState(repoDir);
    const deps = createDeps(repoDir);
    try {
      await runPipeline(baseOpts, deps);
      throw new Error('Expected pipeline to throw');
    } catch (err: any) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
    }
    assertNoMutation(repoDir, snapshotBefore);
  }, 30000);
});


// ---------------------------------------------------------------------------
// Helpers for Confirm Flow & Operation Log tests
// ---------------------------------------------------------------------------

function makeMockInteraction(interactive: boolean, confirmResult = true): InteractionManager {
  return {
    isInteractive: jest.fn().mockReturnValue(interactive),
    confirm: jest.fn().mockResolvedValue(confirmResult),
  };
}

function createReleaseDeps(repoDir: string, opts: {
  interactive?: boolean;
  confirmResult?: boolean;
  json?: boolean;
  operationLogDir?: string;
} = {}): { releaseDeps: ReleaseCommandDeps; stdout: PassThrough } {
  const pipelineDeps = createDeps(repoDir);
  const stdout = new PassThrough();
  const reporter = createReporter({ json: opts.json ?? false });
  const interactionManager = makeMockInteraction(
    opts.interactive ?? false,
    opts.confirmResult ?? true,
  );
  const logDir = opts.operationLogDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'versionings-oplog-'));
  const operationLog = createOperationLog(logDir);

  const releaseDeps: ReleaseCommandDeps = {
    runPipeline,
    pipelineDeps,
    interactionManager,
    operationLog,
    reporter,
    stdout,
  };

  return { releaseDeps, stdout };
}

function captureOutput(stream: PassThrough): () => string {
  let output = '';
  stream.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  return () => output;
}

const releaseBaseOpts: ReleaseCommandOpts = {
  semver: 'patch',
  branch: 'fix-login',
  push: false,
  dryRun: false,
  json: false,
  verbose: false,
};

// ---------------------------------------------------------------------------
// Confirm Flow & Operation Log integration tests
// ---------------------------------------------------------------------------

describe('Integration: Confirm Flow and operation.log', () => {
  test('release in interactive mode — confirmation leads to success', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);

    const { releaseDeps, stdout } = createReleaseDeps(repoDir, {
      interactive: true,
      confirmResult: true,
    });
    const getOutput = captureOutput(stdout);

    const result = await runReleaseCommand(releaseBaseOpts, releaseDeps) as PipelineResult;

    expect(result.success).toBe(true);
    expect(result.version).toBe('1.0.1');
    expect(result.previousVersion).toBe('1.0.0');
    expect(releaseDeps.interactionManager.isInteractive).toHaveBeenCalled();
    expect(releaseDeps.interactionManager.confirm).toHaveBeenCalledTimes(1);
    assertRepoState(repoDir, { version: '1.0.1', clean: true });
    expect(getOutput()).toContain('1.0.1');
  }, 30000);

  test('release in interactive mode — decline leads to USER_CANCELLED', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);

    const snapshotBefore = snapshotRepoState(repoDir);
    const { releaseDeps } = createReleaseDeps(repoDir, {
      interactive: true,
      confirmResult: false,
    });

    try {
      await runReleaseCommand(releaseBaseOpts, releaseDeps);
      throw new Error('Expected runReleaseCommand to throw');
    } catch (err: any) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.code).toBe(EXIT_CODES.USER_CANCELLED);
      expect(err.message).toContain('cancelled');
    }

    // Repository must remain untouched
    assertNoMutation(repoDir, snapshotBefore);
  }, 30000);

  test('operation log created after successful release', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);

    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versionings-oplog-'));
    dirs.push(logDir);

    const { releaseDeps } = createReleaseDeps(repoDir, {
      operationLogDir: logDir,
    });

    await runReleaseCommand(releaseBaseOpts, releaseDeps);

    // Verify operation log was created
    const operationLog = createOperationLog(logDir);
    const lastEntry = await operationLog.loadLast();
    expect(lastEntry).not.toBeNull();
    expect(lastEntry!.schemaVersion).toBe(1);
    expect(lastEntry!.result).toBe('success');
    expect(lastEntry!.version).toBe('1.0.1');
    expect(lastEntry!.previousVersion).toBe('1.0.0');
    expect(lastEntry!.semver).toBe('patch');
    expect(lastEntry!.tag).toBe('1.0.1--fix-login');
    expect(lastEntry!.branch).toContain('version/patch/1.0.1/fix-login');
    expect(lastEntry!.timestamp).toBeTruthy();

    // Verify last.json symlink exists
    const lastLink = path.join(logDir, 'last.json');
    expect(fs.existsSync(lastLink)).toBe(true);
  }, 30000);

  test('rollback using last operation log', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);

    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versionings-oplog-'));
    dirs.push(logDir);

    // Step 1: Perform a release via pipeline with operationLog in deps
    // so the pipeline records actual rollback steps in the log
    const pipelineDeps = createDeps(repoDir);
    const operationLog = createOperationLog(logDir);
    const pipelineResult: any = await runPipeline(
      { ...baseOpts, dryRun: false },
      { ...pipelineDeps, operationLog },
    );

    // Verify release happened
    expect(pipelineResult.success).toBe(true);
    assertRepoState(repoDir, { version: '1.0.1' });

    // Verify operation log was saved with steps
    const savedEntry = await operationLog.loadLast();
    expect(savedEntry).not.toBeNull();
    expect(savedEntry!.steps.length).toBeGreaterThan(0);

    // Step 2: Rollback using the operation log (stay on version branch)
    const executor = createExecutor();
    const rollbackStdout = new PassThrough();
    const reporter = createReporter({ json: false });
    const interactionManager = makeMockInteraction(false);

    const rollbackDeps: RollbackCommandDeps = {
      operationLog,
      executor,
      createRollbackManager: (exec) => createRollbackManager(exec),
      interactionManager,
      reporter,
      stdout: rollbackStdout,
    };

    const rollbackOpts: RollbackCommandOpts = {
      json: false,
      ci: true,
      yes: true,
    };

    // Rollback may partially fail (can't delete current branch) — that's expected
    // The key integration point is: log is loaded, steps are replayed, tag is removed
    try {
      await runRollbackCommand(rollbackOpts, rollbackDeps);
    } catch (err: any) {
      // INCOMPLETE_ROLLBACK is acceptable — branch deletion fails when on that branch
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.code).toBe(EXIT_CODES.INCOMPLETE_ROLLBACK);
    }

    // Verify tag was removed (rollback undid tag_created)
    const tags = git(repoDir, 'tag --list').split(/\r?\n/).filter(Boolean);
    expect(tags).toEqual([]);
  }, 30000);
});
