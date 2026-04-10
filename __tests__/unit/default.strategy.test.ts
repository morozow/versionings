// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { createDefaultStrategy } from '../../default.strategy';
import { composeVersionBranchName, composeVersionTagName, semverMessage } from '../../version.utils';
import type { VersioningsConfig } from '../../config.validator';
import type { StrategyParams } from '../../branching.strategy';

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

describe('createDefaultStrategy', () => {
  test('name() returns "default"', () => {
    const strategy = createDefaultStrategy(mockConfig);
    expect(strategy.name()).toBe('default');
  });

  // -------------------------------------------------------------------------
  // composeBranchName — equivalence with legacy composeVersionBranchName
  // -------------------------------------------------------------------------

  describe('composeBranchName', () => {
    test('matches legacy composeVersionBranchName for patch', () => {
      const strategy = createDefaultStrategy(mockConfig);
      const params = makeParams({ semver: 'patch', version: '1.2.3', comment: 'fix-login' });
      const result = strategy.composeBranchName(params);
      const legacy = composeVersionBranchName('patch', '1.2.3', 'fix-login', mockConfig);
      expect(result.branchName).toBe(legacy);
      expect(result.reuseBranch).toBe(false);
    });

    test('matches legacy composeVersionBranchName for minor', () => {
      const strategy = createDefaultStrategy(mockConfig);
      const params = makeParams({ semver: 'minor', version: '1.3.0', comment: 'add-feature' });
      const result = strategy.composeBranchName(params);
      const legacy = composeVersionBranchName('minor', '1.3.0', 'add-feature', mockConfig);
      expect(result.branchName).toBe(legacy);
    });

    test('matches legacy composeVersionBranchName for major', () => {
      const strategy = createDefaultStrategy(mockConfig);
      const params = makeParams({ semver: 'major', version: '2.0.0', comment: 'breaking' });
      const result = strategy.composeBranchName(params);
      const legacy = composeVersionBranchName('major', '2.0.0', 'breaking', mockConfig);
      expect(result.branchName).toBe(legacy);
    });

    test('uses custom branchTemplate when provided', () => {
      const configWithTemplate = {
        ...mockConfig,
        git: {
          ...mockConfig.git,
          branching: { branchTemplate: 'release/{version}' },
        },
      } as unknown as VersioningsConfig;
      const strategy = createDefaultStrategy(configWithTemplate);
      const result = strategy.composeBranchName(makeParams({ config: configWithTemplate }));
      expect(result).toEqual({ branchName: 'release/1.2.3', reuseBranch: false });
    });
  });

  // -------------------------------------------------------------------------
  // composeTagName — equivalence with legacy composeVersionTagName
  // -------------------------------------------------------------------------

  describe('composeTagName', () => {
    test('matches legacy composeVersionTagName', () => {
      const strategy = createDefaultStrategy(mockConfig);
      const params = makeParams();
      const result = strategy.composeTagName(params);
      const legacy = composeVersionTagName('patch', '1.2.3', 'fix-login');
      expect(result).toBe(legacy);
    });

    test('uses custom tagTemplate when provided', () => {
      const configWithTemplate = {
        ...mockConfig,
        git: {
          ...mockConfig.git,
          branching: { tagTemplate: 'v{version}' },
        },
      } as unknown as VersioningsConfig;
      const strategy = createDefaultStrategy(configWithTemplate);
      expect(strategy.composeTagName(makeParams({ config: configWithTemplate }))).toBe('v1.2.3');
    });
  });

  // -------------------------------------------------------------------------
  // composeCommitMessage — equivalence with legacy semverMessage
  // -------------------------------------------------------------------------

  describe('composeCommitMessage', () => {
    test('matches legacy semverMessage for patch', () => {
      const strategy = createDefaultStrategy(mockConfig);
      const params = makeParams({ semver: 'patch', version: '1.2.3' });
      const result = strategy.composeCommitMessage(params);
      const legacy = semverMessage('patch', '1.2.3', mockConfig);
      expect(result).toBe(legacy);
    });

    test('matches legacy semverMessage for minor', () => {
      const strategy = createDefaultStrategy(mockConfig);
      const params = makeParams({ semver: 'minor', version: '1.3.0' });
      const result = strategy.composeCommitMessage(params);
      const legacy = semverMessage('minor', '1.3.0', mockConfig);
      expect(result).toBe(legacy);
    });

    test('returns fallback message when template is empty', () => {
      const emptyConfig = {
        ...mockConfig,
        git: {
          ...mockConfig.git,
          commit: { message: { semver: { patch: '', minor: '', major: '', prepatch: '', preminor: '', premajor: '', prerelease: '' } } },
        },
      } as unknown as VersioningsConfig;
      const strategy = createDefaultStrategy(emptyConfig);
      expect(strategy.composeCommitMessage(makeParams({ config: emptyConfig }))).toBe(
        'Read documentation and try to use versioning tool according to the standard.',
      );
    });
  });

  // -------------------------------------------------------------------------
  // validateContext — always valid
  // -------------------------------------------------------------------------

  describe('validateContext', () => {
    test('always returns valid for any branch', () => {
      const strategy = createDefaultStrategy(mockConfig);
      expect(strategy.validateContext(makeParams({ currentBranch: 'master' }))).toEqual({ valid: true, errors: [] });
      expect(strategy.validateContext(makeParams({ currentBranch: 'develop' }))).toEqual({ valid: true, errors: [] });
      expect(strategy.validateContext(makeParams({ currentBranch: 'feature/xyz' }))).toEqual({ valid: true, errors: [] });
    });

    test('always returns valid for any semver type', () => {
      const strategy = createDefaultStrategy(mockConfig);
      expect(strategy.validateContext(makeParams({ semver: 'patch' }))).toEqual({ valid: true, errors: [] });
      expect(strategy.validateContext(makeParams({ semver: 'minor' }))).toEqual({ valid: true, errors: [] });
      expect(strategy.validateContext(makeParams({ semver: 'major' }))).toEqual({ valid: true, errors: [] });
    });
  });
});
