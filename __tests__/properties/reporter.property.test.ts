/* Versioning automation tool, 2018-present */

import * as fc from 'fast-check';
import { createReporter } from '../../reporter';
import type { PipelineResult, DryRunPlan } from '../../reporter';
import { EXIT_CODES, VersioningsError } from '../../errors';

const exitCodeValues = Object.values(EXIT_CODES);

const arbPipelineResult: fc.Arbitrary<PipelineResult> = fc.record({
  success: fc.constant(true as const),
  version: fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '-'), { minLength: 3, maxLength: 20 }).filter((s) => /^\d/.test(s)),
  previousVersion: fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '-'), { minLength: 3, maxLength: 20 }).filter((s) => /^\d/.test(s)),
  semver: fc.constantFrom('patch', 'minor', 'major', 'prepatch', 'preminor', 'premajor', 'prerelease'),
  branch: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  tag: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  pullRequestUrl: fc.oneof(fc.constant(null), fc.string({ minLength: 5, maxLength: 200 }).filter((s) => s.trim().length > 0)),
  exitCode: fc.constant(0),
});

const arbVersioningsError = fc.record({
  code: fc.constantFrom(...exitCodeValues.filter((c) => c !== 0)),
  message: fc.string({ minLength: 1, maxLength: 200 }),
  details: fc.oneof(
    fc.constant(null),
    fc.dictionary(
      fc.string({ minLength: 1, maxLength: 20 }).filter((s) => /^[a-zA-Z]/.test(s)),
      fc.oneof(fc.string({ maxLength: 50 }), fc.integer(), fc.boolean())
    )
  ),
}).map(({ code, message, details }) => new VersioningsError(code, message, details));

const arbDryRunPlan: fc.Arbitrary<DryRunPlan> = fc.record({
  dryRun: fc.constant(true as const),
  currentVersion: fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.'), { minLength: 3, maxLength: 15 }).filter((s) => /^\d/.test(s)),
  nextVersion: fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.'), { minLength: 3, maxLength: 15 }).filter((s) => /^\d/.test(s)),
  semver: fc.constantFrom('patch', 'minor', 'major', 'prepatch', 'preminor', 'premajor', 'prerelease'),
  branch: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  tag: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  commitMessage: fc.string({ minLength: 1, maxLength: 200 }),
  pullRequestUrl: fc.oneof(fc.constant(null), fc.string({ minLength: 5, maxLength: 200 }).filter((s) => s.trim().length > 0)),
  steps: fc.array(fc.string({ minLength: 1, maxLength: 100 }), { minLength: 1, maxLength: 10 }),
});

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*m/;

describe('Property 10: JSON output field completeness', () => {
  const reporter = createReporter({ json: true });

  test('success output contains all required fields', () => {
    fc.assert(
      fc.property(arbPipelineResult, (result) => {
        const output = reporter.reportSuccess(result);
        const parsed = JSON.parse(output);
        expect(parsed).toHaveProperty('success', true);
        expect(parsed).toHaveProperty('version', result.version);
        expect(parsed).toHaveProperty('previousVersion', result.previousVersion);
        expect(parsed).toHaveProperty('semver', result.semver);
        expect(parsed).toHaveProperty('branch', result.branch);
        expect(parsed).toHaveProperty('tag', result.tag);
        expect(parsed).toHaveProperty('pullRequestUrl');
        expect(parsed.pullRequestUrl).toBe(result.pullRequestUrl);
        expect(parsed).toHaveProperty('exitCode', result.exitCode);
      }),
      { numRuns: 100 }
    );
  });

  test('error output contains success(false), exitCode, and error object with code/message/details', () => {
    fc.assert(
      fc.property(arbVersioningsError, (error) => {
        const output = reporter.reportError(error);
        const parsed = JSON.parse(output);
        expect(parsed.success).toBe(false);
        expect(typeof parsed.exitCode).toBe('number');
        expect(parsed.exitCode).toBe(error.code);
        expect(parsed).toHaveProperty('error');
        expect(typeof parsed.error.code).toBe('string');
        expect(typeof parsed.error.message).toBe('string');
        expect(parsed.error.message).toBe(error.message);
        expect(parsed.error).toHaveProperty('details');
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property 11: JSON output cleanliness', () => {
  const reporter = createReporter({ json: true });

  test('success JSON output is exactly one JSON object ending with newline, no ANSI', () => {
    fc.assert(
      fc.property(arbPipelineResult, (result) => {
        const output = reporter.reportSuccess(result);
        expect(output.endsWith('\n')).toBe(true);
        const body = output.slice(0, -1);
        expect(() => JSON.parse(body)).not.toThrow();
        expect(ANSI_PATTERN.test(output)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  test('error JSON output is exactly one JSON object ending with newline, no ANSI', () => {
    fc.assert(
      fc.property(arbVersioningsError, (error) => {
        const output = reporter.reportError(error);
        expect(output.endsWith('\n')).toBe(true);
        const body = output.slice(0, -1);
        expect(() => JSON.parse(body)).not.toThrow();
        expect(ANSI_PATTERN.test(output)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  test('dry-run JSON output is exactly one JSON object ending with newline, no ANSI', () => {
    fc.assert(
      fc.property(arbDryRunPlan, (plan) => {
        const output = reporter.reportDryRun(plan);
        expect(output.endsWith('\n')).toBe(true);
        const body = output.slice(0, -1);
        expect(() => JSON.parse(body)).not.toThrow();
        expect(ANSI_PATTERN.test(output)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property 12: Round-trip JSON output', () => {
  const reporter = createReporter({ json: true });

  test('success JSON output survives round-trip parse/stringify/parse', () => {
    fc.assert(
      fc.property(arbPipelineResult, (result) => {
        const output = reporter.reportSuccess(result);
        const first = JSON.parse(output);
        const roundTripped = JSON.parse(JSON.stringify(first));
        expect(roundTripped).toEqual(first);
      }),
      { numRuns: 100 }
    );
  });

  test('error JSON output survives round-trip parse/stringify/parse', () => {
    fc.assert(
      fc.property(arbVersioningsError, (error) => {
        const output = reporter.reportError(error);
        const first = JSON.parse(output);
        const roundTripped = JSON.parse(JSON.stringify(first));
        expect(roundTripped).toEqual(first);
      }),
      { numRuns: 100 }
    );
  });

  test('dry-run JSON output survives round-trip parse/stringify/parse', () => {
    fc.assert(
      fc.property(arbDryRunPlan, (plan) => {
        const output = reporter.reportDryRun(plan);
        const first = JSON.parse(output);
        const roundTripped = JSON.parse(JSON.stringify(first));
        expect(roundTripped).toEqual(first);
      }),
      { numRuns: 100 }
    );
  });
});
