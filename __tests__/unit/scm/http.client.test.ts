// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { createHttpClient, type HttpClient, type FetchFn } from '../../../src/scm/http.client';
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

// --- Successful requests ---

describe('Successful GET', () => {
  test('returns status, parsed JSON body, and headers', async () => {
    const payload = { id: 1, name: 'test' };
    const mockFetch = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValueOnce(mockResponse(200, payload));

    const client = createHttpClient(mockFetch as unknown as FetchFn);
    const res = await client.get('https://api.example.com/resource');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(payload);
    expect(res.headers['content-type']).toBe('application/json');

    // Verify fetch was called with GET method
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.example.com/resource');
    expect(init?.method).toBe('GET');
  });
});

describe('Successful POST', () => {
  test('sends JSON body and returns parsed response', async () => {
    const reqBody = { title: 'New PR', body: 'Description' };
    const resPayload = { id: 42, html_url: 'https://github.com/pr/42' };
    const mockFetch = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValueOnce(mockResponse(201, resPayload));

    const client = createHttpClient(mockFetch as unknown as FetchFn);
    const res = await client.post('https://api.example.com/pulls', reqBody);

    expect(res.status).toBe(201);
    expect(res.body).toEqual(resPayload);

    const [, init] = mockFetch.mock.calls[0];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual(reqBody);
    // Content-Type should be set for POST
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });
});

describe('Successful PATCH', () => {
  test('sends JSON body and returns parsed response', async () => {
    const reqBody = { milestone: 5 };
    const resPayload = { id: 1, milestone: { number: 5 } };
    const mockFetch = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValueOnce(mockResponse(200, resPayload));

    const client = createHttpClient(mockFetch as unknown as FetchFn);
    const res = await client.patch('https://api.example.com/issues/1', reqBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(resPayload);

    const [, init] = mockFetch.mock.calls[0];
    expect(init?.method).toBe('PATCH');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });
});


// --- HTTP error status codes ---

describe('HTTP 401 → CONFIG_ERROR', () => {
  test('throws VersioningsError with CONFIG_ERROR code', async () => {
    const mockFetch = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValueOnce(mockResponse(401, { message: 'Bad credentials' }));

    const client = createHttpClient(mockFetch as unknown as FetchFn);

    try {
      await client.get('https://api.example.com/resource');
      fail('Expected VersioningsError');
    } catch (err) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect((err as VersioningsError).code).toBe(EXIT_CODES.CONFIG_ERROR);
      expect((err as VersioningsError).message).toContain('token');
    }
  });
});

describe('HTTP 403 → CONFIG_ERROR', () => {
  test('throws VersioningsError with CONFIG_ERROR code', async () => {
    const mockFetch = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValueOnce(mockResponse(403, { message: 'Forbidden' }));

    const client = createHttpClient(mockFetch as unknown as FetchFn);

    try {
      await client.get('https://api.example.com/resource');
      fail('Expected VersioningsError');
    } catch (err) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect((err as VersioningsError).code).toBe(EXIT_CODES.CONFIG_ERROR);
      expect((err as VersioningsError).message).toContain('token');
    }
  });
});

describe('HTTP 404 → CONFIG_ERROR', () => {
  test('throws VersioningsError with CONFIG_ERROR and apiUrl hint', async () => {
    const mockFetch = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValueOnce(mockResponse(404, { message: 'Not Found' }));

    const client = createHttpClient(mockFetch as unknown as FetchFn);

    try {
      await client.get('https://api.example.com/resource');
      fail('Expected VersioningsError');
    } catch (err) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect((err as VersioningsError).code).toBe(EXIT_CODES.CONFIG_ERROR);
      expect((err as VersioningsError).message).toContain('apiUrl');
    }
  });
});

// --- Network errors ---

describe('Network error → NETWORK_ERROR', () => {
  test('wraps DNS failure (TypeError) into VersioningsError(NETWORK_ERROR)', async () => {
    const mockFetch = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockRejectedValueOnce(new TypeError('fetch failed'));

    const client = createHttpClient(mockFetch as unknown as FetchFn);

    try {
      await client.get('https://api.example.com/resource');
      fail('Expected VersioningsError');
    } catch (err) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect((err as VersioningsError).code).toBe(EXIT_CODES.NETWORK_ERROR);
      expect((err as VersioningsError).message).toContain('Network error');
      expect((err as VersioningsError).message).toContain('fetch failed');
    }
  });
});

// --- Timeout ---

describe('Timeout', () => {
  test('aborts request when fetch takes longer than configured timeout', async () => {
    const mockFetch = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockImplementation((_url, init) => {
        return new Promise((resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          if (signal) {
            signal.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          }
          // Never resolves on its own — relies on abort
        });
      });

    // Very short timeout to trigger abort quickly
    const client = createHttpClient(mockFetch as unknown as FetchFn, { timeout: 50 });

    try {
      await client.get('https://api.example.com/slow');
      fail('Expected VersioningsError');
    } catch (err) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect((err as VersioningsError).code).toBe(EXIT_CODES.NETWORK_ERROR);
    }
  });
});

// --- User-Agent header ---

describe('User-Agent header', () => {
  test('sets User-Agent header on GET requests', async () => {
    const mockFetch = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValueOnce(mockResponse(200, {}));

    const client = createHttpClient(mockFetch as unknown as FetchFn);
    await client.get('https://api.example.com/resource');

    const [, init] = mockFetch.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers['User-Agent']).toMatch(/^versionings\//);
  });

  test('sets User-Agent header on POST requests', async () => {
    const mockFetch = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValueOnce(mockResponse(201, {}));

    const client = createHttpClient(mockFetch as unknown as FetchFn);
    await client.post('https://api.example.com/resource', { data: 1 });

    const [, init] = mockFetch.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers['User-Agent']).toMatch(/^versionings\//);
  });

  test('sets User-Agent header on PATCH requests', async () => {
    const mockFetch = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValueOnce(mockResponse(200, {}));

    const client = createHttpClient(mockFetch as unknown as FetchFn);
    await client.patch('https://api.example.com/resource', { data: 1 });

    const [, init] = mockFetch.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers['User-Agent']).toMatch(/^versionings\//);
  });

  test('uses custom userAgent when provided', async () => {
    const mockFetch = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValueOnce(mockResponse(200, {}));

    const client = createHttpClient(mockFetch as unknown as FetchFn, { userAgent: 'custom-agent/2.0' });
    await client.get('https://api.example.com/resource');

    const [, init] = mockFetch.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe('custom-agent/2.0');
  });
});

// --- Custom timeout ---

describe('Custom timeout', () => {
  test('respects custom timeout value', async () => {
    const mockFetch = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockImplementation((_url, init) => {
        return new Promise((resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          if (signal) {
            signal.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          }
          // Resolve after 200ms — should succeed with 500ms timeout, fail with 50ms
        });
      });

    // With a very short timeout, the request should abort
    const client = createHttpClient(mockFetch as unknown as FetchFn, { timeout: 50 });

    try {
      await client.get('https://api.example.com/resource');
      fail('Expected VersioningsError');
    } catch (err) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect((err as VersioningsError).code).toBe(EXIT_CODES.NETWORK_ERROR);
    }
  });

  test('succeeds when response arrives before custom timeout', async () => {
    const mockFetch = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValueOnce(mockResponse(200, { ok: true }));

    // Generous timeout — response is immediate
    const client = createHttpClient(mockFetch as unknown as FetchFn, { timeout: 5000 });
    const res = await client.get('https://api.example.com/resource');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

// --- Content-Type for POST/PATCH ---

describe('Content-Type: application/json for POST and PATCH', () => {
  test('POST sets Content-Type: application/json', async () => {
    const mockFetch = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValueOnce(mockResponse(201, {}));

    const client = createHttpClient(mockFetch as unknown as FetchFn);
    await client.post('https://api.example.com/resource', { key: 'value' });

    const [, init] = mockFetch.mock.calls[0];
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  test('PATCH sets Content-Type: application/json', async () => {
    const mockFetch = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValueOnce(mockResponse(200, {}));

    const client = createHttpClient(mockFetch as unknown as FetchFn);
    await client.patch('https://api.example.com/resource', { key: 'value' });

    const [, init] = mockFetch.mock.calls[0];
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  test('GET does not set Content-Type', async () => {
    const mockFetch = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValueOnce(mockResponse(200, {}));

    const client = createHttpClient(mockFetch as unknown as FetchFn);
    await client.get('https://api.example.com/resource');

    const [, init] = mockFetch.mock.calls[0];
    expect((init?.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });
});
