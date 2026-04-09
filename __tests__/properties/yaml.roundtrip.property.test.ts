// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau
// Feature: core-ux-config-cli, Property 7: Round-trip YAML configuration

import * as fc from 'fast-check';
import { parseYaml, serializeYaml } from '../../yaml.parser';

// --- Generators ---

/**
 * Arbitrary for YAML-safe leaf values: strings, numbers, booleans.
 * Strings are filtered to avoid values that js-yaml interprets
 * as non-string types (e.g. "true", "null", "1.5") and to avoid
 * characters that break YAML round-trip (control chars, leading/trailing whitespace).
 */
const arbYamlSafeString = fc
  .stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _-./'.split('')), {
    minLength: 1,
    maxLength: 80,
  })
  .filter((s) => {
    const trimmed = s.trim();
    if (trimmed.length === 0) return false;
    // Exclude strings that js-yaml would parse as non-string scalars
    const lower = trimmed.toLowerCase();
    if (['true', 'false', 'yes', 'no', 'on', 'off', 'null', 'undefined', 'nan', 'inf', '-inf', '.inf', '-.inf', '.nan'].includes(lower)) return false;
    // Exclude pure numeric strings
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return false;
    // Exclude strings with leading/trailing whitespace (would be trimmed)
    if (s !== trimmed) return false;
    return true;
  });

const arbLeafValue: fc.Arbitrary<string | number | boolean> = fc.oneof(
  arbYamlSafeString,
  fc.integer({ min: -1000000, max: 1000000 }),
  fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true })
    .filter((n) => Number.isFinite(n)),
  fc.boolean(),
);

/**
 * Arbitrary for YAML-safe object keys (valid identifiers).
 */
const arbKey = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
  { minLength: 1, maxLength: 20 },
);

/**
 * Arbitrary for nested config objects with strings, numbers, booleans,
 * and nested objects up to 3 levels deep.
 */
const arbConfigObject: fc.Arbitrary<Record<string, any>> = fc.letrec((tie) => ({
  leaf: arbLeafValue,
  node: fc.dictionary(arbKey, fc.oneof(
    { weight: 3, arbitrary: tie('leaf') },
    { weight: 1, arbitrary: tie('nested') },
  ), { minKeys: 1, maxKeys: 6 }),
  nested: fc.dictionary(arbKey, fc.oneof(
    { weight: 4, arbitrary: tie('leaf') },
    { weight: 1, arbitrary: fc.dictionary(arbKey, tie('leaf'), { minKeys: 1, maxKeys: 4 }) },
  ), { minKeys: 1, maxKeys: 5 }),
})).node;

// --- Property 7: Round-trip YAML configuration ---

/**
 * **Validates: Requirements 13.2, 4.4**
 *
 * For any valid config object, parseYaml(serializeYaml(config)) should
 * deeply equal the original. This must hold for all data types used in
 * Config_Schema: strings, numbers, booleans, and nested objects.
 */
describe('Property 7: Round-trip YAML configuration', () => {

  test('for any valid config object, parseYaml(serializeYaml(config)) deeply equals the original', () => {
    fc.assert(
      fc.property(arbConfigObject, (config) => {
        const yamlStr = serializeYaml(config);
        const parsed = parseYaml(yamlStr, 'roundtrip-test.yml');
        expect(parsed).toEqual(config);
      }),
      { numRuns: 100 },
    );
  });

  test('round-trip preserves nested structure depth', () => {
    fc.assert(
      fc.property(arbConfigObject, (config) => {
        const yamlStr = serializeYaml(config);
        const parsed = parseYaml(yamlStr, 'depth-test.yml');

        // Verify all keys at every level are preserved
        function checkKeys(original: Record<string, any>, result: Record<string, any>): void {
          expect(Object.keys(result).sort()).toEqual(Object.keys(original).sort());
          for (const key of Object.keys(original)) {
            if (typeof original[key] === 'object' && original[key] !== null) {
              expect(typeof result[key]).toBe('object');
              checkKeys(original[key], result[key]);
            }
          }
        }
        checkKeys(config, parsed);
      }),
      { numRuns: 100 },
    );
  });

  test('serializeYaml always produces a non-empty string for non-empty objects', () => {
    fc.assert(
      fc.property(arbConfigObject, (config) => {
        const yamlStr = serializeYaml(config);
        expect(typeof yamlStr).toBe('string');
        expect(yamlStr.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });
});
