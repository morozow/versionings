// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import type { Executor } from './executor';
import { parseGitLog, GIT_LOG_FORMAT } from './commit.parser';
import type { CommitWithHash, ConventionalCommit } from './commit.parser';
import { VersioningsError, EXIT_CODES } from './errors';

// ── Types ───────────────────────────────────────────────────────────────────

/** Bump levels in priority order: major > minor > patch > none */
export type BumpLevel = 'major' | 'minor' | 'patch' | 'none';

/** Mapping of commit types to bump levels */
export interface BumpPolicy {
  [type: string]: BumpLevel;
}

/** Commit range between two points in git history */
export interface CommitRange {
  from: string;
  to: string;
}

/** Result of commit history analysis */
export interface BumpResult {
  bump: 'major' | 'minor' | 'patch';
  commits: CommitWithHash[];
  conventionalCommits: ConventionalCommit[];
  breakingChanges: ConventionalCommit[];
  range: CommitRange;
  commitsByType: Record<string, number>;
}

/** Dependencies for the commit analyzer */
export interface CommitAnalyzerDeps {
  executor: Executor;
  bumpPolicy: BumpPolicy;
  fallbackBump: 'major' | 'minor' | 'patch' | null;
}

// ── Default Bump Policy ─────────────────────────────────────────────────────

export const DEFAULT_BUMP_POLICY: BumpPolicy = {
  feat: 'minor',
  fix: 'patch',
  perf: 'patch',
  revert: 'patch',
  chore: 'none',
  docs: 'none',
  style: 'none',
  refactor: 'none',
  test: 'none',
  build: 'none',
  ci: 'none',
};

// ── Bump priority ───────────────────────────────────────────────────────────

const BUMP_PRIORITY: Record<BumpLevel, number> = {
  major: 3,
  minor: 2,
  patch: 1,
  none: 0,
};

// ── findLastVersionTag ──────────────────────────────────────────────────────

/**
 * Determines the last version tag in the repository.
 * Uses `git tag --list "v*" --sort=-version:refSort`.
 * If no tags exist, falls back to `git rev-list --max-parents=0 HEAD`
 * to get the root commit SHA.
 * Returns null only if even rev-list fails (e.g. empty repo).
 */
export async function findLastVersionTag(executor: Executor): Promise<string | null> {
  try {
    const tagResult = await executor.run('git tag --list "v*" --sort=-version:refSort');
    if (tagResult.lines.length > 0) {
      return tagResult.lines[0];
    }
  } catch {
    // No tags or git error — fall through to rev-list
  }

  try {
    const revResult = await executor.run('git rev-list --max-parents=0 HEAD');
    if (revResult.lines.length > 0) {
      return revResult.lines[0];
    }
  } catch {
    // Empty repo or other error
  }

  return null;
}

// ── getCommitsInRange ───────────────────────────────────────────────────────

/**
 * Gets commits in the specified range via git log.
 * Format: `git log <from>..<to> --format=GIT_LOG_FORMAT`
 */
export async function getCommitsInRange(
  executor: Executor,
  range: CommitRange,
): Promise<CommitWithHash[]> {
  const result = await executor.run(
    `git log ${range.from}..${range.to} --format="${GIT_LOG_FORMAT}"`,
  );
  return parseGitLog(result.stdout);
}

// ── analyzeBump ─────────────────────────────────────────────────────────────

/**
 * Analyzes commit history and determines the version bump type.
 *
 * 1. Finds the last version tag (or beginning of history)
 * 2. Gets commits in range tag..HEAD
 * 3. Parses each commit via parseCommit()
 * 4. Applies BumpPolicy to determine bump level per type
 * 5. Breaking change → major (always, regardless of BumpPolicy)
 * 6. Returns the maximum bump
 *
 * When no conventional commits are found:
 * - If fallbackBump !== null → uses fallbackBump
 * - Otherwise → throws VersioningsError(NO_CONVENTIONAL_COMMITS)
 */
export async function analyzeBump(deps: CommitAnalyzerDeps): Promise<BumpResult> {
  const { executor, bumpPolicy, fallbackBump } = deps;

  // 1. Find last version tag
  const lastTag = await findLastVersionTag(executor);
  const from = lastTag || '';
  const to = 'HEAD';
  const range: CommitRange = { from: from || 'ROOT', to };

  // 2. Get commits in range
  let commits: CommitWithHash[];
  if (lastTag) {
    commits = await getCommitsInRange(executor, { from: lastTag, to });
  } else {
    // No tags — get all commits
    const result = await executor.run(`git log HEAD --format="${GIT_LOG_FORMAT}"`);
    commits = parseGitLog(result.stdout);
  }

  // 3. Classify commits
  const conventionalCommits: ConventionalCommit[] = [];
  const breakingChanges: ConventionalCommit[] = [];
  const commitsByType: Record<string, number> = {};

  for (const c of commits) {
    if (c.parsed.valid) {
      const cc = c.parsed as ConventionalCommit;
      conventionalCommits.push(cc);
      commitsByType[cc.type] = (commitsByType[cc.type] || 0) + 1;
      if (cc.breaking) {
        breakingChanges.push(cc);
      }
    }
  }

  // 4. Determine max bump
  let maxBump: BumpLevel = 'none';

  for (const cc of conventionalCommits) {
    // Breaking change always → major, regardless of policy
    if (cc.breaking) {
      maxBump = 'major';
      break; // Can't go higher than major
    }

    const level = bumpPolicy[cc.type] || 'none';
    if (BUMP_PRIORITY[level] > BUMP_PRIORITY[maxBump]) {
      maxBump = level;
    }
  }

  // 5. Handle no conventional commits or all-none
  if (maxBump === 'none') {
    if (fallbackBump !== null) {
      return {
        bump: fallbackBump,
        commits,
        conventionalCommits,
        breakingChanges,
        range,
        commitsByType,
      };
    }

    throw new VersioningsError(
      EXIT_CODES.NO_CONVENTIONAL_COMMITS,
      `No conventional commits found in range ${range.from}..${range.to}`,
      {
        totalCommits: commits.length,
        range,
        recommendation:
          'Use --semver=patch|minor|major or set conventionalCommits.fallbackBump',
      },
    );
  }

  return {
    bump: maxBump as 'major' | 'minor' | 'patch',
    commits,
    conventionalCommits,
    breakingChanges,
    range,
    commitsByType,
  };
}
