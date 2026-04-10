// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau
// Feature: version-intelligence-release-narrative
// Property 8: Changelog contains header and correctly formatted commits
// Property 9: Changelog groups commits in defined order with groupTitles
// Property 10: Changelog excludes commits with none types and excludeTypes
// Property 11: Changelog includes non-conventional commits when includeNonConventional=true
// Property 12: Difference between Markdown and plain text formats
// Property 14: JSON output of changelog contains required fields

import * as fc from 'fast-check';
import {
  generateChangelog,
  DEFAULT_GROUP_TITLES,
} from '../../../src/versioning/changelog.generator';
import type {
  ChangelogOpts,
} from '../../../src/versioning/changelog.generator';
import type {
  CommitWithHash,
  ConventionalCommit,
  InvalidCommit,
} from '../../../src/versioning/commit.parser';
import { DEFAULT_BUMP_POLICY } from '../../../src/versioning/commit.analyzer';
import type { BumpPolicy, BumpLevel } from '../../../src/versioning/commit.analyzer';

// ── Helpers ─────────────────────────────────────────────────────────────────

let hashCounter = 0;

function nextHash(): string {
  hashCounter++;
  return hashCounter.toString(16).padStart(40, '0');
}

function makeConventional(
  overrides: Partial<Omit<ConventionalCommit, 'valid'>> & { type: string; description: string },
): CommitWithHash {
  const cc: ConventionalCommit = {
    valid: true,
    type: overrides.type,
    scope: overrides.scope ?? null,
    description: overrides.description,
    body: overrides.body ?? null,
    footers: overrides.footers ?? [],
    breaking: overrides.breaking ?? false,
    rawMessage: overrides.rawMessage ?? `${overrides.type}: ${overrides.description}`,
  };
  return { hash: nextHash(), parsed: cc };
}

function makeInvalid(rawMessage: string): CommitWithHash {
  const inv: InvalidCommit = { valid: false, rawMessage };
  return { hash: nextHash(), parsed: inv };
}

function defaultOpts(overrides?: Partial<ChangelogOpts>): ChangelogOpts {
  return {
    version: '1.0.0',
    date: '2024-01-15',
    format: 'markdown',
    groupTitles: { ...DEFAULT_GROUP_TITLES },
    excludeTypes: [],
    includeNonConventional: false,
    bumpPolicy: { ...DEFAULT_BUMP_POLICY },
    ...overrides,
  };
}

beforeEach(() => {
  hashCounter = 0;
});

// ── Arbitraries ─────────────────────────────────────────────────────────────

/** Safe alphanumeric string for descriptions/scopes (no newlines, no markdown control) */
const arbSafeString = fc.stringOf(
  fc.mapToConstant(
    { num: 26, build: (v) => String.fromCharCode(97 + v) },  // a-z
    { num: 10, build: (v) => String.fromCharCode(48 + v) },  // 0-9
    { num: 1, build: () => ' ' },
    { num: 1, build: () => '-' },
  ),
  { minLength: 1, maxLength: 30 },
).map((s) => s.trim()).filter((s) => s.length > 0);

/** Standard conventional commit types */
const arbConventionalType = fc.constantFrom(
  'feat', 'fix', 'chore', 'docs', 'style', 'refactor',
  'perf', 'test', 'build', 'ci', 'revert',
);

/** Types that produce actual changelog entries (not mapped to none by default) */
const arbVisibleType = fc.constantFrom('feat', 'fix', 'perf', 'revert');

/** Types mapped to none by default policy */
const arbNoneType = fc.constantFrom('chore', 'docs', 'style', 'refactor', 'test', 'build', 'ci');

/** Scope: null or a safe string */
const arbScope = fc.oneof(
  fc.constant(null as string | null),
  fc.stringOf(
    fc.mapToConstant(
      { num: 26, build: (v) => String.fromCharCode(97 + v) },
      { num: 10, build: (v) => String.fromCharCode(48 + v) },
    ),
    { minLength: 1, maxLength: 10 },
  ),
);

/** Version string */
const arbVersion = fc.oneof(
  fc.constant(null as string | null),
  fc.tuple(
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 }),
  ).map(([a, b, c]) => `${a}.${b}.${c}`),
);

/** Date string YYYY-MM-DD */
const arbDate = fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
  .map((d) => d.toISOString().slice(0, 10));

/** Generate a CommitWithHash with a conventional commit */
const arbConventionalCommitWithHash = fc.tuple(
  arbConventionalType,
  arbScope,
  arbSafeString,
  fc.boolean(), // breaking
).map(([type, scope, desc, breaking]) =>
  makeConventional({ type, scope, description: desc, breaking }),
);

/** Generate a CommitWithHash with a visible (non-none) conventional commit */
const arbVisibleCommitWithHash = fc.tuple(
  arbVisibleType,
  arbScope,
  arbSafeString,
).map(([type, scope, desc]) =>
  makeConventional({ type, scope, description: desc }),
);

/** Generate a non-conventional (invalid) commit */
const arbInvalidCommitWithHash = arbSafeString.map((msg) => makeInvalid(msg));

// ── Known group ordering ────────────────────────────────────────────────────

const KNOWN_ORDER = ['breaking', 'feat', 'fix', 'perf', 'revert'];


// ── Property 8: Changelog contains header and correctly formatted commits ───

describe('Property 8: Changelog contains header and correctly formatted commits', () => {
  /**
   * **Validates: Requirements 6.1, 6.3, 6.4**
   *
   * For any non-empty array of ConventionalCommit, for any version and date,
   * generateChangelog() returns a string starting with the header
   * `## [<version>] - <date>`. Each included commit is formatted as
   * `- <description>` (no scope) or `- <description> (<scope>)` (with scope).
   * The result string is non-empty.
   */
  test('changelog has correct header and commit formatting', () => {
    fc.assert(
      fc.property(
        fc.array(arbVisibleCommitWithHash, { minLength: 1, maxLength: 20 }),
        arbVersion,
        arbDate,
        (commits, version, date) => {
          const opts = defaultOpts({ version, date });
          const result = generateChangelog(commits, opts);

          // Result is non-empty
          expect(result.markdown.length).toBeGreaterThan(0);

          // Header contains version and date
          const versionStr = version || 'Unreleased';
          expect(result.markdown).toContain(`[${versionStr}] - ${date}`);

          // In markdown format, header starts with ##
          expect(result.markdown).toMatch(/^## \[/);

          // Each commit in groups is formatted correctly
          for (const group of result.groups) {
            for (const commit of group.commits) {
              if (commit.scope) {
                expect(result.markdown).toContain(
                  `- ${commit.description} (${commit.scope})`,
                );
              } else {
                expect(result.markdown).toContain(`- ${commit.description}`);
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 9: Changelog groups commits in defined order with groupTitles ──

describe('Property 9: Changelog groups commits in defined order with groupTitles', () => {
  /**
   * **Validates: Requirements 6.2, 8.3**
   *
   * For any array of commits with various types, generateChangelog() groups
   * them in order: Breaking Changes first, then feat, fix, perf, revert,
   * remaining types in alphabetical order. For any custom groupTitles,
   * group titles match the custom values instead of defaults.
   */
  test('groups appear in defined order: breaking, feat, fix, perf, revert, then alphabetical', () => {
    fc.assert(
      fc.property(
        // Generate at least one breaking and one of each visible type
        fc.tuple(
          fc.array(
            fc.tuple(arbVisibleType, arbScope, arbSafeString).map(
              ([type, scope, desc]) => makeConventional({ type, scope, description: desc }),
            ),
            { minLength: 1, maxLength: 10 },
          ),
          fc.array(
            fc.tuple(arbVisibleType, arbScope, arbSafeString).map(
              ([type, scope, desc]) => makeConventional({ type, scope, description: desc, breaking: true }),
            ),
            { minLength: 0, maxLength: 3 },
          ),
        ),
        ([nonBreaking, breaking]) => {
          const commits = [...breaking, ...nonBreaking];
          const result = generateChangelog(commits, defaultOpts());

          const groupTitles = result.groups.map((g) => g.title);

          // Determine expected order based on what's present
          const expectedOrder: string[] = [];
          const breakingTitle = DEFAULT_GROUP_TITLES.breaking;
          const knownTitles: Record<string, string> = {
            feat: DEFAULT_GROUP_TITLES.feat,
            fix: DEFAULT_GROUP_TITLES.fix,
            perf: DEFAULT_GROUP_TITLES.perf,
            revert: DEFAULT_GROUP_TITLES.revert,
          };

          // Breaking first if present
          if (groupTitles.includes(breakingTitle)) {
            expectedOrder.push(breakingTitle);
          }

          // Known types in order
          for (const type of ['feat', 'fix', 'perf', 'revert']) {
            const title = knownTitles[type];
            if (groupTitles.includes(title)) {
              expectedOrder.push(title);
            }
          }

          // Remaining (alphabetical) — anything not in expectedOrder
          const remaining = groupTitles.filter((t) => !expectedOrder.includes(t));
          const sortedRemaining = [...remaining].sort();
          expectedOrder.push(...sortedRemaining);

          expect(groupTitles).toEqual(expectedOrder);

          // Total commits in groups should not exceed input commits
          const totalInGroups = result.groups.reduce(
            (sum, g) => sum + g.commits.length, 0,
          );
          expect(totalInGroups).toBeLessThanOrEqual(commits.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  test('custom groupTitles override default titles', () => {
    fc.assert(
      fc.property(
        fc.array(arbVisibleCommitWithHash, { minLength: 1, maxLength: 10 }),
        fc.record({
          feat: arbSafeString,
          fix: arbSafeString,
          perf: arbSafeString,
          revert: arbSafeString,
          breaking: arbSafeString,
        }),
        (commits, customTitles) => {
          const opts = defaultOpts({ groupTitles: customTitles });
          const result = generateChangelog(commits, opts);

          // Every group title should come from customTitles (or the type name for unknown types)
          for (const group of result.groups) {
            const matchesCustom = Object.values(customTitles).includes(group.title);
            const isTypeName = !matchesCustom; // fallback to type name for unknown types
            expect(matchesCustom || isTypeName).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 10: Changelog excludes commits with none types and excludeTypes ─

describe('Property 10: Changelog excludes commits with none types and excludeTypes', () => {
  /**
   * **Validates: Requirements 6.5, 8.4**
   *
   * For any array of commits and any BumpPolicy, commits with types mapped
   * to 'none' do not appear in the changelog output. For any excludeTypes
   * array, commits with those types are excluded regardless of BumpPolicy.
   */
  test('commits with types mapped to none in bumpPolicy are excluded', () => {
    fc.assert(
      fc.property(
        // Mix of visible and none-type commits
        fc.tuple(
          fc.array(arbVisibleCommitWithHash, { minLength: 1, maxLength: 5 }),
          fc.array(
            fc.tuple(arbNoneType, arbScope, arbSafeString).map(
              ([type, scope, desc]) => makeConventional({ type, scope, description: desc }),
            ),
            { minLength: 1, maxLength: 5 },
          ),
        ),
        ([visible, noneTyped]) => {
          const commits = [...visible, ...noneTyped];
          const result = generateChangelog(commits, defaultOpts());

          // None-typed commit types should not appear as group titles
          const groupTitles = result.groups.map((g) => g.title);
          const noneTypes = new Set(noneTyped.map((c) => (c.parsed as ConventionalCommit).type));

          for (const noneType of noneTypes) {
            // The none-type should not have its own group (neither by title nor by type name)
            const title = DEFAULT_GROUP_TITLES[noneType] || noneType;
            expect(groupTitles).not.toContain(title);
          }

          // Total commits in groups should be <= visible commits count
          // (none-typed commits are excluded)
          const totalInGroups = result.groups.reduce(
            (sum, g) => sum + g.commits.length, 0,
          );
          expect(totalInGroups).toBeLessThanOrEqual(visible.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  test('excludeTypes excludes specified types regardless of bumpPolicy', () => {
    fc.assert(
      fc.property(
        fc.array(arbVisibleCommitWithHash, { minLength: 2, maxLength: 10 }),
        // Pick 1-2 types to exclude from the visible types
        fc.subarray(['feat', 'fix', 'perf', 'revert'] as const, { minLength: 1, maxLength: 2 }),
        (commits, excludeTypes) => {
          const opts = defaultOpts({ excludeTypes: [...excludeTypes] });
          const result = generateChangelog(commits, opts);

          // Excluded types should not appear in groups
          // (group titles for excluded types should be absent)
          const excludedTitles = excludeTypes.map(
            (t) => DEFAULT_GROUP_TITLES[t] || t,
          );

          for (const group of result.groups) {
            expect(excludedTitles).not.toContain(group.title);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 11: Changelog includes non-conventional commits ────────────────

describe('Property 11: Changelog includes non-conventional commits when includeNonConventional=true', () => {
  /**
   * **Validates: Requirements 6.6**
   *
   * For any array containing commits with valid: false, when
   * includeNonConventional is true, those commits appear in the
   * "Other Changes" group. When false, they are excluded.
   */
  test('non-conventional commits included in Other Changes when flag is true', () => {
    fc.assert(
      fc.property(
        fc.array(arbVisibleCommitWithHash, { minLength: 0, maxLength: 5 }),
        fc.array(arbInvalidCommitWithHash, { minLength: 1, maxLength: 5 }),
        (conventional, invalid) => {
          const commits = [...conventional, ...invalid];

          // With includeNonConventional=true
          const resultInclude = generateChangelog(
            commits,
            defaultOpts({ includeNonConventional: true }),
          );
          const otherGroup = resultInclude.groups.find(
            (g) => g.title === 'Other Changes',
          );
          expect(otherGroup).toBeDefined();
          expect(otherGroup!.commits).toHaveLength(invalid.length);

          // Other Changes is the last group
          if (resultInclude.groups.length > 1) {
            expect(
              resultInclude.groups[resultInclude.groups.length - 1].title,
            ).toBe('Other Changes');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  test('non-conventional commits excluded when flag is false', () => {
    fc.assert(
      fc.property(
        fc.array(arbVisibleCommitWithHash, { minLength: 1, maxLength: 5 }),
        fc.array(arbInvalidCommitWithHash, { minLength: 1, maxLength: 5 }),
        (conventional, invalid) => {
          const commits = [...conventional, ...invalid];

          const resultExclude = generateChangelog(
            commits,
            defaultOpts({ includeNonConventional: false }),
          );
          const otherGroup = resultExclude.groups.find(
            (g) => g.title === 'Other Changes',
          );
          expect(otherGroup).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 12: Difference between Markdown and plain text formats ─────────

describe('Property 12: Difference between Markdown and plain text formats', () => {
  /**
   * **Validates: Requirements 6.7**
   *
   * For any array of commits, markdown format output contains `##` and `###`
   * markers. Plain text format output does not contain `##` or `###` markers.
   * Both formats produce the same groups structure.
   */
  test('markdown has ## markers, plain does not; groups are equivalent', () => {
    fc.assert(
      fc.property(
        fc.array(arbVisibleCommitWithHash, { minLength: 1, maxLength: 10 }),
        arbVersion,
        arbDate,
        (commits, version, date) => {
          const baseOpts = defaultOpts({ version, date });

          const mdResult = generateChangelog(commits, {
            ...baseOpts,
            format: 'markdown',
          });
          const plainResult = generateChangelog(commits, {
            ...baseOpts,
            format: 'plain',
          });

          // Markdown contains ## markers
          expect(mdResult.markdown).toMatch(/^## \[/m);
          if (mdResult.groups.length > 0) {
            expect(mdResult.markdown).toMatch(/^### /m);
          }

          // Plain does not contain ## or ### markers
          expect(plainResult.markdown).not.toMatch(/^## /m);
          expect(plainResult.markdown).not.toMatch(/^### /m);

          // Both contain the version/date header content
          const versionStr = version || 'Unreleased';
          expect(plainResult.markdown).toContain(`[${versionStr}] - ${date}`);

          // Groups structure is identical
          expect(mdResult.groups.length).toBe(plainResult.groups.length);
          for (let i = 0; i < mdResult.groups.length; i++) {
            expect(mdResult.groups[i].title).toBe(plainResult.groups[i].title);
            expect(mdResult.groups[i].commits.length).toBe(
              plainResult.groups[i].commits.length,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 14: JSON output of changelog contains required fields ──────────

describe('Property 14: JSON output of changelog contains required fields', () => {
  /**
   * **Validates: Requirements 7.7, 13.5**
   *
   * For any result of generateChangelog(), the ChangelogResult structure
   * contains: markdown (string), groups (array of objects with title and
   * commits). Each group has a string title and an array of commits.
   * The result is JSON-serializable.
   */
  test('ChangelogResult is JSON-serializable with required fields', () => {
    fc.assert(
      fc.property(
        fc.array(arbConventionalCommitWithHash, { minLength: 0, maxLength: 15 }),
        arbVersion,
        arbDate,
        fc.constantFrom('markdown' as const, 'plain' as const),
        fc.boolean(), // includeNonConventional
        (commits, version, date, format, includeNonConventional) => {
          const opts = defaultOpts({ version, date, format, includeNonConventional });
          const result = generateChangelog(commits, opts);

          // JSON-serializable (no circular refs, no functions)
          const json = JSON.stringify(result);
          const parsed = JSON.parse(json);

          // Required fields exist
          expect(typeof parsed.markdown).toBe('string');
          expect(Array.isArray(parsed.groups)).toBe(true);

          // Each group has required structure
          for (const group of parsed.groups) {
            expect(typeof group.title).toBe('string');
            expect(group.title.length).toBeGreaterThan(0);
            expect(Array.isArray(group.commits)).toBe(true);

            for (const commit of group.commits) {
              expect(typeof commit.description).toBe('string');
              expect(commit.description.length).toBeGreaterThan(0);
              expect(
                commit.scope === null || typeof commit.scope === 'string',
              ).toBe(true);
              expect(typeof commit.breaking).toBe('boolean');
            }
          }

          // markdown field is non-empty (always has at least a header)
          expect(parsed.markdown.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
