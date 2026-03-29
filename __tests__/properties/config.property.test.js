/* Versioning automation tool, 2018-present */
// Feature: enterprise-readiness, Property 8: Config validation by JSON Schema

const fc = require('fast-check');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { loadAndValidateConfig } = require('../../config.validator');
const { EXIT_CODES, VersioningsError } = require('../../errors');

// --- Generators ---

/**
 * arbValidConfig: generates config objects that match version.schema.json
 * Required: git.platform ∈ {github, bitbucket}, git.url non-empty string
 * Optional: git.pr.target non-empty string
 */
const arbValidConfig = fc
  .record({
    platform: fc.constantFrom('github', 'bitbucket'),
    url: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
    hasPrTarget: fc.boolean(),
    prTarget: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
  })
  .map(({ platform, url, hasPrTarget, prTarget }) => {
    const config = { git: { platform, url } };
    if (hasPrTarget) {
      config.git.pr = { target: prTarget };
    }
    return config;
  });

/**
 * arbInvalidConfig: generates config objects that do NOT match version.schema.json.
 * Strategies: missing git, missing platform, missing url, invalid platform value,
 * extra top-level properties.
 */
const arbInvalidConfig = fc.oneof(
  // 1. Missing git entirely
  fc.record({
    extra: fc.string({ minLength: 1, maxLength: 50 }),
  }).map(({ extra }) => ({ notGit: extra })),

  // 2. git present but missing platform
  fc.string({ minLength: 1, maxLength: 200 })
    .filter((s) => s.trim().length > 0)
    .map((url) => ({ git: { url } })),

  // 3. git present but missing url
  fc.constantFrom('github', 'bitbucket')
    .map((platform) => ({ git: { platform } })),

  // 4. Invalid platform value (not in enum)
  fc.string({ minLength: 1, maxLength: 50 })
    .filter((s) => s !== 'github' && s !== 'bitbucket')
    .map((platform) => ({
      git: {
        platform,
        url: 'https://example.com/repo.git',
      },
    })),

  // 5. Extra top-level properties (additionalProperties: false)
  fc.record({
    platform: fc.constantFrom('github', 'bitbucket'),
    url: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
    extraKey: fc.string({ minLength: 1, maxLength: 30 }),
  }).map(({ platform, url, extraKey }) => ({
    git: { platform, url },
    extraProp: extraKey,
  }))
);

// --- Helpers ---

let tmpDir;
let tmpFiles = [];

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versionings-prop-'));
  tmpFiles = [];
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeTempConfig(obj) {
  const filePath = path.join(tmpDir, `version-${tmpFiles.length}.json`);
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
  tmpFiles.push(filePath);
  return filePath;
}

// --- Property 8: Config validation by JSON Schema ---

describe('Property 8: Config validation by JSON Schema', () => {
  // Validates: Requirements 5.1, 5.2

  test('valid configs always return a config object (no throw)', () => {
    fc.assert(
      fc.property(arbValidConfig, (configObj) => {
        const filePath = writeTempConfig(configObj);
        const result = loadAndValidateConfig(filePath);

        // Must return an object
        expect(result).toBeDefined();
        expect(typeof result).toBe('object');

        // Must preserve the platform and url from input
        expect(result.git.platform).toBe(configObj.git.platform);
        expect(result.git.url).toBe(configObj.git.url);

        // Must have merged defaults
        expect(result.git.remote).toBe('origin');
        expect(result.git.pr).toBeDefined();
        expect(typeof result.git.pr.target).toBe('string');
      }),
      { numRuns: 100 }
    );
  });

  test('invalid configs always throw VersioningsError(CONFIG_ERROR) with validationErrors', () => {
    fc.assert(
      fc.property(arbInvalidConfig, (configObj) => {
        const filePath = writeTempConfig(configObj);

        try {
          loadAndValidateConfig(filePath);
          // Should not reach here
          throw new Error('Expected VersioningsError to be thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(VersioningsError);
          expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
          expect(err.details).toBeDefined();
          expect(Array.isArray(err.details.validationErrors)).toBe(true);
          expect(err.details.validationErrors.length).toBeGreaterThan(0);

          // Each validation error must contain the path to the invalid field
          for (const ve of err.details.validationErrors) {
            expect(ve).toHaveProperty('path');
            expect(ve).toHaveProperty('message');
            expect(typeof ve.path).toBe('string');
            expect(typeof ve.message).toBe('string');
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
