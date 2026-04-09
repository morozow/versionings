// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * Azure DevOps Provider — SCM_Provider implementation for Azure DevOps
 * (dev.azure.com).
 *
 * API: Azure DevOps REST API v7.0
 * - POST /{org}/{project}/_apis/git/repositories/{repoId}/pullrequests?api-version=7.0
 * - POST /{org}/{project}/_apis/git/repositories/{repoId}/pullrequests/{id}/labels?api-version=7.0
 *
 * Specifics:
 * - sourceRefName/targetRefName in format refs/heads/{branch}
 * - isDraft: true for draft PR
 * - reviewers as array of { id }
 * - Labels added via separate POST after PR creation
 * - Auth: Basic :{token} (PAT) or Bearer {token}
 */

import type { SCM_Provider, SCM_ProviderConfig, PR_Options, PR_Result } from './scm.provider';
import type { HttpClient } from './http.client';
import type { UrlParser, ParsedAzureDevOpsUrl } from './url.parser';

const DEFAULT_API_URL = 'https://dev.azure.com';
const API_VERSION = '7.0';

/**
 * Creates an SCM_Provider for Azure DevOps.
 *
 * Uses config.apiUrl as the base API URL when provided,
 * otherwise defaults to https://dev.azure.com.
 */
export function createAzureDevOpsProvider(
  config: SCM_ProviderConfig,
  httpClient: HttpClient,
  urlParser: UrlParser,
): SCM_Provider {
  const baseApiUrl = (config.apiUrl || DEFAULT_API_URL).replace(/\/+$/, '');
  const authHeader = config.authMethod === 'bearer'
    ? `Bearer ${config.token}`
    : `Basic ${Buffer.from(`:${config.token}`).toString('base64')}`;

  function headers(): Record<string, string> {
    return {
      Authorization: authHeader,
    };
  }

  function parseRepo(): ParsedAzureDevOpsUrl {
    return urlParser.parse(config.url, config.platform) as ParsedAzureDevOpsUrl;
  }

  return {
    name(): string {
      return config.platform;
    },

    async createPullRequest(opts: PR_Options): Promise<PR_Result> {
      const { organization, project, repo } = parseRepo();
      const warnings: string[] = [];

      // --- Build PR body ---
      const prBody: Record<string, any> = {
        title: opts.title,
        description: opts.body,
        sourceRefName: `refs/heads/${opts.sourceBranch}`,
        targetRefName: `refs/heads/${opts.targetBranch}`,
      };

      // --- Draft ---
      if (opts.draft) {
        prBody.isDraft = true;
      }

      // --- Reviewers: array of { id } ---
      if (opts.reviewers && opts.reviewers.length > 0) {
        prBody.reviewers = opts.reviewers.map((id) => ({ id }));
      }

      // --- Create the PR ---
      const createRes = await httpClient.post(
        `${baseApiUrl}/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/pullrequests?api-version=${API_VERSION}`,
        prBody,
        headers(),
      );

      const prId: number = createRes.body.pullRequestId;
      const prUrl: string = createRes.body.url
        || `${baseApiUrl}/${organization}/${project}/_git/${repo}/pullrequest/${prId}`;

      // --- Post-creation: Labels ---
      if (opts.labels && opts.labels.length > 0) {
        for (const label of opts.labels) {
          try {
            await httpClient.post(
              `${baseApiUrl}/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/pullrequests/${prId}/labels?api-version=${API_VERSION}`,
              { name: label },
              headers(),
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            warnings.push(`Failed to add label "${label}": ${msg}`);
          }
        }
      }

      // --- Unsupported: milestone ---
      if (opts.milestone) {
        warnings.push('Azure DevOps provider does not support milestone parameter');
      }

      // --- Unsupported: linkedIssues ---
      if (opts.linkedIssues && opts.linkedIssues.length > 0) {
        warnings.push('Azure DevOps provider does not support linkedIssues parameter');
      }

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
      const { organization, project, repo } = parseRepo();
      const webBase = (config.apiUrl || DEFAULT_API_URL).replace(/\/+$/, '');
      return `${webBase}/${organization}/${project}/_git/${repo}/pullrequestcreate?sourceRef=${encodeURIComponent(branch)}&targetRef=${encodeURIComponent(target)}`;
    },
  };
}
