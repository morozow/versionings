// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * E2E tests: Branching policy enforcement CLI commands via `node dist/version.js`.
 *
 * Validates: Requirements 2.1, 10.5, 10.6, 10.7, 17.1, 17.3, 17.5, 17.6
 */

import { execSync, spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import {
  createRepoFixture,
  snapshotRepoState,
  cleanup,
  git,
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

describe('E2E: Branching policy enforcement commands', () => {
  // Test 1: Default strategy (no git.branching) — exit code 0, backward compatible
  // Validates: Requirements 2.1, 10.5
  test('default strategy (no git.branching) — exit code 0, backward compatible', () => {
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

  // Test 2: Backward compatibility — --semver=patch --branch=test without new fields works as before
  // Validates: Requirements 2.1, 10.5
  test('backward compatibility — --semver=patch --branch=test without new fields works as before', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { stdout, exitCode } = runCli(
      ['release', '--semver=patch', '--branch=compat', '--yes'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain('1.0.1');

    const state = snapshotRepoState(repoDir);
    expect(state.version).toBe('1.0.1');
    expect(state.branches).toContain('version/patch/1.0.1/compat');
    expect(state.tags).toContain('1.0.1--compat');
  }, 30000);

  // Test 3: Plan with --json and git.branching.strategy=trunk-based — JSON output contains strategy field
  // Validates: Requirements 17.1, 17.3
  test('plan --json with git.branching.strategy=trunk-based — JSON contains strategy field', () => {
    const { repoDir, remoteDir, remoteUrl } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    // Write version.json with branching section
    const versionJson = {
      git: {
        platform: 'github',
        url: remoteUrl,
        branching: { strategy: 'trunk-based' },
      },
    };
    fs.writeFileSync(path.join(repoDir, 'version.json'), JSON.stringify(versionJson, null, 2));
    git(repoDir, 'add version.json');
    git(repoDir, 'commit -m "update config"');

    const { stdout, exitCode } = runCli(
      ['plan', '--semver=patch', '--branch=test', '--json'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.dryRun).toBe(true);
    expect(parsed.strategy).toBe('trunk-based');
  }, 30000);

  // Test 4: Validate with --json and git.branching section — JSON contains branching_strategy check
  // Validates: Requirements 10.6, 17.5
  test('validate --json with git.branching section — JSON contains branching strategy check', () => {
    const { repoDir, remoteDir, remoteUrl } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    // Write version.json with branching section
    const versionJson = {
      git: {
        platform: 'github',
        url: remoteUrl,
        branching: { strategy: 'trunk-based' },
      },
    };
    fs.writeFileSync(path.join(repoDir, 'version.json'), JSON.stringify(versionJson, null, 2));
    git(repoDir, 'add version.json');
    git(repoDir, 'commit -m "update config"');

    const { stdout, exitCode } = runCli(
      ['validate', '--json'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.valid).toBe(true);
    expect(Array.isArray(parsed.checks)).toBe(true);

    // Should contain a branching_strategy check
    const branchingCheck = parsed.checks.find(
      (c: any) => c.name === 'branching_strategy',
    );
    expect(branchingCheck).toBeDefined();
    expect(branchingCheck.status).toBe('pass');
  }, 30000);

  // Test 5: Doctor with --json and non-default strategy — JSON contains branching_strategy check
  // Validates: Requirements 10.7, 17.6
  test('doctor --json with trunk-based strategy — JSON contains branching_strategy check', () => {
    const { repoDir, remoteDir, remoteUrl } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    // Write version.json with non-default branching strategy
    // (doctor skips branching check for strategy=default)
    const versionJson = {
      git: {
        platform: 'github',
        url: remoteUrl,
        branching: { strategy: 'trunk-based' },
      },
    };
    fs.writeFileSync(path.join(repoDir, 'version.json'), JSON.stringify(versionJson, null, 2));
    git(repoDir, 'add version.json');
    git(repoDir, 'commit -m "update config"');

    const { stdout, exitCode } = runCli(
      ['doctor', '--json'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);

    // Doctor --json outputs checks array (first line) followed by provenance
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

    // Should contain a branching_strategy check (present for non-default strategies)
    const branchingCheck = checks.find(
      (c: any) => c.name === 'branching_strategy',
    );
    expect(branchingCheck).toBeDefined();
    // Current branch is main, trunk-based expects main/master → should pass
    expect(branchingCheck.status).toBe('pass');
  }, 30000);
});
