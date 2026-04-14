// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * E2E tests: npm pack integrity.
 *
 * Simulates what a user gets after `npm install -g versionings`:
 * 1. Builds the project
 * 2. Runs `npm pack` to create the tarball
 * 3. Extracts it into a temp directory
 * 4. Installs production dependencies
 * 5. Runs the CLI binary from the extracted package
 *
 * This catches issues invisible to normal E2E tests:
 * - Missing files in the `files` whitelist
 * - Broken shebang after pack/unpack
 * - Unresolvable runtime dependencies
 * - Corrupted bundle from minification
 */

import { execSync, spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import {
  createRepoFixture,
  cleanup,
} from '../helpers/repo-fixture';

const PROJECT_ROOT = path.resolve(__dirname, '../..');

let packDir: string;
let cliPath: string;
let dirs: string[] = [];

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runPackedCli(args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): RunResult {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: opts.cwd || packDir,
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

beforeAll(() => {
  // 1. Build
  execSync(`${process.execPath} build.js`, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    timeout: 30000,
  });

  // 2. Pack
  const packOutput = execSync('npm pack --json', {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    timeout: 30000,
  });
  const packInfo = JSON.parse(packOutput);
  const tarball = path.join(PROJECT_ROOT, packInfo[0].filename);

  // 3. Extract to temp dir
  packDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'versionings-pack-'));
  execSync(`tar xzf "${tarball}" -C "${packDir}"`, { encoding: 'utf8' });

  // npm pack extracts into a `package/` subdirectory
  packDir = path.join(packDir, 'package');

  // 4. Install production deps
  execSync('npm install --omit=dev --ignore-scripts', {
    cwd: packDir,
    encoding: 'utf8',
    timeout: 60000,
  });

  // 5. Resolve CLI path
  cliPath = path.join(packDir, 'out', 'dist', 'index.js');

  // Cleanup tarball
  fs.unlinkSync(tarball);
}, 120000);

afterAll(() => {
  // Clean up the extracted package directory
  if (packDir) {
    const parentDir = path.dirname(packDir);
    try {
      fs.rmSync(parentDir, { recursive: true, force: true });
    } catch (_) {
      // ignore
    }
  }
});

afterEach(() => {
  cleanup(dirs);
  dirs = [];
});

// ─── Package structure ──────────────────────────────────────────────────

describe('npm pack: package structure', () => {
  test('out/dist/index.js exists in package', () => {
    expect(fs.existsSync(cliPath)).toBe(true);
  });

  test('out/dist/index.js has shebang', () => {
    const head = fs.readFileSync(cliPath, 'utf8').slice(0, 64);
    expect(head).toMatch(/^#!\/usr\/bin\/env node/);
  });

  test('out/tsc/index.d.ts exists (type declarations)', () => {
    expect(fs.existsSync(path.join(packDir, 'out', 'tsc', 'index.d.ts'))).toBe(true);
  });

  test('LICENSE exists', () => {
    expect(fs.existsSync(path.join(packDir, 'LICENSE'))).toBe(true);
  });

  test('README.md exists', () => {
    expect(fs.existsSync(path.join(packDir, 'README.md'))).toBe(true);
  });

  test('src/ is NOT included (source excluded from package)', () => {
    expect(fs.existsSync(path.join(packDir, 'src'))).toBe(false);
  });

  test('__tests__/ is NOT included', () => {
    expect(fs.existsSync(path.join(packDir, '__tests__'))).toBe(false);
  });
});

// ─── CLI from packed binary ─────────────────────────────────────────────

describe('npm pack: CLI binary works from package', () => {
  test('--help exits 0 and lists all subcommands', () => {
    const { exitCode, stdout, stderr } = runPackedCli(['--help']);
    expect(exitCode).toBe(0);
    const output = stdout + stderr;
    for (const cmd of ['init', 'validate', 'plan', 'release', 'rollback', 'doctor', 'changelog']) {
      expect(output).toContain(cmd);
    }
  }, 30000);

  test('all subcommands respond to --help', () => {
    for (const cmd of ['init', 'validate', 'plan', 'release', 'rollback', 'doctor', 'changelog']) {
      const { exitCode, stderr } = runPackedCli([cmd, '--help']);
      expect(exitCode).toBe(0);
      expect(stderr).not.toContain('Cannot find module');
    }
  }, 30000);

  test('validate --json works against a real repo fixture', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { exitCode, stdout, stderr } = runPackedCli(['validate', '--json'], { cwd: repoDir });
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain('Cannot find module');

    const parsed = JSON.parse(stdout.trim());
    expect(parsed.valid).toBe(true);
    expect(Array.isArray(parsed.checks)).toBe(true);
  }, 30000);

  test('release --semver=patch works against a real repo fixture', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { exitCode, stdout } = runPackedCli(
      ['release', '--semver=patch', '--branch=test', '--yes', '--json'],
      { cwd: repoDir },
    );
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(stdout.trim());
    expect(parsed.success).toBe(true);
    expect(parsed.version).toBe('1.0.1');
  }, 30000);

  test('plan --json --semver=patch works (no mutations)', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);

    const { exitCode, stdout } = runPackedCli(
      ['plan', '--semver=patch', '--branch=test', '--json'],
      { cwd: repoDir },
    );
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(stdout.trim());
    expect(parsed.dryRun).toBe(true);
    expect(Array.isArray(parsed.steps)).toBe(true);
  }, 30000);
});
