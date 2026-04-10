// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * Git-Flow Branching Strategy — release and hotfix branches per git-flow conventions.
 *
 * minor/major/preminor/premajor/prerelease → branch `release/{version}` from develop
 * patch/prepatch → branch `hotfix/{version}` from main/master
 * Tag:    v{version} (default) or custom tagTemplate
 * Commit: templates from git.commit.message.semver
 *
 * Validates that the current branch matches the expected source branch for the operation type:
 * - release branches must be created from developBranch (default 'develop')
 * - hotfix branches must be created from mainBranch (default 'master') or 'main'
 */

import type {
  Branching_Strategy,
  StrategyParams,
  BranchResult,
  StrategyValidationResult,
} from './branching.strategy';
import type { VersioningsConfig } from './config.validator';
import { renderTemplate } from './template.renderer';
import type { TemplateContext } from './template.renderer';

/** Semver types that route to release branches */
const RELEASE_TYPES: ReadonlySet<string> = new Set([
  'minor', 'major', 'preminor', 'premajor', 'prerelease',
]);

/** Semver types that route to hotfix branches */
const HOTFIX_TYPES: ReadonlySet<string> = new Set([
  'patch', 'prepatch',
]);

/**
 * Builds a TemplateContext from StrategyParams for use with Template_Renderer.
 */
function buildTemplateContext(params: StrategyParams): TemplateContext {
  const parts = params.version.split('.');
  return {
    version: params.version,
    major: parts[0] || '0',
    minor: parts[1] || '0',
    patch: parts[2] || '0',
    semver: params.config.package.semver[params.semver as keyof typeof params.config.package.semver] || params.semver,
    comment: params.comment,
    branchType: params.config.git.branchType.version || 'version',
  };
}

/**
 * Creates a Git-Flow Branching Strategy.
 *
 * When `git.branching.strategy` is "git-flow", this strategy is used.
 * minor/major/preminor/premajor/prerelease → release/{version} from develop
 * patch/prepatch → hotfix/{version} from main/master
 * Tag defaults to `v{version}` unless a custom tagTemplate is provided.
 */
export function createGitFlowStrategy(config: VersioningsConfig): Branching_Strategy {
  return {
    name(): string {
      return 'git-flow';
    },

    composeBranchName(params: StrategyParams): BranchResult {
      // Check for custom branchTemplate
      const branchTemplate = (config as any).git?.branching?.branchTemplate;
      if (branchTemplate) {
        const ctx = buildTemplateContext(params);
        return { branchName: renderTemplate(branchTemplate, ctx), reuseBranch: false };
      }

      // Git-flow routing: release types → release/{version}, hotfix types → hotfix/{version}
      const prefix = RELEASE_TYPES.has(params.semver) ? 'release' : 'hotfix';
      return { branchName: `${prefix}/${params.version}`, reuseBranch: false };
    },

    composeTagName(params: StrategyParams): string {
      // Check for custom tagTemplate
      const tagTemplate = (config as any).git?.branching?.tagTemplate;
      if (tagTemplate) {
        const ctx = buildTemplateContext(params);
        return renderTemplate(tagTemplate, ctx);
      }

      // Default: v{version}
      return `v${params.version}`;
    },

    composeCommitMessage(params: StrategyParams): string {
      const tpl = params.config.git.commit.message.semver[
        params.semver as keyof typeof params.config.git.commit.message.semver
      ];
      return tpl
        ? tpl.replace(/v%s/g, params.version)
        : 'Read documentation and try to use versioning tool according to the standard.';
    },

    validateContext(params: StrategyParams): StrategyValidationResult {
      const developBranch = (config as any).git?.branching?.developBranch || 'develop';
      const mainBranch = (config as any).git?.branching?.mainBranch || 'master';
      const current = params.currentBranch;

      if (RELEASE_TYPES.has(params.semver)) {
        // Release branches must be created from develop
        if (current === developBranch) {
          return { valid: true, errors: [] };
        }
        return {
          valid: false,
          errors: [
            `Git-flow strategy requires current branch to be "${developBranch}" for ${params.semver} releases, but got "${current}"`,
          ],
        };
      }

      if (HOTFIX_TYPES.has(params.semver)) {
        // Hotfix branches must be created from main/master
        if (current === mainBranch || current === 'main') {
          return { valid: true, errors: [] };
        }
        return {
          valid: false,
          errors: [
            `Git-flow strategy requires current branch to be "${mainBranch}" or "main" for ${params.semver} hotfixes, but got "${current}"`,
          ],
        };
      }

      // Unknown semver type — should not happen, but be safe
      return {
        valid: false,
        errors: [`Unknown semver type "${params.semver}" for git-flow strategy`],
      };
    },
  };
}
