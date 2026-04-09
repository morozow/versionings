// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { createSCMRegistry, type ProviderFactory } from '../../scm.registry';
import type { SCM_Provider, SCM_ProviderConfig } from '../../scm.provider';
import type { HttpClient } from '../../http.client';
import type { UrlParser } from '../../url.parser';
import { VersioningsError, EXIT_CODES } from '../../errors';

// ---------------------------------------------------------------------------
// Minimal mocks for HttpClient and UrlParser (not exercised by registry logic)
// ---------------------------------------------------------------------------

const mockHttpClient: HttpClient = {
  get: jest.fn(),
  post: jest.fn(),
  patch: jest.fn(),
};

const mockUrlParser: UrlParser = {
  parse: jest.fn(),
  format: jest.fn(),
};

// ---------------------------------------------------------------------------
// Helper: builds a minimal SCM_ProviderConfig for a given platform
// ---------------------------------------------------------------------------

function makeConfig(platform: string): SCM_ProviderConfig {
  return {
    platform,
    url: `https://example.com/${platform}/repo`,
    token: 'test-token',
    authMethod: 'token',
    timeout: 30_000,
  };
}

// ---------------------------------------------------------------------------
// All 6 default platforms
// ---------------------------------------------------------------------------

const ALL_PLATFORMS = [
  'github',
  'github-enterprise',
  'bitbucket',
  'bitbucket-server',
  'gitlab',
  'azure-devops',
];

// ---------------------------------------------------------------------------
// getProvider returns a provider for each registered platform
// ---------------------------------------------------------------------------

describe('getProvider for each platform', () => {
  const registry = createSCMRegistry();

  test.each(ALL_PLATFORMS)('returns a provider for platform "%s"', (platform) => {
    const config = makeConfig(platform);
    const provider = registry.getProvider(config, mockHttpClient, mockUrlParser);
    expect(provider).toBeDefined();
    expect(typeof provider.name).toBe('function');
    expect(typeof provider.createPullRequest).toBe('function');
    expect(typeof provider.generatePullRequestUrl).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// name() matches the platform string
// ---------------------------------------------------------------------------

describe('name() matches platform', () => {
  const registry = createSCMRegistry();

  test.each(ALL_PLATFORMS)('provider.name() === "%s"', (platform) => {
    const config = makeConfig(platform);
    const provider = registry.getProvider(config, mockHttpClient, mockUrlParser);
    expect(provider.name()).toBe(platform);
  });
});

// ---------------------------------------------------------------------------
// Unknown platform → VersioningsError(CONFIG_ERROR) with available platforms
// ---------------------------------------------------------------------------

describe('unknown platform throws VersioningsError', () => {
  const registry = createSCMRegistry();

  test('throws VersioningsError with CONFIG_ERROR code', () => {
    const config = makeConfig('unknown-platform');
    expect(() => registry.getProvider(config, mockHttpClient, mockUrlParser)).toThrow(
      VersioningsError,
    );
  });

  test('error code is CONFIG_ERROR', () => {
    const config = makeConfig('unknown-platform');
    try {
      registry.getProvider(config, mockHttpClient, mockUrlParser);
      fail('Expected VersioningsError');
    } catch (err) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect((err as VersioningsError).code).toBe(EXIT_CODES.CONFIG_ERROR);
    }
  });

  test('error message lists all available platforms', () => {
    const config = makeConfig('nonexistent');
    try {
      registry.getProvider(config, mockHttpClient, mockUrlParser);
      fail('Expected VersioningsError');
    } catch (err) {
      const message = (err as VersioningsError).message;
      for (const p of ALL_PLATFORMS) {
        expect(message).toContain(p);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// availablePlatforms() returns all 6 default platforms
// ---------------------------------------------------------------------------

describe('availablePlatforms()', () => {
  test('returns all 6 default platforms', () => {
    const registry = createSCMRegistry();
    const platforms = registry.availablePlatforms();
    expect(platforms).toHaveLength(6);
    for (const p of ALL_PLATFORMS) {
      expect(platforms).toContain(p);
    }
  });
});

// ---------------------------------------------------------------------------
// register() allows adding and overriding providers
// ---------------------------------------------------------------------------

describe('register custom provider', () => {
  test('registers a new platform and getProvider returns it', () => {
    const registry = createSCMRegistry();

    const customProvider: SCM_Provider = {
      name: () => 'custom-scm',
      createPullRequest: jest.fn(),
      generatePullRequestUrl: () => 'https://custom.example.com/pr',
    };

    const factory: ProviderFactory = () => customProvider;
    registry.register('custom-scm', factory);

    const config = makeConfig('custom-scm');
    const provider = registry.getProvider(config, mockHttpClient, mockUrlParser);
    expect(provider.name()).toBe('custom-scm');
  });

  test('registered platform appears in availablePlatforms()', () => {
    const registry = createSCMRegistry();
    registry.register('custom-scm', () => ({
      name: () => 'custom-scm',
      createPullRequest: jest.fn(),
      generatePullRequestUrl: () => '',
    }));
    expect(registry.availablePlatforms()).toContain('custom-scm');
  });

  test('overrides an existing platform factory', () => {
    const registry = createSCMRegistry();

    const overriddenProvider: SCM_Provider = {
      name: () => 'github',
      createPullRequest: jest.fn(),
      generatePullRequestUrl: () => 'https://overridden.example.com/pr',
    };

    registry.register('github', () => overriddenProvider);

    const config = makeConfig('github');
    const provider = registry.getProvider(config, mockHttpClient, mockUrlParser);
    expect(provider.generatePullRequestUrl('feat', 'main')).toBe(
      'https://overridden.example.com/pr',
    );
  });
});
