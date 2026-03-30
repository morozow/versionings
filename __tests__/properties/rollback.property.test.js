/* Versioning automation tool, 2018-present */

const fc = require('fast-check');
const { createRollbackManager } = require('../../rollback');

// --- Generators ---

/** arbStepType: random step type excluding 'pushed' for simplicity */
const arbStepType = fc.constantFrom(
  'npm_version_bump',
  'branch_created',
  'tag_created',
  'committed'
);

/** arbStepMeta: generate appropriate meta for each step type */
function arbStepMeta(type) {
  switch (type) {
    case 'branch_created':
    case 'tag_created':
      // Generate git-safe names: alphanumeric with hyphens/slashes, non-empty
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

/** arbStep: a single step with type and matching meta */
const arbStep = arbStepType.chain((type) => arbStepMeta(type).map((meta) => ({ type, meta })));

/** arbSteps: array of 1-10 random steps */
const arbSteps = fc.array(arbStep, { minLength: 1, maxLength: 10 });

// --- Helpers ---

/**
 * Pure helper: compute the expected reverse command for a step.
 * Mirrors the rollback logic but kept independent for test clarity.
 */
function expectedReverseCommand(step) {
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

/**
 * Create a mock executor that tracks commands in order.
 * @param {Set<number>} failIndices — indices (in execution order) where run() should throw
 */
function createTrackingExecutor(failIndices = new Set()) {
  const commands = [];
  let callIndex = 0;
  return {
    run: async (cmd) => {
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
// Feature: enterprise-readiness, Property 3: Rollback in reverse order
describe('Property 3: Rollback in reverse order', () => {
  // Validates: Requirements 3.1, 3.2, 3.3

  test('rollback executes reverse commands in LIFO order for any step sequence', async () => {
    await fc.assert(
      fc.asyncProperty(arbSteps, async (steps) => {
        const executor = createTrackingExecutor();
        const mgr = createRollbackManager(executor);

        for (const step of steps) {
          mgr.record(step);
        }

        await mgr.rollback();

        // Expected: reverse commands in LIFO order
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
          // Clamp failIdx to valid range for this steps array
          const clampedFailIdx = failIdx % steps.length;
          const failIndices = new Set([clampedFailIdx]);

          const executor = createTrackingExecutor(failIndices);
          const mgr = createRollbackManager(executor);

          for (const step of steps) {
            mgr.record(step);
          }

          await mgr.rollback();

          // All N steps must have been attempted (one command per step)
          expect(executor.commands).toHaveLength(steps.length);

          // Verify commands after the failed index were still executed
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
// Feature: enterprise-readiness, Property 4: Exit code after rollback
describe('Property 4: Exit code after rollback', () => {
  // Validates: Requirements 3.4, 3.5

  test('if all steps rolled back successfully, success=true', async () => {
    await fc.assert(
      fc.asyncProperty(arbSteps, async (steps) => {
        const executor = createTrackingExecutor(); // no failures
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

          // The failed step must correspond to the injected failure
          const failedTypes = result.failedSteps.map((f) => f.step.type);
          const reversedSteps = [...steps].reverse();
          expect(failedTypes).toContain(reversedSteps[clampedFailIdx].type);

          // Each failed step must have an error object
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
          // Fail on first and last rollback indices
          const failIndices = new Set([0, steps.length - 1]);

          const executor = createTrackingExecutor(failIndices);
          const mgr = createRollbackManager(executor);

          for (const step of steps) {
            mgr.record(step);
          }

          const result = await mgr.rollback();

          expect(result.success).toBe(false);
          // At least 2 failures (first and last), could be same if length=1
          expect(result.failedSteps.length).toBe(
            steps.length === 1 ? 1 : 2
          );

          // All steps were still attempted
          expect(executor.commands).toHaveLength(steps.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});
