// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { createRollbackManager, STEP_TYPES } from '../../../src/core/rollback';
import type { Executor, ExecutorResult } from '../../../src/core/executor';

function createMockExecutor(): Executor & { commands: string[] } {
  const commands: string[] = [];
  return {
    run: jest.fn(async (cmd: string): Promise<ExecutorResult> => {
      commands.push(cmd);
      return { stdout: '', lines: [] };
    }),
    commands,
  };
}

function createFailingExecutor(failOnCommand: string): Executor & { commands: string[] } {
  const commands: string[] = [];
  return {
    run: jest.fn(async (cmd: string): Promise<ExecutorResult> => {
      commands.push(cmd);
      if (cmd.includes(failOnCommand)) {
        throw new Error(`Failed: ${cmd}`);
      }
      return { stdout: '', lines: [] };
    }),
    commands,
  };
}

describe('rollback manager', () => {
  test('record steps — steps are stored in order (verified via LIFO rollback)', async () => {
    const executor = createMockExecutor();
    const mgr = createRollbackManager(executor);
    mgr.record({ type: STEP_TYPES.TAG_CREATED, meta: { name: 'v1.0.0' } });
    mgr.record({ type: STEP_TYPES.BRANCH_CREATED, meta: { name: 'version/patch/1.0.0/fix' } });
    mgr.record({ type: STEP_TYPES.COMMITTED, meta: {} });
    await mgr.rollback();
    expect(executor.commands[0]).toBe('git reset --hard HEAD~1');
    expect(executor.commands[1]).toBe('git branch -D version/patch/1.0.0/fix');
    expect(executor.commands[2]).toBe('git tag -d v1.0.0');
  });

  test('rollback in reverse order (LIFO)', async () => {
    const executor = createMockExecutor();
    const mgr = createRollbackManager(executor);
    mgr.record({ type: STEP_TYPES.NPM_VERSION_BUMP, meta: {} });
    mgr.record({ type: STEP_TYPES.BRANCH_CREATED, meta: { name: 'release/1.2.3' } });
    mgr.record({ type: STEP_TYPES.TAG_CREATED, meta: { name: '1.2.3--hotfix' } });
    await mgr.rollback();
    expect(executor.commands).toEqual([
      'git tag -d 1.2.3--hotfix',
      'git branch -D release/1.2.3',
      'git reset --hard',
    ]);
  });

  test('partial rollback on error — failed step recorded, remaining steps still execute', async () => {
    const executor = createFailingExecutor('git branch -D');
    const mgr = createRollbackManager(executor);
    mgr.record({ type: STEP_TYPES.NPM_VERSION_BUMP, meta: {} });
    mgr.record({ type: STEP_TYPES.BRANCH_CREATED, meta: { name: 'feat-branch' } });
    mgr.record({ type: STEP_TYPES.TAG_CREATED, meta: { name: 'v2.0.0' } });
    const result = await mgr.rollback();
    expect(result.success).toBe(false);
    expect(result.failedSteps).toHaveLength(1);
    expect(result.failedSteps[0].step.type).toBe(STEP_TYPES.BRANCH_CREATED);
    expect(result.failedSteps[0].error).toBeInstanceOf(Error);
    expect(executor.commands).toContain('git reset --hard');
    expect(executor.commands).toContain('git tag -d v2.0.0');
  });

  test('empty journal — rollback returns success with no failed steps', async () => {
    const executor = createMockExecutor();
    const mgr = createRollbackManager(executor);
    const result = await mgr.rollback();
    expect(result).toEqual({ success: true, failedSteps: [] });
    expect(executor.commands).toHaveLength(0);
  });

  test('full success — all steps rolled back, success=true, failedSteps=[]', async () => {
    const executor = createMockExecutor();
    const mgr = createRollbackManager(executor);
    mgr.record({ type: STEP_TYPES.NPM_VERSION_BUMP, meta: {} });
    mgr.record({ type: STEP_TYPES.BRANCH_CREATED, meta: { name: 'version/minor/2.0.0/feature' } });
    mgr.record({ type: STEP_TYPES.TAG_CREATED, meta: { name: '2.0.0--feature' } });
    mgr.record({ type: STEP_TYPES.COMMITTED, meta: {} });
    const result = await mgr.rollback();
    expect(result.success).toBe(true);
    expect(result.failedSteps).toEqual([]);
    expect(executor.run).toHaveBeenCalledTimes(4);
  });

  test('PUSHED step — rolls back both branch and tag on remote', async () => {
    const executor = createMockExecutor();
    const mgr = createRollbackManager(executor);
    mgr.record({
      type: STEP_TYPES.PUSHED,
      meta: { branch: 'version/patch/1.0.1/bugfix', tag: '1.0.1--bugfix', remote: 'origin' },
    });
    await mgr.rollback();
    expect(executor.commands).toEqual([
      'git push origin --delete version/patch/1.0.1/bugfix',
      'git push origin --delete 1.0.1--bugfix',
    ]);
  });
});

describe('BRANCH_SWITCHED rollback', () => {
  test('rollback BRANCH_SWITCHED executes git checkout {previousBranch}', async () => {
    const executor = createMockExecutor();
    const mgr = createRollbackManager(executor);
    mgr.record({ type: STEP_TYPES.BRANCH_SWITCHED, meta: { previousBranch: 'main' } });
    await mgr.rollback();
    expect(executor.commands).toEqual(['git checkout main']);
  });

  test('LIFO order with BRANCH_SWITCHED', async () => {
    const executor = createMockExecutor();
    const mgr = createRollbackManager(executor);
    mgr.record({ type: STEP_TYPES.NPM_VERSION_BUMP, meta: {} });
    mgr.record({ type: STEP_TYPES.BRANCH_SWITCHED, meta: { previousBranch: 'develop' } });
    mgr.record({ type: STEP_TYPES.TAG_CREATED, meta: { name: 'v1.0.1' } });
    await mgr.rollback();
    expect(executor.commands).toEqual([
      'git tag -d v1.0.1',
      'git checkout develop',
      'git reset --hard',
    ]);
  });

  test('no BRANCH_SWITCHED → does not attempt to rollback branch switch', async () => {
    const executor = createMockExecutor();
    const mgr = createRollbackManager(executor);
    mgr.record({ type: STEP_TYPES.NPM_VERSION_BUMP, meta: {} });
    mgr.record({ type: STEP_TYPES.TAG_CREATED, meta: { name: 'v2.0.0' } });
    await mgr.rollback();
    expect(executor.commands).toEqual([
      'git tag -d v2.0.0',
      'git reset --hard',
    ]);
    expect(executor.commands.every(cmd => !cmd.includes('git checkout'))).toBe(true);
  });
});

import type { StructuredLogger } from '../../../src/core/structured.logger';

function createMockLogger(): StructuredLogger & { calls: Array<{ method: string; message: string; context?: Record<string, unknown> }> } {
  const calls: Array<{ method: string; message: string; context?: Record<string, unknown> }> = [];
  return {
    debug(message: string, context?: Record<string, unknown>) { calls.push({ method: 'debug', message, context }); },
    info(message: string, context?: Record<string, unknown>) { calls.push({ method: 'info', message, context }); },
    warn(message: string, context?: Record<string, unknown>) { calls.push({ method: 'warn', message, context }); },
    error(message: string, context?: Record<string, unknown>) { calls.push({ method: 'error', message, context }); },
    calls,
  };
}

describe('rollback manager with StructuredLogger', () => {
  test('logs rollback start, each step, and completion on success', async () => {
    const executor = createMockExecutor();
    const logger = createMockLogger();
    const mgr = createRollbackManager(executor, logger);
    mgr.record({ type: STEP_TYPES.TAG_CREATED, meta: { name: 'v1.0.0' } });
    mgr.record({ type: STEP_TYPES.COMMITTED, meta: {} });
    await mgr.rollback();

    expect(logger.calls[0]).toEqual({ method: 'info', message: 'Rollback started', context: { totalSteps: 2 } });
    // Step 1 (COMMITTED — reversed index 1)
    expect(logger.calls[1]).toEqual({ method: 'info', message: 'Rolling back step', context: { stepType: 'committed', index: 1 } });
    expect(logger.calls[2]).toEqual({ method: 'info', message: 'Rollback step completed', context: { stepType: 'committed', result: 'success' } });
    // Step 2 (TAG_CREATED — reversed index 0)
    expect(logger.calls[3]).toEqual({ method: 'info', message: 'Rolling back step', context: { stepType: 'tag_created', index: 0 } });
    expect(logger.calls[4]).toEqual({ method: 'info', message: 'Rollback step completed', context: { stepType: 'tag_created', result: 'success' } });
    // Completion
    expect(logger.calls[5]).toEqual({ method: 'info', message: 'Rollback completed', context: { success: true, totalSteps: 2, failedCount: 0 } });
  });

  test('logs warn on failed step', async () => {
    const executor = createFailingExecutor('git branch -D');
    const logger = createMockLogger();
    const mgr = createRollbackManager(executor, logger);
    mgr.record({ type: STEP_TYPES.BRANCH_CREATED, meta: { name: 'feat' } });
    await mgr.rollback();

    const warnCalls = logger.calls.filter(c => c.method === 'warn');
    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0].message).toBe('Rollback step failed');
    expect(warnCalls[0].context).toMatchObject({ stepType: 'branch_created', result: 'failed' });

    const completionCall = logger.calls[logger.calls.length - 1];
    expect(completionCall).toEqual({ method: 'info', message: 'Rollback completed', context: { success: false, totalSteps: 1, failedCount: 1 } });
  });

  test('without logger — no errors, same behavior as before', async () => {
    const executor = createMockExecutor();
    const mgr = createRollbackManager(executor);
    mgr.record({ type: STEP_TYPES.NPM_VERSION_BUMP, meta: {} });
    const result = await mgr.rollback();
    expect(result.success).toBe(true);
    expect(executor.commands).toEqual(['git reset --hard']);
  });

  test('logger errors do not break rollback flow', async () => {
    const executor = createMockExecutor();
    const throwingLogger: StructuredLogger = {
      debug() { throw new Error('logger boom'); },
      info() { throw new Error('logger boom'); },
      warn() { throw new Error('logger boom'); },
      error() { throw new Error('logger boom'); },
    };
    const mgr = createRollbackManager(executor, throwingLogger);
    mgr.record({ type: STEP_TYPES.TAG_CREATED, meta: { name: 'v1.0.0' } });
    const result = await mgr.rollback();
    expect(result.success).toBe(true);
    expect(executor.commands).toEqual(['git tag -d v1.0.0']);
  });
});
