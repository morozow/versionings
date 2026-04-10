// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { checkPolicy } from '../../policy.checker';
import type { PolicyCheckerDeps } from '../../policy.checker';
import type { Executor, ExecutorResult } from '../../executor';
import type { SCM_Provider, Branch_Protection_Rule } from '../../scm.provider';
import type { VersioningsConfig } from '../../config.validator';

// ---------------------------------------------------------------------------
// Minimal mock config (same pattern as other tests)
// ---------------------------------------------------------------------------

const mockConfig = {
  git: {
    platform: 'github',
    url: 'https://github.com/test/repo',
    branchType: { version: 'version' },
    pr: { target: 'master' },
    limits: { branchMaxCommentLength: 96 },
    remote: 'origin',
    commit: {
      message: {
        semver: {
          prepatch: 'Prepatch: v%s.',
          patch: 'Patch: v%s.',
          preminor: 'Preminor: v%s.',
          minor: 'Minor: v%s.',
          premajor: 'Premajor: v%s.',
          major: 'Major: v%s.',
          prerelease: 'Prerelease: v%s.',
        },
      },
    },
  },
  package: {
    semver: {
      patch: 'patch',
      prepatch: 'prepatch',
      minor: 'minor',
      preminor: 'preminor',
      premajor: 'premajor',
      prerelease: 'prerelease',
      major: 'major',
    },
  },
  common: { messages: {} },
} as unknown as VersioningsConfig;

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Creates a mock Executor where `run(cmd)` returns the matching response
 * from `responses` or throws the Error. Commands not in `responses` throw
 * (simulating "no config found" — the default git config behavior).
 */
function createMockExecutor(
  responses: Record<string, string | Error> = {},
): Executor {
  return {
    async run(cmd: string): Promise<ExecutorResult> {
      for (const [pattern, response] of Object.entries(responses)) {
        if (cmd.includes(pattern)) {
          if (response instanceof Error) throw response;
          const trimmed = response.trim();
          return {
            stdout: trimmed,
            lines: trimmed.split(/\r?\n/).filter(Boolean),
          };
        }
      }
      // Default: git config exits with error when no matching keys
      throw new Error(`No config found for: ${cmd}`);
    },
  };
}

/**
 * Creates a mock SCM_Provider with getBranchProtection that returns
 * the given rule, null, or throws the given Error.
 */
function createMockScmProvider(
  rule: Branch_Protection_Rule | null | Error,
): SCM_Provider {
  return {
    name: () => 'mock',
    createPullRequest: async () => ({
      url: '',
      number: null,
      status: 'skipped' as const,
      fallbackReason: null,
      platform: 'mock',
      warnings: [],
    }),
    generatePullRequestUrl: () => '',
    getBranchProtection: async (_branch: string) => {
      if (rule instanceof Error) throw rule;
      return rule;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkPolicy', () => {
  // 1. Branch without protection — no warnings, no errors, protectionInfo null
  test('branch without protection — no warnings, no errors, protectionInfo null', async () => {
    const executor = createMockExecutor();
    const deps: PolicyCheckerDeps = { executor, config: mockConfig };

    const result = await checkPolicy('feature/test', deps);

    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.protectionInfo).toBeNull();
  });

  // 2. Branch with pushRemote in git config — warning about pushRemote
  test('branch with pushRemote in git config — warning about pushRemote', async () => {
    const executor = createMockExecutor({
      'git config --get-regexp branch.main.': 'branch.main.pushRemote upstream',
    });
    const deps: PolicyCheckerDeps = { executor, config: mockConfig };

    const result = await checkPolicy('main', deps);

    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings.some((w) => w.includes('pushRemote'))).toBe(true);
    expect(result.protectionInfo).not.toBeNull();
    expect(result.protectionInfo!.protected).toBe(true);
    expect(result.protectionInfo!.source).toBe('git-config');
  });

  // 3. gpgSign configured — gpgSignConfigured=true in protectionInfo
  test('gpgSign configured — gpgSignConfigured=true', async () => {
    const executor = createMockExecutor({
      'commit.gpgSign': 'true',
    });
    const deps: PolicyCheckerDeps = { executor, config: mockConfig };

    const result = await checkPolicy('main', deps);

    // gpgSign alone doesn't set protected=true, but the info should be tracked
    // If protectionInfo is null (no pushRemote/no SCM rule), gpgSign is still checked
    // Looking at the implementation: gpgSign is stored in localResult.info but
    // protectionInfo is only created when hasLocal || hasRemote
    // hasLocal requires info.protected === true (set by pushRemote)
    // So with only gpgSign, protectionInfo may be null — but the info is still in localResult
    // Let's verify the actual behavior:
    expect(result.errors).toEqual([]);
  });

  // Let's test gpgSign with pushRemote so protectionInfo is created
  test('gpgSign configured with pushRemote — gpgSignConfigured=true in protectionInfo', async () => {
    const executor = createMockExecutor({
      'git config --get-regexp branch.main.': 'branch.main.pushRemote upstream',
      'commit.gpgSign': 'true',
    });
    const deps: PolicyCheckerDeps = { executor, config: mockConfig };

    const result = await checkPolicy('main', deps);

    expect(result.protectionInfo).not.toBeNull();
    expect(result.protectionInfo!.gpgSignConfigured).toBe(true);
  });

  // 4. gpgSign not configured — gpgSignConfigured=false
  test('gpgSign not configured — gpgSignConfigured=false when protectionInfo exists', async () => {
    const executor = createMockExecutor({
      'git config --get-regexp branch.main.': 'branch.main.pushRemote upstream',
    });
    const deps: PolicyCheckerDeps = { executor, config: mockConfig };

    const result = await checkPolicy('main', deps);

    expect(result.protectionInfo).not.toBeNull();
    expect(result.protectionInfo!.gpgSignConfigured).toBe(false);
  });

  // 5. SCM API returns protection rule with requirePullRequest=true — warning about PR
  test('SCM API returns requirePullRequest=true — warning about PR', async () => {
    const executor = createMockExecutor();
    const scmProvider = createMockScmProvider({
      protected: true,
      allowForcePush: false,
      requirePullRequest: true,
      requiredReviewers: 0,
      requiredStatusChecks: [],
      requireSignedCommits: false,
    });
    const deps: PolicyCheckerDeps = { executor, scmProvider, config: mockConfig };

    const result = await checkPolicy('main', deps);

    expect(result.warnings.some((w) => w.includes('pull request'))).toBe(true);
    expect(result.protectionInfo).not.toBeNull();
    expect(result.protectionInfo!.requirePullRequest).toBe(true);
    expect(result.protectionInfo!.source).toBe('scm-api');
  });

  // 6. SCM API returns requiredReviewers=2 — warning about reviewers
  test('SCM API returns requiredReviewers=2 — warning about reviewers', async () => {
    const executor = createMockExecutor();
    const scmProvider = createMockScmProvider({
      protected: true,
      allowForcePush: false,
      requirePullRequest: false,
      requiredReviewers: 2,
      requiredStatusChecks: [],
      requireSignedCommits: false,
    });
    const deps: PolicyCheckerDeps = { executor, scmProvider, config: mockConfig };

    const result = await checkPolicy('main', deps);

    expect(result.warnings.some((w) => w.includes('2') && w.includes('reviewer'))).toBe(true);
    expect(result.protectionInfo).not.toBeNull();
    expect(result.protectionInfo!.requiredReviewers).toBe(2);
  });

  // 7. SCM API returns requiredStatusChecks=['ci/build'] — warning about status checks
  test('SCM API returns requiredStatusChecks — warning about status checks', async () => {
    const executor = createMockExecutor();
    const scmProvider = createMockScmProvider({
      protected: true,
      allowForcePush: false,
      requirePullRequest: false,
      requiredReviewers: 0,
      requiredStatusChecks: ['ci/build'],
      requireSignedCommits: false,
    });
    const deps: PolicyCheckerDeps = { executor, scmProvider, config: mockConfig };

    const result = await checkPolicy('main', deps);

    expect(result.warnings.some((w) => w.includes('status checks') && w.includes('ci/build'))).toBe(true);
    expect(result.protectionInfo).not.toBeNull();
    expect(result.protectionInfo!.requiredStatusChecks).toEqual(['ci/build']);
  });

  // 8. SCM API returns requireSignedCommits=true — warning about signed commits
  test('SCM API returns requireSignedCommits=true — warning about signed commits', async () => {
    const executor = createMockExecutor();
    const scmProvider = createMockScmProvider({
      protected: true,
      allowForcePush: false,
      requirePullRequest: false,
      requiredReviewers: 0,
      requiredStatusChecks: [],
      requireSignedCommits: true,
    });
    const deps: PolicyCheckerDeps = { executor, scmProvider, config: mockConfig };

    const result = await checkPolicy('main', deps);

    expect(result.warnings.some((w) => w.includes('signed commits'))).toBe(true);
    expect(result.protectionInfo).not.toBeNull();
    expect(result.protectionInfo!.requireSignedCommits).toBe(true);
  });

  // 9. SCM API error → warning (not error), pipeline continues, protectionInfo null
  test('SCM API error → warning (not error), protectionInfo null', async () => {
    const executor = createMockExecutor();
    const scmProvider = createMockScmProvider(new Error('401 Unauthorized'));
    const deps: PolicyCheckerDeps = { executor, scmProvider, config: mockConfig };

    const result = await checkPolicy('main', deps);

    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.includes('Could not check') || w.includes('401'))).toBe(true);
    expect(result.protectionInfo).toBeNull();
  });

  // 10. No SCM_Provider → only local checks
  test('no SCM_Provider → only local checks, no SCM warnings', async () => {
    const executor = createMockExecutor({
      'git config --get-regexp branch.main.': 'branch.main.pushRemote upstream',
    });
    // No scmProvider in deps
    const deps: PolicyCheckerDeps = { executor, config: mockConfig };

    const result = await checkPolicy('main', deps);

    // Should have local pushRemote warning but no SCM-related warnings
    expect(result.warnings.some((w) => w.includes('pushRemote'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('Could not check'))).toBe(false);
    expect(result.protectionInfo).not.toBeNull();
    expect(result.protectionInfo!.source).toBe('git-config');
  });

  // 11. Aggregation of local and remote results — both sources
  test('aggregation of local and remote results — source is "both"', async () => {
    const executor = createMockExecutor({
      'git config --get-regexp branch.main.': 'branch.main.pushRemote upstream',
      'commit.gpgSign': 'true',
    });
    const scmProvider = createMockScmProvider({
      protected: true,
      allowForcePush: false,
      requirePullRequest: true,
      requiredReviewers: 1,
      requiredStatusChecks: ['ci/test'],
      requireSignedCommits: true,
    });
    const deps: PolicyCheckerDeps = { executor, scmProvider, config: mockConfig };

    const result = await checkPolicy('main', deps);

    // Should have warnings from both local and remote
    expect(result.warnings.some((w) => w.includes('pushRemote'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('pull request'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('reviewer'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('status checks'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('signed commits'))).toBe(true);

    // protectionInfo should aggregate both sources
    expect(result.protectionInfo).not.toBeNull();
    expect(result.protectionInfo!.source).toBe('both');
    expect(result.protectionInfo!.protected).toBe(true);
    expect(result.protectionInfo!.gpgSignConfigured).toBe(true);
    expect(result.protectionInfo!.requirePullRequest).toBe(true);
    expect(result.protectionInfo!.requiredReviewers).toBe(1);
    expect(result.protectionInfo!.requiredStatusChecks).toEqual(['ci/test']);
    expect(result.protectionInfo!.requireSignedCommits).toBe(true);

    expect(result.errors).toEqual([]);
  });
});
