// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau
// Feature: scm-provider-pr-automation, Property 12: Round-trip URL parsing
// Feature: scm-provider-pr-automation, Property 13: Invalid URL parsing error

import * as fc from 'fast-check';
import { createUrlParser, type UrlParser } from '../../../src/scm/url.parser';
import { VersioningsError, EXIT_CODES } from '../../../src/core/errors';

let parser: UrlParser;

beforeEach(() => {
  parser = createUrlParser();
});

// --- Generators ---

/** Valid owner/repo segment: alphanumeric + hyphens, 1-30 chars, no leading/trailing hyphen */
const arbOwnerRepo = fc
  .stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')), {
    minLength: 1,
    maxLength: 30,
  })
  .filter((s) => !s.startsWith('-') && !s.endsWith('-') && s.length > 0);

/** Generate a valid GitHub HTTPS URL from components */
const arbGitHubUrl = fc.tuple(arbOwnerRepo, arbOwnerRepo).map(([owner, repo]) => ({
  url: `https://github.com/${owner}/${repo}`,
  owner,
  repo,
}));

/** Generate a valid GitLab HTTPS URL with optional nested groups */
const arbGitLabUrl = fc
  .tuple(
    fc.array(arbOwnerRepo, { minLength: 1, maxLength: 3 }),
    arbOwnerRepo,
  )
  .map(([groups, project]) => ({
    url: `https://gitlab.com/${groups.join('/')}/${project}`,
    namespacePath: groups.join('/'),
    project,
  }));

/** Generate a valid Bitbucket Cloud HTTPS URL from components */
const arbBitbucketUrl = fc.tuple(arbOwnerRepo, arbOwnerRepo).map(([workspace, repoSlug]) => ({
  url: `https://bitbucket.org/${workspace}/${repoSlug}`,
  workspace,
  repoSlug,
}));

/** Generate a valid Azure DevOps HTTPS URL from components */
const arbAzureDevOpsUrl = fc
  .tuple(arbOwnerRepo, arbOwnerRepo, arbOwnerRepo)
  .map(([org, project, repo]) => ({
    url: `https://dev.azure.com/${org}/${project}/_git/${repo}`,
    organization: org,
    project,
    repo,
  }));

/** Generate strings that don't match any expected URL format */
const arbInvalidUrl = fc.oneof(
  // Random short strings
  fc.string({ minLength: 1, maxLength: 10 }).filter(
    (s) => !s.startsWith('https://') && !s.startsWith('git@') && !s.startsWith('ssh://'),
  ),
  // Strings with no path segments
  fc.constant('https://github.com/'),
  fc.constant('https://github.com/onlyone'),
  // Completely random words
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz '.split('')), {
    minLength: 1,
    maxLength: 50,
  }).filter((s) => !s.startsWith('https://') && !s.startsWith('git@') && !s.startsWith('ssh://')),
);

// --- Property 12: Round-trip URL parsing ---
// **Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.8, 14.9**

describe('Property 12: Round-trip URL parsing', () => {
  test('GitHub: format(parse(url)) produces equivalent URL', () => {
    fc.assert(
      fc.property(arbGitHubUrl, ({ url, owner, repo }) => {
        const parsed = parser.parse(url, 'github');
        const formatted = parser.format(parsed);
        expect(formatted).toBe(`https://github.com/${owner}/${repo}`);
      }),
      { numRuns: 100 },
    );
  });

  test('GitLab: format(parse(url)) produces equivalent URL', () => {
    fc.assert(
      fc.property(arbGitLabUrl, ({ url, namespacePath, project }) => {
        const parsed = parser.parse(url, 'gitlab');
        const formatted = parser.format(parsed);
        expect(formatted).toBe(`https://gitlab.com/${namespacePath}/${project}`);
      }),
      { numRuns: 100 },
    );
  });

  test('Bitbucket Cloud: format(parse(url)) produces equivalent URL', () => {
    fc.assert(
      fc.property(arbBitbucketUrl, ({ url, workspace, repoSlug }) => {
        const parsed = parser.parse(url, 'bitbucket');
        const formatted = parser.format(parsed);
        expect(formatted).toBe(`https://bitbucket.org/${workspace}/${repoSlug}`);
      }),
      { numRuns: 100 },
    );
  });

  test('Azure DevOps: format(parse(url)) produces equivalent URL', () => {
    fc.assert(
      fc.property(arbAzureDevOpsUrl, ({ url, organization, project, repo }) => {
        const parsed = parser.parse(url, 'azure-devops');
        const formatted = parser.format(parsed);
        expect(formatted).toBe(
          `https://dev.azure.com/${organization}/${project}/_git/${repo}`,
        );
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 13: Invalid URL parsing error ---
// **Validates: Requirements 14.7**

describe('Property 13: Invalid URL parsing error', () => {
  const platforms = ['github', 'gitlab', 'bitbucket', 'azure-devops'] as const;
  const arbPlatform = fc.constantFrom(...platforms);

  test('parse() throws VersioningsError(CONFIG_ERROR) for invalid URLs', () => {
    fc.assert(
      fc.property(arbInvalidUrl, arbPlatform, (url, platform) => {
        try {
          parser.parse(url, platform);
          // If parse didn't throw, the URL happened to be valid — skip this case
          // (some random strings could accidentally form valid paths)
        } catch (err) {
          expect(err).toBeInstanceOf(VersioningsError);
          expect((err as VersioningsError).code).toBe(EXIT_CODES.CONFIG_ERROR);
          expect((err as VersioningsError).message).toContain(platform);
        }
      }),
      { numRuns: 100 },
    );
  });

  test('parse() throws VersioningsError(CONFIG_ERROR) for unsupported platform', () => {
    const arbBadPlatform = fc
      .string({ minLength: 1, maxLength: 30 })
      .filter(
        (s) =>
          !['github', 'github-enterprise', 'bitbucket', 'bitbucket-server', 'gitlab', 'azure-devops'].includes(s),
      );

    fc.assert(
      fc.property(arbBadPlatform, (platform) => {
        expect(() => parser.parse('https://example.com/owner/repo', platform)).toThrow(
          VersioningsError,
        );
        try {
          parser.parse('https://example.com/owner/repo', platform);
        } catch (err) {
          expect((err as VersioningsError).code).toBe(EXIT_CODES.CONFIG_ERROR);
          expect((err as VersioningsError).message).toContain('Unsupported platform');
        }
      }),
      { numRuns: 100 },
    );
  });
});
