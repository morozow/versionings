// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { createBitbucketCloudProvider, createBitbucketServerProvider } from '../../../src/scm/providers/bitbucket.provider';
import type { SCM_ProviderConfig } from '../../../src/scm/scm.provider';
import type { HttpClient, HttpResponse } from '../../../src/scm/http.client';
import type { UrlParser, ParsedBitbucketCloudUrl, ParsedBitbucketServerUrl } from '../../../src/scm/url.parser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCloudConfig(overrides?: Partial<SCM_ProviderConfig>): SCM_ProviderConfig {
  return {
    platform: 'bitbucket',
    url: 'https://bitbucket.org/my-workspace/my-repo',
    token: 'bb_test_token_123',
    authMethod: 'bearer',
    timeout: 30_000,
    ...overrides,
  };
}

function makeServerConfig(overrides?: Partial<SCM_ProviderConfig & { project?: string; repo?: string }>): SCM_ProviderConfig {
  return {
    platform: 'bitbucket-server',
    url: 'https://bitbucket.corp.com/scm/PROJ/my-repo.git',
    apiUrl: 'https://bitbucket.corp.com',
    token: 'bbs_test_token_456',
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

function makeMockCloudUrlParser(parsed?: Partial<ParsedBitbucketCloudUrl>): UrlParser {
  return {
    parse: jest.fn().mockReturnValue({
      platform: 'bitbucket',
      workspace: 'my-workspace',
      repoSlug: 'my-repo',
      ...parsed,
    } as ParsedBitbucketCloudUrl),
    format: jest.fn(),
  };
}

function makeMockServerUrlParser(parsed?: Partial<ParsedBitbucketServerUrl>): UrlParser {
  return {
    parse: jest.fn().mockReturnValue({
      platform: 'bitbucket-server',
      projectKey: 'PROJ',
      repositorySlug: 'my-repo',
      ...parsed,
    } as ParsedBitbucketServerUrl),
    format: jest.fn(),
  };
}

const CLOUD_PR_RESPONSE = {
  id: 99,
  links: { html: { href: 'https://bitbucket.org/my-workspace/my-repo/pull-requests/99' } },
};

const SERVER_PR_RESPONSE = {
  id: 55,
  links: { self: [{ href: 'https://bitbucket.corp.com/projects/PROJ/repos/my-repo/pull-requests/55' }] },
};

// ===========================================================================
// Bitbucket Cloud Provider
// ===========================================================================

describe('createBitbucketCloudProvider', () => {
  describe('name()', () => {
    test('returns "bitbucket"', () => {
      const provider = createBitbucketCloudProvider(makeCloudConfig(), makeMockHttpClient(), makeMockCloudUrlParser());
      expect(provider.name()).toBe('bitbucket');
    });
  });

  // ---------------------------------------------------------------------------
  // createPullRequest — basic PR creation
  // ---------------------------------------------------------------------------

  describe('createPullRequest()', () => {
    test('creates a PR via POST /2.0/repositories/{workspace}/{repo_slug}/pullrequests', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(CLOUD_PR_RESPONSE, 201));

      const provider = createBitbucketCloudProvider(makeCloudConfig(), http, makeMockCloudUrlParser());
      const result = await provider.createPullRequest({
        title: 'Version patch: 1.0.1',
        body: 'Automated release',
        sourceBranch: 'version/patch/1.0.1/release',
        targetBranch: 'master',
      });

      expect(result.status).toBe('created');
      expect(result.number).toBe(99);
      expect(result.url).toBe('https://bitbucket.org/my-workspace/my-repo/pull-requests/99');
      expect(result.platform).toBe('bitbucket');
      expect(result.fallbackReason).toBeNull();
      expect(result.warnings).toEqual([]);

      // Verify the POST call
      expect(http.post).toHaveBeenCalledWith(
        'https://api.bitbucket.org/2.0/repositories/my-workspace/my-repo/pullrequests',
        {
          title: 'Version patch: 1.0.1',
          description: 'Automated release',
          source: { branch: { name: 'version/patch/1.0.1/release' } },
          destination: { branch: { name: 'master' } },
        },
        expect.objectContaining({
          Authorization: 'Bearer bb_test_token_123',
        }),
      );
    });

    // ---------------------------------------------------------------------------
    // Reviewers — username → UUID resolution
    // ---------------------------------------------------------------------------

    test('resolves reviewer usernames to UUIDs via GET /2.0/users/{username}', async () => {
      const http = makeMockHttpClient();
      http.get
        .mockResolvedValueOnce(makeResponse({ uuid: '{uuid-alice}' }))
        .mockResolvedValueOnce(makeResponse({ uuid: '{uuid-bob}' }));
      http.post.mockResolvedValue(makeResponse(CLOUD_PR_RESPONSE, 201));

      const provider = createBitbucketCloudProvider(makeCloudConfig(), http, makeMockCloudUrlParser());
      const result = await provider.createPullRequest({
        title: 'PR with reviewers',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        reviewers: ['alice', 'bob'],
      });

      expect(result.warnings).toEqual([]);
      expect(http.get).toHaveBeenCalledTimes(2);
      expect(http.get).toHaveBeenCalledWith(
        'https://api.bitbucket.org/2.0/users/alice',
        expect.objectContaining({ Authorization: 'Bearer bb_test_token_123' }),
      );
      expect(http.get).toHaveBeenCalledWith(
        'https://api.bitbucket.org/2.0/users/bob',
        expect.objectContaining({ Authorization: 'Bearer bb_test_token_123' }),
      );

      // reviewers should be in the PR creation body
      expect(http.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          reviewers: [{ uuid: '{uuid-alice}' }, { uuid: '{uuid-bob}' }],
        }),
        expect.any(Object),
      );
    });

    test('adds warning when reviewer username cannot be resolved', async () => {
      const http = makeMockHttpClient();
      http.get.mockResolvedValueOnce(makeResponse({})); // no uuid field
      http.post.mockResolvedValue(makeResponse(CLOUD_PR_RESPONSE, 201));

      const provider = createBitbucketCloudProvider(makeCloudConfig(), http, makeMockCloudUrlParser());
      const result = await provider.createPullRequest({
        title: 'PR',
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
      http.post.mockResolvedValue(makeResponse(CLOUD_PR_RESPONSE, 201));

      const provider = createBitbucketCloudProvider(makeCloudConfig(), http, makeMockCloudUrlParser());
      const result = await provider.createPullRequest({
        title: 'PR',
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
    // Draft — warning (not supported)
    // ---------------------------------------------------------------------------

    test('adds warning when draft is true (not supported by Cloud)', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(CLOUD_PR_RESPONSE, 201));

      const provider = createBitbucketCloudProvider(makeCloudConfig(), http, makeMockCloudUrlParser());
      const result = await provider.createPullRequest({
        title: 'Draft PR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        draft: true,
      });

      expect(result.status).toBe('created');
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('draft');
    });

    // ---------------------------------------------------------------------------
    // Unsupported params → warnings
    // ---------------------------------------------------------------------------

    test('adds warning for labels (unsupported)', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(CLOUD_PR_RESPONSE, 201));

      const provider = createBitbucketCloudProvider(makeCloudConfig(), http, makeMockCloudUrlParser());
      const result = await provider.createPullRequest({
        title: 'PR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        labels: ['release', 'patch'],
      });

      expect(result.status).toBe('created');
      expect(result.warnings).toContainEqual(expect.stringContaining('labels'));
    });

    test('adds warning for milestone (unsupported)', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(CLOUD_PR_RESPONSE, 201));

      const provider = createBitbucketCloudProvider(makeCloudConfig(), http, makeMockCloudUrlParser());
      const result = await provider.createPullRequest({
        title: 'PR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        milestone: 'v1.0',
      });

      expect(result.status).toBe('created');
      expect(result.warnings).toContainEqual(expect.stringContaining('milestone'));
    });

    test('adds warning for linkedIssues (unsupported)', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(CLOUD_PR_RESPONSE, 201));

      const provider = createBitbucketCloudProvider(makeCloudConfig(), http, makeMockCloudUrlParser());
      const result = await provider.createPullRequest({
        title: 'PR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        linkedIssues: ['#123'],
      });

      expect(result.status).toBe('created');
      expect(result.warnings).toContainEqual(expect.stringContaining('linkedIssues'));
    });

    // ---------------------------------------------------------------------------
    // Auth header: Bearer
    // ---------------------------------------------------------------------------

    test('uses Bearer auth for Cloud', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(CLOUD_PR_RESPONSE, 201));

      const provider = createBitbucketCloudProvider(makeCloudConfig(), http, makeMockCloudUrlParser());
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
          Authorization: 'Bearer bb_test_token_123',
        }),
      );
    });

    // ---------------------------------------------------------------------------
    // All unsupported params combined
    // ---------------------------------------------------------------------------

    test('collects multiple warnings for unsupported params', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(CLOUD_PR_RESPONSE, 201));

      const provider = createBitbucketCloudProvider(makeCloudConfig(), http, makeMockCloudUrlParser());
      const result = await provider.createPullRequest({
        title: 'Full PR',
        body: 'All options',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        draft: true,
        labels: ['release'],
        milestone: 'v2.0',
        linkedIssues: ['#1'],
      });

      expect(result.status).toBe('created');
      // draft + labels + milestone + linkedIssues = 4 warnings
      expect(result.warnings).toHaveLength(4);
    });
  });

  // ---------------------------------------------------------------------------
  // generatePullRequestUrl — Cloud
  // ---------------------------------------------------------------------------

  describe('generatePullRequestUrl()', () => {
    test('generates correct URL for Bitbucket Cloud', () => {
      const provider = createBitbucketCloudProvider(makeCloudConfig(), makeMockHttpClient(), makeMockCloudUrlParser());
      const url = provider.generatePullRequestUrl('version/patch/1.0.1/release', 'master');
      expect(url).toBe(
        'https://bitbucket.org/my-workspace/my-repo/pull-requests/new?source=version%2Fpatch%2F1.0.1%2Frelease&dest=master&t=1',
      );
    });
  });
});


// ===========================================================================
// Bitbucket Server Provider
// ===========================================================================

describe('createBitbucketServerProvider', () => {
  describe('name()', () => {
    test('returns "bitbucket-server"', () => {
      const provider = createBitbucketServerProvider(makeServerConfig(), makeMockHttpClient(), makeMockServerUrlParser());
      expect(provider.name()).toBe('bitbucket-server');
    });
  });

  // ---------------------------------------------------------------------------
  // createPullRequest — basic PR creation
  // ---------------------------------------------------------------------------

  describe('createPullRequest()', () => {
    test('creates a PR via POST /rest/api/1.0/projects/{key}/repos/{slug}/pull-requests', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(SERVER_PR_RESPONSE, 201));

      const provider = createBitbucketServerProvider(makeServerConfig(), http, makeMockServerUrlParser());
      const result = await provider.createPullRequest({
        title: 'Version patch: 1.0.1',
        body: 'Automated release',
        sourceBranch: 'version/patch/1.0.1/release',
        targetBranch: 'master',
      });

      expect(result.status).toBe('created');
      expect(result.number).toBe(55);
      expect(result.url).toBe('https://bitbucket.corp.com/projects/PROJ/repos/my-repo/pull-requests/55');
      expect(result.platform).toBe('bitbucket-server');
      expect(result.fallbackReason).toBeNull();
      expect(result.warnings).toEqual([]);

      // Verify the POST call
      expect(http.post).toHaveBeenCalledWith(
        'https://bitbucket.corp.com/rest/api/1.0/projects/PROJ/repos/my-repo/pull-requests',
        {
          title: 'Version patch: 1.0.1',
          description: 'Automated release',
          fromRef: { id: 'refs/heads/version/patch/1.0.1/release' },
          toRef: { id: 'refs/heads/master' },
        },
        expect.objectContaining({
          Authorization: 'token bbs_test_token_456',
        }),
      );
    });

    // ---------------------------------------------------------------------------
    // Reviewers — array of { user: { name } }
    // ---------------------------------------------------------------------------

    test('passes reviewers as array of { user: { name } }', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(SERVER_PR_RESPONSE, 201));

      const provider = createBitbucketServerProvider(makeServerConfig(), http, makeMockServerUrlParser());
      const result = await provider.createPullRequest({
        title: 'PR with reviewers',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        reviewers: ['alice', 'bob'],
      });

      expect(result.warnings).toEqual([]);
      expect(http.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          reviewers: [{ user: { name: 'alice' } }, { user: { name: 'bob' } }],
        }),
        expect.any(Object),
      );
    });

    // ---------------------------------------------------------------------------
    // projectKey/repositorySlug extraction from URL
    // ---------------------------------------------------------------------------

    test('extracts projectKey and repositorySlug from URL via UrlParser', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(SERVER_PR_RESPONSE, 201));

      const urlParser = makeMockServerUrlParser({
        projectKey: 'TEAM',
        repositorySlug: 'backend',
      });
      const provider = createBitbucketServerProvider(makeServerConfig(), http, urlParser);
      await provider.createPullRequest({
        title: 'PR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
      });

      expect(urlParser.parse).toHaveBeenCalledWith(
        'https://bitbucket.corp.com/scm/PROJ/my-repo.git',
        'bitbucket-server',
      );
      expect(http.post).toHaveBeenCalledWith(
        'https://bitbucket.corp.com/rest/api/1.0/projects/TEAM/repos/backend/pull-requests',
        expect.any(Object),
        expect.any(Object),
      );
    });

    // ---------------------------------------------------------------------------
    // projectKey/repositorySlug from config overrides (git.project, git.repo)
    // ---------------------------------------------------------------------------

    test('uses config.project and config.repo when provided', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(SERVER_PR_RESPONSE, 201));

      const config = makeServerConfig() as any;
      config.project = 'OVERRIDE_PROJ';
      config.repo = 'override-repo';

      const provider = createBitbucketServerProvider(config, http, makeMockServerUrlParser());
      await provider.createPullRequest({
        title: 'PR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
      });

      expect(http.post).toHaveBeenCalledWith(
        'https://bitbucket.corp.com/rest/api/1.0/projects/OVERRIDE_PROJ/repos/override-repo/pull-requests',
        expect.any(Object),
        expect.any(Object),
      );
    });

    // ---------------------------------------------------------------------------
    // Draft — warning (not supported)
    // ---------------------------------------------------------------------------

    test('adds warning when draft is true (not supported by Server)', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(SERVER_PR_RESPONSE, 201));

      const provider = createBitbucketServerProvider(makeServerConfig(), http, makeMockServerUrlParser());
      const result = await provider.createPullRequest({
        title: 'Draft PR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        draft: true,
      });

      expect(result.status).toBe('created');
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('draft');
    });

    // ---------------------------------------------------------------------------
    // Unsupported params → warnings
    // ---------------------------------------------------------------------------

    test('adds warning for labels (unsupported)', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(SERVER_PR_RESPONSE, 201));

      const provider = createBitbucketServerProvider(makeServerConfig(), http, makeMockServerUrlParser());
      const result = await provider.createPullRequest({
        title: 'PR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        labels: ['release'],
      });

      expect(result.status).toBe('created');
      expect(result.warnings).toContainEqual(expect.stringContaining('labels'));
    });

    test('adds warning for milestone (unsupported)', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(SERVER_PR_RESPONSE, 201));

      const provider = createBitbucketServerProvider(makeServerConfig(), http, makeMockServerUrlParser());
      const result = await provider.createPullRequest({
        title: 'PR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        milestone: 'v1.0',
      });

      expect(result.status).toBe('created');
      expect(result.warnings).toContainEqual(expect.stringContaining('milestone'));
    });

    test('adds warning for linkedIssues (unsupported)', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(SERVER_PR_RESPONSE, 201));

      const provider = createBitbucketServerProvider(makeServerConfig(), http, makeMockServerUrlParser());
      const result = await provider.createPullRequest({
        title: 'PR',
        body: '',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        linkedIssues: ['#123'],
      });

      expect(result.status).toBe('created');
      expect(result.warnings).toContainEqual(expect.stringContaining('linkedIssues'));
    });

    // ---------------------------------------------------------------------------
    // Auth header: token vs Bearer
    // ---------------------------------------------------------------------------

    test('uses "token" auth when authMethod is "token"', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(SERVER_PR_RESPONSE, 201));

      const provider = createBitbucketServerProvider(makeServerConfig(), http, makeMockServerUrlParser());
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
          Authorization: 'token bbs_test_token_456',
        }),
      );
    });

    test('uses Bearer auth when authMethod is "bearer"', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(SERVER_PR_RESPONSE, 201));

      const config = makeServerConfig({ authMethod: 'bearer' });
      const provider = createBitbucketServerProvider(config, http, makeMockServerUrlParser());
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
          Authorization: 'Bearer bbs_test_token_456',
        }),
      );
    });

    // ---------------------------------------------------------------------------
    // All unsupported params combined
    // ---------------------------------------------------------------------------

    test('collects multiple warnings for unsupported params', async () => {
      const http = makeMockHttpClient();
      http.post.mockResolvedValue(makeResponse(SERVER_PR_RESPONSE, 201));

      const provider = createBitbucketServerProvider(makeServerConfig(), http, makeMockServerUrlParser());
      const result = await provider.createPullRequest({
        title: 'Full PR',
        body: 'All options',
        sourceBranch: 'feat/x',
        targetBranch: 'main',
        draft: true,
        labels: ['release'],
        milestone: 'v2.0',
        linkedIssues: ['#1'],
      });

      expect(result.status).toBe('created');
      // draft + labels + milestone + linkedIssues = 4 warnings
      expect(result.warnings).toHaveLength(4);
    });
  });

  // ---------------------------------------------------------------------------
  // generatePullRequestUrl — Server
  // ---------------------------------------------------------------------------

  describe('generatePullRequestUrl()', () => {
    test('generates correct URL for Bitbucket Server', () => {
      const provider = createBitbucketServerProvider(makeServerConfig(), makeMockHttpClient(), makeMockServerUrlParser());
      const url = provider.generatePullRequestUrl('version/patch/1.0.1/release', 'master');
      expect(url).toBe(
        'https://bitbucket.corp.com/projects/PROJ/repos/my-repo/pull-requests?create&sourceBranch=version%2Fpatch%2F1.0.1%2Frelease&targetBranch=master',
      );
    });

    test('uses config.project and config.repo overrides in URL', () => {
      const config = makeServerConfig() as any;
      config.project = 'CUSTOM';
      config.repo = 'custom-repo';

      const provider = createBitbucketServerProvider(config, makeMockHttpClient(), makeMockServerUrlParser());
      const url = provider.generatePullRequestUrl('feat/x', 'develop');
      expect(url).toBe(
        'https://bitbucket.corp.com/projects/CUSTOM/repos/custom-repo/pull-requests?create&sourceBranch=feat%2Fx&targetBranch=develop',
      );
    });
  });
});
