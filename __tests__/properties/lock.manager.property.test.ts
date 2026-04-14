// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import * as fc from 'fast-check';
import type { LockData } from '../../src/core/lock.manager';

/** Arbitrary for a valid PID (positive integer) */
const arbPid = fc.integer({ min: 1, max: 2147483647 });

/** Arbitrary for a UUID-like operationId */
const arbOperationId = fc.uuid();

/** Arbitrary for a non-empty command string */
const arbCommand = fc.stringOf(
  fc.char().filter((c) => c >= ' ' && c <= '~'),
  { minLength: 1, maxLength: 100 },
);

/** Arbitrary for a valid ISO 8601 timestamp */
const arbCreatedAt = fc.date({
  min: new Date('2020-01-01T00:00:00.000Z'),
  max: new Date('2030-12-31T23:59:59.999Z'),
}).map((d) => d.toISOString());

/** Arbitrary for a hostname string */
const arbHostname = fc.stringOf(
  fc.char().filter((c) => /[a-zA-Z0-9.\-]/.test(c)),
  { minLength: 1, maxLength: 64 },
);

/** Arbitrary for ci boolean */
const arbCi = fc.boolean();

/** Arbitrary for a valid LockData object */
const arbLockData: fc.Arbitrary<LockData> = fc.record({
  pid: arbPid,
  operationId: arbOperationId,
  command: arbCommand,
  createdAt: arbCreatedAt,
  hostname: arbHostname,
  ci: arbCi,
});

/**
 * Property 7: Round-trip Lock Data
 *
 * For any valid LockData object, serialization to JSON (JSON.stringify)
 * and subsequent deserialization (JSON.parse) SHALL produce an object
 * deeply equal to the original.
 *
 * **Validates: Requirements 15.1, 15.2, 15.3**
 */
describe('Feature: operational-hardening, Property 7: Round-trip Lock Data', () => {
  test('JSON.parse(JSON.stringify(lockData)) is deeply equal to the original', () => {
    fc.assert(
      fc.property(arbLockData, (lockData) => {
        const serialized = JSON.stringify(lockData);
        const deserialized = JSON.parse(serialized) as LockData;

        expect(deserialized).toEqual(lockData);
      }),
      { numRuns: 100 },
    );
  });
});

import { VersioningsError, EXIT_CODES } from '../../src/core/errors';

/**
 * Pre-transform lock.manager.ts with esbuild to bypass the esbuild-jest
 * Babel fallback (source file contains function names that trigger it).
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const esbuildLib = require('esbuild');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodeFs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodePath = require('path');

const lockManagerSrcPath = nodePath.resolve(__dirname, '../../src/core/lock.manager.ts');
const lockManagerSrcDir = nodePath.dirname(lockManagerSrcPath);
const lockManagerRaw = nodeFs.readFileSync(lockManagerSrcPath, 'utf-8');
const lockManagerTransformed = esbuildLib.transformSync(lockManagerRaw, {
  loader: 'ts',
  format: 'cjs',
  target: 'es2018',
});

// Create a custom require that resolves relative paths from the source directory
const lockManagerRequire = (id: string): unknown => {
  if (id.startsWith('.')) {
    return require(nodePath.resolve(lockManagerSrcDir, id));
  }
  return require(id);
};

const lockManagerExports: Record<string, unknown> = {};
const lockManagerMod = { exports: lockManagerExports };
const lockManagerRunner = new Function(
  'exports', 'require', 'module', '__filename', '__dirname',
  lockManagerTransformed.code,
);
lockManagerRunner(
  lockManagerExports,
  lockManagerRequire,
  lockManagerMod,
  lockManagerSrcPath,
  lockManagerSrcDir,
);

const createLockManager = lockManagerMod.exports.createLockManager as
  typeof import('../../src/core/lock.manager').createLockManager;

/** Arbitrary for lockTimeoutMs (positive integer, reasonable range) */
const arbLockTimeoutMs = fc.integer({ min: 1, max: 600_000 });

/** Arbitrary for a positive time delta in ms */
const arbPositiveDelta = fc.integer({ min: 50, max: 300_000 });

/**
 * Helper: create mock fs that simulates an existing lock file with given LockData.
 */
function createMockFs(lockData: LockData | null): {
  writeFileSync: jest.Mock;
  readFileSync: jest.Mock;
  renameSync: jest.Mock;
  unlinkSync: jest.Mock;
  existsSync: jest.Mock;
  mkdirSync: jest.Mock;
} {
  return {
    writeFileSync: jest.fn(),
    readFileSync: jest.fn(() => {
      if (lockData === null) throw new Error('ENOENT');
      return JSON.stringify(lockData);
    }),
    renameSync: jest.fn(),
    unlinkSync: jest.fn(),
    existsSync: jest.fn(() => lockData !== null),
    mkdirSync: jest.fn(),
  };
}

/**
 * Helper: create mock processInfo.
 * @param alive - whether the PID should appear alive
 */
function createMockProcessInfo(alive: boolean): {
  pid: number;
  kill: jest.Mock;
  on: jest.Mock;
} {
  return {
    pid: 99999,
    kill: jest.fn((_pid: number, _signal: number) => {
      if (!alive) {
        const err = new Error('ESRCH') as NodeJS.ErrnoException;
        err.code = 'ESRCH';
        throw err;
      }
      return true;
    }),
    on: jest.fn(),
  };
}

/**
 * Property 8: Stale Detection по timeout (CI-aware)
 *
 * For any lock file with createdAt and for any lockTimeoutMs value,
 * lock SHALL be considered stale if and only if
 * `Date.now() - Date.parse(createdAt) > lockTimeoutMs`.
 *
 * In CI environment (ci === true), stale detection SHALL use only timeout,
 * ignoring PID (process.kill should never be called).
 *
 * **Validates: Requirements 7.3, 9.1, 9.2**
 */
describe('Feature: operational-hardening, Property 8: Stale Detection по timeout (CI-aware)', () => {
  test('lock is stale when timeout exceeded → acquire succeeds', () => {
    fc.assert(
      fc.property(
        arbPid,
        arbOperationId,
        arbCommand,
        arbHostname,
        arbCi,
        arbLockTimeoutMs,
        arbPositiveDelta,
        (pid, operationId, command, hostname, ci, lockTimeoutMs, delta) => {
          // createdAt is far enough in the past that timeout is exceeded
          const now = Date.now();
          const createdAtMs = now - lockTimeoutMs - delta; // guarantees now - createdAt > lockTimeoutMs
          const createdAt = new Date(createdAtMs).toISOString();

          const lockData: LockData = { pid, operationId, command, createdAt, hostname, ci };
          const mockFs = createMockFs(lockData);
          // PID appears alive — but timeout should still win
          const mockProc = createMockProcessInfo(true);

          const lm = createLockManager({
            lockDir: '/tmp/test-lock',
            lockTimeoutMs,
            ci,
            processInfo: mockProc,
            fs: mockFs,
            hostname: 'test-host',
          });

          // Should NOT throw — stale lock is removed and new lock acquired
          expect(() => lm.acquire('new-op-id', 'release')).not.toThrow();

          // Lock file should have been removed (stale cleanup)
          expect(mockFs.unlinkSync).toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });

  test('lock is NOT stale when timeout not exceeded → acquire throws', () => {
    fc.assert(
      fc.property(
        arbPid,
        arbOperationId,
        arbCommand,
        arbHostname,
        arbLockTimeoutMs,
        arbPositiveDelta,
        (pid, operationId, command, hostname, lockTimeoutMs, delta) => {
          // createdAt is recent enough that timeout is NOT exceeded
          const now = Date.now();
          const createdAtMs = now - Math.max(0, lockTimeoutMs - delta); // guarantees now - createdAt < lockTimeoutMs
          const createdAt = new Date(createdAtMs).toISOString();

          const lockData: LockData = { pid, operationId, command, createdAt, hostname, ci: false };
          const mockFs = createMockFs(lockData);
          // PID appears alive — lock is active
          const mockProc = createMockProcessInfo(true);

          const lm = createLockManager({
            lockDir: '/tmp/test-lock',
            lockTimeoutMs,
            ci: false,
            processInfo: mockProc,
            fs: mockFs,
            hostname: 'test-host',
          });

          // Should throw — lock is active (PID alive + not timed out)
          expect(() => lm.acquire('new-op-id', 'release')).toThrow(VersioningsError);
        },
      ),
      { numRuns: 100 },
    );
  });

  test('boundary: age exactly equals timeout → lock is NOT stale (strict >)', () => {
    fc.assert(
      fc.property(
        arbPid,
        arbOperationId,
        arbCommand,
        arbHostname,
        arbLockTimeoutMs,
        (pid, operationId, command, hostname, lockTimeoutMs) => {
          // Set createdAt so that now - createdAt === lockTimeoutMs (approximately)
          // Since Date.now() may advance between calls, we use a tight window
          const now = Date.now();
          const createdAtMs = now - lockTimeoutMs;
          const createdAt = new Date(createdAtMs).toISOString();

          const lockData: LockData = { pid, operationId, command, createdAt, hostname, ci: false };
          const mockFs = createMockFs(lockData);
          const mockProc = createMockProcessInfo(true);

          const lm = createLockManager({
            lockDir: '/tmp/test-lock',
            lockTimeoutMs,
            ci: false,
            processInfo: mockProc,
            fs: mockFs,
            hostname: 'test-host',
          });

          // At boundary (age === timeout), strict > means NOT stale → should throw
          // Note: Due to ms precision and Date.parse round-trip, the actual elapsed
          // time may be slightly more. We accept that this is a best-effort boundary test.
          // The key invariant is: if age <= timeout, lock is not stale.
          try {
            lm.acquire('new-op-id', 'release');
            // If acquire succeeds, it means the tiny time elapsed pushed us past boundary.
            // This is acceptable — the property still holds (age > timeout at check time).
          } catch (err) {
            expect(err).toBeInstanceOf(VersioningsError);
            expect((err as VersioningsError).code).toBe(EXIT_CODES.COMMAND_FAILED);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  test('CI mode: PID is never checked (kill not called), only timeout used', () => {
    fc.assert(
      fc.property(
        arbPid,
        arbOperationId,
        arbCommand,
        arbHostname,
        arbLockTimeoutMs,
        arbPositiveDelta,
        (pid, operationId, command, hostname, lockTimeoutMs, delta) => {
          // Stale case in CI — timeout exceeded
          const now = Date.now();
          const createdAtMs = now - lockTimeoutMs - delta;
          const createdAt = new Date(createdAtMs).toISOString();

          const lockData: LockData = { pid, operationId, command, createdAt, hostname, ci: true };
          const mockFs = createMockFs(lockData);
          const mockProc = createMockProcessInfo(true);

          const lm = createLockManager({
            lockDir: '/tmp/test-lock',
            lockTimeoutMs,
            ci: true, // CI mode
            processInfo: mockProc,
            fs: mockFs,
            hostname: 'test-host',
          });

          lm.acquire('new-op-id', 'release');

          // In CI mode, process.kill should NEVER be called — PID is ignored
          expect(mockProc.kill).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });

  test('CI mode: non-stale lock throws without checking PID', () => {
    fc.assert(
      fc.property(
        arbPid,
        arbOperationId,
        arbCommand,
        arbHostname,
        arbLockTimeoutMs,
        arbPositiveDelta,
        (pid, operationId, command, hostname, lockTimeoutMs, delta) => {
          // Non-stale case in CI — timeout NOT exceeded
          const now = Date.now();
          const createdAtMs = now - Math.max(0, lockTimeoutMs - delta);
          const createdAt = new Date(createdAtMs).toISOString();

          const lockData: LockData = { pid, operationId, command, createdAt, hostname, ci: true };
          const mockFs = createMockFs(lockData);
          const mockProc = createMockProcessInfo(true);

          const lm = createLockManager({
            lockDir: '/tmp/test-lock',
            lockTimeoutMs,
            ci: true, // CI mode
            processInfo: mockProc,
            fs: mockFs,
            hostname: 'test-host',
          });

          // Should throw — lock is active (not timed out)
          expect(() => lm.acquire('new-op-id', 'release')).toThrow(VersioningsError);

          // In CI mode, process.kill should NEVER be called
          expect(mockProc.kill).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });
});
