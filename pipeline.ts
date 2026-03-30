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

export interface PipelineOpts {
  semver: string;
  branch: string;
  push: boolean;
  preid?: string;
  dryRun: boolean;
  json: boolean;
  verbose: boolean;
}

export interface PipelineDeps {
  executor: Executor;
  config: VersioningsConfig;
  rollbackManager: RollbackManager;
  artifactChecker: ArtifactChecker;
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
  const { executor, config, rollbackManager, artifactChecker } = deps;
  const { semver, branch, push, preid, dryRun } = opts;

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
    return plan;
  }

  // --- Stages 8–12: Mutation steps with rollback on error ---
  try {
    // Stage 8: npm version bump (real)
    await executor.run(npmCmd);
    rollbackManager.record({
      type: STEP_TYPES.NPM_VERSION_BUMP,
      meta: {},
    });

    // Stage 9: Create branch
    await executor.run(`git checkout -b ${branchName}`);
    rollbackManager.record({
      type: STEP_TYPES.BRANCH_CREATED,
      meta: { name: branchName },
    });

    // Stage 10: Create annotated tag
    await executor.run(`git tag --annotate ${tagName} --message "${commitMessage}"`);
    rollbackManager.record({
      type: STEP_TYPES.TAG_CREATED,
      meta: { name: tagName },
    });

    // Stage 11: Commit all changes
    await executor.run(`git commit --all --message "${commitMessage}"`);
    rollbackManager.record({
      type: STEP_TYPES.COMMITTED,
      meta: {},
    });

    // Stage 12: Push (optional)
    let pullRequestUrl: string | null = null;
    if (push) {
      await executor.run(`git push ${config.git.remote} ${branchName} --follow-tags`);
      rollbackManager.record({
        type: STEP_TYPES.PUSHED,
        meta: { branch: branchName, tag: tagName, remote: config.git.remote },
      });

      // Stage 13: Generate PR URL
      pullRequestUrl = generatePullRequestUrl(branchName, config);
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
    return result;
  } catch (error: any) {
    // Rollback all recorded mutation steps
    const rollbackResult = await rollbackManager.rollback();

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
