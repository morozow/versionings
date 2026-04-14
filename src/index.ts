// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * versionings — public API surface.
 *
 * Re-exports from all domain modules. Consumers can import from
 * 'versionings' directly or from specific subpaths.
 *
 * Note: BumpLevel is exported from both config and versioning modules.
 * The canonical export comes from config (config.validator.ts).
 * Import from 'versionings/versioning' for the commit.analyzer variant.
 */

export * from './branching';
export * from './cli';
export * from './config';
export * from './core';
export * from './scm';
export * from './utils';

// versioning has a BumpLevel conflict with config — re-export selectively
export {
  generateChangelog,
  DEFAULT_GROUP_TITLES,
  analyzeBump,
  findLastVersionTag,
  getCommitsInRange,
  DEFAULT_BUMP_POLICY,
  parseCommit,
  parseGitLog,
  CONVENTIONAL_TYPES,
  COMMIT_SEPARATOR,
  GIT_LOG_FORMAT,
  printCommit,
  AVAILABLE_SEMVERS,
  GIT_URL_REG_EX,
  DOUBLE_DASH_SYMBOL,
  SLASH_SYMBOL,
  repositorySourceBranch,
  semverMessage,
  semverNpmMessage,
  composePullRequestUrl,
  composeVersionBranchName,
  composeVersionTagName,
  generatePullRequestUrl,
  preidParam,
  resetVersion,
} from './versioning';
export type {
  ChangelogOpts,
  ChangelogGroup,
  ChangelogResult,
  BumpPolicy,
  CommitRange,
  BumpResult,
  CommitAnalyzerDeps,
  CommitFooter,
  ConventionalCommit,
  InvalidCommit,
  ParsedCommit,
  CommitWithHash,
} from './versioning';
