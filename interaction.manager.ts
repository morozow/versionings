// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import * as readline from 'readline';
import { ANSI_FG_GREEN, ANSI_FG_YELLOW, ANSI_FG_NC } from './utils';
import type { DryRunPlan } from './reporter';

export interface InteractionOpts {
  ci: boolean;
  nonInteractive: boolean;
  yes: boolean;
  isTTY: boolean;
}

export interface InteractionManager {
  isInteractive(): boolean;
  confirm(plan: DryRunPlan): Promise<boolean>;
}

function formatPlan(plan: DryRunPlan): string {
  const lines: string[] = [];
  lines.push(`${ANSI_FG_GREEN}Release plan:${ANSI_FG_NC}`);
  lines.push(`  Current version: ${plan.currentVersion}`);
  lines.push(`  Next version:    ${ANSI_FG_YELLOW}${plan.nextVersion}${ANSI_FG_NC}`);
  lines.push(`  Semver:          ${plan.semver}`);
  lines.push(`  Branch:          ${ANSI_FG_YELLOW}${plan.branch}${ANSI_FG_NC}`);
  lines.push(`  Tag:             ${ANSI_FG_YELLOW}${plan.tag}${ANSI_FG_NC}`);
  lines.push(`  Commit message:  ${plan.commitMessage}`);
  if (plan.pullRequestUrl !== null) {
    lines.push(`  Pull request:    ${plan.pullRequestUrl}`);
  }
  if (plan.steps.length > 0) {
    lines.push('');
    lines.push('  Steps:');
    plan.steps.forEach((step, i) => {
      lines.push(`    ${i + 1}. ${step}`);
    });
  }
  return lines.join('\n');
}

export function createInteractionManager(
  opts: InteractionOpts,
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream,
): InteractionManager {
  const interactive = opts.isTTY === true
    && opts.ci === false
    && opts.nonInteractive === false
    && opts.yes === false;

  function isInteractive(): boolean {
    return interactive;
  }

  function confirm(plan: DryRunPlan): Promise<boolean> {
    if (!interactive) {
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve) => {
      stdout.write(formatPlan(plan) + '\n\n');

      const rl = readline.createInterface({
        input: stdin,
        output: stdout,
        terminal: false,
      });

      let answered = false;

      rl.question('Proceed? [y/N] ', (answer) => {
        answered = true;
        rl.close();
        const trimmed = answer.trim().toLowerCase();
        resolve(trimmed === 'y' || trimmed === 'yes');
      });

      rl.on('close', () => {
        // If closed without answer (e.g. SIGINT, EOF), treat as decline
        if (!answered) {
          resolve(false);
        }
      });
    });
  }

  return { isInteractive, confirm };
}
