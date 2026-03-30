// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import * as fc from 'fast-check';
import { createRollbackManager } from '../../rollback';
import type { Executor, ExecutorResult } from '../../executor';
import type { RollbackStep } from '../../rollback';

// --- Generators ---

const arbStepType = fc.constantFrom(
  'npm_version_bump',
  'branch_created',
  'tag_created',
  'committed'
);

function arbStepMeta(type: string): fc.Arbitrary<Record<string, any>> {
  switch (type) {
    case 'branch_created':
    case 'tag_created':
      return fc
        .stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-/'.split('')), {
          minLength: 1,
          maxLength: 40,
        })
        .map((name) => ({ name }));
    case 'npm_version_bump':
    case 'committed':
    default:
      return fc.constant({});
  }
}

const arbStep: fc.Arbitrary<RollbackStep> = arbStepType.chain((type) =>
  arbStepMeta(type).map((meta) => ({ type, meta }))
);

const arbSteps = fc.array(arbStep, { minLength: 1, maxLength: 10 });

// --- Helpers ---

function expectedReverseCommand(step: RollbackStep): string {
  const { type, meta } = step;
  switch (type) {
    case 'npm_version_bump':
      return 'git reset --hard';
    case 'branch_created':
      return `git branch -D ${meta.name}`;
    case 'tag_created':
      return `git tag -d ${meta.name}`;
    case 'committed':
      return 'git reset --hard HEAD~1';
    default:
      throw new Error(`Unexpected type: ${type}`);
  }
}

function createTrackingExecutor(failIndices = new Set<number>()): Executor & { commands: string[] } {
  const commands: string[] = [];
  let callIndex = 0;
  return {
    run: async (cmd: string): Promise<ExecutorResult> => {
      const idx = callIndex++;
      commands.push(cmd);
      if (failIndices.has(idx)) {
        throw new Error(`Mock failure at index ${idx}: ${cmd}`);
      }
      return { stdout: '', lines: [] };
    },
    commands,
  };
}

// --- Property 3 ---
describe('Property 3: Rollback in reverse order', () => {

  test('rollback executes reverse commands in LIFO order for any step sequence', async () => {
    await fc.assert(
      fc.asyncProperty(arbSteps, async (steps) => {
        const executor = createTrackingExecutor();
        const mgr = createRollbackManager(executor);
        for (const step of steps) {
          mgr.record(step);
        }
        await mgr.rollback();
        const expectedCommands = [...steps].reverse().map(expectedReverseCommand);
        expect(executor.commands).toEqual(expectedCommands);
      }),
      { numRuns: 100 }
    );
  });

  test('if rollback of step K fails, steps K-1..1 are still processed', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbSteps,
        fc.integer({ min: 0, max: 9 }),
        async (steps, failIdx) => {
          const clampedFailIdx = failIdx % steps.length;
          const failIndices = new Set([clampedFailIdx]);
          const executor = createTrackingExecutor(failIndices);
          const mgr = createRollbackManager(executor);
          for (const step of steps) {
            mgr.record(step);
          }
          await mgr.rollback();
          expect(executor.commands).toHaveLength(steps.length);
          const reversedSteps = [...steps].reverse();
          for (let i = clampedFailIdx + 1; i < reversedSteps.length; i++) {
            expect(executor.commands[i]).toBe(expectedReverseCommand(reversedSteps[i]));
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// --- Property 4 ---
describe('Property 4: Exit code after rollback', () => {

  test('if all steps rolled back successfully, success=true', async () => {
    await fc.assert(
      fc.asyncProperty(arbSteps, async (steps) => {
        const executor = createTrackingExecutor();
        const mgr = createRollbackManager(executor);
        for (const step of steps) {
          mgr.record(step);
        }
        const result = await mgr.rollback();
        expect(result.success).toBe(true);
        expect(result.failedSteps).toEqual([]);
      }),
      { numRuns: 100 }
    );
  });

  test('if at least one step failed, success=false', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbSteps,
        fc.integer({ min: 0, max: 9 }),
        async (steps, failIdx) => {
          const clampedFailIdx = failIdx % steps.length;
          const failIndices = new Set([clampedFailIdx]);
          const executor = createTrackingExecutor(failIndices);
          const mgr = createRollbackManager(executor);
          for (const step of steps) {
            mgr.record(step);
          }
          const result = await mgr.rollback();
          expect(result.success).toBe(false);
          expect(result.failedSteps.length).toBeGreaterThanOrEqual(1);
          const failedTypes = result.failedSteps.map((f) => f.step.type);
          const reversedSteps = [...steps].reverse();
          expect(failedTypes).toContain(reversedSteps[clampedFailIdx].type);
          for (const f of result.failedSteps) {
            expect(f.error).toBeInstanceOf(Error);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('with multiple failures, success=false and all failures recorded', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbStep, { minLength: 3, maxLength: 10 }),
        async (steps) => {
          const failIndices = new Set([0, steps.length - 1]);
          const executor = createTrackingExecutor(failIndices);
          const mgr = createRollbackManager(executor);
          for (const step of steps) {
            mgr.record(step);
          }
          const result = await mgr.rollback();
          expect(result.success).toBe(false);
          expect(result.failedSteps.length).toBe(
            steps.length === 1 ? 1 : 2
          );
          expect(executor.commands).toHaveLength(steps.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});
