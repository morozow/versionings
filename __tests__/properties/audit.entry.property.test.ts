// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import * as fc from 'fast-check';
import type { AuditEntry } from '../../src/core/operation.log';
import type { RollbackStep } from '../../src/core/rollback';
import type { ActorMetadata } from '../../src/core/actor.resolver';
import type { ActionTraceEntry } from '../../src/core/action.tracer';

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

/** Arbitrary for ISO 8601 timestamps */
const arbTimestamp = fc.date({
  min: new Date('2020-01-01T00:00:00.000Z'),
  max: new Date('2030-12-31T23:59:59.999Z'),
}).map((d) => d.toISOString());

/** Arbitrary for UUID v4 operationId */
const arbOperationId = fc.uuid();

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

/** Arbitrary for RollbackStep — meta values are JSON-safe primitives only */
const arbRollbackStep: fc.Arbitrary<RollbackStep> = fc.record({
  type: fc.constantFrom(
    'npm_version_bump', 'branch_created', 'tag_created', 'committed', 'pushed', 'branch_switched',
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

/** Arbitrary for ActorMetadata */
const arbActorMetadata: fc.Arbitrary<ActorMetadata> = fc.record({
  gitUserName: fc.string({ minLength: 1, maxLength: 30 }),
  gitUserEmail: fc.string({ minLength: 1, maxLength: 40 }),
  hostname: fc.stringOf(
    fc.char().filter((c) => /[a-zA-Z0-9.\-]/.test(c)),
    { minLength: 1, maxLength: 64 },
  ),
  ciActor: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: null }),
});

/** Arbitrary for ActionTraceEntry */
const arbActionTraceEntry: fc.Arbitrary<ActionTraceEntry> = fc.tuple(
  fc.constantFrom(
    'validate-input', 'check-git-status', 'check-remote', 'auto-bump',
    'compute-version', 'policy-check', 'artifact-check', 'npm-version-bump',
    'branch-create', 'tag-create', 'changelog-write', 'commit', 'push', 'pr-create',
  ),
  arbTimestamp,
  arbTimestamp,
  fc.nat({ max: 60000 }),
  fc.constantFrom('success' as const, 'failed' as const, 'skipped' as const),
).chain(([step, startedAt, endedAt, durationMs, status]) => {
  const base = { step, startedAt, endedAt, durationMs, status };
  if (status === 'failed') {
    return fc.string({ minLength: 1, maxLength: 100 }).map((error) => ({
      ...base,
      error,
    }));
  }
  return fc.constant(base);
});

/** Arbitrary for environment object */
const arbEnvironment = fc.record({
  nodeVersion: fc.string({ minLength: 1, maxLength: 20 }),
  cliVersion: arbVersion,
  os: fc.constantFrom('linux', 'darwin', 'win32'),
  ci: fc.boolean(),
});

/** Arbitrary for pullRequest object */
const arbPullRequest = fc.record({
  url: fc.webUrl(),
  number: fc.option(fc.nat({ max: 99999 }), { nil: null }),
  status: fc.constantFrom('open', 'merged', 'closed', 'created'),
});

/** Arbitrary for a complete AuditEntry with schemaVersion: 2 */
const arbAuditEntry: fc.Arbitrary<AuditEntry> = fc.tuple(
  arbTimestamp,
  arbOperationId,
  arbSemverType,
  arbVersion,
  arbVersion,
  arbBranch,
  arbTag,
  fc.array(arbRollbackStep, { minLength: 0, maxLength: 5 }),
  fc.constantFrom('success' as const, 'failed' as const),
  fc.option(arbActorMetadata, { nil: null }),
  fc.array(arbActionTraceEntry, { minLength: 0, maxLength: 5 }),
  fc.option(arbEnvironment, { nil: null }),
  fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: null }),
  fc.option(arbPullRequest, { nil: null }),
).chain(([
  timestamp, operationId, semver, version, previousVersion,
  branch, tag, steps, result, actor, trace, environment, command, pullRequest,
]) => {
  const base: AuditEntry = {
    schemaVersion: 2,
    timestamp,
    operationId,
    semver,
    version,
    previousVersion,
    branch,
    tag,
    steps,
    result,
    actor,
    trace,
    environment,
    command,
  };

  if (pullRequest !== null) {
    base.pullRequest = pullRequest;
  }

  if (result === 'failed') {
    return fc.record({
      code: fc.integer({ min: 1, max: 11 }),
      message: fc.string({ minLength: 1, maxLength: 50 }),
    }).map((error) => ({
      ...base,
      error,
    }));
  }

  return fc.constant(base);
});

// --- Property 5: Round-trip Audit Entry (schemaVersion: 2) ---

/**
 * Property 5: Round-trip Audit Entry (schemaVersion: 2)
 *
 * For any valid AuditEntry with schemaVersion: 2, serialization to JSON
 * (JSON.stringify) and subsequent deserialization (JSON.parse) SHALL produce
 * an object deeply equal to the original.
 *
 * **Validates: Requirements 5.6, 16.3**
 */
describe('Feature: operational-hardening, Property 5: Round-trip Audit Entry (schemaVersion: 2)', () => {
  test('JSON.parse(JSON.stringify(entry)) is deeply equal to the original', () => {
    fc.assert(
      fc.property(arbAuditEntry, (entry) => {
        const serialized = JSON.stringify(entry);
        const deserialized = JSON.parse(serialized) as AuditEntry;

        expect(deserialized).toEqual(entry);
        expect(deserialized.schemaVersion).toBe(2);
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 6: Backward compatibility schemaVersion 1 ---

import type { OperationLogEntry } from '../../src/core/operation.log';
import { normalizeToV2 } from '../../src/core/operation.log';

/** Arbitrary for a complete OperationLogEntry with schemaVersion: 1 */
const arbOperationLogEntryV1: fc.Arbitrary<OperationLogEntry> = fc.tuple(
  arbTimestamp,
  arbSemverType,
  arbVersion,
  arbVersion,
  arbBranch,
  arbTag,
  fc.array(arbRollbackStep, { minLength: 0, maxLength: 5 }),
  fc.constantFrom('success' as const, 'failed' as const),
  fc.option(arbPullRequest, { nil: null }),
).chain(([
  timestamp, semver, version, previousVersion,
  branch, tag, steps, result, pullRequest,
]) => {
  const base: OperationLogEntry = {
    schemaVersion: 1,
    timestamp,
    semver,
    version,
    previousVersion,
    branch,
    tag,
    steps,
    result,
  };

  if (pullRequest !== null) {
    base.pullRequest = pullRequest;
  }

  if (result === 'failed') {
    return fc.record({
      code: fc.integer({ min: 1, max: 11 }),
      message: fc.string({ minLength: 1, maxLength: 50 }),
    }).map((error) => ({
      ...base,
      error,
    }));
  }

  return fc.constant(base);
});

/**
 * Property 6: Backward compatibility schemaVersion 1
 *
 * For any valid OperationLogEntry with schemaVersion: 1, normalizeToV2()
 * SHALL succeed and fill missing v2 fields with defaults:
 * operationId → null, actor → null, trace → [], environment → null, command → null.
 * All original v1 fields SHALL be preserved unchanged.
 *
 * **Validates: Requirements 5.3, 16.4**
 */
describe('Feature: operational-hardening, Property 6: Backward compatibility schemaVersion 1', () => {
  test('normalizeToV2() fills missing v2 fields with defaults', () => {
    fc.assert(
      fc.property(arbOperationLogEntryV1, (v1Entry) => {
        const normalized = normalizeToV2(v1Entry);

        // v2 defaults are filled
        expect(normalized.operationId).toBeNull();
        expect(normalized.actor).toBeNull();
        expect(normalized.trace).toEqual([]);
        expect(normalized.environment).toBeNull();
        expect(normalized.command).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  test('normalizeToV2() preserves all original v1 fields', () => {
    fc.assert(
      fc.property(arbOperationLogEntryV1, (v1Entry) => {
        const normalized = normalizeToV2(v1Entry);

        // All original v1 fields are preserved
        expect(normalized.schemaVersion).toBe(1);
        expect(normalized.timestamp).toBe(v1Entry.timestamp);
        expect(normalized.semver).toBe(v1Entry.semver);
        expect(normalized.version).toBe(v1Entry.version);
        expect(normalized.previousVersion).toBe(v1Entry.previousVersion);
        expect(normalized.branch).toBe(v1Entry.branch);
        expect(normalized.tag).toBe(v1Entry.tag);
        expect(normalized.steps).toEqual(v1Entry.steps);
        expect(normalized.result).toBe(v1Entry.result);

        // Optional fields preserved when present
        if (v1Entry.error) {
          expect(normalized.error).toEqual(v1Entry.error);
        }
        if (v1Entry.pullRequest) {
          expect(normalized.pullRequest).toEqual(v1Entry.pullRequest);
        }
      }),
      { numRuns: 100 },
    );
  });

  test('normalizeToV2() is idempotent', () => {
    fc.assert(
      fc.property(arbOperationLogEntryV1, (v1Entry) => {
        const first = normalizeToV2(v1Entry);
        const second = normalizeToV2(first as any);

        expect(second).toEqual(first);
      }),
      { numRuns: 100 },
    );
  });
});
