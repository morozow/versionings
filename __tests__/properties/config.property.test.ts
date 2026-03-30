/* Versioning automation tool, 2018-present */
// Feature: enterprise-readiness, Property 8: Config validation by JSON Schema

import * as fc from 'fast-check';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { loadAndValidateConfig } from '../../config.validator';
import { EXIT_CODES, VersioningsError } from '../../errors';

// --- Generators ---

const arbValidConfig = fc
  .record({
    platform: fc.constantFrom('github', 'bitbucket'),
    url: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
    hasPrTarget: fc.boolean(),
    prTarget: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
  })
  .map(({ platform, url, hasPrTarget, prTarget }) => {
    const config: any = { git: { platform, url } };
    if (hasPrTarget) {
      config.git.pr = { target: prTarget };
    }
    return config;
  });

const arbInvalidConfig = fc.oneof(
  fc.record({
    extra: fc.string({ minLength: 1, maxLength: 50 }),
  }).map(({ extra }) => ({ notGit: extra })),
  fc.string({ minLength: 1, maxLength: 200 })
    .filter((s) => s.trim().length > 0)
    .map((url) => ({ git: { url } })),
  fc.constantFrom('github', 'bitbucket')
    .map((platform) => ({ git: { platform } })),
  fc.string({ minLength: 1, maxLength: 50 })
    .filter((s) => s !== 'github' && s !== 'bitbucket')
    .map((platform) => ({
      git: { platform, url: 'https://example.com/repo.git' },
    })),
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

let tmpDir: string;
let tmpFiles: string[] = [];

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versionings-prop-'));
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

// --- Property 8: Config validation by JSON Schema ---

describe('Property 8: Config validation by JSON Schema', () => {
  // Validates: Requirements 5.1, 5.2

  test('valid configs always return a config object (no throw)', () => {
    fc.assert(
      fc.property(arbValidConfig, (configObj: any) => {
        const filePath = writeTempConfig(configObj);
        const result = loadAndValidateConfig(filePath);
        expect(result).toBeDefined();
        expect(typeof result).toBe('object');
        expect(result.git.platform).toBe(configObj.git.platform);
        expect(result.git.url).toBe(configObj.git.url);
        expect(result.git.remote).toBe('origin');
        expect(result.git.pr).toBeDefined();
        expect(typeof result.git.pr.target).toBe('string');
      }),
      { numRuns: 100 }
    );
  });

  test('invalid configs always throw VersioningsError(CONFIG_ERROR) with validationErrors', () => {
    fc.assert(
      fc.property(arbInvalidConfig, (configObj: any) => {
        const filePath = writeTempConfig(configObj);
        try {
          loadAndValidateConfig(filePath);
          throw new Error('Expected VersioningsError to be thrown');
        } catch (err: any) {
          expect(err).toBeInstanceOf(VersioningsError);
          expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
          expect(err.details).toBeDefined();
          expect(Array.isArray(err.details.validationErrors)).toBe(true);
          expect(err.details.validationErrors.length).toBeGreaterThan(0);
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
