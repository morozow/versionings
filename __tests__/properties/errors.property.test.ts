// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau
// Feature: enterprise-readiness, Property 9: Exit codes and error format

import * as fc from 'fast-check';
import { EXIT_CODES, VersioningsError } from '../../errors';

const exitCodeValues = Object.values(EXIT_CODES);

const arbExitCode = fc.constantFrom(...exitCodeValues);
const arbMessage = fc.string({ minLength: 0, maxLength: 200 });
const arbDetails = fc.oneof(
  fc.constant(null),
  fc.record({
    type: fc.constantFrom('tag', 'branch', 'file'),
    name: fc.string({ minLength: 1, maxLength: 100 }),
    scope: fc.constantFrom('local', 'remote'),
  })
);

describe('Property 9: Exit codes and error format', () => {

  test('code is always in range 0-9 and is one of EXIT_CODES values', () => {
    fc.assert(
      fc.property(arbExitCode, arbMessage, arbDetails, (code, message, details) => {
        const err = new VersioningsError(code, message, details);
        expect(err.code).toBeGreaterThanOrEqual(0);
        expect(err.code).toBeLessThanOrEqual(9);
        expect(exitCodeValues).toContain(err.code);
      }),
      { numRuns: 100 }
    );
  });

  test('message is always a string', () => {
    fc.assert(
      fc.property(arbExitCode, arbMessage, arbDetails, (code, message, details) => {
        const err = new VersioningsError(code, message, details);
        expect(typeof err.message).toBe('string');
        expect(err.message).toBe(message);
      }),
      { numRuns: 100 }
    );
  });

  test('name is always VersioningsError', () => {
    fc.assert(
      fc.property(arbExitCode, arbMessage, arbDetails, (code, message, details) => {
        const err = new VersioningsError(code, message, details);
        expect(err.name).toBe('VersioningsError');
      }),
      { numRuns: 100 }
    );
  });

  test('instanceof Error is always true', () => {
    fc.assert(
      fc.property(arbExitCode, arbMessage, arbDetails, (code, message, details) => {
        const err = new VersioningsError(code, message, details);
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(VersioningsError);
      }),
      { numRuns: 100 }
    );
  });

  test('details is either null or the provided value', () => {
    fc.assert(
      fc.property(arbExitCode, arbMessage, arbDetails, (code, message, details) => {
        const err = new VersioningsError(code, message, details);
        if (details === null) {
          expect(err.details).toBeNull();
        } else {
          expect(err.details).toBe(details);
        }
      }),
      { numRuns: 100 }
    );
  });
});
