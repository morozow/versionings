// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import * as fs from 'fs';
import { EXIT_CODES, VersioningsError } from './errors';
import { STEP_TYPES } from './rollback';
import {
  composeVersionBranchName,
  composeVersionTagName,
  semverMessage,
  semverNpmMessage,
  preidParam,
  generatePullRequestUrl,
  AVAILABLE_SEMVERS,
} from './version.utils';
import type { Executor } from './executor';
import type { RollbackManager } from './rollback';
import type { ArtifactChecker } from './artifact.checker';
import type { VersioningsConfig } from './config.validator';
import type { PipelineResult, DryRunPlan } from './reporter';
import type { OperationLog, OperationLogEntry } from './operation.log';
import type { RollbackStep } from './rollback';
import type { PrCreatorDeps } from './pr.creator';
import type { PrMode } from './scm.provider';
import type { PR_Result } from './scm.provider';
import { createPR } from './pr.creator';

export interface PipelineOpts {
  semver: string;
  branch: string;
  push: boolean;
  preid?: string;
  dryRun: boolean;
  json: boolean;
  verbose: boolean;
  prMode?: PrMode;
  noPr?: boolean;
}

export interface PipelineDeps {
  executor: Executor;
  config: VersioningsConfig;
  rollbackManager: RollbackManager;
  artifactChecker: ArtifactChecker;
  operationLog?: OperationLog;
  prCreator?: PrCreatorDeps;
}

/**
 * Orchestrates the full versioning workflow as a sequence of async steps.
 *
 * Stages:
 *  1. Validate input parameters
 *  2. Check git status (dirty tree)
 *  3. Check git remote matches config
 *  4. Compute next version (probe via npm version, then undo)
 *  5. Compute branch name and tag name
 *  6. Check artifact uniqueness
 *  7. If dry-run: return DryRunPlan
 *  8–12. Mutation steps with rollback on error
 *  13. Return PipelineResult
 */
export async function runPipeline(
  opts: PipelineOpts,
  deps: PipelineDeps,
): Promise<PipelineResult | DryRunPlan> {
  const { executor, config, rollbackManager, artifactChecker, operationLog, prCreator } = deps;
  const { semver, branch, push, preid, dryRun, prMode, noPr } = opts;

  // --- Stage 1: Validate input parameters ---
  if (!semver || !AVAILABLE_SEMVERS.includes(semver)) {
    throw new VersioningsError(
      EXIT_CODES.INVALID_ARGS,
      config.common.messages.unavailableSemanticVersion,
    );
  }

  if (!branch || typeof branch !== 'string' || branch.trim().length === 0) {
    throw new VersioningsError(
      EXIT_CODES.INVALID_ARGS,
      config.common.messages.undefinedVersionBranchName,
    );
  }

  if (branch.length >= config.git.limits.branchMaxCommentLength) {
    throw new VersioningsError(
      EXIT_CODES.INVALID_ARGS,
      `${config.common.messages.incorrectVersionBranchNameLength} ${config.git.limits.branchMaxCommentLength} characters.`,
    );
  }

  if (/-{2,}/.test(branch)) {
    throw new VersioningsError(
      EXIT_CODES.INVALID_ARGS,
      config.common.messages.incorrectVersionBranchNameCharactersDashes,
    );
  }

  // --- Stage 2: Check git status ---
  const statusResult = await executor.run('git status --porcelain');
  if (statusResult.stdout.length > 0) {
    throw new VersioningsError(
      EXIT_CODES.DIRTY_TREE,
      config.common.messages.untrackedGitFiles,
    );
  }

  // --- Stage 3: Check git remote ---
  const remoteResult = await executor.run('git remote --verbose');
  const remoteLines = remoteResult.stdout.split('\n');
  const isCorrectGitUrl = remoteLines.some((line: string) =>
    line.split(/\s+/).some((part: string) => part.trim() === config.git.url),
  );
  if (!isCorrectGitUrl) {
    throw new VersioningsError(
      EXIT_CODES.CONFIG_ERROR,
      config.common.messages.incorrectGitRemote,
    );
  }

  // --- Stage 4: Compute next version ---
  // Read current version from package.json
  const pkgRaw = fs.readFileSync('./package.json', 'utf8');
  const currentVersion: string = JSON.parse(pkgRaw).version;

  // Probe: run npm version to get next version, then undo
  const npmCmd = `npm --no-git-tag-version version ${semver} --message "${semverNpmMessage(semver, branch, config)}" ${preidParam(preid)}`.trim();
  const versionResult = await executor.run(npmCmd);
  const nextVersion = versionResult.stdout.trim().replace(/^v/, '');

  // Undo the probe — restore package.json (and package-lock.json if it exists)
  const hasLockfile = fs.existsSync('./package-lock.json');
  const checkoutFiles = hasLockfile
    ? 'git checkout -- package.json package-lock.json'
    : 'git checkout -- package.json';
  await executor.run(checkoutFiles);

  // --- Stage 5: Compute branch name and tag name ---
  const branchName = composeVersionBranchName(semver, nextVersion, branch, config);
  const tagName = composeVersionTagName(semver, nextVersion, branch);
  const commitMessage = semverMessage(semver, nextVersion, config);

  // --- Stage 6: Check artifact uniqueness ---
  await artifactChecker.checkUniqueness({
    tagName,
    branchName,
    push: !!push,
    remote: config.git.remote,
  });

  // --- Stage 7: Dry-run — return plan without mutations ---
  if (dryRun) {
    const steps: string[] = [
      npmCmd,
      `git checkout -b ${branchName}`,
      `git tag --annotate ${tagName} --message "${commitMessage}"`,
      `git commit --all --message "${commitMessage}"`,
    ];
    if (push) {
      steps.push(`git push ${config.git.remote} ${branchName} --follow-tags`);
    }

    const pullRequestUrl = push ? generatePullRequestUrl(branchName, config) : null;

    const plan: DryRunPlan = {
      dryRun: true,
      currentVersion,
      nextVersion,
      semver,
      branch: branchName,
      tag: tagName,
      commitMessage,
      pullRequestUrl,
      steps,
    };

    // Add pullRequest info to dry-run plan when prCreator is available
    if (push && !noPr && prCreator) {
      const auth = prCreator.resolveAuth(
        { config: config as Record<string, any>, env: prCreator.env },
        config.git.platform || '',
      );
      const prCfg = config as any;
      plan.pullRequest = {
        mode: prMode || 'auto',
        platform: config.git.platform || '',
        reviewers: prCfg.git?.pr?.reviewers,
        labels: prCfg.git?.pr?.labels,
        draft: prCfg.git?.pr?.draft,
        hasToken: !!auth.token,
      };
    }

    return plan;
  }

  // --- Stages 8–12: Mutation steps with rollback on error ---
  const executedSteps: RollbackStep[] = [];
  try {
    // Stage 8: npm version bump (real)
    await executor.run(npmCmd);
    const npmStep: RollbackStep = { type: STEP_TYPES.NPM_VERSION_BUMP, meta: {} };
    rollbackManager.record(npmStep);
    executedSteps.push(npmStep);

    // Stage 9: Create branch
    await executor.run(`git checkout -b ${branchName}`);
    const branchStep: RollbackStep = { type: STEP_TYPES.BRANCH_CREATED, meta: { name: branchName } };
    rollbackManager.record(branchStep);
    executedSteps.push(branchStep);

    // Stage 10: Create annotated tag
    await executor.run(`git tag --annotate ${tagName} --message "${commitMessage}"`);
    const tagStep: RollbackStep = { type: STEP_TYPES.TAG_CREATED, meta: { name: tagName } };
    rollbackManager.record(tagStep);
    executedSteps.push(tagStep);

    // Stage 11: Commit all changes
    await executor.run(`git commit --all --message "${commitMessage}"`);
    const commitStep: RollbackStep = { type: STEP_TYPES.COMMITTED, meta: {} };
    rollbackManager.record(commitStep);
    executedSteps.push(commitStep);

    // Stage 12: Push (optional)
    let pullRequestUrl: string | null = null;
    let pullRequest: PR_Result | undefined = undefined;
    if (push) {
      await executor.run(`git push ${config.git.remote} ${branchName} --follow-tags`);
      const pushStep: RollbackStep = {
        type: STEP_TYPES.PUSHED,
        meta: { branch: branchName, tag: tagName, remote: config.git.remote },
      };
      rollbackManager.record(pushStep);
      executedSteps.push(pushStep);

      // Stage 13: Create PR/MR
      if (!noPr) {
        if (prCreator) {
          try {
            pullRequest = await createPR(
              config,
              branchName,
              commitMessage,
              prMode || 'auto',
              prCreator,
            );
            pullRequestUrl = pullRequest.url;
          } catch (err: any) {
            // PR error does not trigger rollback — pipeline completes with success=true
            pullRequestUrl = generatePullRequestUrl(branchName, config);
            pullRequest = {
              url: pullRequestUrl,
              number: null,
              status: 'fallback',
              fallbackReason: err instanceof Error ? err.message : String(err),
              platform: config.git.platform || '',
              warnings: [],
            };
          }
        } else {
          // Backward compatibility: no prCreator → use generatePullRequestUrl
          pullRequestUrl = generatePullRequestUrl(branchName, config);
        }
      }
    }

    // --- Stage 14: Return result ---
    const result: PipelineResult = {
      success: true,
      version: nextVersion,
      previousVersion: currentVersion,
      semver,
      branch: branchName,
      tag: tagName,
      pullRequestUrl,
      exitCode: EXIT_CODES.SUCCESS,
    };

    if (pullRequest) {
      result.pullRequest = pullRequest;
    }

    // Save operation log (best-effort)
    if (operationLog) {
      try {
        const entry: OperationLogEntry = {
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          semver,
          version: nextVersion,
          previousVersion: currentVersion,
          branch: branchName,
          tag: tagName,
          steps: executedSteps,
          result: 'success',
        };
        await operationLog.save(entry);
      } catch (_) {
        // best-effort: do not let log failure affect pipeline result
      }
    }

    return result;
  } catch (error: any) {
    // Rollback all recorded mutation steps
    const rollbackResult = await rollbackManager.rollback();

    // Save operation log on failure (best-effort)
    if (operationLog) {
      try {
        const entry: OperationLogEntry = {
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          semver,
          version: nextVersion,
          previousVersion: currentVersion,
          branch: branchName,
          tag: tagName,
          steps: executedSteps,
          result: 'failed',
          error: {
            code: error.code ?? EXIT_CODES.COMMAND_FAILED,
            message: error.message || String(error),
          },
        };
        await operationLog.save(entry);
      } catch (_) {
        // best-effort: do not let log failure mask original error
      }
    }

    if (!rollbackResult.success) {
      throw new VersioningsError(
        EXIT_CODES.INCOMPLETE_ROLLBACK,
        `Incomplete rollback after error: ${error.message}`,
        {
          originalError: error.message,
          originalCode: error.code ?? EXIT_CODES.COMMAND_FAILED,
          failedSteps: rollbackResult.failedSteps.map((fs) => ({
            type: fs.step.type,
            meta: fs.step.meta,
            error: fs.error.message,
          })),
        },
      );
    }

    // Rollback succeeded — re-throw original error
    if (error instanceof VersioningsError) {
      throw error;
    }
    throw new VersioningsError(
      EXIT_CODES.COMMAND_FAILED,
      error.message || String(error),
      { cmd: error.details?.cmd },
    );
  }
}
