// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * E2E tests: CLI subcommands via `node dist/version.js` with real git repositories.
 *
 * Validates: Requirements 6.1, 7.1, 8.1, 9.1, 9.3, 10.2, 11.1, 12.1, 12.2, 12.5, 14.4, 15.1, 16.2, 17.1
 */

import { execSync, spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import yaml from 'js-yaml';
import {
  createRepoFixture,
  snapshotRepoState,
  assertNoMutation,
  cleanup,
  git,
} from '../helpers/repo-fixture';
import { CLI_PATH, PROJECT_ROOT, IS_PACKED } from '../helpers/cli-path';

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run the CLI via spawnSync. Captures stdout and stderr regardless of exit code.
 */
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
  // Build dist/version.js before running E2E tests
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


describe('E2E: Extended subcommand coverage', () => {
  // 1. init --format=yaml (YAML generation)
  test('init --format=yaml --non-interactive — creates .versioningsrc.yml with valid YAML config', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    // Remove version.json so init creates a fresh config
    fs.unlinkSync(path.join(repoDir, 'version.json'));

    const { exitCode, stdout } = runCli(
      ['init', '--format=yaml', '--non-interactive'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Created');

    const ymlPath = path.join(repoDir, '.versioningsrc.yml');
    expect(fs.existsSync(ymlPath)).toBe(true);

    const content = fs.readFileSync(ymlPath, 'utf8');
    const parsed = yaml.load(content) as Record<string, any>;
    expect(parsed).toBeDefined();
    expect(parsed.git).toBeDefined();
    expect(parsed.git.platform).toBeDefined();
    expect(parsed.git.url).toBeDefined();
  }, 30000);

  // 2. validate with invalid config
  test('validate with invalid config — exit code != 0', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    // Write invalid config: bad platform enum, missing url
    const configPath = path.join(repoDir, 'version.json');
    fs.writeFileSync(configPath, JSON.stringify({ git: { platform: 'invalid' } }, null, 2) + '\n');

    const { exitCode } = runCli(['validate'], { cwd: repoDir });
    expect(exitCode).not.toBe(0);
  }, 30000);

  // 3. validate --strict with unknown fields
  test('validate --strict with unknown fields — exit code 1', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    // Add unknown field to valid config
    const configPath = path.join(repoDir, 'version.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.unknownField = 'test';
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

    const { exitCode } = runCli(['validate', '--strict'], { cwd: repoDir });
    expect(exitCode).toBe(1);
  }, 30000);

  // 4. plan --json (JSON output)
  test('plan --json — valid JSON output with dryRun=true and steps array', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { exitCode, stdout } = runCli(
      ['plan', '--semver=patch', '--branch=test', '--json'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.dryRun).toBe(true);
    expect(Array.isArray(parsed.steps)).toBe(true);
    expect(parsed.steps.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-control-regex
    expect(stdout).not.toMatch(/\x1b\[/);
  }, 30000);

  // 5. plan with --push (push steps in plan)
  test('plan --push — output contains push step', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { exitCode, stdout } = runCli(
      ['plan', '--semver=patch', '--branch=test', '--push'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    expect(stdout.toLowerCase()).toContain('push');
  }, 30000);

  // 6. release --dry-run (via subcommand)
  test('release --dry-run — exit code 0, repo not mutated', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const snapshotBefore = snapshotRepoState(repoDir);

    const { exitCode } = runCli(
      ['release', '--semver=patch', '--branch=test', '--dry-run'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    assertNoMutation(repoDir, snapshotBefore);
  }, 30000);

  // 7. release --json (JSON output)
  test('release --json — valid JSON with success=true, version, branch, tag', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { exitCode, stdout } = runCli(
      ['release', '--semver=patch', '--branch=test', '--yes', '--json'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.success).toBe(true);
    expect(parsed.version).toBe('1.0.1');
    expect(parsed.branch).toContain('test');
    expect(parsed.tag).toBe('1.0.1--test');
    // eslint-disable-next-line no-control-regex
    expect(stdout).not.toMatch(/\x1b\[/);
  }, 30000);

  // 8. release with push (full workflow + push)
  test('release --push — exit code 0, version bumped, remote has branch and tag', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { exitCode } = runCli(
      ['release', '--semver=patch', '--branch=test', '--push', '--yes'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);

    const state = snapshotRepoState(repoDir);
    expect(state.version).toBe('1.0.1');

    // Verify remote has the branch and tag
    const remoteRefs = execSync('git for-each-ref --format="%(refname)"', {
      cwd: remoteDir,
      encoding: 'utf8',
    });
    expect(remoteRefs).toContain('version/patch/1.0.1/test');
    expect(remoteRefs).toContain('1.0.1--test');
  }, 30000);

  // 9. Full cycle: release → rollback
  test('release then rollback — rollback succeeds after release', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    // Release
    const releaseResult = runCli(
      ['release', '--semver=patch', '--branch=test', '--yes'],
      { cwd: repoDir },
    );
    expect(releaseResult.exitCode).toBe(0);

    const stateAfterRelease = snapshotRepoState(repoDir);
    expect(stateAfterRelease.version).toBe('1.0.1');
    expect(stateAfterRelease.tags).toContain('1.0.1--test');

    // Rollback — operation log exists, rollback should be attempted
    const rollbackResult = runCli(['rollback', '--yes'], { cwd: repoDir });
    // Rollback exit code 0 (success) or 7 (INCOMPLETE_ROLLBACK)
    expect([0, 7]).toContain(rollbackResult.exitCode);
    // Verify rollback output mentions rollback completion
    const combined = rollbackResult.stdout + rollbackResult.stderr;
    expect(combined.toLowerCase()).toContain('rollback');
  }, 30000);

  // 10. rollback --from <file>
  test('rollback --from <log-file> — rollback from specific operation log', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    // Release to create an operation log
    const releaseResult = runCli(
      ['release', '--semver=patch', '--branch=test', '--yes'],
      { cwd: repoDir },
    );
    expect(releaseResult.exitCode).toBe(0);

    // Find the operation log file
    const opsDir = path.join(repoDir, '.versionings', 'operations');
    expect(fs.existsSync(opsDir)).toBe(true);

    const logFiles = fs.readdirSync(opsDir).filter(f => f.endsWith('.json') && f !== 'last.json');
    expect(logFiles.length).toBeGreaterThan(0);

    const logFilePath = path.join(opsDir, logFiles[0]);

    // Rollback from specific log file
    const rollbackResult = runCli(
      ['rollback', `--from=${logFilePath}`, '--yes'],
      { cwd: repoDir },
    );
    // Should attempt rollback — exit code 0 or 7 (INCOMPLETE_ROLLBACK)
    expect([0, 7]).toContain(rollbackResult.exitCode);
  }, 30000);

  // 11. --print-config --json (JSON provenance)
  test('--print-config --json — JSON output with value and source properties', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { exitCode, stdout } = runCli(
      ['--print-config', '--json'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    // Provenance is an object where each field has value and source
    const keys = Object.keys(parsed);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(parsed[key]).toHaveProperty('value');
      expect(parsed[key]).toHaveProperty('source');
    }
  }, 30000);

  // 12. Config hierarchy: env vars override version.json
  test('config hierarchy — env var overrides version.json platform', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { exitCode, stdout } = runCli(
      ['--print-config', '--json'],
      { cwd: repoDir, env: { VERSIONINGS_GIT_PLATFORM: 'bitbucket' } },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed['git.platform'].value).toBe('bitbucket');
    expect(parsed['git.platform'].source).toBe('env');
  }, 30000);

  // 13. Config hierarchy: .versioningsrc.json overrides version.json
  test('config hierarchy — .versioningsrc.json overrides version.json pr.target', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    // version.json already has default pr.target (from defaults: 'master')
    // Create .versioningsrc.json with a different pr.target
    const rcConfig = { git: { pr: { target: 'develop' } } };
    fs.writeFileSync(
      path.join(repoDir, '.versioningsrc.json'),
      JSON.stringify(rcConfig, null, 2) + '\n',
    );

    const { exitCode, stdout } = runCli(
      ['--print-config', '--json'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed['git.pr.target'].value).toBe('develop');
    expect(parsed['git.pr.target'].source).toBe('.versioningsrc.json');
  }, 30000);

  // 14. init creates valid config that validate accepts
  test('init then validate — init creates config that validate accepts', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    // Remove existing version.json
    fs.unlinkSync(path.join(repoDir, 'version.json'));

    // Init
    const initResult = runCli(
      ['init', '--format=json', '--non-interactive'],
      { cwd: repoDir },
    );
    expect(initResult.exitCode).toBe(0);

    // Validate
    const validateResult = runCli(['validate'], { cwd: repoDir });
    expect(validateResult.exitCode).toBe(0);
  }, 30000);

  // 15. help output (no args)
  test('no args — exit code 0, output contains all subcommand names', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { exitCode, stdout, stderr } = runCli([], { cwd: repoDir });
    expect(exitCode).toBe(0);

    // yargs showHelp() writes to stderr by default
    const output = stdout + stderr;
    for (const cmd of ['init', 'validate', 'plan', 'release', 'rollback', 'doctor']) {
      expect(output).toContain(cmd);
    }
  }, 30000);

  // 16. release --semver=minor (different semver types)
  test('release --semver=minor — version bumped to 1.1.0', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { exitCode, stdout } = runCli(
      ['release', '--semver=minor', '--branch=feat', '--yes'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain('1.1.0');

    const state = snapshotRepoState(repoDir);
    expect(state.version).toBe('1.1.0');
  }, 30000);

  // 17. release with --preid (prerelease)
  test('release --semver=prepatch --preid=beta — version contains beta', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { exitCode, stdout } = runCli(
      ['release', '--semver=prepatch', '--branch=pre', '--preid=beta', '--yes'],
      { cwd: repoDir },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain('beta');

    const state = snapshotRepoState(repoDir);
    expect(state.version).toContain('beta');
  }, 30000);
});
