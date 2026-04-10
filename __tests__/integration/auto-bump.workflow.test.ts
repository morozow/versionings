// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * Integration tests: Auto-bump workflow with real git repositories.
 *
 * Tests the full pipeline with --semver=auto, conventional commits analysis,
 * changelog generation, and backward compatibility.
 *
 * Validates: Requirements 3.1, 3.4, 3.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.7,
 *            10.1, 10.4, 12.1, 15.4
 */

import * as path from 'path';
import * as fs from 'fs';
import { createExecutor } from '../../src/core/executor';
import { createRollbackManager } from '../../src/core/rollback';
import { createArtifactChecker } from '../../src/core/artifact.checker';
import { loadAndValidateConfig } from '../../src/config/config.validator';
import { runPipeline } from '../../src/core/pipeline';
import { analyzeBump, DEFAULT_BUMP_POLICY } from '../../src/versioning/commit.analyzer';
import { generateChangelog, DEFAULT_GROUP_TITLES } from '../../src/versioning/changelog.generator';
import { EXIT_CODES, VersioningsError } from '../../src/core/errors';
import type { PipelineDeps } from '../../src/core/pipeline';
import type { PipelineResult, DryRunPlan } from '../../src/core/reporter';
import type { ChangelogOpts } from '../../src/versioning/changelog.generator';
import type { BumpPolicy } from '../../src/versioning/commit.analyzer';
import {
  createRepoFixture,
  snapshotRepoState,
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

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Create standard pipeline deps for a repo directory.
 */
function createDeps(repoDir: string): PipelineDeps {
  const executor = createExecutor();
  const rollbackManager = createRollbackManager(executor);
  const artifactChecker = createArtifactChecker(executor);
  const config = loadAndValidateConfig(path.join(repoDir, 'version.json'));
  return { executor, rollbackManager, artifactChecker, config };
}


/**
 * Create pipeline deps with commitAnalyzer and optional changelogGenerator.
 */
function createAutoBumpDeps(
  repoDir: string,
  opts: {
    fallbackBump?: 'major' | 'minor' | 'patch' | null;
    bumpPolicy?: BumpPolicy;
    changelogFile?: string;
  } = {},
): PipelineDeps {
  const baseDeps = createDeps(repoDir);
  const bumpPolicy = opts.bumpPolicy || { ...DEFAULT_BUMP_POLICY };
  const fallbackBump = opts.fallbackBump !== undefined ? opts.fallbackBump : null;

  const changelogConfig: ChangelogOpts = {
    version: null, // will be set by pipeline after version is computed
    date: new Date().toISOString().slice(0, 10),
    format: 'markdown',
    groupTitles: { ...DEFAULT_GROUP_TITLES },
    excludeTypes: [],
    includeNonConventional: false,
    bumpPolicy,
  };

  const deps: PipelineDeps = {
    ...baseDeps,
    commitAnalyzer: {
      analyzeBump,
      bumpPolicy,
      fallbackBump,
    },
    changelogGenerator: {
      generateChangelog,
      changelogConfig,
      changelogFile: opts.changelogFile,
    },
  };

  return deps;
}

/**
 * Add a conventional commit to the repo.
 */
function addCommit(repoDir: string, message: string, filename?: string): void {
  const file = filename || `file-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
  fs.writeFileSync(path.join(repoDir, file), `content: ${message}\n`);
  git(repoDir, `add ${file}`);
  git(repoDir, `commit -m "${message}"`);
}

/**
 * Create a version tag on the current HEAD.
 */
function createVersionTag(repoDir: string, tag: string): void {
  git(repoDir, `tag -a "${tag}" -m "Release ${tag}"`);
}

const baseAutoOpts = {
  semver: 'auto',
  branch: 'test-release',
  push: false,
  dryRun: false,
  json: false,
  verbose: false,
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Integration: Auto-bump workflow', () => {
  test('Test 1: semver=auto with feat and fix commits — determines minor, pipeline succeeds', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);

    // Create a version tag on the initial commit
    createVersionTag(repoDir, 'v1.0.0');

    // Add conventional commits
    addCommit(repoDir, 'fix: resolve login issue');
    addCommit(repoDir, 'feat: add user dashboard');
    addCommit(repoDir, 'fix: correct validation error');

    const deps = createAutoBumpDeps(repoDir);
    const result = await runPipeline(baseAutoOpts, deps) as PipelineResult;

    expect(result.success).toBe(true);
    // feat → minor, so version should be 1.1.0
    expect(result.version).toBe('1.1.0');
    expect(result.previousVersion).toBe('1.0.0');
    expect(result.semver).toBe('minor');
    expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);

    // autoBump info should be present
    expect(result.autoBump).toBeDefined();
    expect(result.autoBump!.detectedBump).toBe('minor');
    expect(result.autoBump!.totalCommits).toBe(3);
    expect(result.autoBump!.breakingChanges).toBe(0);
    expect(result.autoBump!.commitsByType).toEqual(
      expect.objectContaining({ feat: 1, fix: 2 }),
    );

    // Verify repo state
    const state = snapshotRepoState(repoDir);
    expect(state.version).toBe('1.1.0');
    expect(state.status).toBe('');
  }, 30000);

  test('Test 2: semver=auto with breaking change — determines major', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);

    createVersionTag(repoDir, 'v1.0.0');

    addCommit(repoDir, 'feat: add new API endpoint');
    addCommit(repoDir, 'feat!: redesign authentication flow');

    const deps = createAutoBumpDeps(repoDir);
    const result = await runPipeline(baseAutoOpts, deps) as PipelineResult;

    expect(result.success).toBe(true);
    expect(result.version).toBe('2.0.0');
    expect(result.semver).toBe('major');
    expect(result.autoBump).toBeDefined();
    expect(result.autoBump!.detectedBump).toBe('major');
    expect(result.autoBump!.breakingChanges).toBe(1);
  }, 30000);

  test('Test 3: semver=auto without conventional commits and without fallback — NO_CONVENTIONAL_COMMITS (exit 11)', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);

    createVersionTag(repoDir, 'v1.0.0');

    // Add non-conventional commits
    addCommit(repoDir, 'updated readme');
    addCommit(repoDir, 'misc changes');

    const snapshotBefore = snapshotRepoState(repoDir);
    const deps = createAutoBumpDeps(repoDir, { fallbackBump: null });

    try {
      await runPipeline(baseAutoOpts, deps);
      throw new Error('Expected pipeline to throw');
    } catch (err: any) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.code).toBe(EXIT_CODES.NO_CONVENTIONAL_COMMITS);
    }

    // Repository must remain untouched
    assertNoMutation(repoDir, snapshotBefore);
  }, 30000);

  test('Test 4: semver=auto with fallbackBump=patch — uses fallback when no CC found', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);

    createVersionTag(repoDir, 'v1.0.0');

    // Add non-conventional commits
    addCommit(repoDir, 'updated readme');
    addCommit(repoDir, 'misc changes');

    const deps = createAutoBumpDeps(repoDir, { fallbackBump: 'patch' });
    const result = await runPipeline(baseAutoOpts, deps) as PipelineResult;

    expect(result.success).toBe(true);
    expect(result.version).toBe('1.0.1');
    expect(result.semver).toBe('patch');
    expect(result.autoBump).toBeDefined();
    expect(result.autoBump!.detectedBump).toBe('patch');
  }, 30000);


  test('Test 5: semver=patch — does not call analyzeBump, works as before', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);

    // Use standard deps without commitAnalyzer
    const deps = createDeps(repoDir);
    const result = await runPipeline(
      { ...baseAutoOpts, semver: 'patch' },
      deps,
    ) as PipelineResult;

    expect(result.success).toBe(true);
    expect(result.version).toBe('1.0.1');
    expect(result.semver).toBe('patch');
    // No autoBump info when not using auto
    expect(result.autoBump).toBeUndefined();
  }, 30000);

  test('Test 6: semver=auto with changelog.file — changelog written to file, git add executed', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);

    createVersionTag(repoDir, 'v1.0.0');

    addCommit(repoDir, 'feat: add search functionality');
    addCommit(repoDir, 'fix: handle empty results');

    const changelogFile = 'CHANGELOG.md';
    const deps = createAutoBumpDeps(repoDir, { changelogFile });
    const result = await runPipeline(baseAutoOpts, deps) as PipelineResult;

    expect(result.success).toBe(true);
    expect(result.version).toBe('1.1.0');

    // Verify changelog file was created and contains expected content
    const changelogPath = path.join(repoDir, changelogFile);
    expect(fs.existsSync(changelogPath)).toBe(true);

    const changelogContent = fs.readFileSync(changelogPath, 'utf8');
    expect(changelogContent).toContain('# Changelog');
    expect(changelogContent).toContain('Features');
    expect(changelogContent).toContain('add search functionality');
    expect(changelogContent).toContain('Bug Fixes');
    expect(changelogContent).toContain('handle empty results');

    // Verify the changelog was included in the commit (clean tree)
    const state = snapshotRepoState(repoDir);
    expect(state.status).toBe('');
  }, 30000);

  test('Test 7: dry-run with semver=auto — plan contains autoBump and changelogPreview', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);

    createVersionTag(repoDir, 'v1.0.0');

    addCommit(repoDir, 'feat: implement notifications');
    addCommit(repoDir, 'fix: correct timezone handling');

    const snapshotBefore = snapshotRepoState(repoDir);
    const deps = createAutoBumpDeps(repoDir, { changelogFile: 'CHANGELOG.md' });
    const plan = await runPipeline(
      { ...baseAutoOpts, dryRun: true },
      deps,
    ) as DryRunPlan;

    expect(plan.dryRun).toBe(true);
    expect(plan.currentVersion).toBe('1.0.0');
    expect(plan.nextVersion).toBe('1.1.0');
    expect(plan.semver).toBe('minor');

    // autoBump info
    expect(plan.autoBump).toBeDefined();
    expect(plan.autoBump!.detectedBump).toBe('minor');
    expect(plan.autoBump!.totalCommits).toBe(2);
    expect(plan.autoBump!.breakingChanges).toBe(0);

    // changelogPreview
    expect(plan.changelogPreview).toBeDefined();
    expect(plan.changelogPreview).toContain('Features');
    expect(plan.changelogPreview).toContain('implement notifications');

    // Steps should include changelog write
    expect(plan.steps.some((s: string) => s.includes('changelog'))).toBe(true);
    expect(plan.steps.some((s: string) => s.includes('git add'))).toBe(true);

    // Dry-run must not mutate the repository
    assertNoMutation(repoDir, snapshotBefore);
  }, 30000);

  test('Test 8: semver=auto with --preid=beta — bump converts to prerelease', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);

    createVersionTag(repoDir, 'v1.0.0');

    addCommit(repoDir, 'feat: add beta feature');

    const deps = createAutoBumpDeps(repoDir);
    const result = await runPipeline(
      { ...baseAutoOpts, preid: 'beta' },
      deps,
    ) as PipelineResult;

    expect(result.success).toBe(true);
    // feat → minor → preminor with preid=beta → 1.1.0-beta.0
    expect(result.version).toBe('1.1.0-beta.0');
    expect(result.semver).toBe('preminor');
    expect(result.autoBump).toBeDefined();
    expect(result.autoBump!.detectedBump).toBe('minor');
  }, 30000);

  test('Test 9: backward compatibility — config without conventionalCommits/changelog works as before', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);

    // The fixture already creates a minimal version.json (no conventionalCommits/changelog).
    // Standard pipeline without commitAnalyzer deps — should work as before.
    const deps = createDeps(repoDir);
    const result = await runPipeline(
      { ...baseAutoOpts, semver: 'patch' },
      deps,
    ) as PipelineResult;

    expect(result.success).toBe(true);
    expect(result.version).toBe('1.0.1');
    expect(result.semver).toBe('patch');
    expect(result.autoBump).toBeUndefined();

    const state = snapshotRepoState(repoDir);
    expect(state.version).toBe('1.0.1');
    expect(state.status).toBe('');
  }, 30000);
});
