// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import type { VersioningsConfig } from './config.validator';

export interface StrategyParams {
  semver: string;           // 'patch' | 'minor' | 'major' | 'prepatch' | 'preminor' | 'premajor' | 'prerelease'
  version: string;          // full version, e.g. '1.2.3'
  comment: string;          // comment from --branch
  config: VersioningsConfig;
  currentBranch: string;    // current git branch
}

export interface StrategyValidationResult {
  valid: boolean;
  errors: string[];
}

export interface BranchResult {
  branchName: string | null;  // null = don't create branch (trunk-based)
  reuseBranch: boolean;       // true = switch to existing branch (release-branch, maintenance)
}

export interface Branching_Strategy {
  name(): string;
  composeBranchName(params: StrategyParams): BranchResult;
  composeTagName(params: StrategyParams): string;
  composeCommitMessage(params: StrategyParams): string;
  validateContext(params: StrategyParams): StrategyValidationResult;
}
