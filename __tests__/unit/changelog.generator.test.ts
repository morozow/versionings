// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import {
  generateChangelog,
  DEFAULT_GROUP_TITLES,
} from '../../changelog.generator';
import type {
  ChangelogOpts,
  ChangelogResult,
} from '../../changelog.generator';
import type {
  CommitWithHash,
  ConventionalCommit,
  InvalidCommit,
} from '../../commit.parser';
import { DEFAULT_BUMP_POLICY } from '../../commit.analyzer';

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


// ── generateChangelog ───────────────────────────────────────────────────────

describe('generateChangelog', () => {
  // ── Basic generation with feat and fix ──────────────────────────────────

  test('generates changelog with feat and fix commits', () => {
    const commits = [
      makeConventional({ type: 'feat', description: 'add login page' }),
      makeConventional({ type: 'fix', description: 'resolve crash on startup' }),
    ];
    const result = generateChangelog(commits, defaultOpts());

    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].title).toBe('Features');
    expect(result.groups[0].commits).toHaveLength(1);
    expect(result.groups[0].commits[0].description).toBe('add login page');
    expect(result.groups[1].title).toBe('Bug Fixes');
    expect(result.groups[1].commits).toHaveLength(1);
    expect(result.groups[1].commits[0].description).toBe('resolve crash on startup');

    expect(result.markdown).toContain('## [1.0.0] - 2024-01-15');
    expect(result.markdown).toContain('### Features');
    expect(result.markdown).toContain('- add login page');
    expect(result.markdown).toContain('### Bug Fixes');
    expect(result.markdown).toContain('- resolve crash on startup');
  });

  // ── Grouping order ──────────────────────────────────────────────────────

  test('groups in correct order: breaking, feat, fix, perf, revert, then alphabetical', () => {
    const commits = [
      makeConventional({ type: 'revert', description: 'revert bad change' }),
      makeConventional({ type: 'perf', description: 'optimize query' }),
      makeConventional({ type: 'fix', description: 'fix bug' }),
      makeConventional({ type: 'feat', description: 'new feature' }),
      makeConventional({ type: 'feat', description: 'breaking api', breaking: true }),
      makeConventional({ type: 'custom', description: 'custom type commit' }),
    ];
    // custom type is not in bumpPolicy, so not excluded
    const opts = defaultOpts({ bumpPolicy: { ...DEFAULT_BUMP_POLICY } });
    const result = generateChangelog(commits, opts);

    const titles = result.groups.map((g) => g.title);
    expect(titles[0]).toBe('BREAKING CHANGES');
    expect(titles[1]).toBe('Features');
    expect(titles[2]).toBe('Bug Fixes');
    expect(titles[3]).toBe('Performance Improvements');
    expect(titles[4]).toBe('Reverts');
    expect(titles[5]).toBe('custom');
  });

  // ── Breaking changes first ──────────────────────────────────────────────

  test('breaking changes appear first and are not duplicated in type group', () => {
    const commits = [
      makeConventional({ type: 'feat', description: 'normal feature' }),
      makeConventional({ type: 'feat', description: 'breaking feature', breaking: true }),
    ];
    const result = generateChangelog(commits, defaultOpts());

    expect(result.groups[0].title).toBe('BREAKING CHANGES');
    expect(result.groups[0].commits).toHaveLength(1);
    expect(result.groups[0].commits[0].description).toBe('breaking feature');

    expect(result.groups[1].title).toBe('Features');
    expect(result.groups[1].commits).toHaveLength(1);
    expect(result.groups[1].commits[0].description).toBe('normal feature');
  });

  // ── Scope in parentheses ────────────────────────────────────────────────

  test('scope is rendered in parentheses after description', () => {
    const commits = [
      makeConventional({ type: 'feat', description: 'add button', scope: 'ui' }),
      makeConventional({ type: 'feat', description: 'add route', scope: null }),
    ];
    const result = generateChangelog(commits, defaultOpts());

    expect(result.markdown).toContain('- add button (ui)');
    expect(result.markdown).toContain('- add route');
    expect(result.markdown).not.toContain('- add route ()');

    expect(result.groups[0].commits[0].scope).toBe('ui');
    expect(result.groups[0].commits[1].scope).toBeNull();
  });

  // ── Exclusion of none-types via bumpPolicy ──────────────────────────────

  test('excludes types mapped to none in bumpPolicy', () => {
    const commits = [
      makeConventional({ type: 'feat', description: 'new feature' }),
      makeConventional({ type: 'chore', description: 'update deps' }),
      makeConventional({ type: 'docs', description: 'update readme' }),
      makeConventional({ type: 'fix', description: 'fix bug' }),
    ];
    const result = generateChangelog(commits, defaultOpts());

    const titles = result.groups.map((g) => g.title);
    expect(titles).toContain('Features');
    expect(titles).toContain('Bug Fixes');
    expect(titles).not.toContain('chore');
    expect(titles).not.toContain('docs');
  });

  // ── excludeTypes option ─────────────────────────────────────────────────

  test('excludeTypes excludes specified types from changelog', () => {
    const commits = [
      makeConventional({ type: 'feat', description: 'new feature' }),
      makeConventional({ type: 'fix', description: 'fix bug' }),
      makeConventional({ type: 'perf', description: 'optimize' }),
    ];
    const result = generateChangelog(commits, defaultOpts({ excludeTypes: ['perf'] }));

    const titles = result.groups.map((g) => g.title);
    expect(titles).toContain('Features');
    expect(titles).toContain('Bug Fixes');
    expect(titles).not.toContain('Performance Improvements');
  });

  test('excludeTypes combined with bumpPolicy none — both exclusions apply', () => {
    const commits = [
      makeConventional({ type: 'feat', description: 'feature' }),
      makeConventional({ type: 'fix', description: 'fix' }),
      makeConventional({ type: 'chore', description: 'chore task' }),
    ];
    // fix is excluded by excludeTypes, chore by bumpPolicy none
    const result = generateChangelog(commits, defaultOpts({ excludeTypes: ['fix'] }));

    const titles = result.groups.map((g) => g.title);
    expect(titles).toEqual(['Features']);
  });


  // ── includeNonConventional ──────────────────────────────────────────────

  test('includeNonConventional=false excludes invalid commits', () => {
    const commits = [
      makeConventional({ type: 'feat', description: 'feature' }),
      makeInvalid('random commit message'),
    ];
    const result = generateChangelog(commits, defaultOpts({ includeNonConventional: false }));

    const titles = result.groups.map((g) => g.title);
    expect(titles).not.toContain('Other Changes');
    expect(result.groups).toHaveLength(1);
  });

  test('includeNonConventional=true includes invalid commits in Other Changes group', () => {
    const commits = [
      makeConventional({ type: 'feat', description: 'feature' }),
      makeInvalid('random commit message'),
      makeInvalid('another non-conventional'),
    ];
    const result = generateChangelog(commits, defaultOpts({ includeNonConventional: true }));

    const titles = result.groups.map((g) => g.title);
    expect(titles).toContain('Other Changes');

    const otherGroup = result.groups.find((g) => g.title === 'Other Changes')!;
    expect(otherGroup.commits).toHaveLength(2);
    expect(otherGroup.commits[0].description).toBe('random commit message');
    expect(otherGroup.commits[1].description).toBe('another non-conventional');
  });

  test('Other Changes group appears last', () => {
    const commits = [
      makeInvalid('non-conventional'),
      makeConventional({ type: 'feat', description: 'feature' }),
      makeConventional({ type: 'fix', description: 'fix' }),
    ];
    const result = generateChangelog(commits, defaultOpts({ includeNonConventional: true }));

    const lastGroup = result.groups[result.groups.length - 1];
    expect(lastGroup.title).toBe('Other Changes');
  });

  // ── Markdown vs plain format ────────────────────────────────────────────

  test('markdown format includes ## and ### markers', () => {
    const commits = [
      makeConventional({ type: 'feat', description: 'feature' }),
    ];
    const result = generateChangelog(commits, defaultOpts({ format: 'markdown' }));

    expect(result.markdown).toContain('## [1.0.0] - 2024-01-15');
    expect(result.markdown).toContain('### Features');
  });

  test('plain format has no markdown markers (## or ###)', () => {
    const commits = [
      makeConventional({ type: 'feat', description: 'feature' }),
      makeConventional({ type: 'fix', description: 'fix bug' }),
    ];
    const result = generateChangelog(commits, defaultOpts({ format: 'plain' }));

    expect(result.markdown).toContain('[1.0.0] - 2024-01-15');
    expect(result.markdown).toContain('Features');
    expect(result.markdown).toContain('- feature');
    expect(result.markdown).not.toMatch(/^##\s/m);
    expect(result.markdown).not.toMatch(/^###\s/m);
  });

  // ── Custom groupTitles ──────────────────────────────────────────────────

  test('custom groupTitles override defaults', () => {
    const commits = [
      makeConventional({ type: 'feat', description: 'feature' }),
      makeConventional({ type: 'fix', description: 'fix' }),
    ];
    const customTitles = {
      ...DEFAULT_GROUP_TITLES,
      feat: 'Новые возможности',
      fix: 'Исправления',
    };
    const result = generateChangelog(commits, defaultOpts({ groupTitles: customTitles }));

    expect(result.groups[0].title).toBe('Новые возможности');
    expect(result.groups[1].title).toBe('Исправления');
    expect(result.markdown).toContain('### Новые возможности');
    expect(result.markdown).toContain('### Исправления');
  });

  test('partial custom groupTitles — non-overridden types use defaults', () => {
    const commits = [
      makeConventional({ type: 'feat', description: 'feature' }),
      makeConventional({ type: 'fix', description: 'fix' }),
    ];
    const customTitles = {
      ...DEFAULT_GROUP_TITLES,
      feat: 'New Stuff',
    };
    const result = generateChangelog(commits, defaultOpts({ groupTitles: customTitles }));

    expect(result.groups[0].title).toBe('New Stuff');
    expect(result.groups[1].title).toBe('Bug Fixes'); // default preserved
  });

  test('custom groupTitles for breaking changes', () => {
    const commits = [
      makeConventional({ type: 'feat', description: 'breaking', breaking: true }),
    ];
    const customTitles = {
      ...DEFAULT_GROUP_TITLES,
      breaking: 'КРИТИЧЕСКИЕ ИЗМЕНЕНИЯ',
    };
    const result = generateChangelog(commits, defaultOpts({ groupTitles: customTitles }));

    expect(result.groups[0].title).toBe('КРИТИЧЕСКИЕ ИЗМЕНЕНИЯ');
  });

  // ── Empty commits array ─────────────────────────────────────────────────

  test('empty commits array returns header only with no groups', () => {
    const result = generateChangelog([], defaultOpts());

    expect(result.groups).toEqual([]);
    expect(result.markdown).toContain('## [1.0.0] - 2024-01-15');
    // Should be just the header and a trailing newline
    expect(result.markdown.trim()).toBe('## [1.0.0] - 2024-01-15');
  });

  // ── Header with version and date ────────────────────────────────────────

  test('header includes version and date', () => {
    const commits = [
      makeConventional({ type: 'feat', description: 'feature' }),
    ];
    const result = generateChangelog(commits, defaultOpts({ version: '2.5.0', date: '2025-06-01' }));

    expect(result.markdown).toContain('## [2.5.0] - 2025-06-01');
  });

  test('null version renders as Unreleased', () => {
    const commits = [
      makeConventional({ type: 'feat', description: 'feature' }),
    ];
    const result = generateChangelog(commits, defaultOpts({ version: null }));

    expect(result.markdown).toContain('## [Unreleased] - 2024-01-15');
  });

  // ── Input order preserved within groups ─────────────────────────────────

  test('commits within a group preserve input order', () => {
    const commits = [
      makeConventional({ type: 'feat', description: 'alpha' }),
      makeConventional({ type: 'feat', description: 'beta' }),
      makeConventional({ type: 'feat', description: 'gamma' }),
    ];
    const result = generateChangelog(commits, defaultOpts());

    const featGroup = result.groups.find((g) => g.title === 'Features')!;
    expect(featGroup.commits.map((c) => c.description)).toEqual(['alpha', 'beta', 'gamma']);
  });
});

// ── DEFAULT_GROUP_TITLES ────────────────────────────────────────────────────

describe('DEFAULT_GROUP_TITLES', () => {
  test('contains expected default titles', () => {
    expect(DEFAULT_GROUP_TITLES.breaking).toBe('BREAKING CHANGES');
    expect(DEFAULT_GROUP_TITLES.feat).toBe('Features');
    expect(DEFAULT_GROUP_TITLES.fix).toBe('Bug Fixes');
    expect(DEFAULT_GROUP_TITLES.perf).toBe('Performance Improvements');
    expect(DEFAULT_GROUP_TITLES.revert).toBe('Reverts');
  });
});
