// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * E2E tests: SCM platform matrix and missing semver type coverage.
 *
 * Platform tests validate that each supported SCM platform is accepted
 * by the CLI, appears in plan --json output, and that invalid platforms
 * produce CONFIG_ERROR (exit 1). Platforms requiring apiUrl are tested
 * with that field present.
 *
 * Semver tests cover major, premajor, preminor, and prerelease types
 * with the default branching strategy, verifying version bump, branch
 * naming, tag naming, and JSON output contract.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */

import { execSync, spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import {
  createRepoFixtureWithStrategy,
  createRepoFixture,
  snapshotRepoState,
  cleanup,
  git,
} from '../helpers/repo-fixture';
import { CLI_PATH, PROJECT_ROOT, IS_PACKED } from '../helpers/cli-path';

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
  if (!IS_PACKED) {
    execSync(`${process.execPath} build.js`, {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      timeout: 30000,
    });
  }
  expect(fs.existsSync(CLI_PATH)).toBe(true);
});

afterEach(() => {
  cleanup(dirs);
  dirs = [];
});

// ─── SCM Platform matrix ────────────────────────────────────────────────

describe('E2E: SCM platform matrix', () => {
  /**
   * Each supported platform should pass validation when configured
   * in version.json with the default branching strategy.
   *
   * Validates: Requirement 4.1
   */
  test.each([
    'github-enterprise',
    'bitbucket',
    'bitbucket-server',
    'gitlab',
    'azure-devops',
  ])('validate with platform %s → exit 0', (platform) => {
    const opts: any = { strategy: 'default', platform };
    // Platforms that require apiUrl
    if (['github-enterprise', 'bitbucket-server', 'gitlab'].includes(platform)) {
      opts.apiUrl = `https://${platform}.example.com/api/v3`;
    }
    const { repoDir, remoteDir } = createRepoFixtureWithStrategy(opts);
    dirs.push(repoDir, remoteDir);

    const { exitCode } = runCli(['validate'], { cwd: repoDir });
    expect(exitCode).toBe(0);
  }, 30000);

  /**
   * Each supported platform should appear in plan --push --json output
   * under the pullRequest.platform field.
   *
   * Validates: Requirement 4.2
   */
  test.each([
    'github-enterprise',
    'bitbucket',
    'bitbucket-server',
    'gitlab',
    'azure-devops',
  ])('plan --push --json with platform %s → platform in output', (platform) => {
    const opts: any = { strategy: 'default', platform };
    if (['github-enterprise', 'bitbucket-server', 'gitlab'].includes(platform)) {
      opts.apiUrl = `https://${platform}.example.com/api/v3`;
    }
    const { repoDir, remoteDir } = createRepoFixtureWithStrategy(opts);
    dirs.push(repoDir, remoteDir);

    const { stdout, exitCode } = runCli(
      ['plan', '--semver=patch', '--branch=test', '--push', '--json'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    // On some CI runners (Node 18 + macOS ARM64), child_process stdout
    // may not be fully flushed before exit. Guard against empty output.
    expect(stdout.trim().length).toBeGreaterThan(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.dryRun).toBe(true);
    expect(parsed.pullRequest).toBeDefined();
    expect(parsed.pullRequest.platform).toBe(platform);
  }, 30000);

  /**
   * Invalid platform value in version.json should produce CONFIG_ERROR
   * (exit code 1).
   *
   * Validates: Requirement 4.4
   */
  test('invalid platform → exit 1 (CONFIG_ERROR)', () => {
    const { repoDir, remoteDir, remoteUrl } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    // Overwrite version.json with an invalid platform
    const versionJson = { git: { platform: 'nonexistent-platform', url: remoteUrl } };
    fs.writeFileSync(
      path.join(repoDir, 'version.json'),
      JSON.stringify(versionJson, null, 2) + '\n',
    );
    git(repoDir, 'add version.json');
    git(repoDir, 'commit -m "set invalid platform"');

    const { exitCode } = runCli(['validate'], { cwd: repoDir });
    expect(exitCode).toBe(1);
  }, 30000);

  /**
   * Platforms that support apiUrl should pass validation when apiUrl
   * is explicitly configured.
   *
   * Validates: Requirement 4.3
   */
  test.each([
    ['github-enterprise', 'https://github.example.com/api/v3'],
    ['bitbucket-server', 'https://bitbucket.example.com/rest/api/1.0'],
    ['gitlab', 'https://gitlab.example.com/api/v4'],
  ])('validate with platform %s and apiUrl → exit 0', (platform, apiUrl) => {
    const { repoDir, remoteDir } = createRepoFixtureWithStrategy({
      strategy: 'default',
      platform,
      apiUrl,
    });
    dirs.push(repoDir, remoteDir);

    const { exitCode } = runCli(['validate'], { cwd: repoDir });
    expect(exitCode).toBe(0);
  }, 30000);
});

// ─── Missing semver types ───────────────────────────────────────────────

describe('E2E: Missing semver types (default strategy)', () => {
  /**
   * --semver=major bumps 1.0.0 → 2.0.0 with default strategy naming:
   * branch version/major/2.0.0/{comment}, tag 2.0.0--{comment}.
   *
   * Validates: Requirements 5.1, 5.6
   */
  test('--semver=major → version 2.0.0, correct branch and tag', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { stdout, exitCode } = runCli(
      ['release', '--semver=major', '--branch=breaking', '--yes'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain('2.0.0');

    const state = snapshotRepoState(repoDir);
    expect(state.version).toBe('2.0.0');
    expect(state.branches).toContain('version/major/2.0.0/breaking');
    expect(state.tags).toContain('2.0.0--breaking');
  }, 30000);

  /**
   * --semver=major with --json → JSON contract with success, version,
   * branch, and tag fields.
   *
   * Validates: Requirements 5.1, 5.5
   */
  test('--semver=major --json → JSON with success, version, branch, tag', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { stdout, exitCode } = runCli(
      ['release', '--semver=major', '--branch=breaking', '--yes', '--json'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.success).toBe(true);
    expect(parsed.version).toBe('2.0.0');
    expect(parsed.branch).toContain('version/major/2.0.0/breaking');
    expect(parsed.tag).toBe('2.0.0--breaking');
  }, 30000);

  /**
   * --semver=premajor --preid=alpha bumps 1.0.0 → 2.0.0-alpha.0.
   *
   * Validates: Requirements 5.2, 5.6
   */
  test('--semver=premajor --preid=alpha → version 2.0.0-alpha.0, correct branch and tag', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { stdout, exitCode } = runCli(
      ['release', '--semver=premajor', '--preid=alpha', '--branch=next', '--yes'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain('2.0.0-alpha.0');

    const state = snapshotRepoState(repoDir);
    expect(state.version).toBe('2.0.0-alpha.0');
    expect(state.branches).toContain('version/premajor/2.0.0-alpha.0/next');
    expect(state.tags).toContain('2.0.0-alpha.0--next');
  }, 30000);

  /**
   * --semver=premajor --preid=alpha with --json → JSON contract.
   *
   * Validates: Requirements 5.2, 5.5
   */
  test('--semver=premajor --preid=alpha --json → JSON with success, version, branch, tag', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { stdout, exitCode } = runCli(
      ['release', '--semver=premajor', '--preid=alpha', '--branch=next', '--yes', '--json'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.success).toBe(true);
    expect(parsed.version).toBe('2.0.0-alpha.0');
    expect(parsed.branch).toContain('version/premajor/2.0.0-alpha.0/next');
    expect(parsed.tag).toBe('2.0.0-alpha.0--next');
  }, 30000);

  /**
   * --semver=preminor --preid=beta bumps 1.0.0 → 1.1.0-beta.0.
   *
   * Validates: Requirements 5.3, 5.6
   */
  test('--semver=preminor --preid=beta → version 1.1.0-beta.0, correct branch and tag', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { stdout, exitCode } = runCli(
      ['release', '--semver=preminor', '--preid=beta', '--branch=feat', '--yes'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain('1.1.0-beta.0');

    const state = snapshotRepoState(repoDir);
    expect(state.version).toBe('1.1.0-beta.0');
    expect(state.branches).toContain('version/preminor/1.1.0-beta.0/feat');
    expect(state.tags).toContain('1.1.0-beta.0--feat');
  }, 30000);

  /**
   * --semver=preminor --preid=beta with --json → JSON contract.
   *
   * Validates: Requirements 5.3, 5.5
   */
  test('--semver=preminor --preid=beta --json → JSON with success, version, branch, tag', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { stdout, exitCode } = runCli(
      ['release', '--semver=preminor', '--preid=beta', '--branch=feat', '--yes', '--json'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.success).toBe(true);
    expect(parsed.version).toBe('1.1.0-beta.0');
    expect(parsed.branch).toContain('version/preminor/1.1.0-beta.0/feat');
    expect(parsed.tag).toBe('1.1.0-beta.0--feat');
  }, 30000);

  /**
   * --semver=prerelease --preid=rc bumps 1.0.0 → 1.0.1-rc.0.
   *
   * Validates: Requirements 5.4, 5.6
   */
  test('--semver=prerelease --preid=rc → version 1.0.1-rc.0, correct branch and tag', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { stdout, exitCode } = runCli(
      ['release', '--semver=prerelease', '--preid=rc', '--branch=rc', '--yes'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain('1.0.1-rc.0');

    const state = snapshotRepoState(repoDir);
    expect(state.version).toBe('1.0.1-rc.0');
    expect(state.branches).toContain('version/prerelease/1.0.1-rc.0/rc');
    expect(state.tags).toContain('1.0.1-rc.0--rc');
  }, 30000);

  /**
   * --semver=prerelease --preid=rc with --json → JSON contract.
   *
   * Validates: Requirements 5.4, 5.5
   */
  test('--semver=prerelease --preid=rc --json → JSON with success, version, branch, tag', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { stdout, exitCode } = runCli(
      ['release', '--semver=prerelease', '--preid=rc', '--branch=rc', '--yes', '--json'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.success).toBe(true);
    expect(parsed.version).toBe('1.0.1-rc.0');
    expect(parsed.branch).toContain('version/prerelease/1.0.1-rc.0/rc');
    expect(parsed.tag).toBe('1.0.1-rc.0--rc');
  }, 30000);
});
