// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { ANSI_FG_GREEN, ANSI_FG_RED, ANSI_FG_YELLOW, ANSI_FG_NC } from '../utils/utils';
import { VersioningsError, EXIT_CODES } from './errors';
import type { ConfigProvenance } from '../config/config.merger';
import type { PR_Result } from '../scm/scm.provider';

export interface ReporterOpts {
  json: boolean;
}

export interface AutoBumpInfo {
  detectedBump: string;
  totalCommits: number;
  breakingChanges: number;
  commitsByType: Record<string, number>;
  range: { from: string; to: string };
}

export interface PipelineResult {
  success: boolean;
  version: string;
  previousVersion: string;
  semver: string;
  branch: string;
  tag: string;
  pullRequestUrl: string | null;
  exitCode: number;
  pullRequest?: PR_Result;
  strategy?: string;
  policyCheck?: { warnings: string[]; errors: string[]; protectionInfo: any };
  autoBump?: AutoBumpInfo;
}

export interface DryRunPlan {
  dryRun: boolean;
  currentVersion: string;
  nextVersion: string;
  semver: string;
  branch: string;
  tag: string;
  commitMessage: string;
  pullRequestUrl: string | null;
  steps: string[];
  pullRequest?: {
    mode: string;
    platform: string;
    reviewers?: string[];
    labels?: string[];
    draft?: boolean;
    hasToken: boolean;
  };
  strategy?: string;
  policyCheck?: { warnings: string[]; errors: string[]; protectionInfo: any };
  autoBump?: AutoBumpInfo;
  changelogPreview?: string;
}

export interface ValidateResult {
  valid: boolean;
  checks: Array<{ name: string; status: 'pass' | 'fail' | 'warn'; details: string }>;
  provenance: ConfigProvenance;
}

export interface DoctorCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  found: string;
  expected?: string;
}

export interface Reporter {
  reportSuccess(result: PipelineResult): string;
  reportError(error: VersioningsError): string;
  reportDryRun(plan: DryRunPlan): string;
  reportValidation(result: ValidateResult): string;
  reportDoctor(checks: DoctorCheck[]): string;
  reportProvenance(provenance: ConfigProvenance): string;
  reportConfirmPlan(plan: DryRunPlan): string;
}

const exitCodeNames: Record<number, string> = Object.entries(EXIT_CODES).reduce(
  (map, [name, code]) => {
    map[code] = name;
    return map;
  },
  {} as Record<number, string>
);

function getCodeName(code: number): string {
  return exitCodeNames[code] || 'UNKNOWN_ERROR';
}

function platformDisplayName(platform: string): string {
  const names: Record<string, string> = {
    'github': 'GitHub',
    'github-enterprise': 'GitHub Enterprise',
    'gitlab': 'GitLab',
    'bitbucket': 'Bitbucket',
    'bitbucket-server': 'Bitbucket Server',
    'azure-devops': 'Azure DevOps',
  };
  return names[platform] || platform;
}

function isDraftPr(pr: PR_Result): boolean {
  // Draft status is indicated by warnings containing 'draft' from the provider
  return pr.warnings?.some(w => w.toLowerCase().includes('draft')) ?? false;
}

function formatAutoBumpLines(autoBump: AutoBumpInfo): string[] {
  const lines: string[] = [];
  lines.push(`Auto-detected bump: ${autoBump.detectedBump} (${autoBump.totalCommits} commits analyzed, ${autoBump.breakingChanges} breaking changes)`);
  if (autoBump.commitsByType && Object.keys(autoBump.commitsByType).length > 0) {
    const types = Object.keys(autoBump.commitsByType).sort();
    const parts = types.map(t => `${t}: ${autoBump.commitsByType[t]}`);
    lines.push(`  ${parts.join(', ')}`);
  }
  if (autoBump.range) {
    lines.push(`  Range: ${autoBump.range.from}..${autoBump.range.to}`);
  }
  return lines;
}

export function createReporter(opts: ReporterOpts): Reporter {
  const jsonMode = opts.json;

  function reportSuccess(result: PipelineResult): string {
    if (jsonMode) {
      const obj: Record<string, any> = {
        success: result.success,
        version: result.version,
        previousVersion: result.previousVersion,
        semver: result.semver,
        branch: result.branch,
        tag: result.tag,
        pullRequestUrl: result.pullRequest ? result.pullRequest.url : result.pullRequestUrl,
        exitCode: result.exitCode,
      };
      if (result.pullRequest) {
        obj.pullRequest = {
          url: result.pullRequest.url,
          number: result.pullRequest.number,
          status: result.pullRequest.status,
          fallbackReason: result.pullRequest.fallbackReason,
          platform: result.pullRequest.platform,
        };
      }
      if (result.strategy !== undefined) {
        obj.strategy = result.strategy;
      }
      if (result.policyCheck !== undefined) {
        obj.policyCheck = result.policyCheck;
      }
      if (result.autoBump !== undefined) {
        obj.autoBump = result.autoBump;
      }
      return JSON.stringify(obj) + '\n';
    }

    const lines: string[] = [];
    lines.push(`${ANSI_FG_GREEN}Version updated successfully.${ANSI_FG_NC}`);
    lines.push(`Version: ${result.version}`);
    if (result.strategy !== undefined) {
      lines.push(`Strategy: ${result.strategy}`);
    }
    lines.push(`Branch: ${result.branch}`);
    lines.push(`Semantic version: ${result.semver}`);
    if (result.autoBump) {
      lines.push(...formatAutoBumpLines(result.autoBump));
    }

    if (result.pullRequest) {
      const pr = result.pullRequest;
      const isGitLab = pr.platform === 'gitlab';
      const prTerm = isGitLab ? 'Merge request' : 'Pull request';
      const numberPrefix = isGitLab ? '!' : '#';

      if (pr.status === 'created') {
        const draftSuffix = isDraftPr(pr) ? ' (draft)' : '';
        lines.push(`${prTerm} ${numberPrefix}${pr.number} created${draftSuffix}: ${pr.url} (${platformDisplayName(pr.platform)})`);
      } else if (pr.status === 'fallback') {
        const reason = pr.fallbackReason || 'unknown';
        lines.push(`${prTerm} URL (fallback: ${reason}): ${pr.url}`);
      }
    } else if (result.pullRequestUrl !== null) {
      lines.push(`Pull request URL: ${result.pullRequestUrl}`);
    }
    return lines.join('\n');
  }

  function reportError(error: VersioningsError): string {
    if (jsonMode) {
      const obj = {
        success: false,
        exitCode: error.code,
        error: {
          code: getCodeName(error.code),
          message: error.message,
          details: error.details,
        },
      };
      return JSON.stringify(obj) + '\n';
    }

    const codeName = getCodeName(error.code);
    const lines: string[] = [];
    lines.push(
      `${ANSI_FG_RED}Error [${codeName}] (exit code ${error.code}): ${error.message}${ANSI_FG_NC}`
    );
    if (error.details) {
      for (const [key, value] of Object.entries(error.details)) {
        const formatted = typeof value === 'object' && value !== null
          ? JSON.stringify(value)
          : String(value);
        lines.push(`  ${key}: ${formatted}`);
      }
    }
    if (error.code === EXIT_CODES.POLICY_VIOLATION && error.details) {
      if (error.details.recommendation) {
        lines.push(`  Recommendation: ${error.details.recommendation}`);
      }
    }
    if (error.code === EXIT_CODES.NO_CONVENTIONAL_COMMITS && error.details) {
      if (error.details.range) {
        const range = error.details.range;
        lines.push(`  Range: ${range.from || 'unknown'}..${range.to || 'unknown'}`);
      }
      if (error.details.totalCommits !== undefined) {
        lines.push(`  Commits analyzed: ${error.details.totalCommits}`);
      }
      if (error.details.recommendation) {
        lines.push(`  Recommendation: ${error.details.recommendation}`);
      }
    }
    return lines.join('\n');
  }

  function reportDryRun(plan: DryRunPlan): string {
    if (jsonMode) {
      return JSON.stringify(plan) + '\n';
    }

    const lines: string[] = [];
    lines.push(`${ANSI_FG_GREEN}Dry run — no changes will be made.${ANSI_FG_NC}`);
    lines.push(`Current version: ${plan.currentVersion}`);
    lines.push(`Next version: ${plan.nextVersion}`);
    lines.push(`Semantic version: ${plan.semver}`);
    if (plan.autoBump) {
      lines.push(...formatAutoBumpLines(plan.autoBump));
    }
    if (plan.strategy !== undefined) {
      lines.push(`Strategy: ${plan.strategy}`);
    }
    lines.push(`Branch: ${plan.branch}`);
    lines.push(`Tag: ${plan.tag}`);
    lines.push(`Commit message: ${plan.commitMessage}`);
    if (plan.pullRequestUrl !== null) {
      lines.push(`Pull request URL: ${plan.pullRequestUrl}`);
    }
    if (plan.pullRequest) {
      const pr = plan.pullRequest;
      const method = pr.hasToken ? 'API' : 'URL';
      lines.push(`PR/MR creation: ${method} (mode: ${pr.mode}, platform: ${pr.platform})`);
      if (pr.reviewers && pr.reviewers.length > 0) {
        lines.push(`  Reviewers: ${pr.reviewers.join(', ')}`);
      }
      if (pr.labels && pr.labels.length > 0) {
        lines.push(`  Labels: ${pr.labels.join(', ')}`);
      }
      if (pr.draft) {
        lines.push(`  Draft: yes`);
      }
    }
    lines.push('');
    lines.push('Steps:');
    plan.steps.forEach((step, i) => {
      lines.push(`  ${i + 1}. ${step}`);
    });
    if (plan.policyCheck && plan.policyCheck.warnings && plan.policyCheck.warnings.length > 0) {
      lines.push('');
      for (const warning of plan.policyCheck.warnings) {
        lines.push(`${ANSI_FG_YELLOW}⚠ ${warning}${ANSI_FG_NC}`);
      }
    }
    if (plan.changelogPreview && plan.changelogPreview.trim()) {
      lines.push('');
      lines.push('Changelog preview:');
      lines.push(plan.changelogPreview);
    }
    return lines.join('\n');
  }

  function reportValidation(result: ValidateResult): string {
    if (jsonMode) {
      return JSON.stringify(result) + '\n';
    }

    const lines: string[] = [];
    const statusColor = result.valid ? ANSI_FG_GREEN : ANSI_FG_RED;
    lines.push(`${statusColor}Validation: ${result.valid ? 'passed' : 'failed'}${ANSI_FG_NC}`);
    for (const check of result.checks) {
      const icon = check.status === 'pass' ? `${ANSI_FG_GREEN}✓${ANSI_FG_NC}`
        : check.status === 'warn' ? `${ANSI_FG_YELLOW}⚠${ANSI_FG_NC}`
          : `${ANSI_FG_RED}✗${ANSI_FG_NC}`;
      lines.push(`  ${icon} ${check.name}: ${check.details}`);
    }
    return lines.join('\n');
  }

  function reportDoctor(checks: DoctorCheck[]): string {
    if (jsonMode) {
      return JSON.stringify(checks) + '\n';
    }

    const lines: string[] = [];
    for (const check of checks) {
      const icon = check.status === 'pass' ? `${ANSI_FG_GREEN}✓${ANSI_FG_NC}`
        : check.status === 'warn' ? `${ANSI_FG_YELLOW}⚠${ANSI_FG_NC}`
          : `${ANSI_FG_RED}✗${ANSI_FG_NC}`;
      let detail = `found: ${check.found}`;
      if (check.expected !== undefined) {
        detail += `, expected: ${check.expected}`;
      }
      lines.push(`${icon} ${check.name}: ${detail}`);
    }
    return lines.join('\n');
  }

  function reportProvenance(provenance: ConfigProvenance): string {
    if (jsonMode) {
      return JSON.stringify(provenance) + '\n';
    }

    const lines: string[] = [];
    const paths = Object.keys(provenance).sort();
    for (const fieldPath of paths) {
      const entry = provenance[fieldPath];
      const val = typeof entry.value === 'object' && entry.value !== null
        ? JSON.stringify(entry.value)
        : String(entry.value);
      lines.push(`${fieldPath}: ${val} ${ANSI_FG_YELLOW}(source: ${entry.source})${ANSI_FG_NC}`);
    }
    return lines.join('\n');
  }

  function reportConfirmPlan(plan: DryRunPlan): string {
    if (jsonMode) {
      return JSON.stringify(plan) + '\n';
    }

    const lines: string[] = [];
    lines.push(`${ANSI_FG_GREEN}The following operations will be performed:${ANSI_FG_NC}`);
    lines.push(`Current version: ${plan.currentVersion}`);
    lines.push(`Next version: ${ANSI_FG_GREEN}${plan.nextVersion}${ANSI_FG_NC}`);
    lines.push(`Semantic version: ${plan.semver}`);
    lines.push(`Branch: ${ANSI_FG_GREEN}${plan.branch}${ANSI_FG_NC}`);
    lines.push(`Tag: ${ANSI_FG_GREEN}${plan.tag}${ANSI_FG_NC}`);
    lines.push(`Commit message: ${plan.commitMessage}`);
    if (plan.pullRequestUrl !== null) {
      lines.push(`Pull request URL: ${plan.pullRequestUrl}`);
    }
    if (plan.pullRequest) {
      const pr = plan.pullRequest;
      const method = pr.hasToken ? 'API' : 'URL';
      lines.push(`PR/MR creation: ${method} (mode: ${pr.mode}, platform: ${pr.platform})`);
    }
    lines.push('');
    lines.push('Steps:');
    plan.steps.forEach((step, i) => {
      lines.push(`  ${i + 1}. ${step}`);
    });
    return lines.join('\n');
  }

  return {
    reportSuccess, reportError, reportDryRun,
    reportValidation, reportDoctor, reportProvenance, reportConfirmPlan,
  };
}
