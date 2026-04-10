// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import type { CommitWithHash, ConventionalCommit } from './commit.parser';
import type { BumpPolicy } from './commit.analyzer';

// ── Types ───────────────────────────────────────────────────────────────────

export interface ChangelogOpts {
  version: string | null;
  date: string;
  format: 'markdown' | 'plain';
  groupTitles: Record<string, string>;
  excludeTypes: string[];
  includeNonConventional: boolean;
  bumpPolicy: BumpPolicy;
}

export interface ChangelogGroup {
  title: string;
  commits: Array<{
    description: string;
    scope: string | null;
    breaking: boolean;
  }>;
}

export interface ChangelogResult {
  markdown: string;
  groups: ChangelogGroup[];
}

// ── Default Group Titles ────────────────────────────────────────────────────

export const DEFAULT_GROUP_TITLES: Record<string, string> = {
  breaking: 'BREAKING CHANGES',
  feat: 'Features',
  fix: 'Bug Fixes',
  perf: 'Performance Improvements',
  revert: 'Reverts',
};

// ── Known type ordering (after breaking) ────────────────────────────────────

const KNOWN_TYPE_ORDER: readonly string[] = ['feat', 'fix', 'perf', 'revert'];

// ── generateChangelog ───────────────────────────────────────────────────────

/**
 * Generates a changelog from an array of commits.
 *
 * 1. Filters commits: excludes types mapped to 'none' in bumpPolicy
 *    and types listed in excludeTypes
 * 2. Groups: Breaking Changes first, then feat, fix, perf, revert,
 *    remaining types in alphabetical order
 * 3. Formats each commit: `- <description> (<scope>)` or `- <description>`
 * 4. Header: `## [<version>] - <date>` (markdown) or `[<version>] - <date>` (plain)
 * 5. Non-conventional commits → "Other Changes" group when includeNonConventional=true
 *
 * Pure function with no side effects.
 */
export function generateChangelog(
  commits: CommitWithHash[],
  opts: ChangelogOpts,
): ChangelogResult {
  const {
    version,
    date,
    format,
    groupTitles,
    excludeTypes,
    includeNonConventional,
    bumpPolicy,
  } = opts;

  // Build set of excluded types: explicit excludeTypes + types mapped to 'none'
  const excludedSet = new Set<string>(excludeTypes);
  for (const [type, level] of Object.entries(bumpPolicy)) {
    if (level === 'none') {
      excludedSet.add(type);
    }
  }

  // Classify commits into groups
  const breakingCommits: Array<{ description: string; scope: string | null; breaking: boolean }> = [];
  const typeMap = new Map<string, Array<{ description: string; scope: string | null; breaking: boolean }>>();
  const nonConventionalCommits: Array<{ description: string; scope: string | null; breaking: boolean }> = [];

  for (const c of commits) {
    if (!c.parsed.valid) {
      // Non-conventional commit
      if (includeNonConventional) {
        nonConventionalCommits.push({
          description: c.parsed.rawMessage,
          scope: null,
          breaking: false,
        });
      }
      continue;
    }

    const cc = c.parsed as ConventionalCommit;

    // Breaking commits go to the breaking group (not duplicated in type group)
    if (cc.breaking) {
      breakingCommits.push({
        description: cc.description,
        scope: cc.scope,
        breaking: true,
      });
      continue;
    }

    // Skip excluded types
    if (excludedSet.has(cc.type)) {
      continue;
    }

    // Add to type group
    if (!typeMap.has(cc.type)) {
      typeMap.set(cc.type, []);
    }
    typeMap.get(cc.type)!.push({
      description: cc.description,
      scope: cc.scope,
      breaking: false,
    });
  }

  // Build ordered groups
  const groups: ChangelogGroup[] = [];

  // 1. Breaking Changes first
  if (breakingCommits.length > 0) {
    groups.push({
      title: groupTitles.breaking || DEFAULT_GROUP_TITLES.breaking,
      commits: breakingCommits,
    });
  }

  // 2. Known types in order: feat, fix, perf, revert
  for (const type of KNOWN_TYPE_ORDER) {
    const typeCommits = typeMap.get(type);
    if (typeCommits && typeCommits.length > 0) {
      groups.push({
        title: groupTitles[type] || DEFAULT_GROUP_TITLES[type] || type,
        commits: typeCommits,
      });
      typeMap.delete(type);
    }
  }

  // 3. Remaining types in alphabetical order
  const remainingTypes = Array.from(typeMap.keys()).sort();
  for (const type of remainingTypes) {
    const typeCommits = typeMap.get(type)!;
    if (typeCommits.length > 0) {
      groups.push({
        title: groupTitles[type] || type,
        commits: typeCommits,
      });
    }
  }

  // 4. Non-conventional commits last
  if (nonConventionalCommits.length > 0) {
    groups.push({
      title: 'Other Changes',
      commits: nonConventionalCommits,
    });
  }

  // Format output
  const markdown = formatChangelog(version, date, groups, format);

  return { markdown, groups };
}

// ── Formatting helpers ──────────────────────────────────────────────────────

function formatChangelog(
  version: string | null,
  date: string,
  groups: ChangelogGroup[],
  format: 'markdown' | 'plain',
): string {
  const lines: string[] = [];
  const isMarkdown = format === 'markdown';

  // Header
  const versionStr = version || 'Unreleased';
  if (isMarkdown) {
    lines.push(`## [${versionStr}] - ${date}`);
  } else {
    lines.push(`[${versionStr}] - ${date}`);
  }
  lines.push('');

  // Groups
  for (const group of groups) {
    if (isMarkdown) {
      lines.push(`### ${group.title}`);
    } else {
      lines.push(group.title);
    }
    lines.push('');

    for (const commit of group.commits) {
      const scopePart = commit.scope ? ` (${commit.scope})` : '';
      lines.push(`- ${commit.description}${scopePart}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}
