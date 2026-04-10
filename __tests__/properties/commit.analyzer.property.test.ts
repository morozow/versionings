// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau
// Feature: version-intelligence-release-narrative
// Property 3: Maximum bump determination with BumpPolicy
// Property 4: Breaking change always leads to major
// Property 5: Fallback when no conventional commits

import * as fc from 'fast-check';
import {
  analyzeBump,
  DEFAULT_BUMP_POLICY,
} from '../../commit.analyzer';
import type { BumpPolicy, BumpLevel, CommitAnalyzerDeps } from '../../commit.analyzer';
import type { Executor, ExecutorResult } from '../../executor';
import { EXIT_CODES, VersioningsError } from '../../errors';
import { COMMIT_SEPARATOR } from '../../commit.parser';

// ── Helpers ─────────────────────────────────────────────────────────────────

function ok(stdout: string): ExecutorResult {
  const trimmed = stdout.trim();
  const lines = trimmed ? trimmed.split('\n').filter(Boolean) : [];
  return { stdout: trimmed, lines };
}

/** Builds a git log chunk for a single commit */
function logEntry(hash: string, message: string): string {
  return `${hash}\n${message}\n\n${COMMIT_SEPARATOR}\n`;
}

/**
 * Creates a mock executor that returns a tag and git log output.
 * The tag lookup always returns 'v1.0.0' so analyzeBump uses tag..HEAD range.
 */
function createTagAndLogExecutor(gitLogOutput: string): Executor {
  return {
    run(cmd: string): Promise<ExecutorResult> {
      if (cmd.includes('git tag --list')) {
        return Promise.resolve(ok('v1.0.0'));
      }
      if (cmd.includes('git log')) {
        return Promise.resolve(ok(gitLogOutput));
      }
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    },
  };
}

function makeDeps(
  executor: Executor,
  bumpPolicy: BumpPolicy,
  fallbackBump: 'major' | 'minor' | 'patch' | null,
): CommitAnalyzerDeps {
  return { executor, bumpPolicy, fallbackBump };
}

// ── Arbitraries ─────────────────────────────────────────────────────────────

/** Safe alphanumeric string for commit descriptions */
const arbSafeString = fc.stringOf(
  fc.mapToConstant(
    { num: 26, build: (v) => String.fromCharCode(97 + v) },  // a-z
    { num: 10, build: (v) => String.fromCharCode(48 + v) },  // 0-9
    { num: 1, build: () => ' ' },
    { num: 1, build: () => '-' },
  ),
  { minLength: 1, maxLength: 40 },
).map((s) => s.trim()).filter((s) => s.length > 0);

/** Standard conventional commit types */
const arbConventionalType = fc.constantFrom(
  'feat', 'fix', 'chore', 'docs', 'style', 'refactor',
  'perf', 'test', 'build', 'ci', 'revert',
);

/** Bump level for policy generation */
const arbBumpLevel: fc.Arbitrary<BumpLevel> = fc.constantFrom(
  'major' as BumpLevel,
  'minor' as BumpLevel,
  'patch' as BumpLevel,
  'none' as BumpLevel,
);

/** Non-none bump level for fallback */
const arbNonNoneBump: fc.Arbitrary<'major' | 'minor' | 'patch'> = fc.constantFrom(
  'major' as const,
  'minor' as const,
  'patch' as const,
);

/** 40-char hex hash */
const arbHash = fc.hexaString({ minLength: 40, maxLength: 40 });

/** Scope: null or a safe string */
const arbScope = fc.oneof(
  fc.constant(null),
  fc.stringOf(
    fc.mapToConstant(
      { num: 26, build: (v) => String.fromCharCode(97 + v) },
      { num: 10, build: (v) => String.fromCharCode(48 + v) },
      { num: 1, build: () => '-' },
    ),
    { minLength: 1, maxLength: 15 },
  ),
);

/**
 * Generates a conventional commit message string (non-breaking).
 * Format: type[(scope)]: description
 */
const arbConventionalMessage = fc.tuple(
  arbConventionalType,
  arbScope,
  arbSafeString,
).map(([type, scope, desc]) => {
  const scopePart = scope ? `(${scope})` : '';
  return `${type}${scopePart}: ${desc}`;
});

/**
 * Generates a breaking conventional commit message.
 * Uses either ! bang or BREAKING CHANGE footer.
 */
const arbBreakingMessage = fc.tuple(
  arbConventionalType,
  arbScope,
  arbSafeString,
  fc.constantFrom('bang', 'footer') as fc.Arbitrary<'bang' | 'footer'>,
).map(([type, scope, desc, via]) => {
  const scopePart = scope ? `(${scope})` : '';
  if (via === 'bang') {
    return `${type}${scopePart}!: ${desc}`;
  }
  return `${type}${scopePart}: ${desc}\n\nBREAKING CHANGE: ${desc}`;
});

/**
 * Generates a non-conventional commit message (no CC format).
 */
const arbNonConventionalMessage = arbSafeString.filter(
  (s) => !/^\w+(\([^)]*\))?!?\s*:\s*.+$/.test(s),
);

/**
 * Generates a git log output string from an array of (hash, message) pairs.
 */
function buildGitLog(entries: Array<{ hash: string; message: string }>): string {
  return entries.map((e) => logEntry(e.hash, e.message)).join('');
}

// ── Bump priority for expected value computation ────────────────────────────

const BUMP_PRIORITY: Record<BumpLevel, number> = {
  major: 3,
  minor: 2,
  patch: 1,
  none: 0,
};

function maxBumpLevel(a: BumpLevel, b: BumpLevel): BumpLevel {
  return BUMP_PRIORITY[a] >= BUMP_PRIORITY[b] ? a : b;
}

// ── Property Tests ──────────────────────────────────────────────────────────

describe('Property 3: Maximum bump determination with BumpPolicy', () => {
  /**
   * **Validates: Requirements 3.4, 3.5, 3.8**
   *
   * For any set of conventional commits and any valid BumpPolicy,
   * analyzeBump() returns a BumpResult where bump equals the maximum
   * bump level among all commits (major > minor > patch > none),
   * determined via BumpPolicy. commitsByType contains correct counters.
   * breakingChanges contains the subset with breaking: true.
   * conventionalCommits contains all commits with valid: true.
   */
  test('analyzeBump returns the maximum bump level per BumpPolicy', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate 1-10 conventional commits with types and a BumpPolicy
        fc.array(
          fc.tuple(arbHash, arbConventionalType, arbScope, arbSafeString),
          { minLength: 1, maxLength: 10 },
        ),
        // Generate a BumpPolicy that maps all standard types
        fc.record({
          feat: arbBumpLevel,
          fix: arbBumpLevel,
          chore: arbBumpLevel,
          docs: arbBumpLevel,
          style: arbBumpLevel,
          refactor: arbBumpLevel,
          perf: arbBumpLevel,
          test: arbBumpLevel,
          build: arbBumpLevel,
          ci: arbBumpLevel,
          revert: arbBumpLevel,
        }),
        async (commits, policy) => {
          // Build commit messages (non-breaking)
          const entries = commits.map(([hash, type, scope, desc]) => ({
            hash,
            message: `${type}${scope ? `(${scope})` : ''}: ${desc}`,
          }));

          // Compute expected bump
          let expectedBump: BumpLevel = 'none';
          const expectedByType: Record<string, number> = {};
          for (const [, type] of commits) {
            expectedByType[type] = (expectedByType[type] || 0) + 1;
            const level = policy[type] || 'none';
            expectedBump = maxBumpLevel(expectedBump, level);
          }

          // If expected is 'none', we need a fallback to avoid error
          const fallback: 'patch' | null = expectedBump === 'none' ? 'patch' : null;
          const gitLog = buildGitLog(entries);
          const executor = createTagAndLogExecutor(gitLog);
          const result = await analyzeBump(makeDeps(executor, policy, fallback));

          if (expectedBump === 'none') {
            // Fallback was used
            expect(result.bump).toBe('patch');
          } else {
            expect(result.bump).toBe(expectedBump);
          }

          // Verify commitsByType counters
          expect(result.commitsByType).toEqual(expectedByType);

          // Verify conventionalCommits contains all commits (all are valid CC)
          expect(result.conventionalCommits).toHaveLength(commits.length);

          // No breaking changes in this test (non-breaking messages)
          expect(result.breakingChanges).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 4: Breaking change always leads to major', () => {
  /**
   * **Validates: Requirements 3.4**
   *
   * For any array of commits containing at least one commit with
   * breaking: true, analyzeBump() returns bump: 'major',
   * regardless of commit type and BumpPolicy settings.
   */
  test('any breaking commit forces bump to major (via bang)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate 0-5 non-breaking commits
        fc.array(
          fc.tuple(arbHash, arbConventionalMessage),
          { minLength: 0, maxLength: 5 },
        ),
        // Generate 1-3 breaking commits (via bang)
        fc.array(
          fc.tuple(
            arbHash,
            fc.tuple(arbConventionalType, arbScope, arbSafeString).map(
              ([type, scope, desc]) =>
                `${type}${scope ? `(${scope})` : ''}!: ${desc}`,
            ),
          ),
          { minLength: 1, maxLength: 3 },
        ),
        // Random BumpPolicy (should not matter)
        fc.record({
          feat: arbBumpLevel,
          fix: arbBumpLevel,
          chore: arbBumpLevel,
          docs: arbBumpLevel,
          style: arbBumpLevel,
          refactor: arbBumpLevel,
          perf: arbBumpLevel,
          test: arbBumpLevel,
          build: arbBumpLevel,
          ci: arbBumpLevel,
          revert: arbBumpLevel,
        }),
        async (nonBreaking, breaking, policy) => {
          const allEntries = [
            ...nonBreaking.map(([hash, msg]) => ({ hash, message: msg })),
            ...breaking.map(([hash, msg]) => ({ hash, message: msg })),
          ];

          const gitLog = buildGitLog(allEntries);
          const executor = createTagAndLogExecutor(gitLog);
          const result = await analyzeBump(makeDeps(executor, policy, null));

          expect(result.bump).toBe('major');
          expect(result.breakingChanges.length).toBeGreaterThanOrEqual(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  test('any breaking commit forces bump to major (via BREAKING CHANGE footer)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate 0-5 non-breaking commits
        fc.array(
          fc.tuple(arbHash, arbConventionalMessage),
          { minLength: 0, maxLength: 5 },
        ),
        // Generate 1-2 breaking commits (via footer)
        fc.array(
          fc.tuple(
            arbHash,
            fc.tuple(arbConventionalType, arbScope, arbSafeString).map(
              ([type, scope, desc]) =>
                `${type}${scope ? `(${scope})` : ''}: ${desc}\n\nBREAKING CHANGE: ${desc}`,
            ),
          ),
          { minLength: 1, maxLength: 2 },
        ),
        fc.record({
          feat: arbBumpLevel,
          fix: arbBumpLevel,
          chore: arbBumpLevel,
          docs: arbBumpLevel,
          style: arbBumpLevel,
          refactor: arbBumpLevel,
          perf: arbBumpLevel,
          test: arbBumpLevel,
          build: arbBumpLevel,
          ci: arbBumpLevel,
          revert: arbBumpLevel,
        }),
        async (nonBreaking, breaking, policy) => {
          const allEntries = [
            ...nonBreaking.map(([hash, msg]) => ({ hash, message: msg })),
            ...breaking.map(([hash, msg]) => ({ hash, message: msg })),
          ];

          const gitLog = buildGitLog(allEntries);
          const executor = createTagAndLogExecutor(gitLog);
          const result = await analyzeBump(makeDeps(executor, policy, null));

          expect(result.bump).toBe('major');
          expect(result.breakingChanges.length).toBeGreaterThanOrEqual(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 5: Fallback when no conventional commits', () => {
  /**
   * **Validates: Requirements 3.6, 3.7, 12.1**
   *
   * When all commits are invalid (non-conventional) or all conventional
   * commit types map to 'none' in BumpPolicy:
   * - If fallbackBump is set, analyzeBump returns bump === fallbackBump
   * - If fallbackBump is null, analyzeBump throws VersioningsError
   *   with code NO_CONVENTIONAL_COMMITS (11)
   */
  test('all non-conventional commits with fallback → uses fallbackBump', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate 1-10 non-conventional commit messages
        fc.array(
          fc.tuple(arbHash, arbNonConventionalMessage),
          { minLength: 1, maxLength: 10 },
        ),
        arbNonNoneBump,
        async (commits, fallback) => {
          const entries = commits.map(([hash, msg]) => ({ hash, message: msg }));
          const gitLog = buildGitLog(entries);
          const executor = createTagAndLogExecutor(gitLog);
          const result = await analyzeBump(
            makeDeps(executor, DEFAULT_BUMP_POLICY, fallback),
          );

          expect(result.bump).toBe(fallback);
          expect(result.conventionalCommits).toHaveLength(0);
          expect(result.breakingChanges).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  test('all non-conventional commits without fallback → throws NO_CONVENTIONAL_COMMITS', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.tuple(arbHash, arbNonConventionalMessage),
          { minLength: 1, maxLength: 10 },
        ),
        async (commits) => {
          const entries = commits.map(([hash, msg]) => ({ hash, message: msg }));
          const gitLog = buildGitLog(entries);
          const executor = createTagAndLogExecutor(gitLog);

          try {
            await analyzeBump(makeDeps(executor, DEFAULT_BUMP_POLICY, null));
            // Should not reach here
            expect(true).toBe(false);
          } catch (err: any) {
            expect(err).toBeInstanceOf(VersioningsError);
            expect(err.code).toBe(EXIT_CODES.NO_CONVENTIONAL_COMMITS);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  test('all types mapped to none with fallback → uses fallbackBump', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate 1-10 conventional commits with types that all map to 'none'
        fc.array(
          fc.tuple(arbHash, arbConventionalType, arbScope, arbSafeString),
          { minLength: 1, maxLength: 10 },
        ),
        arbNonNoneBump,
        async (commits, fallback) => {
          // Create a policy where ALL types map to 'none'
          const allNonePolicy: BumpPolicy = {};
          for (const type of ['feat', 'fix', 'chore', 'docs', 'style', 'refactor',
            'perf', 'test', 'build', 'ci', 'revert']) {
            allNonePolicy[type] = 'none';
          }

          const entries = commits.map(([hash, type, scope, desc]) => ({
            hash,
            message: `${type}${scope ? `(${scope})` : ''}: ${desc}`,
          }));

          const gitLog = buildGitLog(entries);
          const executor = createTagAndLogExecutor(gitLog);
          const result = await analyzeBump(
            makeDeps(executor, allNonePolicy, fallback),
          );

          expect(result.bump).toBe(fallback);
          // All commits are valid CC, just mapped to 'none'
          expect(result.conventionalCommits.length).toBeGreaterThanOrEqual(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  test('all types mapped to none without fallback → throws NO_CONVENTIONAL_COMMITS', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.tuple(arbHash, arbConventionalType, arbScope, arbSafeString),
          { minLength: 1, maxLength: 10 },
        ),
        async (commits) => {
          const allNonePolicy: BumpPolicy = {};
          for (const type of ['feat', 'fix', 'chore', 'docs', 'style', 'refactor',
            'perf', 'test', 'build', 'ci', 'revert']) {
            allNonePolicy[type] = 'none';
          }

          const entries = commits.map(([hash, type, scope, desc]) => ({
            hash,
            message: `${type}${scope ? `(${scope})` : ''}: ${desc}`,
          }));

          const gitLog = buildGitLog(entries);
          const executor = createTagAndLogExecutor(gitLog);

          try {
            await analyzeBump(makeDeps(executor, allNonePolicy, null));
            expect(true).toBe(false);
          } catch (err: any) {
            expect(err).toBeInstanceOf(VersioningsError);
            expect(err.code).toBe(EXIT_CODES.NO_CONVENTIONAL_COMMITS);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
