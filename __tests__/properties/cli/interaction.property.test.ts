// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau
// Feature: core-ux-config-cli, Property 1 & Property 2: Interaction Manager properties

import * as fc from 'fast-check';
import { PassThrough } from 'stream';
import { createInteractionManager } from '../../../src/cli/interaction.manager';
import type { InteractionOpts } from '../../../src/cli/interaction.manager';
import type { DryRunPlan } from '../../../src/core/reporter';

// --- Mock DryRunPlan ---

const mockPlan: DryRunPlan = {
  dryRun: false,
  currentVersion: '1.0.0',
  nextVersion: '1.0.1',
  semver: 'patch',
  branch: 'version/patch/1.0.1/fix-bug',
  tag: '1.0.1--fix-bug',
  commitMessage: 'Patch: v1.0.1. You SHOULD consider changes.',
  pullRequestUrl: null,
  steps: ['npm --no-git-tag-version version patch', 'git checkout -b version/patch/1.0.1/fix-bug'],
};

// --- Generators ---

/** Arbitrary for InteractionOpts — all 4 boolean flags. */
const arbInteractionOpts: fc.Arbitrary<InteractionOpts> = fc.record({
  ci: fc.boolean(),
  nonInteractive: fc.boolean(),
  yes: fc.boolean(),
  isTTY: fc.boolean(),
});

// --- Helpers ---

/**
 * Reference implementation: expected value of isInteractive().
 * Interactive IFF isTTY===true AND ci===false AND nonInteractive===false AND yes===false.
 */
function expectedInteractive(opts: InteractionOpts): boolean {
  return opts.isTTY === true
    && opts.ci === false
    && opts.nonInteractive === false
    && opts.yes === false;
}

/**
 * Creates a tracking stdin mock that records calls to read/on/once/resume.
 * Used to verify non-interactive mode does not touch stdin.
 */
function makeTrackingStdin() {
  const fns = {
    on: jest.fn().mockReturnThis(),
    once: jest.fn().mockReturnThis(),
    read: jest.fn(),
    resume: jest.fn(),
    pause: jest.fn(),
    setEncoding: jest.fn(),
    removeListener: jest.fn().mockReturnThis(),
    addListener: jest.fn().mockReturnThis(),
    off: jest.fn().mockReturnThis(),
    removeAllListeners: jest.fn().mockReturnThis(),
    emit: jest.fn(),
    prependListener: jest.fn().mockReturnThis(),
    prependOnceListener: jest.fn().mockReturnThis(),
    listeners: jest.fn().mockReturnValue([]),
    rawListeners: jest.fn().mockReturnValue([]),
    listenerCount: jest.fn().mockReturnValue(0),
    eventNames: jest.fn().mockReturnValue([]),
    getMaxListeners: jest.fn().mockReturnValue(10),
    setMaxListeners: jest.fn().mockReturnThis(),
    pipe: jest.fn(),
    unpipe: jest.fn(),
    unshift: jest.fn(),
    wrap: jest.fn(),
    [Symbol.asyncIterator]: jest.fn(),
    readable: true,
    readableEncoding: null,
    readableEnded: false,
    readableFlowing: null,
    readableHighWaterMark: 16384,
    readableLength: 0,
    readableObjectMode: false,
    destroyed: false,
    closed: false,
    errored: null,
    readableAborted: false,
    readableDidRead: false,
    destroy: jest.fn(),
    isPaused: jest.fn().mockReturnValue(false),
    iterator: jest.fn(),
    map: jest.fn(),
    filter: jest.fn(),
    forEach: jest.fn(),
    toArray: jest.fn(),
    some: jest.fn(),
    find: jest.fn(),
    every: jest.fn(),
    flatMap: jest.fn(),
    drop: jest.fn(),
    take: jest.fn(),
    asIndexedPairs: jest.fn(),
    reduce: jest.fn(),
    compose: jest.fn(),
  };
  return fns as unknown as NodeJS.ReadableStream & {
    on: jest.Mock;
    once: jest.Mock;
    read: jest.Mock;
    resume: jest.Mock;
  };
}

// --- Property 1: Determinism of interactive mode ---

/**
 * **Validates: Requirements 1.1, 1.4, 2.1, 2.2, 2.4, 9.4**
 *
 * For any combination of boolean flags {ci, nonInteractive, yes, isTTY},
 * isInteractive() SHALL return true IFF isTTY===true AND ci===false
 * AND nonInteractive===false AND yes===false. All other combos return false.
 */
describe('Property 1: Determinism of interactive mode', () => {
  test('isInteractive() matches reference formula for all boolean flag combinations', () => {
    fc.assert(
      fc.property(arbInteractionOpts, (opts) => {
        const stdin = new PassThrough();
        const stdout = new PassThrough();
        const mgr = createInteractionManager(opts, stdin, stdout);

        const actual = mgr.isInteractive();
        const expected = expectedInteractive(opts);

        expect(actual).toBe(expected);

        // Cleanup
        stdin.destroy();
        stdout.destroy();
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 2: Non-interactive mode doesn't read stdin ---

/**
 * **Validates: Requirements 2.3, 2.4**
 *
 * For any combination of flags where isInteractive()===false,
 * confirm(plan) SHALL return true without reading from stdin.
 * stdin.read / stdin.on('data') call count SHALL be zero.
 */
describe('Property 2: Non-interactive mode does not read stdin', () => {
  test('confirm() returns true and never touches stdin when non-interactive', () => {
    fc.assert(
      fc.asyncProperty(arbInteractionOpts, async (opts) => {
        // Only test non-interactive combinations
        fc.pre(expectedInteractive(opts) === false);

        const stdin = makeTrackingStdin();
        const stdout = new PassThrough();
        const mgr = createInteractionManager(opts, stdin, stdout);

        // Confirm should resolve to true without reading stdin
        const result = await mgr.confirm(mockPlan);
        expect(result).toBe(true);

        // Verify stdin was never read or listened to for data
        expect(stdin.read).not.toHaveBeenCalled();
        expect(stdin.on).not.toHaveBeenCalled();
        expect(stdin.once).not.toHaveBeenCalled();
        expect(stdin.resume).not.toHaveBeenCalled();

        // Cleanup
        stdout.destroy();
      }),
      { numRuns: 100 },
    );
  });
});
