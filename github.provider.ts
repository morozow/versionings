// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * GitHub Provider — SCM_Provider implementation for GitHub Cloud (api.github.com)
 * and GitHub Enterprise Server (custom apiUrl).
 *
 * API: GitHub REST API v3
 * - POST /repos/{owner}/{repo}/pulls
 * - POST /repos/{owner}/{repo}/pulls/{number}/requested_reviewers
 * - POST /repos/{owner}/{repo}/issues/{number}/labels
 * - PATCH /repos/{owner}/{repo}/issues/{number} (milestone)
 *
 * Header: Accept: application/vnd.github+json
 */

import type { SCM_Provider, SCM_ProviderConfig, PR_Options, PR_Result } from './scm.provider';
import type { HttpClient } from './http.client';
import type { UrlParser, ParsedGitHubUrl } from './url.parser';

const DEFAULT_API_URL = 'https://api.github.com';
const ACCEPT_HEADER = 'application/vnd.github+json';

/**
 * Creates an SCM_Provider for GitHub Cloud or GitHub Enterprise Server.
 *
 * Uses config.apiUrl as the base API URL when provided (Enterprise),
 * otherwise defaults to https://api.github.com (Cloud).
 */
export function createGitHubProvider(
  config: SCM_ProviderConfig,
  httpClient: HttpClient,
  urlParser: UrlParser,
): SCM_Provider {
  const baseApiUrl = (config.apiUrl || DEFAULT_API_URL).replace(/\/+$/, '');
  const authHeader = config.authMethod === 'bearer'
    ? `Bearer ${config.token}`
    : `token ${config.token}`;

  function headers(): Record<string, string> {
    return {
      Accept: ACCEPT_HEADER,
      Authorization: authHeader,
    };
  }

  function parseOwnerRepo(): ParsedGitHubUrl {
    return urlParser.parse(config.url, config.platform) as ParsedGitHubUrl;
  }

  return {
    name(): string {
      return config.platform;
    },

    async createPullRequest(opts: PR_Options): Promise<PR_Result> {
      const { owner, repo } = parseOwnerRepo();
      const warnings: string[] = [];

      // --- Create the PR ---
      const createBody: Record<string, any> = {
        title: opts.title,
        body: opts.body,
        head: opts.sourceBranch,
        base: opts.targetBranch,
      };
      if (opts.draft) {
        createBody.draft = true;
      }

      const createRes = await httpClient.post(
        `${baseApiUrl}/repos/${owner}/${repo}/pulls`,
        createBody,
        headers(),
      );

      const prNumber: number = createRes.body.number;
      const prUrl: string = createRes.body.html_url;

      // --- Post-creation: Reviewers ---
      if (opts.reviewers && opts.reviewers.length > 0) {
        try {
          await httpClient.post(
            `${baseApiUrl}/repos/${owner}/${repo}/pulls/${prNumber}/requested_reviewers`,
            { reviewers: opts.reviewers },
            headers(),
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          warnings.push(`Failed to add reviewers: ${msg}`);
        }
      }

      // --- Post-creation: Labels ---
      if (opts.labels && opts.labels.length > 0) {
        try {
          await httpClient.post(
            `${baseApiUrl}/repos/${owner}/${repo}/issues/${prNumber}/labels`,
            { labels: opts.labels },
            headers(),
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          warnings.push(`Failed to add labels: ${msg}`);
        }
      }

      // --- Post-creation: Milestone ---
      if (opts.milestone) {
        try {
          await httpClient.patch(
            `${baseApiUrl}/repos/${owner}/${repo}/issues/${prNumber}`,
            { milestone: opts.milestone },
            headers(),
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          warnings.push(`Failed to set milestone: ${msg}`);
        }
      }

      // --- Unsupported: linkedIssues ---
      if (opts.linkedIssues && opts.linkedIssues.length > 0) {
        warnings.push('GitHub provider does not support linkedIssues parameter');
      }

      return {
        url: prUrl,
        number: prNumber,
        status: 'created',
        fallbackReason: null,
        platform: config.platform,
        warnings,
      };
    },

    generatePullRequestUrl(branch: string, target: string): string {
      const { owner, repo } = parseOwnerRepo();
      const baseUrl = config.url.includes('git@')
        ? `https://${new URL(baseApiUrl).hostname === 'api.github.com' ? 'github.com' : new URL(baseApiUrl).hostname}/${owner}/${repo}`
        : config.url.replace(/\.git\s*$/, '');

      // Use the composePullRequestUrl pattern: {url}/compare/{target}...{branch}?expand=1
      const cleanUrl = baseUrl.replace(/\/+$/, '');
      return `${cleanUrl}/compare/${target}...${branch}?expand=1`;
    },
  };
}
