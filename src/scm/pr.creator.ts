// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * PR/MR Creation Subsystem — coordinates Auth_Resolver, SCM_Registry,
 * HTTP_Client and URL_Parser to create Pull Requests / Merge Requests
 * via SCM provider APIs with fallback to URL generation.
 *
 * PR/MR errors do not interrupt the pipeline — no rollback is triggered.
 */

import type { PR_Options, PR_Result, SCM_ProviderConfig } from './scm.provider';
import { type PrMode } from './scm.provider';
import type { SCM_Registry } from './scm.registry';
import type { HttpClient } from './http.client';
import type { UrlParser } from './url.parser';
import type { AuthResult } from './auth.resolver';
import type { VersioningsConfig } from '../config/config.validator';
import { VersioningsError, EXIT_CODES } from '../core/errors';

export { PrMode } from './scm.provider';

// ---------------------------------------------------------------------------
// Extended config type — temporary until task 6 updates VersioningsConfig
// TODO(task-6): remove once VersioningsConfig includes auth/apiUrl/api/pr extensions
// ---------------------------------------------------------------------------

type PrCreatorConfig = VersioningsConfig & {
  git: VersioningsConfig['git'] & {
    auth?: { token?: string; method?: 'token' | 'bearer' };
    apiUrl?: string;
    api?: { timeout?: number };
    pr: VersioningsConfig['git']['pr'] & {
      reviewers?: string[];
      labels?: string[];
      draft?: boolean;
      template?: string;
      milestone?: string;
      linkedIssues?: string[];
    };
  };
};

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface PrCreatorDeps {
  registry: SCM_Registry;
  httpClient: HttpClient;
  urlParser: UrlParser;
  resolveAuth: (
    deps: { config: Record<string, any>; env: Record<string, string | undefined> },
    platform: string,
  ) => AuthResult;
  env: Record<string, string | undefined>;
  readFile?: (path: string) => string;
  changelogBody?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Reads PR body template from file. Returns empty string on failure.
 */
function readTemplate(templatePath: string | undefined, readFile?: (path: string) => string): string {
  if (!templatePath) return '';
  if (!readFile) return '';
  try {
    return readFile(templatePath);
  } catch {
    return '';
  }
}

/**
 * Builds PR_Options from config, branch, and commit message.
 */
function buildPrOptions(
  cfg: PrCreatorConfig,
  branch: string,
  commitMessage: string,
  readFile?: (path: string) => string,
  changelogBody?: string,
): PR_Options {
  const pr = cfg.git.pr;
  const template = readTemplate(pr.template, readFile);

  // Merge template and changelog body
  let body: string;
  if (template && changelogBody) {
    body = `${template}\n\n---\n\n${changelogBody}`;
  } else if (changelogBody) {
    body = changelogBody;
  } else {
    body = template;
  }

  return {
    title: commitMessage,
    body,
    sourceBranch: branch,
    targetBranch: pr.target || 'master',
    reviewers: pr.reviewers,
    labels: pr.labels,
    draft: pr.draft,
    template: pr.template,
    milestone: pr.milestone,
    linkedIssues: pr.linkedIssues,
  };
}

/**
 * Builds SCM_ProviderConfig from resolved auth and user config.
 */
function buildProviderConfig(cfg: PrCreatorConfig, auth: AuthResult): SCM_ProviderConfig {
  return {
    platform: cfg.git.platform || '',
    url: cfg.git.url || '',
    apiUrl: cfg.git.apiUrl,
    token: auth.token || '',
    authMethod: auth.method,
    timeout: cfg.git.api?.timeout ?? 30_000,
  };
}

/**
 * Creates a fallback PR_Result with URL-only generation.
 */
function fallbackResult(
  url: string,
  platform: string,
  reason: string,
): PR_Result {
  return {
    url,
    number: null,
    status: 'fallback',
    fallbackReason: reason,
    platform,
    warnings: [],
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates a PR/MR via API or generates a URL (fallback).
 *
 * Logic:
 * 1. prMode === 'url' → URL only, no API call
 * 2. Resolve auth token via Auth_Resolver
 * 3. token null + prMode 'api'  → VersioningsError(CONFIG_ERROR)
 * 4. token null + prMode 'auto' → fallback URL (reason: no_token)
 * 5. Get provider from SCM_Registry
 * 6. Call provider.createPullRequest(opts)
 * 7. API error + prMode 'auto' → fallback URL (reason: api_error)
 * 8. API error + prMode 'api'  → rethrow error
 *
 * Does not interrupt pipeline: PR/MR error does not trigger rollback.
 */
export async function createPR(
  config: VersioningsConfig,
  branch: string,
  commitMessage: string,
  prMode: PrMode,
  deps: PrCreatorDeps,
): Promise<PR_Result> {
  const cfg = config as PrCreatorConfig;
  const platform = cfg.git.platform || '';
  const targetBranch = cfg.git.pr?.target || 'master';

  // --- Mode: url — generate URL only, no API ---
  if (prMode === 'url') {
    const providerConfig = buildProviderConfig(cfg, { token: null, method: 'token' });
    const provider = deps.registry.getProvider(providerConfig, deps.httpClient, deps.urlParser);
    const url = provider.generatePullRequestUrl(branch, targetBranch);
    return {
      url,
      number: null,
      status: 'fallback',
      fallbackReason: null,
      platform,
      warnings: [],
    };
  }

  // --- Resolve authentication ---
  const auth = deps.resolveAuth({ config: config as Record<string, any>, env: deps.env }, platform);

  // --- No token ---
  if (!auth.token) {
    if (prMode === 'api') {
      throw new VersioningsError(
        EXIT_CODES.CONFIG_ERROR,
        'PR creation via API requires authentication token. Set git.auth.token, VERSIONINGS_TOKEN, or a platform-specific token environment variable.',
        { platform, prMode },
      );
    }
    // prMode === 'auto' → fallback
    const providerConfig = buildProviderConfig(cfg, auth);
    const provider = deps.registry.getProvider(providerConfig, deps.httpClient, deps.urlParser);
    const url = provider.generatePullRequestUrl(branch, targetBranch);
    return fallbackResult(url, platform, 'no_token');
  }

  // --- Token available — attempt API creation ---
  const providerConfig = buildProviderConfig(cfg, auth);
  const provider = deps.registry.getProvider(providerConfig, deps.httpClient, deps.urlParser);
  const prOptions = buildPrOptions(cfg, branch, commitMessage, deps.readFile, deps.changelogBody);

  try {
    return await provider.createPullRequest(prOptions);
  } catch (err) {
    if (prMode === 'api') {
      // Re-throw for strict API mode
      throw err;
    }
    // prMode === 'auto' → fallback on error
    const url = provider.generatePullRequestUrl(branch, targetBranch);
    const reason = err instanceof Error ? err.message : String(err);
    return fallbackResult(url, platform, reason);
  }
}
