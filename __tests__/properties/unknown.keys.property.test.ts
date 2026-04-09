// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau
// Feature: core-ux-config-cli, Property 15 & 16: Unknown keys policy

import * as fc from 'fast-check';
import { validateWithProvenance, ValidationResult } from '../../config.validator';
import { EXIT_CODES, VersioningsError } from '../../errors';

// ---------------------------------------------------------------------------
// Known schema keys at each nesting level
// ---------------------------------------------------------------------------

const ROOT_KEYS = new Set(['git']);
const GIT_KEYS = new Set([
  'platform', 'url', 'remote', 'branchType', 'pr', 'limits', 'commit',
]);
const GIT_PR_KEYS = new Set(['target']);
const GIT_BRANCH_TYPE_KEYS = new Set(['version']);
const GIT_LIMITS_KEYS = new Set(['branchMaxCommentLength']);
const GIT_COMMIT_KEYS = new Set(['message']);
const GIT_COMMIT_MESSAGE_KEYS = new Set(['semver']);
const GIT_SEMVER_KEYS = new Set([
  'patch', 'prepatch', 'minor', 'preminor', 'premajor', 'major', 'prerelease',
]);

// Prototype-polluting keys to avoid
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype', 'toString', 'valueOf']);

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Safe key that doesn't collide with known schema keys or prototype keys. */
function arbSafeKey(knownKeys: Set<string>): fc.Arbitrary<string> {
  return fc.string({ minLength: 1, maxLength: 30 })
    .filter((s) =>
      /^[a-zA-Z][a-zA-Z0-9_]*$/.test(s) &&
      !knownKeys.has(s) &&
      !FORBIDDEN_KEYS.has(s)
    );
}

/** Arbitrary primitive value for unknown fields. */
const arbUnknownValue = fc.oneof(
  fc.string({ minLength: 0, maxLength: 50 }),
  fc.integer({ min: -1000, max: 1000 }),
  fc.boolean(),
);

/** Valid git platform. */
const arbPlatform = fc.constantFrom('github' as const, 'bitbucket' as const);

/** Non-empty URL string. */
const arbUrl = fc.string({ minLength: 1, maxLength: 200 })
  .filter((s) => s.trim().length > 0);

/** Source name for provenance. */
const arbSource = fc.constantFrom(
  'defaults', 'version.json', '.versioningsrc', '.versioningsrc.json',
  '.versioningsrc.yml', 'package.json#versionings', 'env', 'cli',
);

/**
 * Nesting level where an unknown key can be injected.
 * Each level maps to a dot-prefix and the set of known keys at that level.
 */
interface NestingLevel {
  prefix: string;
  knownKeys: Set<string>;
}

const NESTING_LEVELS: NestingLevel[] = [
  { prefix: '', knownKeys: ROOT_KEYS },
  { prefix: 'git', knownKeys: GIT_KEYS },
  { prefix: 'git.pr', knownKeys: GIT_PR_KEYS },
  { prefix: 'git.branchType', knownKeys: GIT_BRANCH_TYPE_KEYS },
  { prefix: 'git.limits', knownKeys: GIT_LIMITS_KEYS },
  { prefix: 'git.commit', knownKeys: GIT_COMMIT_KEYS },
  { prefix: 'git.commit.message', knownKeys: GIT_COMMIT_MESSAGE_KEYS },
  { prefix: 'git.commit.message.semver', knownKeys: GIT_SEMVER_KEYS },
];

/** Generate 1–3 unknown field injections at random nesting levels. */
const arbUnknownInjections = fc.array(
  fc.record({
    levelIdx: fc.integer({ min: 0, max: NESTING_LEVELS.length - 1 }),
    value: arbUnknownValue,
    source: arbSource,
  }),
  { minLength: 1, maxLength: 3 },
).chain((injections) => {
  // Generate unique keys for each injection at its level
  const keyArbs = injections.map((inj) =>
    arbSafeKey(NESTING_LEVELS[inj.levelIdx].knownKeys)
  );
  return fc.tuple(...keyArbs).map((keys) =>
    injections.map((inj, i) => ({
      ...inj,
      key: keys[i],
      level: NESTING_LEVELS[inj.levelIdx],
    }))
  );
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a valid base config with required fields. */
function buildBaseConfig(platform: string, url: string): Record<string, any> {
  return {
    git: {
      platform,
      url,
      remote: 'origin',
      branchType: { version: 'version' },
      pr: { target: 'master' },
      limits: { branchMaxCommentLength: 96 },
      commit: {
        message: {
          semver: {
            patch: 'Patch: v%s.',
            prepatch: 'Prepatch: v%s.',
            minor: 'Minor: v%s.',
            preminor: 'Preminor: v%s.',
            premajor: 'Premajor: v%s.',
            major: 'Major: v%s.',
            prerelease: 'Pre: v%s.',
          },
        },
      },
    },
  };
}

/** Build provenance for the base config. */
function buildBaseProvenance(platform: string, url: string): Record<string, { value: any; source: string }> {
  return {
    'git.platform': { value: platform, source: 'version.json' },
    'git.url': { value: url, source: 'version.json' },
    'git.remote': { value: 'origin', source: 'defaults' },
    'git.branchType.version': { value: 'version', source: 'defaults' },
    'git.pr.target': { value: 'master', source: 'defaults' },
    'git.limits.branchMaxCommentLength': { value: 96, source: 'defaults' },
  };
}

/**
 * Set a value at a dot-notation path in a nested object, creating
 * intermediate objects as needed.
 */
function setAtPath(obj: Record<string, any>, dotPath: string, value: any): void {
  const parts = dotPath.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current) || typeof current[parts[i]] !== 'object') {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

// ---------------------------------------------------------------------------
// Property 15: Unknown fields — warning in default mode
// ---------------------------------------------------------------------------

/**
 * **Validates: Requirements 16.1**
 *
 * For any config with fields not in Config_Schema, without --strict,
 * Config_Validator SHALL: (a) not throw, (b) include warnings listing
 * unknown fields with sources, (c) return valid ValidationResult.
 */
describe('Property 15: Unknown fields — warning in default mode', () => {

  test('unknown fields produce warnings without throwing', () => {
    fc.assert(
      fc.property(
        arbPlatform,
        arbUrl,
        arbUnknownInjections,
        (platform, url, injections) => {
          const config = buildBaseConfig(platform, url);
          const provenance = buildBaseProvenance(platform, url);

          // Deduplicate by full path to avoid collisions
          const seen = new Set<string>();
          const uniqueInjections = injections.filter((inj) => {
            const fullPath = inj.level.prefix
              ? `${inj.level.prefix}.${inj.key}`
              : inj.key;
            if (seen.has(fullPath)) return false;
            seen.add(fullPath);
            return true;
          });

          // Inject unknown fields
          const expectedPaths: string[] = [];
          const expectedSources: Record<string, string> = {};

          for (const inj of uniqueInjections) {
            const fullPath = inj.level.prefix
              ? `${inj.level.prefix}.${inj.key}`
              : inj.key;
            setAtPath(config, fullPath, inj.value);
            provenance[fullPath] = { value: inj.value, source: inj.source };
            expectedPaths.push(fullPath);
            expectedSources[fullPath] = inj.source;
          }

          // (a) SHALL not throw
          let result: ValidationResult;
          try {
            result = validateWithProvenance(config, provenance, false);
          } catch (err) {
            throw new Error(
              `Expected no throw in default mode, but got: ${err}`
            );
          }

          // (c) SHALL return valid ValidationResult
          expect(result.valid).toBe(true);

          // (b) SHALL include warnings listing unknown fields with sources
          const warningPaths = result.warnings.map((w) => w.path);
          for (const expectedPath of expectedPaths) {
            expect(warningPaths).toContain(expectedPath);
          }

          // Each warning should have the correct source from provenance
          for (const w of result.warnings) {
            if (expectedSources[w.path]) {
              expect(w.source).toBe(expectedSources[w.path]);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 16: Unknown fields — error in strict mode
// ---------------------------------------------------------------------------

/**
 * **Validates: Requirements 16.2**
 *
 * For any config with at least one unknown field, with --strict,
 * Config_Validator SHALL throw VersioningsError(CONFIG_ERROR) listing
 * unknown fields.
 */
describe('Property 16: Unknown fields — error in strict mode', () => {

  test('unknown fields throw VersioningsError(CONFIG_ERROR) in strict mode', () => {
    fc.assert(
      fc.property(
        arbPlatform,
        arbUrl,
        arbUnknownInjections,
        (platform, url, injections) => {
          const config = buildBaseConfig(platform, url);
          const provenance = buildBaseProvenance(platform, url);

          // Deduplicate by full path
          const seen = new Set<string>();
          const uniqueInjections = injections.filter((inj) => {
            const fullPath = inj.level.prefix
              ? `${inj.level.prefix}.${inj.key}`
              : inj.key;
            if (seen.has(fullPath)) return false;
            seen.add(fullPath);
            return true;
          });

          const expectedPaths: string[] = [];

          for (const inj of uniqueInjections) {
            const fullPath = inj.level.prefix
              ? `${inj.level.prefix}.${inj.key}`
              : inj.key;
            setAtPath(config, fullPath, inj.value);
            provenance[fullPath] = { value: inj.value, source: inj.source };
            expectedPaths.push(fullPath);
          }

          // SHALL throw VersioningsError(CONFIG_ERROR)
          try {
            validateWithProvenance(config, provenance, true);
            throw new Error(
              'Expected VersioningsError to be thrown in strict mode'
            );
          } catch (err: any) {
            if (err.message === 'Expected VersioningsError to be thrown in strict mode') {
              throw err;
            }
            expect(err).toBeInstanceOf(VersioningsError);
            expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);

            // Details should list unknown fields
            expect(err.details).toBeDefined();
            expect(Array.isArray(err.details.unknownFields)).toBe(true);
            expect(err.details.unknownFields.length).toBeGreaterThanOrEqual(1);

            // All injected unknown paths should appear in the error
            const reportedPaths = err.details.unknownFields.map(
              (f: any) => f.path
            );
            for (const expectedPath of expectedPaths) {
              expect(reportedPaths).toContain(expectedPath);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
