// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { createTrunkStrategy } from '../../../src/branching/strategies/trunk.strategy';
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
    semver: 'patch',
    version: '1.2.3',
    comment: 'fix-login',
    config: mockConfig,
    currentBranch: 'master',
    ...overrides,
  };
}


// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createTrunkStrategy', () => {
  test('name() returns "trunk-based"', () => {
    const strategy = createTrunkStrategy(mockConfig);
    expect(strategy.name()).toBe('trunk-based');
  });

  // -------------------------------------------------------------------------
  // composeBranchName — always null
  // -------------------------------------------------------------------------

  describe('composeBranchName', () => {
    test('returns { branchName: null, reuseBranch: false }', () => {
      const strategy = createTrunkStrategy(mockConfig);
      const result = strategy.composeBranchName(makeParams());
      expect(result).toEqual({ branchName: null, reuseBranch: false });
    });

    test('returns null branch regardless of semver type', () => {
      const strategy = createTrunkStrategy(mockConfig);
      expect(strategy.composeBranchName(makeParams({ semver: 'minor' })).branchName).toBeNull();
      expect(strategy.composeBranchName(makeParams({ semver: 'major' })).branchName).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // composeTagName — v{version}
  // -------------------------------------------------------------------------

  describe('composeTagName', () => {
    test('returns v{version} by default', () => {
      const strategy = createTrunkStrategy(mockConfig);
      expect(strategy.composeTagName(makeParams())).toBe('v1.2.3');
    });

    test('returns v{version} for different versions', () => {
      const strategy = createTrunkStrategy(mockConfig);
      expect(strategy.composeTagName(makeParams({ version: '2.0.0' }))).toBe('v2.0.0');
    });

    test('uses custom tagTemplate when provided', () => {
      const configWithTemplate = {
        ...mockConfig,
        git: {
          ...mockConfig.git,
          branching: { tagTemplate: 'release-{version}' },
        },
      } as unknown as VersioningsConfig;
      const strategy = createTrunkStrategy(configWithTemplate);
      expect(strategy.composeTagName(makeParams({ config: configWithTemplate }))).toBe('release-1.2.3');
    });
  });

  // -------------------------------------------------------------------------
  // composeCommitMessage
  // -------------------------------------------------------------------------

  describe('composeCommitMessage', () => {
    test('uses commit message template from config', () => {
      const strategy = createTrunkStrategy(mockConfig);
      expect(strategy.composeCommitMessage(makeParams())).toBe('Patch: 1.2.3.');
    });
  });

  // -------------------------------------------------------------------------
  // validateContext — main/master only
  // -------------------------------------------------------------------------

  describe('validateContext', () => {
    test('valid on master', () => {
      const strategy = createTrunkStrategy(mockConfig);
      const result = strategy.validateContext(makeParams({ currentBranch: 'master' }));
      expect(result).toEqual({ valid: true, errors: [] });
    });

    test('valid on main', () => {
      const strategy = createTrunkStrategy(mockConfig);
      const result = strategy.validateContext(makeParams({ currentBranch: 'main' }));
      expect(result).toEqual({ valid: true, errors: [] });
    });

    test('invalid on feature/xxx', () => {
      const strategy = createTrunkStrategy(mockConfig);
      const result = strategy.validateContext(makeParams({ currentBranch: 'feature/xxx' }));
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Trunk-based strategy requires current branch to be "master" or "main"');
    });

    test('valid on custom mainBranch', () => {
      const configWithMain = {
        ...mockConfig,
        git: {
          ...mockConfig.git,
          branching: { mainBranch: 'production' },
        },
      } as unknown as VersioningsConfig;
      const strategy = createTrunkStrategy(configWithMain);
      const result = strategy.validateContext(makeParams({ currentBranch: 'production' }));
      expect(result).toEqual({ valid: true, errors: [] });
    });
  });
});
