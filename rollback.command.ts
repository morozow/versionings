// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { VersioningsError, EXIT_CODES } from './errors';
import type { OperationLog, OperationLogEntry } from './operation.log';
import type { Executor } from './executor';
import type { RollbackManager, RollbackResult } from './rollback';
import type { InteractionManager } from './interaction.manager';
import type { Reporter, DryRunPlan } from './reporter';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface RollbackCommandOpts {
  from?: string;
  json: boolean;
  ci: boolean;
  yes: boolean;
}

export interface RollbackCommandDeps {
  operationLog: OperationLog;
  executor: Executor;
  createRollbackManager: (executor: Executor) => RollbackManager;
  interactionManager: InteractionManager;
  reporter: Reporter;
  stdout: NodeJS.WritableStream;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildConfirmPlan(entry: OperationLogEntry): DryRunPlan {
  const stepDescriptions = entry.steps.map(
    (s, i) => `Rollback step ${i + 1}: undo ${s.type}`,
  );
  return {
    dryRun: false,
    currentVersion: entry.version,
    nextVersion: entry.previousVersion,
    semver: entry.semver,
    branch: entry.branch,
    tag: entry.tag,
    commitMessage: `Rollback ${entry.semver} ${entry.version}`,
    pullRequestUrl: null,
    steps: stepDescriptions,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Executes rollback of the last (or specified) operation.
 *
 * - Loads operation log (last or from --from file)
 * - Missing log → VersioningsError(NO_OPERATION, code 8)
 * - Corrupted log → VersioningsError(CONFIG_ERROR) with diagnostics
 * - Interactive mode: display steps + confirm
 * - Rollback all steps in reverse order via rollbackManager
 * - Output: rolled back steps and failed steps
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.8, 10.9
 */
export async function runRollbackCommand(
  opts: RollbackCommandOpts,
  deps: RollbackCommandDeps,
): Promise<RollbackResult> {
  const {
    operationLog,
    executor,
    createRollbackManager: createMgr,
    interactionManager,
    reporter,
    stdout,
  } = deps;

  // --- Load operation log ---
  let entry: OperationLogEntry | null;

  if (opts.from) {
    // --from <file>: load from specified file (throws on corrupted)
    entry = await operationLog.loadFrom(opts.from);
  } else {
    entry = await operationLog.loadLast();
  }

  if (entry === null) {
    throw new VersioningsError(
      EXIT_CODES.NO_OPERATION,
      'No operation log found. Nothing to rollback.',
    );
  }

  // --- Interactive confirm flow ---
  if (interactionManager.isInteractive()) {
    const plan = buildConfirmPlan(entry);
    const planOutput = reporter.reportConfirmPlan(plan);
    stdout.write(planOutput + '\n');

    const confirmed = await interactionManager.confirm(plan);
    if (!confirmed) {
      throw new VersioningsError(
        EXIT_CODES.USER_CANCELLED,
        'Rollback cancelled by user.',
      );
    }
  }

  // --- Create fresh rollback manager and record steps from log ---
  const rollbackManager = createMgr(executor);
  for (const step of entry.steps) {
    rollbackManager.record(step);
  }

  // --- Execute rollback ---
  const result = await rollbackManager.rollback();

  // --- Report results ---
  const lines: string[] = [];
  if (result.success) {
    lines.push(`Rollback completed successfully. ${entry.steps.length} step(s) rolled back.`);
  } else {
    const rolledBack = entry.steps.length - result.failedSteps.length;
    lines.push(`Rollback partially completed. ${rolledBack} step(s) rolled back, ${result.failedSteps.length} step(s) failed.`);
    for (const fs of result.failedSteps) {
      lines.push(`  Failed: ${fs.step.type} — ${fs.error.message}`);
    }
  }
  stdout.write(lines.join('\n') + '\n');

  if (!result.success) {
    throw new VersioningsError(
      EXIT_CODES.INCOMPLETE_ROLLBACK,
      'Incomplete rollback: some steps could not be undone.',
      {
        failedSteps: result.failedSteps.map((fs) => ({
          type: fs.step.type,
          meta: fs.step.meta,
          error: fs.error.message,
        })),
      },
    );
  }

  return result;
}
