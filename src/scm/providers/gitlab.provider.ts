// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * GitLab Provider — SCM_Provider implementation for GitLab Cloud (gitlab.com)
 * and self-hosted GitLab instances (custom apiUrl).
 *
 * API: GitLab REST API v4
 * - POST /api/v4/projects/{id}/merge_requests
 * - GET /api/v4/users?username={name} (for reviewer_ids)
 * - GET /api/v4/projects/{id}/milestones?title={name} (for milestone_id)
 *
 * Specifics:
 * - Uses term "Merge Request" instead of "Pull Request"
 * - Draft MR: prefix "Draft: " to title
 * - Labels: comma-separated string
 * - project_id: URL-encoded path (namespace%2Fproject)
 */

import type { SCM_Provider, SCM_ProviderConfig, PR_Options, PR_Result } from '../scm.provider';
import type { HttpClient } from '../http.client';
import type { UrlParser, ParsedGitLabUrl } from '../url.parser';

const DEFAULT_API_URL = 'https://gitlab.com';

/**
 * Creates an SCM_Provider for GitLab Cloud or self-hosted GitLab.
 *
 * Uses config.apiUrl as the base API URL when provided (self-hosted),
 * otherwise defaults to https://gitlab.com (Cloud).
 */
export function createGitLabProvider(
  config: SCM_ProviderConfig,
  httpClient: HttpClient,
  urlParser: UrlParser,
): SCM_Provider {
  const baseApiUrl = (config.apiUrl || DEFAULT_API_URL).replace(/\/+$/, '');
  const authHeader = config.authMethod === 'bearer'
    ? `Bearer ${config.token}`
    : config.token;

  function headers(): Record<string, string> {
    if (config.authMethod === 'bearer') {
      return { Authorization: authHeader };
    }
    return { 'PRIVATE-TOKEN': authHeader };
  }

  function parseProject(): ParsedGitLabUrl {
    return urlParser.parse(config.url, config.platform) as ParsedGitLabUrl;
  }

  function projectId(): string {
    const { namespacePath, project } = parseProject();
    return encodeURIComponent(`${namespacePath}/${project}`);
  }

  return {
    name(): string {
      return config.platform;
    },

    async createPullRequest(opts: PR_Options): Promise<PR_Result> {
      const pid = projectId();
      const warnings: string[] = [];

      // --- Build MR body ---
      const mrBody: Record<string, any> = {
        title: opts.draft ? `Draft: ${opts.title}` : opts.title,
        description: opts.body,
        source_branch: opts.sourceBranch,
        target_branch: opts.targetBranch,
      };

      // --- Reviewers: resolve usernames to IDs ---
      if (opts.reviewers && opts.reviewers.length > 0) {
        try {
          const reviewerIds: number[] = [];
          for (const username of opts.reviewers) {
            const res = await httpClient.get(
              `${baseApiUrl}/api/v4/users?username=${encodeURIComponent(username)}`,
              headers(),
            );
            if (Array.isArray(res.body) && res.body.length > 0) {
              reviewerIds.push(res.body[0].id);
            } else {
              warnings.push(`Failed to resolve reviewer "${username}": user not found`);
            }
          }
          if (reviewerIds.length > 0) {
            mrBody.reviewer_ids = reviewerIds;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          warnings.push(`Failed to add reviewers: ${msg}`);
        }
      }

      // --- Labels: comma-separated string ---
      if (opts.labels && opts.labels.length > 0) {
        mrBody.labels = opts.labels.join(',');
      }

      // --- Milestone: resolve name to ID ---
      if (opts.milestone) {
        try {
          const res = await httpClient.get(
            `${baseApiUrl}/api/v4/projects/${pid}/milestones?title=${encodeURIComponent(opts.milestone)}`,
            headers(),
          );
          if (Array.isArray(res.body) && res.body.length > 0) {
            mrBody.milestone_id = res.body[0].id;
          } else {
            warnings.push(`Failed to resolve milestone "${opts.milestone}": milestone not found`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          warnings.push(`Failed to set milestone: ${msg}`);
        }
      }

      // --- Unsupported: linkedIssues ---
      if (opts.linkedIssues && opts.linkedIssues.length > 0) {
        warnings.push('GitLab provider does not support linkedIssues parameter');
      }

      // --- Create the MR ---
      const createRes = await httpClient.post(
        `${baseApiUrl}/api/v4/projects/${pid}/merge_requests`,
        mrBody,
        headers(),
      );

      const mrNumber: number = createRes.body.iid;
      const mrUrl: string = createRes.body.web_url;

      return {
        url: mrUrl,
        number: mrNumber,
        status: 'created',
        fallbackReason: null,
        platform: config.platform,
        warnings,
      };
    },

    generatePullRequestUrl(branch: string, target: string): string {
      const { namespacePath, project } = parseProject();
      const baseUrl = (config.apiUrl || DEFAULT_API_URL).replace(/\/+$/, '');
      // For self-hosted, use apiUrl as the web base; for cloud, use gitlab.com
      const webBase = baseUrl.replace(/\/api\/v4\/?$/, '').replace(/\/+$/, '');
      return `${webBase}/${namespacePath}/${project}/-/merge_requests/new?merge_request[source_branch]=${encodeURIComponent(branch)}&merge_request[target_branch]=${encodeURIComponent(target)}`;
    },
  };
}
