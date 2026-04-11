// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import * as fc from 'fast-check';
import { createReporter } from '../../src/core/reporter';
import type { PipelineResult } from '../../src/core/reporter';

/**
 * Property 3: Reporter JSON включает operationId и totalDurationMs
 *
 * Для любого PipelineResult с полями operationId (строка UUID v4) и totalDurationMs (число >= 0),
 * вызов reportSuccess() в JSON-режиме SHALL формировать JSON-строку, содержащую оба поля
 * с исходными значениями.
 *
 * **Validates: Requirements 2.4, 4.5, 14.1, 14.2**
 */

const arbPipelineResultWithObservability: fc.Arbitrary<PipelineResult> = fc.record({
  success: fc.constant(true as const),
  version: fc.stringOf(
    fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '-'),
    { minLength: 3, maxLength: 20 }
  ).filter((s) => /^\d/.test(s)),
  previousVersion: fc.stringOf(
    fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '-'),
    { minLength: 3, maxLength: 20 }
  ).filter((s) => /^\d/.test(s)),
  semver: fc.constantFrom('patch', 'minor', 'major', 'prepatch', 'preminor', 'premajor', 'prerelease'),
  branch: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  tag: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  pullRequestUrl: fc.oneof(
    fc.constant(null),
    fc.string({ minLength: 5, maxLength: 200 }).filter((s) => s.trim().length > 0)
  ),
  exitCode: fc.constant(0),
  operationId: fc.uuid(),
  totalDurationMs: fc.nat(),
});

describe('Feature: operational-hardening, Property 3: Reporter JSON включает operationId и totalDurationMs', () => {
  const reporter = createReporter({ json: true });

  test('reportSuccess() in JSON mode includes operationId and totalDurationMs with original values', () => {
    fc.assert(
      fc.property(arbPipelineResultWithObservability, (result) => {
        const output = reporter.reportSuccess(result);
        const parsed = JSON.parse(output);

        expect(parsed).toHaveProperty('operationId', result.operationId);
        expect(parsed).toHaveProperty('totalDurationMs', result.totalDurationMs);
      }),
      { numRuns: 100 }
    );
  });
});
