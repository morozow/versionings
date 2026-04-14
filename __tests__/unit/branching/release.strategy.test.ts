// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { createReleaseBranchStrategy } from '../../../src/branching/strategies/release.strategy';
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
    currentBranch: 'master',
    ...overrides,
  };
}


// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createReleaseBranchStrategy', () => {
  test('name() returns "release-branch"', () => {
    const strategy = createReleaseBranchStrategy(mockConfig);
    expect(strategy.name()).toBe('release-branch');
  });

  // -------------------------------------------------------------------------
  // composeBranchName — branch creation and reuse
  // -------------------------------------------------------------------------

  describe('composeBranchName', () => {
    test('minor → release/{version} with reuseBranch: false', () => {
      const strategy = createReleaseBranchStrategy(mockConfig);
      const result = strategy.composeBranchName(makeParams({ semver: 'minor', version: '1.2.0' }));
      expect(result).toEqual({ branchName: 'release/1.2.0', reuseBranch: false });
    });

    test('patch with Z>0 → release/{X}.{Y}.0 with reuseBranch: true', () => {
      const strategy = createReleaseBranchStrategy(mockConfig);
      const result = strategy.composeBranchName(makeParams({ semver: 'patch', version: '1.2.3' }));
      expect(result).toEqual({ branchName: 'release/1.2.0', reuseBranch: true });
    });

    test('patch with Z=0 → release/{version} with reuseBranch: false', () => {
      const strategy = createReleaseBranchStrategy(mockConfig);
      const result = strategy.composeBranchName(makeParams({ semver: 'patch', version: '1.2.0' }));
      expect(result).toEqual({ branchName: 'release/1.2.0', reuseBranch: false });
    });

    test('major → release/{version} with reuseBranch: false', () => {
      const strategy = createReleaseBranchStrategy(mockConfig);
      const result = strategy.composeBranchName(makeParams({ semver: 'major', version: '2.0.0' }));
      expect(result).toEqual({ branchName: 'release/2.0.0', reuseBranch: false });
    });

    test('uses custom branchTemplate when provided', () => {
      const configWithTemplate = {
        ...mockConfig,
        git: {
          ...mockConfig.git,
          branching: { branchTemplate: 'rel/{version}' },
        },
      } as unknown as VersioningsConfig;
      const strategy = createReleaseBranchStrategy(configWithTemplate);
      const result = strategy.composeBranchName(makeParams({ config: configWithTemplate }));
      expect(result).toEqual({ branchName: 'rel/1.2.0', reuseBranch: false });
    });
  });

  // -------------------------------------------------------------------------
  // composeTagName
  // -------------------------------------------------------------------------

  describe('composeTagName', () => {
    test('returns v{version}', () => {
      const strategy = createReleaseBranchStrategy(mockConfig);
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
      const strategy = createReleaseBranchStrategy(configWithTemplate);
      expect(strategy.composeTagName(makeParams({ config: configWithTemplate }))).toBe('release-1.2.0');
    });
  });

  // -------------------------------------------------------------------------
  // composeCommitMessage
  // -------------------------------------------------------------------------

  describe('composeCommitMessage', () => {
    test('uses commit message template from config', () => {
      const strategy = createReleaseBranchStrategy(mockConfig);
      expect(strategy.composeCommitMessage(makeParams({ semver: 'minor', version: '1.2.0' }))).toBe('Minor: 1.2.0.');
    });
  });

  // -------------------------------------------------------------------------
  // validateContext — always valid
  // -------------------------------------------------------------------------

  describe('validateContext', () => {
    test('always returns valid', () => {
      const strategy = createReleaseBranchStrategy(mockConfig);
      expect(strategy.validateContext(makeParams())).toEqual({ valid: true, errors: [] });
    });

    test('valid on any branch', () => {
      const strategy = createReleaseBranchStrategy(mockConfig);
      expect(strategy.validateContext(makeParams({ currentBranch: 'release/1.2.0' }))).toEqual({ valid: true, errors: [] });
      expect(strategy.validateContext(makeParams({ currentBranch: 'master' }))).toEqual({ valid: true, errors: [] });
      expect(strategy.validateContext(makeParams({ currentBranch: 'develop' }))).toEqual({ valid: true, errors: [] });
    });
  });
});
