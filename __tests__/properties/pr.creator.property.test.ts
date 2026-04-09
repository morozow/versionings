// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau
// Feature: scm-provider-pr-automation, Property 3: Backward compatibility github/bitbucket without token
// Feature: scm-provider-pr-automation, Property 6: Fallback strategy
// Feature: scm-provider-pr-automation, Property 7: PR/MR error does not interrupt pipeline
// Feature: scm-provider-pr-automation, Property 8: Unsupported PR parameters → warnings

import * as fc from 'fast-check';
import { createPR, type PrCreatorDeps } from '../../pr.creator';
import type { PR_Result, SCM_Provider } from '../../scm.provider';
import type { SCM_Registry } from '../../scm.registry';
import type { HttpClient } from '../../http.client';
import type { UrlParser } from '../../url.parser';
import type { VersioningsConfig } from '../../config.validator';
import { VersioningsError, EXIT_CODES } from '../../errors';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const ALPHA_CHARS = 'abcdefghijklmnopqrstuvwxyz';

const arbIdent = fc.stringOf(fc.constantFrom(...ALPHA_CHARS.split('')), {
  minLength: 1,
  maxLength: 20,
});

const arbBranch = arbIdent.map((s) => `version/patch/${s}`);
const arbCommitMsg = arbIdent.map((s) => `Patch: v1.0.0-${s}`);
const arbTarget = fc.constantFrom('main', 'master', 'develop');

const arbToken = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
  { minLength: 8, maxLength: 40 },
).map((s) => `ghp_${s}`);

// ---------------------------------------------------------------------------
// Config builder
// ---------------------------------------------------------------------------

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
          },
        },
      },
      ...overrides.git,
    },
    package: {
      semver: {
        patch: 'patch', prepatch: 'prepatch', minor: 'minor',
        preminor: 'preminor', premajor: 'premajor', prerelease: 'prerelease', major: 'major',
      },
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
      },
    },
  };
  return base;
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeMockProvider(overrides: Partial<SCM_Provider> = {}): SCM_Provider {
  return {
    name: () => 'github',
    createPullRequest: jest.fn().mockResolvedValue({
      url: 'https://github.com/owner/repo/pull/42',
      number: 42,
      status: 'created' as const,
      fallbackReason: null,
      platform: 'github',
      warnings: [],
    }),
    generatePullRequestUrl: jest.fn().mockReturnValue(
      'https://github.com/owner/repo/compare/main...branch',
    ),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<PrCreatorDeps> = {}): PrCreatorDeps {
  const mockProvider = makeMockProvider();
  const registry: SCM_Registry = {
    register: jest.fn(),
    getProvider: jest.fn().mockReturnValue(mockProvider),
    availablePlatforms: jest.fn().mockReturnValue(['github', 'bitbucket']),
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
// Property 3: Backward compatibility github/bitbucket without token
// **Validates: Requirements 2.2, 15.1, 15.2**
// ---------------------------------------------------------------------------

describe('Property 3: Backward compatibility github/bitbucket without token', () => {
  const arbBackwardPlatform = fc.constantFrom('github' as const, 'bitbucket' as const);

  test('for any config with github/bitbucket and no auth, createPR in auto mode returns fallback with reason no_token', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbBackwardPlatform,
        arbBranch,
        arbCommitMsg,
        arbTarget,
        async (platform, branch, commitMsg, target) => {
          const config = makeConfig({
            git: {
              platform,
              url: `https://${platform === 'github' ? 'github.com' : 'bitbucket.org'}/owner/repo`,
              pr: { target },
              api: { timeout: 30000 },
            },
          });

          const fallbackUrl = `https://example.com/${platform}/compare/${target}...${branch}`;
          const mockProvider = makeMockProvider({
            name: () => platform,
            generatePullRequestUrl: jest.fn().mockReturnValue(fallbackUrl),
          });

          const deps = makeDeps({
            resolveAuth: jest.fn().mockReturnValue({ token: null, method: 'token' as const }),
            registry: {
              register: jest.fn(),
              getProvider: jest.fn().mockReturnValue(mockProvider),
              availablePlatforms: jest.fn().mockReturnValue(['github', 'bitbucket']),
            },
          });

          const result = await createPR(config, branch, commitMsg, 'auto', deps);

          expect(result.status).toBe('fallback');
          expect(result.fallbackReason).toBe('no_token');
          expect(result.url).toBe(fallbackUrl);
          expect(result.number).toBeNull();
          expect(mockProvider.createPullRequest).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6: Fallback strategy
// **Validates: Requirements 4.1, 4.3, 4.4, 7.1, 7.2**
// ---------------------------------------------------------------------------

describe('Property 6: Fallback strategy', () => {
  const arbScenario = fc.record({
    hasToken: fc.boolean(),
    apiSucceeds: fc.boolean(),
    branch: arbBranch,
    commitMsg: arbCommitMsg,
    target: arbTarget,
    token: arbToken,
    errorMessage: arbIdent.map((s) => `API error: ${s}`),
  });

  test('token+API success → created; no token → fallback(no_token); token+API error → fallback(error)', async () => {
    await fc.assert(
      fc.asyncProperty(arbScenario, async (scenario) => {
        const { hasToken, apiSucceeds, branch, commitMsg, target, token, errorMessage } = scenario;

        const config = makeConfig({
          git: {
            platform: 'github',
            url: 'https://github.com/owner/repo',
            pr: { target },
            api: { timeout: 30000 },
          },
        });

        const createdResult: PR_Result = {
          url: 'https://github.com/owner/repo/pull/99',
          number: 99,
          status: 'created',
          fallbackReason: null,
          platform: 'github',
          warnings: [],
        };

        const fallbackUrl = 'https://github.com/owner/repo/compare/main...branch';

        const mockProvider = makeMockProvider({
          createPullRequest: apiSucceeds
            ? jest.fn().mockResolvedValue(createdResult)
            : jest.fn().mockRejectedValue(new Error(errorMessage)),
          generatePullRequestUrl: jest.fn().mockReturnValue(fallbackUrl),
        });

        const deps = makeDeps({
          resolveAuth: jest.fn().mockReturnValue(
            hasToken
              ? { token, method: 'token' as const }
              : { token: null, method: 'token' as const },
          ),
          registry: {
            register: jest.fn(),
            getProvider: jest.fn().mockReturnValue(mockProvider),
            availablePlatforms: jest.fn().mockReturnValue(['github']),
          },
        });

        const result = await createPR(config, branch, commitMsg, 'auto', deps);

        if (hasToken && apiSucceeds) {
          expect(result.status).toBe('created');
          expect(result.url).toBe(createdResult.url);
          expect(result.number).toBe(99);
        } else if (!hasToken) {
          expect(result.status).toBe('fallback');
          expect(result.fallbackReason).toBe('no_token');
          expect(result.number).toBeNull();
        } else {
          // hasToken && !apiSucceeds
          expect(result.status).toBe('fallback');
          expect(result.fallbackReason).toBe(errorMessage);
          expect(result.number).toBeNull();
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: PR/MR error does not interrupt pipeline
// **Validates: Requirements 4.5**
// ---------------------------------------------------------------------------

describe('Property 7: PR/MR error does not interrupt pipeline', () => {
  const arbErrorType = fc.constantFrom('network', 'auth', 'api', 'timeout', 'unknown');

  const arbErrorScenario = fc.record({
    errorType: arbErrorType,
    errorMessage: arbIdent.map((s) => `Error: ${s}`),
    branch: arbBranch,
    commitMsg: arbCommitMsg,
  });

  test('for any API error, createPR in auto mode returns a result (not throws), with status=fallback', async () => {
    await fc.assert(
      fc.asyncProperty(arbErrorScenario, async (scenario) => {
        const { errorType, errorMessage, branch, commitMsg } = scenario;
        const config = makeConfig();

        let error: Error;
        switch (errorType) {
          case 'network':
            error = new VersioningsError(EXIT_CODES.NETWORK_ERROR, errorMessage);
            break;
          case 'auth':
            error = new VersioningsError(EXIT_CODES.CONFIG_ERROR, errorMessage);
            break;
          case 'api':
            error = new VersioningsError(EXIT_CODES.COMMAND_FAILED, errorMessage);
            break;
          case 'timeout':
            error = new Error(`Timeout: ${errorMessage}`);
            break;
          default:
            error = new Error(errorMessage);
        }

        const fallbackUrl = 'https://github.com/owner/repo/compare/main...branch';
        const mockProvider = makeMockProvider({
          createPullRequest: jest.fn().mockRejectedValue(error),
          generatePullRequestUrl: jest.fn().mockReturnValue(fallbackUrl),
        });

        const deps = makeDeps({
          resolveAuth: jest.fn().mockReturnValue({ token: 'ghp_test', method: 'token' as const }),
          registry: {
            register: jest.fn(),
            getProvider: jest.fn().mockReturnValue(mockProvider),
            availablePlatforms: jest.fn().mockReturnValue(['github']),
          },
        });

        // In auto mode, createPR should NEVER throw — always returns a result
        const result = await createPR(config, branch, commitMsg, 'auto', deps);

        expect(result.status).toBe('fallback');
        expect(result.url).toBe(fallbackUrl);
        expect(result.number).toBeNull();
        expect(typeof result.fallbackReason).toBe('string');
        expect(result.fallbackReason!.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8: Unsupported PR parameters → warnings
// **Validates: Requirements 5.7**
// ---------------------------------------------------------------------------

describe('Property 8: Unsupported PR parameters → warnings', () => {
  const arbPrOptionsWithUnsupported = fc.record({
    title: arbIdent.map((s) => `PR: ${s}`),
    body: arbIdent,
    sourceBranch: arbBranch,
    targetBranch: arbTarget,
    reviewers: fc.option(fc.array(arbIdent, { minLength: 1, maxLength: 3 }), { nil: undefined }),
    labels: fc.option(fc.array(arbIdent, { minLength: 1, maxLength: 3 }), { nil: undefined }),
    draft: fc.option(fc.boolean(), { nil: undefined }),
    milestone: fc.option(arbIdent, { nil: undefined }),
    linkedIssues: fc.option(fc.array(arbIdent, { minLength: 1, maxLength: 3 }), { nil: undefined }),
  });

  /** Parameters that a Bitbucket-like provider considers unsupported */
  const UNSUPPORTED_PARAMS = ['labels', 'milestone', 'linkedIssues'] as const;

  test('for any provider and PR_Options with unsupported params, createPullRequest includes warnings', async () => {
    await fc.assert(
      fc.asyncProperty(arbPrOptionsWithUnsupported, async (opts) => {
        // Determine which unsupported params are actually present in this run
        const presentUnsupported = UNSUPPORTED_PARAMS.filter(
          (p) => opts[p] !== undefined,
        );

        // Skip trivial case where no unsupported params are present
        fc.pre(presentUnsupported.length > 0);

        // Build a mock provider that returns warnings for unsupported params
        const warnings = presentUnsupported.map(
          (p) => `Parameter "${p}" is not supported by this provider`,
        );

        const mockResult: PR_Result = {
          url: 'https://bitbucket.org/owner/repo/pull-requests/1',
          number: 1,
          status: 'created',
          fallbackReason: null,
          platform: 'bitbucket',
          warnings,
        };

        const mockProvider: SCM_Provider = {
          name: () => 'bitbucket',
          createPullRequest: jest.fn().mockResolvedValue(mockResult),
          generatePullRequestUrl: jest.fn().mockReturnValue(
            'https://bitbucket.org/owner/repo/pull-requests/new',
          ),
        };

        const config = makeConfig({
          git: {
            platform: 'bitbucket',
            url: 'https://bitbucket.org/owner/repo',
            pr: {
              target: opts.targetBranch,
              reviewers: opts.reviewers,
              labels: opts.labels,
              draft: opts.draft,
              milestone: opts.milestone,
              linkedIssues: opts.linkedIssues,
            },
            api: { timeout: 30000 },
          },
        });

        const deps = makeDeps({
          resolveAuth: jest.fn().mockReturnValue({ token: 'bb_test', method: 'token' as const }),
          registry: {
            register: jest.fn(),
            getProvider: jest.fn().mockReturnValue(mockProvider),
            availablePlatforms: jest.fn().mockReturnValue(['bitbucket']),
          },
        });

        const result = await createPR(config, opts.sourceBranch, opts.title, 'auto', deps);

        // (a) Should not throw — we got a result
        expect(result).toBeDefined();
        expect(result.status).toBe('created');

        // (b) Each unsupported param that was present should have a warning
        for (const param of presentUnsupported) {
          expect(result.warnings.some((w) => w.includes(param))).toBe(true);
        }

        // (c) PR was created with supported parameters
        expect(result.number).toBe(1);
      }),
      { numRuns: 100 },
    );
  });
});
