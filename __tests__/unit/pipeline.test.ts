// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { EXIT_CODES, VersioningsError } from '../../errors';

// Mock fs for package.json reads and changelog writes
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    readFileSync: jest.fn(),
    existsSync: jest.fn(),
    writeFileSync: jest.fn(),
  };
});

const fs = require('fs');

// Mock version.utils to avoid config.ts side-effect
jest.mock('../../version.utils', () => ({
  AVAILABLE_SEMVERS: ['patch', 'minor', 'major', 'prepatch', 'preminor', 'premajor', 'prerelease', 'auto'],
  composeVersionBranchName: (semver: string, version: string, comment: string) =>
    `version/${semver}/${version}/${comment}`,
  composeVersionTagName: (semver: string, version: string, comment: string) =>
    `${version}--${comment}`,
  semverMessage: (semver: string, version: string) =>
    `Patch: v${version}. You SHOULD consider changes.`,
  semverNpmMessage: (semver: string, branch: string) =>
    `Version: ${semver}. Comment: ${branch}.`,
  preidParam: (preid?: string) => (preid ? `--preid=${preid}` : ''),
  generatePullRequestUrl: (branch: string) =>
    `https://github.com/user/repo/compare/develop...${branch}?expand=1`,
}));

// Mock pr.creator to control createPR behavior in tests
const mockCreatePR = jest.fn();
jest.mock('../../pr.creator', () => ({
  createPR: (...args: any[]) => mockCreatePR(...args),
}));

const { runPipeline } = require('../../pipeline');

const mockConfig = {
  git: {
    platform: 'github',
    url: 'https://github.com/user/repo.git',
    branchType: { version: 'version' },
    pr: { target: 'develop' },
    limits: { branchMaxCommentLength: 96 },
    remote: 'origin',
    commit: {
      message: {
        semver: {
          patch: 'Patch: v%s. You SHOULD consider changes.',
          minor: 'Minor: v%s. You MUST consider changes.',
          major: 'Release: v%s.',
          prepatch: 'Patch version is preparing now: v%s.',
          preminor: 'Minor version is preparing now: v%s.',
          premajor: 'Release is preparing now: v%s.',
          prerelease: 'Preparing: v%s.',
        }
      }
    },
  },
  package: { semver: { patch: 'patch', prepatch: 'prepatch', minor: 'minor', preminor: 'preminor', premajor: 'premajor', prerelease: 'prerelease', major: 'major' } },
  common: {
    messages: {
      unavailableSemanticVersion: 'Invalid semver',
      undefinedVersionBranchName: 'Branch name required',
      incorrectVersionBranchNameLength: 'Branch too long',
      incorrectVersionBranchNameCharactersDashes: 'No double dashes',
      untrackedGitFiles: 'Dirty tree',
      incorrectGitRemote: 'Wrong remote',
    }
  },
} as any;

function createMockExecutor() {
  return {
    run: jest.fn(async (cmd: string) => {
      if (cmd.includes('git status --porcelain')) return { stdout: '', lines: [] };
      if (cmd.includes('git remote --verbose')) return { stdout: 'origin\thttps://github.com/user/repo.git (fetch)', lines: ['origin\thttps://github.com/user/repo.git (fetch)'] };
      if (cmd.includes('npm --no-git-tag-version version')) return { stdout: 'v1.2.3', lines: ['v1.2.3'] };
      if (cmd.includes('git checkout -- package')) return { stdout: '', lines: [] };
      if (cmd.includes('git tag --list')) return { stdout: '', lines: [] };
      if (cmd.includes('git branch --list')) return { stdout: '  main', lines: ['main'] };
      return { stdout: '', lines: [] };
    }),
  };
}

function createMockRollbackManager(rollbackSuccess = true) {
  return {
    record: jest.fn(),
    rollback: jest.fn(async () => ({
      success: rollbackSuccess,
      failedSteps: rollbackSuccess ? [] : [{ step: { type: 'pushed', meta: {} }, error: new Error('network') }],
    })),
  };
}

function createMockArtifactChecker() {
  return {
    checkUniqueness: jest.fn(async () => { }),
  };
}

const baseOpts = {
  semver: 'patch',
  branch: 'fix-login',
  push: false,
  dryRun: false,
  json: false,
  verbose: false,
};

beforeEach(() => {
  fs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.2.2' }));
  fs.existsSync.mockReturnValue(true);
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('runPipeline', () => {
  test('successful workflow — returns PipelineResult with correct fields', async () => {
    const executor = createMockExecutor();
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();
    const result = await runPipeline(baseOpts, {
      executor,
      config: mockConfig,
      rollbackManager: rollback,
      artifactChecker,
    });
    expect(result.success).toBe(true);
    expect(result.version).toBe('1.2.3');
    expect(result.previousVersion).toBe('1.2.2');
    expect(result.semver).toBe('patch');
    expect(result.branch).toBe('version/patch/1.2.3/fix-login');
    expect(result.tag).toBe('1.2.3--fix-login');
    expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
    expect(result.pullRequestUrl).toBeNull();
    expect(rollback.record).toHaveBeenCalled();
  });

  test('dry-run — returns DryRunPlan without executing mutation commands', async () => {
    const executor = createMockExecutor();
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();
    const plan = await runPipeline(
      { ...baseOpts, dryRun: true },
      { executor, config: mockConfig, rollbackManager: rollback, artifactChecker },
    );
    expect(plan.dryRun).toBe(true);
    expect(plan.currentVersion).toBe('1.2.2');
    expect(plan.nextVersion).toBe('1.2.3');
    expect(plan.semver).toBe('patch');
    expect(plan.branch).toBe('version/patch/1.2.3/fix-login');
    expect(plan.tag).toBe('1.2.3--fix-login');
    expect(Array.isArray(plan.steps)).toBe(true);
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(rollback.record).not.toHaveBeenCalled();
    const mutationCmds = (executor.run as jest.Mock).mock.calls
      .map((c: any[]) => c[0])
      .filter((cmd: string) =>
        cmd.includes('git checkout -b') ||
        cmd.includes('git tag --annotate') ||
        cmd.includes('git commit') ||
        cmd.includes('git push')
      );
    expect(mutationCmds).toHaveLength(0);
  });

  test('error with rollback — when a mutation step fails, rollback is called', async () => {
    const executor = createMockExecutor();
    (executor.run as jest.Mock).mockImplementation(async (cmd: string) => {
      if (cmd.includes('git status --porcelain')) return { stdout: '', lines: [] };
      if (cmd.includes('git remote --verbose')) return { stdout: 'origin\thttps://github.com/user/repo.git (fetch)', lines: ['origin\thttps://github.com/user/repo.git (fetch)'] };
      if (cmd.includes('npm --no-git-tag-version version')) return { stdout: 'v1.2.3', lines: ['v1.2.3'] };
      if (cmd.includes('git checkout -- package')) return { stdout: '', lines: [] };
      if (cmd.includes('git checkout -b')) throw new VersioningsError(EXIT_CODES.COMMAND_FAILED, 'branch creation failed');
      return { stdout: '', lines: [] };
    });
    const rollback = createMockRollbackManager(true);
    const artifactChecker = createMockArtifactChecker();
    await expect(
      runPipeline(baseOpts, { executor, config: mockConfig, rollbackManager: rollback, artifactChecker })
    ).rejects.toThrow();
    expect(rollback.rollback).toHaveBeenCalled();
  });

  test('invalid arguments — invalid semver throws INVALID_ARGS', async () => {
    const executor = createMockExecutor();
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();
    try {
      await runPipeline(
        { ...baseOpts, semver: 'not-a-semver' },
        { executor, config: mockConfig, rollbackManager: rollback, artifactChecker },
      );
      throw new Error('Expected to throw');
    } catch (err: any) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.code).toBe(EXIT_CODES.INVALID_ARGS);
    }
  });

  test('dirty tree — non-empty git status throws DIRTY_TREE', async () => {
    const executor = createMockExecutor();
    (executor.run as jest.Mock).mockImplementation(async (cmd: string) => {
      if (cmd.includes('git status --porcelain')) return { stdout: 'M file.js', lines: ['M file.js'] };
      return { stdout: '', lines: [] };
    });
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();
    try {
      await runPipeline(baseOpts, { executor, config: mockConfig, rollbackManager: rollback, artifactChecker });
      throw new Error('Expected to throw');
    } catch (err: any) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.code).toBe(EXIT_CODES.DIRTY_TREE);
    }
  });

  test('incomplete rollback — when rollback fails, throws INCOMPLETE_ROLLBACK (exit code 7)', async () => {
    const executor = createMockExecutor();
    (executor.run as jest.Mock).mockImplementation(async (cmd: string) => {
      if (cmd.includes('git status --porcelain')) return { stdout: '', lines: [] };
      if (cmd.includes('git remote --verbose')) return { stdout: 'origin\thttps://github.com/user/repo.git (fetch)', lines: ['origin\thttps://github.com/user/repo.git (fetch)'] };
      if (cmd.includes('npm --no-git-tag-version version')) return { stdout: 'v1.2.3', lines: ['v1.2.3'] };
      if (cmd.includes('git checkout -- package')) return { stdout: '', lines: [] };
      if (cmd.includes('git checkout -b')) throw new VersioningsError(EXIT_CODES.COMMAND_FAILED, 'branch failed');
      return { stdout: '', lines: [] };
    });
    const rollback = createMockRollbackManager(false);
    const artifactChecker = createMockArtifactChecker();
    try {
      await runPipeline(baseOpts, { executor, config: mockConfig, rollbackManager: rollback, artifactChecker });
      throw new Error('Expected to throw');
    } catch (err: any) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.code).toBe(EXIT_CODES.INCOMPLETE_ROLLBACK);
      expect(err.details).toBeDefined();
      expect(err.details.failedSteps).toBeDefined();
      expect(err.details.failedSteps.length).toBeGreaterThan(0);
    }
  });
});

describe('runPipeline — operation log integration', () => {
  function createMockOperationLog() {
    return {
      save: jest.fn(async () => '/tmp/log.json'),
      loadLast: jest.fn(async () => null),
      loadFrom: jest.fn(async () => ({})),
    };
  }

  test('saves log with result "success" after successful pipeline', async () => {
    const executor = createMockExecutor();
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();
    const operationLog = createMockOperationLog();

    await runPipeline(baseOpts, {
      executor,
      config: mockConfig,
      rollbackManager: rollback,
      artifactChecker,
      operationLog,
    });

    expect(operationLog.save).toHaveBeenCalledTimes(1);
    const entry = operationLog.save.mock.calls[0][0];
    expect(entry.schemaVersion).toBe(1);
    expect(entry.result).toBe('success');
    expect(entry.semver).toBe('patch');
    expect(entry.version).toBe('1.2.3');
    expect(entry.previousVersion).toBe('1.2.2');
    expect(entry.branch).toBe('version/patch/1.2.3/fix-login');
    expect(entry.tag).toBe('1.2.3--fix-login');
    expect(entry.steps.length).toBeGreaterThan(0);
    expect(entry.error).toBeUndefined();
    expect(entry.timestamp).toBeDefined();
  });

  test('saves log with result "failed" when mutation step fails and rollback succeeds', async () => {
    const executor = createMockExecutor();
    (executor.run as jest.Mock).mockImplementation(async (cmd: string) => {
      if (cmd.includes('git status --porcelain')) return { stdout: '', lines: [] };
      if (cmd.includes('git remote --verbose')) return { stdout: 'origin\thttps://github.com/user/repo.git (fetch)', lines: ['origin\thttps://github.com/user/repo.git (fetch)'] };
      if (cmd.includes('npm --no-git-tag-version version')) return { stdout: 'v1.2.3', lines: ['v1.2.3'] };
      if (cmd.includes('git checkout -- package')) return { stdout: '', lines: [] };
      if (cmd.includes('git checkout -b')) throw new VersioningsError(EXIT_CODES.COMMAND_FAILED, 'branch creation failed');
      return { stdout: '', lines: [] };
    });
    const rollback = createMockRollbackManager(true);
    const artifactChecker = createMockArtifactChecker();
    const operationLog = createMockOperationLog();

    await expect(
      runPipeline(baseOpts, { executor, config: mockConfig, rollbackManager: rollback, artifactChecker, operationLog })
    ).rejects.toThrow();

    expect(operationLog.save).toHaveBeenCalledTimes(1);
    const entry = operationLog.save.mock.calls[0][0];
    expect(entry.result).toBe('failed');
    expect(entry.error).toBeDefined();
    expect(entry.error.message).toBe('branch creation failed');
    expect(entry.error.code).toBe(EXIT_CODES.COMMAND_FAILED);
    expect(entry.steps.length).toBeGreaterThan(0);
  });

  test('saves log with result "failed" on incomplete rollback', async () => {
    const executor = createMockExecutor();
    (executor.run as jest.Mock).mockImplementation(async (cmd: string) => {
      if (cmd.includes('git status --porcelain')) return { stdout: '', lines: [] };
      if (cmd.includes('git remote --verbose')) return { stdout: 'origin\thttps://github.com/user/repo.git (fetch)', lines: ['origin\thttps://github.com/user/repo.git (fetch)'] };
      if (cmd.includes('npm --no-git-tag-version version')) return { stdout: 'v1.2.3', lines: ['v1.2.3'] };
      if (cmd.includes('git checkout -- package')) return { stdout: '', lines: [] };
      if (cmd.includes('git checkout -b')) throw new VersioningsError(EXIT_CODES.COMMAND_FAILED, 'branch failed');
      return { stdout: '', lines: [] };
    });
    const rollback = createMockRollbackManager(false);
    const artifactChecker = createMockArtifactChecker();
    const operationLog = createMockOperationLog();

    await expect(
      runPipeline(baseOpts, { executor, config: mockConfig, rollbackManager: rollback, artifactChecker, operationLog })
    ).rejects.toThrow();

    expect(operationLog.save).toHaveBeenCalledTimes(1);
    const entry = operationLog.save.mock.calls[0][0];
    expect(entry.result).toBe('failed');
    expect(entry.error).toBeDefined();
  });

  test('pipeline works without operationLog (backward compatibility)', async () => {
    const executor = createMockExecutor();
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();

    // No operationLog in deps — should work exactly as before
    const result = await runPipeline(baseOpts, {
      executor,
      config: mockConfig,
      rollbackManager: rollback,
      artifactChecker,
    });

    expect(result.success).toBe(true);
    expect(result.version).toBe('1.2.3');
  });

  test('pipeline still succeeds if operationLog.save throws', async () => {
    const executor = createMockExecutor();
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();
    const operationLog = createMockOperationLog();
    operationLog.save.mockRejectedValue(new Error('disk full'));

    const result = await runPipeline(baseOpts, {
      executor,
      config: mockConfig,
      rollbackManager: rollback,
      artifactChecker,
      operationLog,
    });

    expect(result.success).toBe(true);
    expect(result.version).toBe('1.2.3');
    expect(operationLog.save).toHaveBeenCalledTimes(1);
  });
});


// --- PR_Creator integration tests (Task 8.3) ---

describe('runPipeline — PR_Creator integration', () => {
  function createMockPrCreator() {
    return {
      registry: {} as any,
      httpClient: {} as any,
      urlParser: {} as any,
      resolveAuth: jest.fn(() => ({ token: 'test-token', method: 'token' as const })),
      env: {},
    };
  }

  afterEach(() => {
    mockCreatePR.mockReset();
  });

  test('pipeline with prCreator — API success returns pullRequest in result', async () => {
    const prResult = {
      url: 'https://github.com/user/repo/pull/42',
      number: 42,
      status: 'created' as const,
      fallbackReason: null,
      platform: 'github',
      warnings: [],
    };
    mockCreatePR.mockResolvedValue(prResult);

    const executor = createMockExecutor();
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();
    const prCreator = createMockPrCreator();

    const result = await runPipeline(
      { ...baseOpts, push: true },
      { executor, config: mockConfig, rollbackManager: rollback, artifactChecker, prCreator },
    );

    expect(result.success).toBe(true);
    expect(result.pullRequest).toBeDefined();
    expect(result.pullRequest!.url).toBe('https://github.com/user/repo/pull/42');
    expect(result.pullRequest!.number).toBe(42);
    expect(result.pullRequest!.status).toBe('created');
    expect(result.pullRequestUrl).toBe('https://github.com/user/repo/pull/42');
    expect(mockCreatePR).toHaveBeenCalledTimes(1);
  });

  test('pipeline with prCreator — fallback returns pullRequest with fallback status', async () => {
    const prResult = {
      url: 'https://github.com/user/repo/compare/develop...branch',
      number: null,
      status: 'fallback' as const,
      fallbackReason: 'no_token',
      platform: 'github',
      warnings: [],
    };
    mockCreatePR.mockResolvedValue(prResult);

    const executor = createMockExecutor();
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();
    const prCreator = createMockPrCreator();

    const result = await runPipeline(
      { ...baseOpts, push: true },
      { executor, config: mockConfig, rollbackManager: rollback, artifactChecker, prCreator },
    );

    expect(result.success).toBe(true);
    expect(result.pullRequest).toBeDefined();
    expect(result.pullRequest!.status).toBe('fallback');
    expect(result.pullRequest!.fallbackReason).toBe('no_token');
  });

  test('pipeline without prCreator — backward compatibility uses generatePullRequestUrl', async () => {
    const executor = createMockExecutor();
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();

    const result = await runPipeline(
      { ...baseOpts, push: true },
      { executor, config: mockConfig, rollbackManager: rollback, artifactChecker },
    );

    expect(result.success).toBe(true);
    expect(result.pullRequestUrl).toContain('https://github.com/user/repo/compare/develop');
    expect(result.pullRequest).toBeUndefined();
    expect(mockCreatePR).not.toHaveBeenCalled();
  });

  test('--no-pr skips PR/MR creation entirely', async () => {
    mockCreatePR.mockResolvedValue({
      url: 'https://github.com/user/repo/pull/42',
      number: 42,
      status: 'created' as const,
      fallbackReason: null,
      platform: 'github',
      warnings: [],
    });

    const executor = createMockExecutor();
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();
    const prCreator = createMockPrCreator();

    const result = await runPipeline(
      { ...baseOpts, push: true, noPr: true },
      { executor, config: mockConfig, rollbackManager: rollback, artifactChecker, prCreator },
    );

    expect(result.success).toBe(true);
    expect(result.pullRequestUrl).toBeNull();
    expect(result.pullRequest).toBeUndefined();
    expect(mockCreatePR).not.toHaveBeenCalled();
  });

  test('PR error does not trigger rollback — pipeline completes with success=true', async () => {
    mockCreatePR.mockRejectedValue(new Error('API rate limit exceeded'));

    const executor = createMockExecutor();
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();
    const prCreator = createMockPrCreator();

    const result = await runPipeline(
      { ...baseOpts, push: true },
      { executor, config: mockConfig, rollbackManager: rollback, artifactChecker, prCreator },
    );

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.pullRequest).toBeDefined();
    expect(result.pullRequest!.status).toBe('fallback');
    expect(result.pullRequest!.fallbackReason).toBe('API rate limit exceeded');
    // Rollback should NOT have been called for PR errors
    expect(rollback.rollback).not.toHaveBeenCalled();
  });

  test('dry-run with prCreator includes pullRequest info in plan', async () => {
    const executor = createMockExecutor();
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();
    const prCreator = createMockPrCreator();

    const plan = await runPipeline(
      { ...baseOpts, push: true, dryRun: true },
      { executor, config: mockConfig, rollbackManager: rollback, artifactChecker, prCreator },
    );

    expect(plan.dryRun).toBe(true);
    expect(plan.pullRequest).toBeDefined();
    expect(plan.pullRequest!.mode).toBe('auto');
    expect(plan.pullRequest!.platform).toBe('github');
    expect(plan.pullRequest!.hasToken).toBe(true);
  });
});


// --- Strategy Registry and Policy Checker integration tests (Task 9.6) ---

describe('runPipeline — Strategy Registry and Policy Checker integration', () => {
  function createMockStrategy(overrides: Partial<{
    name: string;
    branchName: string | null;
    reuseBranch: boolean;
    tagName: string;
    commitMessage: string;
    valid: boolean;
    validationErrors: string[];
  }> = {}) {
    const opts = {
      name: 'default',
      branchName: 'version/patch/1.2.3/fix-login' as string | null,
      reuseBranch: false,
      tagName: 'v1.2.3',
      commitMessage: 'Release v1.2.3',
      valid: true,
      validationErrors: [] as string[],
      ...overrides,
    };
    return {
      name: jest.fn(() => opts.name),
      composeBranchName: jest.fn(() => ({ branchName: opts.branchName, reuseBranch: opts.reuseBranch })),
      composeTagName: jest.fn(() => opts.tagName),
      composeCommitMessage: jest.fn(() => opts.commitMessage),
      validateContext: jest.fn(() => ({ valid: opts.valid, errors: opts.validationErrors })),
    };
  }

  function createMockStrategyRegistry(strategy?: ReturnType<typeof createMockStrategy>) {
    const mockStrategy = strategy || createMockStrategy();
    return {
      register: jest.fn(),
      getStrategy: jest.fn(() => mockStrategy),
      availableStrategies: jest.fn(() => ['default', 'trunk-based', 'git-flow', 'release-branch', 'hotfix', 'maintenance']),
      _mockStrategy: mockStrategy,
    };
  }

  function createMockExecutorWithCurrentBranch(currentBranch = 'main') {
    return {
      run: jest.fn(async (cmd: string) => {
        if (cmd.includes('git status --porcelain')) return { stdout: '', lines: [] };
        if (cmd.includes('git remote --verbose')) return { stdout: 'origin\thttps://github.com/user/repo.git (fetch)', lines: ['origin\thttps://github.com/user/repo.git (fetch)'] };
        if (cmd.includes('npm --no-git-tag-version version')) return { stdout: 'v1.2.3', lines: ['v1.2.3'] };
        if (cmd.includes('git checkout -- package')) return { stdout: '', lines: [] };
        if (cmd.includes('git rev-parse --abbrev-ref HEAD')) return { stdout: currentBranch, lines: [currentBranch] };
        if (cmd.includes('git tag --list')) return { stdout: '', lines: [] };
        if (cmd.includes('git branch --list')) return { stdout: '  main', lines: ['main'] };
        return { stdout: '', lines: [] };
      }),
    };
  }

  test('pipeline with strategyRegistry (default strategy) — uses strategy for branch/tag names', async () => {
    const strategy = createMockStrategy({
      name: 'default',
      branchName: 'version/patch/1.2.3/fix-login',
      tagName: 'v1.2.3',
      commitMessage: 'Release v1.2.3',
    });
    const registry = createMockStrategyRegistry(strategy);
    const executor = createMockExecutorWithCurrentBranch('main');
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();

    const result = await runPipeline(baseOpts, {
      executor,
      config: mockConfig,
      rollbackManager: rollback,
      artifactChecker,
      strategyRegistry: registry,
    });

    expect(result.success).toBe(true);
    expect(result.version).toBe('1.2.3');
    expect(result.branch).toBe('version/patch/1.2.3/fix-login');
    expect(result.tag).toBe('v1.2.3');
    expect(registry.getStrategy).toHaveBeenCalled();
    expect(strategy.composeBranchName).toHaveBeenCalled();
    expect(strategy.composeTagName).toHaveBeenCalled();
    expect(strategy.composeCommitMessage).toHaveBeenCalled();
    expect(strategy.validateContext).toHaveBeenCalled();
  });

  test('pipeline with trunk-based (null branch, skip checkout -b) — no git checkout -b called', async () => {
    const strategy = createMockStrategy({
      name: 'trunk-based',
      branchName: null,
      reuseBranch: false,
      tagName: 'v1.2.3',
      commitMessage: 'Release v1.2.3',
    });
    const registry = createMockStrategyRegistry(strategy);
    const executor = createMockExecutorWithCurrentBranch('main');
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();

    const result = await runPipeline(baseOpts, {
      executor,
      config: mockConfig,
      rollbackManager: rollback,
      artifactChecker,
      strategyRegistry: registry,
    });

    expect(result.success).toBe(true);
    expect(result.branch).toBe('main');
    // No git checkout -b should have been called
    const checkoutCmds = (executor.run as jest.Mock).mock.calls
      .map((c: any[]) => c[0])
      .filter((cmd: string) => cmd.includes('git checkout -b'));
    expect(checkoutCmds).toHaveLength(0);
    // Rollback should not record BRANCH_CREATED
    const recordCalls = (rollback.record as jest.Mock).mock.calls
      .map((c: any[]) => c[0])
      .filter((step: any) => step.type === 'branch_created');
    expect(recordCalls).toHaveLength(0);
  });

  test('pipeline with reuseBranch (git checkout without -b, BRANCH_SWITCHED) — git checkout called without -b', async () => {
    const strategy = createMockStrategy({
      name: 'release-branch',
      branchName: 'release/1.2.3',
      reuseBranch: true,
      tagName: 'v1.2.3',
      commitMessage: 'Release v1.2.3',
    });
    const registry = createMockStrategyRegistry(strategy);
    const executor = createMockExecutorWithCurrentBranch('develop');
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();

    const result = await runPipeline(baseOpts, {
      executor,
      config: mockConfig,
      rollbackManager: rollback,
      artifactChecker,
      strategyRegistry: registry,
    });

    expect(result.success).toBe(true);
    expect(result.branch).toBe('release/1.2.3');
    // Should call git checkout (without -b) for reuse
    const checkoutCmds = (executor.run as jest.Mock).mock.calls
      .map((c: any[]) => c[0])
      .filter((cmd: string) => cmd.match(/git checkout (?!-b)(?!--)/) && cmd.includes('release/1.2.3'));
    expect(checkoutCmds.length).toBeGreaterThan(0);
    // Should NOT call git checkout -b
    const checkoutNewCmds = (executor.run as jest.Mock).mock.calls
      .map((c: any[]) => c[0])
      .filter((cmd: string) => cmd.includes('git checkout -b'));
    expect(checkoutNewCmds).toHaveLength(0);
    // Rollback should record BRANCH_SWITCHED, not BRANCH_CREATED
    const switchedSteps = (rollback.record as jest.Mock).mock.calls
      .map((c: any[]) => c[0])
      .filter((step: any) => step.type === 'branch_switched');
    expect(switchedSteps.length).toBe(1);
    expect(switchedSteps[0].meta.previousBranch).toBe('develop');
  });

  test('pipeline with policyChecker (warnings → stderr) — warnings written to stderr, pipeline continues', async () => {
    const executor = createMockExecutorWithCurrentBranch('main');
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();
    const strategy = createMockStrategy();
    const registry = createMockStrategyRegistry(strategy);

    const mockPolicyChecker = jest.fn(async () => ({
      warnings: ['Branch "main" has pushRemote configured'],
      errors: [],
      protectionInfo: null,
    }));

    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      const result = await runPipeline(baseOpts, {
        executor,
        config: mockConfig,
        rollbackManager: rollback,
        artifactChecker,
        strategyRegistry: registry,
        policyChecker: mockPolicyChecker,
      });

      expect(result.success).toBe(true);
      expect(mockPolicyChecker).toHaveBeenCalledTimes(1);
      // Warnings should be written to stderr
      const stderrCalls = stderrSpy.mock.calls.map((c: any[]) => c[0]);
      const warningOutput = stderrCalls.some((msg: string) => msg.includes('pushRemote'));
      expect(warningOutput).toBe(true);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  test('pipeline with policyChecker (errors → POLICY_VIOLATION) — throws VersioningsError with POLICY_VIOLATION code', async () => {
    const executor = createMockExecutorWithCurrentBranch('main');
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();
    const strategy = createMockStrategy();
    const registry = createMockStrategyRegistry(strategy);

    const mockPolicyChecker = jest.fn(async () => ({
      warnings: [],
      errors: ['Direct push to protected branch is not allowed'],
      protectionInfo: { protected: true, source: 'scm-api' as const },
    }));

    try {
      await runPipeline(baseOpts, {
        executor,
        config: mockConfig,
        rollbackManager: rollback,
        artifactChecker,
        strategyRegistry: registry,
        policyChecker: mockPolicyChecker,
      });
      throw new Error('Expected to throw');
    } catch (err: any) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.code).toBe(EXIT_CODES.POLICY_VIOLATION);
      expect(err.message).toContain('Direct push to protected branch is not allowed');
    }

    // No mutation commands should have been executed after policy check
    const mutationCmds = (executor.run as jest.Mock).mock.calls
      .map((c: any[]) => c[0])
      .filter((cmd: string) =>
        cmd.includes('git checkout -b') ||
        cmd.includes('git tag --annotate') ||
        cmd.includes('git commit') ||
        cmd.includes('git push')
      );
    expect(mutationCmds).toHaveLength(0);
  });

  test('dry-run with strategy and policyCheck — plan contains strategy and policyCheck fields', async () => {
    const strategy = createMockStrategy({
      name: 'git-flow',
      branchName: 'release/1.2.3',
      tagName: 'v1.2.3',
      commitMessage: 'Release v1.2.3',
    });
    const registry = createMockStrategyRegistry(strategy);
    const executor = createMockExecutorWithCurrentBranch('develop');
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();

    const mockPolicyChecker = jest.fn(async () => ({
      warnings: ['Signed commits required'],
      errors: [],
      protectionInfo: { protected: true, source: 'git-config' as const, gpgSignConfigured: true },
    }));

    const configWithStrategy = {
      ...mockConfig,
      git: {
        ...mockConfig.git,
        branching: { strategy: 'git-flow' },
      },
    };

    const plan = await runPipeline(
      { ...baseOpts, dryRun: true },
      {
        executor,
        config: configWithStrategy,
        rollbackManager: rollback,
        artifactChecker,
        strategyRegistry: registry,
        policyChecker: mockPolicyChecker,
      },
    );

    expect(plan.dryRun).toBe(true);
    expect((plan as any).strategy).toBe('git-flow');
    expect((plan as any).policyCheck).toBeDefined();
    expect((plan as any).policyCheck.warnings).toContain('Signed commits required');
    expect((plan as any).policyCheck.protectionInfo).toBeDefined();
    expect((plan as any).policyCheck.protectionInfo.protected).toBe(true);
  });

  test('backward compatibility (without strategyRegistry → legacy) — existing behavior preserved', async () => {
    const executor = createMockExecutor();
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();

    // No strategyRegistry, no policyChecker — should use legacy functions
    const result = await runPipeline(baseOpts, {
      executor,
      config: mockConfig,
      rollbackManager: rollback,
      artifactChecker,
    });

    expect(result.success).toBe(true);
    expect(result.version).toBe('1.2.3');
    expect(result.branch).toBe('version/patch/1.2.3/fix-login');
    expect(result.tag).toBe('1.2.3--fix-login');
    // strategy field should not be set when no strategyRegistry
    expect((result as any).strategy).toBeUndefined();
  });
});


// --- Auto-bump and Changelog integration tests (Task 9.4) ---

describe('runPipeline — auto-bump and changelog integration', () => {
  function createMockCommitAnalyzer(bumpResultOverrides: Partial<{
    bump: string;
    commits: any[];
    conventionalCommits: any[];
    breakingChanges: any[];
    range: { from: string; to: string };
    commitsByType: Record<string, number>;
  }> = {}) {
    const defaultBumpResult = {
      bump: 'minor',
      commits: [
        { hash: 'abc1234', parsed: { valid: true, type: 'feat', scope: null, description: 'add feature', body: null, footers: [], breaking: false, rawMessage: 'feat: add feature' } },
        { hash: 'def5678', parsed: { valid: true, type: 'fix', scope: 'auth', description: 'fix login', body: null, footers: [], breaking: false, rawMessage: 'fix(auth): fix login' } },
      ],
      conventionalCommits: [
        { valid: true, type: 'feat', scope: null, description: 'add feature', body: null, footers: [], breaking: false, rawMessage: 'feat: add feature' },
        { valid: true, type: 'fix', scope: 'auth', description: 'fix login', body: null, footers: [], breaking: false, rawMessage: 'fix(auth): fix login' },
      ],
      breakingChanges: [],
      range: { from: 'v1.0.0', to: 'HEAD' },
      commitsByType: { feat: 1, fix: 1 },
      ...bumpResultOverrides,
    };

    return {
      analyzeBump: jest.fn(async () => defaultBumpResult),
      bumpPolicy: { feat: 'minor' as const, fix: 'patch' as const, chore: 'none' as const },
      fallbackBump: null as 'major' | 'minor' | 'patch' | null,
    };
  }

  function createMockChangelogGenerator(overrides: Partial<{
    markdown: string;
    groups: any[];
    changelogFile: string;
  }> = {}) {
    const defaultResult = {
      markdown: '## [1.2.3] - 2024-01-01\n\n### Features\n\n- add feature\n\n### Bug Fixes\n\n- fix login (auth)\n',
      groups: [
        { title: 'Features', commits: [{ description: 'add feature', scope: null, breaking: false }] },
        { title: 'Bug Fixes', commits: [{ description: 'fix login', scope: 'auth', breaking: false }] },
      ],
    };

    return {
      generateChangelog: jest.fn(() => ({
        markdown: overrides.markdown ?? defaultResult.markdown,
        groups: overrides.groups ?? defaultResult.groups,
      })),
      changelogConfig: {
        version: '1.2.3',
        date: '2024-01-01',
        format: 'markdown' as const,
        groupTitles: { feat: 'Features', fix: 'Bug Fixes' },
        excludeTypes: [] as string[],
        includeNonConventional: false,
        bumpPolicy: { feat: 'minor' as const, fix: 'patch' as const },
      },
      changelogFile: overrides.changelogFile,
    };
  }

  function createMockExecutorForAuto(currentBranch = 'main') {
    return {
      run: jest.fn(async (cmd: string) => {
        if (cmd.includes('git status --porcelain')) return { stdout: '', lines: [] };
        if (cmd.includes('git remote --verbose')) return { stdout: 'origin\thttps://github.com/user/repo.git (fetch)', lines: ['origin\thttps://github.com/user/repo.git (fetch)'] };
        if (cmd.includes('npm --no-git-tag-version version')) return { stdout: 'v1.2.3', lines: ['v1.2.3'] };
        if (cmd.includes('git checkout -- package')) return { stdout: '', lines: [] };
        if (cmd.includes('git rev-parse --abbrev-ref HEAD')) return { stdout: currentBranch, lines: [currentBranch] };
        if (cmd.includes('git tag --list')) return { stdout: '', lines: [] };
        if (cmd.includes('git branch --list')) return { stdout: '  main', lines: ['main'] };
        if (cmd.includes('git add')) return { stdout: '', lines: [] };
        return { stdout: '', lines: [] };
      }),
    };
  }

  test('pipeline with semver=auto — calls analyzeBump and uses resolvedSemver', async () => {
    const executor = createMockExecutorForAuto();
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();
    const commitAnalyzer = createMockCommitAnalyzer({ bump: 'minor' });

    const result = await runPipeline(
      { ...baseOpts, semver: 'auto' },
      { executor, config: mockConfig, rollbackManager: rollback, artifactChecker, commitAnalyzer },
    );

    expect(result.success).toBe(true);
    expect(commitAnalyzer.analyzeBump).toHaveBeenCalledTimes(1);
    // resolvedSemver should be 'minor' (from analyzeBump)
    expect(result.semver).toBe('minor');
    // npm version command should use 'minor'
    const npmCmds = (executor.run as jest.Mock).mock.calls
      .map((c: any[]) => c[0])
      .filter((cmd: string) => cmd.includes('npm --no-git-tag-version version'));
    expect(npmCmds.length).toBeGreaterThan(0);
    expect(npmCmds[0]).toContain('minor');
    // autoBump info should be in result
    expect(result.autoBump).toBeDefined();
    expect(result.autoBump.detectedBump).toBe('minor');
    expect(result.autoBump.totalCommits).toBe(2);
    expect(result.autoBump.breakingChanges).toBe(0);
    expect(result.autoBump.commitsByType).toEqual({ feat: 1, fix: 1 });
    expect(result.autoBump.range).toEqual({ from: 'v1.0.0', to: 'HEAD' });
  });

  test('pipeline with semver=patch — does not call analyzeBump', async () => {
    const executor = createMockExecutorForAuto();
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();
    const commitAnalyzer = createMockCommitAnalyzer();

    const result = await runPipeline(
      { ...baseOpts, semver: 'patch' },
      { executor, config: mockConfig, rollbackManager: rollback, artifactChecker, commitAnalyzer },
    );

    expect(result.success).toBe(true);
    expect(result.semver).toBe('patch');
    expect(commitAnalyzer.analyzeBump).not.toHaveBeenCalled();
    // autoBump should not be present
    expect(result.autoBump).toBeUndefined();
  });

  test('auto + preid — bump converts to prerelease modifier (minor → preminor)', async () => {
    const executor = createMockExecutorForAuto();
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();
    const commitAnalyzer = createMockCommitAnalyzer({ bump: 'minor' });

    const result = await runPipeline(
      { ...baseOpts, semver: 'auto', preid: 'beta' },
      { executor, config: mockConfig, rollbackManager: rollback, artifactChecker, commitAnalyzer },
    );

    expect(result.success).toBe(true);
    // resolvedSemver should be 'preminor' (minor + preid → preminor)
    expect(result.semver).toBe('preminor');
    // npm version command should use 'preminor' with --preid=beta
    const npmCmds = (executor.run as jest.Mock).mock.calls
      .map((c: any[]) => c[0])
      .filter((cmd: string) => cmd.includes('npm --no-git-tag-version version'));
    expect(npmCmds[0]).toContain('preminor');
    expect(npmCmds[0]).toContain('--preid=beta');
  });

  test('auto + preid — major converts to premajor', async () => {
    const executor = createMockExecutorForAuto();
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();
    const commitAnalyzer = createMockCommitAnalyzer({ bump: 'major' });

    const result = await runPipeline(
      { ...baseOpts, semver: 'auto', preid: 'rc' },
      { executor, config: mockConfig, rollbackManager: rollback, artifactChecker, commitAnalyzer },
    );

    expect(result.success).toBe(true);
    expect(result.semver).toBe('premajor');
  });

  test('auto + preid — patch converts to prepatch', async () => {
    const executor = createMockExecutorForAuto();
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();
    const commitAnalyzer = createMockCommitAnalyzer({ bump: 'patch' });

    const result = await runPipeline(
      { ...baseOpts, semver: 'auto', preid: 'alpha' },
      { executor, config: mockConfig, rollbackManager: rollback, artifactChecker, commitAnalyzer },
    );

    expect(result.success).toBe(true);
    expect(result.semver).toBe('prepatch');
  });

  test('changelog file write — writes changelog and calls git add', async () => {
    const executor = createMockExecutorForAuto();
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();
    const commitAnalyzer = createMockCommitAnalyzer();
    const changelogGenerator = createMockChangelogGenerator({ changelogFile: 'CHANGELOG.md' });

    // File does not exist — should create new
    fs.existsSync.mockImplementation((path: string) => {
      if (path === 'CHANGELOG.md') return false;
      if (path === './package-lock.json') return true;
      return true;
    });

    const result = await runPipeline(
      { ...baseOpts, semver: 'auto' },
      { executor, config: mockConfig, rollbackManager: rollback, artifactChecker, commitAnalyzer, changelogGenerator },
    );

    expect(result.success).toBe(true);
    // writeFileSync should have been called with the changelog file
    expect(fs.writeFileSync).toHaveBeenCalled();
    const writeCall = fs.writeFileSync.mock.calls.find((c: any[]) => c[0] === 'CHANGELOG.md');
    expect(writeCall).toBeDefined();
    expect(writeCall[1]).toContain('# Changelog');
    // git add should have been called for the changelog file
    const gitAddCmds = (executor.run as jest.Mock).mock.calls
      .map((c: any[]) => c[0])
      .filter((cmd: string) => cmd.includes('git add CHANGELOG.md'));
    expect(gitAddCmds.length).toBe(1);
  });

  test('changelog file write — prepends to existing file with header', async () => {
    const executor = createMockExecutorForAuto();
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();
    const commitAnalyzer = createMockCommitAnalyzer();
    const changelogGenerator = createMockChangelogGenerator({ changelogFile: 'CHANGELOG.md' });

    const existingContent = '# Changelog\n\n## [1.0.0] - 2023-01-01\n\n- old entry\n';
    fs.existsSync.mockImplementation((path: string) => {
      if (path === 'CHANGELOG.md') return true;
      if (path === './package-lock.json') return true;
      return true;
    });
    fs.readFileSync.mockImplementation((path: string) => {
      if (path === 'CHANGELOG.md') return existingContent;
      return JSON.stringify({ version: '1.2.2' });
    });

    const result = await runPipeline(
      { ...baseOpts, semver: 'auto' },
      { executor, config: mockConfig, rollbackManager: rollback, artifactChecker, commitAnalyzer, changelogGenerator },
    );

    expect(result.success).toBe(true);
    const writeCall = fs.writeFileSync.mock.calls.find((c: any[]) => c[0] === 'CHANGELOG.md');
    expect(writeCall).toBeDefined();
    // Should start with # Changelog header
    expect(writeCall[1]).toMatch(/^# Changelog/);
    // Should contain new changelog content
    expect(writeCall[1]).toContain('Features');
    // Should preserve old content
    expect(writeCall[1]).toContain('old entry');
  });

  test('dry-run with autoBump and changelogPreview — plan includes both fields', async () => {
    const executor = createMockExecutorForAuto();
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();
    const commitAnalyzer = createMockCommitAnalyzer();
    const changelogGenerator = createMockChangelogGenerator({ changelogFile: 'CHANGELOG.md' });

    const plan = await runPipeline(
      { ...baseOpts, semver: 'auto', dryRun: true },
      { executor, config: mockConfig, rollbackManager: rollback, artifactChecker, commitAnalyzer, changelogGenerator },
    );

    expect(plan.dryRun).toBe(true);
    // autoBump should be present
    expect(plan.autoBump).toBeDefined();
    expect(plan.autoBump.detectedBump).toBe('minor');
    expect(plan.autoBump.totalCommits).toBe(2);
    expect(plan.autoBump.breakingChanges).toBe(0);
    expect(plan.autoBump.commitsByType).toEqual({ feat: 1, fix: 1 });
    expect(plan.autoBump.range).toEqual({ from: 'v1.0.0', to: 'HEAD' });
    // changelogPreview should be present
    expect(plan.changelogPreview).toBeDefined();
    expect(typeof plan.changelogPreview).toBe('string');
    expect(plan.changelogPreview.length).toBeGreaterThan(0);
    // dry-run steps should include changelog write step
    expect(plan.steps.some((s: string) => s.includes('write changelog'))).toBe(true);
    expect(plan.steps.some((s: string) => s.includes('git add CHANGELOG.md'))).toBe(true);
    // No actual file write in dry-run
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  test('dry-run with semver=auto but no changelogFile — no changelog steps in plan', async () => {
    const executor = createMockExecutorForAuto();
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();
    const commitAnalyzer = createMockCommitAnalyzer();
    const changelogGenerator = createMockChangelogGenerator(); // no changelogFile

    const plan = await runPipeline(
      { ...baseOpts, semver: 'auto', dryRun: true },
      { executor, config: mockConfig, rollbackManager: rollback, artifactChecker, commitAnalyzer, changelogGenerator },
    );

    expect(plan.dryRun).toBe(true);
    expect(plan.autoBump).toBeDefined();
    // changelogPreview should still be present (changelog was generated)
    expect(plan.changelogPreview).toBeDefined();
    // But no changelog file write steps
    expect(plan.steps.some((s: string) => s.includes('write changelog'))).toBe(false);
    expect(plan.steps.some((s: string) => s.includes('git add'))).toBe(false);
  });

  test('PR body with changelog — changelogBody passed to prCreator deps', async () => {
    const prResult = {
      url: 'https://github.com/user/repo/pull/99',
      number: 99,
      status: 'created' as const,
      fallbackReason: null,
      platform: 'github',
      warnings: [],
    };
    mockCreatePR.mockResolvedValue(prResult);

    const executor = createMockExecutorForAuto();
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();
    const commitAnalyzer = createMockCommitAnalyzer();
    const changelogGenerator = createMockChangelogGenerator();
    const prCreator = {
      registry: {} as any,
      httpClient: {} as any,
      urlParser: {} as any,
      resolveAuth: jest.fn(() => ({ token: 'test-token', method: 'token' as const })),
      env: {},
    };

    const result = await runPipeline(
      { ...baseOpts, semver: 'auto', push: true },
      { executor, config: mockConfig, rollbackManager: rollback, artifactChecker, commitAnalyzer, changelogGenerator, prCreator },
    );

    expect(result.success).toBe(true);
    expect(mockCreatePR).toHaveBeenCalledTimes(1);
    // The deps passed to createPR should include changelogBody
    const createPRArgs = mockCreatePR.mock.calls[0];
    const prDeps = createPRArgs[4]; // 5th argument is deps
    expect(prDeps.changelogBody).toBeDefined();
    expect(prDeps.changelogBody).toContain('Features');
  });

  test('backward compatibility — without commitAnalyzer, semver=auto throws CONFIG_ERROR', async () => {
    const executor = createMockExecutorForAuto();
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();

    try {
      await runPipeline(
        { ...baseOpts, semver: 'auto' },
        { executor, config: mockConfig, rollbackManager: rollback, artifactChecker },
      );
      throw new Error('Expected to throw');
    } catch (err: any) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
      expect(err.message).toContain('commitAnalyzer');
    }
  });

  test('backward compatibility — without commitAnalyzer, semver=patch works normally', async () => {
    const executor = createMockExecutorForAuto();
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();

    const result = await runPipeline(
      { ...baseOpts, semver: 'patch' },
      { executor, config: mockConfig, rollbackManager: rollback, artifactChecker },
    );

    expect(result.success).toBe(true);
    expect(result.semver).toBe('patch');
    expect(result.autoBump).toBeUndefined();
  });
});
