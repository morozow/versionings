/* Versioning automation tool, 2018-present */

/**
 * Property tests for dry-run mode.
 *
 * Property 1: Dry-run safety
 * Property 2: Dry-run plan completeness in JSON format
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4
 */

const fc = require('fast-check');
const { EXIT_CODES, VersioningsError } = require('../../errors');

// Mock fs — must come before requiring pipeline
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

// --- Mock config (matching VersioningsConfig interface) ---
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
        },
      },
    },
  },
  package: {
    semver: {
      patch: 'patch',
      minor: 'minor',
      major: 'major',
      prepatch: 'prepatch',
      preminor: 'preminor',
      premajor: 'premajor',
      prerelease: 'prerelease',
    },
  },
  common: {
    messages: {
      unavailableSemanticVersion: 'Invalid semver',
      undefinedVersionBranchName: 'Branch name required',
      incorrectVersionBranchNameLength: 'Branch too long, max',
      incorrectVersionBranchNameCharactersDashes: 'No double dashes',
      untrackedGitFiles: 'Dirty tree',
      incorrectGitRemote: 'Wrong remote',
    },
  },
};

// --- Generators ---

/** arbSemver: random valid semver type */
const arbSemver = fc.constantFrom(
  'patch', 'minor', 'major', 'prepatch', 'preminor', 'premajor', 'prerelease'
);

/** arbBranch: random hyphen-case string, 1-95 chars, no '--' */
const arbBranch = fc
  .stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
    { minLength: 1, maxLength: 95 }
  )
  .filter((s) => !/-{2,}/.test(s) && s.trim().length > 0);

/** arbPush: random boolean */
const arbPush = fc.boolean();

// --- Mock factories ---

/** Mutating command patterns that must NOT appear in dry-run */
const MUTATING_PATTERNS = [
  'git checkout -b',
  'git tag --annotate',
  'git commit',
  'git push',
];

/**
 * Check if a command string matches any mutating pattern.
 * Distinguishes mutating from read-only commands:
 * - 'git checkout -b' is mutating, 'git checkout -- package' is NOT
 * - 'git tag --annotate' is mutating, 'git tag --list' is NOT
 */
function isMutatingCommand(cmd) {
  return MUTATING_PATTERNS.some((pattern) => cmd.includes(pattern));
}

/** Create a mock executor that records all commands */
function createMockExecutor() {
  const calls = [];
  return {
    run: jest.fn(async (cmd) => {
      calls.push(cmd);
      if (cmd.includes('git status --porcelain')) return { stdout: '', lines: [] };
      if (cmd.includes('git remote --verbose'))
        return {
          stdout: 'origin\thttps://github.com/user/repo.git (fetch)',
          lines: ['origin\thttps://github.com/user/repo.git (fetch)'],
        };
      if (cmd.includes('npm --no-git-tag-version version'))
        return { stdout: 'v1.2.3', lines: ['v1.2.3'] };
      if (cmd.includes('git checkout -- package'))
        return { stdout: '', lines: [] };
      if (cmd.includes('git tag --list')) return { stdout: '', lines: [] };
      if (cmd.includes('git branch --list')) return { stdout: '  main', lines: ['main'] };
      return { stdout: '', lines: [] };
    }),
    calls,
  };
}

/** Create a mock rollback manager */
function createMockRollbackManager() {
  return {
    record: jest.fn(),
    rollback: jest.fn(async () => ({ success: true, failedSteps: [] })),
  };
}

/** Create a mock artifact checker */
function createMockArtifactChecker() {
  return {
    checkUniqueness: jest.fn(async () => { }),
  };
}

// --- Setup ---

beforeEach(() => {
  fs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.2.2' }));
  fs.existsSync.mockReturnValue(true);
});

afterEach(() => {
  jest.clearAllMocks();
});

// --- Property 1: Dry-run safety ---
// Feature: enterprise-readiness, Property 1: Dry-run safety
describe('Property 1: Dry-run safety', () => {
  // Validates: Requirements 2.1, 2.2, 2.4

  test('for any valid input with dryRun=true, executor receives NO mutating commands and pipeline resolves', async () => {
    await fc.assert(
      fc.asyncProperty(arbSemver, arbBranch, arbPush, async (semver, branch, push) => {
        const executor = createMockExecutor();
        const rollback = createMockRollbackManager();
        const artifactChecker = createMockArtifactChecker();

        const plan = await runPipeline(
          { semver, branch, push, dryRun: true, json: false, verbose: false },
          { executor, config: mockConfig, rollbackManager: rollback, artifactChecker },
        );

        // Pipeline must resolve (not throw) for valid inputs
        expect(plan).toBeDefined();
        expect(plan.dryRun).toBe(true);

        // No mutating commands should have been sent to executor
        const executedCmds = executor.run.mock.calls.map((c) => c[0]);
        const mutatingCmds = executedCmds.filter(isMutatingCommand);
        expect(mutatingCmds).toEqual([]);

        // Rollback manager must not have recorded any steps
        expect(rollback.record).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });

  test('validation checks still run in dry-run — invalid inputs cause errors, not plans', async () => {
    // Generate invalid branches: empty, too long (>=96), or containing '--'
    const arbInvalidBranch = fc.oneof(
      fc.constant(''),
      fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), {
        minLength: 96,
        maxLength: 120,
      }),
      fc.constant('my--branch'),
    );

    await fc.assert(
      fc.asyncProperty(arbSemver, arbInvalidBranch, arbPush, async (semver, branch, push) => {
        const executor = createMockExecutor();
        const rollback = createMockRollbackManager();
        const artifactChecker = createMockArtifactChecker();

        try {
          await runPipeline(
            { semver, branch, push, dryRun: true, json: false, verbose: false },
            { executor, config: mockConfig, rollbackManager: rollback, artifactChecker },
          );
          // Should not reach here for invalid inputs
          throw new Error('Expected VersioningsError');
        } catch (err) {
          expect(err).toBeInstanceOf(VersioningsError);
          expect(err.code).toBe(EXIT_CODES.INVALID_ARGS);
        }

        // No mutating commands even on validation failure
        const executedCmds = executor.run.mock.calls.map((c) => c[0]);
        const mutatingCmds = executedCmds.filter(isMutatingCommand);
        expect(mutatingCmds).toEqual([]);

        // Rollback must not be invoked
        expect(rollback.record).not.toHaveBeenCalled();
        expect(rollback.rollback).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 2: Dry-run plan completeness in JSON format ---
// Feature: enterprise-readiness, Property 2: Dry-run plan completeness in JSON format
describe('Property 2: Dry-run plan completeness in JSON format', () => {
  // Validates: Requirements 2.3

  test('for any valid input with dryRun=true and json=true, plan contains all required fields and is valid JSON', async () => {
    const { createReporter } = require('../../reporter');

    await fc.assert(
      fc.asyncProperty(arbSemver, arbBranch, arbPush, async (semver, branch, push) => {
        const executor = createMockExecutor();
        const rollback = createMockRollbackManager();
        const artifactChecker = createMockArtifactChecker();

        const plan = await runPipeline(
          { semver, branch, push, dryRun: true, json: true, verbose: false },
          { executor, config: mockConfig, rollbackManager: rollback, artifactChecker },
        );

        // Pipe through reporter in JSON mode to get the actual JSON output
        const reporter = createReporter({ json: true });
        const jsonOutput = reporter.reportDryRun(plan);

        // Must parse as valid JSON
        const parsed = JSON.parse(jsonOutput);

        // Required fields must be present
        expect(parsed).toHaveProperty('dryRun');
        expect(parsed).toHaveProperty('currentVersion');
        expect(parsed).toHaveProperty('nextVersion');
        expect(parsed).toHaveProperty('semver');
        expect(parsed).toHaveProperty('branch');
        expect(parsed).toHaveProperty('tag');
        expect(parsed).toHaveProperty('commitMessage');
        expect(parsed).toHaveProperty('steps');

        // Type checks
        expect(parsed.dryRun).toBe(true);
        expect(typeof parsed.currentVersion).toBe('string');
        expect(typeof parsed.nextVersion).toBe('string');
        expect(typeof parsed.semver).toBe('string');
        expect(typeof parsed.branch).toBe('string');
        expect(typeof parsed.tag).toBe('string');
        expect(typeof parsed.commitMessage).toBe('string');
        expect(Array.isArray(parsed.steps)).toBe(true);
        expect(parsed.steps.length).toBeGreaterThan(0);

        // Semver in plan must match input
        expect(parsed.semver).toBe(semver);

        // Round-trip: JSON.parse(JSON.stringify(parsed)) deep equals parsed
        expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed);
      }),
      { numRuns: 100 },
    );
  });
});
