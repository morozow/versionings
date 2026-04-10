// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau
// Feature: branching-policy-enforcement, Property 17: Artifact Checker skips branch check when null or reuse

import * as fc from 'fast-check';
import { createArtifactChecker } from '../../artifact.checker';
import type { Executor, ExecutorResult } from '../../executor';

/**
 * Validates: Requirements 15.2, 15.3
 *
 * Property 17: For any CheckUniquenessOpts with branchName === null or
 * skipBranchCheck === true, Artifact_Checker does NOT execute
 * `git branch --list` or `git ls-remote --heads`. Tag check always runs.
 */

const gitSafeChar = fc.constantFrom(
  ...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')
);

const arbTagName = fc
  .tuple(
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 }),
    fc.stringOf(gitSafeChar, { minLength: 1, maxLength: 15 }),
  )
  .map(([x, y, z, c]) => `${x}.${y}.${z}--${c}`);

const arbBranchName = fc
  .tuple(
    fc.constantFrom('release', 'hotfix', 'support', 'version/patch', 'feature'),
    fc.stringOf(gitSafeChar, { minLength: 1, maxLength: 15 }),
  )
  .map(([prefix, suffix]) => `${prefix}/${suffix}`);

function createTrackingExecutor(): Executor & { commands: string[] } {
  const commands: string[] = [];
  return {
    run: async (cmd: string): Promise<ExecutorResult> => {
      commands.push(cmd);
      return { stdout: '', lines: [] };
    },
    commands,
  };
}

function hasBranchListCommand(commands: string[]): boolean {
  return commands.some(
    (c) => c === 'git branch --list' || c.startsWith('git ls-remote --heads'),
  );
}

function hasTagListCommand(commands: string[]): boolean {
  return commands.some((c) => c === 'git tag --list');
}

describe('Property 17: Artifact Checker skips branch check when null or reuse', () => {
  it('branchName=null → no git branch --list or ls-remote --heads, but git tag --list always runs', async () => {
    await fc.assert(
      fc.asyncProperty(arbTagName, fc.boolean(), async (tagName, push) => {
        const executor = createTrackingExecutor();
        const checker = createArtifactChecker(executor);

        await checker.checkUniqueness({
          tagName,
          branchName: null,
          push,
        });

        expect(hasBranchListCommand(executor.commands)).toBe(false);
        expect(hasTagListCommand(executor.commands)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('skipBranchCheck=true → no git branch --list or ls-remote --heads, but git tag --list always runs', async () => {
    await fc.assert(
      fc.asyncProperty(arbTagName, arbBranchName, fc.boolean(), async (tagName, branchName, push) => {
        const executor = createTrackingExecutor();
        const checker = createArtifactChecker(executor);

        await checker.checkUniqueness({
          tagName,
          branchName,
          push,
          skipBranchCheck: true,
        });

        expect(hasBranchListCommand(executor.commands)).toBe(false);
        expect(hasTagListCommand(executor.commands)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('tag check always runs regardless of branchName or skipBranchCheck', async () => {
    const arbSkipScenario = fc.oneof(
      fc.record({
        branchName: fc.constant(null as string | null),
        skipBranchCheck: fc.constant(false),
      }),
      fc.record({
        branchName: arbBranchName as fc.Arbitrary<string | null>,
        skipBranchCheck: fc.constant(true),
      }),
    );

    await fc.assert(
      fc.asyncProperty(arbTagName, arbSkipScenario, fc.boolean(), async (tagName, scenario, push) => {
        const executor = createTrackingExecutor();
        const checker = createArtifactChecker(executor);

        await checker.checkUniqueness({
          tagName,
          branchName: scenario.branchName,
          push,
          skipBranchCheck: scenario.skipBranchCheck,
        });

        // Tag check always runs
        expect(hasTagListCommand(executor.commands)).toBe(true);

        // If push=true, remote tag check also runs
        if (push) {
          expect(executor.commands.some((c) => c.startsWith('git ls-remote --tags'))).toBe(true);
        }

        // Branch check never runs
        expect(hasBranchListCommand(executor.commands)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
