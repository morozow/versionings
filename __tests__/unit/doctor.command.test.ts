// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { PassThrough } from 'stream';
import { runDoctorCommand, DoctorCommandDeps } from '../../doctor.command';
import type { Executor, ExecutorResult } from '../../executor';
import type { Reporter, DoctorCheck } from '../../reporter';
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

  return {
    configLoader: overrides.configLoader ?? createMockConfigLoader(),
    executor: overrides.executor ?? createMockExecutor(),
    reporter: overrides.reporter ?? createMockReporter(),
    cwd: overrides.cwd ?? '/tmp/test-project',
    env: overrides.env ?? {},
    stdout: overrides.stdout as any ?? stdout,
    existsSync: overrides.existsSync ?? (() => true),
    nodeVersion: overrides.nodeVersion ?? 'v20.10.0',
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
    const deps = makeDeps();

    const checks = await runDoctorCommand({ json: false }, deps);

    expect(checks).toHaveLength(5);
    expect(checks.find((c) => c.name === 'node_version')?.status).toBe('pass');
    expect(checks.find((c) => c.name === 'git_version')?.status).toBe('pass');
    expect(checks.find((c) => c.name === 'config')?.status).toBe('pass');
    expect(checks.find((c) => c.name === 'git_remote')?.status).toBe('pass');
    expect(checks.find((c) => c.name === 'package_json')?.status).toBe('pass');
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
