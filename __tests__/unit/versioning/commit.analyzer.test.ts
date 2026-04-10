// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import {
  findLastVersionTag,
  getCommitsInRange,
  analyzeBump,
  DEFAULT_BUMP_POLICY,
} from '../../../src/versioning/commit.analyzer';
import type { BumpPolicy, CommitAnalyzerDeps } from '../../../src/versioning/commit.analyzer';
import type { Executor, ExecutorResult } from '../../../src/core/executor';
import { EXIT_CODES, VersioningsError } from '../../../src/core/errors';
import { COMMIT_SEPARATOR } from '../../../src/versioning/commit.parser';

// ── Helpers ─────────────────────────────────────────────────────────────────

function ok(stdout: string): ExecutorResult {
  const trimmed = stdout.trim();
  const lines = trimmed ? trimmed.split('\n').filter(Boolean) : [];
  return { stdout: trimmed, lines };
}

function createMockExecutor(
  responses: Record<string, ExecutorResult | Error>,
): Executor {
  return {
    run(cmd: string): Promise<ExecutorResult> {
      for (const [key, value] of Object.entries(responses)) {
        if (cmd.includes(key)) {
          if (value instanceof Error) {
            return Promise.reject(value);
          }
          return Promise.resolve(value);
        }
      }
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    },
  };
}

/** Builds a git log chunk for a single commit */
function logEntry(hash: string, message: string): string {
  return `${hash}\n${message}\n\n${COMMIT_SEPARATOR}\n`;
}

const HASH_A = 'aaaa' + '0'.repeat(36);
const HASH_B = 'bbbb' + '0'.repeat(36);
const HASH_C = 'cccc' + '0'.repeat(36);
const HASH_D = 'dddd' + '0'.repeat(36);

// ── findLastVersionTag ──────────────────────────────────────────────────────

describe('findLastVersionTag', () => {
  test('returns first tag when version tags exist', async () => {
    const executor = createMockExecutor({
      'git tag --list': ok('v2.0.0\nv1.1.0\nv1.0.0'),
    });
    const tag = await findLastVersionTag(executor);
    expect(tag).toBe('v2.0.0');
  });

  test('returns root commit SHA when no tags exist', async () => {
    const rootSha = 'abcd' + '0'.repeat(36);
    const executor = createMockExecutor({
      'git tag --list': ok(''),
      'git rev-list --max-parents=0': ok(rootSha),
    });
    const tag = await findLastVersionTag(executor);
    expect(tag).toBe(rootSha);
  });

  test('returns null when both tag and rev-list fail', async () => {
    const executor = createMockExecutor({
      'git tag --list': new VersioningsError(EXIT_CODES.COMMAND_FAILED, 'no tags'),
      'git rev-list': new VersioningsError(EXIT_CODES.COMMAND_FAILED, 'empty repo'),
    });
    const tag = await findLastVersionTag(executor);
    expect(tag).toBeNull();
  });

  test('falls through to rev-list when tag command returns empty lines', async () => {
    const rootSha = 'ffff' + '0'.repeat(36);
    const executor = createMockExecutor({
      'git tag --list': ok(''),
      'git rev-list --max-parents=0': ok(rootSha),
    });
    const tag = await findLastVersionTag(executor);
    expect(tag).toBe(rootSha);
  });
});

// ── getCommitsInRange ───────────────────────────────────────────────────────

describe('getCommitsInRange', () => {
  test('parses commits from git log output', async () => {
    const gitLog = logEntry(HASH_A, 'feat(core): add feature') +
      logEntry(HASH_B, 'fix: resolve bug');
    const executor = createMockExecutor({
      'git log': ok(gitLog),
    });

    const commits = await getCommitsInRange(executor, { from: 'v1.0.0', to: 'HEAD' });
    expect(commits).toHaveLength(2);
    expect(commits[0].hash).toBe(HASH_A);
    expect(commits[0].parsed.valid).toBe(true);
    if (commits[0].parsed.valid) {
      expect(commits[0].parsed.type).toBe('feat');
    }
    expect(commits[1].hash).toBe(HASH_B);
    expect(commits[1].parsed.valid).toBe(true);
    if (commits[1].parsed.valid) {
      expect(commits[1].parsed.type).toBe('fix');
    }
  });

  test('returns empty array for empty git log', async () => {
    const executor = createMockExecutor({
      'git log': ok(''),
    });
    const commits = await getCommitsInRange(executor, { from: 'v1.0.0', to: 'HEAD' });
    expect(commits).toEqual([]);
  });

  test('propagates git log error as-is', async () => {
    const error = new VersioningsError(EXIT_CODES.COMMAND_FAILED, 'git log failed');
    const executor = createMockExecutor({
      'git log': error,
    });
    await expect(
      getCommitsInRange(executor, { from: 'v1.0.0', to: 'HEAD' }),
    ).rejects.toThrow(VersioningsError);
  });
});

// ── analyzeBump ─────────────────────────────────────────────────────────────

describe('analyzeBump', () => {
  function makeDeps(
    executor: Executor,
    overrides?: Partial<Omit<CommitAnalyzerDeps, 'executor'>>,
  ): CommitAnalyzerDeps {
    return {
      executor,
      bumpPolicy: overrides?.bumpPolicy ?? DEFAULT_BUMP_POLICY,
      fallbackBump: overrides?.fallbackBump ?? null,
    };
  }

  function executorWithTagAndLog(tag: string, gitLogOutput: string): Executor {
    return createMockExecutor({
      'git tag --list': ok(tag),
      'git log': ok(gitLogOutput),
    });
  }

  // ── Bump level detection ────────────────────────────────────────────────

  test('feat commit → minor bump', async () => {
    const log = logEntry(HASH_A, 'feat: add new feature');
    const executor = executorWithTagAndLog('v1.0.0', log);
    const result = await analyzeBump(makeDeps(executor));
    expect(result.bump).toBe('minor');
  });

  test('fix commit → patch bump', async () => {
    const log = logEntry(HASH_A, 'fix: resolve issue');
    const executor = executorWithTagAndLog('v1.0.0', log);
    const result = await analyzeBump(makeDeps(executor));
    expect(result.bump).toBe('patch');
  });

  test('breaking change via bang → major bump', async () => {
    const log = logEntry(HASH_A, 'feat!: breaking API change');
    const executor = executorWithTagAndLog('v1.0.0', log);
    const result = await analyzeBump(makeDeps(executor));
    expect(result.bump).toBe('major');
  });

  test('breaking change via BREAKING CHANGE footer → major bump', async () => {
    const msg = 'refactor: change internals\n\nBREAKING CHANGE: removed old API';
    const log = logEntry(HASH_A, msg);
    const executor = executorWithTagAndLog('v1.0.0', log);
    const result = await analyzeBump(makeDeps(executor));
    expect(result.bump).toBe('major');
  });

  test('mixed commits → highest bump wins (major > minor > patch)', async () => {
    const log =
      logEntry(HASH_A, 'fix: small fix') +
      logEntry(HASH_B, 'feat: new feature') +
      logEntry(HASH_C, 'feat!: breaking change');
    const executor = executorWithTagAndLog('v1.0.0', log);
    const result = await analyzeBump(makeDeps(executor));
    expect(result.bump).toBe('major');
  });

  test('feat + fix → minor (feat > fix)', async () => {
    const log =
      logEntry(HASH_A, 'fix: bug fix') +
      logEntry(HASH_B, 'feat: new feature');
    const executor = executorWithTagAndLog('v1.0.0', log);
    const result = await analyzeBump(makeDeps(executor));
    expect(result.bump).toBe('minor');
  });

  // ── Custom BumpPolicy ───────────────────────────────────────────────────

  test('custom BumpPolicy: refactor → patch', async () => {
    const log = logEntry(HASH_A, 'refactor: clean up code');
    const executor = executorWithTagAndLog('v1.0.0', log);
    const customPolicy: BumpPolicy = {
      ...DEFAULT_BUMP_POLICY,
      refactor: 'patch',
    };
    const result = await analyzeBump(makeDeps(executor, { bumpPolicy: customPolicy }));
    expect(result.bump).toBe('patch');
  });

  test('custom BumpPolicy: docs → minor', async () => {
    const log = logEntry(HASH_A, 'docs: update readme');
    const executor = executorWithTagAndLog('v1.0.0', log);
    const customPolicy: BumpPolicy = {
      ...DEFAULT_BUMP_POLICY,
      docs: 'minor',
    };
    const result = await analyzeBump(makeDeps(executor, { bumpPolicy: customPolicy }));
    expect(result.bump).toBe('minor');
  });

  // ── Fallback behavior ──────────────────────────────────────────────────

  test('all none types with fallback → uses fallbackBump', async () => {
    const log = logEntry(HASH_A, 'chore: update deps') +
      logEntry(HASH_B, 'docs: update readme');
    const executor = executorWithTagAndLog('v1.0.0', log);
    const result = await analyzeBump(makeDeps(executor, { fallbackBump: 'patch' }));
    expect(result.bump).toBe('patch');
  });

  test('all none types without fallback → throws NO_CONVENTIONAL_COMMITS', async () => {
    const log = logEntry(HASH_A, 'chore: update deps') +
      logEntry(HASH_B, 'docs: update readme');
    const executor = executorWithTagAndLog('v1.0.0', log);
    await expect(
      analyzeBump(makeDeps(executor)),
    ).rejects.toThrow(VersioningsError);

    try {
      await analyzeBump(makeDeps(executor));
    } catch (err: any) {
      expect(err.code).toBe(EXIT_CODES.NO_CONVENTIONAL_COMMITS);
    }
  });

  test('no conventional commits (all invalid) without fallback → NO_CONVENTIONAL_COMMITS', async () => {
    const log = logEntry(HASH_A, 'random commit message') +
      logEntry(HASH_B, 'another non-conventional message');
    const executor = executorWithTagAndLog('v1.0.0', log);
    await expect(
      analyzeBump(makeDeps(executor)),
    ).rejects.toThrow(VersioningsError);

    try {
      await analyzeBump(makeDeps(executor));
    } catch (err: any) {
      expect(err.code).toBe(EXIT_CODES.NO_CONVENTIONAL_COMMITS);
    }
  });

  test('no conventional commits with fallback → uses fallbackBump', async () => {
    const log = logEntry(HASH_A, 'random commit message');
    const executor = executorWithTagAndLog('v1.0.0', log);
    const result = await analyzeBump(makeDeps(executor, { fallbackBump: 'minor' }));
    expect(result.bump).toBe('minor');
  });

  // ── No tags → beginning of history ─────────────────────────────────────

  test('no tags → uses all commits from beginning of history', async () => {
    const rootSha = 'abcd' + '0'.repeat(36);
    const log = logEntry(HASH_A, 'feat: initial feature');
    const executor = createMockExecutor({
      'git tag --list': ok(''),
      'git rev-list --max-parents=0': ok(rootSha),
      'git log': ok(log),
    });
    const result = await analyzeBump(makeDeps(executor));
    expect(result.bump).toBe('minor');
    expect(result.commits).toHaveLength(1);
  });

  // ── commitsByType counters ─────────────────────────────────────────────

  test('commitsByType counts each type correctly', async () => {
    const log =
      logEntry(HASH_A, 'feat: feature one') +
      logEntry(HASH_B, 'feat: feature two') +
      logEntry(HASH_C, 'fix: bug fix') +
      logEntry(HASH_D, 'chore: cleanup');
    const executor = executorWithTagAndLog('v1.0.0', log);
    const result = await analyzeBump(makeDeps(executor));
    expect(result.commitsByType).toEqual({ feat: 2, fix: 1, chore: 1 });
  });

  // ── breakingChanges subset ─────────────────────────────────────────────

  test('breakingChanges contains only breaking commits', async () => {
    const log =
      logEntry(HASH_A, 'feat: normal feature') +
      logEntry(HASH_B, 'feat!: breaking feature') +
      logEntry(HASH_C, 'fix: normal fix');
    const executor = executorWithTagAndLog('v1.0.0', log);
    const result = await analyzeBump(makeDeps(executor));
    expect(result.breakingChanges).toHaveLength(1);
    expect(result.breakingChanges[0].description).toBe('breaking feature');
    expect(result.breakingChanges[0].breaking).toBe(true);
  });

  test('conventionalCommits contains only valid commits', async () => {
    const log =
      logEntry(HASH_A, 'feat: valid feature') +
      logEntry(HASH_B, 'not a conventional commit') +
      logEntry(HASH_C, 'fix: valid fix');
    const executor = executorWithTagAndLog('v1.0.0', log);
    const result = await analyzeBump(makeDeps(executor));
    expect(result.conventionalCommits).toHaveLength(2);
    expect(result.commits).toHaveLength(3);
  });

  // ── Range information ──────────────────────────────────────────────────

  test('range reflects tag and HEAD', async () => {
    const log = logEntry(HASH_A, 'feat: feature');
    const executor = executorWithTagAndLog('v1.2.3', log);
    const result = await analyzeBump(makeDeps(executor));
    expect(result.range.from).toBe('v1.2.3');
    expect(result.range.to).toBe('HEAD');
  });

  // ── Git log error → COMMAND_FAILED ─────────────────────────────────────

  test('git log error propagates as COMMAND_FAILED', async () => {
    const executor = createMockExecutor({
      'git tag --list': ok('v1.0.0'),
      'git log': new VersioningsError(
        EXIT_CODES.COMMAND_FAILED,
        'fatal: bad revision',
      ),
    });
    await expect(analyzeBump(makeDeps(executor))).rejects.toThrow(VersioningsError);

    try {
      await analyzeBump(makeDeps(executor));
    } catch (err: any) {
      expect(err.code).toBe(EXIT_CODES.COMMAND_FAILED);
    }
  });
});

// ── DEFAULT_BUMP_POLICY ─────────────────────────────────────────────────────

describe('DEFAULT_BUMP_POLICY', () => {
  test('feat maps to minor', () => {
    expect(DEFAULT_BUMP_POLICY.feat).toBe('minor');
  });

  test('fix maps to patch', () => {
    expect(DEFAULT_BUMP_POLICY.fix).toBe('patch');
  });

  test('perf maps to patch', () => {
    expect(DEFAULT_BUMP_POLICY.perf).toBe('patch');
  });

  test('revert maps to patch', () => {
    expect(DEFAULT_BUMP_POLICY.revert).toBe('patch');
  });

  test('chore, docs, style, refactor, test, build, ci map to none', () => {
    const noneTypes = ['chore', 'docs', 'style', 'refactor', 'test', 'build', 'ci'];
    for (const t of noneTypes) {
      expect(DEFAULT_BUMP_POLICY[t]).toBe('none');
    }
  });
});
