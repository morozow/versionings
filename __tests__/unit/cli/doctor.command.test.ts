// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { PassThrough } from 'stream';
import { runDoctorCommand, DoctorCommandDeps } from '../../../src/cli/commands/doctor.command';
import type { Executor, ExecutorResult } from '../../../src/core/executor';
import type { Reporter, DoctorCheck } from '../../../src/core/reporter';
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
    'git --version': 'git version 2.43.0',
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
    reportValidation: jest.fn(() => ''),
    reportDoctor: jest.fn((checks: DoctorCheck[]) => JSON.stringify(checks)),
    reportProvenance: jest.fn((p: ConfigProvenance) => JSON.stringify(p)),
    reportConfirmPlan: jest.fn(() => ''),
  };
}

function makeDeps(overrides: Partial<DoctorCommandDeps> = {}): DoctorCommandDeps & { stdout: PassThrough } {
  const stdout = new PassThrough();
  stdout.setEncoding('utf8');

  // Default existsSync: returns true for most paths, false for lock file
  const defaultExistsSync = (p: string): boolean => !p.endsWith('/lock');

  return {
    configLoader: overrides.configLoader ?? createMockConfigLoader(),
    executor: overrides.executor ?? createMockExecutor(),
    reporter: overrides.reporter ?? createMockReporter(),
    cwd: overrides.cwd ?? '/tmp/test-project',
    env: overrides.env ?? {},
    stdout: overrides.stdout as any ?? stdout,
    existsSync: overrides.existsSync ?? defaultExistsSync,
    nodeVersion: overrides.nodeVersion ?? 'v20.10.0',
    readFileSync: overrides.readFileSync ?? (() => { throw new Error('ENOENT'); }),
    readdirSync: overrides.readdirSync ?? (() => []),
    processKill: overrides.processKill ?? (() => true),
    now: overrides.now ?? (() => Date.now()),
    lockTimeoutMs: overrides.lockTimeoutMs ?? 300000,
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

describe('doctor.command — all checks pass', () => {
  test('returns all checks with pass status when environment is healthy', async () => {
    const executor = createMockExecutor({
      'git log -10 --format=%s': 'feat: add feature\nfix: bug fix\nchore: cleanup',
    });
    const configLoader = createMockConfigLoader(
      makeConfigLoadResult({
        config: {
          git: {
            platform: 'github',
            url: 'https://github.com/org/repo',
            pr: { target: 'main' },
            remote: 'origin',
          },
          conventionalCommits: { enabled: true },
          changelog: { file: 'CHANGELOG.md' },
        } as any,
      }),
    );
    const deps = makeDeps({ executor, configLoader });

    const checks = await runDoctorCommand({ json: false }, deps);

    expect(checks).toHaveLength(10);
    expect(checks.find((c) => c.name === 'node_version')?.status).toBe('pass');
    expect(checks.find((c) => c.name === 'git_version')?.status).toBe('pass');
    expect(checks.find((c) => c.name === 'config')?.status).toBe('pass');
    expect(checks.find((c) => c.name === 'git_remote')?.status).toBe('pass');
    expect(checks.find((c) => c.name === 'package_json')?.status).toBe('pass');
    expect(checks.find((c) => c.name === 'versionings_dir')?.status).toBe('pass');
    expect(checks.find((c) => c.name === 'stale_lock')?.status).toBe('pass');
    expect(checks.find((c) => c.name === 'operation_log')?.status).toBe('pass');
    expect(checks.find((c) => c.name === 'conventional_commits')?.status).toBe('pass');
    expect(checks.find((c) => c.name === 'cc_config')?.status).toBe('pass');
  });

  test('node_version check includes found and expected values', async () => {
    const deps = makeDeps({ nodeVersion: 'v20.10.0' });

    const checks = await runDoctorCommand({ json: false }, deps);

    const nodeCheck = checks.find((c) => c.name === 'node_version')!;
    expect(nodeCheck.found).toBe('v20.10.0');
    expect(nodeCheck.expected).toContain('>= 18');
  });

  test('git_version check extracts version string', async () => {
    const deps = makeDeps();

    const checks = await runDoctorCommand({ json: false }, deps);

    const gitCheck = checks.find((c) => c.name === 'git_version')!;
    expect(gitCheck.found).toBe('2.43.0');
  });

  test('writes reporter output to stdout', async () => {
    const reporter = createMockReporter();
    const deps = makeDeps({ reporter });

    await runDoctorCommand({ json: false }, deps);

    expect(reporter.reportDoctor).toHaveBeenCalledTimes(1);
    const output = drainStdout(deps.stdout);
    expect(output.length).toBeGreaterThan(0);
  });
});

describe('doctor.command — Node.js version fail', () => {
  test('returns fail when Node.js version is below minimum', async () => {
    const deps = makeDeps({ nodeVersion: 'v16.20.0' });

    const checks = await runDoctorCommand({ json: false }, deps);

    const nodeCheck = checks.find((c) => c.name === 'node_version')!;
    expect(nodeCheck.status).toBe('fail');
    expect(nodeCheck.found).toBe('v16.20.0');
    expect(nodeCheck.expected).toContain('>= 18');
  });

  test('returns fail for unparseable Node.js version', async () => {
    const deps = makeDeps({ nodeVersion: 'unknown' });

    const checks = await runDoctorCommand({ json: false }, deps);

    const nodeCheck = checks.find((c) => c.name === 'node_version')!;
    expect(nodeCheck.status).toBe('fail');
  });
});

describe('doctor.command — Git missing', () => {
  test('returns fail when git is not installed', async () => {
    const executor = createMockExecutor({
      'git --version': new VersioningsError(
        EXIT_CODES.COMMAND_FAILED, 'git not found', {},
      ) as any,
    });
    const deps = makeDeps({ executor });

    const checks = await runDoctorCommand({ json: false }, deps);

    const gitCheck = checks.find((c) => c.name === 'git_version')!;
    expect(gitCheck.status).toBe('fail');
    expect(gitCheck.found).toBe('not found');
  });
});

describe('doctor.command — config invalid', () => {
  test('returns fail when configLoader throws', async () => {
    const configLoader = createMockConfigLoader(
      undefined,
      new VersioningsError(EXIT_CODES.CONFIG_ERROR, 'Configuration does not match schema.', {}),
    );
    const deps = makeDeps({ configLoader });

    const checks = await runDoctorCommand({ json: false }, deps);

    const configCheck = checks.find((c) => c.name === 'config')!;
    expect(configCheck.status).toBe('fail');
    expect(configCheck.found).toContain('Configuration does not match schema.');
  });

  test('returns warn when only defaults are loaded (no user config)', async () => {
    const configLoader = createMockConfigLoader(
      makeConfigLoadResult({
        sources: [{ name: 'defaults', data: {} }],
      }),
    );
    const deps = makeDeps({ configLoader });

    const checks = await runDoctorCommand({ json: false }, deps);

    const configCheck = checks.find((c) => c.name === 'config')!;
    expect(configCheck.status).toBe('warn');
    expect(configCheck.found).toContain('defaults only');
  });
});

describe('doctor.command — JSON output', () => {
  test('reporter.reportDoctor is called with all checks', async () => {
    const reporter = createMockReporter();
    const deps = makeDeps({ reporter });

    const checks = await runDoctorCommand({ json: true }, deps);

    expect(reporter.reportDoctor).toHaveBeenCalledWith(checks);
  });

  test('each check has name, status, and found fields', async () => {
    const deps = makeDeps();

    const checks = await runDoctorCommand({ json: true }, deps);

    for (const check of checks) {
      expect(check).toHaveProperty('name');
      expect(check).toHaveProperty('status');
      expect(check).toHaveProperty('found');
      expect(['pass', 'fail', 'warn']).toContain(check.status);
    }
  });
});

describe('doctor.command — provenance in diagnostics', () => {
  test('outputs provenance when config loads successfully', async () => {
    const provenance: ConfigProvenance = {
      'git.platform': { value: 'github', source: 'env' },
      'git.url': { value: 'https://github.com/org/repo', source: '.versioningsrc' },
    };
    const configLoader = createMockConfigLoader(makeConfigLoadResult({ provenance }));
    const reporter = createMockReporter();
    const deps = makeDeps({ configLoader, reporter });

    await runDoctorCommand({ json: false }, deps);

    expect(reporter.reportProvenance).toHaveBeenCalledWith(provenance);
  });

  test('does not output provenance when config fails to load', async () => {
    const configLoader = createMockConfigLoader(
      undefined,
      new VersioningsError(EXIT_CODES.CONFIG_ERROR, 'bad config', {}),
    );
    const reporter = createMockReporter();
    const deps = makeDeps({ configLoader, reporter });

    await runDoctorCommand({ json: false }, deps);

    expect(reporter.reportProvenance).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Branching strategy check tests
// ---------------------------------------------------------------------------

describe('doctor.command — branching strategy check', () => {
  test('skips branching check when strategy is default', async () => {
    const deps = makeDeps();

    const checks = await runDoctorCommand({ json: false }, deps);

    const bsCheck = checks.find((c) => c.name === 'branching_strategy');
    expect(bsCheck).toBeUndefined();
  });

  test('skips branching check when git.branching is absent', async () => {
    const configLoader = createMockConfigLoader(
      makeConfigLoadResult({
        config: { git: { platform: 'github', url: 'https://github.com/org/repo' } } as any,
      }),
    );
    const deps = makeDeps({ configLoader });

    const checks = await runDoctorCommand({ json: false }, deps);

    const bsCheck = checks.find((c) => c.name === 'branching_strategy');
    expect(bsCheck).toBeUndefined();
  });

  test('returns pass for trunk-based when on main branch', async () => {
    const executor = createMockExecutor({
      'git rev-parse --abbrev-ref HEAD': 'main',
    });
    const configLoader = createMockConfigLoader(
      makeConfigLoadResult({
        config: {
          git: {
            platform: 'github',
            url: 'https://github.com/org/repo',
            branching: { strategy: 'trunk-based', mainBranch: 'master' },
          },
        } as any,
      }),
    );
    const deps = makeDeps({ executor, configLoader });

    const checks = await runDoctorCommand({ json: false }, deps);

    const bsCheck = checks.find((c) => c.name === 'branching_strategy')!;
    expect(bsCheck.status).toBe('pass');
    expect(bsCheck.found).toContain('main');
    expect(bsCheck.found).toContain('trunk-based');
  });

  test('returns pass for trunk-based when on configured mainBranch', async () => {
    const executor = createMockExecutor({
      'git rev-parse --abbrev-ref HEAD': 'master',
    });
    const configLoader = createMockConfigLoader(
      makeConfigLoadResult({
        config: {
          git: {
            platform: 'github',
            url: 'https://github.com/org/repo',
            branching: { strategy: 'trunk-based', mainBranch: 'master' },
          },
        } as any,
      }),
    );
    const deps = makeDeps({ executor, configLoader });

    const checks = await runDoctorCommand({ json: false }, deps);

    const bsCheck = checks.find((c) => c.name === 'branching_strategy')!;
    expect(bsCheck.status).toBe('pass');
  });

  test('returns warn for trunk-based when on feature branch', async () => {
    const executor = createMockExecutor({
      'git rev-parse --abbrev-ref HEAD': 'feature/my-feature',
    });
    const configLoader = createMockConfigLoader(
      makeConfigLoadResult({
        config: {
          git: {
            platform: 'github',
            url: 'https://github.com/org/repo',
            branching: { strategy: 'trunk-based', mainBranch: 'master' },
          },
        } as any,
      }),
    );
    const deps = makeDeps({ executor, configLoader });

    const checks = await runDoctorCommand({ json: false }, deps);

    const bsCheck = checks.find((c) => c.name === 'branching_strategy')!;
    expect(bsCheck.status).toBe('warn');
    expect(bsCheck.expected).toContain('master');
    expect(bsCheck.expected).toContain('main');
  });

  test('returns pass for git-flow when on develop branch', async () => {
    const executor = createMockExecutor({
      'git rev-parse --abbrev-ref HEAD': 'develop',
    });
    const configLoader = createMockConfigLoader(
      makeConfigLoadResult({
        config: {
          git: {
            platform: 'github',
            url: 'https://github.com/org/repo',
            branching: { strategy: 'git-flow', mainBranch: 'master', developBranch: 'develop' },
          },
        } as any,
      }),
    );
    const deps = makeDeps({ executor, configLoader });

    const checks = await runDoctorCommand({ json: false }, deps);

    const bsCheck = checks.find((c) => c.name === 'branching_strategy')!;
    expect(bsCheck.status).toBe('pass');
    expect(bsCheck.found).toContain('develop');
    expect(bsCheck.found).toContain('git-flow');
  });

  test('returns warn for git-flow when on feature branch', async () => {
    const executor = createMockExecutor({
      'git rev-parse --abbrev-ref HEAD': 'feature/login',
    });
    const configLoader = createMockConfigLoader(
      makeConfigLoadResult({
        config: {
          git: {
            platform: 'github',
            url: 'https://github.com/org/repo',
            branching: { strategy: 'git-flow', mainBranch: 'master', developBranch: 'develop' },
          },
        } as any,
      }),
    );
    const deps = makeDeps({ executor, configLoader });

    const checks = await runDoctorCommand({ json: false }, deps);

    const bsCheck = checks.find((c) => c.name === 'branching_strategy')!;
    expect(bsCheck.status).toBe('warn');
    expect(bsCheck.expected).toContain('develop');
    expect(bsCheck.expected).toContain('master');
  });

  test('returns pass for hotfix when on main branch', async () => {
    const executor = createMockExecutor({
      'git rev-parse --abbrev-ref HEAD': 'main',
    });
    const configLoader = createMockConfigLoader(
      makeConfigLoadResult({
        config: {
          git: {
            platform: 'github',
            url: 'https://github.com/org/repo',
            branching: { strategy: 'hotfix', mainBranch: 'master' },
          },
        } as any,
      }),
    );
    const deps = makeDeps({ executor, configLoader });

    const checks = await runDoctorCommand({ json: false }, deps);

    const bsCheck = checks.find((c) => c.name === 'branching_strategy')!;
    expect(bsCheck.status).toBe('pass');
  });

  test('returns pass for release-branch strategy (any branch)', async () => {
    const executor = createMockExecutor({
      'git rev-parse --abbrev-ref HEAD': 'release/1.2.0',
    });
    const configLoader = createMockConfigLoader(
      makeConfigLoadResult({
        config: {
          git: {
            platform: 'github',
            url: 'https://github.com/org/repo',
            branching: { strategy: 'release-branch' },
          },
        } as any,
      }),
    );
    const deps = makeDeps({ executor, configLoader });

    const checks = await runDoctorCommand({ json: false }, deps);

    const bsCheck = checks.find((c) => c.name === 'branching_strategy')!;
    expect(bsCheck.status).toBe('pass');
    expect(bsCheck.found).toContain('release-branch');
  });

  test('returns pass for maintenance strategy (any branch)', async () => {
    const executor = createMockExecutor({
      'git rev-parse --abbrev-ref HEAD': 'support/1.0',
    });
    const configLoader = createMockConfigLoader(
      makeConfigLoadResult({
        config: {
          git: {
            platform: 'github',
            url: 'https://github.com/org/repo',
            branching: { strategy: 'maintenance' },
          },
        } as any,
      }),
    );
    const deps = makeDeps({ executor, configLoader });

    const checks = await runDoctorCommand({ json: false }, deps);

    const bsCheck = checks.find((c) => c.name === 'branching_strategy')!;
    expect(bsCheck.status).toBe('pass');
    expect(bsCheck.found).toContain('maintenance');
  });

  test('returns warn when git rev-parse fails', async () => {
    const executor = createMockExecutor({
      'git rev-parse --abbrev-ref HEAD': new VersioningsError(
        EXIT_CODES.COMMAND_FAILED, 'not a git repo', {},
      ) as any,
    });
    const configLoader = createMockConfigLoader(
      makeConfigLoadResult({
        config: {
          git: {
            platform: 'github',
            url: 'https://github.com/org/repo',
            branching: { strategy: 'trunk-based' },
          },
        } as any,
      }),
    );
    const deps = makeDeps({ executor, configLoader });

    const checks = await runDoctorCommand({ json: false }, deps);

    const bsCheck = checks.find((c) => c.name === 'branching_strategy')!;
    expect(bsCheck.status).toBe('warn');
    expect(bsCheck.found).toContain('cannot determine current branch');
  });

  test('skips branching check when config load fails', async () => {
    const configLoader = createMockConfigLoader(
      undefined,
      new VersioningsError(EXIT_CODES.CONFIG_ERROR, 'bad config', {}),
    );
    const deps = makeDeps({ configLoader });

    const checks = await runDoctorCommand({ json: false }, deps);

    const bsCheck = checks.find((c) => c.name === 'branching_strategy');
    expect(bsCheck).toBeUndefined();
  });
});


// ---------------------------------------------------------------------------
// Conventional Commits history check tests
// ---------------------------------------------------------------------------

describe('doctor.command — conventional_commits check', () => {
  test('returns pass when some commits match CC format', async () => {
    const executor = createMockExecutor({
      'git log -10 --format=%s': 'feat: add feature\nrandom commit\nfix: bug fix',
    });
    const deps = makeDeps({ executor });

    const checks = await runDoctorCommand({ json: false }, deps);

    const ccCheck = checks.find((c) => c.name === 'conventional_commits')!;
    expect(ccCheck.status).toBe('pass');
    expect(ccCheck.found).toContain('2/3');
  });

  test('returns warn when no commits match CC format', async () => {
    const executor = createMockExecutor({
      'git log -10 --format=%s': 'random commit\nanother commit\nno format here',
    });
    const deps = makeDeps({ executor });

    const checks = await runDoctorCommand({ json: false }, deps);

    const ccCheck = checks.find((c) => c.name === 'conventional_commits')!;
    expect(ccCheck.status).toBe('warn');
    expect(ccCheck.found).toContain('0/3');
    expect(ccCheck.expected).toContain('Conventional Commits');
  });

  test('returns warn when git log returns empty output', async () => {
    const executor = createMockExecutor({
      'git log -10 --format=%s': '',
    });
    const deps = makeDeps({ executor });

    const checks = await runDoctorCommand({ json: false }, deps);

    const ccCheck = checks.find((c) => c.name === 'conventional_commits')!;
    expect(ccCheck.status).toBe('warn');
    expect(ccCheck.found).toContain('no commits found');
  });

  test('returns warn when git log command fails', async () => {
    const executor = createMockExecutor({
      'git log -10 --format=%s': new VersioningsError(
        EXIT_CODES.COMMAND_FAILED, 'not a git repo', {},
      ) as any,
    });
    const deps = makeDeps({ executor });

    const checks = await runDoctorCommand({ json: false }, deps);

    const ccCheck = checks.find((c) => c.name === 'conventional_commits')!;
    expect(ccCheck.status).toBe('warn');
    expect(ccCheck.found).toContain('unable to read commit history');
  });

  test('returns pass when all commits match CC format', async () => {
    const executor = createMockExecutor({
      'git log -10 --format=%s': 'feat: one\nfix: two\nchore: three',
    });
    const deps = makeDeps({ executor });

    const checks = await runDoctorCommand({ json: false }, deps);

    const ccCheck = checks.find((c) => c.name === 'conventional_commits')!;
    expect(ccCheck.status).toBe('pass');
    expect(ccCheck.found).toContain('3/3');
  });
});

// ---------------------------------------------------------------------------
// CC config check tests
// ---------------------------------------------------------------------------

describe('doctor.command — cc_config check', () => {
  test('returns pass when conventionalCommits section is configured', async () => {
    const configLoader = createMockConfigLoader(
      makeConfigLoadResult({
        config: {
          git: { platform: 'github', url: 'https://github.com/org/repo' },
          conventionalCommits: { enabled: true, fallbackBump: 'patch' },
        } as any,
      }),
    );
    const deps = makeDeps({ configLoader });

    const checks = await runDoctorCommand({ json: false }, deps);

    const ccCfgCheck = checks.find((c) => c.name === 'cc_config')!;
    expect(ccCfgCheck.status).toBe('pass');
    expect(ccCfgCheck.found).toContain('conventionalCommits: enabled');
    expect(ccCfgCheck.found).toContain('fallbackBump: patch');
  });

  test('returns pass when changelog section is configured', async () => {
    const configLoader = createMockConfigLoader(
      makeConfigLoadResult({
        config: {
          git: { platform: 'github', url: 'https://github.com/org/repo' },
          changelog: { file: 'CHANGELOG.md', excludeTypes: ['chore', 'docs'] },
        } as any,
      }),
    );
    const deps = makeDeps({ configLoader });

    const checks = await runDoctorCommand({ json: false }, deps);

    const ccCfgCheck = checks.find((c) => c.name === 'cc_config')!;
    expect(ccCfgCheck.status).toBe('pass');
    expect(ccCfgCheck.found).toContain('changelog.file: CHANGELOG.md');
    expect(ccCfgCheck.found).toContain('changelog.excludeTypes: chore, docs');
  });

  test('returns warn when neither conventionalCommits nor changelog is configured', async () => {
    const configLoader = createMockConfigLoader(
      makeConfigLoadResult({
        config: {
          git: { platform: 'github', url: 'https://github.com/org/repo' },
        } as any,
      }),
    );
    const deps = makeDeps({ configLoader });

    const checks = await runDoctorCommand({ json: false }, deps);

    const ccCfgCheck = checks.find((c) => c.name === 'cc_config')!;
    expect(ccCfgCheck.status).toBe('warn');
    expect(ccCfgCheck.found).toContain('not configured');
    expect(ccCfgCheck.expected).toContain('conventionalCommits');
  });

  test('reports conventionalCommits disabled when enabled is false', async () => {
    const configLoader = createMockConfigLoader(
      makeConfigLoadResult({
        config: {
          git: { platform: 'github', url: 'https://github.com/org/repo' },
          conventionalCommits: { enabled: false },
        } as any,
      }),
    );
    const deps = makeDeps({ configLoader });

    const checks = await runDoctorCommand({ json: false }, deps);

    const ccCfgCheck = checks.find((c) => c.name === 'cc_config')!;
    expect(ccCfgCheck.status).toBe('pass');
    expect(ccCfgCheck.found).toContain('conventionalCommits: disabled');
  });

  test('skips cc_config check when config load fails', async () => {
    const configLoader = createMockConfigLoader(
      undefined,
      new VersioningsError(EXIT_CODES.CONFIG_ERROR, 'bad config', {}),
    );
    const deps = makeDeps({ configLoader });

    const checks = await runDoctorCommand({ json: false }, deps);

    const ccCfgCheck = checks.find((c) => c.name === 'cc_config');
    expect(ccCfgCheck).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// .versionings/ directory check tests
// ---------------------------------------------------------------------------

describe('doctor.command — versionings_dir check', () => {
  test('returns pass when .versionings/ directory exists', async () => {
    const deps = makeDeps({ existsSync: () => true });

    const checks = await runDoctorCommand({ json: false }, deps);

    const dirCheck = checks.find((c) => c.name === 'versionings_dir')!;
    expect(dirCheck.status).toBe('pass');
    expect(dirCheck.found).toContain('.versionings');
  });

  test('returns warn when .versionings/ directory is missing', async () => {
    const existsSync = (p: string): boolean => !p.includes('.versionings');
    const deps = makeDeps({ existsSync });

    const checks = await runDoctorCommand({ json: false }, deps);

    const dirCheck = checks.find((c) => c.name === 'versionings_dir')!;
    expect(dirCheck.status).toBe('warn');
    expect(dirCheck.found).toBe('not found');
    expect(dirCheck.expected).toContain('.versionings/');
  });
});

// ---------------------------------------------------------------------------
// Stale lock check tests
// ---------------------------------------------------------------------------

describe('doctor.command — stale_lock check', () => {
  test('returns pass when no lock file exists', async () => {
    const deps = makeDeps();

    const checks = await runDoctorCommand({ json: false }, deps);

    const lockCheck = checks.find((c) => c.name === 'stale_lock')!;
    expect(lockCheck.status).toBe('pass');
    expect(lockCheck.found).toContain('no lock file');
  });

  test('returns pass when lock file has active process', async () => {
    const lockData = JSON.stringify({
      pid: 12345,
      operationId: 'abc-123',
      command: 'release',
      createdAt: new Date().toISOString(),
      hostname: 'test-host',
      ci: false,
    });
    const deps = makeDeps({
      existsSync: () => true,
      readFileSync: () => lockData,
      processKill: () => true, // process is alive
      readdirSync: () => [],
    });

    const checks = await runDoctorCommand({ json: false }, deps);

    const lockCheck = checks.find((c) => c.name === 'stale_lock')!;
    expect(lockCheck.status).toBe('pass');
    expect(lockCheck.found).toContain('active lock');
    expect(lockCheck.found).toContain('12345');
  });

  test('returns warn when lock file has dead process (ESRCH)', async () => {
    const lockData = JSON.stringify({
      pid: 99999,
      operationId: 'dead-op-id',
      command: 'release',
      createdAt: new Date().toISOString(),
      hostname: 'test-host',
      ci: false,
    });
    const esrchError = Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    const deps = makeDeps({
      existsSync: () => true,
      readFileSync: () => lockData,
      processKill: () => { throw esrchError; },
      readdirSync: () => [],
    });

    const checks = await runDoctorCommand({ json: false }, deps);

    const lockCheck = checks.find((c) => c.name === 'stale_lock')!;
    expect(lockCheck.status).toBe('warn');
    expect(lockCheck.found).toContain('stale lock');
    expect(lockCheck.found).toContain('process not found');
    expect(lockCheck.found).toContain('99999');
  });

  test('returns warn when lock file has timed out', async () => {
    const oldTime = new Date(Date.now() - 600000).toISOString(); // 10 minutes ago
    const lockData = JSON.stringify({
      pid: 12345,
      operationId: 'timeout-op',
      command: 'release',
      createdAt: oldTime,
      hostname: 'test-host',
      ci: false,
    });
    const deps = makeDeps({
      existsSync: () => true,
      readFileSync: () => lockData,
      processKill: () => true,
      lockTimeoutMs: 300000, // 5 minutes
      readdirSync: () => [],
    });

    const checks = await runDoctorCommand({ json: false }, deps);

    const lockCheck = checks.find((c) => c.name === 'stale_lock')!;
    expect(lockCheck.status).toBe('warn');
    expect(lockCheck.found).toContain('stale lock');
    expect(lockCheck.found).toContain('timeout exceeded');
  });

  test('returns warn when lock file contains invalid JSON', async () => {
    const deps = makeDeps({
      existsSync: () => true,
      readFileSync: () => 'not valid json {{{',
      readdirSync: () => [],
    });

    const checks = await runDoctorCommand({ json: false }, deps);

    const lockCheck = checks.find((c) => c.name === 'stale_lock')!;
    expect(lockCheck.status).toBe('warn');
    expect(lockCheck.found).toContain('invalid JSON');
  });

  test('returns pass when EPERM (process exists but no permission)', async () => {
    const lockData = JSON.stringify({
      pid: 1,
      operationId: 'eperm-op',
      command: 'release',
      createdAt: new Date().toISOString(),
      hostname: 'test-host',
      ci: false,
    });
    const epermError = Object.assign(new Error('EPERM'), { code: 'EPERM' });
    const deps = makeDeps({
      existsSync: () => true,
      readFileSync: () => lockData,
      processKill: () => { throw epermError; },
      readdirSync: () => [],
    });

    const checks = await runDoctorCommand({ json: false }, deps);

    const lockCheck = checks.find((c) => c.name === 'stale_lock')!;
    expect(lockCheck.status).toBe('pass');
    expect(lockCheck.found).toContain('active lock');
  });
});

// ---------------------------------------------------------------------------
// Operation log count check tests
// ---------------------------------------------------------------------------

describe('doctor.command — operation_log check', () => {
  test('returns pass with 0 entries when operations directory is missing', async () => {
    const existsSync = (p: string): boolean => {
      if (p.includes('operations')) return false;
      return !p.endsWith('/lock');
    };
    const deps = makeDeps({ existsSync });

    const checks = await runDoctorCommand({ json: false }, deps);

    const logCheck = checks.find((c) => c.name === 'operation_log')!;
    expect(logCheck.status).toBe('pass');
    expect(logCheck.found).toContain('0 entries');
  });

  test('returns pass with correct count of operation log entries', async () => {
    const deps = makeDeps({
      readdirSync: () => [
        '2024-01-01T00-00-00-000Z-patch-1.0.1.json',
        '2024-01-02T00-00-00-000Z-minor-1.1.0.json',
        '2024-01-03T00-00-00-000Z-major-2.0.0.json',
        'last.json',
      ],
    });

    const checks = await runDoctorCommand({ json: false }, deps);

    const logCheck = checks.find((c) => c.name === 'operation_log')!;
    expect(logCheck.status).toBe('pass');
    expect(logCheck.found).toBe('3 entries');
  });

  test('returns pass with singular "entry" for single log', async () => {
    const deps = makeDeps({
      readdirSync: () => ['2024-01-01T00-00-00-000Z-patch-1.0.1.json'],
    });

    const checks = await runDoctorCommand({ json: false }, deps);

    const logCheck = checks.find((c) => c.name === 'operation_log')!;
    expect(logCheck.status).toBe('pass');
    expect(logCheck.found).toBe('1 entry');
  });

  test('returns warn when operations directory cannot be read', async () => {
    const deps = makeDeps({
      readdirSync: () => { throw new Error('EACCES'); },
    });

    const checks = await runDoctorCommand({ json: false }, deps);

    const logCheck = checks.find((c) => c.name === 'operation_log')!;
    expect(logCheck.status).toBe('warn');
    expect(logCheck.found).toContain('unable to read');
  });
});
