// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import * as fc from 'fast-check';
import { maskTokens } from '../../src/core/operation.log';

// --- Generators ---

/** Arbitrary for hex token strings (>= 20 hex characters, lowercase) */
const arbHexToken = fc.stringOf(
  fc.constantFrom(...'0123456789abcdef'.split('')),
  { minLength: 20, maxLength: 64 },
);

/** Arbitrary for base64-like token strings (>= 20 chars, must contain at least one of +/=) */
const arbBase64Token = fc.tuple(
  fc.stringOf(
    fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.split('')),
    { minLength: 17, maxLength: 60 },
  ),
  fc.constantFrom('+', '/', '='),
  fc.stringOf(
    fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='.split('')),
    { minLength: 2, maxLength: 10 },
  ),
).map(([prefix, special, suffix]) => prefix + special + suffix);

/** Arbitrary for safe prefix/suffix text that won't be mistaken for tokens */
const arbSafeText = fc.constantFrom(
  'versionings release',
  'npm version patch',
  'git push origin main',
  '--semver=minor',
  '--branch=develop',
  '--push',
  '--verbose',
  '--json',
  'some-command',
  'run test',
);

/** Arbitrary for env-var-style secret keys */
const arbSecretKey = fc.constantFrom(
  'GITHUB_TOKEN', 'NPM_TOKEN', 'MY_SECRET', 'API_KEY',
  'AUTH_TOKEN', 'GIT_PASSWORD', 'CREDENTIAL_STORE',
);

/** Arbitrary for flag-style secret keys */
const arbSecretFlag = fc.constantFrom(
  '--token', '--password', '--secret', '--auth', '--api-key', '--credentials',
);

// --- Property 9: Token masking in command ---

/**
 * Property 9: Маскирование токенов в command
 *
 * For any command string containing token-like substrings (hex/base64 strings
 * >= 20 characters, or values of secret env var / flag patterns), maskTokens()
 * SHALL replace all such tokens with `***`, and the result SHALL NOT contain
 * the original token values.
 *
 * **Validates: Requirements 5.4**
 */
describe('Feature: operational-hardening, Property 9: Маскирование токенов в command', () => {
  test('hex tokens (>= 20 chars) are replaced with *** and absent from result', () => {
    fc.assert(
      fc.property(arbSafeText, arbHexToken, (prefix, token) => {
        const command = `${prefix} ${token}`;
        const result = maskTokens(command);

        expect(result).not.toContain(token);
        expect(result).toContain('***');
      }),
      { numRuns: 100 },
    );
  });

  test('base64-like tokens (>= 20 chars with +/=) are replaced with *** and absent from result', () => {
    fc.assert(
      fc.property(arbSafeText, arbBase64Token, (prefix, token) => {
        const command = `${prefix} ${token}`;
        const result = maskTokens(command);

        expect(result).not.toContain(token);
        expect(result).toContain('***');
      }),
      { numRuns: 100 },
    );
  });

  test('env-var-style secret values (KEY=value) are masked', () => {
    fc.assert(
      fc.property(arbSecretKey, arbHexToken, (key, value) => {
        const command = `${key}=${value} versionings release`;
        const result = maskTokens(command);

        expect(result).not.toContain(value);
        expect(result).toContain('***');
      }),
      { numRuns: 100 },
    );
  });

  test('flag-style secret values (--token=value) are masked', () => {
    fc.assert(
      fc.property(arbSecretFlag, arbHexToken, (flag, value) => {
        const command = `versionings release ${flag}=${value}`;
        const result = maskTokens(command);

        expect(result).not.toContain(value);
        expect(result).toContain('***');
      }),
      { numRuns: 100 },
    );
  });

  test('multiple tokens in a single command are all masked', () => {
    fc.assert(
      fc.property(arbHexToken, arbHexToken, (token1, token2) => {
        const command = `cmd ${token1} --flag ${token2}`;
        const result = maskTokens(command);

        expect(result).not.toContain(token1);
        expect(result).not.toContain(token2);
      }),
      { numRuns: 100 },
    );
  });

  test('commands without tokens are returned unchanged', () => {
    fc.assert(
      fc.property(arbSafeText, (command) => {
        const result = maskTokens(command);

        expect(result).toBe(command);
      }),
      { numRuns: 100 },
    );
  });
});
