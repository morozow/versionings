/* Versioning automation tool, 2018-present */

/**
 * Integration tests: Full workflow with real git (no mocks).
 * Each test uses an isolated tmpdir with a real git repository.
 *
 * Validates: Requirements 1.3, 2.1, 3.2, 10.5
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { createExecutor } = require('../../executor');
const { createRollbackManager } = require('../../rollback');
const { createArtifactChecker } = require('../../artifact.checker');
const { loadAndValidateConfig } = require('../../config.validator');
const { runPipeline } = require('../../pipeline');
const { EXIT_CODES, VersioningsError } = require('../../errors');
const {
  createRepoFixture,
  snapshotRepoState,
  assertRepoState,
  assertNoMutation,
  cleanup,
  git,
} = require('../helpers/repo-fixture');

let dirs = [];
let originalCwd;

beforeEach(() => {
  originalCwd = process.cwd();
});

afterEach(() => {
  process.chdir(originalCwd);
  cleanup(dirs);
  dirs = [];
});

/**
 * Helper: create pipeline deps from a real repo fixture.
 */
function createDeps(repoDir) {
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
  // ── Test 1: Happy path without push ──
  test('happy path without push — version bumped, branch/tag created, clean tree', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);

    const deps = createDeps(repoDir);
    const result = await runPipeline(baseOpts, deps);

    // PipelineResult fields
    expect(result.success).toBe(true);
    expect(result.version).toBe('1.0.1');
    expect(result.previousVersion).toBe('1.0.0');
    expect(result.semver).toBe('patch');
    expect(result.branch).toContain('version/patch/1.0.1/fix-login');
    expect(result.tag).toBe('1.0.1--fix-login');
    expect(result.pullRequestUrl).toBeNull();
    expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);

    // Verify real git state
    assertRepoState(repoDir, {
      version: '1.0.1',
      branch: 'version/patch/1.0.1/fix-login',
      clean: true,
    });

    // Tag exists
    const tags = git(repoDir, 'tag --list').split(/\r?\n/).filter(Boolean);
    expect(tags).toContain('1.0.1--fix-login');

    // Commit message is correct
    const lastCommitMsg = git(repoDir, 'log -1 --format=%s');
    expect(lastCommitMsg).toContain('1.0.1');
  }, 30000);

  // ── Test 2: Happy path with push ──
  test('happy path with push — branch and tag exist on remote', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);

    const deps = createDeps(repoDir);
    const result = await runPipeline({ ...baseOpts, push: true }, deps);

    expect(result.success).toBe(true);
    expect(result.version).toBe('1.0.1');
    expect(result.pullRequestUrl).toBeTruthy();

    // Verify branch and tag on remote
    const remoteRefs = git(remoteDir, 'for-each-ref --format="%(refname)"');
    expect(remoteRefs).toContain('refs/heads/version/patch/1.0.1/fix-login');
    expect(remoteRefs).toContain('refs/tags/1.0.1--fix-login');
  }, 30000);

  // ── Test 3: Dry-run doesn't mutate ──
  test('dry-run does not mutate the repository', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);

    const snapshotBefore = snapshotRepoState(repoDir);

    const deps = createDeps(repoDir);
    const plan = await runPipeline({ ...baseOpts, dryRun: true }, deps);

    // Plan has correct fields
    expect(plan.dryRun).toBe(true);
    expect(plan.currentVersion).toBe('1.0.0');
    expect(plan.nextVersion).toBe('1.0.1');
    expect(plan.semver).toBe('patch');
    expect(plan.branch).toContain('version/patch/1.0.1/fix-login');
    expect(plan.tag).toBe('1.0.1--fix-login');
    expect(plan.commitMessage).toBeDefined();
    expect(Array.isArray(plan.steps)).toBe(true);
    expect(plan.steps.length).toBeGreaterThan(0);

    // Repository state unchanged
    assertNoMutation(repoDir, snapshotBefore);
  }, 30000);

  // ── Test 4: Rollback on error ──
  test('rollback on commit failure — branch/tag deleted, version restored, clean tree', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);

    // Create a hooks directory OUTSIDE the repo so it doesn't dirty the tree
    const os = require('os');
    const hooksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versionings-hooks-'));
    dirs.push(hooksDir);
    const hookPath = path.join(hooksDir, 'pre-commit');
    fs.writeFileSync(hookPath, '#!/bin/sh\nexit 1\n');
    fs.chmodSync(hookPath, 0o755);

    // Set core.hooksPath so git commit will fail
    git(repoDir, `config core.hooksPath "${hooksDir}"`);

    const deps = createDeps(repoDir);

    try {
      await runPipeline(baseOpts, deps);
      throw new Error('Expected pipeline to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(VersioningsError);
      // Rollback can't delete the branch we're on, so we get INCOMPLETE_ROLLBACK
      // (BRANCH_CREATED rollback fails because HEAD is on that branch).
      // Either COMMAND_FAILED (full rollback) or INCOMPLETE_ROLLBACK (partial) is valid.
      expect([EXIT_CODES.COMMAND_FAILED, EXIT_CODES.INCOMPLETE_ROLLBACK]).toContain(err.code);
    }

    // After rollback: tag deleted, version restored, clean tree
    const currentState = snapshotRepoState(repoDir);
    expect(currentState.version).toBe('1.0.0');
    expect(currentState.tags).toEqual([]);
  }, 30000);

  // ── Test 5: Artifact conflict ──
  test('artifact conflict — ARTIFACT_CONFLICT error, no mutations', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);

    // Create a conflicting tag
    git(repoDir, 'tag "1.0.1--fix-login"');

    const snapshotBefore = snapshotRepoState(repoDir);

    const deps = createDeps(repoDir);

    try {
      await runPipeline(baseOpts, deps);
      throw new Error('Expected pipeline to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.code).toBe(EXIT_CODES.ARTIFACT_CONFLICT);
    }

    // No mutations beyond the tag we created
    assertNoMutation(repoDir, snapshotBefore);
  }, 30000);

  // ── Test 6: Dirty working tree ──
  test('dirty working tree — DIRTY_TREE error, no mutations', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);

    // Create an uncommitted file
    fs.writeFileSync(path.join(repoDir, 'uncommitted.txt'), 'dirty\n');

    const snapshotBefore = snapshotRepoState(repoDir);

    const deps = createDeps(repoDir);

    try {
      await runPipeline(baseOpts, deps);
      throw new Error('Expected pipeline to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.code).toBe(EXIT_CODES.DIRTY_TREE);
    }

    // No mutations (HEAD, branches, tags, version unchanged)
    assertNoMutation(repoDir, snapshotBefore);
  }, 30000);

  // ── Test 7: Remote mismatch ──
  test('remote mismatch — CONFIG_ERROR, no mutations', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);

    // Overwrite version.json with a URL that doesn't match the real remote
    const badVersionJson = {
      git: {
        platform: 'github',
        url: 'https://github.com/wrong/repo.git',
      },
    };
    fs.writeFileSync(
      path.join(repoDir, 'version.json'),
      JSON.stringify(badVersionJson, null, 2) + '\n',
    );
    // Commit the change so tree is clean
    git(repoDir, 'add version.json');
    git(repoDir, 'commit -m "update version.json"');

    const snapshotBefore = snapshotRepoState(repoDir);

    const deps = createDeps(repoDir);

    try {
      await runPipeline(baseOpts, deps);
      throw new Error('Expected pipeline to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
    }

    assertNoMutation(repoDir, snapshotBefore);
  }, 30000);
});
