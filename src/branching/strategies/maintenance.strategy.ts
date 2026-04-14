// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * Maintenance Branching Strategy — long-term support branches.
 *
 * Branch: support/{major}.{minor} (without patch component)
 * Tag:    v{version} (default) or custom tagTemplate
 * Commit: templates from git.commit.message.semver
 *
 * Validates that:
 * - semver type is 'patch' (only patch allowed for maintenance)
 * - current branch is a support branch or main/master (for first creation)
 *
 * Reuse: if patch > 0, assumes support/{major}.{minor} already exists
 * and returns reuseBranch: true.
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

export function createMaintenanceStrategy(config: VersioningsConfig): Branching_Strategy {
  return {
    name(): string {
      return 'maintenance';
    },

    composeBranchName(params: StrategyParams): BranchResult {
      const branchTemplate = (config as any).git?.branching?.branchTemplate;
      if (branchTemplate) {
        const ctx = buildTemplateContext(params);
        return { branchName: renderTemplate(branchTemplate, ctx), reuseBranch: false };
      }

      const parts = params.version.split('.');
      const major = parts[0] || '0';
      const minor = parts[1] || '0';
      const patchNum = parseInt(parts[2] || '0', 10);
      const branchName = `support/${major}.${minor}`;

      // If patch > 0, the support branch should already exist → reuse
      if (patchNum > 0) {
        return { branchName, reuseBranch: true };
      }

      return { branchName, reuseBranch: false };
    },

    composeTagName(params: StrategyParams): string {
      const tagTemplate = (config as any).git?.branching?.tagTemplate;
      if (tagTemplate) {
        const ctx = buildTemplateContext(params);
        return renderTemplate(tagTemplate, ctx);
      }
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

      if (params.semver !== 'patch') {
        errors.push(
          `Maintenance strategy only allows "patch" semver type, got "${params.semver}"`,
        );
      }

      const mainBranch = (config as any).git?.branching?.mainBranch || 'master';
      const current = params.currentBranch;

      if (!current.startsWith('support/') && current !== mainBranch && current !== 'main') {
        errors.push(
          `Maintenance strategy requires current branch to be a support branch or "${mainBranch}" or "main", but got "${current}"`,
        );
      }

      if (errors.length > 0) {
        return { valid: false, errors };
      }

      return { valid: true, errors: [] };
    },
  };
}
