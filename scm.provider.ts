// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * SCM Provider abstraction — unified interface for interacting with
 * SCM platforms (GitHub, GitLab, Bitbucket, Azure DevOps).
 *
 * Defines core types and interfaces used across the PR/MR automation subsystem.
 */

/** Mode for PR/MR creation: API-first with fallback, API-only, or URL-only. */
export type PrMode = 'auto' | 'api' | 'url';

/** Parameters for creating a Pull Request / Merge Request. */
export interface PR_Options {
  title: string;
  body: string;
  sourceBranch: string;
  targetBranch: string;
  reviewers?: string[];
  labels?: string[];
  draft?: boolean;
  template?: string;
  milestone?: string;
  linkedIssues?: string[];
}

/** Result of a PR/MR creation attempt. */
export interface PR_Result {
  url: string;
  number: number | null;
  status: 'created' | 'fallback' | 'skipped';
  fallbackReason: string | null;
  platform: string;
  warnings: string[];
}

/** Branch protection rule returned by SCM API. */
export interface Branch_Protection_Rule {
  protected: boolean;
  allowForcePush: boolean;
  requirePullRequest: boolean;
  requiredReviewers: number;
  requiredStatusChecks: string[];
  requireSignedCommits: boolean;
}

/** Unified interface for SCM platform providers. */
export interface SCM_Provider {
  /** Returns the provider name (e.g. 'github', 'gitlab'). */
  name(): string;
  /** Creates a PR/MR via the provider's REST API. */
  createPullRequest(opts: PR_Options): Promise<PR_Result>;
  /** Generates a URL for manual PR/MR creation (fallback). */
  generatePullRequestUrl(branch: string, target: string): string;
  /** Queries branch protection rules. Returns null if no protection. */
  getBranchProtection?(branch: string): Promise<Branch_Protection_Rule | null>;
}

/** Configuration for an SCM provider instance. */
export interface SCM_ProviderConfig {
  platform: string;
  url: string;
  apiUrl?: string;
  token: string;
  authMethod: 'token' | 'bearer';
  timeout: number;
}
