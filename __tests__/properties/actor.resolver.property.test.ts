// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import * as fc from 'fast-check';
import { detectCI, resolveCIActor } from '../../src/core/actor.resolver';

/**
 * CI indicator variables and their required trigger values.
 * BITBUCKET_BUILD_NUMBER triggers on any defined value (including empty string).
 */
const CI_INDICATORS: Array<{ key: string; triggerValue: string | null }> = [
  { key: 'CI', triggerValue: 'true' },
  { key: 'GITHUB_ACTIONS', triggerValue: 'true' },
  { key: 'GITLAB_CI', triggerValue: 'true' },
  { key: 'TF_BUILD', triggerValue: 'True' },
  { key: 'BITBUCKET_BUILD_NUMBER', triggerValue: null }, // any defined value triggers
];

/**
 * CI actor variables in priority order.
 */
const CI_ACTOR_VARS = [
  'GITHUB_ACTOR',
  'GITLAB_USER_LOGIN',
  'BUILD_REQUESTEDFOR',
  'BITBUCKET_STEP_TRIGGERER_UUID',
];

/**
 * Arbitrary: for a CI indicator variable, produce one of:
 *   - undefined (absent)
 *   - the exact trigger value
 *   - a wrong value (for value-sensitive indicators)
 *   - an arbitrary string (for BITBUCKET_BUILD_NUMBER, any value triggers)
 */
function arbIndicatorEntry(
  indicator: { key: string; triggerValue: string | null },
): fc.Arbitrary<[string, string | undefined]> {
  if (indicator.triggerValue === null) {
    // BITBUCKET_BUILD_NUMBER: absent or any string (including empty)
    return fc.oneof(
      fc.constant([indicator.key, undefined] as [string, string | undefined]),
      fc.string({ maxLength: 30 }).map((v) => [indicator.key, v] as [string, string | undefined]),
    );
  }
  // Value-sensitive indicator: absent, correct value, or wrong value
  return fc.oneof(
    fc.constant([indicator.key, undefined] as [string, string | undefined]),
    fc.constant([indicator.key, indicator.triggerValue] as [string, string | undefined]),
    fc
      .string({ minLength: 0, maxLength: 20 })
      .filter((v) => v !== indicator.triggerValue)
      .map((v) => [indicator.key, v] as [string, string | undefined]),
  );
}

/**
 * Arbitrary: for a CI actor variable, produce absent or an arbitrary string value.
 */
function arbActorEntry(key: string): fc.Arbitrary<[string, string | undefined]> {
  return fc.oneof(
    fc.constant([key, undefined] as [string, string | undefined]),
    fc.string({ maxLength: 50 }).map((v) => [key, v] as [string, string | undefined]),
  );
}

/**
 * Arbitrary: random noise env vars (unrelated keys) to test robustness.
 */
const arbNoiseEnv: fc.Arbitrary<Record<string, string>> = fc.dictionary(
  fc
    .string({ minLength: 1, maxLength: 20 })
    .filter(
      (k) =>
        !CI_INDICATORS.some((i) => i.key === k) &&
        !CI_ACTOR_VARS.includes(k) &&
        /^[A-Za-z_]/.test(k),
    ),
  fc.string({ maxLength: 30 }),
  { minKeys: 0, maxKeys: 5 },
);

/**
 * Build a full env arbitrary combining indicator vars, actor vars, and noise.
 */
const arbEnv: fc.Arbitrary<Record<string, string | undefined>> = fc
  .tuple(
    ...CI_INDICATORS.map(arbIndicatorEntry),
    ...CI_ACTOR_VARS.map(arbActorEntry),
    arbNoiseEnv,
  )
  .map((parts) => {
    const env: Record<string, string | undefined> = {};
    // First N entries are indicator tuples, next M are actor tuples, last is noise dict
    const indicatorCount = CI_INDICATORS.length;
    const actorCount = CI_ACTOR_VARS.length;

    for (let i = 0; i < indicatorCount + actorCount; i++) {
      const [key, value] = parts[i] as [string, string | undefined];
      if (value !== undefined) {
        env[key] = value;
      }
    }

    // Merge noise
    const noise = parts[indicatorCount + actorCount] as Record<string, string>;
    for (const [k, v] of Object.entries(noise)) {
      env[k] = v;
    }

    return env;
  });

/**
 * Oracle: compute expected detectCI result from env.
 */
function expectedDetectCI(env: Record<string, string | undefined>): boolean {
  return (
    env.CI === 'true' ||
    env.GITHUB_ACTIONS === 'true' ||
    env.GITLAB_CI === 'true' ||
    env.TF_BUILD === 'True' ||
    env.BITBUCKET_BUILD_NUMBER !== undefined
  );
}

/**
 * Oracle: compute expected resolveCIActor result from env.
 */
function expectedResolveCIActor(env: Record<string, string | undefined>): string | null {
  for (const key of CI_ACTOR_VARS) {
    if (env[key] !== undefined) return env[key]!;
  }
  return null;
}

/**
 * Property 4: Резолвинг Actor Metadata и CI Detection
 *
 * For any set of environment variables:
 * - detectCI() returns true ⟺ at least one CI indicator variable is present
 *   with its required value (CI=true, GITHUB_ACTIONS=true, GITLAB_CI=true,
 *   TF_BUILD=True, BITBUCKET_BUILD_NUMBER=<any defined value>)
 * - resolveCIActor() returns the value of the first found CI actor variable
 *   (GITHUB_ACTOR, GITLAB_USER_LOGIN, BUILD_REQUESTEDFOR,
 *   BITBUCKET_STEP_TRIGGERER_UUID) or null if none are present
 *
 * **Validates: Requirements 3.1, 3.2, 3.3**
 */
describe('Feature: operational-hardening, Property 4: Резолвинг Actor Metadata и CI Detection', () => {
  test('detectCI() returns true ⟺ at least one CI indicator variable is present with correct value', () => {
    fc.assert(
      fc.property(arbEnv, (env) => {
        const result = detectCI(env);
        const expected = expectedDetectCI(env);
        expect(result).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  test('resolveCIActor() returns the value of the first found CI actor variable or null', () => {
    fc.assert(
      fc.property(arbEnv, (env) => {
        const result = resolveCIActor(env);
        const expected = expectedResolveCIActor(env);
        expect(result).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  test('resolveCIActor() is independent of CI detection variables', () => {
    fc.assert(
      fc.property(
        // Generate env with only actor vars (no CI indicators)
        fc.tuple(...CI_ACTOR_VARS.map(arbActorEntry)).map((entries) => {
          const env: Record<string, string | undefined> = {};
          for (const [key, value] of entries) {
            if (value !== undefined) {
              env[key] = value;
            }
          }
          return env;
        }),
        (env) => {
          const result = resolveCIActor(env);
          const expected = expectedResolveCIActor(env);
          expect(result).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });
});
