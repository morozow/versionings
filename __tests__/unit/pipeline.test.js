/* Versioning automation tool, 2018-present */

/**
 * Validates: Requirements 1.1, 2.1, 2.2, 3.2
 */

const { EXIT_CODES, VersioningsError } = require('../../errors');

// Mock fs for package.json reads — provide manual mock with jest.fn()
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    readFileSync: jest.fn(),
    existsSync: jest.fn(),
  };
});

const fs = require('fs');

// Mock version.utils to avoid config.ts side-effect (process.exit at require time)
jest.mock('../../version.utils', () => ({
  AVAILABLE_SEMVERS: ['patch', 'minor', 'major', 'prepatch', 'preminor', 'premajor', 'prerelease'],
  composeVersionBranchName: (semver, version, comment) =>
    `version/${semver}/${version}/${comment}`,
  composeVersionTagName: (semver, version, comment) =>
    `${version}--${comment}`,
  semverMessage: (semver, version) =>
    `Patch: v${version}. You SHOULD consider changes.`,
  semverNpmMessage: (semver, branch) =>
    `Version: ${semver}. Comment: ${branch}.`,
  preidParam: (preid) => (preid ? `--preid=${preid}` : ''),
  generatePullRequestUrl: (branch) =>
    `https://github.com/user/repo/compare/develop...${branch}?expand=1`,
}));

const { runPipeline } = require('../../pipeline');

// Mock config (matching VersioningsConfig interface)
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
};

// Mock executor
function createMockExecutor() {
  return {
    run: jest.fn(async (cmd) => {
      if (cmd.includes('git status --porcelain')) return { stdout: '', lines: [] };
      if (cmd.includes('git remote --verbose')) return { stdout: 'origin\thttps://github.com/user/repo.git (fetch)', lines: ['origin\thttps://github.com/user/repo.git (fetch)'] };
      if (cmd.includes('npm --no-git-tag-version version')) return { stdout: 'v1.2.3', lines: ['v1.2.3'] };
      if (cmd.includes('git checkout -- package')) return { stdout: '', lines: [] };
      if (cmd.includes('git tag --list')) return { stdout: '', lines: [] };
      if (cmd.includes('git branch --list')) return { stdout: '  main', lines: ['main'] };
      // Default for mutation commands
      return { stdout: '', lines: [] };
    }),
  };
}

// Mock rollback manager
function createMockRollbackManager(rollbackSuccess = true) {
  return {
    record: jest.fn(),
    rollback: jest.fn(async () => ({
      success: rollbackSuccess,
      failedSteps: rollbackSuccess ? [] : [{ step: { type: 'pushed', meta: {} }, error: new Error('network') }],
    })),
  };
}

// Mock artifact checker
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
    // Mutation commands were called
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
    // No mutation commands recorded
    expect(rollback.record).not.toHaveBeenCalled();
    // No mutation commands executed (only validation + probe commands)
    const mutationCmds = executor.run.mock.calls
      .map(c => c[0])
      .filter(cmd =>
        cmd.includes('git checkout -b') ||
        cmd.includes('git tag --annotate') ||
        cmd.includes('git commit') ||
        cmd.includes('git push')
      );
    expect(mutationCmds).toHaveLength(0);
  });

  test('error with rollback — when a mutation step fails, rollback is called', async () => {
    const executor = createMockExecutor();
    // Make the git checkout -b (branch creation) fail
    executor.run.mockImplementation(async (cmd) => {
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
    } catch (err) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.code).toBe(EXIT_CODES.INVALID_ARGS);
    }
  });

  test('dirty tree — non-empty git status throws DIRTY_TREE', async () => {
    const executor = createMockExecutor();
    executor.run.mockImplementation(async (cmd) => {
      if (cmd.includes('git status --porcelain')) return { stdout: 'M file.js', lines: ['M file.js'] };
      return { stdout: '', lines: [] };
    });
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();

    try {
      await runPipeline(baseOpts, { executor, config: mockConfig, rollbackManager: rollback, artifactChecker });
      throw new Error('Expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.code).toBe(EXIT_CODES.DIRTY_TREE);
    }
  });

  test('incomplete rollback — when rollback fails, throws INCOMPLETE_ROLLBACK (exit code 7)', async () => {
    const executor = createMockExecutor();
    // Make a mutation step fail
    executor.run.mockImplementation(async (cmd) => {
      if (cmd.includes('git status --porcelain')) return { stdout: '', lines: [] };
      if (cmd.includes('git remote --verbose')) return { stdout: 'origin\thttps://github.com/user/repo.git (fetch)', lines: ['origin\thttps://github.com/user/repo.git (fetch)'] };
      if (cmd.includes('npm --no-git-tag-version version')) return { stdout: 'v1.2.3', lines: ['v1.2.3'] };
      if (cmd.includes('git checkout -- package')) return { stdout: '', lines: [] };
      if (cmd.includes('git checkout -b')) throw new VersioningsError(EXIT_CODES.COMMAND_FAILED, 'branch failed');
      return { stdout: '', lines: [] };
    });
    // Rollback also fails
    const rollback = createMockRollbackManager(false);
    const artifactChecker = createMockArtifactChecker();

    try {
      await runPipeline(baseOpts, { executor, config: mockConfig, rollbackManager: rollback, artifactChecker });
      throw new Error('Expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.code).toBe(EXIT_CODES.INCOMPLETE_ROLLBACK);
      expect(err.details).toBeDefined();
      expect(err.details.failedSteps).toBeDefined();
      expect(err.details.failedSteps.length).toBeGreaterThan(0);
    }
  });
});
