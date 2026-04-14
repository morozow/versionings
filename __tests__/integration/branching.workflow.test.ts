// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * Integration tests: Branching workflow with different strategies.
 *
 * Tests the pipeline with mock executor, mock rollback manager, and mock artifact checker —
 * focused on strategy integration (not real git repos).
 */

import { EXIT_CODES, VersioningsError } from '../../src/core/errors';

// Mock fs for package.json reads
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    readFileSync: jest.fn(),
    existsSync: jest.fn(),
  };
});

const fs = require('fs');

// Mock version.utils to avoid config.ts side-effect
jest.mock('../../src/versioning/version.utils', () => ({
  AVAILABLE_SEMVERS: ['patch', 'minor', 'major', 'prepatch', 'preminor', 'premajor', 'prerelease'],
  composeVersionBranchName: (semver: string, version: string, comment: string, config?: any) => {
    const branchType = config ? config.git.branchType.version : 'version';
    const semverType = config ? config.package.semver[semver] : semver;
    return `${branchType}/${semverType}/${version}/${comment}`;
  },
  composeVersionTagName: (_semver: string, version: string, comment: string) =>
    `${version}--${comment}`,
  semverMessage: (semver: string, version: string, config?: any) => {
    if (config) {
      const tpl = config.git.commit.message.semver[semver];
      return tpl ? tpl.replace(/v%s/g, version) : 'Read documentation and try to use versioning tool according to the standard.';
    }
    return `Version ${semver}: ${version}`;
  },
  semverNpmMessage: (_semver: string, branch: string) =>
    `Version: patch. Comment: ${branch}.`,
  preidParam: (preid?: string) => (preid ? `--preid=${preid}` : ''),
  generatePullRequestUrl: (branch: string) =>
    `https://github.com/user/repo/compare/develop...${branch}?expand=1`,
}));

// Mock pr.creator
jest.mock('../../src/scm/pr.creator', () => ({
  createPR: jest.fn(),
}));

const { runPipeline } = require('../../src/core/pipeline');

// ---------------------------------------------------------------------------
// Shared mock config
// ---------------------------------------------------------------------------

const baseMockConfig = {
  git: {
    platform: 'github',
    url: 'https://github.com/user/repo.git',
    branchType: { version: 'version' },
    pr: { target: 'develop' },
    limits: { branchMaxCommentLength: 96 },
    remote: 'origin',
    commit: {
      message: {
        semver: {
          patch: 'Patch: v%s. You SHOULD consider changes.',
          minor: 'Minor: v%s. You MUST consider changes.',
          major: 'Release: v%s.',
          prepatch: 'Patch version is preparing now: v%s.',
          preminor: 'Minor version is preparing now: v%s.',
          premajor: 'Release is preparing now: v%s.',
          prerelease: 'Preparing: v%s.',
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
  common: {
    messages: {
      unavailableSemanticVersion: 'Invalid semver',
      undefinedVersionBranchName: 'Branch name required',
      incorrectVersionBranchNameLength: 'Branch too long',
      incorrectVersionBranchNameCharactersDashes: 'No double dashes',
      untrackedGitFiles: 'Dirty tree',
      incorrectGitRemote: 'Wrong remote',
    },
  },
} as any;

function configWithStrategy(strategy: string, extra: Record<string, any> = {}): any {
  return {
    ...baseMockConfig,
    git: {
      ...baseMockConfig.git,
      branching: { strategy, ...extra },
    },
  };
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockExecutor(currentBranch = 'master') {
  return {
    run: jest.fn(async (cmd: string) => {
      if (cmd.includes('git status --porcelain')) return { stdout: '', lines: [] };
      if (cmd.includes('git remote --verbose'))
        return {
          stdout: 'origin\thttps://github.com/user/repo.git (fetch)',
          lines: ['origin\thttps://github.com/user/repo.git (fetch)'],
        };
      if (cmd.includes('npm --no-git-tag-version version'))
        return { stdout: 'v1.2.3', lines: ['v1.2.3'] };
      if (cmd.includes('git checkout -- package'))
        return { stdout: '', lines: [] };
      if (cmd.includes('git rev-parse --abbrev-ref HEAD'))
        return { stdout: currentBranch, lines: [currentBranch] };
      if (cmd.includes('git tag --list'))
        return { stdout: '', lines: [] };
      if (cmd.includes('git branch --list'))
        return { stdout: `  ${currentBranch}`, lines: [currentBranch] };
      if (cmd.includes('git ls-remote'))
        return { stdout: '', lines: [] };
      return { stdout: '', lines: [] };
    }),
  };
}

function createMockRollbackManager() {
  const recorded: any[] = [];
  return {
    record: jest.fn((step: any) => recorded.push(step)),
    rollback: jest.fn(async () => ({ success: true, failedSteps: [] })),
    _recorded: recorded,
  };
}

function createMockArtifactChecker() {
  return { checkUniqueness: jest.fn(async () => { }) };
}

function createMockStrategy(overrides: {
  name?: string;
  branchName?: string | null;
  reuseBranch?: boolean;
  tagName?: string;
  commitMessage?: string;
  valid?: boolean;
  validationErrors?: string[];
} = {}) {
  const opts = {
    name: 'default',
    branchName: 'version/patch/1.2.3/fix-login' as string | null,
    reuseBranch: false,
    tagName: '1.2.3--fix-login',
    commitMessage: 'Patch: v1.2.3. You SHOULD consider changes.',
    valid: true,
    validationErrors: [] as string[],
    ...overrides,
  };
  return {
    name: jest.fn(() => opts.name),
    composeBranchName: jest.fn(() => ({
      branchName: opts.branchName,
      reuseBranch: opts.reuseBranch,
    })),
    composeTagName: jest.fn(() => opts.tagName),
    composeCommitMessage: jest.fn(() => opts.commitMessage),
    validateContext: jest.fn(() => ({
      valid: opts.valid,
      errors: opts.validationErrors,
    })),
  };
}

function createMockStrategyRegistry(strategy: ReturnType<typeof createMockStrategy>) {
  return {
    register: jest.fn(),
    getStrategy: jest.fn(() => strategy),
    availableStrategies: jest.fn(() => [
      'default', 'trunk-based', 'git-flow',
      'release-branch', 'hotfix', 'maintenance',
    ]),
  };
}

const baseOpts = {
  semver: 'patch',
  branch: 'fix-login',
  push: false,
  dryRun: false,
  json: false,
  verbose: false,
};

beforeEach(() => {
  fs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.2.2' }));
  fs.existsSync.mockReturnValue(true);
});

afterEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Integration tests: Branching workflow with different strategies
// ---------------------------------------------------------------------------

describe('Integration: Branching workflow with strategies', () => {
  // Test 1: Pipeline with default strategy — branch/tag names match legacy functions
  test('default strategy — branch and tag names match legacy functions', async () => {
    const strategy = createMockStrategy({
      name: 'default',
      branchName: 'version/patch/1.2.3/fix-login',
      reuseBranch: false,
      tagName: '1.2.3--fix-login',
      commitMessage: 'Patch: v1.2.3. You SHOULD consider changes.',
    });
    const registry = createMockStrategyRegistry(strategy);
    const executor = createMockExecutor('master');
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();

    const result = await runPipeline(baseOpts, {
      executor,
      config: configWithStrategy('default'),
      rollbackManager: rollback,
      artifactChecker,
      strategyRegistry: registry,
    });

    expect(result.success).toBe(true);
    expect(result.version).toBe('1.2.3');
    expect(result.previousVersion).toBe('1.2.2');
    expect(result.branch).toBe('version/patch/1.2.3/fix-login');
    expect(result.tag).toBe('1.2.3--fix-login');
    expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
    expect((result as any).strategy).toBe('default');

    // Strategy methods were called
    expect(strategy.composeBranchName).toHaveBeenCalled();
    expect(strategy.composeTagName).toHaveBeenCalled();
    expect(strategy.composeCommitMessage).toHaveBeenCalled();
    expect(strategy.validateContext).toHaveBeenCalled();

    // git checkout -b was called for the branch
    const checkoutNewCmds = (executor.run as jest.Mock).mock.calls
      .map((c: any[]) => c[0])
      .filter((cmd: string) => cmd.includes('git checkout -b'));
    expect(checkoutNewCmds.length).toBe(1);
    expect(checkoutNewCmds[0]).toContain('version/patch/1.2.3/fix-login');

    // Rollback recorded BRANCH_CREATED
    const branchCreatedSteps = rollback._recorded.filter(
      (s: any) => s.type === 'branch_created',
    );
    expect(branchCreatedSteps.length).toBe(1);
  });

  // Test 2: Pipeline with trunk-based strategy — no branch creation, tag v{version}
  test('trunk-based strategy — no branch creation, tag v{version}', async () => {
    const strategy = createMockStrategy({
      name: 'trunk-based',
      branchName: null,
      reuseBranch: false,
      tagName: 'v1.2.3',
      commitMessage: 'Patch: v1.2.3. You SHOULD consider changes.',
    });
    const registry = createMockStrategyRegistry(strategy);
    const executor = createMockExecutor('main');
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();

    const result = await runPipeline(baseOpts, {
      executor,
      config: configWithStrategy('trunk-based'),
      rollbackManager: rollback,
      artifactChecker,
      strategyRegistry: registry,
    });

    expect(result.success).toBe(true);
    expect(result.version).toBe('1.2.3');
    expect(result.branch).toBe('main'); // current branch, no new branch
    expect(result.tag).toBe('v1.2.3');
    expect((result as any).strategy).toBe('trunk-based');

    // No git checkout -b should have been called
    const checkoutNewCmds = (executor.run as jest.Mock).mock.calls
      .map((c: any[]) => c[0])
      .filter((cmd: string) => cmd.includes('git checkout -b'));
    expect(checkoutNewCmds).toHaveLength(0);

    // No BRANCH_CREATED in rollback
    const branchCreatedSteps = rollback._recorded.filter(
      (s: any) => s.type === 'branch_created',
    );
    expect(branchCreatedSteps).toHaveLength(0);

    // Artifact checker called with null branchName
    expect(artifactChecker.checkUniqueness).toHaveBeenCalledWith(
      expect.objectContaining({ branchName: null }),
    );

    // Tag was created
    const tagCmds = (executor.run as jest.Mock).mock.calls
      .map((c: any[]) => c[0])
      .filter((cmd: string) => cmd.includes('git tag --annotate'));
    expect(tagCmds.length).toBe(1);
    expect(tagCmds[0]).toContain('v1.2.3');
  });

  // Test 3: Pipeline with git-flow strategy (minor) — branch release/{version}
  test('git-flow strategy (minor) — branch release/{version}', async () => {
    const strategy = createMockStrategy({
      name: 'git-flow',
      branchName: 'release/1.2.3',
      reuseBranch: false,
      tagName: 'v1.2.3',
      commitMessage: 'Minor: v1.2.3. You MUST consider changes.',
    });
    const registry = createMockStrategyRegistry(strategy);
    const executor = createMockExecutor('develop');
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();

    const result = await runPipeline(
      { ...baseOpts, semver: 'minor' },
      {
        executor,
        config: configWithStrategy('git-flow'),
        rollbackManager: rollback,
        artifactChecker,
        strategyRegistry: registry,
      },
    );

    expect(result.success).toBe(true);
    expect(result.branch).toBe('release/1.2.3');
    expect(result.tag).toBe('v1.2.3');
    expect((result as any).strategy).toBe('git-flow');

    // git checkout -b release/1.2.3
    const checkoutNewCmds = (executor.run as jest.Mock).mock.calls
      .map((c: any[]) => c[0])
      .filter((cmd: string) => cmd.includes('git checkout -b'));
    expect(checkoutNewCmds.length).toBe(1);
    expect(checkoutNewCmds[0]).toContain('release/1.2.3');
  });

  // Test 4: Pipeline with git-flow strategy (patch) — branch hotfix/{version}
  test('git-flow strategy (patch) — branch hotfix/{version}', async () => {
    const strategy = createMockStrategy({
      name: 'git-flow',
      branchName: 'hotfix/1.2.3',
      reuseBranch: false,
      tagName: 'v1.2.3',
      commitMessage: 'Patch: v1.2.3. You SHOULD consider changes.',
    });
    const registry = createMockStrategyRegistry(strategy);
    const executor = createMockExecutor('master');
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();

    const result = await runPipeline(baseOpts, {
      executor,
      config: configWithStrategy('git-flow'),
      rollbackManager: rollback,
      artifactChecker,
      strategyRegistry: registry,
    });

    expect(result.success).toBe(true);
    expect(result.branch).toBe('hotfix/1.2.3');
    expect(result.tag).toBe('v1.2.3');
    expect((result as any).strategy).toBe('git-flow');

    // git checkout -b hotfix/1.2.3
    const checkoutNewCmds = (executor.run as jest.Mock).mock.calls
      .map((c: any[]) => c[0])
      .filter((cmd: string) => cmd.includes('git checkout -b'));
    expect(checkoutNewCmds.length).toBe(1);
    expect(checkoutNewCmds[0]).toContain('hotfix/1.2.3');
  });

  // Test 5: Pipeline with policyChecker (warnings) — warnings in stderr, pipeline continues
  test('policyChecker with warnings — warnings in stderr, pipeline continues', async () => {
    const strategy = createMockStrategy({
      name: 'default',
      branchName: 'version/patch/1.2.3/fix-login',
      tagName: '1.2.3--fix-login',
      commitMessage: 'Patch: v1.2.3. You SHOULD consider changes.',
    });
    const registry = createMockStrategyRegistry(strategy);
    const executor = createMockExecutor('master');
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();

    const mockPolicyChecker = jest.fn(async () => ({
      warnings: [
        'Branch "main" has pushRemote configured — push may be redirected',
        'receive.denyNonFastForwards is enabled',
      ],
      errors: [],
      protectionInfo: {
        protected: true,
        source: 'git-config' as const,
      },
    }));

    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      const result = await runPipeline(baseOpts, {
        executor,
        config: configWithStrategy('default'),
        rollbackManager: rollback,
        artifactChecker,
        strategyRegistry: registry,
        policyChecker: mockPolicyChecker,
      });

      expect(result.success).toBe(true);
      expect(mockPolicyChecker).toHaveBeenCalledTimes(1);

      // Warnings should be written to stderr
      const stderrOutput = stderrSpy.mock.calls.map((c: any[]) => c[0]).join('');
      expect(stderrOutput).toContain('pushRemote');
      expect(stderrOutput).toContain('denyNonFastForwards');

      // Pipeline still completed mutation steps
      const tagCmds = (executor.run as jest.Mock).mock.calls
        .map((c: any[]) => c[0])
        .filter((cmd: string) => cmd.includes('git tag --annotate'));
      expect(tagCmds.length).toBe(1);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  // Test 6: Pipeline with policyChecker (errors) — POLICY_VIOLATION thrown
  test('policyChecker with errors — POLICY_VIOLATION thrown, no mutations', async () => {
    const strategy = createMockStrategy({
      name: 'default',
      branchName: 'version/patch/1.2.3/fix-login',
      tagName: '1.2.3--fix-login',
    });
    const registry = createMockStrategyRegistry(strategy);
    const executor = createMockExecutor('master');
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();

    const mockPolicyChecker = jest.fn(async () => ({
      warnings: [],
      errors: ['Direct push to protected branch is not allowed'],
      protectionInfo: {
        protected: true,
        source: 'scm-api' as const,
        requirePullRequest: true,
      },
    }));

    try {
      await runPipeline(baseOpts, {
        executor,
        config: configWithStrategy('default'),
        rollbackManager: rollback,
        artifactChecker,
        strategyRegistry: registry,
        policyChecker: mockPolicyChecker,
      });
      throw new Error('Expected to throw');
    } catch (err: any) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.code).toBe(EXIT_CODES.POLICY_VIOLATION);
      expect(err.message).toContain('Direct push to protected branch is not allowed');
    }

    // No mutation commands should have been executed
    const mutationCmds = (executor.run as jest.Mock).mock.calls
      .map((c: any[]) => c[0])
      .filter(
        (cmd: string) =>
          cmd.includes('git checkout -b') ||
          cmd.includes('git tag --annotate') ||
          cmd.includes('git commit') ||
          cmd.includes('git push'),
      );
    expect(mutationCmds).toHaveLength(0);

    // Rollback should not have been called (error before mutations)
    expect(rollback.rollback).not.toHaveBeenCalled();
  });

  // Test 7: Backward compatibility — no strategyRegistry → legacy behavior
  test('backward compatibility — no strategyRegistry uses legacy functions', async () => {
    const executor = createMockExecutor('master');
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();

    // No strategyRegistry, no policyChecker — legacy path
    const result = await runPipeline(baseOpts, {
      executor,
      config: baseMockConfig,
      rollbackManager: rollback,
      artifactChecker,
    });

    expect(result.success).toBe(true);
    expect(result.version).toBe('1.2.3');
    expect(result.branch).toBe('version/patch/1.2.3/fix-login');
    expect(result.tag).toBe('1.2.3--fix-login');
    expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);

    // strategy field should not be set
    expect((result as any).strategy).toBeUndefined();
  });

  // Test 8: Release-branch strategy with reuse — BRANCH_SWITCHED in rollback
  test('release-branch strategy with reuse — git checkout without -b, BRANCH_SWITCHED recorded', async () => {
    const strategy = createMockStrategy({
      name: 'release-branch',
      branchName: 'release/1.2.0',
      reuseBranch: true,
      tagName: 'v1.2.3',
      commitMessage: 'Patch: v1.2.3. You SHOULD consider changes.',
    });
    const registry = createMockStrategyRegistry(strategy);
    const executor = createMockExecutor('develop');
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();

    const result = await runPipeline(baseOpts, {
      executor,
      config: configWithStrategy('release-branch'),
      rollbackManager: rollback,
      artifactChecker,
      strategyRegistry: registry,
    });

    expect(result.success).toBe(true);
    expect(result.branch).toBe('release/1.2.0');
    expect(result.tag).toBe('v1.2.3');
    expect((result as any).strategy).toBe('release-branch');

    // Should call git checkout (without -b) for reuse
    const checkoutReuseCmds = (executor.run as jest.Mock).mock.calls
      .map((c: any[]) => c[0])
      .filter(
        (cmd: string) =>
          cmd.match(/git checkout (?!-b)(?!--)/) && cmd.includes('release/1.2.0'),
      );
    expect(checkoutReuseCmds.length).toBeGreaterThan(0);

    // Should NOT call git checkout -b
    const checkoutNewCmds = (executor.run as jest.Mock).mock.calls
      .map((c: any[]) => c[0])
      .filter((cmd: string) => cmd.includes('git checkout -b'));
    expect(checkoutNewCmds).toHaveLength(0);

    // Rollback recorded BRANCH_SWITCHED (not BRANCH_CREATED)
    const switchedSteps = rollback._recorded.filter(
      (s: any) => s.type === 'branch_switched',
    );
    expect(switchedSteps.length).toBe(1);
    expect(switchedSteps[0].meta.previousBranch).toBe('develop');

    const createdSteps = rollback._recorded.filter(
      (s: any) => s.type === 'branch_created',
    );
    expect(createdSteps).toHaveLength(0);

    // Artifact checker called with skipBranchCheck
    expect(artifactChecker.checkUniqueness).toHaveBeenCalledWith(
      expect.objectContaining({ skipBranchCheck: true }),
    );
  });

  // Test 9: Dry-run with strategy and policyCheck
  test('dry-run with strategy and policyCheck — plan contains both fields', async () => {
    const strategy = createMockStrategy({
      name: 'git-flow',
      branchName: 'release/1.2.3',
      tagName: 'v1.2.3',
      commitMessage: 'Minor: v1.2.3. You MUST consider changes.',
    });
    const registry = createMockStrategyRegistry(strategy);
    const executor = createMockExecutor('develop');
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();

    const mockPolicyChecker = jest.fn(async () => ({
      warnings: ['Signed commits required'],
      errors: [],
      protectionInfo: {
        protected: true,
        source: 'git-config' as const,
        gpgSignConfigured: true,
      },
    }));

    const plan = await runPipeline(
      { ...baseOpts, semver: 'minor', dryRun: true },
      {
        executor,
        config: configWithStrategy('git-flow'),
        rollbackManager: rollback,
        artifactChecker,
        strategyRegistry: registry,
        policyChecker: mockPolicyChecker,
      },
    );

    expect(plan.dryRun).toBe(true);
    expect(plan.nextVersion).toBe('1.2.3');
    expect(plan.branch).toBe('release/1.2.3');
    expect(plan.tag).toBe('v1.2.3');
    expect((plan as any).strategy).toBe('git-flow');
    expect((plan as any).policyCheck).toBeDefined();
    expect((plan as any).policyCheck.warnings).toContain('Signed commits required');
    expect((plan as any).policyCheck.protectionInfo.protected).toBe(true);

    // No mutation commands in dry-run
    const mutationCmds = (executor.run as jest.Mock).mock.calls
      .map((c: any[]) => c[0])
      .filter(
        (cmd: string) =>
          cmd.includes('git checkout -b') ||
          cmd.includes('git tag --annotate') ||
          cmd.includes('git commit') ||
          cmd.includes('git push'),
      );
    expect(mutationCmds).toHaveLength(0);
    expect(rollback.record).not.toHaveBeenCalled();
  });

  // Test 10: Trunk-based with push — pushes current branch
  test('trunk-based with push — pushes current branch with --follow-tags', async () => {
    const strategy = createMockStrategy({
      name: 'trunk-based',
      branchName: null,
      reuseBranch: false,
      tagName: 'v1.2.3',
      commitMessage: 'Patch: v1.2.3. You SHOULD consider changes.',
    });
    const registry = createMockStrategyRegistry(strategy);
    const executor = createMockExecutor('main');
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();

    const result = await runPipeline(
      { ...baseOpts, push: true, noPr: true },
      {
        executor,
        config: configWithStrategy('trunk-based'),
        rollbackManager: rollback,
        artifactChecker,
        strategyRegistry: registry,
      },
    );

    expect(result.success).toBe(true);
    expect(result.branch).toBe('main');

    // Push should use current branch (main), not a new branch
    const pushCmds = (executor.run as jest.Mock).mock.calls
      .map((c: any[]) => c[0])
      .filter((cmd: string) => cmd.includes('git push'));
    expect(pushCmds.length).toBe(1);
    expect(pushCmds[0]).toContain('main');
    expect(pushCmds[0]).toContain('--follow-tags');
  });
});
