// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * Policy Checker — checks branch protection rules before mutating operations.
 *
 * Stage 1: Local check via git config (branch.<name>.pushRemote, etc.)
 * Stage 2: Remote check via SCM_Provider.getBranchProtection() (if available)
 * Stage 3: Aggregate results: warnings + errors + protectionInfo
 *
 * SCM API errors → warning, not pipeline interruption (graceful degradation).
 */

import type { Executor } from './executor';
import type { SCM_Provider, Branch_Protection_Rule } from './scm.provider';
import type { VersioningsConfig } from './config.validator';

export interface PolicyCheckResult {
  warnings: string[];
  errors: string[];
  protectionInfo: BranchProtectionInfo | null;
}

export interface BranchProtectionInfo {
  protected: boolean;
  source: 'git-config' | 'scm-api' | 'both';
  allowForcePush?: boolean;
  requirePullRequest?: boolean;
  requiredReviewers?: number;
  requiredStatusChecks?: string[];
  requireSignedCommits?: boolean;
  gpgSignConfigured?: boolean;
}

export interface PolicyCheckerDeps {
  executor: Executor;
  scmProvider?: SCM_Provider;
  config: VersioningsConfig;
}

async function checkGitConfig(
  targetBranch: string,
  executor: Executor,
): Promise<{ warnings: string[]; info: Partial<BranchProtectionInfo> }> {
  const warnings: string[] = [];
  const info: Partial<BranchProtectionInfo> = {};

  // Check branch-specific config
  try {
    const result = await executor.run(`git config --get-regexp branch.${targetBranch}.`);
    if (result.stdout.includes('pushRemote')) {
      warnings.push(`Branch "${targetBranch}" has pushRemote configured — push may be redirected`);
      info.protected = true;
    }
  } catch (_) {
    // git config exits with error if no matching keys — not an error
  }

  // Check receive.denyNonFastForwards
  try {
    const result = await executor.run('git config --get receive.denyNonFastForwards');
    if (result.stdout.trim() === 'true') {
      warnings.push('receive.denyNonFastForwards is enabled — non-fast-forward pushes will be rejected');
    }
  } catch (_) {
    // Key not found — not an error
  }

  // Check commit.gpgSign
  let gpgSignConfigured = false;
  try {
    const result = await executor.run('git config --get commit.gpgSign');
    if (result.stdout.trim() === 'true') {
      gpgSignConfigured = true;
    }
  } catch (_) {
    // Key not found
  }

  // Check tag.gpgSign
  try {
    const result = await executor.run('git config --get tag.gpgSign');
    if (result.stdout.trim() === 'true') {
      gpgSignConfigured = true;
    }
  } catch (_) {
    // Key not found
  }

  info.gpgSignConfigured = gpgSignConfigured;

  return { warnings, info };
}

async function checkScmProtection(
  targetBranch: string,
  scmProvider: SCM_Provider,
): Promise<{ warnings: string[]; rule: Branch_Protection_Rule | null }> {
  const warnings: string[] = [];

  if (!scmProvider.getBranchProtection) {
    return { warnings, rule: null };
  }

  try {
    const rule = await scmProvider.getBranchProtection(targetBranch);
    if (!rule || !rule.protected) {
      return { warnings, rule: null };
    }

    if (rule.requirePullRequest) {
      warnings.push(`Branch "${targetBranch}" requires pull request (direct push may be rejected)`);
    }
    if (rule.requiredReviewers > 0) {
      warnings.push(`Branch "${targetBranch}" requires minimum ${rule.requiredReviewers} reviewer(s)`);
    }
    if (rule.requiredStatusChecks && rule.requiredStatusChecks.length > 0) {
      warnings.push(`Branch "${targetBranch}" requires status checks: ${rule.requiredStatusChecks.join(', ')}`);
    }
    if (rule.requireSignedCommits) {
      warnings.push(`Branch "${targetBranch}" requires signed commits`);
    }

    return { warnings, rule };
  } catch (err: any) {
    warnings.push(`Could not check branch protection via API: ${err.message || String(err)}`);
    return { warnings, rule: null };
  }
}

/**
 * Checks branch protection rules before mutating operations.
 *
 * Returns PolicyCheckResult with warnings (non-blocking) and errors (blocking).
 * SCM API errors are treated as warnings, not errors.
 */
export async function checkPolicy(
  targetBranch: string,
  deps: PolicyCheckerDeps,
): Promise<PolicyCheckResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  let protectionInfo: BranchProtectionInfo | null = null;

  // Stage 1: Local git config checks
  const localResult = await checkGitConfig(targetBranch, deps.executor);
  warnings.push(...localResult.warnings);

  // Stage 2: Remote SCM API checks
  let scmRule: Branch_Protection_Rule | null = null;
  if (deps.scmProvider) {
    const scmResult = await checkScmProtection(targetBranch, deps.scmProvider);
    warnings.push(...scmResult.warnings);
    scmRule = scmResult.rule;
  }

  // Stage 3: Aggregate protectionInfo
  const hasLocal = localResult.info.protected === true;
  const hasRemote = scmRule !== null;

  if (hasLocal || hasRemote) {
    const source: BranchProtectionInfo['source'] =
      hasLocal && hasRemote ? 'both' : hasLocal ? 'git-config' : 'scm-api';

    protectionInfo = {
      protected: true,
      source,
      ...localResult.info,
    };

    if (scmRule) {
      protectionInfo.allowForcePush = scmRule.allowForcePush;
      protectionInfo.requirePullRequest = scmRule.requirePullRequest;
      protectionInfo.requiredReviewers = scmRule.requiredReviewers;
      protectionInfo.requiredStatusChecks = scmRule.requiredStatusChecks;
      protectionInfo.requireSignedCommits = scmRule.requireSignedCommits;
    }
  }

  return { warnings, errors, protectionInfo };
}
