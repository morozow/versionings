// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { createGitHubProvider } from '../../../src/scm/providers/github.provider';
import type { SCM_ProviderConfig } from '../../../src/scm/scm.provider';
import type { HttpClient, HttpResponse } from '../../../src/scm/http.client';
import type { UrlParser } from '../../../src/scm/url.parser';
import type { ParsedGitHubUrl } from '../../../src/scm/url.parser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<SCM_ProviderConfig>): SCM_ProviderConfig {
  return {
    platform: 'github',
    url: 'https://github.com/octocat/hello-world',
    token: 'ghp_test123456',
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

function makeMockUrlParser(parsed?: Partial<ParsedGitHubUrl>): UrlParser {
  return {
    parse: jest.fn().mockReturnValue({
      platform: 'github',
      owner: 'octocat',
      repo: 'hello-world',
      ...parsed,
    } as ParsedGitHubUrl),
    format: jest.fn(),
  };
}

const PR_RESPONSE = {
  number: 42,
  html_url: 'https://github.com/octocat/hello-world/pull/42',
};

// ---------------------------------------------------------------------------
// name()
// ---------------------------------------------------------------------------

describe('createGitHubProvider', () => {
  describe('name()', () => {
    test('returns "github" for cloud', () => {
      const provider = createGitHubProvider(makeConfig(), makeMockHttpClient(), makeMockUrlParser());
      expect(provider.name()).toBe('github');
    });

    test('returns "github-enterprise" for enterprise', () => {
      const config = makeConfig({ platform: 'github-enterprise', apiUrl: 'https://ghe.corp.com/api/v3' });
      const provider = createGitHubProvider(config, makeMockHttpClient(), makeMockUrlParser());
      expect(provider.name()).toBe('github-enterprise');
    });
  });

  // ---------------------------------------------------------------------------
  // createPullRequest — basic PR creation
  // ---------------------------------------------------------------------------

  describe('createPullRequest()', () => {
    test('creates a PR via POST /repos/{owner}/{repo}/pulls', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(PR_RESPONSE, 201));

      const provider = createGitHubProvider(makeConfig(), http, makeMockUrlParser());
      const result = await provider.createPullRequest({
        title: 'Version patch: 1.0.1',
        body: 'Automated release',
        sourceBranch: 'version/patch/1.0.1/release',
        targetBranch: 'master',
      });

      expect(result.status).toBe('created');
      expect(result.number).toBe(42);
      expect(result.url).toBe('https://github.com/octocat/hello-world/pull/42');
      expect(result.platform).toBe('github');
      expect(result.fallbackReason).toBeNull();
      expect(result.warnings).toEqual([]);

      // Verify the POST call
      expect(http.post).toHaveBeenCalledWith(
        'https://api.github.com/repos/octocat/hello-world/pulls',
        {
          title: 'Version patch: 1.0.1',
          body: 'Automated release',
          head: 'version/patch/1.0.1/release',
          base: 'master',
        },
        expect.objectContaining({
          Accept: 'application/vnd.github+json',
          Authorization: 'token ghp_test123456',
        }),
      );
    });

    // ---------------------------------------------------------------------------
    // Draft mode
    // ---------------------------------------------------------------------------

    test('sends draft: true when opts.draft is true', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(PR_RESPONSE, 201));

      const provider = createGitHubProvider(makeConfig(), http, makeMockUrlParser());
      await provider.createPullRequest({
        title: 'Draft PR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        draft: true,
      });

      expect(http.post).toHaveBeenCalledWith(
        'https://api.github.com/repos/octocat/hello-world/pulls',
        expect.objectContaining({ draft: true }),
        expect.any(Object),
      );
    });

    test('does not send draft field when opts.draft is false/undefined', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(PR_RESPONSE, 201));

      const provider = createGitHubProvider(makeConfig(), http, makeMockUrlParser());
      await provider.createPullRequest({
        title: 'Normal PR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
      });

      const body = http.post.mock.calls[0][1];
      expect(body).not.toHaveProperty('draft');
    });

    // ---------------------------------------------------------------------------
    // Reviewers
    // ---------------------------------------------------------------------------

    test('adds reviewers via POST /pulls/{n}/requested_reviewers', async () => {
      const http = makeMockHttpClient();
      http.post
        .mockResolvedValueOnce(makeResponse(PR_RESPONSE, 201))  // create PR
        .mockResolvedValueOnce(makeResponse({}, 201));           // add reviewers

      const provider = createGitHubProvider(makeConfig(), http, makeMockUrlParser());
      const result = await provider.createPullRequest({
        title: 'PR with reviewers',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        reviewers: ['alice', 'bob'],
      });

      expect(result.warnings).toEqual([]);
      expect(http.post).toHaveBeenCalledTimes(2);
      expect(http.post).toHaveBeenCalledWith(
        'https://api.github.com/repos/octocat/hello-world/pulls/42/requested_reviewers',
        { reviewers: ['alice', 'bob'] },
        expect.objectContaining({ Accept: 'application/vnd.github+json' }),
      );
    });

    test('adds warning when reviewers request fails', async () => {
      const http = makeMockHttpClient();
      http.post
        .mockResolvedValueOnce(makeResponse(PR_RESPONSE, 201))
        .mockRejectedValueOnce(new Error('Reviewer not found'));

      const provider = createGitHubProvider(makeConfig(), http, makeMockUrlParser());
      const result = await provider.createPullRequest({
        title: 'PR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        reviewers: ['nonexistent'],
      });

      expect(result.status).toBe('created');
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('Failed to add reviewers');
    });

    // ---------------------------------------------------------------------------
    // Labels
    // ---------------------------------------------------------------------------

    test('adds labels via POST /issues/{n}/labels', async () => {
      const http = makeMockHttpClient();
      http.post
        .mockResolvedValueOnce(makeResponse(PR_RESPONSE, 201))  // create PR
        .mockResolvedValueOnce(makeResponse({}, 200));           // add labels

      const provider = createGitHubProvider(makeConfig(), http, makeMockUrlParser());
      const result = await provider.createPullRequest({
        title: 'PR with labels',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        labels: ['release', 'patch'],
      });

      expect(result.warnings).toEqual([]);
      expect(http.post).toHaveBeenCalledWith(
        'https://api.github.com/repos/octocat/hello-world/issues/42/labels',
        { labels: ['release', 'patch'] },
        expect.objectContaining({ Accept: 'application/vnd.github+json' }),
      );
    });

    test('adds warning when labels request fails', async () => {
      const http = makeMockHttpClient();
      http.post
        .mockResolvedValueOnce(makeResponse(PR_RESPONSE, 201))
        .mockRejectedValueOnce(new Error('Label error'));

      const provider = createGitHubProvider(makeConfig(), http, makeMockUrlParser());
      const result = await provider.createPullRequest({
        title: 'PR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        labels: ['bug'],
      });

      expect(result.status).toBe('created');
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('Failed to add labels');
    });

    // ---------------------------------------------------------------------------
    // Milestone
    // ---------------------------------------------------------------------------

    test('sets milestone via PATCH /issues/{n}', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(PR_RESPONSE, 201));
      http.patch.mockResolvedValue(makeResponse({}, 200));

      const provider = createGitHubProvider(makeConfig(), http, makeMockUrlParser());
      const result = await provider.createPullRequest({
        title: 'PR with milestone',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        milestone: 'v1.0',
      });

      expect(result.warnings).toEqual([]);
      expect(http.patch).toHaveBeenCalledWith(
        'https://api.github.com/repos/octocat/hello-world/issues/42',
        { milestone: 'v1.0' },
        expect.objectContaining({ Accept: 'application/vnd.github+json' }),
      );
    });

    test('adds warning when milestone request fails', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(PR_RESPONSE, 201));
      http.patch.mockRejectedValue(new Error('Milestone not found'));

      const provider = createGitHubProvider(makeConfig(), http, makeMockUrlParser());
      const result = await provider.createPullRequest({
        title: 'PR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        milestone: 'nonexistent',
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
      http.post.mockResolvedValue(makeResponse(PR_RESPONSE, 201));

      const provider = createGitHubProvider(makeConfig(), http, makeMockUrlParser());
      const result = await provider.createPullRequest({
        title: 'PR',
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
    // GitHub Enterprise — custom apiUrl
    // ---------------------------------------------------------------------------

    test('uses custom apiUrl for GitHub Enterprise', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse({
        number: 10,
        html_url: 'https://ghe.corp.com/octocat/hello-world/pull/10',
      }, 201));

      const config = makeConfig({
        platform: 'github-enterprise',
        apiUrl: 'https://ghe.corp.com/api/v3',
      });
      const provider = createGitHubProvider(config, http, makeMockUrlParser());
      const result = await provider.createPullRequest({
        title: 'Enterprise PR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
      });

      expect(result.platform).toBe('github-enterprise');
      expect(http.post).toHaveBeenCalledWith(
        'https://ghe.corp.com/api/v3/repos/octocat/hello-world/pulls',
        expect.any(Object),
        expect.any(Object),
      );
    });

    // ---------------------------------------------------------------------------
    // Auth header: Bearer vs token
    // ---------------------------------------------------------------------------

    test('uses Bearer auth when authMethod is "bearer"', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(PR_RESPONSE, 201));

      const config = makeConfig({ authMethod: 'bearer' });
      const provider = createGitHubProvider(config, http, makeMockUrlParser());
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
          Authorization: 'Bearer ghp_test123456',
        }),
      );
    });

    // ---------------------------------------------------------------------------
    // Accept header
    // ---------------------------------------------------------------------------

    test('sets Accept: application/vnd.github+json header', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(PR_RESPONSE, 201));

      const provider = createGitHubProvider(makeConfig(), http, makeMockUrlParser());
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
          Accept: 'application/vnd.github+json',
        }),
      );
    });

    // ---------------------------------------------------------------------------
    // owner/repo extraction via UrlParser
    // ---------------------------------------------------------------------------

    test('extracts owner/repo from git.url via UrlParser', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse({
        number: 7,
        html_url: 'https://github.com/my-org/my-repo/pull/7',
      }, 201));

      const urlParser = makeMockUrlParser({ owner: 'my-org', repo: 'my-repo' });
      const config = makeConfig({ url: 'git@github.com:my-org/my-repo.git' });
      const provider = createGitHubProvider(config, http, urlParser);

      await provider.createPullRequest({
        title: 'PR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
      });

      expect(urlParser.parse).toHaveBeenCalledWith(
        'git@github.com:my-org/my-repo.git',
        'github',
      );
      expect(http.post).toHaveBeenCalledWith(
        'https://api.github.com/repos/my-org/my-repo/pulls',
        expect.any(Object),
        expect.any(Object),
      );
    });

    // ---------------------------------------------------------------------------
    // All post-creation steps combined
    // ---------------------------------------------------------------------------

    test('handles reviewers + labels + milestone in one PR', async () => {
      const http = makeMockHttpClient();
      http.post
        .mockResolvedValueOnce(makeResponse(PR_RESPONSE, 201))  // create PR
        .mockResolvedValueOnce(makeResponse({}, 201))            // reviewers
        .mockResolvedValueOnce(makeResponse({}, 200));           // labels
      http.patch.mockResolvedValue(makeResponse({}, 200));       // milestone

      const provider = createGitHubProvider(makeConfig(), http, makeMockUrlParser());
      const result = await provider.createPullRequest({
        title: 'Full PR',
        body: 'All options',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        reviewers: ['alice'],
        labels: ['release'],
        milestone: 'v2.0',
      });

      expect(result.status).toBe('created');
      expect(result.warnings).toEqual([]);
      expect(http.post).toHaveBeenCalledTimes(3);
      expect(http.patch).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // generatePullRequestUrl
  // ---------------------------------------------------------------------------

  describe('generatePullRequestUrl()', () => {
    test('generates correct URL for GitHub Cloud (HTTPS)', () => {
      const config = makeConfig({ url: 'https://github.com/octocat/hello-world' });
      const provider = createGitHubProvider(config, makeMockHttpClient(), makeMockUrlParser());
      const url = provider.generatePullRequestUrl('version/patch/1.0.1/release', 'master');
      expect(url).toBe(
        'https://github.com/octocat/hello-world/compare/master...version/patch/1.0.1/release?expand=1',
      );
    });

    test('generates correct URL for GitHub Cloud (HTTPS with .git)', () => {
      const config = makeConfig({ url: 'https://github.com/octocat/hello-world.git' });
      const provider = createGitHubProvider(config, makeMockHttpClient(), makeMockUrlParser());
      const url = provider.generatePullRequestUrl('feat/x', 'main');
      expect(url).toBe(
        'https://github.com/octocat/hello-world/compare/main...feat/x?expand=1',
      );
    });

    test('generates correct URL for GitHub Enterprise (SSH url)', () => {
      const config = makeConfig({
        platform: 'github-enterprise',
        url: 'git@ghe.corp.com:team/project.git',
        apiUrl: 'https://ghe.corp.com/api/v3',
      });
      const provider = createGitHubProvider(config, makeMockHttpClient(), makeMockUrlParser({
        platform: 'github-enterprise',
        owner: 'team',
        repo: 'project',
      }));
      const url = provider.generatePullRequestUrl('feat/x', 'develop');
      expect(url).toBe(
        'https://ghe.corp.com/team/project/compare/develop...feat/x?expand=1',
      );
    });
  });
});
