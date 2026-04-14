// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau
// Feature: core-ux-config-cli, Property 3 & Property 6: Config merger properties

import * as fc from 'fast-check';
import { mergeConfigs, ConfigSource } from '../../../src/config/config.merger';

// --- Generators ---

/**
 * Arbitrary for safe object keys — lowercase alpha strings.
 * Excludes prototype-pollution keys.
 */
const arbKey = fc
  .stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), {
    minLength: 1,
    maxLength: 15,
  })
  .filter((k) => !['__proto__', 'constructor', 'prototype'].includes(k));

/**
 * Arbitrary for JSON-safe leaf values: strings, integers, booleans.
 * No undefined, NaN, Infinity, or complex types.
 */
const arbLeafValue: fc.Arbitrary<string | number | boolean> = fc.oneof(
  fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  fc.integer({ min: -100000, max: 100000 }),
  fc.boolean(),
);

/**
 * Arbitrary for a non-empty path of keys (1-3 segments).
 */
const arbPath = fc.array(arbKey, { minLength: 1, maxLength: 3 });

/**
 * Build a nested object from a dot-path and a leaf value.
 * e.g. (['git', 'platform'], 'github') => { git: { platform: 'github' } }
 */
function buildNestedObject(pathSegments: string[], value: any): Record<string, any> {
  if (pathSegments.length === 1) {
    return { [pathSegments[0]]: value };
  }
  return { [pathSegments[0]]: buildNestedObject(pathSegments.slice(1), value) };
}

/**
 * Resolve a value at a nested path in an object.
 */
function getAtPath(obj: Record<string, any>, pathSegments: string[]): any {
  let current: any = obj;
  for (const seg of pathSegments) {
    if (current === undefined || current === null || typeof current !== 'object') {
      return undefined;
    }
    current = current[seg];
  }
  return current;
}

/**
 * Arbitrary for nested config objects with strings, numbers, booleans,
 * and nested objects up to 2 levels deep. JSON-safe only.
 */
const arbConfigObject: fc.Arbitrary<Record<string, any>> = fc.letrec((tie) => ({
  leaf: arbLeafValue,
  node: fc.dictionary(arbKey, fc.oneof(
    { weight: 3, arbitrary: tie('leaf') },
    { weight: 1, arbitrary: tie('nested') },
  ), { minKeys: 1, maxKeys: 5 }),
  nested: fc.dictionary(arbKey, tie('leaf'), { minKeys: 1, maxKeys: 4 }),
})).node;

// --- Property 3: Priority and deep merge ---

/**
 * **Validates: Requirements 3.1, 3.2**
 *
 * For any two sources A (priority N) and B (priority N+1) with the same
 * leaf field but different values, merged config SHALL contain value from B.
 * Fields only in A SHALL be preserved (deep merge, not shallow replace).
 */
describe('Property 3: Priority and deep merge', () => {

  test('overlapping leaf field takes value from higher-priority source B', () => {
    const arbInput = fc.tuple(
      arbPath,                          // shared path (overlap)
      arbLeafValue,                     // value in A
      arbLeafValue,                     // value in B
      arbPath,                          // A-only path
      arbLeafValue,                     // A-only value
    ).filter(([sharedPath, valA, valB, aOnlyPath]) => {
      // Ensure A and B have different values for the shared field
      if (valA === valB) return false;
      // Ensure A-only path doesn't collide with shared path
      if (sharedPath.join('.') === aOnlyPath.join('.')) return false;
      return true;
    });

    fc.assert(
      fc.property(arbInput, ([sharedPath, valA, valB, aOnlyPath, aOnlyVal]) => {
        const aData = {
          ...buildNestedObject(sharedPath, valA),
          ...buildNestedObject(aOnlyPath, aOnlyVal),
        };
        const bData = buildNestedObject(sharedPath, valB);

        const sources: ConfigSource[] = [
          { name: 'sourceA', data: aData },
          { name: 'sourceB', data: bData },
        ];

        const { merged, provenance } = mergeConfigs(sources);

        // Overlapping field: B wins
        expect(getAtPath(merged, sharedPath)).toBe(valB);

        // A-only field: preserved
        expect(getAtPath(merged, aOnlyPath)).toBe(aOnlyVal);

        // Provenance: shared field source is B
        const sharedDotPath = sharedPath.join('.');
        expect(provenance[sharedDotPath]).toBeDefined();
        expect(provenance[sharedDotPath].value).toBe(valB);
        expect(provenance[sharedDotPath].source).toBe('sourceB');

        // Provenance: A-only field source is A
        const aOnlyDotPath = aOnlyPath.join('.');
        expect(provenance[aOnlyDotPath]).toBeDefined();
        expect(provenance[aOnlyDotPath].value).toBe(aOnlyVal);
        expect(provenance[aOnlyDotPath].source).toBe('sourceA');
      }),
      { numRuns: 100 },
    );
  });

  test('fields only in lower-priority source A are preserved after merge with B', () => {
    fc.assert(
      fc.property(arbConfigObject, arbConfigObject, (dataA, dataB) => {
        const sources: ConfigSource[] = [
          { name: 'low', data: dataA },
          { name: 'high', data: dataB },
        ];

        const { merged } = mergeConfigs(sources);

        // Every leaf in A that is NOT overridden by B should be in merged
        function checkPreserved(obj: Record<string, any>, bObj: Record<string, any>, mergedObj: Record<string, any>, path: string[]): void {
          for (const key of Object.keys(obj)) {
            const val = obj[key];
            if (val === undefined) continue;
            const currentPath = [...path, key];

            // If B has a scalar at this key, it replaces A's entire subtree — skip
            if (bObj && key in bObj && bObj[key] !== undefined) {
              const bVal = bObj[key];
              if (typeof bVal !== 'object' || bVal === null || Array.isArray(bVal)) {
                // B's scalar wins over A's value (object or scalar) — nothing to check
                continue;
              }
            }

            if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
              const bSub = bObj && typeof bObj[key] === 'object' && bObj[key] !== null ? bObj[key] : {};
              const mSub = mergedObj && typeof mergedObj[key] === 'object' ? mergedObj[key] : {};
              checkPreserved(val, bSub, mSub, currentPath);
            } else {
              // If B doesn't have this key at this level, A's value should be preserved
              if (bObj === undefined || bObj === null || !(key in bObj) || bObj[key] === undefined) {
                expect(getAtPath(merged, currentPath)).toBe(val);
              }
            }
          }
        }

        checkPreserved(dataA, dataB, merged, []);
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 6: Round-trip JSON config ---

/**
 * **Validates: Requirements 13.1**
 *
 * For any valid VersioningsConfig, JSON.parse(JSON.stringify(config))
 * SHALL deeply equal the original.
 */
describe('Property 6: Round-trip JSON config', () => {

  test('JSON.parse(JSON.stringify(config)) deeply equals the original for any config object', () => {
    fc.assert(
      fc.property(arbConfigObject, (config) => {
        const roundTripped = JSON.parse(JSON.stringify(config));
        expect(roundTripped).toEqual(config);
      }),
      { numRuns: 100 },
    );
  });

  test('round-trip preserves merged config from mergeConfigs', () => {
    fc.assert(
      fc.property(arbConfigObject, arbConfigObject, (dataA, dataB) => {
        const sources: ConfigSource[] = [
          { name: 'first', data: dataA },
          { name: 'second', data: dataB },
        ];

        const { merged } = mergeConfigs(sources);
        const roundTripped = JSON.parse(JSON.stringify(merged));
        expect(roundTripped).toEqual(merged);
      }),
      { numRuns: 100 },
    );
  });
});
