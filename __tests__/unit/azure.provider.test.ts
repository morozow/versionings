// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { createAzureDevOpsProvider } from '../../azure.provider';
import type { SCM_ProviderConfig } from '../../scm.provider';
import type { HttpClient, HttpResponse } from '../../http.client';
import type { UrlParser, ParsedAzureDevOpsUrl } from '../../url.parser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<SCM_ProviderConfig>): SCM_ProviderConfig {
  return {
    platform: 'azure-devops',
    url: 'https://dev.azure.com/my-org/my-project/_git/my-repo',
    token: 'ado-pat-test123456',
    authMethod: 'token',
    timeout: 30_000,
    ...overrides,
  };
}

function makeResponse(body: any, status = 200): HttpResponse {
  return { status, body, headers: { 'content-type': 'application/json' } };
}

function makeMockHttpClient(): HttpClient & {
  post: jest.Mock;
  get: jest.Mock;
  patch: jest.Mock;
} {
  return {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
  };
}

function makeMockUrlParser(parsed?: Partial<ParsedAzureDevOpsUrl>): UrlParser {
  return {
    parse: jest.fn().mockReturnValue({
      platform: 'azure-devops',
      organization: 'my-org',
      project: 'my-project',
      repo: 'my-repo',
      ...parsed,
    } as ParsedAzureDevOpsUrl),
    format: jest.fn(),
  };
}

const PR_RESPONSE = {
  pullRequestId: 99,
  url: 'https://dev.azure.com/my-org/my-project/_git/my-repo/pullrequest/99',
};

// ---------------------------------------------------------------------------
// name()
// ---------------------------------------------------------------------------

describe('createAzureDevOpsProvider', () => {
  describe('name()', () => {
    test('returns "azure-devops"', () => {
      const provider = createAzureDevOpsProvider(makeConfig(), makeMockHttpClient(), makeMockUrlParser());
      expect(provider.name()).toBe('azure-devops');
    });
  });

  // ---------------------------------------------------------------------------
  // createPullRequest — basic PR creation
  // ---------------------------------------------------------------------------

  describe('createPullRequest()', () => {
    test('creates a PR via POST /{org}/{project}/_apis/git/repositories/{repo}/pullrequests', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(PR_RESPONSE, 201));

      const provider = createAzureDevOpsProvider(makeConfig(), http, makeMockUrlParser());
      const result = await provider.createPullRequest({
        title: 'Version patch: 1.0.1',
        body: 'Automated release',
        sourceBranch: 'version/patch/1.0.1/release',
        targetBranch: 'master',
      });

      expect(result.status).toBe('created');
      expect(result.number).toBe(99);
      expect(result.url).toBe('https://dev.azure.com/my-org/my-project/_git/my-repo/pullrequest/99');
      expect(result.platform).toBe('azure-devops');
      expect(result.fallbackReason).toBeNull();
      expect(result.warnings).toEqual([]);

      // Verify the POST call
      expect(http.post).toHaveBeenCalledWith(
        'https://dev.azure.com/my-org/my-project/_apis/git/repositories/my-repo/pullrequests?api-version=7.0',
        {
          title: 'Version patch: 1.0.1',
          description: 'Automated release',
          sourceRefName: 'refs/heads/version/patch/1.0.1/release',
          targetRefName: 'refs/heads/master',
        },
        expect.objectContaining({
          Authorization: expect.stringContaining('Basic '),
        }),
      );
    });

    // ---------------------------------------------------------------------------
    // refs/heads/ format
    // ---------------------------------------------------------------------------

    test('uses refs/heads/ prefix for sourceRefName and targetRefName', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(PR_RESPONSE, 201));

      const provider = createAzureDevOpsProvider(makeConfig(), http, makeMockUrlParser());
      await provider.createPullRequest({
        title: 'PR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
      });

      const body = http.post.mock.calls[0][1];
      expect(body.sourceRefName).toBe('refs/heads/feat/x');
      expect(body.targetRefName).toBe('refs/heads/main');
    });

    // ---------------------------------------------------------------------------
    // Draft mode
    // ---------------------------------------------------------------------------

    test('sends isDraft: true when opts.draft is true', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(PR_RESPONSE, 201));

      const provider = createAzureDevOpsProvider(makeConfig(), http, makeMockUrlParser());
      await provider.createPullRequest({
        title: 'Draft PR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        draft: true,
      });

      expect(http.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ isDraft: true }),
        expect.any(Object),
      );
    });

    test('does not send isDraft field when opts.draft is false/undefined', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(PR_RESPONSE, 201));

      const provider = createAzureDevOpsProvider(makeConfig(), http, makeMockUrlParser());
      await provider.createPullRequest({
        title: 'Normal PR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
      });

      const body = http.post.mock.calls[0][1];
      expect(body).not.toHaveProperty('isDraft');
    });

    // ---------------------------------------------------------------------------
    // Reviewers
    // ---------------------------------------------------------------------------

    test('passes reviewers as array of { id } in PR body', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(PR_RESPONSE, 201));

      const provider = createAzureDevOpsProvider(makeConfig(), http, makeMockUrlParser());
      const result = await provider.createPullRequest({
        title: 'PR with reviewers',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        reviewers: ['user-guid-1', 'user-guid-2'],
      });

      expect(result.warnings).toEqual([]);
      expect(http.post).toHaveBeenCalledWith(
        expect.stringContaining('/pullrequests?api-version=7.0'),
        expect.objectContaining({
          reviewers: [{ id: 'user-guid-1' }, { id: 'user-guid-2' }],
        }),
        expect.any(Object),
      );
    });

    // ---------------------------------------------------------------------------
    // Labels (post-create)
    // ---------------------------------------------------------------------------

    test('adds labels via POST .../{pullRequestId}/labels after PR creation', async () => {
      const http = makeMockHttpClient();
      http.post
        .mockResolvedValueOnce(makeResponse(PR_RESPONSE, 201))  // create PR
        .mockResolvedValueOnce(makeResponse({}, 201))            // label 1
        .mockResolvedValueOnce(makeResponse({}, 201));           // label 2

      const provider = createAzureDevOpsProvider(makeConfig(), http, makeMockUrlParser());
      const result = await provider.createPullRequest({
        title: 'PR with labels',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        labels: ['release', 'patch'],
      });

      expect(result.warnings).toEqual([]);
      expect(http.post).toHaveBeenCalledTimes(3);
      expect(http.post).toHaveBeenCalledWith(
        'https://dev.azure.com/my-org/my-project/_apis/git/repositories/my-repo/pullrequests/99/labels?api-version=7.0',
        { name: 'release' },
        expect.objectContaining({ Authorization: expect.any(String) }),
      );
      expect(http.post).toHaveBeenCalledWith(
        'https://dev.azure.com/my-org/my-project/_apis/git/repositories/my-repo/pullrequests/99/labels?api-version=7.0',
        { name: 'patch' },
        expect.objectContaining({ Authorization: expect.any(String) }),
      );
    });

    test('adds warning when label request fails', async () => {
      const http = makeMockHttpClient();
      http.post
        .mockResolvedValueOnce(makeResponse(PR_RESPONSE, 201))
        .mockRejectedValueOnce(new Error('Label error'));

      const provider = createAzureDevOpsProvider(makeConfig(), http, makeMockUrlParser());
      const result = await provider.createPullRequest({
        title: 'PR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        labels: ['bad-label'],
      });

      expect(result.status).toBe('created');
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('Failed to add label');
    });

    // ---------------------------------------------------------------------------
    // Unsupported: milestone
    // ---------------------------------------------------------------------------

    test('adds warning for milestone (unsupported)', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(PR_RESPONSE, 201));

      const provider = createAzureDevOpsProvider(makeConfig(), http, makeMockUrlParser());
      const result = await provider.createPullRequest({
        title: 'PR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        milestone: 'v1.0',
      });

      expect(result.status).toBe('created');
      expect(result.warnings).toContainEqual(
        expect.stringContaining('milestone'),
      );
    });

    // ---------------------------------------------------------------------------
    // Unsupported: linkedIssues
    // ---------------------------------------------------------------------------

    test('adds warning for linkedIssues (unsupported)', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(PR_RESPONSE, 201));

      const provider = createAzureDevOpsProvider(makeConfig(), http, makeMockUrlParser());
      const result = await provider.createPullRequest({
        title: 'PR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        linkedIssues: ['#123'],
      });

      expect(result.status).toBe('created');
      expect(result.warnings).toContainEqual(
        expect.stringContaining('linkedIssues'),
      );
    });

    // ---------------------------------------------------------------------------
    // Extract org/project/repo via UrlParser
    // ---------------------------------------------------------------------------

    test('extracts organization/project/repo from git.url via UrlParser', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse({
        pullRequestId: 7,
        url: 'https://dev.azure.com/acme/infra/_git/tools/pullrequest/7',
      }, 201));

      const urlParser = makeMockUrlParser({
        organization: 'acme',
        project: 'infra',
        repo: 'tools',
      });
      const config = makeConfig({ url: 'https://dev.azure.com/acme/infra/_git/tools' });
      const provider = createAzureDevOpsProvider(config, http, urlParser);

      await provider.createPullRequest({
        title: 'PR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
      });

      expect(urlParser.parse).toHaveBeenCalledWith(
        'https://dev.azure.com/acme/infra/_git/tools',
        'azure-devops',
      );
      expect(http.post).toHaveBeenCalledWith(
        'https://dev.azure.com/acme/infra/_apis/git/repositories/tools/pullrequests?api-version=7.0',
        expect.any(Object),
        expect.any(Object),
      );
    });

    // ---------------------------------------------------------------------------
    // Custom apiUrl
    // ---------------------------------------------------------------------------

    test('uses custom apiUrl when provided', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse({
        pullRequestId: 3,
        url: 'https://ado.corp.com/org/proj/_git/repo/pullrequest/3',
      }, 201));

      const config = makeConfig({ apiUrl: 'https://ado.corp.com' });
      const provider = createAzureDevOpsProvider(config, http, makeMockUrlParser());
      const result = await provider.createPullRequest({
        title: 'Custom API PR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
      });

      expect(result.url).toBe('https://ado.corp.com/org/proj/_git/repo/pullrequest/3');
      expect(http.post).toHaveBeenCalledWith(
        'https://ado.corp.com/my-org/my-project/_apis/git/repositories/my-repo/pullrequests?api-version=7.0',
        expect.any(Object),
        expect.any(Object),
      );
    });

    // ---------------------------------------------------------------------------
    // Auth header: Basic (PAT) vs Bearer
    // ---------------------------------------------------------------------------

    test('uses Basic auth with base64-encoded :{token} for PAT (default)', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(PR_RESPONSE, 201));

      const provider = createAzureDevOpsProvider(makeConfig(), http, makeMockUrlParser());
      await provider.createPullRequest({
        title: 'PR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
      });

      const expectedBasic = `Basic ${Buffer.from(':ado-pat-test123456').toString('base64')}`;
      expect(http.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          Authorization: expectedBasic,
        }),
      );
    });

    test('uses Bearer auth when authMethod is "bearer"', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(PR_RESPONSE, 201));

      const config = makeConfig({ authMethod: 'bearer' });
      const provider = createAzureDevOpsProvider(config, http, makeMockUrlParser());
      await provider.createPullRequest({
        title: 'PR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
      });

      expect(http.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          Authorization: 'Bearer ado-pat-test123456',
        }),
      );
    });

    // ---------------------------------------------------------------------------
    // All options combined
    // ---------------------------------------------------------------------------

    test('handles reviewers + labels + draft in one PR', async () => {
      const http = makeMockHttpClient();
      http.post
        .mockResolvedValueOnce(makeResponse(PR_RESPONSE, 201))  // create PR
        .mockResolvedValueOnce(makeResponse({}, 201));           // label

      const provider = createAzureDevOpsProvider(makeConfig(), http, makeMockUrlParser());
      const result = await provider.createPullRequest({
        title: 'Full PR',
        body: 'All options',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        reviewers: ['guid-1'],
        labels: ['release'],
        draft: true,
      });

      expect(result.status).toBe('created');
      expect(result.warnings).toEqual([]);
      expect(http.post).toHaveBeenCalledTimes(2);

      // Verify PR creation body
      expect(http.post).toHaveBeenCalledWith(
        expect.stringContaining('/pullrequests?api-version=7.0'),
        expect.objectContaining({
          isDraft: true,
          reviewers: [{ id: 'guid-1' }],
          sourceRefName: 'refs/heads/feat/x',
          targetRefName: 'refs/heads/main',
        }),
        expect.any(Object),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // generatePullRequestUrl
  // ---------------------------------------------------------------------------

  describe('generatePullRequestUrl()', () => {
    test('generates correct URL for Azure DevOps (default apiUrl)', () => {
      const provider = createAzureDevOpsProvider(makeConfig(), makeMockHttpClient(), makeMockUrlParser());
      const url = provider.generatePullRequestUrl('version/patch/1.0.1/release', 'master');
      expect(url).toBe(
        'https://dev.azure.com/my-org/my-project/_git/my-repo/pullrequestcreate?sourceRef=version%2Fpatch%2F1.0.1%2Frelease&targetRef=master',
      );
    });

    test('generates correct URL with custom apiUrl', () => {
      const config = makeConfig({ apiUrl: 'https://ado.corp.com' });
      const provider = createAzureDevOpsProvider(config, makeMockHttpClient(), makeMockUrlParser());
      const url = provider.generatePullRequestUrl('feat/x', 'develop');
      expect(url).toBe(
        'https://ado.corp.com/my-org/my-project/_git/my-repo/pullrequestcreate?sourceRef=feat%2Fx&targetRef=develop',
      );
    });
  });
});
