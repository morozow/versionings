// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import type { ConventionalCommit } from './commit.parser';

const BREAKING_TOKENS = ['BREAKING CHANGE', 'BREAKING-CHANGE'];

/**
 * Formats a ConventionalCommit back into a commit message string.
 *
 * Format: <type>[(<scope>)][!]: <description>\n\n[body]\n\n[footers]
 *
 * - scope is included in parentheses if not null
 * - `!` is included if breaking === true AND no BREAKING CHANGE footer exists
 * - footers are formatted as `token: value`, each on a separate line
 * - body and footers are separated by blank lines
 */
export function printCommit(commit: ConventionalCommit): string {
  const hasBreakingFooter = commit.footers.some(
    (f) => BREAKING_TOKENS.includes(f.token),
  );

  // ── Header ──────────────────────────────────────────────────────────
  let header = commit.type;

  if (commit.scope !== null) {
    header += `(${commit.scope})`;
  }

  if (commit.breaking && !hasBreakingFooter) {
    header += '!';
  }

  header += `: ${commit.description}`;

  // ── Body ────────────────────────────────────────────────────────────
  const parts: string[] = [header];

  if (commit.body) {
    parts.push(commit.body);
  }

  // ── Footers ─────────────────────────────────────────────────────────
  if (commit.footers.length > 0) {
    const footerLines = commit.footers
      .map((f) => `${f.token}: ${f.value}`)
      .join('\n');
    parts.push(footerLines);
  }

  return parts.join('\n\n');
}
