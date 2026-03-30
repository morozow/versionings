// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { ANSI_FG_GREEN, ANSI_FG_RED, ANSI_FG_NC } from './utils';
import { VersioningsError, EXIT_CODES } from './errors';

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

export interface Reporter {
  reportSuccess(result: PipelineResult): string;
  reportError(error: VersioningsError): string;
  reportDryRun(plan: DryRunPlan): string;
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

  return { reportSuccess, reportError, reportDryRun };
}
