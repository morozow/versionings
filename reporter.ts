// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { ANSI_FG_GREEN, ANSI_FG_RED, ANSI_FG_YELLOW, ANSI_FG_NC } from './utils';
import { VersioningsError, EXIT_CODES } from './errors';
import type { ConfigProvenance } from './config.merger';

export interface ReporterOpts {
  json: boolean;
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

export function createReporter(opts: ReporterOpts): Reporter {
  const jsonMode = opts.json;

  function reportSuccess(result: PipelineResult): string {
    if (jsonMode) {
      const obj = {
        success: result.success,
        version: result.version,
        previousVersion: result.previousVersion,
        semver: result.semver,
        branch: result.branch,
        tag: result.tag,
        pullRequestUrl: result.pullRequestUrl,
        exitCode: result.exitCode,
      };
      return JSON.stringify(obj) + '\n';
    }

    const lines: string[] = [];
    lines.push(`${ANSI_FG_GREEN}Version updated successfully.${ANSI_FG_NC}`);
    lines.push(`Version: ${result.version}`);
    lines.push(`Branch: ${result.branch}`);
    lines.push(`Semantic version: ${result.semver}`);
    if (result.pullRequestUrl !== null) {
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
    lines.push(`Branch: ${plan.branch}`);
    lines.push(`Tag: ${plan.tag}`);
    lines.push(`Commit message: ${plan.commitMessage}`);
    if (plan.pullRequestUrl !== null) {
      lines.push(`Pull request URL: ${plan.pullRequestUrl}`);
    }
    lines.push('');
    lines.push('Steps:');
    plan.steps.forEach((step, i) => {
      lines.push(`  ${i + 1}. ${step}`);
    });
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
