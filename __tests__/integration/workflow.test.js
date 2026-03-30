/* Versioning automation tool, 2018-present */

/**
 * Integration tests: Full workflow with real modules and mock executor.
 * Tests the integration between pipeline, rollback, artifact checker, and reporter.
 *
 * Validates: Requirements 1.3
 */

const { EXIT_CODES, VersioningsError } = require('../../errors');

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
    `https://github.com/user/repo/compare/master...${branch}?expand=1`,
}));

// Real implementations
const { runPipeline } = require('../../pipeline');
const { createExecutor } = require('../../executor');
const { createRollbackManager } = require('../../rollback');
const { createArtifactChecker } = require('../../artifact.checker');
const { createReporter } = require('../../reporter');

// Shared mock config matching VersioningsConfig interface
const mockConfig = {
  git: {
    platform: 'github',
    url: 'https://github.com/user/repo.git',
    branchType: { version: 'version' },
    pr: { target: 'master' },
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
        },
      },
    },
  },
  package: {
    semver: {
      patch: 'patch', prepatch: 'prepatch', minor: 'minor',
      preminor: 'preminor', premajor: 'premajor',
      prerelease: 'prerelease', major: 'major',
    },
  },
  common: {
    messages: {
      unavailableSemanticVersion: 'Invalid semver',
      undefinedVersionBranchName: 'Branch name required',
      incorrectVersionBranchNameLength: 'Branch too long',
      incorrectVersionBranchNameCharactersDashes: 'No double dashes',
      untrackedGitFiles: 'Dirty tree',
      incorrectGitRemote: 'Wrong remote',
    },
  },
};

/**
 * Creates a mock execFn that simulates git/npm commands.
 * Tracks all executed commands for assertions.
 * @param {Object} overrides - command substring → callback override
 * @returns {{ execFn: Function, commands: string[] }}
 */
function createMockExecFn(overrides = {}) {
  const commands = [];

  const execFn = (cmd, callback) => {
    commands.push(cmd);

    // Check overrides first
    for (const [pattern, handler] of Object.entries(overrides)) {
      if (cmd.includes(pattern)) {
        handler(cmd, callback);
        return;
      }
    }

    // Default responses for known commands
    if (cmd.includes('git status --porcelain')) {
      callback(null, '', '');
    } else if (cmd.includes('git remote --verbose')) {
      callback(null, 'origin\thttps://github.com/user/repo.git (fetch)\n', '');
    } else if (cmd.includes('npm --no-git-tag-version version')) {
      callback(null, 'v1.2.3\n', '');
    } else if (cmd.includes('git checkout -- package')) {
      callback(null, '', '');
    } else if (cmd.includes('git tag --list')) {
      callback(null, '', '');
    } else if (cmd.includes('git branch --list')) {
      callback(null, '  main\n', '');
    } else if (cmd.includes('git ls-remote')) {
      callback(null, '', '');
    } else {
      // Default success for mutation and rollback commands
      callback(null, '', '');
    }
  };

  return { execFn, commands };
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

describe('Integration: Full workflow', () => {
  test('successful workflow (no push) — returns PipelineResult, rollback has recorded steps', async () => {
    const { execFn, commands } = createMockExecFn();
    const executor = createExecutor(execFn);
    const rollbackManager = createRollbackManager(executor);
    const artifactChecker = createArtifactChecker(executor);

    const result = await runPipeline(baseOpts, {
      executor,
      config: mockConfig,
      rollbackManager,
      artifactChecker,
    });

    // Verify PipelineResult shape
    expect(result.success).toBe(true);
    expect(result.version).toBe('1.2.3');
    expect(result.previousVersion).toBe('1.2.2');
    expect(result.semver).toBe('patch');
    expect(result.branch).toBe('version/patch/1.2.3/fix-login');
    expect(result.tag).toBe('1.2.3--fix-login');
    expect(result.pullRequestUrl).toBeNull();
    expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);

    // Verify mutation commands were executed
    const mutationCmds = commands.filter(
      (cmd) =>
        cmd.includes('git checkout -b') ||
        cmd.includes('git tag --annotate') ||
        cmd.includes('git commit --all') ||
        (cmd.includes('npm') && !cmd.includes('git checkout -- package'))
    );
    expect(mutationCmds.length).toBeGreaterThanOrEqual(4);

    // No push command
    const pushCmds = commands.filter((cmd) => cmd.includes('git push'));
    expect(pushCmds).toHaveLength(0);

    // Reporter can format the result
    const reporter = createReporter({ json: true });
    const output = reporter.reportSuccess(result);
    const parsed = JSON.parse(output);
    expect(parsed.success).toBe(true);
    expect(parsed.version).toBe('1.2.3');
  });

  test('successful workflow with push — includes push step and PR URL', async () => {
    const { execFn, commands } = createMockExecFn();
    const executor = createExecutor(execFn);
    const rollbackManager = createRollbackManager(executor);
    const artifactChecker = createArtifactChecker(executor);

    const result = await runPipeline(
      { ...baseOpts, push: true },
      { executor, config: mockConfig, rollbackManager, artifactChecker },
    );

    expect(result.success).toBe(true);
    expect(result.version).toBe('1.2.3');
    expect(result.pullRequestUrl).toBeTruthy();
    expect(result.pullRequestUrl).toContain('github.com');

    // Push command was executed
    const pushCmds = commands.filter((cmd) => cmd.includes('git push'));
    expect(pushCmds.length).toBeGreaterThanOrEqual(1);

    // ls-remote commands were executed (artifact checker with push=true)
    const lsRemoteCmds = commands.filter((cmd) => cmd.includes('git ls-remote'));
    expect(lsRemoteCmds.length).toBeGreaterThanOrEqual(2);
  });

  test('dry-run workflow — returns DryRunPlan, no mutation steps recorded', async () => {
    const { execFn, commands } = createMockExecFn();
    const executor = createExecutor(execFn);
    const rollbackManager = createRollbackManager(executor);
    const artifactChecker = createArtifactChecker(executor);

    const plan = await runPipeline(
      { ...baseOpts, dryRun: true },
      { executor, config: mockConfig, rollbackManager, artifactChecker },
    );

    // Verify DryRunPlan shape
    expect(plan.dryRun).toBe(true);
    expect(plan.currentVersion).toBe('1.2.2');
    expect(plan.nextVersion).toBe('1.2.3');
    expect(plan.semver).toBe('patch');
    expect(plan.branch).toBe('version/patch/1.2.3/fix-login');
    expect(plan.tag).toBe('1.2.3--fix-login');
    expect(plan.commitMessage).toBeDefined();
    expect(Array.isArray(plan.steps)).toBe(true);
    expect(plan.steps.length).toBeGreaterThan(0);

    // No mutation commands executed
    const mutationCmds = commands.filter(
      (cmd) =>
        cmd.includes('git checkout -b') ||
        cmd.includes('git tag --annotate') ||
        cmd.includes('git commit') ||
        cmd.includes('git push')
    );
    expect(mutationCmds).toHaveLength(0);

    // Reporter can format the dry-run plan
    const reporter = createReporter({ json: true });
    const output = reporter.reportDryRun(plan);
    const parsed = JSON.parse(output);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.nextVersion).toBe('1.2.3');
  });

  test('workflow with artifact conflict — throws ARTIFACT_CONFLICT before any mutations', async () => {
    // Simulate existing tag that conflicts
    const { execFn, commands } = createMockExecFn({
      'git tag --list': (_cmd, cb) => {
        cb(null, '1.2.3--fix-login\n', '');
      },
    });
    const executor = createExecutor(execFn);
    const rollbackManager = createRollbackManager(executor);
    const artifactChecker = createArtifactChecker(executor);

    let caughtError;
    try {
      await runPipeline(baseOpts, {
        executor,
        config: mockConfig,
        rollbackManager,
        artifactChecker,
      });
      throw new Error('Expected to throw');
    } catch (err) {
      caughtError = err;
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.code).toBe(EXIT_CODES.ARTIFACT_CONFLICT);
      expect(err.details.type).toBe('tag');
    }

    // No mutation commands were executed
    const mutationCmds = commands.filter(
      (cmd) =>
        cmd.includes('git checkout -b') ||
        cmd.includes('git tag --annotate') ||
        cmd.includes('git commit') ||
        cmd.includes('git push')
    );
    expect(mutationCmds).toHaveLength(0);

    // Reporter can format the error
    const reporter = createReporter({ json: true });
    const output = reporter.reportError(caughtError);
    const parsed = JSON.parse(output);
    expect(parsed.success).toBe(false);
    expect(parsed.exitCode).toBe(EXIT_CODES.ARTIFACT_CONFLICT);
  });

  test('workflow with error and successful rollback — original error re-thrown', async () => {
    // Make git commit fail (after branch and tag are created)
    const { execFn, commands } = createMockExecFn({
      'git commit --all': (_cmd, cb) => {
        const err = new Error('commit failed');
        err.code = 1;
        cb(err, '', 'fatal: nothing to commit');
      },
    });
    const executor = createExecutor(execFn);
    const rollbackManager = createRollbackManager(executor);
    const artifactChecker = createArtifactChecker(executor);

    try {
      await runPipeline(baseOpts, {
        executor,
        config: mockConfig,
        rollbackManager,
        artifactChecker,
      });
      throw new Error('Expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.code).toBe(EXIT_CODES.COMMAND_FAILED);
      expect(err.message).toContain('commit');
    }

    // Rollback commands were executed (in reverse order)
    const rollbackCmds = commands.filter(
      (cmd) =>
        cmd.includes('git tag -d') ||
        cmd.includes('git branch -D') ||
        cmd.includes('git reset --hard')
    );
    expect(rollbackCmds.length).toBeGreaterThanOrEqual(1);
  });
});
