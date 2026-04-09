// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * E2E tests: CLI subcommands via `node dist/version.js` with real git repositories.
 *
 * Validates: Requirements 6.1, 7.1, 8.1, 9.1, 9.3, 10.2, 11.1, 12.1, 12.2, 12.5, 14.4, 15.1, 16.2, 17.1
 */

import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import {
  createRepoFixture,
  snapshotRepoState,
  assertNoMutation,
  cleanup,
} from '../helpers/repo-fixture';

const CLI_PATH = path.resolve(__dirname, '../../dist/version.js');
const PROJECT_ROOT = path.resolve(__dirname, '../..');

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run the CLI via execSync. For commands that may exit with non-zero,
 * we catch the error and extract status/stdout/stderr.
 */
function runCli(args: string[], opts: { cwd: string }): RunResult {
  const cmd = `${process.execPath} ${CLI_PATH} ${args.join(' ')}`;
  try {
    const stdout = execSync(cmd, {
      cwd: opts.cwd,
      encoding: 'utf8',
      timeout: 15000,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.status ?? 1,
    };
  }
}

let dirs: string[] = [];

beforeAll(() => {
  // Build dist/version.js before running E2E tests
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

describe('E2E: CLI subcommands', () => {
  // Test 1: versionings init --format=json --non-interactive
  // Requirement: 6.1
  test('init --format=json --non-interactive — creates config file, exit code 0', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    // Remove existing version.json so init creates a fresh one
    fs.unlinkSync(path.join(repoDir, 'version.json'));

    const { exitCode, stdout } = runCli(
      ['init', '--format=json', '--non-interactive'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Created');
    expect(fs.existsSync(path.join(repoDir, 'version.json'))).toBe(true);

    // Verify the created file is valid JSON
    const content = fs.readFileSync(path.join(repoDir, 'version.json'), 'utf8');
    const parsed = JSON.parse(content);
    expect(parsed.git).toBeDefined();
    expect(parsed.git.platform).toBeDefined();
  }, 30000);

  // Test 2: versionings validate — valid config, exit code 0
  // Requirement: 7.1
  test('validate — valid config, exit code 0', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { exitCode } = runCli(['validate'], { cwd: repoDir });
    expect(exitCode).toBe(0);
  }, 30000);

  // Test 3: versionings validate --json — JSON output
  // Requirement: 7.1
  test('validate --json — JSON output', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { exitCode, stdout } = runCli(['validate', '--json'], { cwd: repoDir });
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(stdout.trim());
    expect(parsed.valid).toBe(true);
    expect(Array.isArray(parsed.checks)).toBe(true);
    // No ANSI escape codes in JSON output
    // eslint-disable-next-line no-control-regex
    expect(stdout).not.toMatch(/\x1b\[/);
  }, 30000);

  // Test 4: versionings plan --semver=patch --branch=test — plan without mutations, exit code 0
  // Requirement: 8.1
  test('plan --semver=patch --branch=test — plan without mutations, exit code 0', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const snapshotBefore = snapshotRepoState(repoDir);

    const { exitCode, stdout } = runCli(
      ['plan', '--semver=patch', '--branch=test'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);

    // Plan should not mutate the repo
    assertNoMutation(repoDir, snapshotBefore);
  }, 30000);

  // Test 5: versionings release --semver=patch --branch=test --yes — full workflow, exit code 0
  // Requirement: 9.1
  test('release --semver=patch --branch=test --yes — full workflow, exit code 0', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { exitCode, stdout } = runCli(
      ['release', '--semver=patch', '--branch=test', '--yes'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain('1.0.1');

    const state = snapshotRepoState(repoDir);
    expect(state.version).toBe('1.0.1');
  }, 30000);

  // Test 6: versionings --semver=patch --branch=test --yes — backward compatibility (no subcommand → release)
  // Requirement: 9.3, 12.2
  test('--semver=patch --branch=test --yes — backward compatibility (no subcommand → release)', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { exitCode, stdout } = runCli(
      ['--semver=patch', '--branch=test', '--yes'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain('1.0.1');

    const state = snapshotRepoState(repoDir);
    expect(state.version).toBe('1.0.1');
  }, 30000);

  // Test 7: versionings rollback — no log, exit code 8 (NO_OPERATION)
  // Requirement: 10.2
  test('rollback — no log, exit code 8 (NO_OPERATION)', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { exitCode, stderr } = runCli(['rollback'], { cwd: repoDir });
    expect(exitCode).toBe(8);
    expect(stderr.length).toBeGreaterThan(0);
  }, 30000);

  // Test 8: versionings doctor — diagnostics, exit code 0
  // Requirement: 11.1
  test('doctor — diagnostics, exit code 0', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { exitCode, stdout } = runCli(['doctor'], { cwd: repoDir });
    expect(exitCode).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
  }, 30000);

  // Test 9: versionings doctor --json — JSON output
  // Requirement: 11.1
  test('doctor --json — JSON output', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { exitCode, stdout } = runCli(['doctor', '--json'], { cwd: repoDir });
    expect(exitCode).toBe(0);

    // Doctor --json outputs checks array followed by provenance object (two JSON lines)
    const lines = stdout.trim().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const checks = JSON.parse(lines[0]);
    expect(Array.isArray(checks)).toBe(true);
    expect(checks.length).toBeGreaterThan(0);
    // Each check has name, status, found
    for (const check of checks) {
      expect(check).toHaveProperty('name');
      expect(check).toHaveProperty('status');
      expect(check).toHaveProperty('found');
    }
    // eslint-disable-next-line no-control-regex
    expect(stdout).not.toMatch(/\x1b\[/);
  }, 30000);

  // Test 10: versionings nonexistent — unknown subcommand, exit code 3 (INVALID_ARGS)
  // Requirement: 12.5
  test('nonexistent — unknown subcommand, exit code 3 (INVALID_ARGS)', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { exitCode, stderr } = runCli(['nonexistent'], { cwd: repoDir });
    expect(exitCode).toBe(3);
    expect(stderr).toContain('Available commands');
  }, 30000);

  // Test 11: versionings --print-config — provenance output, exit code 0
  // Requirement: 15.1
  test('--print-config — provenance output, exit code 0', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { exitCode, stdout } = runCli(['--print-config'], { cwd: repoDir });
    expect(exitCode).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
  }, 30000);

  // Test 12: versionings release --semver=patch --branch=test --strict with unknown fields — exit code 1
  // Requirement: 16.2
  test('release --strict with unknown fields — exit code 1 (CONFIG_ERROR)', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    // Add unknown top-level field to version.json
    const configPath = path.join(repoDir, 'version.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.unknownTopLevelField = 'should-cause-error';
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

    const { exitCode, stderr } = runCli(
      ['release', '--semver=patch', '--branch=test', '--strict', '--yes'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(1);
    expect(stderr.length).toBeGreaterThan(0);
  }, 30000);
});
