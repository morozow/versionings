/* Versioning automation tool, 2018-present */

/**
 * E2E tests: CLI as a child process with real git repositories.
 * Runs `node dist/version.js` with various arguments and checks exit codes,
 * stdout/stderr output, and real git state.
 *
 * Validates: Requirements 1.4, 8.1, 8.2, 9.1
 */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const {
  createRepoFixture,
  snapshotRepoState,
  assertNoMutation,
  cleanup,
  git,
} = require('../helpers/repo-fixture');

const CLI_PATH = path.resolve(__dirname, '../../dist/version.js');
const PROJECT_ROOT = path.resolve(__dirname, '../..');

/**
 * Runs the CLI with given arguments and returns { stdout, stderr, exitCode }.
 * @param {string[]} args - CLI arguments
 * @param {object} opts - options: cwd, env
 */
function runCli(args = [], opts = {}) {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: opts.cwd || PROJECT_ROOT,
    env: { ...process.env, ...opts.env },
    encoding: 'utf8',
    timeout: 15000,
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: result.status,
  };
}

let dirs = [];

beforeAll(() => {
  // Build the project so dist/version.js is up to date
  const buildResult = spawnSync(process.execPath, ['build.js'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    timeout: 30000,
  });
  if (buildResult.status !== 0) {
    throw new Error(
      `Build failed (exit ${buildResult.status}): ${buildResult.stderr}`,
    );
  }
  expect(fs.existsSync(CLI_PATH)).toBe(true);
});

afterEach(() => {
  cleanup(dirs);
  dirs = [];
});

describe('E2E: CLI with real git repos', () => {
  // ── Test 1: Successful run ──
  test('successful run — exit 0, stdout has version/branch, git state updated', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { stdout, exitCode } = runCli(
      ['--semver=patch', '--branch=test-fix'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain('1.0.1');
    expect(stdout).toContain('test-fix');

    // Verify git state: branch and tag created, package.json updated
    const state = snapshotRepoState(repoDir);
    expect(state.version).toBe('1.0.1');
    expect(state.branches).toContain('version/patch/1.0.1/test-fix');
    expect(state.tags).toContain('1.0.1--test-fix');
  }, 30000);

  // ── Test 2: Successful run with --json ──
  test('successful run with --json — valid JSON output, no ANSI codes', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { stdout, exitCode } = runCli(
      ['--semver=patch', '--branch=test-fix', '--json'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);

    // stdout must be valid JSON
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.success).toBe(true);
    expect(parsed.version).toBe('1.0.1');
    expect(parsed.branch).toContain('test-fix');
    expect(parsed.tag).toBe('1.0.1--test-fix');

    // No ANSI escape sequences
    // eslint-disable-next-line no-control-regex
    expect(stdout).not.toMatch(/\x1b\[/);
  }, 30000);

  // ── Test 3: Dry-run ──
  test('dry-run — exit 0, git state unchanged', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const snapshotBefore = snapshotRepoState(repoDir);

    const { exitCode } = runCli(
      ['--semver=patch', '--branch=test-fix', '--dry-run'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    assertNoMutation(repoDir, snapshotBefore);
  }, 30000);

  // ── Test 4: Dry-run with --json ──
  test('dry-run with --json — valid JSON with dryRun=true and steps array', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { stdout, exitCode } = runCli(
      ['--semver=patch', '--branch=test-fix', '--dry-run', '--json'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);

    const parsed = JSON.parse(stdout.trim());
    expect(parsed.dryRun).toBe(true);
    expect(Array.isArray(parsed.steps)).toBe(true);
    expect(parsed.steps.length).toBeGreaterThan(0);
  }, 30000);

  // ── Test 5: Missing version.json ──
  test('missing version.json — exit code 1 (CONFIG_ERROR)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versionings-e2e-'));
    dirs.push(tmpDir);

    const { exitCode } = runCli(
      ['--semver=patch', '--branch=test-fix'],
      { cwd: tmpDir },
    );

    expect(exitCode).toBe(1);
  }, 30000);

  // ── Test 6: Missing version.json with --json ──
  test('missing version.json with --json — stderr is valid JSON with success=false', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versionings-e2e-'));
    dirs.push(tmpDir);

    const { exitCode, stderr } = runCli(
      ['--semver=patch', '--branch=test-fix', '--json'],
      { cwd: tmpDir },
    );

    expect(exitCode).not.toBe(0);

    const parsed = JSON.parse(stderr.trim());
    expect(parsed.success).toBe(false);
  }, 30000);

  // ── Test 7: Invalid semver ──
  test('invalid semver — exit code 3 (INVALID_ARGS)', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { exitCode } = runCli(
      ['--semver=invalid', '--branch=test-fix'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(3);
  }, 30000);

  // ── Test 8: Dirty tree ──
  test('dirty tree — exit code 2 (DIRTY_TREE)', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    // Create an uncommitted file
    fs.writeFileSync(path.join(repoDir, 'uncommitted.txt'), 'dirty\n');

    const { exitCode } = runCli(
      ['--semver=patch', '--branch=test-fix'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(2);
  }, 30000);

  // ── Test 9: Artifact conflict ──
  test('artifact conflict — exit code 4 (ARTIFACT_CONFLICT)', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    // Create a conflicting tag (patch bump from 1.0.0 → 1.0.1)
    git(repoDir, 'tag "1.0.1--test-fix"');

    const { exitCode } = runCli(
      ['--semver=patch', '--branch=test-fix'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(4);
  }, 30000);
});
