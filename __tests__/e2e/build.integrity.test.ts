// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * E2E tests: Build artifact integrity.
 *
 * Verifies that `dist/version.js` produced by `esbuild.config.mjs` is a
 * valid, complete CLI binary ready for publishing. These tests catch build
 * regressions — missing externals, broken shebang, dead subcommands,
 * corrupted JSON output — before `npm publish`.
 */

import { execSync, spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import {
  createRepoFixture,
  cleanup,
} from '../helpers/repo-fixture';
import { CLI_PATH, PROJECT_ROOT, IS_PACKED } from '../helpers/cli-path';

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runCli(args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): RunResult {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: opts.cwd || PROJECT_ROOT,
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
});

afterEach(() => {
  cleanup(dirs);
  dirs = [];
});

// ─── Artifact structure ─────────────────────────────────────────────────

describe('E2E: build artifact structure', () => {
  test('dist/version.js exists', () => {
    expect(fs.existsSync(CLI_PATH)).toBe(true);
  }, 30000);

  test('dist/version.js starts with shebang', () => {
    const head = fs.readFileSync(CLI_PATH, 'utf8').slice(0, 64);
    expect(head).toMatch(/^#!\/usr\/bin\/env node/);
  }, 30000);

  test('dist/version.js has reasonable file size (>10KB, <5MB)', () => {
    const stat = fs.statSync(CLI_PATH);
    expect(stat.size).toBeGreaterThan(10 * 1024);
    expect(stat.size).toBeLessThan(5 * 1024 * 1024);
  }, 30000);

  test('dist/version.js is valid JavaScript (node --check)', () => {
    const result = spawnSync(process.execPath, ['--check', CLI_PATH], {
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(result.status).toBe(0);
  }, 30000);
});

// ─── Runtime externals resolution ───────────────────────────────────────

describe('E2E: external dependencies resolve at runtime', () => {
  /**
   * Running --help exercises the yargs dependency (command router).
   * If yargs is missing, this crashes with "Cannot find module".
   */
  test('yargs resolves — --help exits 0', () => {
    const { exitCode, stderr } = runCli(['--help']);
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain('Cannot find module');
  }, 30000);

  /**
   * Running validate --json in a proper fixture exercises ajv (config
   * validation) and js-yaml (YAML parser). If either is missing, the
   * process crashes with "Cannot find module".
   */
  test('ajv + js-yaml resolve — validate --json does not crash on missing module', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { exitCode, stderr } = runCli(['validate', '--json'], { cwd: repoDir });
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain('Cannot find module');
  }, 30000);
});

// ─── Subcommand availability ────────────────────────────────────────────

describe('E2E: all subcommands respond', () => {
  /**
   * Each subcommand must respond to --help with exit 0.
   * This proves the command router registered all subcommands and
   * their handler modules are bundled / resolvable.
   */
  test.each([
    'init',
    'validate',
    'plan',
    'release',
    'rollback',
    'doctor',
    'changelog',
  ])('subcommand %s --help → exit 0', (cmd) => {
    const { exitCode, stdout, stderr } = runCli([cmd, '--help']);
    expect(exitCode).toBe(0);
    const output = stdout + stderr;
    expect(output.length).toBeGreaterThan(0);
    expect(stderr).not.toContain('Cannot find module');
  }, 30000);
});

// ─── JSON output contract ───────────────────────────────────────────────

describe('E2E: JSON output contract after build', () => {
  test('--help outputs usage text with all subcommand names', () => {
    const { exitCode, stdout, stderr } = runCli(['--help']);
    expect(exitCode).toBe(0);
    const output = stdout + stderr;
    for (const cmd of ['init', 'validate', 'plan', 'release', 'rollback', 'doctor', 'changelog']) {
      expect(output).toContain(cmd);
    }
  }, 30000);

  test('validate --json produces valid JSON with checks array', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { exitCode, stdout } = runCli(['validate', '--json'], { cwd: repoDir });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.valid).toBe(true);
    expect(Array.isArray(parsed.checks)).toBe(true);
    // eslint-disable-next-line no-control-regex
    expect(stdout).not.toMatch(/\x1b\[/);
  }, 30000);

  test('doctor --json produces valid JSON checks array', () => {
    const { exitCode, stdout } = runCli(['doctor', '--json']);
    expect(exitCode).toBe(0);
    const lines = stdout.trim().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const checks = JSON.parse(lines[0]);
    expect(Array.isArray(checks)).toBe(true);
    expect(checks.length).toBeGreaterThan(0);
  }, 30000);

  test('--print-config --json produces valid JSON provenance', () => {
    const { exitCode, stdout } = runCli(['--print-config', '--json']);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    const keys = Object.keys(parsed);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(parsed[key]).toHaveProperty('value');
      expect(parsed[key]).toHaveProperty('source');
    }
  }, 30000);
});

// ─── Build config integrity ─────────────────────────────────────────────

describe('E2E: build config integrity', () => {
  test('esbuild.config.mjs exists', () => {
    const configPath = path.resolve(PROJECT_ROOT, 'esbuild.config.mjs');
    expect(fs.existsSync(configPath)).toBe(true);
  }, 30000);

  test('build.js shim exists and delegates to esbuild.config.mjs', () => {
    const shimPath = path.resolve(PROJECT_ROOT, 'build.js');
    expect(fs.existsSync(shimPath)).toBe(true);
    const content = fs.readFileSync(shimPath, 'utf8');
    expect(content).toContain('esbuild.config.mjs');
  }, 30000);

  test('npm run build succeeds', () => {
    const result = spawnSync('npm', ['run', 'build'], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      timeout: 30000,
    });
    expect(result.status).toBe(0);
    expect(fs.existsSync(CLI_PATH)).toBe(true);
  }, 30000);
});
