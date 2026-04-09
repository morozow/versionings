// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau
// Feature: scm-provider-pr-automation, Property 4: Token resolution priority
// Feature: scm-provider-pr-automation, Property 5: Token masking

import * as fc from 'fast-check';
import { resolveAuth, maskToken, type AuthResolverDeps } from '../../auth.resolver';

// --- Generators ---

/** Non-empty token string 1–100 chars */
const arbToken = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'.split('')),
  { minLength: 1, maxLength: 100 },
);

/** Valid platform identifier */
const arbPlatform = fc.constantFrom(
  'github',
  'github-enterprise',
  'gitlab',
  'bitbucket',
  'bitbucket-server',
  'azure-devops',
);

/** Platform → env var name mapping */
const PLATFORM_ENV_MAP: Record<string, string> = {
  'github': 'GITHUB_TOKEN',
  'github-enterprise': 'GITHUB_TOKEN',
  'gitlab': 'GITLAB_TOKEN',
  'bitbucket': 'BITBUCKET_TOKEN',
  'bitbucket-server': 'BITBUCKET_TOKEN',
  'azure-devops': 'AZURE_DEVOPS_TOKEN',
};

/** Random combination of auth sources: { configToken?, envToken?, platformToken? } */
const arbAuthSources = fc.record({
  configToken: fc.option(arbToken, { nil: undefined }),
  envToken: fc.option(arbToken, { nil: undefined }),
  platformToken: fc.option(arbToken, { nil: undefined }),
});

// --- Property 4: Token resolution priority ---
// **Validates: Requirements 3.1, 3.2**

describe('Property 4: Token resolution priority', () => {
  test('resolveAuth returns the highest-priority token for any combination of sources', () => {
    fc.assert(
      fc.property(arbAuthSources, arbPlatform, (sources, platform) => {
        const { configToken, envToken, platformToken } = sources;
        const platformEnvVar = PLATFORM_ENV_MAP[platform];

        const config: Record<string, any> = {};
        if (configToken !== undefined) {
          config.git = { auth: { token: configToken } };
        }

        const env: Record<string, string | undefined> = {};
        if (envToken !== undefined) {
          env.VERSIONINGS_TOKEN = envToken;
        }
        if (platformToken !== undefined && platformEnvVar) {
          env[platformEnvVar] = platformToken;
        }

        const deps: AuthResolverDeps = { config, env };
        const result = resolveAuth(deps, platform);

        // Determine expected token by priority: config > VERSIONINGS_TOKEN > platform-specific
        const expectedToken = configToken ?? envToken ?? platformToken ?? null;

        expect(result.token).toBe(expectedToken);

        // If all sources are absent, token is null and method defaults to 'token'
        if (expectedToken === null) {
          expect(result.method).toBe('token');
        }
      }),
      { numRuns: 100 },
    );
  });

  test('resolveAuth never throws regardless of source combination', () => {
    fc.assert(
      fc.property(arbAuthSources, arbPlatform, (sources, platform) => {
        const { configToken, envToken, platformToken } = sources;
        const platformEnvVar = PLATFORM_ENV_MAP[platform];

        const config: Record<string, any> = {};
        if (configToken !== undefined) {
          config.git = { auth: { token: configToken } };
        }

        const env: Record<string, string | undefined> = {};
        if (envToken !== undefined) {
          env.VERSIONINGS_TOKEN = envToken;
        }
        if (platformToken !== undefined && platformEnvVar) {
          env[platformEnvVar] = platformToken;
        }

        const deps: AuthResolverDeps = { config, env };

        // Should never throw
        expect(() => resolveAuth(deps, platform)).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 5: Token masking ---
// **Validates: Requirements 3.4**

describe('Property 5: Token masking', () => {
  test('for tokens >= 5 chars: first 4 visible + stars, total length preserved', () => {
    const arbLongToken = fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'.split('')),
      { minLength: 5, maxLength: 100 },
    );

    fc.assert(
      fc.property(arbLongToken, (token) => {
        const masked = maskToken(token);

        // Total length preserved
        expect(masked.length).toBe(token.length);

        // First 4 chars visible
        expect(masked.slice(0, 4)).toBe(token.slice(0, 4));

        // Rest are stars
        const stars = masked.slice(4);
        expect(stars).toBe('*'.repeat(token.length - 4));
      }),
      { numRuns: 100 },
    );
  });

  test('for tokens < 5 chars: fully masked with stars, length preserved', () => {
    const arbShortToken = fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'.split('')),
      { minLength: 1, maxLength: 4 },
    );

    fc.assert(
      fc.property(arbShortToken, (token) => {
        const masked = maskToken(token);

        // Length preserved
        expect(masked.length).toBe(token.length);

        // Fully masked
        expect(masked).toBe('*'.repeat(token.length));
      }),
      { numRuns: 100 },
    );
  });

  test('maskToken(token) !== token for any non-empty token', () => {
    fc.assert(
      fc.property(arbToken, (token) => {
        const masked = maskToken(token);
        expect(masked).not.toBe(token);
      }),
      { numRuns: 100 },
    );
  });
});
