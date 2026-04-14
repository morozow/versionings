// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { Executor } from './executor';
import type { StructuredLogger } from './structured.logger';

export interface StepTypes {
  readonly NPM_VERSION_BUMP: 'npm_version_bump';
  readonly BRANCH_CREATED: 'branch_created';
  readonly TAG_CREATED: 'tag_created';
  readonly COMMITTED: 'committed';
  readonly PUSHED: 'pushed';
  readonly BRANCH_SWITCHED: 'branch_switched';
}

export const STEP_TYPES: StepTypes = Object.freeze({
  NPM_VERSION_BUMP: 'npm_version_bump' as const,
  BRANCH_CREATED: 'branch_created' as const,
  TAG_CREATED: 'tag_created' as const,
  COMMITTED: 'committed' as const,
  PUSHED: 'pushed' as const,
  BRANCH_SWITCHED: 'branch_switched' as const,
});

export interface RollbackStep {
  type: string;
  meta: Record<string, any>;
}

export interface RollbackResult {
  success: boolean;
  failedSteps: Array<{ step: RollbackStep; error: Error }>;
}

export interface RollbackManager {
  record(step: RollbackStep): void;
  rollback(): Promise<RollbackResult>;
}

/**
 * @param executor — executor instance with run(cmd) method
 * @param logger — optional structured logger for rollback step logging
 * @returns { record(step), rollback(): Promise<RollbackResult> }
 */
export function createRollbackManager(executor: Executor, logger?: StructuredLogger): RollbackManager {
  const steps: RollbackStep[] = [];

  function record(step: RollbackStep): void {
    steps.push(step);
  }

  async function rollback(): Promise<RollbackResult> {
    const failedSteps: Array<{ step: RollbackStep; error: Error }> = [];
    const totalSteps = steps.length;

    try { logger?.info('Rollback started', { totalSteps }); } catch { /* logging must never break rollback */ }

    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i];
      try {
        try { logger?.info('Rolling back step', { stepType: step.type, index: i }); } catch { /* safe */ }
        await rollbackStep(step);
        try { logger?.info('Rollback step completed', { stepType: step.type, result: 'success' }); } catch { /* safe */ }
      } catch (error: any) {
        failedSteps.push({ step, error });
        try { logger?.warn('Rollback step failed', { stepType: step.type, result: 'failed', error: error.message }); } catch { /* safe */ }
      }
    }

    const success = failedSteps.length === 0;
    try { logger?.info('Rollback completed', { success, totalSteps, failedCount: failedSteps.length }); } catch { /* safe */ }

    return {
      success,
      failedSteps,
    };
  }

  async function rollbackStep(step: RollbackStep): Promise<void> {
    const { type, meta } = step;

    switch (type) {
      case STEP_TYPES.NPM_VERSION_BUMP:
        await executor.run('git reset --hard');
        break;

      case STEP_TYPES.BRANCH_CREATED:
        await executor.run(`git branch -D ${meta.name}`);
        break;

      case STEP_TYPES.TAG_CREATED:
        await executor.run(`git tag -d ${meta.name}`);
        break;

      case STEP_TYPES.COMMITTED:
        await executor.run('git reset --hard HEAD~1');
        break;

      case STEP_TYPES.BRANCH_SWITCHED:
        await executor.run(`git checkout ${meta.previousBranch}`);
        break;

      case STEP_TYPES.PUSHED: {
        const remote = meta.remote || 'origin';
        const errors: Error[] = [];

        try {
          await executor.run(`git push ${remote} --delete ${meta.branch}`);
        } catch (err: any) {
          errors.push(err);
        }

        if (meta.tag) {
          try {
            await executor.run(`git push ${remote} --delete ${meta.tag}`);
          } catch (err: any) {
            errors.push(err);
          }
        }

        if (errors.length > 0) {
          const combined: any = new Error(
            `Failed to rollback pushed artifacts: ${errors.map(e => e.message).join('; ')}`
          );
          combined.errors = errors;
          throw combined;
        }
        break;
      }

      default:
        throw new Error(`Unknown step type: ${type}`);
    }
  }

  return { record, rollback };
}
