// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * E2E tests: PR-related CLI commands via `node dist/version.js`.
 *
 * Validates: Requirements 4.6, 7.4, 7.5, 13.3, 15.1, 15.2
 */

import { execSync, spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import {
  createRepoFixture,
  snapshotRepoState,
  cleanup,
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

describe('E2E: PR commands', () => {
  // Test 1: release --no-pr — exit code 0, no PR in output
  // Validates: Requirements 7.5
  test('release --no-pr — exit code 0, no PR info in output', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { stdout, exitCode } = runCli(
      ['release', '--semver=patch', '--branch=test', '--yes', '--no-pr'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain('1.0.1');
    // No PR-related output when --no-pr is used
    expect(stdout.toLowerCase()).not.toContain('pull request');
    expect(stdout.toLowerCase()).not.toContain('merge request');

    const state = snapshotRepoState(repoDir);
    expect(state.version).toBe('1.0.1');
  }, 30000);

  // Test 2: release --json without token — JSON with pullRequest.status=fallback
  // Validates: Requirements 7.4, 13.3, 15.1, 15.2
  test('release --json --push without token — JSON with pullRequest.status=fallback', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    // Strip all token env vars to ensure no token is found
    const cleanEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined &&
        !k.includes('TOKEN') &&
        !k.includes('VERSIONINGS_TOKEN') &&
        !k.includes('VERSIONINGS_AUTH')) {
        cleanEnv[k] = v;
      }
    }

    const { stdout, exitCode } = runCli(
      ['release', '--semver=patch', '--branch=test', '--yes', '--push', '--json'],
      { cwd: repoDir, env: cleanEnv },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.success).toBe(true);
    expect(parsed.version).toBe('1.0.1');

    // pullRequest object should be present with fallback status.
    // The repo fixture uses a local path as remote URL (not a real GitHub URL),
    // so the fallback reason may be 'no_token' or a URL parse error — both are valid fallbacks.
    expect(parsed.pullRequest).toBeDefined();
    expect(parsed.pullRequest.status).toBe('fallback');
    expect(parsed.pullRequest.fallbackReason).toBeDefined();
    expect(typeof parsed.pullRequest.fallbackReason).toBe('string');
    expect(parsed.pullRequest.url).toBeDefined();
    expect(typeof parsed.pullRequest.url).toBe('string');

    // Backward compatibility: pullRequestUrl alias
    expect(parsed.pullRequestUrl).toBeDefined();
    expect(parsed.pullRequestUrl).toBe(parsed.pullRequest.url);
  }, 30000);

  // Test 3: plan --json — JSON dry-run with pullRequest section
  // Validates: Requirements 4.6, 15.1
  test('plan --json --push — JSON dry-run with pullRequest section', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { stdout, exitCode } = runCli(
      ['plan', '--semver=patch', '--branch=test', '--push', '--json'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.dryRun).toBe(true);
    expect(Array.isArray(parsed.steps)).toBe(true);
    expect(parsed.steps.length).toBeGreaterThan(0);

    // Dry-run plan should include pullRequest info
    expect(parsed.pullRequest).toBeDefined();
    expect(parsed.pullRequest.mode).toBeDefined();
    expect(parsed.pullRequest.platform).toBeDefined();
    expect(typeof parsed.pullRequest.hasToken).toBe('boolean');
  }, 30000);

  // Test 4: doctor --json with GITHUB_TOKEN — JSON contains SCM API check
  // Validates: Requirements 13.3
  test('doctor --json with GITHUB_TOKEN — JSON contains scm_api check', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { stdout, exitCode } = runCli(
      ['doctor', '--json'],
      { cwd: repoDir, env: { GITHUB_TOKEN: 'ghp_fake_token_for_test_1234' } },
    );

    // Doctor exits 0 if all checks pass, 1 if any check fails.
    // With a fake token the SCM API check will fail, so exit code 1 is expected.
    expect([0, 1]).toContain(exitCode);

    // Doctor --json outputs checks array (first line) followed by provenance
    const lines = stdout.trim().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const checks = JSON.parse(lines[0]);
    expect(Array.isArray(checks)).toBe(true);

    // Should contain scm_api check (will fail with fake token, but must be present)
    const scmCheck = checks.find((c: any) => c.name === 'scm_api');
    expect(scmCheck).toBeDefined();
    expect(scmCheck.name).toBe('scm_api');
    expect(['pass', 'fail', 'warn']).toContain(scmCheck.status);
    expect(scmCheck.found).toBeDefined();
  }, 30000);

  // Test 5: Backward compatibility — no subcommand, no new fields → works as before
  // Validates: Requirements 15.1, 15.2
  test('backward compatibility — --semver=patch --branch=test --yes without new fields', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { stdout, exitCode } = runCli(
      ['--semver=patch', '--branch=test', '--yes'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain('1.0.1');

    const state = snapshotRepoState(repoDir);
    expect(state.version).toBe('1.0.1');
    expect(state.branches).toContain('version/patch/1.0.1/test');
    expect(state.tags).toContain('1.0.1--test');
  }, 30000);
});
