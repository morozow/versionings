// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import * as fs from 'fs';
import type { Executor } from '../../core/executor';
import type { BumpPolicy } from '../../versioning/commit.analyzer';
import type { CommitWithHash } from '../../versioning/commit.parser';
import { parseGitLog, GIT_LOG_FORMAT } from '../../versioning/commit.parser';
import { findLastVersionTag, getCommitsInRange } from '../../versioning/commit.analyzer';
import { generateChangelog } from '../../versioning/changelog.generator';
import type { ChangelogOpts } from '../../versioning/changelog.generator';
import { VersioningsError, EXIT_CODES } from '../../core/errors';
import { prependChangelogContent } from '../../core/pipeline';

// ── Types ───────────────────────────────────────────────────────────────────

export interface ChangelogCommandOpts {
  from?: string;
  to?: string;
  output?: string;
  format?: 'markdown' | 'plain';
  json: boolean;
}

export interface ChangelogCommandDeps {
  executor: Executor;
  bumpPolicy: BumpPolicy;
  changelogConfig: {
    groupTitles: Record<string, string>;
    excludeTypes: string[];
    includeNonConventional: boolean;
  };
  stdout: NodeJS.WritableStream;
  /** DI: override for fs.existsSync (testability) */
  existsSync?: (p: string) => boolean;
  /** DI: override for fs.readFileSync (testability) */
  readFileSync?: (p: string, enc: BufferEncoding) => string;
  /** DI: override for fs.writeFileSync (testability) */
  writeFileSync?: (p: string, data: string, enc: BufferEncoding) => void;
}

// ── runChangelogCommand ─────────────────────────────────────────────────────

/**
 * Executes the `versionings changelog` subcommand:
 *
 * 1. Determines commit range (--from/--to or automatically via last version tag)
 * 2. Gets and parses commits via getCommitsInRange
 * 3. Generates changelog via generateChangelog
 * 4. Outputs to stdout or writes to file (--output)
 * 5. When --json: outputs structured JSON
 * 6. When writing to existing file: inserts new section after `# Changelog` header
 * 7. When no commits in range: throws VersioningsError(NO_OPERATION)
 */
export async function runChangelogCommand(
  opts: ChangelogCommandOpts,
  deps: ChangelogCommandDeps,
): Promise<void> {
  const { executor, bumpPolicy, changelogConfig, stdout } = deps;
  const exists = deps.existsSync ?? fs.existsSync;
  const readFile = deps.readFileSync ?? fs.readFileSync;
  const writeFile = deps.writeFileSync ?? fs.writeFileSync;

  const format = opts.format ?? 'markdown';
  const to = opts.to ?? 'HEAD';

  // ── 1. Determine commit range ───────────────────────────────────────────
  let from: string;

  if (opts.from) {
    from = opts.from;
  } else {
    const lastTag = await findLastVersionTag(executor);
    if (lastTag === null) {
      // No tags and no --from: get all commits
      from = '';
    } else {
      from = lastTag;
    }
  }

  // ── 2. Get commits in range ─────────────────────────────────────────────
  let commits: CommitWithHash[];

  if (from === '') {
    // No starting point — get all commits
    const result = await executor.run(`git log ${to} --format="${GIT_LOG_FORMAT}"`);
    commits = parseGitLog(result.stdout);
  } else {
    commits = await getCommitsInRange(executor, { from, to });
  }

  // ── 3. Check for empty range ────────────────────────────────────────────
  if (commits.length === 0) {
    throw new VersioningsError(
      EXIT_CODES.NO_OPERATION,
      `No commits found in range ${from || 'ROOT'}..${to}`,
      { range: { from: from || 'ROOT', to } },
    );
  }

  // ── 4. Generate changelog ───────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);

  const changelogOpts: ChangelogOpts = {
    version: null,
    date: today,
    format,
    groupTitles: changelogConfig.groupTitles,
    excludeTypes: changelogConfig.excludeTypes,
    includeNonConventional: changelogConfig.includeNonConventional,
    bumpPolicy,
  };

  const result = generateChangelog(commits, changelogOpts);

  // ── 5. Output ───────────────────────────────────────────────────────────
  const range = { from: from || 'ROOT', to };

  if (opts.json) {
    const jsonOutput = {
      version: null as string | null,
      date: today,
      groups: result.groups,
      range,
      markdown: result.markdown,
    };
    stdout.write(JSON.stringify(jsonOutput, null, 2) + '\n');
    return;
  }

  if (opts.output) {
    const existingContent = exists(opts.output)
      ? readFile(opts.output, 'utf8')
      : null;
    const fileContent = prependChangelogContent(existingContent, result.markdown);
    writeFile(opts.output, fileContent, 'utf8');
    return;
  }

  // Default: write to stdout
  stdout.write(result.markdown);
}
