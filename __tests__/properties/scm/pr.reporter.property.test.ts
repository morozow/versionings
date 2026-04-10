// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

// Feature: scm-provider-pr-automation
// Property 11: JSON output completeness and compatibility
// Property 15: GitLab uses term "Merge Request"

import * as fc from 'fast-check';
import { createReporter } from '../../../src/core/reporter';
import type { PipelineResult } from '../../../src/core/reporter';
import type { PR_Result } from '../../../src/scm/scm.provider';

// --- Arbitraries ---

const arbPlatform = fc.constantFrom('github', 'github-enterprise', 'gitlab', 'bitbucket', 'bitbucket-server', 'azure-devops');

const arbPrStatus = fc.constantFrom('created' as const, 'fallback' as const, 'skipped' as const);

const arbPrResult: fc.Arbitrary<PR_Result> = fc.record({
  url: fc.webUrl(),
  number: fc.oneof(fc.constant(null), fc.integer({ min: 1, max: 99999 })),
  status: arbPrStatus,
  fallbackReason: fc.oneof(fc.constant(null), fc.constantFrom('no_token', 'api_error', 'network_error')),
  platform: arbPlatform,
  warnings: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 0, maxLength: 3 }),
});

const arbVersion = fc.stringOf(
  fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '-'),
  { minLength: 3, maxLength: 15 },
).filter((s) => /^\d/.test(s));

const arbSemver = fc.constantFrom('patch', 'minor', 'major', 'prepatch', 'preminor', 'premajor', 'prerelease');

const arbPipelineResultWithPR: fc.Arbitrary<PipelineResult> = fc.record({
  success: fc.constant(true as const),
  version: arbVersion,
  previousVersion: arbVersion,
  semver: arbSemver,
  branch: fc.string({ minLength: 1, maxLength: 80 }).filter((s) => s.trim().length > 0),
  tag: fc.string({ minLength: 1, maxLength: 80 }).filter((s) => s.trim().length > 0),
  pullRequestUrl: fc.constant(null),
  exitCode: fc.constant(0),
  pullRequest: arbPrResult,
});

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*m/;

// --- Property 11: JSON output completeness and compatibility ---
// **Validates: Requirements 7.4, 13.3, 13.4**

describe('Property 11: JSON output completeness and compatibility', () => {
  const reporter = createReporter({ json: true });

  test('JSON output with pullRequest contains pullRequest object with all required fields', () => {
    fc.assert(
      fc.property(arbPipelineResultWithPR, (result) => {
        const output = reporter.reportSuccess(result);
        const parsed = JSON.parse(output);

        // pullRequest object must be present with required fields
        expect(parsed.pullRequest).toBeDefined();
        expect(typeof parsed.pullRequest.url).toBe('string');
        expect(parsed.pullRequest.number === null || typeof parsed.pullRequest.number === 'number').toBe(true);
        expect(typeof parsed.pullRequest.status).toBe('string');
        expect(parsed.pullRequest.fallbackReason === null || typeof parsed.pullRequest.fallbackReason === 'string').toBe(true);
        expect(typeof parsed.pullRequest.platform).toBe('string');
      }),
      { numRuns: 100 },
    );
  });

  test('pullRequestUrl alias equals pullRequest.url for backward compatibility', () => {
    fc.assert(
      fc.property(arbPipelineResultWithPR, (result) => {
        const output = reporter.reportSuccess(result);
        const parsed = JSON.parse(output);

        // pullRequestUrl must be present as alias
        expect(parsed).toHaveProperty('pullRequestUrl');
        expect(parsed.pullRequestUrl).toBe(parsed.pullRequest.url);
      }),
      { numRuns: 100 },
    );
  });

  test('JSON output is valid JSON with no ANSI sequences', () => {
    fc.assert(
      fc.property(arbPipelineResultWithPR, (result) => {
        const output = reporter.reportSuccess(result);
        expect(output.endsWith('\n')).toBe(true);
        const body = output.slice(0, -1);
        expect(() => JSON.parse(body)).not.toThrow();
        expect(ANSI_PATTERN.test(output)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});


// --- Property 15: GitLab uses term "Merge Request" ---
// **Validates: Requirements 2.5**

describe('Property 15: GitLab uses term "Merge Request"', () => {
  const reporter = createReporter({ json: false });

  const arbGitLabPrResult: fc.Arbitrary<PR_Result> = fc.record({
    url: fc.webUrl(),
    number: fc.oneof(fc.constant(null), fc.integer({ min: 1, max: 99999 })),
    status: fc.constantFrom('created' as const, 'fallback' as const),
    fallbackReason: fc.oneof(fc.constant(null), fc.constantFrom('no_token', 'api_error')),
    platform: fc.constant('gitlab'),
    warnings: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 0, maxLength: 3 }),
  });

  const arbGitLabResult: fc.Arbitrary<PipelineResult> = fc.record({
    success: fc.constant(true as const),
    version: arbVersion,
    previousVersion: arbVersion,
    semver: arbSemver,
    branch: fc.string({ minLength: 1, maxLength: 80 }).filter((s) => s.trim().length > 0),
    tag: fc.string({ minLength: 1, maxLength: 80 }).filter((s) => s.trim().length > 0),
    pullRequestUrl: fc.constant(null),
    exitCode: fc.constant(0),
    pullRequest: arbGitLabPrResult,
  });

  test('human-readable output for GitLab uses "Merge request" not "Pull request"', () => {
    fc.assert(
      fc.property(arbGitLabResult, (result) => {
        const output = reporter.reportSuccess(result);
        // GitLab output must use "Merge request" terminology
        expect(output).toContain('Merge request');
        expect(output).not.toContain('Pull request');
      }),
      { numRuns: 100 },
    );
  });

  test('GitLab PR_Result has platform === "gitlab"', () => {
    fc.assert(
      fc.property(arbGitLabResult, (result) => {
        expect(result.pullRequest!.platform).toBe('gitlab');
      }),
      { numRuns: 100 },
    );
  });
});
