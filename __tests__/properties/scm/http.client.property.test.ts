// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau
// Feature: scm-provider-pr-automation, Property 9: HTTP error mapping to VersioningsError
// Feature: scm-provider-pr-automation, Property 10: User-Agent header in HTTP requests

import * as fc from 'fast-check';
import { createHttpClient, type FetchFn } from '../../../src/scm/http.client';
import { VersioningsError, EXIT_CODES } from '../../../src/core/errors';

/**
 * Helper: builds a minimal Response-like object accepted by the http client.
 */
function mockResponse(
  status: number,
  body: any,
  contentType = 'application/json',
): Response {
  const headers = new Headers({ 'content-type': contentType });
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    headers,
  } as unknown as Response;
}

// --- Generators ---

/** HTTP status codes that map to CONFIG_ERROR (auth failures) */
const arbAuthStatus = fc.constantFrom(401, 403);

/** Network error types that map to NETWORK_ERROR */
const arbNetworkError = fc.oneof(
  fc.constant(new TypeError('fetch failed')),
  fc.constant(new TypeError('Failed to fetch')),
  fc.constant(new DOMException('The operation was aborted.', 'AbortError')),
  fc.constant(new TypeError('getaddrinfo ENOTFOUND api.example.com')),
  fc.constant(new TypeError('connect ECONNREFUSED 127.0.0.1:443')),
);

/** Random valid URL for requests */
const arbUrl = fc
  .tuple(
    fc.constantFrom('https://api.github.com', 'https://gitlab.com', 'https://api.bitbucket.org', 'https://dev.azure.com'),
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-/'.split('')), {
      minLength: 1,
      maxLength: 40,
    }),
  )
  .map(([base, path]) => `${base}/${path}`);

/** HTTP method: GET, POST, or PATCH */
const arbMethod = fc.constantFrom('GET' as const, 'POST' as const, 'PATCH' as const);

// --- Property 9: HTTP error mapping to VersioningsError ---
// **Validates: Requirements 6.3, 6.4, 6.5**

describe('Property 9: HTTP error mapping to VersioningsError', () => {
  test('HTTP 401/403 → VersioningsError(CONFIG_ERROR) with token hint', async () => {
    await fc.assert(
      fc.asyncProperty(arbAuthStatus, arbUrl, async (status, url) => {
        const mockFetch = jest.fn().mockResolvedValueOnce(mockResponse(status, { message: 'Unauthorized' }));
        const client = createHttpClient(mockFetch as unknown as FetchFn);

        try {
          await client.get(url);
          throw new Error('Expected VersioningsError');
        } catch (err) {
          expect(err).toBeInstanceOf(VersioningsError);
          expect((err as VersioningsError).code).toBe(EXIT_CODES.CONFIG_ERROR);
          expect((err as VersioningsError).message).toContain('token');
        }
      }),
      { numRuns: 100 },
    );
  });

  test('HTTP 404 → VersioningsError(CONFIG_ERROR) with apiUrl hint', async () => {
    await fc.assert(
      fc.asyncProperty(arbUrl, async (url) => {
        const mockFetch = jest.fn().mockResolvedValueOnce(mockResponse(404, { message: 'Not Found' }));
        const client = createHttpClient(mockFetch as unknown as FetchFn);

        try {
          await client.get(url);
          throw new Error('Expected VersioningsError');
        } catch (err) {
          expect(err).toBeInstanceOf(VersioningsError);
          expect((err as VersioningsError).code).toBe(EXIT_CODES.CONFIG_ERROR);
          expect((err as VersioningsError).message).toContain('apiUrl');
        }
      }),
      { numRuns: 100 },
    );
  });

  test('Network errors → VersioningsError(NETWORK_ERROR)', async () => {
    await fc.assert(
      fc.asyncProperty(arbNetworkError, arbUrl, async (networkErr, url) => {
        const mockFetch = jest.fn().mockRejectedValueOnce(networkErr);
        const client = createHttpClient(mockFetch as unknown as FetchFn);

        try {
          await client.get(url);
          throw new Error('Expected VersioningsError');
        } catch (err) {
          expect(err).toBeInstanceOf(VersioningsError);
          expect((err as VersioningsError).code).toBe(EXIT_CODES.NETWORK_ERROR);
          expect((err as VersioningsError).message).toContain('Network error');
        }
      }),
      { numRuns: 100 },
    );
  });
});


// --- Property 10: User-Agent header in HTTP requests ---
// **Validates: Requirements 6.6**

describe('Property 10: User-Agent header in HTTP requests', () => {
  test('for any request (GET/POST/PATCH), User-Agent matches versionings/<version>', async () => {
    await fc.assert(
      fc.asyncProperty(arbMethod, arbUrl, async (method, url) => {
        const mockFetch = jest.fn().mockResolvedValueOnce(mockResponse(200, { ok: true }));
        const client = createHttpClient(mockFetch as unknown as FetchFn);

        switch (method) {
          case 'GET':
            await client.get(url);
            break;
          case 'POST':
            await client.post(url, { data: 'test' });
            break;
          case 'PATCH':
            await client.patch(url, { data: 'test' });
            break;
        }

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [, init] = mockFetch.mock.calls[0];
        const headers = init?.headers as Record<string, string>;
        expect(headers['User-Agent']).toMatch(/^versionings\/\d+\.\d+\.\d+$/);
      }),
      { numRuns: 100 },
    );
  });
});
