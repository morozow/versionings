// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * E2E tests: changelog and auto-bump CLI commands via `node dist/version.js`.
 *
 * Validates: Requirements 5.1, 5.4, 7.1, 7.7, 7.8, 7.9, 12.1, 13.5, 14.1
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


/**
 * Helper: add conventional commits to a repo fixture.
 */
function addConventionalCommits(repoDir: string): void {
  fs.writeFileSync(path.join(repoDir, 'a.txt'), 'a\n');
  git(repoDir, 'add a.txt');
  git(repoDir, 'commit -m "feat: add feature A"');

  fs.writeFileSync(path.join(repoDir, 'b.txt'), 'b\n');
  git(repoDir, 'add b.txt');
  git(repoDir, 'commit -m "fix: resolve bug B"');
}

describe('E2E: changelog subcommand', () => {
  // Test 1: versionings changelog — generate changelog to stdout, exit code 0
  // Validates: Requirements 7.1, 7.8, 14.1
  test('changelog — generate changelog to stdout, exit code 0', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    addConventionalCommits(repoDir);

    const { stdout, exitCode } = runCli(['changelog'], { cwd: repoDir });

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Features');
    expect(stdout).toContain('add feature A');
    expect(stdout).toContain('Bug Fixes');
    expect(stdout).toContain('resolve bug B');
  }, 30000);

  // Test 2: versionings changelog --json — JSON output with required fields
  // Validates: Requirements 7.7, 13.5
  test('changelog --json — JSON output with required fields', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    addConventionalCommits(repoDir);

    const { stdout, exitCode } = runCli(['changelog', '--json'], { cwd: repoDir });

    expect(exitCode).toBe(0);

    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toHaveProperty('version');
    expect(parsed).toHaveProperty('date');
    expect(parsed).toHaveProperty('groups');
    expect(parsed).toHaveProperty('range');
    expect(parsed).toHaveProperty('markdown');
    expect(Array.isArray(parsed.groups)).toBe(true);
    expect(parsed.range).toHaveProperty('from');
    expect(parsed.range).toHaveProperty('to');
    expect(typeof parsed.markdown).toBe('string');
    expect(parsed.markdown).toContain('add feature A');
    // eslint-disable-next-line no-control-regex
    expect(stdout).not.toMatch(/\x1b\[/);
  }, 30000);

  // Test 3: versionings changelog --output=CHANGELOG.md — write to file
  // Validates: Requirements 7.1, 7.9
  test('changelog --output=CHANGELOG.md — write to file', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    addConventionalCommits(repoDir);

    const changelogPath = path.join(repoDir, 'CHANGELOG.md');
    const { exitCode } = runCli(['changelog', '--output=CHANGELOG.md'], { cwd: repoDir });

    expect(exitCode).toBe(0);
    expect(fs.existsSync(changelogPath)).toBe(true);

    const content = fs.readFileSync(changelogPath, 'utf8');
    expect(content).toContain('Changelog');
    expect(content).toContain('add feature A');
    expect(content).toContain('resolve bug B');
  }, 30000);

  // Test 4: versionings changelog --from=v1.0.0 --to=HEAD — specify range
  // Validates: Requirements 7.1
  test('changelog --from=v1.0.0 --to=HEAD — specify range', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    // Tag current HEAD as v1.0.0
    git(repoDir, 'tag v1.0.0');

    // Add commits after the tag
    addConventionalCommits(repoDir);

    const { stdout, exitCode } = runCli(
      ['changelog', '--from=v1.0.0', '--to=HEAD'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain('add feature A');
    expect(stdout).toContain('resolve bug B');
    // The initial "init" commit should NOT appear (it's before v1.0.0)
    expect(stdout).not.toContain('init');
  }, 30000);

  // Test 5: versionings changelog without commits — exit code 8 (NO_OPERATION)
  // Validates: Requirements 7.9
  test('changelog without commits in range — exit code 8 (NO_OPERATION)', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    // Tag HEAD so the range tag..HEAD has zero commits
    git(repoDir, 'tag v1.0.0');

    const { exitCode } = runCli(
      ['changelog', '--from=v1.0.0', '--to=HEAD'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(8);
  }, 30000);
});


describe('E2E: release and plan with --semver=auto', () => {
  // Test 6: versionings release --semver=auto --branch=test --yes with conventional commits — exit code 0
  // Validates: Requirements 5.1, 5.4, 12.1
  test('release --semver=auto with conventional commits — exit code 0, autoBump in JSON', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    addConventionalCommits(repoDir);

    const { stdout, exitCode } = runCli(
      ['release', '--semver=auto', '--branch=test', '--yes', '--json'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);

    const parsed = JSON.parse(stdout.trim());
    expect(parsed.success).toBe(true);
    // feat → minor bump: 1.0.0 → 1.1.0
    expect(parsed.version).toBe('1.1.0');
    expect(parsed.autoBump).toBeDefined();
    expect(parsed.autoBump.detectedBump).toBe('minor');
    expect(typeof parsed.autoBump.totalCommits).toBe('number');
    expect(parsed.autoBump.totalCommits).toBeGreaterThan(0);
  }, 30000);

  // Test 7: versionings release --semver=auto without CC and without fallback — exit code 11
  // Validates: Requirements 12.1
  test('release --semver=auto without conventional commits — exit code 11 (NO_CONVENTIONAL_COMMITS)', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    // The repo only has the "init" commit which is not a conventional commit.
    // No fallbackBump configured → should fail with exit code 11.
    const { exitCode } = runCli(
      ['release', '--semver=auto', '--branch=test', '--yes'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(11);
  }, 30000);

  // Test 8: versionings plan --semver=auto --branch=test --json — JSON dry-run with autoBump
  // Validates: Requirements 5.4, 13.5
  test('plan --semver=auto --json — JSON dry-run with autoBump', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    addConventionalCommits(repoDir);

    const { stdout, exitCode } = runCli(
      ['plan', '--semver=auto', '--branch=test', '--json'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);

    const parsed = JSON.parse(stdout.trim());
    expect(parsed.dryRun).toBe(true);
    expect(parsed.autoBump).toBeDefined();
    expect(parsed.autoBump.detectedBump).toBe('minor');
    expect(typeof parsed.autoBump.totalCommits).toBe('number');
    expect(Array.isArray(parsed.steps)).toBe(true);
    expect(parsed.steps.length).toBeGreaterThan(0);
  }, 30000);

  // Test 9: Backward compatibility — --semver=patch --branch=test --yes without new fields
  // Validates: Requirements 5.1
  test('backward compatibility — --semver=patch --branch=test --yes works as before', () => {
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
