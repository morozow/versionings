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
} from '../versioning/version.utils';
import type { Executor } from './executor';
import type { RollbackManager } from './rollback';
import type { ArtifactChecker } from './artifact.checker';
import type { VersioningsConfig } from '../config/config.validator';
import type { PipelineResult, DryRunPlan } from './reporter';
import type { OperationLog, OperationLogEntry } from './operation.log';
import type { RollbackStep } from './rollback';
import type { PrCreatorDeps } from '../scm/pr.creator';
import type { PrMode } from '../scm/scm.provider';
import type { PR_Result } from '../scm/scm.provider';
import type { Strategy_Registry } from '../branching/strategy.registry';
import type { PolicyCheckResult, PolicyCheckerDeps } from '../branching/policy.checker';
import type { Branching_Strategy, BranchResult } from '../branching/branching.strategy';
import { createPR } from '../scm/pr.creator';
import type { BumpResult, BumpPolicy, CommitAnalyzerDeps } from '../versioning/commit.analyzer';
import type { ChangelogOpts, ChangelogResult } from '../versioning/changelog.generator';

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
  strategyRegistry?: Strategy_Registry;
  policyChecker?: (targetBranch: string, deps: PolicyCheckerDeps) => Promise<PolicyCheckResult>;
  commitAnalyzer?: {
    analyzeBump: (deps: CommitAnalyzerDeps) => Promise<BumpResult>;
    bumpPolicy: BumpPolicy;
    fallbackBump: 'major' | 'minor' | 'patch' | null;
  };
  changelogGenerator?: {
    generateChangelog: (commits: any[], opts: ChangelogOpts) => ChangelogResult;
    changelogConfig: ChangelogOpts;
    changelogFile?: string;
  };
}

/**
 * Computes the new file content when prepending a changelog section.
 *
 * - If existingContent is null (file doesn't exist): creates `# Changelog\n\n<newSection>`
 * - If existingContent starts with `# Changelog`: inserts newSection after the header, preserving the rest
 * - Otherwise: prepends newSection before existingContent
 *
 * Pure function, no side effects.
 */
export function prependChangelogContent(
  existingContent: string | null,
  newSection: string,
): string {
  const changelogHeader = '# Changelog';

  if (existingContent === null) {
    return `${changelogHeader}\n\n${newSection}`;
  }

  if (existingContent.startsWith(changelogHeader)) {
    const headerEnd = existingContent.indexOf('\n');
    if (headerEnd === -1) {
      return `${changelogHeader}\n\n${newSection}`;
    }
    const afterHeader = existingContent.slice(headerEnd + 1);
    return `${changelogHeader}\n\n${newSection}\n${afterHeader}`;
  }

  return `${newSection}\n${existingContent}`;
}

/**
 * Orchestrates the full versioning workflow as a sequence of async steps.
 *
 * Stages:
 *  0.5. Auto-bump resolution (when semver === 'auto')
 *  1. Validate input parameters
 *  2. Check git status (dirty tree)
 *  3. Check git remote matches config
 *  4. Compute next version (probe via npm version, then undo)
 *  5. Compute branch name and tag name
 *  6. Check artifact uniqueness
 *  7. If dry-run: return DryRunPlan
 *  8–12. Mutation steps with rollback on error
 *  10.5. Write changelog to file (when configured)
 *  13. Return PipelineResult
 */
export async function runPipeline(
  opts: PipelineOpts,
  deps: PipelineDeps,
): Promise<PipelineResult | DryRunPlan> {
  const { executor, config, rollbackManager, artifactChecker, operationLog, prCreator, strategyRegistry, policyChecker, commitAnalyzer, changelogGenerator } = deps;
  const { semver, branch, push, preid, dryRun, prMode, noPr } = opts;

  // --- Stage 0.5: Auto-bump resolution (when semver === 'auto') ---
  let resolvedSemver = semver;
  let bumpResult: BumpResult | undefined;
  let changelogText: string | undefined;
  let autoBumpInfo: import('./reporter').AutoBumpInfo | undefined;

  if (semver === 'auto') {
    if (!commitAnalyzer) {
      throw new VersioningsError(
        EXIT_CODES.CONFIG_ERROR,
        'semver=auto requires commitAnalyzer dependency',
      );
    }

    bumpResult = await commitAnalyzer.analyzeBump({
      executor,
      bumpPolicy: commitAnalyzer.bumpPolicy,
      fallbackBump: commitAnalyzer.fallbackBump,
    });

    resolvedSemver = bumpResult.bump;

    // Convert bump to prerelease modifier when --preid is present
    if (preid) {
      const preMap: Record<string, string> = { major: 'premajor', minor: 'preminor', patch: 'prepatch' };
      resolvedSemver = preMap[resolvedSemver] || resolvedSemver;
    }

    // Generate changelog when changelogGenerator is present
    if (changelogGenerator) {
      const result = changelogGenerator.generateChangelog(
        bumpResult.commits,
        changelogGenerator.changelogConfig,
      );
      changelogText = result.markdown;
    }

    autoBumpInfo = {
      detectedBump: bumpResult.bump,
      totalCommits: bumpResult.commits.length,
      breakingChanges: bumpResult.breakingChanges.length,
      commitsByType: bumpResult.commitsByType,
      range: { from: bumpResult.range.from, to: bumpResult.range.to },
    };
  }

  // --- Stage 1: Validate input parameters ---
  if (!resolvedSemver || !AVAILABLE_SEMVERS.includes(resolvedSemver)) {
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
  const npmCmd = `npm --no-git-tag-version version ${resolvedSemver} --message "${semverNpmMessage(resolvedSemver, branch, config)}" ${preidParam(preid)}`.trim();
  const versionResult = await executor.run(npmCmd);
  const nextVersion = versionResult.stdout.trim().replace(/^v/, '');

  // Undo the probe — restore package.json (and package-lock.json if it exists)
  const hasLockfile = fs.existsSync('./package-lock.json');
  const checkoutFiles = hasLockfile
    ? 'git checkout -- package.json package-lock.json'
    : 'git checkout -- package.json';
  await executor.run(checkoutFiles);

  // --- Stage 3.5: Get strategy and generate names ---
  let branchResult: BranchResult;
  let tagName: string;
  let commitMessage: string;
  let currentBranch = '';
  let strategyName: string | undefined;
  let policyResult: PolicyCheckResult | undefined;

  if (strategyRegistry) {
    // Strategy-based name generation
    const currentBranchResult = await executor.run('git rev-parse --abbrev-ref HEAD');
    currentBranch = currentBranchResult.stdout.trim();

    strategyName = (config as any).git?.branching?.strategy || 'default';
    const strategy: Branching_Strategy = strategyRegistry.getStrategy(strategyName!, config);

    const strategyParams = { semver: resolvedSemver, version: nextVersion, comment: branch, config, currentBranch };

    const validation = strategy.validateContext(strategyParams);
    if (!validation.valid) {
      throw new VersioningsError(EXIT_CODES.INVALID_ARGS, validation.errors.join('; '));
    }

    branchResult = strategy.composeBranchName(strategyParams);
    tagName = strategy.composeTagName(strategyParams);
    commitMessage = strategy.composeCommitMessage(strategyParams);
  } else {
    // Backward compatibility: use legacy functions
    branchResult = { branchName: composeVersionBranchName(resolvedSemver, nextVersion, branch, config), reuseBranch: false };
    tagName = composeVersionTagName(resolvedSemver, nextVersion, branch);
    commitMessage = semverMessage(resolvedSemver, nextVersion, config);
  }

  const branchName = branchResult.branchName;

  // --- Stage 3.7: Policy Check ---
  if (policyChecker) {
    const targetBranch = branchResult.branchName || currentBranch;
    policyResult = await policyChecker(targetBranch, { executor, config } as any);
    if (policyResult.errors.length > 0) {
      throw new VersioningsError(EXIT_CODES.POLICY_VIOLATION, policyResult.errors.join('; '));
    }
    // Warnings: output to stderr
    if (policyResult.warnings.length > 0) {
      for (const warning of policyResult.warnings) {
        process.stderr.write(`Warning: ${warning}\n`);
      }
    }
  }

  // --- Stage 6: Check artifact uniqueness ---
  await artifactChecker.checkUniqueness({
    tagName,
    branchName: branchResult.branchName,
    push: !!push,
    remote: config.git.remote,
    skipBranchCheck: branchResult.reuseBranch,
  });

  // --- Stage 7: Dry-run — return plan without mutations ---
  if (dryRun) {
    const steps: string[] = [
      npmCmd,
    ];
    if (branchResult.branchName === null) {
      // trunk-based: no branch creation
    } else if (branchResult.reuseBranch) {
      steps.push(`git checkout ${branchResult.branchName}`);
    } else {
      steps.push(`git checkout -b ${branchResult.branchName}`);
    }
    steps.push(`git tag --annotate ${tagName} --message "${commitMessage}"`);

    // Changelog file write step (dry-run)
    if (changelogText && changelogGenerator?.changelogFile) {
      steps.push(`write changelog to ${changelogGenerator.changelogFile}`);
      steps.push(`git add ${changelogGenerator.changelogFile}`);
    }

    steps.push(`git commit --all --message "${commitMessage}"`);
    if (push) {
      const pushBranch = branchResult.branchName || currentBranch;
      steps.push(`git push ${config.git.remote} ${pushBranch} --follow-tags`);
    }

    const pullRequestUrl = push ? generatePullRequestUrl(branchResult.branchName || currentBranch, config) : null;

    const plan: DryRunPlan = {
      dryRun: true,
      currentVersion,
      nextVersion,
      semver: resolvedSemver,
      branch: branchResult.branchName || currentBranch,
      tag: tagName,
      commitMessage,
      pullRequestUrl,
      steps,
    };

    // Add autoBump info when semver was 'auto'
    if (autoBumpInfo) {
      plan.autoBump = autoBumpInfo;
    }

    // Add changelog preview (first 50 lines)
    if (changelogText) {
      const lines = changelogText.split('\n');
      plan.changelogPreview = lines.slice(0, 50).join('\n');
    }

    // Add strategy and policyCheck to dry-run plan if available
    if (strategyName) {
      (plan as any).strategy = strategyName;
    }
    if (policyResult) {
      (plan as any).policyCheck = policyResult;
    }

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

    // Stage 9: Create branch (strategy-aware)
    if (branchResult.branchName !== null) {
      if (branchResult.reuseBranch) {
        await executor.run(`git checkout ${branchResult.branchName}`);
        const branchStep: RollbackStep = { type: STEP_TYPES.BRANCH_SWITCHED, meta: { previousBranch: currentBranch } };
        rollbackManager.record(branchStep);
        executedSteps.push(branchStep);
      } else {
        await executor.run(`git checkout -b ${branchResult.branchName}`);
        const branchStep: RollbackStep = { type: STEP_TYPES.BRANCH_CREATED, meta: { name: branchResult.branchName } };
        rollbackManager.record(branchStep);
        executedSteps.push(branchStep);
      }
    }

    // Stage 10: Create annotated tag
    await executor.run(`git tag --annotate ${tagName} --message "${commitMessage}"`);
    const tagStep: RollbackStep = { type: STEP_TYPES.TAG_CREATED, meta: { name: tagName } };
    rollbackManager.record(tagStep);
    executedSteps.push(tagStep);

    // Stage 10.5: Write changelog to file (before git commit)
    if (changelogText && changelogGenerator?.changelogFile) {
      const changelogFile = changelogGenerator.changelogFile;
      const existingContent = fs.existsSync(changelogFile)
        ? fs.readFileSync(changelogFile, 'utf8')
        : null;
      const fileContent = prependChangelogContent(existingContent, changelogText);

      fs.writeFileSync(changelogFile, fileContent, 'utf8');
      await executor.run(`git add ${changelogFile}`);
    }

    // Stage 11: Commit all changes
    await executor.run(`git commit --all --message "${commitMessage}"`);
    const commitStep: RollbackStep = { type: STEP_TYPES.COMMITTED, meta: {} };
    rollbackManager.record(commitStep);
    executedSteps.push(commitStep);

    // Stage 12: Push (optional)
    let pullRequestUrl: string | null = null;
    let pullRequest: PR_Result | undefined = undefined;
    if (push) {
      const pushBranch = branchResult.branchName || currentBranch;
      await executor.run(`git push ${config.git.remote} ${pushBranch} --follow-tags`);
      const pushStep: RollbackStep = {
        type: STEP_TYPES.PUSHED,
        meta: { branch: pushBranch, tag: tagName, remote: config.git.remote },
      };
      rollbackManager.record(pushStep);
      executedSteps.push(pushStep);

      // Stage 13: Create PR/MR
      if (!noPr) {
        const prBranch = branchResult.branchName || currentBranch;
        if (prCreator) {
          try {
            // Pass changelogText as PR body when available
            const prDeps = changelogText
              ? { ...prCreator, changelogBody: changelogText }
              : prCreator;
            pullRequest = await createPR(
              config,
              prBranch,
              commitMessage,
              prMode || 'auto',
              prDeps,
            );
            pullRequestUrl = pullRequest.url;
          } catch (err: any) {
            // PR error does not trigger rollback — pipeline completes with success=true
            pullRequestUrl = generatePullRequestUrl(prBranch, config);
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
          pullRequestUrl = generatePullRequestUrl(prBranch, config);
        }
      }
    }

    // --- Stage 14: Return result ---
    const result: PipelineResult = {
      success: true,
      version: nextVersion,
      previousVersion: currentVersion,
      semver: resolvedSemver,
      branch: branchResult.branchName || currentBranch,
      tag: tagName,
      pullRequestUrl,
      exitCode: EXIT_CODES.SUCCESS,
    };

    // Add autoBump info when semver was 'auto'
    if (autoBumpInfo) {
      result.autoBump = autoBumpInfo;
    }

    if (strategyName) {
      (result as any).strategy = strategyName;
    }

    if (pullRequest) {
      result.pullRequest = pullRequest;
    }

    // Save operation log (best-effort)
    if (operationLog) {
      try {
        const entry: OperationLogEntry = {
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          semver: resolvedSemver,
          version: nextVersion,
          previousVersion: currentVersion,
          branch: branchResult.branchName || currentBranch,
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
          semver: resolvedSemver,
          version: nextVersion,
          previousVersion: currentVersion,
          branch: branchResult.branchName || currentBranch,
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
