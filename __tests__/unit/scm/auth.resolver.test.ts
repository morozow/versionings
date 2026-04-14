// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { resolveAuth, maskToken, type AuthResolverDeps } from '../../../src/scm/auth.resolver';

// ---------------------------------------------------------------------------
// Helper: builds AuthResolverDeps with sensible defaults
// ---------------------------------------------------------------------------

function makeDeps(
  overrides: {
    config?: Record<string, any>;
    env?: Record<string, string | undefined>;
  } = {},
): AuthResolverDeps {
  return {
    config: overrides.config ?? {},
    env: overrides.env ?? {},
  };
}

// ---------------------------------------------------------------------------
// Token resolution — individual sources
// ---------------------------------------------------------------------------

describe('Token from config (git.auth.token)', () => {
  test('returns token from config.git.auth.token', () => {
    const deps = makeDeps({ config: { git: { auth: { token: 'cfg-token-12345' } } } });
    const result = resolveAuth(deps, 'github');
    expect(result.token).toBe('cfg-token-12345');
  });
});

describe('Token from VERSIONINGS_TOKEN env', () => {
  test('returns token from env.VERSIONINGS_TOKEN when config has no token', () => {
    const deps = makeDeps({ env: { VERSIONINGS_TOKEN: 'env-token-67890' } });
    const result = resolveAuth(deps, 'github');
    expect(result.token).toBe('env-token-67890');
  });
});

describe('Platform-specific tokens', () => {
  test.each([
    ['github', 'GITHUB_TOKEN'],
    ['github-enterprise', 'GITHUB_TOKEN'],
    ['gitlab', 'GITLAB_TOKEN'],
    ['bitbucket', 'BITBUCKET_TOKEN'],
    ['bitbucket-server', 'BITBUCKET_TOKEN'],
    ['azure-devops', 'AZURE_DEVOPS_TOKEN'],
  ])('platform "%s" resolves token from %s', (platform, envVar) => {
    const deps = makeDeps({ env: { [envVar]: `platform-token-${platform}` } });
    const result = resolveAuth(deps, platform);
    expect(result.token).toBe(`platform-token-${platform}`);
  });
});

// ---------------------------------------------------------------------------
// Token resolution — priority
// ---------------------------------------------------------------------------

describe('Token priority: config > VERSIONINGS_TOKEN > platform-specific', () => {
  test('config.git.auth.token wins over VERSIONINGS_TOKEN', () => {
    const deps = makeDeps({
      config: { git: { auth: { token: 'config-wins' } } },
      env: { VERSIONINGS_TOKEN: 'env-loses' },
    });
    const result = resolveAuth(deps, 'github');
    expect(result.token).toBe('config-wins');
  });

  test('config.git.auth.token wins over platform-specific token', () => {
    const deps = makeDeps({
      config: { git: { auth: { token: 'config-wins' } } },
      env: { GITHUB_TOKEN: 'platform-loses' },
    });
    const result = resolveAuth(deps, 'github');
    expect(result.token).toBe('config-wins');
  });

  test('VERSIONINGS_TOKEN wins over platform-specific token', () => {
    const deps = makeDeps({
      env: { VERSIONINGS_TOKEN: 'env-wins', GITHUB_TOKEN: 'platform-loses' },
    });
    const result = resolveAuth(deps, 'github');
    expect(result.token).toBe('env-wins');
  });

  test('config.git.auth.token wins over all sources', () => {
    const deps = makeDeps({
      config: { git: { auth: { token: 'config-wins' } } },
      env: {
        VERSIONINGS_TOKEN: 'env-loses',
        GITHUB_TOKEN: 'platform-loses',
      },
    });
    const result = resolveAuth(deps, 'github');
    expect(result.token).toBe('config-wins');
  });
});

// ---------------------------------------------------------------------------
// No token → null
// ---------------------------------------------------------------------------

describe('No token available', () => {
  test('returns null when no token source is available', () => {
    const deps = makeDeps();
    const result = resolveAuth(deps, 'github');
    expect(result.token).toBeNull();
  });

  test('returns null for unknown platform with no env tokens', () => {
    const deps = makeDeps();
    const result = resolveAuth(deps, 'unknown-platform');
    expect(result.token).toBeNull();
  });

  test('returns null when config.git.auth.token is empty string', () => {
    const deps = makeDeps({ config: { git: { auth: { token: '' } } } });
    const result = resolveAuth(deps, 'github');
    expect(result.token).toBeNull();
  });

  test('returns null when VERSIONINGS_TOKEN is empty string', () => {
    const deps = makeDeps({ env: { VERSIONINGS_TOKEN: '' } });
    const result = resolveAuth(deps, 'github');
    expect(result.token).toBeNull();
  });

  test('returns null when platform token is empty string', () => {
    const deps = makeDeps({ env: { GITHUB_TOKEN: '' } });
    const result = resolveAuth(deps, 'github');
    expect(result.token).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// maskToken
// ---------------------------------------------------------------------------

describe('maskToken', () => {
  test('token >= 5 chars: shows first 4 chars + stars', () => {
    expect(maskToken('ghp_abcdef12345')).toBe('ghp_***********');
  });

  test('token exactly 5 chars: shows first 4 + 1 star', () => {
    expect(maskToken('abcde')).toBe('abcd*');
  });

  test('token < 5 chars: fully masked', () => {
    expect(maskToken('abc')).toBe('***');
  });

  test('token of 1 char: single star', () => {
    expect(maskToken('x')).toBe('*');
  });

  test('token of 4 chars: fully masked', () => {
    expect(maskToken('abcd')).toBe('****');
  });

  test('empty string: empty result', () => {
    expect(maskToken('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Auth method resolution
// ---------------------------------------------------------------------------

describe('Auth method from config', () => {
  test('uses config.git.auth.method when set to "bearer"', () => {
    const deps = makeDeps({ config: { git: { auth: { method: 'bearer' } } } });
    const result = resolveAuth(deps, 'github');
    expect(result.method).toBe('bearer');
  });

  test('uses config.git.auth.method when set to "token"', () => {
    const deps = makeDeps({ config: { git: { auth: { method: 'token' } } } });
    const result = resolveAuth(deps, 'github');
    expect(result.method).toBe('token');
  });
});

describe('Auth method from env', () => {
  test('uses VERSIONINGS_AUTH_METHOD when config has no method', () => {
    const deps = makeDeps({ env: { VERSIONINGS_AUTH_METHOD: 'bearer' } });
    const result = resolveAuth(deps, 'github');
    expect(result.method).toBe('bearer');
  });
});

describe('Auth method default', () => {
  test('defaults to "token" when no method is configured', () => {
    const deps = makeDeps();
    const result = resolveAuth(deps, 'github');
    expect(result.method).toBe('token');
  });
});

describe('Auth method priority: config > env > default', () => {
  test('config.git.auth.method wins over VERSIONINGS_AUTH_METHOD', () => {
    const deps = makeDeps({
      config: { git: { auth: { method: 'bearer' } } },
      env: { VERSIONINGS_AUTH_METHOD: 'token' },
    });
    const result = resolveAuth(deps, 'github');
    expect(result.method).toBe('bearer');
  });

  test('VERSIONINGS_AUTH_METHOD wins over default', () => {
    const deps = makeDeps({ env: { VERSIONINGS_AUTH_METHOD: 'bearer' } });
    const result = resolveAuth(deps, 'github');
    expect(result.method).toBe('bearer');
  });

  test('invalid config method falls through to env', () => {
    const deps = makeDeps({
      config: { git: { auth: { method: 'invalid' } } },
      env: { VERSIONINGS_AUTH_METHOD: 'bearer' },
    });
    const result = resolveAuth(deps, 'github');
    expect(result.method).toBe('bearer');
  });

  test('invalid config and env methods fall through to default', () => {
    const deps = makeDeps({
      config: { git: { auth: { method: 'invalid' } } },
      env: { VERSIONINGS_AUTH_METHOD: 'also-invalid' },
    });
    const result = resolveAuth(deps, 'github');
    expect(result.method).toBe('token');
  });
});
