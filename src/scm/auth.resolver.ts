// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * Auth Resolver — resolves authentication token and method
 * from configuration and environment variables.
 *
 * Priority (descending):
 *   1. config.git.auth.token
 *   2. env.VERSIONINGS_TOKEN
 *   3. Platform-specific: GITHUB_TOKEN, GITLAB_TOKEN, BITBUCKET_TOKEN, AZURE_DEVOPS_TOKEN
 *
 * Auth method priority:
 *   1. config.git.auth.method
 *   2. env.VERSIONINGS_AUTH_METHOD
 *   3. default: 'token'
 */

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface AuthResolverDeps {
  config: Record<string, any>;
  env: Record<string, string | undefined>;
}

export interface AuthResult {
  token: string | null;
  method: 'token' | 'bearer';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maps platform identifiers to their platform-specific env var names.
 * github-enterprise shares GITHUB_TOKEN with github;
 * bitbucket-server shares BITBUCKET_TOKEN with bitbucket.
 */
const PLATFORM_TOKEN_MAP: Record<string, string> = {
  'github': 'GITHUB_TOKEN',
  'github-enterprise': 'GITHUB_TOKEN',
  'gitlab': 'GITLAB_TOKEN',
  'bitbucket': 'BITBUCKET_TOKEN',
  'bitbucket-server': 'BITBUCKET_TOKEN',
  'azure-devops': 'AZURE_DEVOPS_TOKEN',
};

const VALID_AUTH_METHODS: ReadonlySet<string> = new Set(['token', 'bearer']);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolves the authentication token from available sources.
 *
 * Returns `{ token: null, method: 'token' }` when no token is found —
 * never throws on missing credentials.
 *
 * Never logs or exposes the raw token value.
 */
export function resolveAuth(deps: AuthResolverDeps, platform: string): AuthResult {
  const { config, env } = deps;

  // --- Resolve token (priority: config > VERSIONINGS_TOKEN > platform-specific) ---
  const configToken = config?.git?.auth?.token;
  const token: string | null =
    (typeof configToken === 'string' && configToken.length > 0)
      ? configToken
      : (typeof env.VERSIONINGS_TOKEN === 'string' && env.VERSIONINGS_TOKEN.length > 0)
        ? env.VERSIONINGS_TOKEN
        : resolvePlatformToken(env, platform);

  // --- Resolve auth method (priority: config > env > default) ---
  const configMethod = config?.git?.auth?.method;
  const envMethod = env.VERSIONINGS_AUTH_METHOD;

  let method: 'token' | 'bearer' = 'token';
  if (typeof configMethod === 'string' && VALID_AUTH_METHODS.has(configMethod)) {
    method = configMethod as 'token' | 'bearer';
  } else if (typeof envMethod === 'string' && VALID_AUTH_METHODS.has(envMethod)) {
    method = envMethod as 'token' | 'bearer';
  }

  return { token, method };
}

/**
 * Masks a token for safe display: shows first 4 characters, replaces
 * the rest with `*`. Tokens shorter than 5 characters are fully masked.
 */
export function maskToken(token: string): string {
  if (token.length < 5) {
    return '*'.repeat(token.length);
  }
  return token.slice(0, 4) + '*'.repeat(token.length - 4);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolvePlatformToken(
  env: Record<string, string | undefined>,
  platform: string,
): string | null {
  const envVar = PLATFORM_TOKEN_MAP[platform];
  if (!envVar) return null;

  const value = env[envVar];
  return (typeof value === 'string' && value.length > 0) ? value : null;
}
