// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * E2E tests: CLI as a child process with real git repositories.
 */

import { spawnSync } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import {
  createRepoFixture,
  snapshotRepoState,
  assertNoMutation,
  cleanup,
  git,
} from '../helpers/repo-fixture';

const CLI_PATH = path.resolve(__dirname, '../../out/dist/version.js');
const PROJECT_ROOT = path.resolve(__dirname, '../..');

function runCli(args: string[] = [], opts: { cwd?: string; env?: Record<string, string> } = {}) {
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

let dirs: string[] = [];

beforeAll(() => {
  const buildResult = spawnSync(process.execPath, ['build.js'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    timeout: 30000,
  });
  if (buildResult.status !== 0) {
    throw new Error(`Build failed (exit ${buildResult.status}): ${buildResult.stderr}`);
  }
  expect(fs.existsSync(CLI_PATH)).toBe(true);
});

afterEach(() => {
  cleanup(dirs);
  dirs = [];
});

describe('E2E: CLI with real git repos', () => {
  test('successful run — exit 0, stdout has version/branch, git state updated', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    const { stdout, exitCode } = runCli(['--semver=patch', '--branch=test-fix'], { cwd: repoDir });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('1.0.1');
    expect(stdout).toContain('test-fix');
    const state = snapshotRepoState(repoDir);
    expect(state.version).toBe('1.0.1');
    expect(state.branches).toContain('version/patch/1.0.1/test-fix');
    expect(state.tags).toContain('1.0.1--test-fix');
  }, 30000);

  test('successful run with --json — valid JSON output, no ANSI codes', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    const { stdout, exitCode } = runCli(['--semver=patch', '--branch=test-fix', '--json'], { cwd: repoDir });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.success).toBe(true);
    expect(parsed.version).toBe('1.0.1');
    expect(parsed.branch).toContain('test-fix');
    expect(parsed.tag).toBe('1.0.1--test-fix');
    // eslint-disable-next-line no-control-regex
    expect(stdout).not.toMatch(/\x1b\[/);
  }, 30000);

  test('dry-run — exit 0, git state unchanged', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    const snapshotBefore = snapshotRepoState(repoDir);
    const { exitCode } = runCli(['--semver=patch', '--branch=test-fix', '--dry-run'], { cwd: repoDir });
    expect(exitCode).toBe(0);
    assertNoMutation(repoDir, snapshotBefore);
  }, 30000);

  test('dry-run with --json — valid JSON with dryRun=true and steps array', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    const { stdout, exitCode } = runCli(['--semver=patch', '--branch=test-fix', '--dry-run', '--json'], { cwd: repoDir });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.dryRun).toBe(true);
    expect(Array.isArray(parsed.steps)).toBe(true);
    expect(parsed.steps.length).toBeGreaterThan(0);
  }, 30000);

  test('missing version.json — exit code 1 (CONFIG_ERROR)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versionings-e2e-'));
    dirs.push(tmpDir);
    const { exitCode } = runCli(['--semver=patch', '--branch=test-fix'], { cwd: tmpDir });
    expect(exitCode).toBe(1);
  }, 30000);

  test('missing version.json with --json — stderr is valid JSON with success=false', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versionings-e2e-'));
    dirs.push(tmpDir);
    const { exitCode, stderr } = runCli(['--semver=patch', '--branch=test-fix', '--json'], { cwd: tmpDir });
    expect(exitCode).not.toBe(0);
    const parsed = JSON.parse(stderr.trim());
    expect(parsed.success).toBe(false);
  }, 30000);

  test('invalid semver — exit code 3 (INVALID_ARGS)', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    const { exitCode } = runCli(['--semver=invalid', '--branch=test-fix'], { cwd: repoDir });
    expect(exitCode).toBe(3);
  }, 30000);

  test('dirty tree — exit code 2 (DIRTY_TREE)', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    fs.writeFileSync(path.join(repoDir, 'uncommitted.txt'), 'dirty\n');
    const { exitCode } = runCli(['--semver=patch', '--branch=test-fix'], { cwd: repoDir });
    expect(exitCode).toBe(2);
  }, 30000);

  test('artifact conflict — exit code 4 (ARTIFACT_CONFLICT)', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    git(repoDir, 'tag "1.0.1--test-fix"');
    const { exitCode } = runCli(['--semver=patch', '--branch=test-fix'], { cwd: repoDir });
    expect(exitCode).toBe(4);
  }, 30000);
});
