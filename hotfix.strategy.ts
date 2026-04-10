// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * Hotfix Branching Strategy — hotfix branches from main/master for urgent patches.
 *
 * Branch: hotfix/{version} (default) or custom branchTemplate
 * Tag:    v{version} (default) or custom tagTemplate
 * Commit: templates from git.commit.message.semver
 *
 * Validates that:
 * - semver type is 'patch' (only patch allowed for hotfix)
 * - current branch is main or master (or config.git.branching.mainBranch)
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
 * Creates a Hotfix Branching Strategy.
 *
 * When `git.branching.strategy` is "hotfix", this strategy is used.
 * Only patch semver type is allowed.
 * Hotfix branches are created from main/master.
 * Tag defaults to `v{version}` unless a custom tagTemplate is provided.
 */
export function createHotfixStrategy(config: VersioningsConfig): Branching_Strategy {
  return {
    name(): string {
      return 'hotfix';
    },

    composeBranchName(params: StrategyParams): BranchResult {
      // Check for custom branchTemplate
      const branchTemplate = (config as any).git?.branching?.branchTemplate;
      if (branchTemplate) {
        const ctx = buildTemplateContext(params);
        return { branchName: renderTemplate(branchTemplate, ctx), reuseBranch: false };
      }

      // Default: hotfix/{version}
      return { branchName: `hotfix/${params.version}`, reuseBranch: false };
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
      const errors: string[] = [];

      // Check 1: semver must be 'patch'
      if (params.semver !== 'patch') {
        errors.push(
          `Hotfix strategy only allows "patch" semver type, got "${params.semver}"`,
        );
      }

      // Check 2: current branch must be mainBranch or 'main'
      const mainBranch = (config as any).git?.branching?.mainBranch || 'master';
      const current = params.currentBranch;

      if (current !== mainBranch && current !== 'main') {
        errors.push(
          `Hotfix strategy requires current branch to be "${mainBranch}" or "main", but got "${current}"`,
        );
      }

      if (errors.length > 0) {
        return { valid: false, errors };
      }

      return { valid: true, errors: [] };
    },
  };
}
