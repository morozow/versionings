/* Versioning automation tool, 2018-present */

const { createRollbackManager, STEP_TYPES } = require('../../rollback');

/**
 * Validates: Requirements 3.1, 3.2, 3.3
 */

function createMockExecutor() {
  const commands = [];
  return {
    run: jest.fn(async (cmd) => {
      commands.push(cmd);
      return { stdout: '', lines: [] };
    }),
    commands,
  };
}

function createFailingExecutor(failOnCommand) {
  const commands = [];
  return {
    run: jest.fn(async (cmd) => {
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

    // Rollback is LIFO, so COMMITTED (last recorded) is undone first
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

    // TAG_CREATED rolled back first (success), then BRANCH_CREATED fails, then NPM_VERSION_BUMP still runs
    expect(result.success).toBe(false);
    expect(result.failedSteps).toHaveLength(1);
    expect(result.failedSteps[0].step.type).toBe(STEP_TYPES.BRANCH_CREATED);
    expect(result.failedSteps[0].error).toBeInstanceOf(Error);

    // NPM_VERSION_BUMP still executed despite prior failure
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
