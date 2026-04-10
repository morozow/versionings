// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { createGitFlowStrategy } from '../../../src/branching/strategies/gitflow.strategy';
import type { VersioningsConfig } from '../../../src/config/config.validator';
import type { StrategyParams } from '../../../src/branching/branching.strategy';

// ---------------------------------------------------------------------------
// Minimal mock config
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

function makeParams(overrides: Partial<StrategyParams> = {}): StrategyParams {
  return {
    semver: 'minor',
    version: '1.2.0',
    comment: 'new-feature',
    config: mockConfig,
    currentBranch: 'develop',
    ...overrides,
  };
}


// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createGitFlowStrategy', () => {
  test('name() returns "git-flow"', () => {
    const strategy = createGitFlowStrategy(mockConfig);
    expect(strategy.name()).toBe('git-flow');
  });

  // -------------------------------------------------------------------------
  // composeBranchName — release/hotfix routing
  // -------------------------------------------------------------------------

  describe('composeBranchName', () => {
    test('minor → release/{version}', () => {
      const strategy = createGitFlowStrategy(mockConfig);
      const result = strategy.composeBranchName(makeParams({ semver: 'minor', version: '1.2.0' }));
      expect(result).toEqual({ branchName: 'release/1.2.0', reuseBranch: false });
    });

    test('major → release/{version}', () => {
      const strategy = createGitFlowStrategy(mockConfig);
      const result = strategy.composeBranchName(makeParams({ semver: 'major', version: '2.0.0' }));
      expect(result).toEqual({ branchName: 'release/2.0.0', reuseBranch: false });
    });

    test('patch → hotfix/{version}', () => {
      const strategy = createGitFlowStrategy(mockConfig);
      const result = strategy.composeBranchName(makeParams({ semver: 'patch', version: '1.2.3' }));
      expect(result).toEqual({ branchName: 'hotfix/1.2.3', reuseBranch: false });
    });

    test('prerelease → release/{version}', () => {
      const strategy = createGitFlowStrategy(mockConfig);
      const result = strategy.composeBranchName(makeParams({ semver: 'prerelease', version: '1.2.3-beta.1' }));
      expect(result).toEqual({ branchName: 'release/1.2.3-beta.1', reuseBranch: false });
    });

    test('prepatch → hotfix/{version}', () => {
      const strategy = createGitFlowStrategy(mockConfig);
      const result = strategy.composeBranchName(makeParams({ semver: 'prepatch', version: '1.2.4-rc.0' }));
      expect(result).toEqual({ branchName: 'hotfix/1.2.4-rc.0', reuseBranch: false });
    });

    test('preminor → release/{version}', () => {
      const strategy = createGitFlowStrategy(mockConfig);
      const result = strategy.composeBranchName(makeParams({ semver: 'preminor', version: '1.3.0-alpha.0' }));
      expect(result).toEqual({ branchName: 'release/1.3.0-alpha.0', reuseBranch: false });
    });

    test('premajor → release/{version}', () => {
      const strategy = createGitFlowStrategy(mockConfig);
      const result = strategy.composeBranchName(makeParams({ semver: 'premajor', version: '2.0.0-alpha.0' }));
      expect(result).toEqual({ branchName: 'release/2.0.0-alpha.0', reuseBranch: false });
    });
  });

  // -------------------------------------------------------------------------
  // composeTagName
  // -------------------------------------------------------------------------

  describe('composeTagName', () => {
    test('returns v{version}', () => {
      const strategy = createGitFlowStrategy(mockConfig);
      expect(strategy.composeTagName(makeParams())).toBe('v1.2.0');
    });

    test('uses custom tagTemplate when provided', () => {
      const configWithTemplate = {
        ...mockConfig,
        git: {
          ...mockConfig.git,
          branching: { tagTemplate: 'release-{version}' },
        },
      } as unknown as VersioningsConfig;
      const strategy = createGitFlowStrategy(configWithTemplate);
      expect(strategy.composeTagName(makeParams({ config: configWithTemplate }))).toBe('release-1.2.0');
    });
  });

  // -------------------------------------------------------------------------
  // composeCommitMessage
  // -------------------------------------------------------------------------

  describe('composeCommitMessage', () => {
    test('uses commit message template from config', () => {
      const strategy = createGitFlowStrategy(mockConfig);
      expect(strategy.composeCommitMessage(makeParams({ semver: 'minor', version: '1.2.0' }))).toBe('Minor: 1.2.0.');
    });
  });

  // -------------------------------------------------------------------------
  // validateContext — develop for release, main for hotfix
  // -------------------------------------------------------------------------

  describe('validateContext', () => {
    test('minor on develop → valid', () => {
      const strategy = createGitFlowStrategy(mockConfig);
      const result = strategy.validateContext(makeParams({ semver: 'minor', currentBranch: 'develop' }));
      expect(result).toEqual({ valid: true, errors: [] });
    });

    test('minor on master → invalid', () => {
      const strategy = createGitFlowStrategy(mockConfig);
      const result = strategy.validateContext(makeParams({ semver: 'minor', currentBranch: 'master' }));
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('requires current branch to be "develop"');
    });

    test('patch on master → valid', () => {
      const strategy = createGitFlowStrategy(mockConfig);
      const result = strategy.validateContext(makeParams({ semver: 'patch', currentBranch: 'master' }));
      expect(result).toEqual({ valid: true, errors: [] });
    });

    test('patch on main → valid', () => {
      const strategy = createGitFlowStrategy(mockConfig);
      const result = strategy.validateContext(makeParams({ semver: 'patch', currentBranch: 'main' }));
      expect(result).toEqual({ valid: true, errors: [] });
    });

    test('patch on develop → invalid', () => {
      const strategy = createGitFlowStrategy(mockConfig);
      const result = strategy.validateContext(makeParams({ semver: 'patch', currentBranch: 'develop' }));
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('requires current branch to be "master" or "main"');
    });

    test('prerelease on develop → valid', () => {
      const strategy = createGitFlowStrategy(mockConfig);
      const result = strategy.validateContext(makeParams({ semver: 'prerelease', currentBranch: 'develop' }));
      expect(result).toEqual({ valid: true, errors: [] });
    });

    test('major on develop → valid', () => {
      const strategy = createGitFlowStrategy(mockConfig);
      const result = strategy.validateContext(makeParams({ semver: 'major', currentBranch: 'develop' }));
      expect(result).toEqual({ valid: true, errors: [] });
    });

    test('prepatch on master → valid (hotfix type)', () => {
      const strategy = createGitFlowStrategy(mockConfig);
      const result = strategy.validateContext(makeParams({ semver: 'prepatch', currentBranch: 'master' }));
      expect(result).toEqual({ valid: true, errors: [] });
    });
  });
});
