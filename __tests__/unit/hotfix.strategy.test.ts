// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { createHotfixStrategy } from '../../hotfix.strategy';
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
// name()
// ---------------------------------------------------------------------------

describe('createHotfixStrategy', () => {
  test('name() returns "hotfix"', () => {
    const strategy = createHotfixStrategy(mockConfig);
    expect(strategy.name()).toBe('hotfix');
  });

  // -------------------------------------------------------------------------
  // composeBranchName
  // -------------------------------------------------------------------------

  describe('composeBranchName', () => {
    test('returns hotfix/{version} by default', () => {
      const strategy = createHotfixStrategy(mockConfig);
      const result = strategy.composeBranchName(makeParams());
      expect(result).toEqual({ branchName: 'hotfix/1.2.3', reuseBranch: false });
    });

    test('uses custom branchTemplate when provided', () => {
      const configWithTemplate = {
        ...mockConfig,
        git: {
          ...mockConfig.git,
          branching: { branchTemplate: 'fix/{version}' },
        },
      } as unknown as VersioningsConfig;
      const strategy = createHotfixStrategy(configWithTemplate);
      const result = strategy.composeBranchName(makeParams({ config: configWithTemplate }));
      expect(result).toEqual({ branchName: 'fix/1.2.3', reuseBranch: false });
    });

    test('reuseBranch is always false', () => {
      const strategy = createHotfixStrategy(mockConfig);
      const result = strategy.composeBranchName(makeParams());
      expect(result.reuseBranch).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // composeTagName
  // -------------------------------------------------------------------------

  describe('composeTagName', () => {
    test('returns v{version} by default', () => {
      const strategy = createHotfixStrategy(mockConfig);
      expect(strategy.composeTagName(makeParams())).toBe('v1.2.3');
    });

    test('uses custom tagTemplate when provided', () => {
      const configWithTemplate = {
        ...mockConfig,
        git: {
          ...mockConfig.git,
          branching: { tagTemplate: 'release-{version}' },
        },
      } as unknown as VersioningsConfig;
      const strategy = createHotfixStrategy(configWithTemplate);
      expect(strategy.composeTagName(makeParams({ config: configWithTemplate }))).toBe('release-1.2.3');
    });
  });

  // -------------------------------------------------------------------------
  // composeCommitMessage
  // -------------------------------------------------------------------------

  describe('composeCommitMessage', () => {
    test('uses commit message template from config', () => {
      const strategy = createHotfixStrategy(mockConfig);
      expect(strategy.composeCommitMessage(makeParams())).toBe('Patch: 1.2.3.');
    });

    test('returns fallback message when template is empty', () => {
      const emptyConfig = {
        ...mockConfig,
        git: {
          ...mockConfig.git,
          commit: { message: { semver: { patch: '', minor: '', major: '', prepatch: '', preminor: '', premajor: '', prerelease: '' } } },
        },
      } as unknown as VersioningsConfig;
      const strategy = createHotfixStrategy(emptyConfig);
      expect(strategy.composeCommitMessage(makeParams({ config: emptyConfig }))).toBe(
        'Read documentation and try to use versioning tool according to the standard.',
      );
    });
  });

  // -------------------------------------------------------------------------
  // validateContext
  // -------------------------------------------------------------------------

  describe('validateContext', () => {
    test('valid when semver=patch and currentBranch=master', () => {
      const strategy = createHotfixStrategy(mockConfig);
      const result = strategy.validateContext(makeParams());
      expect(result).toEqual({ valid: true, errors: [] });
    });

    test('valid when semver=patch and currentBranch=main', () => {
      const strategy = createHotfixStrategy(mockConfig);
      const result = strategy.validateContext(makeParams({ currentBranch: 'main' }));
      expect(result).toEqual({ valid: true, errors: [] });
    });

    test('valid when semver=patch and currentBranch matches custom mainBranch', () => {
      const configWithMain = {
        ...mockConfig,
        git: {
          ...mockConfig.git,
          branching: { mainBranch: 'production' },
        },
      } as unknown as VersioningsConfig;
      const strategy = createHotfixStrategy(configWithMain);
      const result = strategy.validateContext(makeParams({ currentBranch: 'production' }));
      expect(result).toEqual({ valid: true, errors: [] });
    });

    test('invalid when semver is not patch — returns error about semver type', () => {
      const strategy = createHotfixStrategy(mockConfig);
      const result = strategy.validateContext(makeParams({ semver: 'minor' }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.stringContaining('Hotfix strategy only allows "patch" semver type, got "minor"'),
      );
    });

    test('invalid when semver is major', () => {
      const strategy = createHotfixStrategy(mockConfig);
      const result = strategy.validateContext(makeParams({ semver: 'major' }));
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('got "major"');
    });

    test('invalid when semver is prerelease', () => {
      const strategy = createHotfixStrategy(mockConfig);
      const result = strategy.validateContext(makeParams({ semver: 'prerelease' }));
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('got "prerelease"');
    });

    test('invalid when currentBranch is not main/master — returns error about branch', () => {
      const strategy = createHotfixStrategy(mockConfig);
      const result = strategy.validateContext(makeParams({ currentBranch: 'develop' }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.stringContaining('Hotfix strategy requires current branch to be "master" or "main", but got "develop"'),
      );
    });

    test('returns both errors when semver is not patch AND branch is wrong', () => {
      const strategy = createHotfixStrategy(mockConfig);
      const result = strategy.validateContext(makeParams({ semver: 'minor', currentBranch: 'develop' }));
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]).toContain('Hotfix strategy only allows "patch" semver type');
      expect(result.errors[1]).toContain('Hotfix strategy requires current branch to be');
    });
  });
});
