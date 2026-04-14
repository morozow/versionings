// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * SCM Provider Registry — data-driven mapping of `git.platform` values
 * to SCM_Provider factory functions.
 *
 * Adding a new provider = registering a factory in the registry.
 * No pipeline or CLI code changes required.
 */

import type { SCM_Provider, SCM_ProviderConfig } from './scm.provider';
import type { HttpClient } from './http.client';
import type { UrlParser } from './url.parser';
import { VersioningsError, EXIT_CODES } from '../core/errors';

/** Factory function that creates an SCM_Provider instance. */
export type ProviderFactory = (
  config: SCM_ProviderConfig,
  httpClient: HttpClient,
  urlParser: UrlParser,
) => SCM_Provider;

/** Registry interface for SCM provider lookup and registration. */
export interface SCM_Registry {
  /** Registers (or overrides) a provider factory for the given platform. */
  register(platform: string, factory: ProviderFactory): void;
  /** Returns an SCM_Provider for the platform specified in config. */
  getProvider(
    config: SCM_ProviderConfig,
    httpClient: HttpClient,
    urlParser: UrlParser,
  ): SCM_Provider;
  /** Returns the list of registered platform names. */
  availablePlatforms(): string[];
}

/**
 * Creates a placeholder factory for platforms whose real providers
 * are not yet implemented. The stub provider returns the correct
 * platform name and throws on API calls.
 */
function placeholderFactory(platform: string): ProviderFactory {
  return (config: SCM_ProviderConfig, _httpClient: HttpClient, _urlParser: UrlParser): SCM_Provider => ({
    name(): string {
      return platform;
    },
    createPullRequest(): Promise<never> {
      throw new VersioningsError(
        EXIT_CODES.CONFIG_ERROR,
        `Provider "${platform}" is not yet implemented`,
      );
    },
    generatePullRequestUrl(branch: string, target: string): string {
      return `${config.url}/compare/${target}...${branch}`;
    },
  });
}

/** All platforms pre-registered in the default registry. */
const DEFAULT_PLATFORMS: string[] = [
  'github',
  'github-enterprise',
  'bitbucket',
  'bitbucket-server',
  'gitlab',
  'azure-devops',
];

/**
 * Creates an SCM_Registry with pre-registered placeholder providers
 * for all supported platforms.
 *
 * Real provider factories (github.provider.ts, gitlab.provider.ts, etc.)
 * override the placeholders via `register()` when they become available.
 *
 * Throws VersioningsError(CONFIG_ERROR) when getProvider is called
 * with an unknown platform.
 */
export function createSCMRegistry(): SCM_Registry {
  const factories = new Map<string, ProviderFactory>();

  // Pre-register placeholder factories for all supported platforms.
  for (const platform of DEFAULT_PLATFORMS) {
    factories.set(platform, placeholderFactory(platform));
  }

  return {
    register(platform: string, factory: ProviderFactory): void {
      factories.set(platform, factory);
    },

    getProvider(
      config: SCM_ProviderConfig,
      httpClient: HttpClient,
      urlParser: UrlParser,
    ): SCM_Provider {
      const factory = factories.get(config.platform);
      if (!factory) {
        const available = Array.from(factories.keys()).join(', ');
        throw new VersioningsError(
          EXIT_CODES.CONFIG_ERROR,
          `Unknown platform "${config.platform}". Available platforms: ${available}`,
          { platform: config.platform, availablePlatforms: Array.from(factories.keys()) },
        );
      }
      return factory(config, httpClient, urlParser);
    },

    availablePlatforms(): string[] {
      return Array.from(factories.keys());
    },
  };
}
