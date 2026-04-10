// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * Release Branch Strategy — release branches with patch reuse support.
 *
 * Branch: release/{version}
 * Tag:    v{version} (default) or custom tagTemplate
 * Commit: templates from git.commit.message.semver
 *
 * When semver type is 'patch' and the patch component of version > 0,
 * signals reuse of the existing release/{major}.{minor}.0 branch
 * (reuseBranch: true). The actual existence check is done by the
 * pipeline/artifact checker.
 *
 * validateContext():
 * - For patch on a release branch (currentBranch starts with 'release/'): valid
 * - For non-patch: any branch is valid
 * - For patch NOT on a release branch: valid (the pipeline handles the checkout)
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
 * Creates a Release Branch Strategy.
 *
 * When `git.branching.strategy` is "release-branch", this strategy is used.
 * Creates release/{version} branches with support for reusing existing
 * release branches for patch releases.
 * Tag defaults to `v{version}` unless a custom tagTemplate is provided.
 */
export function createReleaseBranchStrategy(config: VersioningsConfig): Branching_Strategy {
  return {
    name(): string {
      return 'release-branch';
    },

    composeBranchName(params: StrategyParams): BranchResult {
      // Check for custom branchTemplate
      const branchTemplate = (config as any).git?.branching?.branchTemplate;
      if (branchTemplate) {
        const ctx = buildTemplateContext(params);
        return { branchName: renderTemplate(branchTemplate, ctx), reuseBranch: false };
      }

      // Patch reuse: if semver is 'patch' and patch component > 0,
      // reuse the existing release/{major}.{minor}.0 branch
      const parts = params.version.split('.');
      const major = parts[0] || '0';
      const minor = parts[1] || '0';
      const patchNum = parseInt(parts[2] || '0', 10);

      if (params.semver === 'patch' && patchNum > 0) {
        return {
          branchName: `release/${major}.${minor}.0`,
          reuseBranch: true,
        };
      }

      // Default: release/{version}
      return { branchName: `release/${params.version}`, reuseBranch: false };
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
      // For patch on a release branch: valid
      // For non-patch: any branch is valid
      // For patch NOT on a release branch: valid (pipeline handles checkout)
      return { valid: true, errors: [] };
    },
  };
}
