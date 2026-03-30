/* Versioning automation tool, 2018-present */

/**
 * E2E tests: CLI as a child process.
 * Runs `node dist/version.js` with various arguments and checks exit codes and output.
 *
 * Validates: Requirements 1.4
 */

const { spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const CLI_PATH = path.resolve(__dirname, '../../dist/version.js');
const PROJECT_ROOT = path.resolve(__dirname, '../..');

/**
 * Runs the CLI with given arguments and returns { stdout, stderr, exitCode }.
 * @param {string[]} args - CLI arguments
 * @param {object} opts - options: cwd, env
 */
function runCli(args = [], opts = {}) {
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

beforeAll(() => {
  // Ensure the build artifact exists
  const buildResult = spawnSync(process.execPath, ['build.js'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    timeout: 30000,
  });

  if (buildResult.status !== 0) {
    throw new Error(
      `Build failed (exit ${buildResult.status}): ${buildResult.stderr}`,
    );
  }

  expect(fs.existsSync(CLI_PATH)).toBe(true);
});

describe('E2E: CLI exit codes and output', () => {
  test('no arguments — exits with non-zero code (yargs missing required options)', () => {
    const { exitCode, stderr: _stderr } = runCli([]);

    expect(exitCode).not.toBe(0);
    // yargs should mention the missing required options
    expect(_stderr).toMatch(/semver|branch|required|missing/i);
  });

  test('--help — exits with 0 and shows usage info', () => {
    const { exitCode, stdout } = runCli(['--help']);

    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/--semver/);
    expect(stdout).toMatch(/--branch/);
  });

  test('invalid semver value — exits with non-zero code', () => {
    const { exitCode } = runCli([
      '--semver=invalid',
      '--branch=test',
    ]);

    expect(exitCode).not.toBe(0);
    // Either yargs or pipeline validation catches this
    expect(exitCode).toBeGreaterThan(0);
  });

  test('missing version.json (temp dir) — exits with CONFIG_ERROR (1)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versionings-e2e-'));

    try {
      const { exitCode, stderr } = runCli(
        ['--semver=patch', '--branch=test'],
        { cwd: tmpDir },
      );

      expect(exitCode).toBe(1); // CONFIG_ERROR
      expect(stderr).toMatch(/version\.json|config/i);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('--json flag with error — outputs valid JSON to stderr', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versionings-e2e-'));

    try {
      const { exitCode, stderr } = runCli(
        ['--semver=patch', '--branch=test', '--json'],
        { cwd: tmpDir },
      );

      expect(exitCode).not.toBe(0);

      // In --json mode, error output should be valid JSON in stderr
      const parsed = JSON.parse(stderr.trim());
      expect(parsed.success).toBe(false);
      expect(typeof parsed.exitCode).toBe('number');
      expect(parsed.error).toBeDefined();
      expect(typeof parsed.error.code).toBe('string');
      expect(typeof parsed.error.message).toBe('string');
      // No ANSI escape sequences in JSON output
      // eslint-disable-next-line no-control-regex
      expect(stderr).not.toMatch(/\x1b\[/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
