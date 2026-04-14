// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau
// Feature: core-ux-config-cli, Property 12, 13, 14: Provenance and output properties

import * as fc from 'fast-check';
import { createReporter } from '../../../src/core/reporter';
import type { DoctorCheck, ValidateResult, DryRunPlan } from '../../../src/core/reporter';
import type { ConfigProvenance } from '../../../src/config/config.merger';

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*m/;

// --- Generators ---

const arbStatus = fc.constantFrom<'pass' | 'fail' | 'warn'>('pass', 'fail', 'warn');

const arbDoctorCheck: fc.Arbitrary<DoctorCheck> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 60 }).filter((s) => s.trim().length > 0),
  status: arbStatus,
  found: fc.string({ minLength: 1, maxLength: 80 }).filter((s) => s.trim().length > 0),
  expected: fc.option(
    fc.string({ minLength: 1, maxLength: 80 }).filter((s) => s.trim().length > 0),
    { nil: undefined },
  ),
});

const arbDoctorChecks = fc.array(arbDoctorCheck, { minLength: 1, maxLength: 10 });

const arbValidateResult: fc.Arbitrary<ValidateResult> = fc.record({
  valid: fc.boolean(),
  checks: fc.array(
    fc.record({
      name: fc.string({ minLength: 1, maxLength: 60 }).filter((s) => s.trim().length > 0),
      status: arbStatus,
      details: fc.string({ minLength: 1, maxLength: 100 }),
    }),
    { minLength: 0, maxLength: 8 },
  ),
  provenance: fc.constant({} as ConfigProvenance),
});

const arbDryRunPlan: fc.Arbitrary<DryRunPlan> = fc.record({
  dryRun: fc.constant(true as const),
  currentVersion: fc.stringOf(
    fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.'),
    { minLength: 3, maxLength: 15 },
  ).filter((s) => /^\d/.test(s)),
  nextVersion: fc.stringOf(
    fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.'),
    { minLength: 3, maxLength: 15 },
  ).filter((s) => /^\d/.test(s)),
  semver: fc.constantFrom('patch', 'minor', 'major', 'prepatch', 'preminor', 'premajor', 'prerelease'),
  branch: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  tag: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  commitMessage: fc.string({ minLength: 1, maxLength: 200 }),
  pullRequestUrl: fc.oneof(
    fc.constant(null),
    fc.string({ minLength: 5, maxLength: 200 }).filter((s) => s.trim().length > 0),
  ),
  steps: fc.array(fc.string({ minLength: 1, maxLength: 100 }), { minLength: 1, maxLength: 10 }),
});

/**
 * Arbitrary for safe provenance keys — dot-separated lowercase alpha segments.
 */
const arbProvenanceKey = fc
  .array(
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), {
      minLength: 1,
      maxLength: 12,
    }),
    { minLength: 1, maxLength: 4 },
  )
  .map((segs) => segs.join('.'));

const arbLeafValue: fc.Arbitrary<string | number | boolean> = fc.oneof(
  fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  fc.integer({ min: -100000, max: 100000 }),
  fc.boolean(),
);

const arbSourceName = fc.constantFrom(
  'defaults',
  'version.json',
  '.versioningsrc',
  '.versioningsrc.json',
  '.versioningsrc.yml',
  'package.json#versionings',
  'env',
  'cli',
);

/**
 * Arbitrary for ConfigProvenance with 1-8 leaf fields.
 */
const arbProvenance: fc.Arbitrary<ConfigProvenance> = fc
  .array(
    fc.tuple(arbProvenanceKey, arbLeafValue, arbSourceName),
    { minLength: 1, maxLength: 8 },
  )
  .map((entries) => {
    const prov: ConfigProvenance = {};
    for (const [key, value, source] of entries) {
      prov[key] = { value, source };
    }
    return prov;
  });

// --- Property 12: Doctor output completeness ---

/**
 * **Validates: Requirements 11.2**
 *
 * For any set of DoctorCheck[], the output SHALL contain for each check:
 * status (pass/fail/warn), name, and found value.
 */
describe('Property 12: Doctor output completeness', () => {
  test('human-readable output contains status, name, and found for each check', () => {
    const reporter = createReporter({ json: false });

    fc.assert(
      fc.property(arbDoctorChecks, (checks) => {
        const output = reporter.reportDoctor(checks);
        // Strip ANSI for content matching
        const clean = output.replace(/\x1b\[[0-9;]*m/g, '');

        for (const check of checks) {
          // Name must appear
          expect(clean).toContain(check.name);
          // Found value must appear
          expect(clean).toContain(check.found);
          // Status indicator: ✓ for pass, ⚠ for warn, ✗ for fail
          // (in raw output with ANSI stripped, these symbols should be present)
          if (check.status === 'pass') {
            expect(clean).toContain('✓');
          } else if (check.status === 'warn') {
            expect(clean).toContain('⚠');
          } else {
            expect(clean).toContain('✗');
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  test('JSON output contains status, name, and found for each check', () => {
    const reporter = createReporter({ json: true });

    fc.assert(
      fc.property(arbDoctorChecks, (checks) => {
        const output = reporter.reportDoctor(checks);
        const parsed = JSON.parse(output) as DoctorCheck[];

        expect(parsed).toHaveLength(checks.length);
        for (let i = 0; i < checks.length; i++) {
          expect(parsed[i].status).toBe(checks[i].status);
          expect(parsed[i].name).toBe(checks[i].name);
          expect(parsed[i].found).toBe(checks[i].found);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 13: JSON output validity ---

/**
 * **Validates: Requirements 7.4, 11.5**
 *
 * For any result of validate, doctor, plan, release with --json flag,
 * stdout SHALL contain exactly one valid JSON object, terminated by newline,
 * without ANSI escape sequences.
 */
describe('Property 13: JSON output validity', () => {
  const reporter = createReporter({ json: true });

  test('reportValidation JSON: one valid JSON, newline-terminated, no ANSI', () => {
    fc.assert(
      fc.property(arbValidateResult, (result) => {
        const output = reporter.reportValidation(result);
        expect(output.endsWith('\n')).toBe(true);
        const body = output.slice(0, -1);
        expect(() => JSON.parse(body)).not.toThrow();
        expect(ANSI_PATTERN.test(output)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  test('reportDoctor JSON: one valid JSON, newline-terminated, no ANSI', () => {
    fc.assert(
      fc.property(arbDoctorChecks, (checks) => {
        const output = reporter.reportDoctor(checks);
        expect(output.endsWith('\n')).toBe(true);
        const body = output.slice(0, -1);
        expect(() => JSON.parse(body)).not.toThrow();
        expect(ANSI_PATTERN.test(output)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  test('reportDryRun JSON: one valid JSON, newline-terminated, no ANSI', () => {
    fc.assert(
      fc.property(arbDryRunPlan, (plan) => {
        const output = reporter.reportDryRun(plan);
        expect(output.endsWith('\n')).toBe(true);
        const body = output.slice(0, -1);
        expect(() => JSON.parse(body)).not.toThrow();
        expect(ANSI_PATTERN.test(output)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  test('reportProvenance JSON: one valid JSON, newline-terminated, no ANSI', () => {
    fc.assert(
      fc.property(arbProvenance, (provenance) => {
        const output = reporter.reportProvenance(provenance);
        expect(output.endsWith('\n')).toBe(true);
        const body = output.slice(0, -1);
        expect(() => JSON.parse(body)).not.toThrow();
        expect(ANSI_PATTERN.test(output)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 14: Config Provenance in print-config ---

/**
 * **Validates: Requirements 15.1, 15.4**
 *
 * For any config loaded from N sources, --print-config output SHALL contain
 * for each leaf field: value and source. With --json, output SHALL be valid
 * JSON with value and source fields.
 */
describe('Property 14: Config Provenance in print-config', () => {
  test('human-readable output contains value and source for each leaf field', () => {
    const reporter = createReporter({ json: false });

    fc.assert(
      fc.property(arbProvenance, (provenance) => {
        const output = reporter.reportProvenance(provenance);
        const clean = output.replace(/\x1b\[[0-9;]*m/g, '');

        const paths = Object.keys(provenance);
        for (const fieldPath of paths) {
          const entry = provenance[fieldPath];
          const valStr = typeof entry.value === 'object' && entry.value !== null
            ? JSON.stringify(entry.value)
            : String(entry.value);

          // Field path must appear
          expect(clean).toContain(fieldPath);
          // Value must appear
          expect(clean).toContain(valStr);
          // Source must appear
          expect(clean).toContain(entry.source);
        }
      }),
      { numRuns: 100 },
    );
  });

  test('JSON output contains value and source for each leaf field', () => {
    const reporter = createReporter({ json: true });

    fc.assert(
      fc.property(arbProvenance, (provenance) => {
        const output = reporter.reportProvenance(provenance);
        const parsed = JSON.parse(output) as ConfigProvenance;

        const paths = Object.keys(provenance);
        for (const fieldPath of paths) {
          expect(parsed[fieldPath]).toBeDefined();
          expect(parsed[fieldPath].value).toEqual(provenance[fieldPath].value);
          expect(parsed[fieldPath].source).toBe(provenance[fieldPath].source);
        }
      }),
      { numRuns: 100 },
    );
  });

  test('JSON print-config output is valid JSON with value and source structure', () => {
    const reporter = createReporter({ json: true });

    fc.assert(
      fc.property(arbProvenance, (provenance) => {
        const output = reporter.reportProvenance(provenance);
        // Valid JSON, newline-terminated, no ANSI
        expect(output.endsWith('\n')).toBe(true);
        const body = output.slice(0, -1);
        const parsed = JSON.parse(body);
        expect(ANSI_PATTERN.test(output)).toBe(false);

        // Every field has value and source
        for (const key of Object.keys(parsed)) {
          expect(parsed[key]).toHaveProperty('value');
          expect(parsed[key]).toHaveProperty('source');
          expect(typeof parsed[key].source).toBe('string');
        }
      }),
      { numRuns: 100 },
    );
  });
});
