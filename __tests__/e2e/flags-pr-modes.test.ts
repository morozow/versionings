// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * E2E tests: Global CLI flags (--verbose, --ci, --non-interactive)
 * and PR mode flags (--pr-mode=auto|api|url).
 *
 * Validates: Requirements 6.1–6.4, 7.1–7.4
 */

import { execSync, spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import {
  createRepoFixture,
  cleanup,
} from '../helpers/repo-fixture';

const CLI_PATH = path.resolve(__dirname, '../../dist/version.js');
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

// ─── Global flags ───────────────────────────────────────────────────────

describe('E2E: global flags', () => {
  /**
   * --verbose produces more output than the same command without --verbose.
   * We compare total output length (stdout + stderr) of two identical plan
   * invocations — one with --verbose, one without.
   *
   * Validates: Requirement 6.1
   */
  test('--verbose — stdout+stderr longer than without --verbose', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const baseArgs = ['plan', '--semver=patch', '--branch=test', '--json'];

    const normal = runCli(baseArgs, { cwd: repoDir });
    const verbose = runCli([...baseArgs, '--verbose'], { cwd: repoDir });

    expect(normal.exitCode).toBe(0);
    expect(verbose.exitCode).toBe(0);

    const normalLen = normal.stdout.length + normal.stderr.length;
    const verboseLen = verbose.stdout.length + verbose.stderr.length;
    expect(verboseLen).toBeGreaterThan(normalLen);
  }, 30000);

  /**
   * --ci implies --non-interactive and --yes. Running release with --ci
   * but WITHOUT --yes should succeed (exit 0) because --ci auto-confirms.
   *
   * Validates: Requirement 6.2
   */
  test('--ci — release without --yes → exit 0 (CI implies non-interactive + yes)', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { exitCode } = runCli(
      ['release', '--semver=patch', '--branch=test', '--ci'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
  }, 30000);

  /**
   * --non-interactive with --yes disables interactive prompts and
   * auto-confirms. Release should succeed with exit 0.
   *
   * Validates: Requirement 6.3
   */
  test('--non-interactive — release with --non-interactive --yes → exit 0', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { exitCode } = runCli(
      ['release', '--semver=patch', '--branch=test', '--non-interactive', '--yes'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
  }, 30000);

  /**
   * --verbose --json together: verbose output goes to stderr, JSON stays
   * valid in stdout. Parsing stdout as JSON must succeed.
   *
   * Validates: Requirement 6.4
   */
  test('--verbose --json — JSON in stdout is valid, verbose does not break parsing', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { stdout, stderr, exitCode } = runCli(
      ['plan', '--semver=patch', '--branch=test', '--verbose', '--json'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);

    // stdout must be valid JSON
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.dryRun).toBe(true);
    expect(Array.isArray(parsed.steps)).toBe(true);

    // verbose output should appear in stderr, not pollute stdout
    expect(stderr.length).toBeGreaterThan(0);
  }, 30000);
});

// ─── PR modes ───────────────────────────────────────────────────────────

describe('E2E: PR modes', () => {
  /**
   * --pr-mode=auto in plan --push --json → pullRequest.mode === "auto".
   *
   * Validates: Requirement 7.1
   */
  test('--pr-mode=auto — plan --push --json → pullRequest.mode === "auto"', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { stdout, exitCode } = runCli(
      ['plan', '--semver=patch', '--branch=test', '--push', '--json', '--pr-mode=auto'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.dryRun).toBe(true);
    expect(parsed.pullRequest).toBeDefined();
    expect(parsed.pullRequest.mode).toBe('auto');
  }, 30000);

  /**
   * --pr-mode=api in plan --push --json → pullRequest.mode === "api".
   *
   * Validates: Requirement 7.2
   */
  test('--pr-mode=api — plan --push --json → pullRequest.mode === "api"', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { stdout, exitCode } = runCli(
      ['plan', '--semver=patch', '--branch=test', '--push', '--json', '--pr-mode=api'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.dryRun).toBe(true);
    expect(parsed.pullRequest).toBeDefined();
    expect(parsed.pullRequest.mode).toBe('api');
  }, 30000);

  /**
   * --pr-mode=url in plan --push --json → pullRequest.mode === "url".
   *
   * Validates: Requirement 7.3
   */
  test('--pr-mode=url — plan --push --json → pullRequest.mode === "url"', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { stdout, exitCode } = runCli(
      ['plan', '--semver=patch', '--branch=test', '--push', '--json', '--pr-mode=url'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.dryRun).toBe(true);
    expect(parsed.pullRequest).toBeDefined();
    expect(parsed.pullRequest.mode).toBe('url');
  }, 30000);

  /**
   * --pr-mode=url with release --push --json without auth token →
   * pullRequest with URL (fallback to URL-based PR creation).
   * Token env vars are stripped to ensure no API token is found.
   *
   * Validates: Requirement 7.4
   */
  test('--pr-mode=url + release --push --json → pullRequest with URL', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    // Strip all token env vars to ensure no API token is found
    const cleanEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (
        v !== undefined &&
        !k.includes('TOKEN') &&
        !k.includes('VERSIONINGS_TOKEN') &&
        !k.includes('VERSIONINGS_AUTH')
      ) {
        cleanEnv[k] = v;
      }
    }

    const { stdout, exitCode } = runCli(
      ['release', '--semver=patch', '--branch=test', '--yes', '--push', '--json', '--pr-mode=url'],
      { cwd: repoDir, env: cleanEnv },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.success).toBe(true);
    expect(parsed.pullRequest).toBeDefined();
    expect(parsed.pullRequest.url).toBeDefined();
    expect(typeof parsed.pullRequest.url).toBe('string');
  }, 30000);
});
