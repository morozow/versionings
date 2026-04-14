// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface CommitFooter {
  token: string;
  value: string;
}

export interface ConventionalCommit {
  valid: true;
  type: string;
  scope: string | null;
  description: string;
  body: string | null;
  footers: CommitFooter[];
  breaking: boolean;
  rawMessage: string;
}

export interface InvalidCommit {
  valid: false;
  rawMessage: string;
}

export type ParsedCommit = ConventionalCommit | InvalidCommit;

export interface CommitWithHash {
  hash: string;
  parsed: ParsedCommit;
}

// ── Constants ───────────────────────────────────────────────────────────────

/** Standard Conventional Commits types */
export const CONVENTIONAL_TYPES: readonly string[] = [
  'feat', 'fix', 'chore', 'docs', 'style', 'refactor',
  'perf', 'test', 'build', 'ci', 'revert',
];

/** Delimiter used between commits in git log output */
export const COMMIT_SEPARATOR = '<COMMIT_SEPARATOR>';

/** git log format that outputs hash, full message, and separator */
export const GIT_LOG_FORMAT = `%H%n%B%n${COMMIT_SEPARATOR}`;

// ── Header regex ────────────────────────────────────────────────────────────

const HEADER_RE = /^(\w+)(?:\(([^)]*)\))?(!)?\s*:\s*(.+)$/;

/**
 * Matches a footer line:
 *   token: value        (standard)
 *   token #value        (issue reference shorthand)
 *   BREAKING CHANGE: v  (space-separated token)
 *   BREAKING-CHANGE: v  (hyphenated variant)
 */
const FOOTER_RE = /^(BREAKING[ -]CHANGE|[\w-]+)\s*(?::\s*|(?=#)#)(.+)$/;

const BREAKING_TOKENS = ['BREAKING CHANGE', 'BREAKING-CHANGE'];

// ── parseCommit ─────────────────────────────────────────────────────────────

/**
 * Parses a commit message per the Conventional Commits 1.0.0 spec.
 *
 * Format: <type>[(<scope>)][!]: <description>
 *         [body]
 *         [footers]
 *
 * Returns `{ valid: false, rawMessage }` on format mismatch — never throws.
 */
export function parseCommit(message: string): ParsedCommit {
  if (!message || typeof message !== 'string') {
    return { valid: false, rawMessage: message ?? '' };
  }

  const raw = message;
  const normalized = message.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  // ── Parse header ──────────────────────────────────────────────────────
  const headerMatch = HEADER_RE.exec(lines[0]);
  if (!headerMatch) {
    return { valid: false, rawMessage: raw };
  }

  const type = headerMatch[1];
  const scope = headerMatch[2] ?? null;
  const bangBreaking = headerMatch[3] === '!';
  const description = headerMatch[4].trim();

  if (!description) {
    return { valid: false, rawMessage: raw };
  }

  // ── Separate body and footers ─────────────────────────────────────────
  // Everything after the header line
  const rest = lines.slice(1);

  // Find the first blank line — everything before it (after header) is still
  // part of the header area; body starts after the first blank line.
  const firstBlankIdx = rest.indexOf('');
  let bodyAndFooterLines: string[];

  if (firstBlankIdx === -1) {
    // No blank line → no body, no footers
    bodyAndFooterLines = [];
  } else {
    bodyAndFooterLines = rest.slice(firstBlankIdx + 1);
  }

  // Scan from the end to find footer block.
  // A footer block is a contiguous set of lines at the end where each
  // "start" line matches FOOTER_RE. Continuation lines (non-empty, don't
  // match FOOTER_RE) are attached to the preceding footer.
  const footers: CommitFooter[] = [];
  let footerStartIdx = bodyAndFooterLines.length; // exclusive upper bound of body

  if (bodyAndFooterLines.length > 0) {
    // Walk backwards to find where the footer block begins
    let i = bodyAndFooterLines.length - 1;

    // Skip trailing empty lines
    while (i >= 0 && bodyAndFooterLines[i].trim() === '') {
      i--;
    }

    // Now scan backwards through footer lines
    const footerEndIdx = i + 1; // exclusive
    let tempFooters: Array<{ token: string; valueLines: string[] }> = [];

    while (i >= 0) {
      const line = bodyAndFooterLines[i];

      // Blank line ends the footer block (separates body from footers)
      if (line.trim() === '') {
        // The blank line is the separator between body and footer block
        footerStartIdx = i + 1;
        break;
      }

      const fm = FOOTER_RE.exec(line);
      if (fm) {
        tempFooters.unshift({ token: fm[1], valueLines: [fm[2]] });
        i--;
      } else {
        // Non-matching, non-blank line — could be a continuation of a footer
        // or could mean we've hit body text.
        if (tempFooters.length > 0) {
          // Continuation line: attach to the next footer below
          tempFooters[0].valueLines.unshift(line);
          i--;
        } else {
          // No footers found yet and line doesn't match → no footer block
          break;
        }
      }
    }

    if (i < 0 && tempFooters.length > 0) {
      // All bodyAndFooterLines are footers (no body)
      footerStartIdx = 0;
    }

    if (tempFooters.length > 0 && footerStartIdx <= footerEndIdx) {
      for (const tf of tempFooters) {
        footers.push({ token: tf.token, value: tf.valueLines.join('\n').trim() });
      }
    }
  }

  // ── Extract body ──────────────────────────────────────────────────────
  const bodyLines = bodyAndFooterLines.slice(0, footerStartIdx);
  // Trim trailing blank lines from body
  while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === '') {
    bodyLines.pop();
  }
  const body = bodyLines.length > 0 ? bodyLines.join('\n') : null;

  // ── Determine breaking ────────────────────────────────────────────────
  const footerBreaking = footers.some((f) => BREAKING_TOKENS.includes(f.token));
  const breaking = bangBreaking || footerBreaking;

  return {
    valid: true,
    type,
    scope,
    description,
    body,
    footers,
    breaking,
    rawMessage: raw,
  };
}

// ── parseGitLog ─────────────────────────────────────────────────────────────

/**
 * Parses the output of `git log --format=GIT_LOG_FORMAT` into an array of
 * CommitWithHash objects.
 *
 * Each chunk between COMMIT_SEPARATOR delimiters contains:
 *   line 0: commit hash (40-char SHA)
 *   lines 1+: full commit message (as produced by %B)
 *
 * Empty/malformed chunks are silently skipped.
 */
export function parseGitLog(gitLogOutput: string): CommitWithHash[] {
  if (!gitLogOutput || typeof gitLogOutput !== 'string') {
    return [];
  }

  const normalized = gitLogOutput.replace(/\r\n/g, '\n');
  const chunks = normalized.split(COMMIT_SEPARATOR);
  const results: CommitWithHash[] = [];

  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) {
      continue;
    }

    const lines = trimmed.split('\n');
    const hash = lines[0].trim();

    // A valid SHA-1 hash is 40 hex characters
    if (!hash || !/^[0-9a-f]{4,40}$/i.test(hash)) {
      continue;
    }

    const message = lines.slice(1).join('\n').trim();
    const parsed = parseCommit(message);

    results.push({ hash, parsed });
  }

  return results;
}
