// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { runRollbackCommand, RollbackCommandOpts, RollbackCommandDeps } from '../../../src/cli/commands/rollback.command';
import { VersioningsError, EXIT_CODES } from '../../../src/core/errors';
import { createReporter } from '../../../src/core/reporter';
import type { OperationLog, OperationLogEntry } from '../../../src/core/operation.log';
import type { InteractionManager } from '../../../src/cli/interaction.manager';
import type { RollbackManager, RollbackResult, RollbackStep } from '../../../src/core/rollback';
import type { Executor, ExecutorResult } from '../../../src/core/executor';
import { PassThrough } from 'stream';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<OperationLogEntry> = {}): OperationLogEntry {
  return {
    schemaVersion: 1,
    timestamp: '2025-01-15T10:30:00.000Z',
    semver: 'patch',
    version: '1.0.1',
    previousVersion: '1.0.0',
    branch: 'version/patch/1.0.1/fix',
    tag: '1.0.1--fix',
    steps: [
      { type: 'npm_version_bump', meta: {} },
      { type: 'branch_created', meta: { name: 'version/patch/1.0.1/fix' } },
      { type: 'tag_created', meta: { name: '1.0.1--fix' } },
      { type: 'committed', meta: {} },
    ],
    result: 'success',
    ...overrides,
  };
}

function makeOpts(overrides: Partial<RollbackCommandOpts> = {}): RollbackCommandOpts {
  return {
    json: false,
    ci: false,
    yes: false,
    ...overrides,
  };
}

function makeMockExecutor(): Executor {
  return {
    run: jest.fn(async (): Promise<ExecutorResult> => ({ stdout: '', lines: [] })),
  };
}

function makeMockInteraction(interactive: boolean, confirmResult = true): InteractionManager {
  return {
    isInteractive: jest.fn().mockReturnValue(interactive),
    confirm: jest.fn().mockResolvedValue(confirmResult),
  };
}

function makeMockRollbackManager(result?: Partial<RollbackResult>): RollbackManager & { recordedSteps: RollbackStep[] } {
  const recordedSteps: RollbackStep[] = [];
  const rollbackResult: RollbackResult = {
    success: true,
    failedSteps: [],
    ...result,
  };
  return {
    record: jest.fn((step: RollbackStep) => { recordedSteps.push(step); }),
    rollback: jest.fn().mockResolvedValue(rollbackResult),
    recordedSteps,
  };
}

function makeMockOperationLog(entry: OperationLogEntry | null = makeEntry()): OperationLog {
  return {
    save: jest.fn().mockResolvedValue('/path/to/log.json'),
    loadLast: jest.fn().mockResolvedValue(entry),
    loadFrom: jest.fn().mockResolvedValue(entry),
  };
}

interface MakeDepsResult {
  deps: RollbackCommandDeps;
  stdout: PassThrough;
  rollbackManager: RollbackManager & { recordedSteps: RollbackStep[] };
  operationLog: OperationLog;
  interactionManager: InteractionManager;
}

function makeDeps(overrides: {
  entry?: OperationLogEntry | null;
  interactive?: boolean;
  confirmResult?: boolean;
  rollbackResult?: Partial<RollbackResult>;
  loadFromError?: Error;
  json?: boolean;
} = {}): MakeDepsResult {
  const entry = overrides.entry !== undefined ? overrides.entry : makeEntry();
  const interactive = overrides.interactive ?? false;
  const confirmResult = overrides.confirmResult ?? true;

  const stdout = new PassThrough();
  const reporter = createReporter({ json: overrides.json ?? false });
  const interactionManager = makeMockInteraction(interactive, confirmResult);
  const rollbackManager = makeMockRollbackManager(overrides.rollbackResult);
  const operationLog = makeMockOperationLog(entry);

  if (overrides.loadFromError) {
    (operationLog.loadFrom as jest.Mock).mockRejectedValue(overrides.loadFromError);
  }

  const executor = makeMockExecutor();

  const deps: RollbackCommandDeps = {
    operationLog,
    executor,
    createRollbackManager: jest.fn().mockReturnValue(rollbackManager),
    interactionManager,
    reporter,
    stdout,
  };

  return { deps, stdout, rollbackManager, operationLog, interactionManager };
}

function captureOutput(stream: PassThrough): () => string {
  let output = '';
  stream.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  return () => output;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('rollback.command', () => {
  describe('successful rollback', () => {
    it('loads last operation log and rolls back all steps', async () => {
      const entry = makeEntry();
      const { deps, rollbackManager, operationLog } = makeDeps({ entry });

      const result = await runRollbackCommand(makeOpts(), deps);

      expect(operationLog.loadLast).toHaveBeenCalledTimes(1);
      expect(rollbackManager.record).toHaveBeenCalledTimes(entry.steps.length);
      expect(rollbackManager.rollback).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.failedSteps).toEqual([]);
    });

    it('records all steps from log into rollback manager', async () => {
      const entry = makeEntry();
      const { deps, rollbackManager } = makeDeps({ entry });

      await runRollbackCommand(makeOpts(), deps);

      expect(rollbackManager.recordedSteps).toEqual(entry.steps);
    });

    it('writes success message to stdout', async () => {
      const { deps, stdout } = makeDeps();
      const getOutput = captureOutput(stdout);

      await runRollbackCommand(makeOpts(), deps);

      expect(getOutput()).toContain('Rollback completed successfully');
      expect(getOutput()).toContain('4 step(s) rolled back');
    });
  });

  describe('missing log (code 8)', () => {
    it('throws NO_OPERATION when loadLast returns null', async () => {
      const { deps } = makeDeps({ entry: null });

      await expect(runRollbackCommand(makeOpts(), deps)).rejects.toThrow(VersioningsError);

      try {
        await runRollbackCommand(makeOpts(), deps);
      } catch (err: any) {
        expect(err.code).toBe(EXIT_CODES.NO_OPERATION);
        expect(err.message).toContain('No operation log found');
      }
    });
  });

  describe('corrupted log (code 1)', () => {
    it('propagates CONFIG_ERROR from loadFrom on corrupted log', async () => {
      const corruptedError = new VersioningsError(
        EXIT_CODES.CONFIG_ERROR,
        'Corrupted operation log: /path/to/log.json — invalid JSON: Unexpected token',
        { filePath: '/path/to/log.json' },
      );
      const { deps } = makeDeps({ loadFromError: corruptedError });

      await expect(
        runRollbackCommand(makeOpts({ from: '/path/to/log.json' }), deps),
      ).rejects.toThrow(VersioningsError);

      try {
        await runRollbackCommand(makeOpts({ from: '/path/to/log.json' }), deps);
      } catch (err: any) {
        expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
        expect(err.message).toContain('Corrupted operation log');
      }
    });
  });

  describe('--from <file>', () => {
    it('loads log from specified file instead of last', async () => {
      const entry = makeEntry({ version: '2.0.0' });
      const { deps, operationLog } = makeDeps({ entry });

      await runRollbackCommand(makeOpts({ from: '/custom/path.json' }), deps);

      expect(operationLog.loadFrom).toHaveBeenCalledWith('/custom/path.json');
      expect(operationLog.loadLast).not.toHaveBeenCalled();
    });
  });

  describe('confirm flow (interactive mode)', () => {
    it('shows plan and confirms before rollback', async () => {
      const entry = makeEntry();
      const { deps, rollbackManager, interactionManager, stdout } = makeDeps({
        entry,
        interactive: true,
        confirmResult: true,
      });
      const getOutput = captureOutput(stdout);

      await runRollbackCommand(makeOpts(), deps);

      expect(interactionManager.isInteractive).toHaveBeenCalled();
      expect(interactionManager.confirm).toHaveBeenCalledTimes(1);
      expect(rollbackManager.rollback).toHaveBeenCalledTimes(1);
      expect(getOutput()).toContain('Rollback completed successfully');
    });

    it('throws USER_CANCELLED when user declines', async () => {
      const { deps, rollbackManager } = makeDeps({
        interactive: true,
        confirmResult: false,
      });

      await expect(runRollbackCommand(makeOpts(), deps)).rejects.toThrow(VersioningsError);

      try {
        await runRollbackCommand(makeOpts(), deps);
      } catch (err: any) {
        expect(err.code).toBe(EXIT_CODES.USER_CANCELLED);
        expect(err.message).toContain('cancelled');
      }

      expect(rollbackManager.rollback).not.toHaveBeenCalled();
    });

    it('skips confirm flow in non-interactive mode', async () => {
      const { deps, interactionManager, rollbackManager } = makeDeps({
        interactive: false,
      });

      await runRollbackCommand(makeOpts(), deps);

      expect(interactionManager.confirm).not.toHaveBeenCalled();
      expect(rollbackManager.rollback).toHaveBeenCalledTimes(1);
    });
  });

  describe('partial rollback', () => {
    it('throws INCOMPLETE_ROLLBACK when some steps fail', async () => {
      const failedStep: RollbackStep = { type: 'branch_created', meta: { name: 'version/patch/1.0.1/fix' } };
      const { deps, stdout } = makeDeps({
        rollbackResult: {
          success: false,
          failedSteps: [{ step: failedStep, error: new Error('git branch -D failed') }],
        },
      });
      const getOutput = captureOutput(stdout);

      await expect(runRollbackCommand(makeOpts(), deps)).rejects.toThrow(VersioningsError);

      try {
        await runRollbackCommand(makeOpts(), deps);
      } catch (err: any) {
        expect(err.code).toBe(EXIT_CODES.INCOMPLETE_ROLLBACK);
        expect(err.details.failedSteps).toHaveLength(1);
        expect(err.details.failedSteps[0].type).toBe('branch_created');
      }

      expect(getOutput()).toContain('partially completed');
      expect(getOutput()).toContain('Failed');
    });
  });
});
