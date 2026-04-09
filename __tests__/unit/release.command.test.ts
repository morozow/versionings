// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { runReleaseCommand, ReleaseCommandOpts, ReleaseCommandDeps } from '../../release.command';
import { DryRunPlan, PipelineResult, createReporter } from '../../reporter';
import { PipelineOpts, PipelineDeps } from '../../pipeline';
import { InteractionManager } from '../../interaction.manager';
import { OperationLog } from '../../operation.log';
import { VersioningsError, EXIT_CODES } from '../../errors';
import { PassThrough } from 'stream';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlan(overrides: Partial<DryRunPlan> = {}): DryRunPlan {
  return {
    dryRun: true,
    currentVersion: '1.0.0',
    nextVersion: '1.0.1',
    semver: 'patch',
    branch: 'version/patch/1.0.1/fix',
    tag: '1.0.1--fix',
    commitMessage: 'patch version 1.0.1',
    pullRequestUrl: null,
    steps: [
      'npm --no-git-tag-version version patch --message "patch version 1.0.1"',
      'git checkout -b version/patch/1.0.1/fix',
    ],
    ...overrides,
  };
}

function makeResult(overrides: Partial<PipelineResult> = {}): PipelineResult {
  return {
    success: true,
    version: '1.0.1',
    previousVersion: '1.0.0',
    semver: 'patch',
    branch: 'version/patch/1.0.1/fix',
    tag: '1.0.1--fix',
    pullRequestUrl: null,
    exitCode: EXIT_CODES.SUCCESS,
    ...overrides,
  };
}

function makeOpts(overrides: Partial<ReleaseCommandOpts> = {}): ReleaseCommandOpts {
  return {
    semver: 'patch',
    branch: 'fix',
    push: false,
    dryRun: false,
    json: false,
    verbose: false,
    ...overrides,
  };
}

function makeMockInteraction(interactive: boolean, confirmResult = true): InteractionManager {
  return {
    isInteractive: jest.fn().mockReturnValue(interactive),
    confirm: jest.fn().mockResolvedValue(confirmResult),
  };
}

function makeMockOperationLog(): OperationLog & { saveMock: jest.Mock } {
  const saveMock = jest.fn().mockResolvedValue('/path/to/log.json');
  return {
    save: saveMock,
    loadLast: jest.fn().mockResolvedValue(null),
    loadFrom: jest.fn().mockRejectedValue(new Error('not found')),
    saveMock,
  };
}

interface MakeDepsResult {
  deps: ReleaseCommandDeps;
  stdout: PassThrough;
  runPipelineMock: jest.Mock;
  interactionManager: InteractionManager;
  operationLog: OperationLog & { saveMock: jest.Mock };
}

function makeDeps(overrides: {
  plan?: DryRunPlan;
  result?: PipelineResult;
  interactive?: boolean;
  confirmResult?: boolean;
  json?: boolean;
  pipelineError?: Error;
} = {}): MakeDepsResult {
  const plan = overrides.plan ?? makePlan();
  const result = overrides.result ?? makeResult();
  const interactive = overrides.interactive ?? false;
  const confirmResult = overrides.confirmResult ?? true;

  const runPipelineMock = jest.fn().mockImplementation((opts: PipelineOpts) => {
    if (overrides.pipelineError && !opts.dryRun) {
      return Promise.reject(overrides.pipelineError);
    }
    return opts.dryRun ? Promise.resolve(plan) : Promise.resolve(result);
  });

  const stdout = new PassThrough();
  const reporter = createReporter({ json: overrides.json ?? false });
  const interactionManager = makeMockInteraction(interactive, confirmResult);
  const operationLog = makeMockOperationLog();

  const deps: ReleaseCommandDeps = {
    runPipeline: runPipelineMock,
    pipelineDeps: {} as PipelineDeps,
    interactionManager,
    operationLog,
    reporter,
    stdout,
  };

  return { deps, stdout, runPipelineMock, interactionManager, operationLog };
}

function captureOutput(stream: PassThrough): () => string {
  let output = '';
  stream.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  return () => output;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('release.command', () => {
  describe('successful release (non-interactive)', () => {
    it('executes pipeline and returns result', async () => {
      const result = makeResult({ version: '2.0.0' });
      const { deps, runPipelineMock } = makeDeps({ result });

      const returned = await runReleaseCommand(makeOpts(), deps);

      expect(runPipelineMock).toHaveBeenCalledTimes(1);
      expect((returned as PipelineResult).version).toBe('2.0.0');
    });

    it('passes all parameters to pipeline', async () => {
      const { deps, runPipelineMock } = makeDeps();

      await runReleaseCommand(
        makeOpts({ semver: 'minor', branch: 'feat', push: true, preid: 'beta', verbose: true }),
        deps,
      );

      const [pipelineOpts] = runPipelineMock.mock.calls[0];
      expect(pipelineOpts).toMatchObject({
        semver: 'minor',
        branch: 'feat',
        push: true,
        preid: 'beta',
        dryRun: false,
        verbose: true,
      });
    });

    it('writes success output to stdout', async () => {
      const { deps, stdout } = makeDeps();
      const getOutput = captureOutput(stdout);

      await runReleaseCommand(makeOpts(), deps);

      expect(getOutput()).toContain('1.0.1');
    });
  });

  describe('confirm flow (interactive mode)', () => {
    it('shows plan and confirms before executing', async () => {
      const plan = makePlan();
      const result = makeResult();
      const { deps, runPipelineMock, interactionManager, stdout } = makeDeps({
        plan,
        result,
        interactive: true,
        confirmResult: true,
      });
      const getOutput = captureOutput(stdout);

      await runReleaseCommand(makeOpts(), deps);

      // First call: dry-run for plan; second call: actual execution
      expect(runPipelineMock).toHaveBeenCalledTimes(2);
      expect(runPipelineMock.mock.calls[0][0].dryRun).toBe(true);
      expect(runPipelineMock.mock.calls[1][0].dryRun).toBe(false);
      expect(interactionManager.confirm).toHaveBeenCalledWith(plan);
      expect(getOutput()).toContain('1.0.1');
    });

    it('throws USER_CANCELLED when user declines', async () => {
      const { deps } = makeDeps({
        interactive: true,
        confirmResult: false,
      });

      await expect(runReleaseCommand(makeOpts(), deps)).rejects.toThrow(VersioningsError);

      try {
        await runReleaseCommand(makeOpts(), deps);
      } catch (err: any) {
        expect(err.code).toBe(EXIT_CODES.USER_CANCELLED);
        expect(err.message).toContain('cancelled');
      }
    });

    it('does not execute pipeline when user declines', async () => {
      const { deps, runPipelineMock } = makeDeps({
        interactive: true,
        confirmResult: false,
      });

      try {
        await runReleaseCommand(makeOpts(), deps);
      } catch (_) {
        // expected
      }

      // Only the dry-run call, no execution call
      expect(runPipelineMock).toHaveBeenCalledTimes(1);
      expect(runPipelineMock.mock.calls[0][0].dryRun).toBe(true);
    });
  });

  describe('non-interactive mode', () => {
    it('skips confirm flow and executes directly', async () => {
      const { deps, runPipelineMock, interactionManager } = makeDeps({
        interactive: false,
      });

      await runReleaseCommand(makeOpts(), deps);

      // Only one pipeline call (no dry-run preflight)
      expect(runPipelineMock).toHaveBeenCalledTimes(1);
      expect(runPipelineMock.mock.calls[0][0].dryRun).toBe(false);
      expect(interactionManager.confirm).not.toHaveBeenCalled();
    });
  });

  describe('operation log saving', () => {
    it('saves log on successful release', async () => {
      const { deps, operationLog } = makeDeps();

      await runReleaseCommand(makeOpts(), deps);

      expect(operationLog.saveMock).toHaveBeenCalledTimes(1);
      const entry = operationLog.saveMock.mock.calls[0][0];
      expect(entry.result).toBe('success');
      expect(entry.schemaVersion).toBe(1);
      expect(entry.version).toBe('1.0.1');
      expect(entry.semver).toBe('patch');
    });

    it('saves log on failed release', async () => {
      const pipelineError = new VersioningsError(EXIT_CODES.COMMAND_FAILED, 'git push failed');
      const { deps, operationLog } = makeDeps({ pipelineError });

      await expect(runReleaseCommand(makeOpts(), deps)).rejects.toThrow('git push failed');

      expect(operationLog.saveMock).toHaveBeenCalledTimes(1);
      const entry = operationLog.saveMock.mock.calls[0][0];
      expect(entry.result).toBe('failed');
      expect(entry.error).toEqual({ code: EXIT_CODES.COMMAND_FAILED, message: 'git push failed' });
    });

    it('does not mask pipeline error if log save fails', async () => {
      const pipelineError = new VersioningsError(EXIT_CODES.DIRTY_TREE, 'dirty tree');
      const { deps, operationLog } = makeDeps({ pipelineError });
      operationLog.saveMock.mockRejectedValue(new Error('disk full'));

      await expect(runReleaseCommand(makeOpts(), deps)).rejects.toThrow('dirty tree');
    });

    it('does not mask success if log save fails', async () => {
      const { deps, operationLog } = makeDeps();
      operationLog.saveMock.mockRejectedValue(new Error('disk full'));

      const result = await runReleaseCommand(makeOpts(), deps);
      expect((result as PipelineResult).success).toBe(true);
    });
  });

  describe('dry-run mode', () => {
    it('delegates to pipeline with dryRun: true', async () => {
      const plan = makePlan({ nextVersion: '3.0.0' });
      const { deps, runPipelineMock } = makeDeps({ plan });

      const result = await runReleaseCommand(makeOpts({ dryRun: true }), deps);

      expect(runPipelineMock).toHaveBeenCalledTimes(1);
      expect(runPipelineMock.mock.calls[0][0].dryRun).toBe(true);
      expect((result as DryRunPlan).nextVersion).toBe('3.0.0');
    });

    it('skips confirm flow in dry-run mode', async () => {
      const { deps, interactionManager } = makeDeps({ interactive: true });

      await runReleaseCommand(makeOpts({ dryRun: true }), deps);

      expect(interactionManager.isInteractive).not.toHaveBeenCalled();
      expect(interactionManager.confirm).not.toHaveBeenCalled();
    });

    it('does not save operation log in dry-run mode', async () => {
      const { deps, operationLog } = makeDeps();

      await runReleaseCommand(makeOpts({ dryRun: true }), deps);

      expect(operationLog.saveMock).not.toHaveBeenCalled();
    });

    it('writes dry-run output to stdout', async () => {
      const { deps, stdout } = makeDeps();
      const getOutput = captureOutput(stdout);

      await runReleaseCommand(makeOpts({ dryRun: true }), deps);

      expect(getOutput()).toContain('Dry run');
    });
  });
});
