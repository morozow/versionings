// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { VersioningsError, EXIT_CODES } from './errors';
import type { PipelineOpts, PipelineDeps } from './pipeline';
import type { InteractionManager } from './interaction.manager';
import type { OperationLog, OperationLogEntry } from './operation.log';
import type { Reporter, PipelineResult, DryRunPlan } from './reporter';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface ReleaseCommandOpts {
  semver: string;
  branch: string;
  push: boolean;
  preid?: string;
  dryRun: boolean;
  json: boolean;
  verbose: boolean;
  prMode?: string;
  noPr?: boolean;
}

export interface ReleaseCommandDeps {
  runPipeline: (opts: PipelineOpts, deps: PipelineDeps) => Promise<any>;
  pipelineDeps: PipelineDeps;
  interactionManager: InteractionManager;
  operationLog: OperationLog;
  reporter: Reporter;
  stdout: NodeJS.WritableStream;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPipelineOpts(opts: ReleaseCommandOpts, dryRunOverride?: boolean): PipelineOpts {
  return {
    semver: opts.semver,
    branch: opts.branch,
    push: opts.push,
    preid: opts.preid,
    dryRun: dryRunOverride ?? opts.dryRun,
    json: opts.json,
    verbose: opts.verbose,
    prMode: opts.prMode as any,
    noPr: opts.noPr,
  };
}

function buildLogEntry(
  opts: ReleaseCommandOpts,
  result: PipelineResult,
): OperationLogEntry {
  const entry: OperationLogEntry = {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    semver: opts.semver,
    version: result.version,
    previousVersion: result.previousVersion,
    branch: result.branch,
    tag: result.tag,
    steps: [],
    result: 'success',
  };
  if (result.pullRequest) {
    entry.pullRequest = {
      url: result.pullRequest.url,
      number: result.pullRequest.number,
      status: result.pullRequest.status,
    };
  }
  return entry;
}

function buildFailedLogEntry(
  opts: ReleaseCommandOpts,
  plan: DryRunPlan | null,
  error: VersioningsError,
): OperationLogEntry {
  return {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    semver: opts.semver,
    version: plan?.nextVersion ?? 'unknown',
    previousVersion: plan?.currentVersion ?? 'unknown',
    branch: plan?.branch ?? 'unknown',
    tag: plan?.tag ?? 'unknown',
    steps: [],
    result: 'failed',
    error: { code: error.code, message: error.message },
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Executes the release workflow with Confirm Flow support.
 *
 * - In dry-run mode: delegates to pipeline with dryRun:true, no confirm flow.
 * - In interactive mode: shows plan → requests confirmation → executes or exits.
 * - In non-interactive mode: executes directly.
 * - After execution: saves operation log (success or failed).
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 10.5
 */
export async function runReleaseCommand(
  opts: ReleaseCommandOpts,
  deps: ReleaseCommandDeps,
): Promise<PipelineResult | DryRunPlan> {
  const { runPipeline, pipelineDeps, interactionManager, operationLog, reporter, stdout } = deps;

  // --- Dry-run: skip confirm flow, delegate directly ---
  if (opts.dryRun) {
    const plan = await runPipeline(buildPipelineOpts(opts, true), pipelineDeps) as DryRunPlan;
    const output = reporter.reportDryRun(plan);
    stdout.write(output + '\n');
    return plan;
  }

  // --- Interactive confirm flow ---
  let plan: DryRunPlan | null = null;

  if (interactionManager.isInteractive()) {
    // Get the plan first (dry-run)
    plan = await runPipeline(buildPipelineOpts(opts, true), pipelineDeps) as DryRunPlan;

    // Show plan and request confirmation
    const planOutput = reporter.reportConfirmPlan(plan);
    stdout.write(planOutput + '\n');

    const confirmed = await interactionManager.confirm(plan);
    if (!confirmed) {
      throw new VersioningsError(
        EXIT_CODES.USER_CANCELLED,
        'Release cancelled by user.',
      );
    }
  }

  // --- Execute pipeline ---
  try {
    const result = await runPipeline(buildPipelineOpts(opts, false), pipelineDeps) as PipelineResult;

    // Save operation log (best-effort)
    try {
      const entry = buildLogEntry(opts, result);
      await operationLog.save(entry);
    } catch (_) {
      // Best-effort: don't mask the successful result
    }

    const output = reporter.reportSuccess(result);
    stdout.write(output + '\n');
    return result;
  } catch (error: any) {
    // Save failed operation log (best-effort)
    const pipelineError = error instanceof VersioningsError
      ? error
      : new VersioningsError(EXIT_CODES.COMMAND_FAILED, error.message || String(error));

    try {
      const entry = buildFailedLogEntry(opts, plan, pipelineError);
      await operationLog.save(entry);
    } catch (_) {
      // Best-effort: don't mask the original error
    }

    throw pipelineError;
  }
}
