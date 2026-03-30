// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * Integration tests: Full workflow with real git (no mocks).
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { createExecutor } from '../../executor';
import { createRollbackManager } from '../../rollback';
import { createArtifactChecker } from '../../artifact.checker';
import { loadAndValidateConfig } from '../../config.validator';
import { runPipeline } from '../../pipeline';
import { EXIT_CODES, VersioningsError } from '../../errors';
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
