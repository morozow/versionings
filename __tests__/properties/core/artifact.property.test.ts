// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import * as fc from 'fast-check';
import { createArtifactChecker } from '../../../src/core/artifact.checker';
import { EXIT_CODES, VersioningsError } from '../../../src/core/errors';
import type { Executor, ExecutorResult } from '../../../src/core/executor';

const gitSafeChar = fc.constantFrom(
  ...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')
);
const arbComment = fc.stringOf(gitSafeChar, { minLength: 1, maxLength: 20 });
const arbVersion = fc
  .tuple(fc.integer({ min: 0, max: 99 }), fc.integer({ min: 0, max: 99 }), fc.integer({ min: 0, max: 99 }))
  .map(([x, y, z]) => `${x}.${y}.${z}`);
const arbSemverType = fc.constantFrom('patch', 'minor', 'major');
const arbTagName = fc.tuple(arbVersion, arbComment).map(([v, c]) => `${v}--${c}`);
const arbBranchName = fc.tuple(arbSemverType, arbVersion, arbComment).map(([t, v, c]) => `version/${t}/${v}/${c}`);
const arbExistingTags = fc.array(arbTagName, { minLength: 0, maxLength: 10 });
const arbExistingBranches = fc.array(arbBranchName, { minLength: 0, maxLength: 10 });

interface TrackingExecutorOpts {
  localTags?: string[];
  localBranches?: string[];
  remoteTags?: string[];
  remoteBranches?: string[];
}

function createTrackingExecutor(opts: TrackingExecutorOpts = {}): Executor & { commands: string[] } {
  const { localTags = [], localBranches = [], remoteTags = [], remoteBranches = [] } = opts;
  const commands: string[] = [];
  return {
    run: async (cmd: string): Promise<ExecutorResult> => {
      commands.push(cmd);
      if (cmd === 'git tag --list') {
        const stdout = localTags.join('\n');
        return { stdout, lines: localTags.filter(Boolean) };
      }
      if (cmd === 'git branch --list') {
        const stdout = localBranches.map((b) => `  ${b}`).join('\n');
        return { stdout, lines: localBranches };
      }
      if (cmd.startsWith('git ls-remote --tags')) {
        const stdout = remoteTags.map((t) => `abc123\trefs/tags/${t}`).join('\n');
        return { stdout, lines: stdout.split('\n').filter(Boolean) };
      }
      if (cmd.startsWith('git ls-remote --heads')) {
        const stdout = remoteBranches.map((b) => `def456\trefs/heads/${b}`).join('\n');
        return { stdout, lines: stdout.split('\n').filter(Boolean) };
      }
      return { stdout: '', lines: [] };
    },
    commands,
  };
}

function isReadOnlyCommand(cmd: string): boolean {
  return (
    cmd === 'git tag --list' ||
    cmd === 'git branch --list' ||
    cmd.startsWith('git ls-remote --tags') ||
    cmd.startsWith('git ls-remote --heads')
  );
}

describe('Property 13: Exact match of artifact names', () => {
  test('no conflict when existing tags/branches are substrings or prefixes of target', async () => {
    await fc.assert(
      fc.asyncProperty(arbTagName, arbBranchName, async (tagName, branchName) => {
        const executor = createTrackingExecutor({
          localTags: [tagName + 'extra', 'pre' + tagName],
          localBranches: [branchName + '/extra', 'pre/' + branchName],
        });
        const checker = createArtifactChecker(executor);
        await checker.checkUniqueness({ tagName, branchName, push: false });
      }),
      { numRuns: 100 }
    );
  });

  test('conflict IS detected on exact tag name match', async () => {
    await fc.assert(
      fc.asyncProperty(arbTagName, arbBranchName, arbExistingTags, async (tagName, branchName, otherTags) => {
        const localTags = [...otherTags.filter((t) => t !== tagName), tagName];
        const executor = createTrackingExecutor({ localTags, localBranches: [] });
        const checker = createArtifactChecker(executor);
        try {
          await checker.checkUniqueness({ tagName, branchName, push: false });
          throw new Error('Expected VersioningsError to be thrown');
        } catch (err: any) {
          expect(err).toBeInstanceOf(VersioningsError);
          expect(err.code).toBe(EXIT_CODES.ARTIFACT_CONFLICT);
          expect(err.details.type).toBe('tag');
          expect(err.details.name).toBe(tagName);
        }
      }),
      { numRuns: 100 }
    );
  });

  test('conflict IS detected on exact branch name match', async () => {
    await fc.assert(
      fc.asyncProperty(arbTagName, arbBranchName, arbExistingBranches, async (tagName, branchName, otherBranches) => {
        const localBranches = [...otherBranches.filter((b) => b !== branchName), branchName];
        const executor = createTrackingExecutor({ localTags: [], localBranches });
        const checker = createArtifactChecker(executor);
        try {
          await checker.checkUniqueness({ tagName, branchName, push: false });
          throw new Error('Expected VersioningsError to be thrown');
        } catch (err: any) {
          expect(err).toBeInstanceOf(VersioningsError);
          expect(err.code).toBe(EXIT_CODES.ARTIFACT_CONFLICT);
          expect(err.details.type).toBe('branch');
          expect(err.details.name).toBe(branchName);
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property 14: Remote artifact check on push', () => {
  test('when push===true, executor receives git ls-remote --tags and --heads commands', async () => {
    await fc.assert(
      fc.asyncProperty(arbTagName, arbBranchName, async (tagName, branchName) => {
        const executor = createTrackingExecutor({ localTags: [], localBranches: [], remoteTags: [], remoteBranches: [] });
        const checker = createArtifactChecker(executor);
        await checker.checkUniqueness({ tagName, branchName, push: true });
        expect(executor.commands.some((c) => c.startsWith('git ls-remote --tags'))).toBe(true);
        expect(executor.commands.some((c) => c.startsWith('git ls-remote --heads'))).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  test('when push===false, executor does NOT receive any ls-remote commands', async () => {
    await fc.assert(
      fc.asyncProperty(arbTagName, arbBranchName, async (tagName, branchName) => {
        const executor = createTrackingExecutor({ localTags: [], localBranches: [] });
        const checker = createArtifactChecker(executor);
        await checker.checkUniqueness({ tagName, branchName, push: false });
        expect(executor.commands.some((c) => c.includes('ls-remote'))).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  test('when push===true and remote is omitted, commands use "origin"', async () => {
    await fc.assert(
      fc.asyncProperty(arbTagName, arbBranchName, async (tagName, branchName) => {
        const executor = createTrackingExecutor({ localTags: [], localBranches: [], remoteTags: [], remoteBranches: [] });
        const checker = createArtifactChecker(executor);
        await checker.checkUniqueness({ tagName, branchName, push: true });
        for (const cmd of executor.commands.filter((c) => c.includes('ls-remote'))) {
          expect(cmd).toContain('origin');
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property 15: Conflict error structure', () => {
  test('local tag conflict error contains type=tag, full name, and scope=local', async () => {
    await fc.assert(
      fc.asyncProperty(arbTagName, arbBranchName, async (tagName, branchName) => {
        const executor = createTrackingExecutor({ localTags: [tagName], localBranches: [] });
        const checker = createArtifactChecker(executor);
        try {
          await checker.checkUniqueness({ tagName, branchName, push: false });
          throw new Error('Expected VersioningsError');
        } catch (err: any) {
          expect(err).toBeInstanceOf(VersioningsError);
          expect(err.code).toBe(EXIT_CODES.ARTIFACT_CONFLICT);
          expect(err.details).toEqual({ type: 'tag', name: tagName, scope: 'local' });
        }
      }),
      { numRuns: 100 }
    );
  });

  test('local branch conflict error contains type=branch, full name, and scope=local', async () => {
    await fc.assert(
      fc.asyncProperty(arbTagName, arbBranchName, async (tagName, branchName) => {
        const executor = createTrackingExecutor({ localTags: [], localBranches: [branchName] });
        const checker = createArtifactChecker(executor);
        try {
          await checker.checkUniqueness({ tagName, branchName, push: false });
          throw new Error('Expected VersioningsError');
        } catch (err: any) {
          expect(err).toBeInstanceOf(VersioningsError);
          expect(err.code).toBe(EXIT_CODES.ARTIFACT_CONFLICT);
          expect(err.details).toEqual({ type: 'branch', name: branchName, scope: 'local' });
        }
      }),
      { numRuns: 100 }
    );
  });

  test('remote tag conflict error contains type=tag, full name, and scope=remote', async () => {
    await fc.assert(
      fc.asyncProperty(arbTagName, arbBranchName, async (tagName, branchName) => {
        const executor = createTrackingExecutor({ localTags: [], localBranches: [], remoteTags: [tagName], remoteBranches: [] });
        const checker = createArtifactChecker(executor);
        try {
          await checker.checkUniqueness({ tagName, branchName, push: true });
          throw new Error('Expected VersioningsError');
        } catch (err: any) {
          expect(err).toBeInstanceOf(VersioningsError);
          expect(err.code).toBe(EXIT_CODES.ARTIFACT_CONFLICT);
          expect(err.details).toEqual({ type: 'tag', name: tagName, scope: 'remote' });
        }
      }),
      { numRuns: 100 }
    );
  });

  test('remote branch conflict error contains type=branch, full name, and scope=remote', async () => {
    await fc.assert(
      fc.asyncProperty(arbTagName, arbBranchName, async (tagName, branchName) => {
        const executor = createTrackingExecutor({ localTags: [], localBranches: [], remoteTags: [], remoteBranches: [branchName] });
        const checker = createArtifactChecker(executor);
        try {
          await checker.checkUniqueness({ tagName, branchName, push: true });
          throw new Error('Expected VersioningsError');
        } catch (err: any) {
          expect(err).toBeInstanceOf(VersioningsError);
          expect(err.code).toBe(EXIT_CODES.ARTIFACT_CONFLICT);
          expect(err.details).toEqual({ type: 'branch', name: branchName, scope: 'remote' });
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property 16: Uniqueness checks before mutations', () => {
  test('on local tag conflict, executor only receives read-only commands', async () => {
    await fc.assert(
      fc.asyncProperty(arbTagName, arbBranchName, async (tagName, branchName) => {
        const executor = createTrackingExecutor({ localTags: [tagName], localBranches: [] });
        const checker = createArtifactChecker(executor);
        try { await checker.checkUniqueness({ tagName, branchName, push: false }); } catch (_) { /* expected */ }
        for (const cmd of executor.commands) { expect(isReadOnlyCommand(cmd)).toBe(true); }
      }),
      { numRuns: 100 }
    );
  });

  test('on local branch conflict, executor only receives read-only commands', async () => {
    await fc.assert(
      fc.asyncProperty(arbTagName, arbBranchName, async (tagName, branchName) => {
        const executor = createTrackingExecutor({ localTags: [], localBranches: [branchName] });
        const checker = createArtifactChecker(executor);
        try { await checker.checkUniqueness({ tagName, branchName, push: false }); } catch (_) { /* expected */ }
        for (const cmd of executor.commands) { expect(isReadOnlyCommand(cmd)).toBe(true); }
      }),
      { numRuns: 100 }
    );
  });

  test('on remote conflict with push=true, executor only receives read-only commands', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbTagName, arbBranchName, fc.constantFrom('tag', 'branch'),
        async (tagName, branchName, conflictType) => {
          const opts = conflictType === 'tag'
            ? { localTags: [], localBranches: [], remoteTags: [tagName], remoteBranches: [] }
            : { localTags: [], localBranches: [], remoteTags: [], remoteBranches: [branchName] };
          const executor = createTrackingExecutor(opts);
          const checker = createArtifactChecker(executor);
          try { await checker.checkUniqueness({ tagName, branchName, push: true }); } catch (_) { /* expected */ }
          for (const cmd of executor.commands) { expect(isReadOnlyCommand(cmd)).toBe(true); }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('no conflict scenario also only uses read-only commands', async () => {
    await fc.assert(
      fc.asyncProperty(arbTagName, arbBranchName, fc.boolean(), async (tagName, branchName, push) => {
        const executor = createTrackingExecutor({ localTags: [], localBranches: [], remoteTags: [], remoteBranches: [] });
        const checker = createArtifactChecker(executor);
        await checker.checkUniqueness({ tagName, branchName, push });
        for (const cmd of executor.commands) { expect(isReadOnlyCommand(cmd)).toBe(true); }
      }),
      { numRuns: 100 }
    );
  });
});
