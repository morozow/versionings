/* Versioning automation tool, 2018-present */

const fc = require('fast-check');
const { createArtifactChecker } = require('../../artifact.checker');
const { EXIT_CODES, VersioningsError } = require('../../errors');

// --- Generators ---

/** Git-safe characters for names (no whitespace, no ^{}, no newlines) */
const gitSafeChar = fc.constantFrom(
  ...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')
);

/** arbComment: random git-safe comment string */
const arbComment = fc.stringOf(gitSafeChar, { minLength: 1, maxLength: 20 });

/** arbVersion: random version like X.Y.Z */
const arbVersion = fc
  .tuple(
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 })
  )
  .map(([x, y, z]) => `${x}.${y}.${z}`);

/** arbSemverType: random semver type for branch names */
const arbSemverType = fc.constantFrom('patch', 'minor', 'major');

/** arbTagName: random string like X.Y.Z--comment */
const arbTagName = fc
  .tuple(arbVersion, arbComment)
  .map(([v, c]) => `${v}--${c}`);

/** arbBranchName: random string like version/type/X.Y.Z/comment */
const arbBranchName = fc
  .tuple(arbSemverType, arbVersion, arbComment)
  .map(([t, v, c]) => `version/${t}/${v}/${c}`);

/** arbExistingTags: array of random tag names */
const arbExistingTags = fc.array(arbTagName, { minLength: 0, maxLength: 10 });

/** arbExistingBranches: array of random branch names */
const arbExistingBranches = fc.array(arbBranchName, { minLength: 0, maxLength: 10 });

// --- Mock executor factory ---

/**
 * Creates a mock executor that tracks all commands and returns canned
 * tag/branch lists based on command patterns.
 *
 * @param {Object} opts
 * @param {string[]} opts.localTags — list of local tag names
 * @param {string[]} opts.localBranches — list of local branch names
 * @param {string[]} opts.remoteTags — list of remote tag names
 * @param {string[]} opts.remoteBranches — list of remote branch names
 * @returns {{ run: Function, commands: string[] }}
 */
function createTrackingExecutor({ localTags = [], localBranches = [], remoteTags = [], remoteBranches = [] } = {}) {
  const commands = [];
  return {
    run: async (cmd) => {
      commands.push(cmd);

      if (cmd === 'git tag --list') {
        const stdout = localTags.join('\n');
        return { stdout, lines: localTags.filter(Boolean) };
      }

      if (cmd === 'git branch --list') {
        const stdout = localBranches.map((b) => `  ${b}`).join('\n');
        return { stdout, lines: localBranches };
      }

      if (cmd.startsWith('git ls-remote --tags')) {
        const stdout = remoteTags
          .map((t) => `abc123\trefs/tags/${t}`)
          .join('\n');
        return { stdout, lines: stdout.split('\n').filter(Boolean) };
      }

      if (cmd.startsWith('git ls-remote --heads')) {
        const stdout = remoteBranches
          .map((b) => `def456\trefs/heads/${b}`)
          .join('\n');
        return { stdout, lines: stdout.split('\n').filter(Boolean) };
      }

      return { stdout: '', lines: [] };
    },
    commands,
  };
}

/** Mutating command patterns that must NOT appear during uniqueness checks */
const MUTATING_PATTERNS = [
  'npm version',
  'git checkout -b',
  'git tag ',      // note: 'git tag --list' is read-only, but 'git tag <name>' is mutating
  'git commit',
  'git push',
];

/** Read-only commands that the checker is allowed to execute */
function isReadOnlyCommand(cmd) {
  return (
    cmd === 'git tag --list' ||
    cmd === 'git branch --list' ||
    cmd.startsWith('git ls-remote --tags') ||
    cmd.startsWith('git ls-remote --heads')
  );
}

// --- Property 13 ---
// Feature: enterprise-readiness, Property 13: Exact match of artifact names
describe('Property 13: Exact match of artifact names', () => {
  // Validates: Requirements 10.1, 10.2

  test('no conflict when existing tags/branches are substrings or prefixes of target', async () => {
    await fc.assert(
      fc.asyncProperty(arbTagName, arbBranchName, async (tagName, branchName) => {
        // Create existing names that are prefixes/suffixes/superstrings but NOT exact matches
        const prefixTag = tagName + 'extra';
        const suffixTag = 'pre' + tagName;
        const prefixBranch = branchName + '/extra';
        const suffixBranch = 'pre/' + branchName;

        const executor = createTrackingExecutor({
          localTags: [prefixTag, suffixTag],
          localBranches: [prefixBranch, suffixBranch],
        });
        const checker = createArtifactChecker(executor);

        // Should NOT throw — no exact match
        await checker.checkUniqueness({
          tagName,
          branchName,
          push: false,
        });
      }),
      { numRuns: 100 }
    );
  });

  test('conflict IS detected on exact tag name match', async () => {
    await fc.assert(
      fc.asyncProperty(arbTagName, arbBranchName, arbExistingTags, async (tagName, branchName, otherTags) => {
        // Include the exact tag name in the existing list
        const localTags = [...otherTags.filter((t) => t !== tagName), tagName];

        const executor = createTrackingExecutor({
          localTags,
          localBranches: [],
        });
        const checker = createArtifactChecker(executor);

        try {
          await checker.checkUniqueness({ tagName, branchName, push: false });
          throw new Error('Expected VersioningsError to be thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(VersioningsError);
          expect(err.code).toBe(EXIT_CODES.ARTIFACT_CONFLICT);
          expect(err.details.type).toBe('tag');
          expect(err.details.name).toBe(tagName);
        }
      }),
      { numRuns: 100 }
    );
  });

  test('conflict IS detected on exact branch name match', async () => {
    await fc.assert(
      fc.asyncProperty(arbTagName, arbBranchName, arbExistingBranches, async (tagName, branchName, otherBranches) => {
        // Include the exact branch name in the existing list
        const localBranches = [...otherBranches.filter((b) => b !== branchName), branchName];

        const executor = createTrackingExecutor({
          localTags: [],
          localBranches,
        });
        const checker = createArtifactChecker(executor);

        try {
          await checker.checkUniqueness({ tagName, branchName, push: false });
          throw new Error('Expected VersioningsError to be thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(VersioningsError);
          expect(err.code).toBe(EXIT_CODES.ARTIFACT_CONFLICT);
          expect(err.details.type).toBe('branch');
          expect(err.details.name).toBe(branchName);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// --- Property 14 ---
// Feature: enterprise-readiness, Property 14: Remote artifact check on push
describe('Property 14: Remote artifact check on push', () => {
  // Validates: Requirements 10.3

  test('when push===true, executor receives git ls-remote --tags and --heads commands', async () => {
    await fc.assert(
      fc.asyncProperty(arbTagName, arbBranchName, async (tagName, branchName) => {
        const executor = createTrackingExecutor({
          localTags: [],
          localBranches: [],
          remoteTags: [],
          remoteBranches: [],
        });
        const checker = createArtifactChecker(executor);

        await checker.checkUniqueness({ tagName, branchName, push: true });

        const hasLsRemoteTags = executor.commands.some((c) => c.startsWith('git ls-remote --tags'));
        const hasLsRemoteHeads = executor.commands.some((c) => c.startsWith('git ls-remote --heads'));

        expect(hasLsRemoteTags).toBe(true);
        expect(hasLsRemoteHeads).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  test('when push===false, executor does NOT receive any ls-remote commands', async () => {
    await fc.assert(
      fc.asyncProperty(arbTagName, arbBranchName, async (tagName, branchName) => {
        const executor = createTrackingExecutor({
          localTags: [],
          localBranches: [],
        });
        const checker = createArtifactChecker(executor);

        await checker.checkUniqueness({ tagName, branchName, push: false });

        const hasLsRemote = executor.commands.some((c) => c.includes('ls-remote'));
        expect(hasLsRemote).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  test('when push===true and remote is omitted, commands use "origin"', async () => {
    await fc.assert(
      fc.asyncProperty(arbTagName, arbBranchName, async (tagName, branchName) => {
        const executor = createTrackingExecutor({
          localTags: [],
          localBranches: [],
          remoteTags: [],
          remoteBranches: [],
        });
        const checker = createArtifactChecker(executor);

        await checker.checkUniqueness({ tagName, branchName, push: true });

        const lsRemoteCmds = executor.commands.filter((c) => c.includes('ls-remote'));
        for (const cmd of lsRemoteCmds) {
          expect(cmd).toContain('origin');
        }
      }),
      { numRuns: 100 }
    );
  });
});

// --- Property 15 ---
// Feature: enterprise-readiness, Property 15: Conflict error structure
describe('Property 15: Conflict error structure', () => {
  // Validates: Requirements 10.4

  test('local tag conflict error contains type=tag, full name, and scope=local', async () => {
    await fc.assert(
      fc.asyncProperty(arbTagName, arbBranchName, async (tagName, branchName) => {
        const executor = createTrackingExecutor({
          localTags: [tagName],
          localBranches: [],
        });
        const checker = createArtifactChecker(executor);

        try {
          await checker.checkUniqueness({ tagName, branchName, push: false });
          throw new Error('Expected VersioningsError');
        } catch (err) {
          expect(err).toBeInstanceOf(VersioningsError);
          expect(err.code).toBe(EXIT_CODES.ARTIFACT_CONFLICT);
          expect(err.details).toEqual({
            type: 'tag',
            name: tagName,
            scope: 'local',
          });
        }
      }),
      { numRuns: 100 }
    );
  });

  test('local branch conflict error contains type=branch, full name, and scope=local', async () => {
    await fc.assert(
      fc.asyncProperty(arbTagName, arbBranchName, async (tagName, branchName) => {
        const executor = createTrackingExecutor({
          localTags: [],
          localBranches: [branchName],
        });
        const checker = createArtifactChecker(executor);

        try {
          await checker.checkUniqueness({ tagName, branchName, push: false });
          throw new Error('Expected VersioningsError');
        } catch (err) {
          expect(err).toBeInstanceOf(VersioningsError);
          expect(err.code).toBe(EXIT_CODES.ARTIFACT_CONFLICT);
          expect(err.details).toEqual({
            type: 'branch',
            name: branchName,
            scope: 'local',
          });
        }
      }),
      { numRuns: 100 }
    );
  });

  test('remote tag conflict error contains type=tag, full name, and scope=remote', async () => {
    await fc.assert(
      fc.asyncProperty(arbTagName, arbBranchName, async (tagName, branchName) => {
        const executor = createTrackingExecutor({
          localTags: [],
          localBranches: [],
          remoteTags: [tagName],
          remoteBranches: [],
        });
        const checker = createArtifactChecker(executor);

        try {
          await checker.checkUniqueness({ tagName, branchName, push: true });
          throw new Error('Expected VersioningsError');
        } catch (err) {
          expect(err).toBeInstanceOf(VersioningsError);
          expect(err.code).toBe(EXIT_CODES.ARTIFACT_CONFLICT);
          expect(err.details).toEqual({
            type: 'tag',
            name: tagName,
            scope: 'remote',
          });
        }
      }),
      { numRuns: 100 }
    );
  });

  test('remote branch conflict error contains type=branch, full name, and scope=remote', async () => {
    await fc.assert(
      fc.asyncProperty(arbTagName, arbBranchName, async (tagName, branchName) => {
        const executor = createTrackingExecutor({
          localTags: [],
          localBranches: [],
          remoteTags: [],
          remoteBranches: [branchName],
        });
        const checker = createArtifactChecker(executor);

        try {
          await checker.checkUniqueness({ tagName, branchName, push: true });
          throw new Error('Expected VersioningsError');
        } catch (err) {
          expect(err).toBeInstanceOf(VersioningsError);
          expect(err.code).toBe(EXIT_CODES.ARTIFACT_CONFLICT);
          expect(err.details).toEqual({
            type: 'branch',
            name: branchName,
            scope: 'remote',
          });
        }
      }),
      { numRuns: 100 }
    );
  });
});

// --- Property 16 ---
// Feature: enterprise-readiness, Property 16: Uniqueness checks before mutations
describe('Property 16: Uniqueness checks before mutations', () => {
  // Validates: Requirements 10.5

  test('on local tag conflict, executor only receives read-only commands', async () => {
    await fc.assert(
      fc.asyncProperty(arbTagName, arbBranchName, async (tagName, branchName) => {
        const executor = createTrackingExecutor({
          localTags: [tagName],
          localBranches: [],
        });
        const checker = createArtifactChecker(executor);

        try {
          await checker.checkUniqueness({ tagName, branchName, push: false });
        } catch (_) {
          // expected
        }

        // Every command must be read-only
        for (const cmd of executor.commands) {
          expect(isReadOnlyCommand(cmd)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  test('on local branch conflict, executor only receives read-only commands', async () => {
    await fc.assert(
      fc.asyncProperty(arbTagName, arbBranchName, async (tagName, branchName) => {
        const executor = createTrackingExecutor({
          localTags: [],
          localBranches: [branchName],
        });
        const checker = createArtifactChecker(executor);

        try {
          await checker.checkUniqueness({ tagName, branchName, push: false });
        } catch (_) {
          // expected
        }

        for (const cmd of executor.commands) {
          expect(isReadOnlyCommand(cmd)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  test('on remote conflict with push=true, executor only receives read-only commands', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbTagName,
        arbBranchName,
        fc.constantFrom('tag', 'branch'),
        async (tagName, branchName, conflictType) => {
          const opts =
            conflictType === 'tag'
              ? { localTags: [], localBranches: [], remoteTags: [tagName], remoteBranches: [] }
              : { localTags: [], localBranches: [], remoteTags: [], remoteBranches: [branchName] };

          const executor = createTrackingExecutor(opts);
          const checker = createArtifactChecker(executor);

          try {
            await checker.checkUniqueness({ tagName, branchName, push: true });
          } catch (_) {
            // expected
          }

          for (const cmd of executor.commands) {
            expect(isReadOnlyCommand(cmd)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('no conflict scenario also only uses read-only commands', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbTagName,
        arbBranchName,
        fc.boolean(),
        async (tagName, branchName, push) => {
          const executor = createTrackingExecutor({
            localTags: [],
            localBranches: [],
            remoteTags: [],
            remoteBranches: [],
          });
          const checker = createArtifactChecker(executor);

          await checker.checkUniqueness({ tagName, branchName, push });

          for (const cmd of executor.commands) {
            expect(isReadOnlyCommand(cmd)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
