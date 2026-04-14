// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau
// Feature: core-ux-config-cli, Property 11: Operation log structure

import * as fc from 'fast-check';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createOperationLog, OperationLogEntry } from '../../../src/core/operation.log';

// --- Helpers ---

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'oplog-prop-'));
}

function rmrf(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Replicates the sanitization logic from operation.log.ts
 * to deterministically verify filenames.
 */
function sanitizeForFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-');
}

// --- Generators ---

/** Arbitrary for valid semver type strings */
const arbSemverType = fc.constantFrom(
  'patch', 'minor', 'major', 'prepatch', 'preminor', 'premajor', 'prerelease',
);

/** Arbitrary for semver-like version strings (e.g. "1.2.3", "0.0.1-beta.1") */
const arbVersion = fc.tuple(
  fc.nat({ max: 99 }),
  fc.nat({ max: 99 }),
  fc.nat({ max: 99 }),
  fc.option(
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
      minLength: 1,
      maxLength: 8,
    }),
    { nil: undefined },
  ),
).map(([major, minor, patch, pre]) =>
  pre ? `${major}.${minor}.${patch}-${pre}` : `${major}.${minor}.${patch}`,
);

/** Arbitrary for ISO 8601 timestamps via real Date objects */
const arbTimestamp = fc.date({
  min: new Date('2020-01-01T00:00:00.000Z'),
  max: new Date('2030-12-31T23:59:59.999Z'),
}).map((d) => d.toISOString());

/** Arbitrary for non-empty branch-like strings */
const arbBranch = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789/-_.'.split('')),
  { minLength: 1, maxLength: 40 },
);

/** Arbitrary for non-empty tag-like strings */
const arbTag = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_.'.split('')),
  { minLength: 1, maxLength: 30 },
);

/** Arbitrary for RollbackStep objects */
const arbStep = fc.record({
  type: fc.constantFrom(
    'npm_version_bump', 'branch_created', 'tag_created', 'committed', 'pushed',
  ),
  meta: fc.dictionary(
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), {
      minLength: 1,
      maxLength: 10,
    }),
    fc.oneof(fc.string({ maxLength: 20 }), fc.integer(), fc.boolean()),
    { minKeys: 0, maxKeys: 3 },
  ),
});

/** Arbitrary for a complete OperationLogEntry */
const arbEntry: fc.Arbitrary<OperationLogEntry> = fc.tuple(
  arbTimestamp,
  arbSemverType,
  arbVersion,
  arbVersion,
  arbBranch,
  arbTag,
  fc.array(arbStep, { minLength: 0, maxLength: 5 }),
  fc.constantFrom('success' as const, 'failed' as const),
).chain(([timestamp, semver, version, previousVersion, branch, tag, steps, result]) => {
  if (result === 'failed') {
    return fc.record({
      code: fc.integer({ min: 1, max: 9 }),
      message: fc.string({ minLength: 1, maxLength: 50 }),
    }).map((error) => ({
      schemaVersion: 1 as const,
      timestamp,
      semver,
      version,
      previousVersion,
      branch,
      tag,
      steps,
      result,
      error,
    }));
  }
  return fc.constant({
    schemaVersion: 1 as const,
    timestamp,
    semver,
    version,
    previousVersion,
    branch,
    tag,
    steps,
    result,
  });
});

// --- Property 11: Operation log structure ---

/**
 * **Validates: Requirements 10.5, 10.7**
 *
 * For any pipeline result (success or failed), the saved log SHALL:
 * (a) have filename matching <ISO-timestamp>-<semver>-<version>.json
 * (b) contain schemaVersion: 1
 * (c) contain all required fields (timestamp, semver, version, previousVersion, steps, result)
 * (d) be valid JSON
 */
describe('Property 11: Operation log structure', () => {
  test('saved log has correct filename, schemaVersion, required fields, and valid JSON', async () => {
    await fc.assert(
      fc.asyncProperty(arbEntry, async (entry) => {
        const tmpDir = makeTmpDir();
        try {
          const log = createOperationLog(tmpDir);
          const savedPath = await log.save(entry);
          const filename = path.basename(savedPath);

          // (a) Filename matches <sanitized-timestamp>-<sanitized-semver>-<sanitized-version>.json
          const expectedTs = entry.timestamp.replace(/[:.]/g, '-');
          const expectedSemver = sanitizeForFilename(entry.semver);
          const expectedVersion = sanitizeForFilename(entry.version);
          const expectedFilename = `${expectedTs}-${expectedSemver}-${expectedVersion}.json`;
          expect(filename).toBe(expectedFilename);

          // (d) File content is valid JSON
          const raw = fs.readFileSync(savedPath, 'utf8');
          const parsed = JSON.parse(raw);

          // (b) Contains schemaVersion: 1
          expect(parsed.schemaVersion).toBe(1);

          // (c) Contains all required fields
          expect(parsed).toHaveProperty('timestamp', entry.timestamp);
          expect(parsed).toHaveProperty('semver', entry.semver);
          expect(parsed).toHaveProperty('version', entry.version);
          expect(parsed).toHaveProperty('previousVersion', entry.previousVersion);
          expect(parsed).toHaveProperty('steps');
          expect(Array.isArray(parsed.steps)).toBe(true);
          expect(parsed).toHaveProperty('result');
          expect(['success', 'failed']).toContain(parsed.result);
        } finally {
          rmrf(tmpDir);
        }
      }),
      { numRuns: 100 },
    );
  });
});
