// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { createGitLabProvider } from '../../../src/scm/providers/gitlab.provider';
import type { SCM_ProviderConfig } from '../../../src/scm/scm.provider';
import type { HttpClient, HttpResponse } from '../../../src/scm/http.client';
import type { UrlParser, ParsedGitLabUrl } from '../../../src/scm/url.parser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<SCM_ProviderConfig>): SCM_ProviderConfig {
  return {
    platform: 'gitlab',
    url: 'https://gitlab.com/my-group/my-project',
    token: 'glpat-test123456',
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

function makeMockUrlParser(parsed?: Partial<ParsedGitLabUrl>): UrlParser {
  return {
    parse: jest.fn().mockReturnValue({
      platform: 'gitlab',
      namespacePath: 'my-group',
      project: 'my-project',
      ...parsed,
    } as ParsedGitLabUrl),
    format: jest.fn(),
  };
}

const MR_RESPONSE = {
  iid: 17,
  web_url: 'https://gitlab.com/my-group/my-project/-/merge_requests/17',
};

// ---------------------------------------------------------------------------
// name()
// ---------------------------------------------------------------------------

describe('createGitLabProvider', () => {
  describe('name()', () => {
    test('returns "gitlab"', () => {
      const provider = createGitLabProvider(makeConfig(), makeMockHttpClient(), makeMockUrlParser());
      expect(provider.name()).toBe('gitlab');
    });
  });

  // ---------------------------------------------------------------------------
  // createPullRequest — basic MR creation
  // ---------------------------------------------------------------------------

  describe('createPullRequest()', () => {
    test('creates an MR via POST /api/v4/projects/{id}/merge_requests', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(MR_RESPONSE, 201));

      const provider = createGitLabProvider(makeConfig(), http, makeMockUrlParser());
      const result = await provider.createPullRequest({
        title: 'Version patch: 1.0.1',
        body: 'Automated release',
        sourceBranch: 'version/patch/1.0.1/release',
        targetBranch: 'master',
      });

      expect(result.status).toBe('created');
      expect(result.number).toBe(17);
      expect(result.url).toBe('https://gitlab.com/my-group/my-project/-/merge_requests/17');
      expect(result.platform).toBe('gitlab');
      expect(result.fallbackReason).toBeNull();
      expect(result.warnings).toEqual([]);

      // Verify the POST call — project_id is URL-encoded
      expect(http.post).toHaveBeenCalledWith(
        'https://gitlab.com/api/v4/projects/my-group%2Fmy-project/merge_requests',
        {
          title: 'Version patch: 1.0.1',
          description: 'Automated release',
          source_branch: 'version/patch/1.0.1/release',
          target_branch: 'master',
        },
        expect.objectContaining({
          'PRIVATE-TOKEN': 'glpat-test123456',
        }),
      );
    });

    // ---------------------------------------------------------------------------
    // project_id extraction — URL-encoded path
    // ---------------------------------------------------------------------------

    test('URL-encodes project_id from namespacePath/project', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(MR_RESPONSE, 201));

      const urlParser = makeMockUrlParser({
        namespacePath: 'org/team',
        project: 'repo',
      });
      const provider = createGitLabProvider(makeConfig(), http, urlParser);
      await provider.createPullRequest({
        title: 'MR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
      });

      expect(http.post).toHaveBeenCalledWith(
        'https://gitlab.com/api/v4/projects/org%2Fteam%2Frepo/merge_requests',
        expect.any(Object),
        expect.any(Object),
      );
    });

    // ---------------------------------------------------------------------------
    // Draft mode — prefix "Draft: " to title
    // ---------------------------------------------------------------------------

    test('prefixes "Draft: " to title when opts.draft is true', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(MR_RESPONSE, 201));

      const provider = createGitLabProvider(makeConfig(), http, makeMockUrlParser());
      await provider.createPullRequest({
        title: 'My MR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        draft: true,
      });

      expect(http.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ title: 'Draft: My MR' }),
        expect.any(Object),
      );
    });

    test('does not prefix title when draft is false/undefined', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(MR_RESPONSE, 201));

      const provider = createGitLabProvider(makeConfig(), http, makeMockUrlParser());
      await provider.createPullRequest({
        title: 'Normal MR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
      });

      const body = http.post.mock.calls[0][1];
      expect(body.title).toBe('Normal MR');
    });

    // ---------------------------------------------------------------------------
    // Reviewers — username → ID resolution
    // ---------------------------------------------------------------------------

    test('resolves reviewer usernames to IDs via GET /api/v4/users', async () => {
      const http = makeMockHttpClient();
      http.get
        .mockResolvedValueOnce(makeResponse([{ id: 101 }]))   // alice
        .mockResolvedValueOnce(makeResponse([{ id: 202 }]));  // bob
      http.post.mockResolvedValue(makeResponse(MR_RESPONSE, 201));

      const provider = createGitLabProvider(makeConfig(), http, makeMockUrlParser());
      const result = await provider.createPullRequest({
        title: 'MR with reviewers',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        reviewers: ['alice', 'bob'],
      });

      expect(result.warnings).toEqual([]);
      expect(http.get).toHaveBeenCalledTimes(2);
      expect(http.get).toHaveBeenCalledWith(
        'https://gitlab.com/api/v4/users?username=alice',
        expect.objectContaining({ 'PRIVATE-TOKEN': 'glpat-test123456' }),
      );
      expect(http.get).toHaveBeenCalledWith(
        'https://gitlab.com/api/v4/users?username=bob',
        expect.objectContaining({ 'PRIVATE-TOKEN': 'glpat-test123456' }),
      );

      // reviewer_ids should be in the MR creation body
      expect(http.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ reviewer_ids: [101, 202] }),
        expect.any(Object),
      );
    });

    test('adds warning when reviewer username cannot be resolved', async () => {
      const http = makeMockHttpClient();
      http.get.mockResolvedValueOnce(makeResponse([])); // empty result
      http.post.mockResolvedValue(makeResponse(MR_RESPONSE, 201));

      const provider = createGitLabProvider(makeConfig(), http, makeMockUrlParser());
      const result = await provider.createPullRequest({
        title: 'MR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        reviewers: ['nonexistent'],
      });

      expect(result.status).toBe('created');
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('nonexistent');
      expect(result.warnings[0]).toContain('not found');
    });

    test('adds warning when reviewer resolution request fails', async () => {
      const http = makeMockHttpClient();
      http.get.mockRejectedValueOnce(new Error('Network error'));
      http.post.mockResolvedValue(makeResponse(MR_RESPONSE, 201));

      const provider = createGitLabProvider(makeConfig(), http, makeMockUrlParser());
      const result = await provider.createPullRequest({
        title: 'MR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        reviewers: ['alice'],
      });

      expect(result.status).toBe('created');
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('Failed to add reviewers');
    });

    // ---------------------------------------------------------------------------
    // Labels — comma-separated string
    // ---------------------------------------------------------------------------

    test('passes labels as comma-separated string in MR body', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(MR_RESPONSE, 201));

      const provider = createGitLabProvider(makeConfig(), http, makeMockUrlParser());
      const result = await provider.createPullRequest({
        title: 'MR with labels',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        labels: ['release', 'patch', 'automated'],
      });

      expect(result.warnings).toEqual([]);
      expect(http.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ labels: 'release,patch,automated' }),
        expect.any(Object),
      );
    });

    // ---------------------------------------------------------------------------
    // Milestone — name → ID resolution
    // ---------------------------------------------------------------------------

    test('resolves milestone name to ID via GET /api/v4/projects/{id}/milestones', async () => {
      const http = makeMockHttpClient();
      http.get.mockResolvedValueOnce(makeResponse([{ id: 55 }])); // milestone
      http.post.mockResolvedValue(makeResponse(MR_RESPONSE, 201));

      const provider = createGitLabProvider(makeConfig(), http, makeMockUrlParser());
      const result = await provider.createPullRequest({
        title: 'MR with milestone',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        milestone: 'v1.0',
      });

      expect(result.warnings).toEqual([]);
      expect(http.get).toHaveBeenCalledWith(
        'https://gitlab.com/api/v4/projects/my-group%2Fmy-project/milestones?title=v1.0',
        expect.objectContaining({ 'PRIVATE-TOKEN': 'glpat-test123456' }),
      );
      expect(http.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ milestone_id: 55 }),
        expect.any(Object),
      );
    });

    test('adds warning when milestone cannot be resolved', async () => {
      const http = makeMockHttpClient();
      http.get.mockResolvedValueOnce(makeResponse([])); // empty
      http.post.mockResolvedValue(makeResponse(MR_RESPONSE, 201));

      const provider = createGitLabProvider(makeConfig(), http, makeMockUrlParser());
      const result = await provider.createPullRequest({
        title: 'MR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        milestone: 'nonexistent',
      });

      expect(result.status).toBe('created');
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('nonexistent');
      expect(result.warnings[0]).toContain('not found');
    });

    test('adds warning when milestone resolution request fails', async () => {
      const http = makeMockHttpClient();
      http.get.mockRejectedValueOnce(new Error('API error'));
      http.post.mockResolvedValue(makeResponse(MR_RESPONSE, 201));

      const provider = createGitLabProvider(makeConfig(), http, makeMockUrlParser());
      const result = await provider.createPullRequest({
        title: 'MR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        milestone: 'v2.0',
      });

      expect(result.status).toBe('created');
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('Failed to set milestone');
    });

    // ---------------------------------------------------------------------------
    // Unsupported: linkedIssues
    // ---------------------------------------------------------------------------

    test('adds warning for linkedIssues (unsupported)', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(MR_RESPONSE, 201));

      const provider = createGitLabProvider(makeConfig(), http, makeMockUrlParser());
      const result = await provider.createPullRequest({
        title: 'MR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        linkedIssues: ['#123', '#456'],
      });

      expect(result.status).toBe('created');
      expect(result.warnings).toContainEqual(
        expect.stringContaining('linkedIssues'),
      );
    });

    // ---------------------------------------------------------------------------
    // Self-hosted — custom apiUrl
    // ---------------------------------------------------------------------------

    test('uses custom apiUrl for self-hosted GitLab', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse({
        iid: 5,
        web_url: 'https://git.corp.com/team/project/-/merge_requests/5',
      }, 201));

      const config = makeConfig({
        apiUrl: 'https://git.corp.com',
      });
      const provider = createGitLabProvider(config, http, makeMockUrlParser());
      const result = await provider.createPullRequest({
        title: 'Self-hosted MR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
      });

      expect(result.url).toBe('https://git.corp.com/team/project/-/merge_requests/5');
      expect(http.post).toHaveBeenCalledWith(
        'https://git.corp.com/api/v4/projects/my-group%2Fmy-project/merge_requests',
        expect.any(Object),
        expect.any(Object),
      );
    });

    // ---------------------------------------------------------------------------
    // Auth header: Bearer vs PRIVATE-TOKEN
    // ---------------------------------------------------------------------------

    test('uses PRIVATE-TOKEN header for token auth method', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(MR_RESPONSE, 201));

      const provider = createGitLabProvider(makeConfig(), http, makeMockUrlParser());
      await provider.createPullRequest({
        title: 'MR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
      });

      expect(http.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          'PRIVATE-TOKEN': 'glpat-test123456',
        }),
      );
    });

    test('uses Bearer auth when authMethod is "bearer"', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(MR_RESPONSE, 201));

      const config = makeConfig({ authMethod: 'bearer' });
      const provider = createGitLabProvider(config, http, makeMockUrlParser());
      await provider.createPullRequest({
        title: 'MR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
      });

      expect(http.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          Authorization: 'Bearer glpat-test123456',
        }),
      );
    });

    // ---------------------------------------------------------------------------
    // All options combined
    // ---------------------------------------------------------------------------

    test('handles reviewers + labels + milestone + draft in one MR', async () => {
      const http = makeMockHttpClient();
      http.get
        .mockResolvedValueOnce(makeResponse([{ id: 10 }]))   // reviewer
        .mockResolvedValueOnce(makeResponse([{ id: 99 }]));  // milestone
      http.post.mockResolvedValue(makeResponse(MR_RESPONSE, 201));

      const provider = createGitLabProvider(makeConfig(), http, makeMockUrlParser());
      const result = await provider.createPullRequest({
        title: 'Full MR',
        body: 'All options',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        reviewers: ['alice'],
        labels: ['release'],
        milestone: 'v2.0',
        draft: true,
      });

      expect(result.status).toBe('created');
      expect(result.warnings).toEqual([]);
      expect(http.get).toHaveBeenCalledTimes(2);
      expect(http.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          title: 'Draft: Full MR',
          reviewer_ids: [10],
          labels: 'release',
          milestone_id: 99,
        }),
        expect.any(Object),
      );
    });

    // ---------------------------------------------------------------------------
    // Term "Merge Request" — platform field
    // ---------------------------------------------------------------------------

    test('returns platform "gitlab" in PR_Result', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(MR_RESPONSE, 201));

      const provider = createGitLabProvider(makeConfig(), http, makeMockUrlParser());
      const result = await provider.createPullRequest({
        title: 'MR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
      });

      expect(result.platform).toBe('gitlab');
    });
  });

  // ---------------------------------------------------------------------------
  // generatePullRequestUrl
  // ---------------------------------------------------------------------------

  describe('generatePullRequestUrl()', () => {
    test('generates correct URL for GitLab Cloud', () => {
      const provider = createGitLabProvider(makeConfig(), makeMockHttpClient(), makeMockUrlParser());
      const url = provider.generatePullRequestUrl('version/patch/1.0.1/release', 'master');
      expect(url).toBe(
        'https://gitlab.com/my-group/my-project/-/merge_requests/new?merge_request[source_branch]=version%2Fpatch%2F1.0.1%2Frelease&merge_request[target_branch]=master',
      );
    });

    test('generates correct URL for self-hosted GitLab', () => {
      const config = makeConfig({ apiUrl: 'https://git.corp.com' });
      const provider = createGitLabProvider(config, makeMockHttpClient(), makeMockUrlParser());
      const url = provider.generatePullRequestUrl('feat/x', 'develop');
      expect(url).toBe(
        'https://git.corp.com/my-group/my-project/-/merge_requests/new?merge_request[source_branch]=feat%2Fx&merge_request[target_branch]=develop',
      );
    });

    test('generates correct URL with nested namespace', () => {
      const urlParser = makeMockUrlParser({
        namespacePath: 'org/team/sub',
        project: 'repo',
      });
      const provider = createGitLabProvider(makeConfig(), makeMockHttpClient(), urlParser);
      const url = provider.generatePullRequestUrl('feat/x', 'main');
      expect(url).toBe(
        'https://gitlab.com/org/team/sub/repo/-/merge_requests/new?merge_request[source_branch]=feat%2Fx&merge_request[target_branch]=main',
      );
    });
  });
});
