// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau
// Feature: version-intelligence-release-narrative
// Property 19: JSON Schema validation for conventionalCommits and changelog sections
// Property 20: Backward compatibility of configuration and exit codes

import * as fc from 'fast-check';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { loadAndValidateConfig } from '../../config.validator';
import { EXIT_CODES, VersioningsError } from '../../errors';

// ── Helpers ─────────────────────────────────────────────────────────────────

let tmpDir: string;
let tmpFiles: string[] = [];

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versionings-cc-prop-'));
  tmpFiles = [];
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeTempConfig(obj: any): string {
  const filePath = path.join(tmpDir, `version-${tmpFiles.length}.json`);
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
  tmpFiles.push(filePath);
  return filePath;
}

/** Minimal valid git section required by schema */
const BASE_GIT = {
  platform: 'github' as const,
  url: 'https://github.com/org/repo.git',
};

// ── Arbitraries ─────────────────────────────────────────────────────────────

/** Safe non-empty alphanumeric string for keys and values */
const arbSafeString = fc.stringOf(
  fc.mapToConstant(
    { num: 26, build: (v) => String.fromCharCode(97 + v) },
    { num: 10, build: (v) => String.fromCharCode(48 + v) },
    { num: 1, build: () => '-' },
  ),
  { minLength: 1, maxLength: 30 },
);

/** Valid bump level enum values for conventionalCommits.types */
const arbBumpLevel = fc.constantFrom('major', 'minor', 'patch', 'none');

/** Valid fallbackBump values (including null) */
const arbFallbackBump = fc.constantFrom('patch', 'minor', 'major', null);

/** Generate a valid conventionalCommits config section */
const arbValidCC = fc.record({
  hasEnabled: fc.boolean(),
  enabled: fc.boolean(),
  hasTypes: fc.boolean(),
  types: fc.dictionary(arbSafeString, arbBumpLevel, { minKeys: 0, maxKeys: 5 }),
  hasFallback: fc.boolean(),
  fallbackBump: arbFallbackBump,
}).map((r) => {
  const cc: any = {};
  if (r.hasEnabled) cc.enabled = r.enabled;
  if (r.hasTypes) cc.types = r.types;
  if (r.hasFallback) cc.fallbackBump = r.fallbackBump;
  return cc;
});

/** Generate a valid changelog config section */
const arbValidChangelog = fc.record({
  hasGroupTitles: fc.boolean(),
  groupTitles: fc.dictionary(
    arbSafeString,
    fc.stringOf(
      fc.mapToConstant(
        { num: 26, build: (v) => String.fromCharCode(97 + v) },
        { num: 26, build: (v) => String.fromCharCode(65 + v) },
        { num: 1, build: () => ' ' },
      ),
      { minLength: 1, maxLength: 40 },
    ),
    { minKeys: 0, maxKeys: 5 },
  ),
  hasExcludeTypes: fc.boolean(),
  excludeTypes: fc.array(arbSafeString, { minLength: 0, maxLength: 5 }),
  hasIncludeNonConventional: fc.boolean(),
  includeNonConventional: fc.boolean(),
  hasFile: fc.boolean(),
  file: fc.stringOf(
    fc.mapToConstant(
      { num: 26, build: (v) => String.fromCharCode(97 + v) },
      { num: 10, build: (v) => String.fromCharCode(48 + v) },
      { num: 1, build: () => '/' },
      { num: 1, build: () => '.' },
    ),
    { minLength: 1, maxLength: 100 },
  ),
  hasTemplate: fc.boolean(),
  template: fc.stringOf(
    fc.mapToConstant(
      { num: 26, build: (v) => String.fromCharCode(97 + v) },
      { num: 10, build: (v) => String.fromCharCode(48 + v) },
      { num: 1, build: () => '/' },
      { num: 1, build: () => '.' },
    ),
    { minLength: 1, maxLength: 100 },
  ),
}).map((r) => {
  const cl: any = {};
  if (r.hasGroupTitles) cl.groupTitles = r.groupTitles;
  if (r.hasExcludeTypes) cl.excludeTypes = r.excludeTypes;
  if (r.hasIncludeNonConventional) cl.includeNonConventional = r.includeNonConventional;
  if (r.hasFile) cl.file = r.file;
  if (r.hasTemplate) cl.template = r.template;
  return cl;
});

// ── Property 19: JSON Schema validation for conventionalCommits and changelog ──

describe('Property 19: JSON Schema validation for conventionalCommits and changelog sections', () => {
  /**
   * **Validates: Requirements 4.4, 4.5, 8.5, 8.6, 15.3**
   *
   * For any valid conventionalCommits and changelog config sections,
   * loadAndValidateConfig succeeds and returns a config with merged defaults.
   */
  test('valid conventionalCommits and changelog configs always pass validation', () => {
    fc.assert(
      fc.property(arbValidCC, arbValidChangelog, (cc, cl) => {
        const configObj: any = { git: { ...BASE_GIT } };
        if (Object.keys(cc).length > 0) configObj.conventionalCommits = cc;
        if (Object.keys(cl).length > 0) configObj.changelog = cl;

        const filePath = writeTempConfig(configObj);
        const result = loadAndValidateConfig(filePath);

        expect(result).toBeDefined();
        expect(result.git.platform).toBe('github');
        expect(result.conventionalCommits).toBeDefined();
        expect(result.changelog).toBeDefined();

        // Verify conventionalCommits defaults are applied
        expect(typeof result.conventionalCommits!.enabled).toBe('boolean');
        expect(result.conventionalCommits!.types).toBeDefined();
        expect(typeof result.conventionalCommits!.types).toBe('object');

        // Verify changelog defaults are applied
        expect(result.changelog!.groupTitles).toBeDefined();
        expect(Array.isArray(result.changelog!.excludeTypes)).toBe(true);
        expect(typeof result.changelog!.includeNonConventional).toBe('boolean');
      }),
      { numRuns: 100 },
    );
  });

  test('invalid conventionalCommits.types values always fail validation', () => {
    const arbInvalidBumpValue = fc.string({ minLength: 1, maxLength: 20 })
      .filter((s) => !['major', 'minor', 'patch', 'none'].includes(s) && s.trim().length > 0);

    fc.assert(
      fc.property(arbSafeString, arbInvalidBumpValue, (key, value) => {
        const configObj = {
          git: { ...BASE_GIT },
          conventionalCommits: {
            types: { [key]: value },
          },
        };
        const filePath = writeTempConfig(configObj);
        try {
          loadAndValidateConfig(filePath);
          throw new Error('Expected VersioningsError');
        } catch (err: any) {
          expect(err).toBeInstanceOf(VersioningsError);
          expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
        }
      }),
      { numRuns: 50 },
    );
  });

  test('invalid conventionalCommits.fallbackBump values always fail validation', () => {
    const arbInvalidFallback = fc.string({ minLength: 1, maxLength: 20 })
      .filter((s) => !['patch', 'minor', 'major'].includes(s) && s.trim().length > 0);

    fc.assert(
      fc.property(arbInvalidFallback, (fallback) => {
        const configObj = {
          git: { ...BASE_GIT },
          conventionalCommits: {
            fallbackBump: fallback,
          },
        };
        const filePath = writeTempConfig(configObj);
        try {
          loadAndValidateConfig(filePath);
          throw new Error('Expected VersioningsError');
        } catch (err: any) {
          expect(err).toBeInstanceOf(VersioningsError);
          expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
        }
      }),
      { numRuns: 50 },
    );
  });

  test('unknown keys in conventionalCommits section fail validation (additionalProperties: false)', () => {
    fc.assert(
      fc.property(
        arbSafeString.filter((s) => !['enabled', 'types', 'fallbackBump'].includes(s)),
        fc.string({ minLength: 1, maxLength: 20 }),
        (unknownKey, value) => {
          const configObj = {
            git: { ...BASE_GIT },
            conventionalCommits: {
              [unknownKey]: value,
            },
          };
          const filePath = writeTempConfig(configObj);
          try {
            loadAndValidateConfig(filePath);
            throw new Error('Expected VersioningsError');
          } catch (err: any) {
            expect(err).toBeInstanceOf(VersioningsError);
            expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  test('unknown keys in changelog section fail validation (additionalProperties: false)', () => {
    fc.assert(
      fc.property(
        arbSafeString.filter(
          (s) => !['template', 'groupTitles', 'excludeTypes', 'includeNonConventional', 'file'].includes(s),
        ),
        fc.string({ minLength: 1, maxLength: 20 }),
        (unknownKey, value) => {
          const configObj = {
            git: { ...BASE_GIT },
            changelog: {
              [unknownKey]: value,
            },
          };
          const filePath = writeTempConfig(configObj);
          try {
            loadAndValidateConfig(filePath);
            throw new Error('Expected VersioningsError');
          } catch (err: any) {
            expect(err).toBeInstanceOf(VersioningsError);
            expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  test('changelog.excludeTypes with empty strings fails validation', () => {
    const configObj = {
      git: { ...BASE_GIT },
      changelog: {
        excludeTypes: [''],
      },
    };
    const filePath = writeTempConfig(configObj);
    try {
      loadAndValidateConfig(filePath);
      throw new Error('Expected VersioningsError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
    }
  });

  test('changelog.groupTitles with empty string values fails validation', () => {
    const configObj = {
      git: { ...BASE_GIT },
      changelog: {
        groupTitles: { feat: '' },
      },
    };
    const filePath = writeTempConfig(configObj);
    try {
      loadAndValidateConfig(filePath);
      throw new Error('Expected VersioningsError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
    }
  });
});

// ── Property 20: Backward compatibility of configuration and exit codes ─────

describe('Property 20: Backward compatibility of configuration and exit codes', () => {
  /**
   * **Validates: Requirements 12.2, 15.4**
   *
   * Configs without conventionalCommits/changelog sections pass validation
   * (backward compatibility). EXIT_CODES 0-10 remain unchanged.
   */
  test('configs without conventionalCommits/changelog sections pass validation', () => {
    const arbPlatform = fc.constantFrom(
      'github', 'github-enterprise', 'bitbucket', 'bitbucket-server', 'gitlab', 'azure-devops',
    );
    const arbUrl = fc.constant('https://github.com/org/repo.git');

    fc.assert(
      fc.property(arbPlatform, arbUrl, (platform, url) => {
        const configObj: any = { git: { platform, url } };
        // Self-hosted platforms need apiUrl
        if (platform === 'github-enterprise' || platform === 'bitbucket-server') {
          configObj.git.apiUrl = 'https://git.corp.example.com/api';
        }

        const filePath = writeTempConfig(configObj);
        const result = loadAndValidateConfig(filePath);

        expect(result).toBeDefined();
        expect(result.git.platform).toBe(platform);
        expect(result.git.url).toBe(url);

        // Defaults for new sections should be applied
        expect(result.conventionalCommits).toBeDefined();
        expect(result.conventionalCommits!.enabled).toBe(true);
        expect(result.changelog).toBeDefined();
        expect(result.changelog!.includeNonConventional).toBe(false);
      }),
      { numRuns: 50 },
    );
  });

  test('old configs with existing git sections but no new sections work correctly', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('github', 'bitbucket'),
        fc.constant('https://github.com/org/repo.git'),
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
        (platform, url, prTarget) => {
          const configObj = {
            git: {
              platform,
              url,
              pr: { target: prTarget },
            },
          };
          const filePath = writeTempConfig(configObj);
          const result = loadAndValidateConfig(filePath);

          expect(result).toBeDefined();
          expect(result.git.platform).toBe(platform);
          expect(result.git.url).toBe(url);
          expect(result.git.pr.target).toBe(prTarget);

          // New sections get defaults
          expect(result.conventionalCommits!.types.feat).toBe('minor');
          expect(result.conventionalCommits!.types.fix).toBe('patch');
          expect(result.conventionalCommits!.fallbackBump).toBeNull();
          expect(result.changelog!.groupTitles.feat).toBe('Features');
          expect(result.changelog!.groupTitles.fix).toBe('Bug Fixes');
          expect(result.changelog!.excludeTypes).toEqual([]);
        },
      ),
      { numRuns: 50 },
    );
  });

  test('EXIT_CODES 0-10 are unchanged for backward compatibility', () => {
    // This is a deterministic check but validates Requirement 12.2
    expect(EXIT_CODES.SUCCESS).toBe(0);
    expect(EXIT_CODES.CONFIG_ERROR).toBe(1);
    expect(EXIT_CODES.DIRTY_TREE).toBe(2);
    expect(EXIT_CODES.INVALID_ARGS).toBe(3);
    expect(EXIT_CODES.ARTIFACT_CONFLICT).toBe(4);
    expect(EXIT_CODES.COMMAND_FAILED).toBe(5);
    expect(EXIT_CODES.NETWORK_ERROR).toBe(6);
    expect(EXIT_CODES.INCOMPLETE_ROLLBACK).toBe(7);
    expect(EXIT_CODES.NO_OPERATION).toBe(8);
    expect(EXIT_CODES.USER_CANCELLED).toBe(9);
    expect(EXIT_CODES.POLICY_VIOLATION).toBe(10);
    // New code 11 exists but doesn't affect 0-10
    expect(EXIT_CODES.NO_CONVENTIONAL_COMMITS).toBe(11);
  });

  test('EXIT_CODES object is frozen (immutable)', () => {
    expect(Object.isFrozen(EXIT_CODES)).toBe(true);
  });
});
