// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau
// Feature: scm-provider-pr-automation, Property 14: Extended configuration validation
// **Validates: Requirements 2.1, 2.3, 5.1-5.6, 8.1-8.3, 8.5-8.7**

import * as fc from 'fast-check';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { loadAndValidateConfig } from '../../../src/config/config.validator';
import { EXIT_CODES, VersioningsError } from '../../../src/core/errors';

// --- Generators ---

const VALID_PLATFORMS = ['github', 'github-enterprise', 'bitbucket', 'bitbucket-server', 'gitlab', 'azure-devops'] as const;
const SELF_HOSTED_REQUIRING_API_URL = ['github-enterprise', 'bitbucket-server'] as const;
const NO_API_URL_REQUIRED = ['github', 'bitbucket', 'gitlab', 'azure-devops'] as const;

const arbPlatform = fc.constantFrom(...VALID_PLATFORMS);
const arbSelfHostedPlatform = fc.constantFrom(...SELF_HOSTED_REQUIRING_API_URL);
const arbNoApiUrlPlatform = fc.constantFrom(...NO_API_URL_REQUIRED);

const arbInvalidPlatform = fc.string({ minLength: 1, maxLength: 30 })
  .filter((s) => !VALID_PLATFORMS.includes(s as any) && s.trim().length > 0);

const arbApiUrl = fc.oneof(
  fc.webUrl({ withFragments: false, withQueryParameters: false }),
  fc.constant('https://git.corp.example.com/api'),
  fc.constant('http://localhost:8080'),
);

const arbInvalidApiUrl = fc.string({ minLength: 1, maxLength: 50 })
  .filter((s) => !s.startsWith('https://') && !s.startsWith('http://') && s.trim().length > 0);

const arbTimeout = fc.integer({ min: 1000, max: 120000 });
const arbInvalidTimeoutLow = fc.integer({ min: -10000, max: 999 });
const arbInvalidTimeoutHigh = fc.integer({ min: 120001, max: 999999 });

const arbReviewers = fc.array(fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0), { minLength: 0, maxLength: 5 });
const arbLabels = fc.array(fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0), { minLength: 0, maxLength: 5 });
const arbLinkedIssues = fc.array(fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0), { minLength: 0, maxLength: 3 });

/**
 * Generate a valid extended config object.
 * For self-hosted platforms, always includes apiUrl.
 */
const arbValidExtendedConfig = fc.record({
  platform: arbPlatform,
  url: fc.constant('https://github.com/org/repo.git'),
  hasApiUrl: fc.boolean(),
  apiUrl: arbApiUrl,
  hasAuth: fc.boolean(),
  authToken: fc.string({ minLength: 1, maxLength: 40 }).filter(s => s.trim().length > 0),
  authMethod: fc.constantFrom('token' as const, 'bearer' as const),
  hasApi: fc.boolean(),
  timeout: arbTimeout,
  hasReviewers: fc.boolean(),
  reviewers: arbReviewers,
  hasLabels: fc.boolean(),
  labels: arbLabels,
  hasDraft: fc.boolean(),
  draft: fc.boolean(),
  hasTemplate: fc.boolean(),
  template: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
  hasMilestone: fc.boolean(),
  milestone: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
  hasLinkedIssues: fc.boolean(),
  linkedIssues: arbLinkedIssues,
}).map((r) => {
  const config: any = {
    git: {
      platform: r.platform,
      url: r.url,
    },
  };

  // Self-hosted platforms always need apiUrl
  const needsApiUrl = SELF_HOSTED_REQUIRING_API_URL.includes(r.platform as any);
  if (needsApiUrl || r.hasApiUrl) {
    config.git.apiUrl = r.apiUrl;
  }

  if (r.hasAuth) {
    config.git.auth = { token: r.authToken, method: r.authMethod };
  }

  if (r.hasApi) {
    config.git.api = { timeout: r.timeout };
  }

  const pr: any = {};
  if (r.hasReviewers) pr.reviewers = r.reviewers;
  if (r.hasLabels) pr.labels = r.labels;
  if (r.hasDraft) pr.draft = r.draft;
  if (r.hasTemplate) pr.template = r.template;
  if (r.hasMilestone) pr.milestone = r.milestone;
  if (r.hasLinkedIssues) pr.linkedIssues = r.linkedIssues;
  if (Object.keys(pr).length > 0) {
    config.git.pr = pr;
  }

  return config;
});

// --- Helpers ---

let tmpDir: string;
let tmpFiles: string[] = [];

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versionings-prop14-'));
  tmpFiles = [];
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeTempConfig(obj: any): string {
  const filePath = path.join(tmpDir, `version-${tmpFiles.length}.json`);
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
  tmpFiles.push(filePath);
  return filePath;
}

// --- Property 14: Extended configuration validation ---

describe('Property 14: Extended configuration validation', () => {

  test('valid extended configs always pass validation', () => {
    fc.assert(
      fc.property(arbValidExtendedConfig, (configObj: any) => {
        const filePath = writeTempConfig(configObj);
        const result = loadAndValidateConfig(filePath);
        expect(result).toBeDefined();
        expect(result.git.platform).toBe(configObj.git.platform);
        expect(result.git.url).toBe(configObj.git.url);
      }),
      { numRuns: 100 },
    );
  });

  test('invalid platform values always fail validation', () => {
    fc.assert(
      fc.property(arbInvalidPlatform, (platform: string) => {
        const configObj = {
          git: { platform, url: 'https://example.com/org/repo.git' },
        };
        const filePath = writeTempConfig(configObj);
        try {
          loadAndValidateConfig(filePath);
          throw new Error('Expected VersioningsError');
        } catch (err: any) {
          expect(err).toBeInstanceOf(VersioningsError);
          expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
        }
      }),
      { numRuns: 100 },
    );
  });

  test('self-hosted platforms without apiUrl always fail validation', () => {
    fc.assert(
      fc.property(arbSelfHostedPlatform, (platform: string) => {
        const configObj = {
          git: { platform, url: 'https://example.com/org/repo.git' },
        };
        const filePath = writeTempConfig(configObj);
        try {
          loadAndValidateConfig(filePath);
          throw new Error('Expected VersioningsError');
        } catch (err: any) {
          expect(err).toBeInstanceOf(VersioningsError);
          expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
        }
      }),
      { numRuns: 20 },
    );
  });

  test('apiUrl must start with http:// or https://', () => {
    fc.assert(
      fc.property(arbInvalidApiUrl, (apiUrl: string) => {
        const configObj = {
          git: {
            platform: 'github',
            url: 'https://github.com/org/repo.git',
            apiUrl,
          },
        };
        const filePath = writeTempConfig(configObj);
        try {
          loadAndValidateConfig(filePath);
          throw new Error('Expected VersioningsError');
        } catch (err: any) {
          expect(err).toBeInstanceOf(VersioningsError);
          expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
        }
      }),
      { numRuns: 50 },
    );
  });

  test('api.timeout must be integer in [1000, 120000]', () => {
    fc.assert(
      fc.property(
        fc.oneof(arbInvalidTimeoutLow, arbInvalidTimeoutHigh),
        (timeout: number) => {
          const configObj = {
            git: {
              platform: 'github',
              url: 'https://github.com/org/repo.git',
              api: { timeout },
            },
          };
          const filePath = writeTempConfig(configObj);
          try {
            loadAndValidateConfig(filePath);
            throw new Error('Expected VersioningsError');
          } catch (err: any) {
            expect(err).toBeInstanceOf(VersioningsError);
            expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  test('config without new sections passes validation (backward compatibility)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('github', 'bitbucket'),
        fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0),
        (platform: string, url: string) => {
          const configObj = { git: { platform, url } };
          const filePath = writeTempConfig(configObj);
          const result = loadAndValidateConfig(filePath);
          expect(result).toBeDefined();
          expect(result.git.platform).toBe(platform);
          expect(result.git.auth).toBeUndefined();
          expect(result.git.api).toBeUndefined();
          expect(result.git.apiUrl).toBeUndefined();
        },
      ),
      { numRuns: 50 },
    );
  });
});
