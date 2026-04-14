// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * E2E tests: Branching strategies — release-branch, hotfix, maintenance.
 *
 * Tests strategy-specific branch/tag naming, semver restrictions,
 * source-branch validation, plan --json output, and dry-run immutability.
 *
 * Validates: Requirements 3.1–3.10
 */

import { execSync, spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import {
  createRepoFixtureWithStrategy,
  snapshotRepoState,
  assertNoMutation,
  cleanup,
  git,
} from '../helpers/repo-fixture';

const CLI_PATH = path.resolve(__dirname, '../../out/dist/version.js');
const PROJECT_ROOT = path.resolve(__dirname, '../..');

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runCli(args: string[], opts: { cwd: string; env?: Record<string, string> }): RunResult {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: opts.cwd,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, ...opts.env },
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: result.status ?? 1,
  };
}

let dirs: string[] = [];

beforeAll(() => {
  execSync(`${process.execPath} build.js`, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    timeout: 30000,
  });
  expect(fs.existsSync(CLI_PATH)).toBe(true);
});

afterEach(() => {
  cleanup(dirs);
  dirs = [];
});

// ─── release-branch strategy ────────────────────────────────────────────

describe('E2E: release-branch strategy', () => {
  /**
   * Release minor with release-branch strategy creates branch release/{version}
   * and tag v{version}.
   *
   * Validates: Requirement 3.1
   */
  test('release minor → branch release/{version}, tag v{version}, exit 0', () => {
    const { repoDir, remoteDir } = createRepoFixtureWithStrategy({ strategy: 'release-branch' });
    dirs.push(repoDir, remoteDir);

    const { stdout, exitCode } = runCli(
      ['release', '--semver=minor', '--branch=feat', '--yes'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain('1.1.0');

    const state = snapshotRepoState(repoDir);
    expect(state.version).toBe('1.1.0');
    expect(state.branches).toContain('release/1.1.0');
    expect(state.tags).toContain('v1.1.0');
    expect(state.branch).toBe('release/1.1.0');
  }, 30000);

  /**
   * Plan --json with release-branch strategy returns strategy field.
   *
   * Validates: Requirements 3.2, 3.9
   */
  test('plan --json → strategy: "release-branch", exit 0', () => {
    const { repoDir, remoteDir } = createRepoFixtureWithStrategy({ strategy: 'release-branch' });
    dirs.push(repoDir, remoteDir);

    const { stdout, exitCode } = runCli(
      ['plan', '--semver=minor', '--branch=feat', '--json'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.dryRun).toBe(true);
    expect(parsed.strategy).toBe('release-branch');
  }, 30000);

  /**
   * Dry-run with release-branch strategy does not mutate the repository.
   *
   * Validates: Requirement 3.10
   */
  test('dry-run → no mutations to repo', () => {
    const { repoDir, remoteDir } = createRepoFixtureWithStrategy({ strategy: 'release-branch' });
    dirs.push(repoDir, remoteDir);

    const snapshotBefore = snapshotRepoState(repoDir);

    const { exitCode } = runCli(
      ['release', '--semver=minor', '--branch=feat', '--yes', '--dry-run'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    assertNoMutation(repoDir, snapshotBefore);
  }, 30000);
});

// ─── hotfix strategy ────────────────────────────────────────────────────

describe('E2E: hotfix strategy', () => {
  /**
   * Release patch from main with hotfix strategy creates branch hotfix/{version}
   * and tag v{version}.
   *
   * Validates: Requirement 3.3
   */
  test('release patch from main → branch hotfix/{version}, tag v{version}, exit 0', () => {
    const { repoDir, remoteDir } = createRepoFixtureWithStrategy({ strategy: 'hotfix' });
    dirs.push(repoDir, remoteDir);

    const { stdout, exitCode } = runCli(
      ['release', '--semver=patch', '--branch=urgent', '--yes'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain('1.0.1');

    const state = snapshotRepoState(repoDir);
    expect(state.version).toBe('1.0.1');
    expect(state.branches).toContain('hotfix/1.0.1');
    expect(state.tags).toContain('v1.0.1');
    expect(state.branch).toBe('hotfix/1.0.1');
  }, 30000);

  /**
   * Hotfix strategy only allows patch semver type. Minor should fail
   * with exit code 3 (INVALID_ARGS).
   *
   * Validates: Requirement 3.4
   */
  test('release minor → exit 3 (only patch allowed)', () => {
    const { repoDir, remoteDir } = createRepoFixtureWithStrategy({ strategy: 'hotfix' });
    dirs.push(repoDir, remoteDir);

    const { exitCode, stderr } = runCli(
      ['release', '--semver=minor', '--branch=feat', '--yes'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(3);
    expect(stderr).toContain('patch');
  }, 30000);

  /**
   * Hotfix strategy requires current branch to be main or master.
   * Release from a feature branch should fail with exit code 3.
   *
   * Validates: Requirement 3.5
   */
  test('release from feature branch → exit 3 (requires main/master)', () => {
    const { repoDir, remoteDir } = createRepoFixtureWithStrategy({ strategy: 'hotfix' });
    dirs.push(repoDir, remoteDir);

    git(repoDir, 'checkout -b feature/something');

    const { exitCode, stderr } = runCli(
      ['release', '--semver=patch', '--branch=urgent', '--yes'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(3);
    expect(stderr).toContain('main');
  }, 30000);

  /**
   * Plan --json with hotfix strategy returns strategy field.
   *
   * Validates: Requirements 3.9
   */
  test('plan --json → strategy: "hotfix", exit 0', () => {
    const { repoDir, remoteDir } = createRepoFixtureWithStrategy({ strategy: 'hotfix' });
    dirs.push(repoDir, remoteDir);

    const { stdout, exitCode } = runCli(
      ['plan', '--semver=patch', '--branch=urgent', '--json'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.dryRun).toBe(true);
    expect(parsed.strategy).toBe('hotfix');
  }, 30000);

  /**
   * Dry-run with hotfix strategy does not mutate the repository.
   *
   * Validates: Requirement 3.10
   */
  test('dry-run → no mutations to repo', () => {
    const { repoDir, remoteDir } = createRepoFixtureWithStrategy({ strategy: 'hotfix' });
    dirs.push(repoDir, remoteDir);

    const snapshotBefore = snapshotRepoState(repoDir);

    const { exitCode } = runCli(
      ['release', '--semver=patch', '--branch=urgent', '--yes', '--dry-run'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    assertNoMutation(repoDir, snapshotBefore);
  }, 30000);
});

// ─── maintenance strategy ───────────────────────────────────────────────

describe('E2E: maintenance strategy', () => {
  /**
   * Release patch from main with maintenance strategy creates branch
   * support/{major}.{minor} and tag v{version}.
   *
   * Note: maintenance strategy with patch from 1.0.0 → 1.0.1 sets
   * reuseBranch=true (patchNum > 0), so the support/1.0 branch must
   * exist before release. We pre-create it to simulate a real workflow.
   *
   * Validates: Requirement 3.6
   */
  test('release patch from main → branch support/{major}.{minor}, tag v{version}, exit 0', () => {
    const { repoDir, remoteDir } = createRepoFixtureWithStrategy({ strategy: 'maintenance' });
    dirs.push(repoDir, remoteDir);

    // Pre-create the support/1.0 branch (simulates prior maintenance setup)
    git(repoDir, 'branch support/1.0');

    const { stdout, exitCode } = runCli(
      ['release', '--semver=patch', '--branch=fix', '--yes'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain('1.0.1');

    const state = snapshotRepoState(repoDir);
    expect(state.version).toBe('1.0.1');
    expect(state.branches).toContain('support/1.0');
    expect(state.tags).toContain('v1.0.1');
    expect(state.branch).toBe('support/1.0');
  }, 30000);

  /**
   * Maintenance strategy only allows patch semver type. Minor should fail
   * with exit code 3 (INVALID_ARGS).
   *
   * Validates: Requirement 3.7
   */
  test('release minor → exit 3 (only patch allowed)', () => {
    const { repoDir, remoteDir } = createRepoFixtureWithStrategy({ strategy: 'maintenance' });
    dirs.push(repoDir, remoteDir);

    const { exitCode, stderr } = runCli(
      ['release', '--semver=minor', '--branch=feat', '--yes'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(3);
    expect(stderr).toContain('patch');
  }, 30000);

  /**
   * Maintenance strategy requires current branch to be main, master,
   * or a support/* branch. Release from a feature branch should fail
   * with exit code 3.
   *
   * Validates: Requirement 3.8
   */
  test('release from feature branch → exit 3 (requires main/master/support)', () => {
    const { repoDir, remoteDir } = createRepoFixtureWithStrategy({ strategy: 'maintenance' });
    dirs.push(repoDir, remoteDir);

    git(repoDir, 'checkout -b feature/something');

    const { exitCode, stderr } = runCli(
      ['release', '--semver=patch', '--branch=fix', '--yes'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(3);
    expect(stderr).toContain('support');
  }, 30000);

  /**
   * Plan --json with maintenance strategy returns strategy field.
   *
   * Validates: Requirements 3.9
   */
  test('plan --json → strategy: "maintenance", exit 0', () => {
    const { repoDir, remoteDir } = createRepoFixtureWithStrategy({ strategy: 'maintenance' });
    dirs.push(repoDir, remoteDir);

    const { stdout, exitCode } = runCli(
      ['plan', '--semver=patch', '--branch=fix', '--json'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.dryRun).toBe(true);
    expect(parsed.strategy).toBe('maintenance');
  }, 30000);

  /**
   * Dry-run with maintenance strategy does not mutate the repository.
   *
   * Validates: Requirement 3.10
   */
  test('dry-run → no mutations to repo', () => {
    const { repoDir, remoteDir } = createRepoFixtureWithStrategy({ strategy: 'maintenance' });
    dirs.push(repoDir, remoteDir);

    const snapshotBefore = snapshotRepoState(repoDir);

    const { exitCode } = runCli(
      ['release', '--semver=patch', '--branch=fix', '--yes', '--dry-run'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    assertNoMutation(repoDir, snapshotBefore);
  }, 30000);
});
