// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * HTTP client for SCM API — thin wrapper over Node.js global fetch (Node 18+).
 *
 * Provides unified error handling, User-Agent header, and configurable timeout
 * for all HTTP requests to SCM provider APIs.
 * Accepts fetchFn via DI for testability.
 */

import { VersioningsError, EXIT_CODES } from './errors';

/** DI type for the global fetch function. */
export type FetchFn = typeof globalThis.fetch;

/** Options for the HTTP client. */
export interface HttpClientOpts {
  /** Request timeout in milliseconds (default: 30000). */
  timeout: number;
  /** User-Agent header value (default: 'versionings/<version>'). */
  userAgent: string;
}

/** Parsed HTTP response. */
export interface HttpResponse {
  status: number;
  body: any;
  headers: Record<string, string>;
}

/** HTTP client interface for SCM API calls. */
export interface HttpClient {
  get(url: string, headers?: Record<string, string>): Promise<HttpResponse>;
  post(url: string, body: any, headers?: Record<string, string>): Promise<HttpResponse>;
  patch(url: string, body: any, headers?: Record<string, string>): Promise<HttpResponse>;
}

const DEFAULT_TIMEOUT = 30_000;
const VERSION = '0.1.0';
const DEFAULT_USER_AGENT = `versionings/${VERSION}`;

/**
 * Converts a fetch Response to an HttpResponse, parsing JSON when possible.
 */
function parseHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

/**
 * Checks the HTTP status and throws VersioningsError for auth/not-found errors.
 */
function checkStatus(status: number): void {
  if (status === 401 || status === 403) {
    throw new VersioningsError(
      EXIT_CODES.CONFIG_ERROR,
      'Authentication failed — check your token',
    );
  }
  if (status === 404) {
    throw new VersioningsError(
      EXIT_CODES.CONFIG_ERROR,
      'API endpoint not found — check git.apiUrl',
    );
  }
}

/**
 * Wraps a network/fetch error into a VersioningsError(NETWORK_ERROR).
 */
function wrapNetworkError(err: unknown): never {
  if (err instanceof VersioningsError) {
    throw err;
  }
  const message = err instanceof Error ? err.message : String(err);
  throw new VersioningsError(
    EXIT_CODES.NETWORK_ERROR,
    `Network error: ${message}`,
  );
}

/**
 * Creates an HTTP client backed by global fetch (Node 18+).
 *
 * @param fetchFn - fetch implementation (defaults to globalThis.fetch). Inject a mock for tests.
 * @param opts    - optional overrides for timeout and User-Agent.
 */
export function createHttpClient(fetchFn?: FetchFn, opts?: Partial<HttpClientOpts>): HttpClient {
  const fetch: FetchFn = fetchFn ?? globalThis.fetch;
  const timeout = opts?.timeout ?? DEFAULT_TIMEOUT;
  const userAgent = opts?.userAgent ?? DEFAULT_USER_AGENT;

  async function request(
    method: string,
    url: string,
    body?: any,
    extraHeaders?: Record<string, string>,
  ): Promise<HttpResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const headers: Record<string, string> = {
        'User-Agent': userAgent,
        ...extraHeaders,
      };

      const init: RequestInit = {
        method,
        headers,
        signal: controller.signal,
      };

      if (body !== undefined) {
        headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
        init.body = JSON.stringify(body);
      }

      const response = await fetch(url, init);

      checkStatus(response.status);

      const responseHeaders = parseHeaders(response);
      let responseBody: any;
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        responseBody = await response.json();
      } else {
        responseBody = await response.text();
      }

      return { status: response.status, body: responseBody, headers: responseHeaders };
    } catch (err) {
      return wrapNetworkError(err);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    get(url: string, headers?: Record<string, string>): Promise<HttpResponse> {
      return request('GET', url, undefined, headers);
    },
    post(url: string, body: any, headers?: Record<string, string>): Promise<HttpResponse> {
      return request('POST', url, body, headers);
    },
    patch(url: string, body: any, headers?: Record<string, string>): Promise<HttpResponse> {
      return request('PATCH', url, body, headers);
    },
  };
}
