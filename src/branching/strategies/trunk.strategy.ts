// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * Trunk-Based Branching Strategy — bump on main/master, create tag, no branch.
 *
 * Branch: null (no branch created — bump happens on current branch)
 * Tag:    v{version} (default) or custom tagTemplate
 * Commit: templates from git.commit.message.semver
 *
 * Validates that the current branch is main or master (or config.git.branching.mainBranch).
 */

import type {
  Branching_Strategy,
  StrategyParams,
  BranchResult,
  StrategyValidationResult,
} from '../branching.strategy';
import type { VersioningsConfig } from '../../config/config.validator';
import { renderTemplate } from '../../scm/template.renderer';
import type { TemplateContext } from '../../scm/template.renderer';

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
 * Creates a Trunk-Based Branching Strategy.
 *
 * When `git.branching.strategy` is "trunk-based", this strategy is used.
 * Bump happens on the current branch (main/master) without creating a new branch.
 * Tag defaults to `v{version}` unless a custom tagTemplate is provided.
 */
export function createTrunkStrategy(config: VersioningsConfig): Branching_Strategy {
  return {
    name(): string {
      return 'trunk-based';
    },

    composeBranchName(_params: StrategyParams): BranchResult {
      // Trunk-based: no branch created, bump on current branch
      return { branchName: null, reuseBranch: false };
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
      const mainBranch = (config as any).git?.branching?.mainBranch || 'master';
      const current = params.currentBranch;

      if (current === mainBranch || current === 'main') {
        return { valid: true, errors: [] };
      }

      return {
        valid: false,
        errors: [
          `Trunk-based strategy requires current branch to be "${mainBranch}" or "main", but got "${current}"`,
        ],
      };
    },
  };
}
