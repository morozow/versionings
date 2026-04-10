// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import * as fc from 'fast-check';
import { createReporter } from '../../reporter';
import type { PipelineResult } from '../../reporter';
import { VersioningsError, EXIT_CODES } from '../../errors';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const arbStrategyName = fc.constantFrom(
  'default',
  'trunk-based',
  'git-flow',
  'release-branch',
  'hotfix',
  'maintenance',
);

const arbPolicyCheckResult = fc.record({
  warnings: fc.array(
    fc.string({ minLength: 1, maxLength: 50 }),
    { minLength: 0, maxLength: 5 },
  ),
  errors: fc.array(
    fc.string({ minLength: 1, maxLength: 50 }),
    { minLength: 0, maxLength: 5 },
  ),
  protectionInfo: fc.constant(null),
});

const arbErrorMessage = fc.string({ minLength: 1, maxLength: 100 });

const arbBasePipelineResult: fc.Arbitrary<PipelineResult> = fc.record({
  success: fc.constant(true as const),
  version: fc.stringOf(
    fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.'),
    { minLength: 3, maxLength: 15 },
  ).filter((s) => /^\d/.test(s)),
  previousVersion: fc.stringOf(
    fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.'),
    { minLength: 3, maxLength: 15 },
  ).filter((s) => /^\d/.test(s)),
  semver: fc.constantFrom('patch', 'minor', 'major', 'prepatch', 'preminor', 'premajor', 'prerelease'),
  branch: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  tag: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  pullRequestUrl: fc.constant(null),
  exitCode: fc.constant(0),
});

// ---------------------------------------------------------------------------
// Feature: branching-policy-enforcement, Property 19: Reporter includes
// strategy and policyCheck in JSON output
// ---------------------------------------------------------------------------

// **Validates: Requirements 17.1, 17.3, 17.4**
describe('Property 19: Reporter includes strategy and policyCheck in JSON output', () => {
  const reporter = createReporter({ json: true });

  it('when strategy and policyCheck are present, JSON output contains both fields', () => {
    fc.assert(
      fc.property(
        arbBasePipelineResult,
        arbStrategyName,
        arbPolicyCheckResult,
        (baseResult, strategy, policyCheck) => {
          const result: PipelineResult = {
            ...baseResult,
            strategy,
            policyCheck,
          };

          const output = reporter.reportSuccess(result);
          const parsed = JSON.parse(output);

          // (a) strategy field is present with correct value
          expect(parsed).toHaveProperty('strategy', strategy);

          // (b) policyCheck field is present with warnings and errors arrays
          expect(parsed).toHaveProperty('policyCheck');
          expect(Array.isArray(parsed.policyCheck.warnings)).toBe(true);
          expect(Array.isArray(parsed.policyCheck.errors)).toBe(true);
          expect(parsed.policyCheck.warnings).toEqual(policyCheck.warnings);
          expect(parsed.policyCheck.errors).toEqual(policyCheck.errors);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('when strategy is absent, the strategy field is absent in JSON (backward compat)', () => {
    fc.assert(
      fc.property(
        arbBasePipelineResult,
        (baseResult) => {
          // No strategy field set
          const result: PipelineResult = { ...baseResult };

          const output = reporter.reportSuccess(result);
          const parsed = JSON.parse(output);

          // strategy field should NOT be present
          expect(parsed).not.toHaveProperty('strategy');
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: branching-policy-enforcement, Property 20: POLICY_VIOLATION error
// formatting
// ---------------------------------------------------------------------------

// **Validates: Requirements 14.4**
describe('Property 20: POLICY_VIOLATION error formatting', () => {
  const reporter = createReporter({ json: true });

  it('VersioningsError with POLICY_VIOLATION code produces JSON with error.code === "POLICY_VIOLATION" and exitCode === 10', () => {
    fc.assert(
      fc.property(
        arbErrorMessage,
        (message) => {
          const error = new VersioningsError(
            EXIT_CODES.POLICY_VIOLATION,
            message,
            null,
          );

          const output = reporter.reportError(error);
          const parsed = JSON.parse(output);

          // (a) error.code is the string 'POLICY_VIOLATION'
          expect(parsed.error.code).toBe('POLICY_VIOLATION');

          // (b) exitCode is 10
          expect(parsed.exitCode).toBe(10);

          // (c) success is false
          expect(parsed.success).toBe(false);

          // (d) message matches
          expect(parsed.error.message).toBe(message);
        },
      ),
      { numRuns: 100 },
    );
  });
});
