// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { createPR, type PrCreatorDeps, type PrMode } from '../../pr.creator';
import type { PR_Options, PR_Result, SCM_Provider, SCM_ProviderConfig } from '../../scm.provider';
import type { SCM_Registry } from '../../scm.registry';
import type { HttpClient } from '../../http.client';
import type { UrlParser } from '../../url.parser';
import type { AuthResult } from '../../auth.resolver';
import { VersioningsError, EXIT_CODES } from '../../errors';
import type { VersioningsConfig } from '../../config.validator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_PR_URL = 'https://github.com/owner/repo/compare/main...feature?expand=1';

const MOCK_PR_RESULT: PR_Result = {
  url: 'https://github.com/owner/repo/pull/42',
  number: 42,
  status: 'created',
  fallbackReason: null,
  platform: 'github',
  warnings: [],
};

function makeConfig(overrides: Record<string, any> = {}): VersioningsConfig {
  const base: any = {
    git: {
      platform: 'github',
      url: 'https://github.com/owner/repo',
      pr: { target: 'main' },
      api: { timeout: 30000 },
      branchType: { version: 'version' },
      limits: { branchMaxCommentLength: 96 },
      remote: 'origin',
      commit: {
        message: {
          semver: {
            prepatch: '', patch: '', preminor: '', minor: '',
            premajor: '', major: '', prerelease: '',
          }
        }
      },
      ...overrides.git,
    },
    package: {
      semver: {
        patch: 'patch', prepatch: 'prepatch', minor: 'minor',
        preminor: 'preminor', premajor: 'premajor', prerelease: 'prerelease', major: 'major',
      }
    },
    common: {
      messages: {
        versionConfigDoesNotExist: '', undefinedGitRepositoryUrl: '',
        unavailableVersioningDirectory: '', unavailableSemanticVersion: '',
        undefinedVersionBranchName: '', incorrectVersionBranchNameLength: '',
        incorrectVersionBranchNameCharactersDashes: '', versionBranchAlreadyExists: '',
        untrackedGitFiles: '', unavailableGitPlatform: '',
        unavailableGitTargetBranch: '', versionAlreadyExists: '',
        versionAlreadyExistsTag: '', versionAlreadyExistsBranch: '',
        incorrectGitRemote: '',
      }
    },
  };
  return base;
}

function makeMockProvider(overrides: Partial<SCM_Provider> = {}): SCM_Provider {
  return {
    name: () => 'github',
    createPullRequest: jest.fn().mockResolvedValue(MOCK_PR_RESULT),
    generatePullRequestUrl: jest.fn().mockReturnValue(MOCK_PR_URL),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<PrCreatorDeps> = {}): PrCreatorDeps {
  const mockProvider = makeMockProvider();
  const registry: SCM_Registry = {
    register: jest.fn(),
    getProvider: jest.fn().mockReturnValue(mockProvider),
    availablePlatforms: jest.fn().mockReturnValue(['github']),
  };

  return {
    registry,
    httpClient: {} as HttpClient,
    urlParser: {} as UrlParser,
    resolveAuth: jest.fn().mockReturnValue({ token: 'ghp_test123', method: 'token' as const }),
    env: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// prMode = 'auto' with token → API success (Req 4.1, 4.2)
// ---------------------------------------------------------------------------

describe('prMode=auto with token (API success)', () => {
  test('calls provider.createPullRequest and returns created result', async () => {
    const deps = makeDeps();
    const config = makeConfig();

    const result = await createPR(config, 'feature/v1.2.3', 'Patch: v1.2.3', 'auto', deps);

    expect(result.status).toBe('created');
    expect(result.url).toBe('https://github.com/owner/repo/pull/42');
    expect(result.number).toBe(42);
    expect(result.platform).toBe('github');
  });

  test('resolves auth with correct platform', async () => {
    const deps = makeDeps();
    const config = makeConfig();

    await createPR(config, 'feature/v1.2.3', 'Patch: v1.2.3', 'auto', deps);

    expect(deps.resolveAuth).toHaveBeenCalledWith(
      expect.objectContaining({ config: expect.any(Object), env: deps.env }),
      'github',
    );
  });
});

// ---------------------------------------------------------------------------
// prMode = 'auto' without token → fallback (Req 4.4, 7.1)
// ---------------------------------------------------------------------------

describe('prMode=auto without token (fallback)', () => {
  test('returns fallback result with reason no_token', async () => {
    const deps = makeDeps({
      resolveAuth: jest.fn().mockReturnValue({ token: null, method: 'token' }),
    });
    const config = makeConfig();

    const result = await createPR(config, 'feature/v1.2.3', 'Patch: v1.2.3', 'auto', deps);

    expect(result.status).toBe('fallback');
    expect(result.fallbackReason).toBe('no_token');
    expect(result.url).toBe(MOCK_PR_URL);
    expect(result.number).toBeNull();
  });

  test('does not call provider.createPullRequest', async () => {
    const mockProvider = makeMockProvider();
    const deps = makeDeps({
      resolveAuth: jest.fn().mockReturnValue({ token: null, method: 'token' }),
      registry: {
        register: jest.fn(),
        getProvider: jest.fn().mockReturnValue(mockProvider),
        availablePlatforms: jest.fn().mockReturnValue(['github']),
      },
    });
    const config = makeConfig();

    await createPR(config, 'feature/v1.2.3', 'Patch: v1.2.3', 'auto', deps);

    expect(mockProvider.createPullRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// prMode = 'auto' with API error → fallback (Req 4.3, 7.2)
// ---------------------------------------------------------------------------

describe('prMode=auto with API error (fallback)', () => {
  test('returns fallback result with error reason', async () => {
    const mockProvider = makeMockProvider({
      createPullRequest: jest.fn().mockRejectedValue(new Error('API rate limit exceeded')),
    });
    const deps = makeDeps({
      registry: {
        register: jest.fn(),
        getProvider: jest.fn().mockReturnValue(mockProvider),
        availablePlatforms: jest.fn().mockReturnValue(['github']),
      },
    });
    const config = makeConfig();

    const result = await createPR(config, 'feature/v1.2.3', 'Patch: v1.2.3', 'auto', deps);

    expect(result.status).toBe('fallback');
    expect(result.fallbackReason).toBe('API rate limit exceeded');
    expect(result.url).toBe(MOCK_PR_URL);
    expect(result.number).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// prMode = 'api' without token → VersioningsError (Req 7.6)
// ---------------------------------------------------------------------------

describe('prMode=api without token (VersioningsError)', () => {
  test('throws VersioningsError with CONFIG_ERROR', async () => {
    const deps = makeDeps({
      resolveAuth: jest.fn().mockReturnValue({ token: null, method: 'token' }),
    });
    const config = makeConfig();

    await expect(
      createPR(config, 'feature/v1.2.3', 'Patch: v1.2.3', 'api', deps),
    ).rejects.toThrow(VersioningsError);

    try {
      await createPR(config, 'feature/v1.2.3', 'Patch: v1.2.3', 'api', deps);
    } catch (err) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect((err as VersioningsError).code).toBe(EXIT_CODES.CONFIG_ERROR);
      expect((err as VersioningsError).message).toContain('authentication token');
    }
  });
});

// ---------------------------------------------------------------------------
// prMode = 'api' with API error → VersioningsError (Req 7.6)
// ---------------------------------------------------------------------------

describe('prMode=api with API error (rethrows)', () => {
  test('rethrows the API error', async () => {
    const apiError = new VersioningsError(EXIT_CODES.NETWORK_ERROR, 'Connection refused');
    const mockProvider = makeMockProvider({
      createPullRequest: jest.fn().mockRejectedValue(apiError),
    });
    const deps = makeDeps({
      registry: {
        register: jest.fn(),
        getProvider: jest.fn().mockReturnValue(mockProvider),
        availablePlatforms: jest.fn().mockReturnValue(['github']),
      },
    });
    const config = makeConfig();

    await expect(
      createPR(config, 'feature/v1.2.3', 'Patch: v1.2.3', 'api', deps),
    ).rejects.toThrow(apiError);
  });
});

// ---------------------------------------------------------------------------
// prMode = 'url' → URL only, no API (Req 7.7)
// ---------------------------------------------------------------------------

describe('prMode=url (URL only)', () => {
  test('returns fallback result with URL, no API call', async () => {
    const mockProvider = makeMockProvider();
    const deps = makeDeps({
      registry: {
        register: jest.fn(),
        getProvider: jest.fn().mockReturnValue(mockProvider),
        availablePlatforms: jest.fn().mockReturnValue(['github']),
      },
    });
    const config = makeConfig();

    const result = await createPR(config, 'feature/v1.2.3', 'Patch: v1.2.3', 'url', deps);

    expect(result.status).toBe('fallback');
    expect(result.url).toBe(MOCK_PR_URL);
    expect(result.number).toBeNull();
    expect(mockProvider.createPullRequest).not.toHaveBeenCalled();
  });

  test('does not call resolveAuth', async () => {
    const deps = makeDeps();
    const config = makeConfig();

    await createPR(config, 'feature/v1.2.3', 'Patch: v1.2.3', 'url', deps);

    expect(deps.resolveAuth).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Reading template file (Req 4.1, 5.8)
// ---------------------------------------------------------------------------

describe('Reading template file', () => {
  test('reads template file and passes body to provider', async () => {
    const mockProvider = makeMockProvider();
    const readFile = jest.fn().mockReturnValue('## PR Template\nDescription here');
    const deps = makeDeps({
      registry: {
        register: jest.fn(),
        getProvider: jest.fn().mockReturnValue(mockProvider),
        availablePlatforms: jest.fn().mockReturnValue(['github']),
      },
      readFile,
    });
    const config = makeConfig({
      git: {
        platform: 'github',
        url: 'https://github.com/owner/repo',
        pr: { target: 'main', template: '.github/PULL_REQUEST_TEMPLATE.md' },
        api: { timeout: 30000 },
      },
    });

    await createPR(config, 'feature/v1.2.3', 'Patch: v1.2.3', 'auto', deps);

    expect(readFile).toHaveBeenCalledWith('.github/PULL_REQUEST_TEMPLATE.md');
    expect(mockProvider.createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ body: '## PR Template\nDescription here' }),
    );
  });

  test('uses empty body when template file read fails', async () => {
    const mockProvider = makeMockProvider();
    const readFile = jest.fn().mockImplementation(() => { throw new Error('ENOENT'); });
    const deps = makeDeps({
      registry: {
        register: jest.fn(),
        getProvider: jest.fn().mockReturnValue(mockProvider),
        availablePlatforms: jest.fn().mockReturnValue(['github']),
      },
      readFile,
    });
    const config = makeConfig({
      git: {
        platform: 'github',
        url: 'https://github.com/owner/repo',
        pr: { target: 'main', template: 'nonexistent.md' },
        api: { timeout: 30000 },
      },
    });

    await createPR(config, 'feature/v1.2.3', 'Patch: v1.2.3', 'auto', deps);

    expect(mockProvider.createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ body: '' }),
    );
  });

  test('uses empty body when no template is configured', async () => {
    const mockProvider = makeMockProvider();
    const deps = makeDeps({
      registry: {
        register: jest.fn(),
        getProvider: jest.fn().mockReturnValue(mockProvider),
        availablePlatforms: jest.fn().mockReturnValue(['github']),
      },
    });
    const config = makeConfig();

    await createPR(config, 'feature/v1.2.3', 'Patch: v1.2.3', 'auto', deps);

    expect(mockProvider.createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ body: '' }),
    );
  });
});

// ---------------------------------------------------------------------------
// Building PR_Options from config (Req 4.1, 5.1–5.6)
// ---------------------------------------------------------------------------

describe('Building PR_Options from config', () => {
  test('builds PR_Options with all extended fields', async () => {
    const mockProvider = makeMockProvider();
    const deps = makeDeps({
      registry: {
        register: jest.fn(),
        getProvider: jest.fn().mockReturnValue(mockProvider),
        availablePlatforms: jest.fn().mockReturnValue(['github']),
      },
    });
    const config = makeConfig({
      git: {
        platform: 'github',
        url: 'https://github.com/owner/repo',
        pr: {
          target: 'develop',
          reviewers: ['alice', 'bob'],
          labels: ['release', 'automated'],
          draft: true,
          milestone: 'v1.3',
          linkedIssues: ['#100', '#101'],
        },
        api: { timeout: 30000 },
      },
    });

    await createPR(config, 'feature/v1.2.3', 'Minor: v1.2.3', 'auto', deps);

    expect(mockProvider.createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Minor: v1.2.3',
        sourceBranch: 'feature/v1.2.3',
        targetBranch: 'develop',
        reviewers: ['alice', 'bob'],
        labels: ['release', 'automated'],
        draft: true,
        milestone: 'v1.3',
        linkedIssues: ['#100', '#101'],
      }),
    );
  });

  test('uses commit message as title', async () => {
    const mockProvider = makeMockProvider();
    const deps = makeDeps({
      registry: {
        register: jest.fn(),
        getProvider: jest.fn().mockReturnValue(mockProvider),
        availablePlatforms: jest.fn().mockReturnValue(['github']),
      },
    });
    const config = makeConfig();

    await createPR(config, 'feature/v1.2.3', 'Release: v1.2.3', 'auto', deps);

    expect(mockProvider.createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Release: v1.2.3' }),
    );
  });

  test('defaults targetBranch to config git.pr.target', async () => {
    const mockProvider = makeMockProvider();
    const deps = makeDeps({
      registry: {
        register: jest.fn(),
        getProvider: jest.fn().mockReturnValue(mockProvider),
        availablePlatforms: jest.fn().mockReturnValue(['github']),
      },
    });
    const config = makeConfig();

    await createPR(config, 'feature/v1.2.3', 'Patch: v1.2.3', 'auto', deps);

    expect(mockProvider.createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ targetBranch: 'main' }),
    );
  });
});

// ---------------------------------------------------------------------------
// Changelog body support (Req 9.3, 9.4)
// ---------------------------------------------------------------------------

describe('Changelog body in PR', () => {
  test('uses changelogBody as body when no template is configured', async () => {
    const mockProvider = makeMockProvider();
    const deps = makeDeps({
      registry: {
        register: jest.fn(),
        getProvider: jest.fn().mockReturnValue(mockProvider),
        availablePlatforms: jest.fn().mockReturnValue(['github']),
      },
      changelogBody: '## Features\n- add login',
    });
    const config = makeConfig();

    await createPR(config, 'feature/v1.2.3', 'Minor: v1.2.3', 'auto', deps);

    expect(mockProvider.createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ body: '## Features\n- add login' }),
    );
  });

  test('merges template and changelogBody with --- separator', async () => {
    const mockProvider = makeMockProvider();
    const readFile = jest.fn().mockReturnValue('## PR Template\nPlease review');
    const deps = makeDeps({
      registry: {
        register: jest.fn(),
        getProvider: jest.fn().mockReturnValue(mockProvider),
        availablePlatforms: jest.fn().mockReturnValue(['github']),
      },
      readFile,
      changelogBody: '## Features\n- add login',
    });
    const config = makeConfig({
      git: {
        platform: 'github',
        url: 'https://github.com/owner/repo',
        pr: { target: 'main', template: '.github/PULL_REQUEST_TEMPLATE.md' },
        api: { timeout: 30000 },
      },
    });

    await createPR(config, 'feature/v1.2.3', 'Minor: v1.2.3', 'auto', deps);

    expect(mockProvider.createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: '## PR Template\nPlease review\n\n---\n\n## Features\n- add login',
      }),
    );
  });

  test('uses only template when changelogBody is not provided', async () => {
    const mockProvider = makeMockProvider();
    const readFile = jest.fn().mockReturnValue('## PR Template\nPlease review');
    const deps = makeDeps({
      registry: {
        register: jest.fn(),
        getProvider: jest.fn().mockReturnValue(mockProvider),
        availablePlatforms: jest.fn().mockReturnValue(['github']),
      },
      readFile,
    });
    const config = makeConfig({
      git: {
        platform: 'github',
        url: 'https://github.com/owner/repo',
        pr: { target: 'main', template: '.github/PULL_REQUEST_TEMPLATE.md' },
        api: { timeout: 30000 },
      },
    });

    await createPR(config, 'feature/v1.2.3', 'Minor: v1.2.3', 'auto', deps);

    expect(mockProvider.createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ body: '## PR Template\nPlease review' }),
    );
  });

  test('uses empty body when neither template nor changelogBody is provided', async () => {
    const mockProvider = makeMockProvider();
    const deps = makeDeps({
      registry: {
        register: jest.fn(),
        getProvider: jest.fn().mockReturnValue(mockProvider),
        availablePlatforms: jest.fn().mockReturnValue(['github']),
      },
    });
    const config = makeConfig();

    await createPR(config, 'feature/v1.2.3', 'Minor: v1.2.3', 'auto', deps);

    expect(mockProvider.createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ body: '' }),
    );
  });
});
