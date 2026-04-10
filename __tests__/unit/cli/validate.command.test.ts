// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { PassThrough } from 'stream';
import { runValidateCommand, ValidateCommandDeps } from '../../../src/cli/commands/validate.command';
import type { Executor, ExecutorResult } from '../../../src/core/executor';
import type { Reporter, ValidateResult } from '../../../src/core/reporter';
import type { ConfigLoadResult } from '../../../src/config/config.loader';
import type { ConfigProvenance } from '../../../src/config/config.merger';
import { EXIT_CODES, VersioningsError } from '../../../src/core/errors';

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

describe('validate.command — branching strategy check', () => {
  test('returns branching_strategy pass with default when no git.branching configured', async () => {
    const deps = makeDeps();

    const result = await runValidateCommand({ json: false }, deps);

    const bsCheck = result.checks.find((c) => c.name === 'branching_strategy');
    expect(bsCheck).toBeDefined();
    expect(bsCheck!.status).toBe('pass');
    expect(bsCheck!.details).toContain('default');
    expect(bsCheck!.details).toContain('backward compatible');
  });

  test('returns branching_strategy pass with default when strategy is "default"', async () => {
    const configLoader = createMockConfigLoader(makeConfigLoadResult({
      config: {
        git: {
          platform: 'github',
          url: 'https://github.com/org/repo',
          pr: { target: 'main' },
          remote: 'origin',
          branchType: { version: 'version' },
          limits: { branchMaxCommentLength: 96 },
          commit: { message: { semver: {} } },
          branching: { strategy: 'default', mainBranch: 'master', developBranch: 'develop' },
        },
      } as any,
    }));
    const deps = makeDeps({ configLoader });

    const result = await runValidateCommand({ json: false }, deps);

    const bsCheck = result.checks.find((c) => c.name === 'branching_strategy');
    expect(bsCheck).toBeDefined();
    expect(bsCheck!.status).toBe('pass');
    expect(bsCheck!.details).toContain('default');
  });

  test('returns branching_strategy pass with details for trunk-based strategy', async () => {
    const configLoader = createMockConfigLoader(makeConfigLoadResult({
      config: {
        git: {
          platform: 'github',
          url: 'https://github.com/org/repo',
          pr: { target: 'main' },
          remote: 'origin',
          branchType: { version: 'version' },
          limits: { branchMaxCommentLength: 96 },
          commit: { message: { semver: {} } },
          branching: { strategy: 'trunk-based', mainBranch: 'main' },
        },
      } as any,
    }));
    const deps = makeDeps({ configLoader });

    const result = await runValidateCommand({ json: false }, deps);

    const bsCheck = result.checks.find((c) => c.name === 'branching_strategy');
    expect(bsCheck).toBeDefined();
    expect(bsCheck!.status).toBe('pass');
    expect(bsCheck!.details).toContain('trunk-based');
    expect(bsCheck!.details).toContain('mainBranch: main');
  });

  test('returns branching_strategy pass with all details for git-flow strategy', async () => {
    const configLoader = createMockConfigLoader(makeConfigLoadResult({
      config: {
        git: {
          platform: 'github',
          url: 'https://github.com/org/repo',
          pr: { target: 'main' },
          remote: 'origin',
          branchType: { version: 'version' },
          limits: { branchMaxCommentLength: 96 },
          commit: { message: { semver: {} } },
          branching: {
            strategy: 'git-flow',
            mainBranch: 'main',
            developBranch: 'develop',
            branchTemplate: 'release/{version}',
            tagTemplate: 'v{version}',
          },
        },
      } as any,
    }));
    const deps = makeDeps({ configLoader });

    const result = await runValidateCommand({ json: false }, deps);

    const bsCheck = result.checks.find((c) => c.name === 'branching_strategy');
    expect(bsCheck).toBeDefined();
    expect(bsCheck!.status).toBe('pass');
    expect(bsCheck!.details).toContain('git-flow');
    expect(bsCheck!.details).toContain('mainBranch: main');
    expect(bsCheck!.details).toContain('developBranch: develop');
    expect(bsCheck!.details).toContain('branchTemplate: release/{version}');
    expect(bsCheck!.details).toContain('tagTemplate: v{version}');
  });

  test('returns branching_strategy fail for unknown strategy', async () => {
    const configLoader = createMockConfigLoader(makeConfigLoadResult({
      config: {
        git: {
          platform: 'github',
          url: 'https://github.com/org/repo',
          pr: { target: 'main' },
          remote: 'origin',
          branchType: { version: 'version' },
          limits: { branchMaxCommentLength: 96 },
          commit: { message: { semver: {} } },
          branching: { strategy: 'unknown-strategy' },
        },
      } as any,
    }));
    const deps = makeDeps({ configLoader });

    const result = await runValidateCommand({ json: false }, deps);

    expect(result.valid).toBe(false);
    const bsCheck = result.checks.find((c) => c.name === 'branching_strategy');
    expect(bsCheck).toBeDefined();
    expect(bsCheck!.status).toBe('fail');
    expect(bsCheck!.details).toContain('Unknown branching strategy');
    expect(bsCheck!.details).toContain('unknown-strategy');
    expect(bsCheck!.details).toContain('trunk-based');
    expect(bsCheck!.details).toContain('git-flow');
  });

  test('does not include branching_strategy check when config fails to load', async () => {
    const configLoader = createMockConfigLoader(
      undefined,
      new VersioningsError(EXIT_CODES.CONFIG_ERROR, 'bad config', {}),
    );
    const deps = makeDeps({ configLoader });

    const result = await runValidateCommand({ json: false }, deps);

    const bsCheck = result.checks.find((c) => c.name === 'branching_strategy');
    expect(bsCheck).toBeUndefined();
  });
});

describe('validate.command — conventional_commits check', () => {
  test('returns pass with defaults when no conventionalCommits section', async () => {
    const deps = makeDeps();

    const result = await runValidateCommand({ json: false }, deps);

    const ccCheck = result.checks.find((c) => c.name === 'conventional_commits');
    expect(ccCheck).toBeDefined();
    expect(ccCheck!.status).toBe('pass');
    expect(ccCheck!.details).toContain('using defaults');
  });

  test('returns pass with details when conventionalCommits is configured', async () => {
    const configLoader = createMockConfigLoader(makeConfigLoadResult({
      config: {
        git: {
          platform: 'github',
          url: 'https://github.com/org/repo',
          pr: { target: 'main' },
          remote: 'origin',
          branchType: { version: 'version' },
          limits: { branchMaxCommentLength: 96 },
          commit: { message: { semver: {} } },
        },
        conventionalCommits: {
          enabled: true,
          types: { refactor: 'patch' },
          fallbackBump: 'patch',
        },
      } as any,
    }));
    const deps = makeDeps({ configLoader });

    const result = await runValidateCommand({ json: false }, deps);

    const ccCheck = result.checks.find((c) => c.name === 'conventional_commits');
    expect(ccCheck).toBeDefined();
    expect(ccCheck!.status).toBe('pass');
    expect(ccCheck!.details).toContain('enabled: true');
    expect(ccCheck!.details).toContain('refactor→patch');
    expect(ccCheck!.details).toContain('fallbackBump: patch');
  });

  test('returns warn when conventionalCommits.enabled is false', async () => {
    const configLoader = createMockConfigLoader(makeConfigLoadResult({
      config: {
        git: {
          platform: 'github',
          url: 'https://github.com/org/repo',
          pr: { target: 'main' },
          remote: 'origin',
          branchType: { version: 'version' },
          limits: { branchMaxCommentLength: 96 },
          commit: { message: { semver: {} } },
        },
        conventionalCommits: {
          enabled: false,
          types: {},
          fallbackBump: null,
        },
      } as any,
    }));
    const deps = makeDeps({ configLoader });

    const result = await runValidateCommand({ json: false }, deps);

    const ccCheck = result.checks.find((c) => c.name === 'conventional_commits');
    expect(ccCheck).toBeDefined();
    expect(ccCheck!.status).toBe('warn');
    expect(ccCheck!.details).toContain('enabled: false');
  });

  test('shows fallbackBump as none when null', async () => {
    const configLoader = createMockConfigLoader(makeConfigLoadResult({
      config: {
        git: {
          platform: 'github',
          url: 'https://github.com/org/repo',
          pr: { target: 'main' },
          remote: 'origin',
          branchType: { version: 'version' },
          limits: { branchMaxCommentLength: 96 },
          commit: { message: { semver: {} } },
        },
        conventionalCommits: {
          enabled: true,
          types: {},
          fallbackBump: null,
        },
      } as any,
    }));
    const deps = makeDeps({ configLoader });

    const result = await runValidateCommand({ json: false }, deps);

    const ccCheck = result.checks.find((c) => c.name === 'conventional_commits');
    expect(ccCheck).toBeDefined();
    expect(ccCheck!.details).toContain('fallbackBump: none');
  });

  test('does not include conventional_commits check when config fails to load', async () => {
    const configLoader = createMockConfigLoader(
      undefined,
      new VersioningsError(EXIT_CODES.CONFIG_ERROR, 'bad config', {}),
    );
    const deps = makeDeps({ configLoader });

    const result = await runValidateCommand({ json: false }, deps);

    const ccCheck = result.checks.find((c) => c.name === 'conventional_commits');
    expect(ccCheck).toBeUndefined();
  });
});

describe('validate.command — changelog_config check', () => {
  test('returns pass with "not configured" when no changelog section', async () => {
    const deps = makeDeps();

    const result = await runValidateCommand({ json: false }, deps);

    const clCheck = result.checks.find((c) => c.name === 'changelog_config');
    expect(clCheck).toBeDefined();
    expect(clCheck!.status).toBe('pass');
    expect(clCheck!.details).toContain('not configured');
  });

  test('returns pass with file path when changelog.file is set', async () => {
    const configLoader = createMockConfigLoader(makeConfigLoadResult({
      config: {
        git: {
          platform: 'github',
          url: 'https://github.com/org/repo',
          pr: { target: 'main' },
          remote: 'origin',
          branchType: { version: 'version' },
          limits: { branchMaxCommentLength: 96 },
          commit: { message: { semver: {} } },
        },
        changelog: {
          file: 'CHANGELOG.md',
          groupTitles: {},
          excludeTypes: [],
          includeNonConventional: false,
        },
      } as any,
    }));
    const deps = makeDeps({ configLoader });

    const result = await runValidateCommand({ json: false }, deps);

    const clCheck = result.checks.find((c) => c.name === 'changelog_config');
    expect(clCheck).toBeDefined();
    expect(clCheck!.status).toBe('pass');
    expect(clCheck!.details).toContain('file: CHANGELOG.md');
  });

  test('returns pass with custom groupTitles details', async () => {
    const configLoader = createMockConfigLoader(makeConfigLoadResult({
      config: {
        git: {
          platform: 'github',
          url: 'https://github.com/org/repo',
          pr: { target: 'main' },
          remote: 'origin',
          branchType: { version: 'version' },
          limits: { branchMaxCommentLength: 96 },
          commit: { message: { semver: {} } },
        },
        changelog: {
          groupTitles: { feat: 'New Features', fix: 'Bugfixes' },
          excludeTypes: [],
          includeNonConventional: false,
        },
      } as any,
    }));
    const deps = makeDeps({ configLoader });

    const result = await runValidateCommand({ json: false }, deps);

    const clCheck = result.checks.find((c) => c.name === 'changelog_config');
    expect(clCheck).toBeDefined();
    expect(clCheck!.status).toBe('pass');
    expect(clCheck!.details).toContain('custom groupTitles');
    expect(clCheck!.details).toContain('feat');
    expect(clCheck!.details).toContain('fix');
  });

  test('returns pass with excludeTypes details', async () => {
    const configLoader = createMockConfigLoader(makeConfigLoadResult({
      config: {
        git: {
          platform: 'github',
          url: 'https://github.com/org/repo',
          pr: { target: 'main' },
          remote: 'origin',
          branchType: { version: 'version' },
          limits: { branchMaxCommentLength: 96 },
          commit: { message: { semver: {} } },
        },
        changelog: {
          groupTitles: {},
          excludeTypes: ['chore', 'docs'],
          includeNonConventional: false,
        },
      } as any,
    }));
    const deps = makeDeps({ configLoader });

    const result = await runValidateCommand({ json: false }, deps);

    const clCheck = result.checks.find((c) => c.name === 'changelog_config');
    expect(clCheck).toBeDefined();
    expect(clCheck!.details).toContain('excludeTypes: chore, docs');
  });

  test('returns pass with includeNonConventional when true', async () => {
    const configLoader = createMockConfigLoader(makeConfigLoadResult({
      config: {
        git: {
          platform: 'github',
          url: 'https://github.com/org/repo',
          pr: { target: 'main' },
          remote: 'origin',
          branchType: { version: 'version' },
          limits: { branchMaxCommentLength: 96 },
          commit: { message: { semver: {} } },
        },
        changelog: {
          groupTitles: {},
          excludeTypes: [],
          includeNonConventional: true,
        },
      } as any,
    }));
    const deps = makeDeps({ configLoader });

    const result = await runValidateCommand({ json: false }, deps);

    const clCheck = result.checks.find((c) => c.name === 'changelog_config');
    expect(clCheck).toBeDefined();
    expect(clCheck!.details).toContain('includeNonConventional: true');
  });

  test('returns pass with "configured with defaults" when changelog section has only defaults', async () => {
    const configLoader = createMockConfigLoader(makeConfigLoadResult({
      config: {
        git: {
          platform: 'github',
          url: 'https://github.com/org/repo',
          pr: { target: 'main' },
          remote: 'origin',
          branchType: { version: 'version' },
          limits: { branchMaxCommentLength: 96 },
          commit: { message: { semver: {} } },
        },
        changelog: {
          groupTitles: {},
          excludeTypes: [],
          includeNonConventional: false,
        },
      } as any,
    }));
    const deps = makeDeps({ configLoader });

    const result = await runValidateCommand({ json: false }, deps);

    const clCheck = result.checks.find((c) => c.name === 'changelog_config');
    expect(clCheck).toBeDefined();
    expect(clCheck!.status).toBe('pass');
    expect(clCheck!.details).toContain('configured with defaults');
  });

  test('does not include changelog_config check when config fails to load', async () => {
    const configLoader = createMockConfigLoader(
      undefined,
      new VersioningsError(EXIT_CODES.CONFIG_ERROR, 'bad config', {}),
    );
    const deps = makeDeps({ configLoader });

    const result = await runValidateCommand({ json: false }, deps);

    const clCheck = result.checks.find((c) => c.name === 'changelog_config');
    expect(clCheck).toBeUndefined();
  });
});