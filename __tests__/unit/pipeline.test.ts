// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { EXIT_CODES, VersioningsError } from '../../errors';

// Mock fs for package.json reads
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    readFileSync: jest.fn(),
    existsSync: jest.fn(),
  };
});

const fs = require('fs');

// Mock version.utils to avoid config.ts side-effect
jest.mock('../../version.utils', () => ({
  AVAILABLE_SEMVERS: ['patch', 'minor', 'major', 'prepatch', 'preminor', 'premajor', 'prerelease'],
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
