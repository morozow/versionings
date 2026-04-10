// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * Bitbucket Provider — SCM_Provider implementations for Bitbucket Cloud
 * (api.bitbucket.org) and Bitbucket Server / Data Center (custom apiUrl).
 *
 * Bitbucket Cloud API v2.0:
 * - POST /2.0/repositories/{workspace}/{repo_slug}/pullrequests
 * - GET /2.0/users/{username} (for reviewer UUID)
 *
 * Bitbucket Server API v1.0:
 * - POST /rest/api/1.0/projects/{projectKey}/repos/{repositorySlug}/pull-requests
 *
 * Specifics:
 * - Cloud: reviewers as array of { uuid }
 * - Server: projectKey and repositorySlug from URL or config
 * - Draft PR: warning if API does not support it
 * - Unsupported params (labels, milestone) → warnings
 */

import type { SCM_Provider, SCM_ProviderConfig, PR_Options, PR_Result } from '../scm.provider';
import type { HttpClient } from '../http.client';
import type { UrlParser, ParsedBitbucketCloudUrl, ParsedBitbucketServerUrl } from '../url.parser';

const CLOUD_API_URL = 'https://api.bitbucket.org';

/**
 * Creates an SCM_Provider for Bitbucket Cloud (api.bitbucket.org).
 *
 * Auth: Authorization: Bearer {token}
 * API: Bitbucket Cloud REST API v2.0
 */
export function createBitbucketCloudProvider(
  config: SCM_ProviderConfig,
  httpClient: HttpClient,
  urlParser: UrlParser,
): SCM_Provider {
  const baseApiUrl = CLOUD_API_URL;
  const authHeader = `Bearer ${config.token}`;

  function headers(): Record<string, string> {
    return {
      Authorization: authHeader,
    };
  }

  function parseRepo(): ParsedBitbucketCloudUrl {
    return urlParser.parse(config.url, config.platform) as ParsedBitbucketCloudUrl;
  }

  return {
    name(): string {
      return config.platform;
    },

    async createPullRequest(opts: PR_Options): Promise<PR_Result> {
      const { workspace, repoSlug } = parseRepo();
      const warnings: string[] = [];

      // --- Build PR body ---
      const prBody: Record<string, any> = {
        title: opts.title,
        description: opts.body,
        source: { branch: { name: opts.sourceBranch } },
        destination: { branch: { name: opts.targetBranch } },
      };

      // --- Draft: Bitbucket Cloud does not support draft PRs ---
      if (opts.draft) {
        warnings.push('Bitbucket Cloud does not support draft pull requests');
      }

      // --- Reviewers: resolve usernames to UUIDs ---
      if (opts.reviewers && opts.reviewers.length > 0) {
        try {
          const reviewers: Array<{ uuid: string }> = [];
          for (const username of opts.reviewers) {
            const res = await httpClient.get(
              `${baseApiUrl}/2.0/users/${encodeURIComponent(username)}`,
              headers(),
            );
            if (res.body && res.body.uuid) {
              reviewers.push({ uuid: res.body.uuid });
            } else {
              warnings.push(`Failed to resolve reviewer "${username}": user not found`);
            }
          }
          if (reviewers.length > 0) {
            prBody.reviewers = reviewers;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          warnings.push(`Failed to add reviewers: ${msg}`);
        }
      }

      // --- Unsupported: labels ---
      if (opts.labels && opts.labels.length > 0) {
        warnings.push('Bitbucket Cloud does not support labels parameter');
      }

      // --- Unsupported: milestone ---
      if (opts.milestone) {
        warnings.push('Bitbucket Cloud does not support milestone parameter');
      }

      // --- Unsupported: linkedIssues ---
      if (opts.linkedIssues && opts.linkedIssues.length > 0) {
        warnings.push('Bitbucket Cloud does not support linkedIssues parameter');
      }

      // --- Create the PR ---
      const createRes = await httpClient.post(
        `${baseApiUrl}/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/pullrequests`,
        prBody,
        headers(),
      );

      const prId: number = createRes.body.id;
      const prUrl: string = createRes.body.links?.html?.href
        || `https://bitbucket.org/${workspace}/${repoSlug}/pull-requests/${prId}`;

      return {
        url: prUrl,
        number: prId,
        status: 'created',
        fallbackReason: null,
        platform: config.platform,
        warnings,
      };
    },

    generatePullRequestUrl(branch: string, target: string): string {
      const { workspace, repoSlug } = parseRepo();
      const baseUrl = `https://bitbucket.org/${workspace}/${repoSlug}`;
      return `${baseUrl}/pull-requests/new?source=${encodeURIComponent(branch)}&dest=${encodeURIComponent(target)}&t=1`;
    },
  };
}


/**
 * Creates an SCM_Provider for Bitbucket Server / Data Center.
 *
 * Auth: Authorization: Bearer {token} or Authorization: token {token}
 * API: Bitbucket Server REST API v1.0
 * Requires config.apiUrl (base URL of the Bitbucket Server instance).
 */
export function createBitbucketServerProvider(
  config: SCM_ProviderConfig,
  httpClient: HttpClient,
  urlParser: UrlParser,
): SCM_Provider {
  const baseApiUrl = (config.apiUrl || '').replace(/\/+$/, '');
  const authHeader = config.authMethod === 'bearer'
    ? `Bearer ${config.token}`
    : `token ${config.token}`;

  function headers(): Record<string, string> {
    return {
      Authorization: authHeader,
    };
  }

  function parseRepo(): ParsedBitbucketServerUrl {
    return urlParser.parse(config.url, config.platform) as ParsedBitbucketServerUrl;
  }

  /**
   * Extracts projectKey and repositorySlug from URL or config overrides
   * (git.project and git.repo).
   */
  function getProjectAndRepo(): { projectKey: string; repositorySlug: string } {
    const parsed = parseRepo();
    const cfg = config as any;
    return {
      projectKey: cfg.project || parsed.projectKey,
      repositorySlug: cfg.repo || parsed.repositorySlug,
    };
  }

  return {
    name(): string {
      return config.platform;
    },

    async createPullRequest(opts: PR_Options): Promise<PR_Result> {
      const { projectKey, repositorySlug } = getProjectAndRepo();
      const warnings: string[] = [];

      // --- Build PR body (Server format) ---
      const prBody: Record<string, any> = {
        title: opts.title,
        description: opts.body,
        fromRef: { id: `refs/heads/${opts.sourceBranch}` },
        toRef: { id: `refs/heads/${opts.targetBranch}` },
      };

      // --- Reviewers: array of { user: { name } } ---
      if (opts.reviewers && opts.reviewers.length > 0) {
        prBody.reviewers = opts.reviewers.map((name) => ({ user: { name } }));
      }

      // --- Draft: Bitbucket Server does not support draft PRs ---
      if (opts.draft) {
        warnings.push('Bitbucket Server does not support draft pull requests');
      }

      // --- Unsupported: labels ---
      if (opts.labels && opts.labels.length > 0) {
        warnings.push('Bitbucket Server does not support labels parameter');
      }

      // --- Unsupported: milestone ---
      if (opts.milestone) {
        warnings.push('Bitbucket Server does not support milestone parameter');
      }

      // --- Unsupported: linkedIssues ---
      if (opts.linkedIssues && opts.linkedIssues.length > 0) {
        warnings.push('Bitbucket Server does not support linkedIssues parameter');
      }

      // --- Create the PR ---
      const createRes = await httpClient.post(
        `${baseApiUrl}/rest/api/1.0/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repositorySlug)}/pull-requests`,
        prBody,
        headers(),
      );

      const prId: number = createRes.body.id;
      const prUrl: string = createRes.body.links?.self?.[0]?.href
        || `${baseApiUrl}/projects/${projectKey}/repos/${repositorySlug}/pull-requests/${prId}`;

      return {
        url: prUrl,
        number: prId,
        status: 'created',
        fallbackReason: null,
        platform: config.platform,
        warnings,
      };
    },

    generatePullRequestUrl(branch: string, target: string): string {
      const { projectKey, repositorySlug } = getProjectAndRepo();
      return `${baseApiUrl}/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repositorySlug)}/pull-requests?create&sourceBranch=${encodeURIComponent(branch)}&targetBranch=${encodeURIComponent(target)}`;
    },
  };
}
