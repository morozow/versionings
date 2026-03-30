/* Versioning automation tool, 2018-present */

import { createArtifactChecker } from '../../artifact.checker';
import { EXIT_CODES, VersioningsError } from '../../errors';
import type { Executor, ExecutorResult } from '../../executor';

function createMockExecutor(responses: Record<string, string>): Executor {
  return {
    run: jest.fn(async (cmd: string): Promise<ExecutorResult> => {
      for (const [pattern, response] of Object.entries(responses)) {
        if (cmd.includes(pattern)) {
          return {
            stdout: response,
            lines: response.trim().split('\n').filter(Boolean),
          };
        }
      }
      return { stdout: '', lines: [] };
    }),
  };
}

describe('createArtifactChecker', () => {
  describe('no conflicts', () => {
    test('resolves without throwing when no tags or branches match', async () => {
      const executor = createMockExecutor({
        'git tag --list': 'other-tag\nunrelated-tag',
        'git branch --list': '  main\n  develop',
      });
      const checker = createArtifactChecker(executor);
      await expect(
        checker.checkUniqueness({
          tagName: '1.0.0--fix',
          branchName: 'version/patch/1.0.0/fix',
          push: false,
        })
      ).resolves.toBeUndefined();
    });
  });

  describe('local tag conflict', () => {
    test('throws ARTIFACT_CONFLICT with type=tag, scope=local on exact tag match', async () => {
      const executor = createMockExecutor({
        'git tag --list': '0.9.0--old\n1.0.0--fix\n2.0.0--next',
        'git branch --list': '  main',
      });
      const checker = createArtifactChecker(executor);
      try {
        await checker.checkUniqueness({
          tagName: '1.0.0--fix',
          branchName: 'version/patch/1.0.0/fix',
          push: false,
        });
        throw new Error('Expected to throw');
      } catch (err: any) {
        expect(err).toBeInstanceOf(VersioningsError);
        expect(err.code).toBe(EXIT_CODES.ARTIFACT_CONFLICT);
        expect(err.details).toEqual({
          type: 'tag',
          name: '1.0.0--fix',
          scope: 'local',
        });
      }
    });
  });

  describe('local branch conflict', () => {
    test('throws ARTIFACT_CONFLICT with type=branch, scope=local on exact branch match', async () => {
      const executor = createMockExecutor({
        'git tag --list': '',
        'git branch --list': '* version/patch/1.0.0/fix\n  main',
      });
      const checker = createArtifactChecker(executor);
      try {
        await checker.checkUniqueness({
          tagName: '1.0.0--fix',
          branchName: 'version/patch/1.0.0/fix',
          push: false,
        });
        throw new Error('Expected to throw');
      } catch (err: any) {
        expect(err).toBeInstanceOf(VersioningsError);
        expect(err.code).toBe(EXIT_CODES.ARTIFACT_CONFLICT);
        expect(err.details).toEqual({
          type: 'branch',
          name: 'version/patch/1.0.0/fix',
          scope: 'local',
        });
      }
    });
  });

  describe('exact match vs substring — tags', () => {
    test('tag "1.0.0--fix" does NOT conflict with existing tag "1.0.0--fix-login"', async () => {
      const executor = createMockExecutor({
        'git tag --list': '1.0.0--fix-login\n1.0.0--fix-typo',
        'git branch --list': '  main',
      });
      const checker = createArtifactChecker(executor);
      await expect(
        checker.checkUniqueness({
          tagName: '1.0.0--fix',
          branchName: 'version/patch/1.0.0/fix',
          push: false,
        })
      ).resolves.toBeUndefined();
    });
  });

  describe('exact match vs prefix — branches', () => {
    test('branch "version/patch/1.0.0/fix" does NOT conflict with "version/patch/1.0.0/fix-more"', async () => {
      const executor = createMockExecutor({
        'git tag --list': '',
        'git branch --list': '  version/patch/1.0.0/fix-more\n  main',
      });
      const checker = createArtifactChecker(executor);
      await expect(
        checker.checkUniqueness({
          tagName: '1.0.0--fix',
          branchName: 'version/patch/1.0.0/fix',
          push: false,
        })
      ).resolves.toBeUndefined();
    });
  });

  describe('remote tag conflict', () => {
    test('throws ARTIFACT_CONFLICT with scope=remote when remote tag matches (push=true)', async () => {
      const executor = createMockExecutor({
        'git tag --list': '',
        'git branch --list': '  main',
        'ls-remote --tags': 'abc123\trefs/tags/1.0.0--fix\ndef456\trefs/tags/1.0.0--fix^{}',
        'ls-remote --heads': '',
      });
      const checker = createArtifactChecker(executor);
      try {
        await checker.checkUniqueness({
          tagName: '1.0.0--fix',
          branchName: 'version/patch/1.0.0/fix',
          push: true,
        });
        throw new Error('Expected to throw');
      } catch (err: any) {
        expect(err).toBeInstanceOf(VersioningsError);
        expect(err.code).toBe(EXIT_CODES.ARTIFACT_CONFLICT);
        expect(err.details).toEqual({
          type: 'tag',
          name: '1.0.0--fix',
          scope: 'remote',
        });
      }
    });
  });

  describe('remote branch conflict', () => {
    test('throws ARTIFACT_CONFLICT with scope=remote when remote branch matches (push=true)', async () => {
      const executor = createMockExecutor({
        'git tag --list': '',
        'git branch --list': '  main',
        'ls-remote --tags': '',
        'ls-remote --heads': 'abc123\trefs/heads/version/patch/1.0.0/fix',
      });
      const checker = createArtifactChecker(executor);
      try {
        await checker.checkUniqueness({
          tagName: '1.0.0--fix',
          branchName: 'version/patch/1.0.0/fix',
          push: true,
        });
        throw new Error('Expected to throw');
      } catch (err: any) {
        expect(err).toBeInstanceOf(VersioningsError);
        expect(err.code).toBe(EXIT_CODES.ARTIFACT_CONFLICT);
        expect(err.details).toEqual({
          type: 'branch',
          name: 'version/patch/1.0.0/fix',
          scope: 'remote',
        });
      }
    });
  });

  describe('push=false skips remote checks', () => {
    test('does NOT run ls-remote commands when push is false', async () => {
      const executor = createMockExecutor({
        'git tag --list': '',
        'git branch --list': '  main',
      });
      const checker = createArtifactChecker(executor);
      await checker.checkUniqueness({
        tagName: '1.0.0--fix',
        branchName: 'version/patch/1.0.0/fix',
        push: false,
      });
      const calls = (executor.run as jest.Mock).mock.calls.map((c: any[]) => c[0]);
      expect(calls).not.toEqual(
        expect.arrayContaining([expect.stringContaining('ls-remote')])
      );
      expect(calls).toHaveLength(2);
      expect(calls[0]).toContain('git tag --list');
      expect(calls[1]).toContain('git branch --list');
    });
  });
});
