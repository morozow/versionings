// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * Default Branching Strategy — backward-compatible with the original
 * composeVersionBranchName() / composeVersionTagName() / semverMessage()
 * from version.utils.ts.
 *
 * Branch: {branchType}/{semverType}/{version}/{comment}
 * Tag:    {version}--{comment}
 * Commit: templates from git.commit.message.semver
 *
 * Supports custom templates via git.branching.branchTemplate / tagTemplate
 * (delegated to Template_Renderer).
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
 * Creates a Default Branching Strategy that reproduces the legacy behavior.
 *
 * When `git.branching.strategy` is "default" or absent, this strategy is used.
 */
export function createDefaultStrategy(config: VersioningsConfig): Branching_Strategy {
  return {
    name(): string {
      return 'default';
    },

    composeBranchName(params: StrategyParams): BranchResult {
      // Check for custom branchTemplate
      const branchTemplate = (config as any).git?.branching?.branchTemplate;
      if (branchTemplate) {
        const ctx = buildTemplateContext(params);
        return { branchName: renderTemplate(branchTemplate, ctx), reuseBranch: false };
      }

      // Legacy behavior: {branchType}/{semverType}/{version}/{comment}
      const branchType = params.config.git.branchType.version || 'version';
      const semverType = params.config.package.semver[params.semver as keyof typeof params.config.package.semver] || params.semver;
      const branchName = `${branchType}/${semverType}/${params.version}/${params.comment}`;
      return { branchName, reuseBranch: false };
    },

    composeTagName(params: StrategyParams): string {
      // Check for custom tagTemplate
      const tagTemplate = (config as any).git?.branching?.tagTemplate;
      if (tagTemplate) {
        const ctx = buildTemplateContext(params);
        return renderTemplate(tagTemplate, ctx);
      }

      // Legacy behavior: {version}--{comment}
      return `${params.version}--${params.comment}`;
    },

    composeCommitMessage(params: StrategyParams): string {
      const tpl = params.config.git.commit.message.semver[
        params.semver as keyof typeof params.config.git.commit.message.semver
      ];
      return tpl
        ? tpl.replace(/v%s/g, params.version)
        : 'Read documentation and try to use versioning tool according to the standard.';
    },

    validateContext(_params: StrategyParams): StrategyValidationResult {
      return { valid: true, errors: [] };
    },
  };
}
