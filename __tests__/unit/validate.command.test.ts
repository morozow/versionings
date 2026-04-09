// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { PassThrough } from 'stream';
import { runValidateCommand, ValidateCommandDeps } from '../../validate.command';
import type { Executor, ExecutorResult } from '../../executor';
import type { Reporter, ValidateResult } from '../../reporter';
import type { ConfigLoadResult } from '../../config.loader';
import type { ConfigProvenance } from '../../config.merger';
import { EXIT_CODES, VersioningsError } from '../../errors';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfigLoadResult(overrides: Partial<ConfigLoadResult> = {}): ConfigLoadResult {
  return {
    config: {
      git: {
        platform: 'github',
        url: 'https://github.com/org/repo',
        pr: { target: 'main' },
        remote: 'origin',
        branchType: { version: 'version' },
        limits: { branchMaxCommentLength: 96 },
        commit: {
          message: {
            semver: {
              prepatch: 'Patch version is preparing now: v%s.',
              patch: 'Patch: v%s.',
              preminor: 'Minor version is preparing now: v%s.',
              minor: 'Minor: v%s.',
              premajor: 'Release is preparing now: v%s.',
              major: 'Release: v%s.',
              prerelease: 'Preparing: v%s.',
            },
          },
        },
      },
    } as any,
    sources: [
      { name: 'defaults', data: {} },
      { name: 'version.json', data: { git: { platform: 'github' } }, filePath: '/tmp/version.json' },
    ],
    provenance: {
      'git.platform': { value: 'github', source: 'version.json' },
      'git.url': { value: 'https://github.com/org/repo', source: 'version.json' },
      'git.pr.target': { value: 'main', source: 'defaults' },
      'git.remote': { value: 'origin', source: 'defaults' },
    },
    warnings: [],
    ...overrides,
  };
}

function createMockConfigLoader(result?: ConfigLoadResult, error?: Error) {
  return jest.fn((_deps: any) => {
    if (error) throw error;
    return result ?? makeConfigLoadResult();
  });
}

function createMockExecutor(overrides: Record<string, string | Error> = {}): Executor {
  const defaults: Record<string, string> = {
    'git rev-parse --is-inside-work-tree': 'true',
    'git remote get-url origin': 'https://github.com/org/repo',
  };

  return {
    run: jest.fn(async (cmd: string): Promise<ExecutorResult> => {
      const val = overrides[cmd] ?? defaults[cmd];
      if (val instanceof Error) throw val;
      if (val !== undefined) {
        const s = val as string;
        return { stdout: s, lines: s.split('\n').filter(Boolean) };
      }
      throw new VersioningsError(EXIT_CODES.COMMAND_FAILED, `Unknown cmd: ${cmd}`, {});
    }),
  };
}

function createMockReporter(): Reporter {
  return {
    reportSuccess: jest.fn(() => ''),
    reportError: jest.fn(() => ''),
    reportDryRun: jest.fn(() => ''),
    reportValidation: jest.fn((r: ValidateResult) => JSON.stringify(r)),
    reportDoctor: jest.fn(() => ''),
    reportProvenance: jest.fn(() => ''),
    reportConfirmPlan: jest.fn(() => ''),
  };
}

function makeDeps(overrides: Partial<ValidateCommandDeps> = {}): ValidateCommandDeps & { stdout: PassThrough } {
  const stdout = new PassThrough();
  stdout.setEncoding('utf8');

  return {
    configLoader: overrides.configLoader ?? createMockConfigLoader(),
    executor: overrides.executor ?? createMockExecutor(),
    reporter: overrides.reporter ?? createMockReporter(),
    cwd: overrides.cwd ?? '/tmp/test-project',
    env: overrides.env ?? {},
    stdout: overrides.stdout as any ?? stdout,
  };
}

function drainStdout(stdout: PassThrough): string {
  let output = '';
  let chunk: string | null;
  while ((chunk = stdout.read() as string | null) !== null) {
    output += chunk;
  }
  return output;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validate.command — all checks passed', () => {
  test('returns valid=true when config, git repo, and git remote all pass', async () => {
    const deps = makeDeps();

    const result = await runValidateCommand({ json: false }, deps);

    expect(result.valid).toBe(true);
    expect(result.checks.some((c) => c.name === 'config_exists' && c.status === 'pass')).toBe(true);
    expect(result.checks.some((c) => c.name === 'config_valid' && c.status === 'pass')).toBe(true);
    expect(result.checks.some((c) => c.name === 'git_repo' && c.status === 'pass')).toBe(true);
    expect(result.checks.some((c) => c.name === 'git_remote' && c.status === 'pass')).toBe(true);
  });

  test('calls configLoader with cwd and env from deps', async () => {
    const configLoader = createMockConfigLoader();
    const deps = makeDeps({ configLoader, env: { FOO: 'bar' } });

    await runValidateCommand({ json: false }, deps);

    expect(configLoader).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/tmp/test-project', env: { FOO: 'bar' } }),
    );
  });

  test('writes reporter output to stdout', async () => {
    const reporter = createMockReporter();
    const deps = makeDeps({ reporter });

    await runValidateCommand({ json: false }, deps);

    expect(reporter.reportValidation).toHaveBeenCalledTimes(1);
    const output = drainStdout(deps.stdout);
    expect(output.length).toBeGreaterThan(0);
  });
});

describe('validate.command — config invalid', () => {
  test('returns valid=false when configLoader throws VersioningsError', async () => {
    const configLoader = createMockConfigLoader(
      undefined,
      new VersioningsError(EXIT_CODES.CONFIG_ERROR, 'Configuration does not match schema.', {
        validationErrors: [{ path: '/git/platform', message: 'must be string' }],
      }),
    );
    const deps = makeDeps({ configLoader });

    const result = await runValidateCommand({ json: false }, deps);

    expect(result.valid).toBe(false);
    expect(result.checks.some((c) => c.name === 'config_exists' && c.status === 'fail')).toBe(true);
  });

  test('includes error message in check details', async () => {
    const msg = 'Configuration does not match schema.';
    const configLoader = createMockConfigLoader(
      undefined,
      new VersioningsError(EXIT_CODES.CONFIG_ERROR, msg, {}),
    );
    const deps = makeDeps({ configLoader });

    const result = await runValidateCommand({ json: false }, deps);

    const failCheck = result.checks.find((c) => c.status === 'fail');
    expect(failCheck).toBeDefined();
    expect(failCheck!.details).toContain(msg);
  });
});

describe('validate.command — git remote inaccessible', () => {
  test('returns warn when git repo is not accessible', async () => {
    const executor = createMockExecutor({
      'git rev-parse --is-inside-work-tree': new VersioningsError(
        EXIT_CODES.COMMAND_FAILED, 'not a git repo', {},
      ) as any,
    });
    const deps = makeDeps({ executor });

    const result = await runValidateCommand({ json: false }, deps);

    expect(result.checks.some((c) => c.name === 'git_repo' && c.status === 'fail')).toBe(true);
    // git_remote should be skipped/warn when repo is inaccessible
    expect(result.checks.some((c) => c.name === 'git_remote' && c.status === 'warn')).toBe(true);
  });

  test('returns warn when git remote get-url fails', async () => {
    const executor = createMockExecutor({
      'git remote get-url origin': new VersioningsError(
        EXIT_CODES.COMMAND_FAILED, 'no remote', {},
      ) as any,
    });
    const deps = makeDeps({ executor });

    const result = await runValidateCommand({ json: false }, deps);

    expect(result.checks.some((c) => c.name === 'git_remote' && c.status === 'warn')).toBe(true);
  });

  test('returns fail when git remote URL does not match config', async () => {
    const executor = createMockExecutor({
      'git remote get-url origin': 'https://github.com/other/repo',
    });
    const deps = makeDeps({ executor });

    const result = await runValidateCommand({ json: false }, deps);

    expect(result.checks.some((c) => c.name === 'git_remote' && c.status === 'fail')).toBe(true);
  });
});

describe('validate.command — JSON output', () => {
  test('passes json option through to reporter', async () => {
    const reporter = createMockReporter();
    const deps = makeDeps({ reporter });

    await runValidateCommand({ json: true }, deps);

    expect(reporter.reportValidation).toHaveBeenCalledWith(
      expect.objectContaining({ valid: true }),
    );
  });

  test('result structure matches ValidateResult shape', async () => {
    const deps = makeDeps();

    const result = await runValidateCommand({ json: true }, deps);

    expect(result).toHaveProperty('valid');
    expect(result).toHaveProperty('checks');
    expect(result).toHaveProperty('provenance');
    expect(Array.isArray(result.checks)).toBe(true);
  });
});

describe('validate.command — provenance in output', () => {
  test('includes provenance from configLoader in result', async () => {
    const provenance: ConfigProvenance = {
      'git.platform': { value: 'github', source: 'env' },
      'git.url': { value: 'https://github.com/org/repo', source: '.versioningsrc' },
    };
    const configLoader = createMockConfigLoader(makeConfigLoadResult({ provenance }));
    const deps = makeDeps({ configLoader });

    const result = await runValidateCommand({ json: false }, deps);

    expect(result.provenance).toEqual(provenance);
    expect(result.provenance['git.platform'].source).toBe('env');
    expect(result.provenance['git.url'].source).toBe('.versioningsrc');
  });

  test('provenance is empty when configLoader fails', async () => {
    const configLoader = createMockConfigLoader(
      undefined,
      new VersioningsError(EXIT_CODES.CONFIG_ERROR, 'bad config', {}),
    );
    const deps = makeDeps({ configLoader });

    const result = await runValidateCommand({ json: false }, deps);

    expect(result.provenance).toEqual({});
  });

  test('reporter receives provenance in ValidateResult', async () => {
    const provenance: ConfigProvenance = {
      'git.platform': { value: 'bitbucket', source: 'cli' },
    };
    const configLoader = createMockConfigLoader(makeConfigLoadResult({ provenance }));
    const reporter = createMockReporter();
    const deps = makeDeps({ configLoader, reporter });

    await runValidateCommand({ json: false }, deps);

    expect(reporter.reportValidation).toHaveBeenCalledWith(
      expect.objectContaining({
        provenance: expect.objectContaining({
          'git.platform': { value: 'bitbucket', source: 'cli' },
        }),
      }),
    );
  });
});
