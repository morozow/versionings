// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau
// Feature: branching-policy-enforcement, Property 18: Rollback with BRANCH_SWITCHED in LIFO order

import * as fc from 'fast-check';
import { createRollbackManager, STEP_TYPES } from '../../../src/core/rollback';
import type { RollbackStep } from '../../../src/core/rollback';
import type { Executor, ExecutorResult } from '../../../src/core/executor';

/**
 * Validates: Requirements 16.1, 16.2, 16.4
 *
 * Property 18: For any sequence of steps including BRANCH_SWITCHED,
 * rollback processes in reverse order (LIFO).
 * BRANCH_SWITCHED rollback executes `git checkout {previousBranch}`.
 * If BRANCH_SWITCHED is absent, no `git checkout` for branch switch.
 */

// --- Generators ---

const gitSafeChar = fc.constantFrom(
  ...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')
);

const arbBranchName = fc
  .stringOf(gitSafeChar, { minLength: 1, maxLength: 20 })
  .map((s) => `branch-${s}`);

const arbStepType = fc.constantFrom(
  STEP_TYPES.NPM_VERSION_BUMP,
  STEP_TYPES.BRANCH_CREATED,
  STEP_TYPES.BRANCH_SWITCHED,
  STEP_TYPES.TAG_CREATED,
  STEP_TYPES.COMMITTED,
);

function arbStepMeta(type: string): fc.Arbitrary<Record<string, any>> {
  switch (type) {
    case STEP_TYPES.BRANCH_CREATED:
    case STEP_TYPES.TAG_CREATED:
      return fc
        .stringOf(gitSafeChar, { minLength: 1, maxLength: 20 })
        .map((name) => ({ name }));
    case STEP_TYPES.BRANCH_SWITCHED:
      return arbBranchName.map((previousBranch) => ({ previousBranch }));
    case STEP_TYPES.NPM_VERSION_BUMP:
    case STEP_TYPES.COMMITTED:
    default:
      return fc.constant({});
  }
}

const arbStep: fc.Arbitrary<RollbackStep> = arbStepType.chain((type) =>
  arbStepMeta(type).map((meta) => ({ type, meta }))
);

/** Sequence that always includes at least one BRANCH_SWITCHED step */
const arbStepsWithBranchSwitched: fc.Arbitrary<RollbackStep[]> = fc
  .tuple(
    fc.array(arbStep, { minLength: 0, maxLength: 5 }),
    arbBranchName.map((previousBranch) => ({
      type: STEP_TYPES.BRANCH_SWITCHED,
      meta: { previousBranch },
    })),
    fc.array(arbStep, { minLength: 0, maxLength: 5 }),
  )
  .map(([before, switched, after]) => [...before, switched, ...after]);

/** Sequence that never includes BRANCH_SWITCHED */
const arbStepsWithoutBranchSwitched: fc.Arbitrary<RollbackStep[]> = fc.array(
  fc.constantFrom(
    STEP_TYPES.NPM_VERSION_BUMP,
    STEP_TYPES.BRANCH_CREATED,
    STEP_TYPES.TAG_CREATED,
    STEP_TYPES.COMMITTED,
  ).chain((type) => arbStepMeta(type).map((meta) => ({ type, meta }))),
  { minLength: 1, maxLength: 10 },
);

/** Mixed sequence of all step types */
const arbMixedSteps = fc.array(arbStep, { minLength: 1, maxLength: 10 });

// --- Helpers ---

function expectedCommand(step: RollbackStep): string {
  const { type, meta } = step;
  switch (type) {
    case STEP_TYPES.NPM_VERSION_BUMP:
      return 'git reset --hard';
    case STEP_TYPES.BRANCH_CREATED:
      return `git branch -D ${meta.name}`;
    case STEP_TYPES.TAG_CREATED:
      return `git tag -d ${meta.name}`;
    case STEP_TYPES.COMMITTED:
      return 'git reset --hard HEAD~1';
    case STEP_TYPES.BRANCH_SWITCHED:
      return `git checkout ${meta.previousBranch}`;
    default:
      throw new Error(`Unexpected type: ${type}`);
  }
}

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

// --- Property 18 ---

describe('Property 18: Rollback with BRANCH_SWITCHED in LIFO order', () => {
  it('rollback processes all steps including BRANCH_SWITCHED in reverse (LIFO) order', async () => {
    await fc.assert(
      fc.asyncProperty(arbStepsWithBranchSwitched, async (steps) => {
        const executor = createTrackingExecutor();
        const mgr = createRollbackManager(executor);

        for (const step of steps) {
          mgr.record(step);
        }

        await mgr.rollback();

        const expectedCommands = [...steps].reverse().map(expectedCommand);
        expect(executor.commands).toEqual(expectedCommands);
      }),
      { numRuns: 100 },
    );
  });

  it('BRANCH_SWITCHED rollback executes git checkout {previousBranch}', async () => {
    await fc.assert(
      fc.asyncProperty(arbStepsWithBranchSwitched, async (steps) => {
        const executor = createTrackingExecutor();
        const mgr = createRollbackManager(executor);

        for (const step of steps) {
          mgr.record(step);
        }

        await mgr.rollback();

        // Find all BRANCH_SWITCHED steps and verify their rollback commands
        const switchedSteps = steps.filter(
          (s) => s.type === STEP_TYPES.BRANCH_SWITCHED,
        );

        for (const switched of switchedSteps) {
          const expectedCmd = `git checkout ${switched.meta.previousBranch}`;
          expect(executor.commands).toContain(expectedCmd);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('if BRANCH_SWITCHED is absent, no git checkout for branch switch is executed', async () => {
    await fc.assert(
      fc.asyncProperty(arbStepsWithoutBranchSwitched, async (steps) => {
        const executor = createTrackingExecutor();
        const mgr = createRollbackManager(executor);

        for (const step of steps) {
          mgr.record(step);
        }

        await mgr.rollback();

        // No git checkout commands should appear (branch switch rollback)
        const checkoutCommands = executor.commands.filter((cmd) =>
          cmd.startsWith('git checkout '),
        );
        expect(checkoutCommands).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });

  it('mixed step sequences are always rolled back in LIFO order', async () => {
    await fc.assert(
      fc.asyncProperty(arbMixedSteps, async (steps) => {
        const executor = createTrackingExecutor();
        const mgr = createRollbackManager(executor);

        for (const step of steps) {
          mgr.record(step);
        }

        await mgr.rollback();

        const expectedCommands = [...steps].reverse().map(expectedCommand);
        expect(executor.commands).toEqual(expectedCommands);
      }),
      { numRuns: 100 },
    );
  });
});
