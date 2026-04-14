// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau
// Feature: scm-provider-pr-automation, Property 1: Registry provider mapping
// Feature: scm-provider-pr-automation, Property 2: Registry error for unknown platform

import * as fc from 'fast-check';
import { createSCMRegistry } from '../../../src/scm/scm.registry';
import type { SCM_ProviderConfig } from '../../../src/scm/scm.provider';
import type { HttpClient } from '../../../src/scm/http.client';
import type { UrlParser } from '../../../src/scm/url.parser';
import { VersioningsError, EXIT_CODES } from '../../../src/core/errors';

// --- Minimal mocks (not exercised by registry logic) ---

const mockHttpClient: HttpClient = {
  get: jest.fn(),
  post: jest.fn(),
  patch: jest.fn(),
};

const mockUrlParser: UrlParser = {
  parse: jest.fn(),
  format: jest.fn(),
};

// --- Generators ---

const VALID_PLATFORMS = [
  'github',
  'github-enterprise',
  'bitbucket',
  'bitbucket-server',
  'gitlab',
  'azure-devops',
] as const;

/** Arbitrary valid platform from the registered set */
const arbPlatform = fc.constantFrom(...VALID_PLATFORMS);

/** Arbitrary string that is NOT in the valid platform set */
const arbInvalidPlatform = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => !(VALID_PLATFORMS as readonly string[]).includes(s));

/** Builds a minimal SCM_ProviderConfig for a given platform */
function makeConfig(platform: string): SCM_ProviderConfig {
  return {
    platform,
    url: `https://example.com/${platform}/repo`,
    token: 'test-token',
    authMethod: 'token',
    timeout: 30_000,
  };
}

// --- Property 1: Registry provider mapping ---
// **Validates: Requirements 1.2**

describe('Property 1: Registry provider mapping', () => {
  test('for any registered platform, getProvider returns a provider whose name() equals the platform', () => {
    fc.assert(
      fc.property(arbPlatform, (platform) => {
        const registry = createSCMRegistry();
        const config = makeConfig(platform);
        const provider = registry.getProvider(config, mockHttpClient, mockUrlParser);

        expect(provider).toBeDefined();
        expect(provider.name()).toBe(platform);
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 2: Registry error for unknown platform ---
// **Validates: Requirements 1.3**

describe('Property 2: Registry error for unknown platform', () => {
  test('for any string not in the registered set, getProvider throws VersioningsError(CONFIG_ERROR) with available platforms listed', () => {
    fc.assert(
      fc.property(arbInvalidPlatform, (platform) => {
        const registry = createSCMRegistry();
        const config = makeConfig(platform);

        try {
          registry.getProvider(config, mockHttpClient, mockUrlParser);
          fail('Expected VersioningsError to be thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(VersioningsError);
          expect((err as VersioningsError).code).toBe(EXIT_CODES.CONFIG_ERROR);

          // Error message must list all available platforms
          const message = (err as VersioningsError).message;
          for (const p of VALID_PLATFORMS) {
            expect(message).toContain(p);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
