// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import type { PipelineOpts, PipelineDeps } from '../../core/pipeline';
import type { Reporter, DryRunPlan } from '../../core/reporter';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface PlanCommandDeps {
  runPipeline: (opts: PipelineOpts, deps: PipelineDeps) => Promise<any>;
  pipelineDeps: PipelineDeps;
  reporter: Reporter;
  stdout: NodeJS.WritableStream;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Shows the execution plan without performing any mutations.
 * Delegates to pipeline.runPipeline with dryRun: true.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4
 */
export async function runPlanCommand(
  opts: { semver: string; branch: string; push: boolean; preid?: string; json: boolean; prMode?: string; noPr?: boolean },
  deps: PlanCommandDeps,
): Promise<DryRunPlan> {
  const pipelineOpts: PipelineOpts = {
    semver: opts.semver,
    branch: opts.branch,
    push: opts.push,
    preid: opts.preid,
    dryRun: true,
    json: opts.json,
    verbose: false,
    prMode: opts.prMode as any,
    noPr: opts.noPr,
  };

  const result = await deps.runPipeline(pipelineOpts, deps.pipelineDeps);
  const plan = result as DryRunPlan;

  const output = deps.reporter.reportDryRun(plan);
  deps.stdout.write(output + '\n');

  return plan;
}
