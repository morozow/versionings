// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { createMaintenanceStrategy } from '../../../src/branching/strategies/maintenance.strategy';
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
    currentBranch: 'support/1.2',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// name()
// ---------------------------------------------------------------------------

describe('createMaintenanceStrategy', () => {
  test('name() returns "maintenance"', () => {
    const strategy = createMaintenanceStrategy(mockConfig);
    expect(strategy.name()).toBe('maintenance');
  });

  // -------------------------------------------------------------------------
  // composeBranchName
  // -------------------------------------------------------------------------

  describe('composeBranchName', () => {
    test('returns support/{major}.{minor} by default', () => {
      const strategy = createMaintenanceStrategy(mockConfig);
      const result = strategy.composeBranchName(makeParams());
      expect(result.branchName).toBe('support/1.2');
    });

    test('does not include patch component in branch name', () => {
      const strategy = createMaintenanceStrategy(mockConfig);
      const result = strategy.composeBranchName(makeParams({ version: '3.4.5' }));
      expect(result.branchName).toBe('support/3.4');
    });

    test('reuseBranch is true when patch > 0', () => {
      const strategy = createMaintenanceStrategy(mockConfig);
      const result = strategy.composeBranchName(makeParams({ version: '1.2.3' }));
      expect(result.reuseBranch).toBe(true);
    });

    test('reuseBranch is false when patch is 0 (first creation)', () => {
      const strategy = createMaintenanceStrategy(mockConfig);
      const result = strategy.composeBranchName(makeParams({ version: '1.2.0' }));
      expect(result).toEqual({ branchName: 'support/1.2', reuseBranch: false });
    });

    test('uses custom branchTemplate when provided', () => {
      const configWithTemplate = {
        ...mockConfig,
        git: {
          ...mockConfig.git,
          branching: { branchTemplate: 'maint/{major}.{minor}' },
        },
      } as unknown as VersioningsConfig;
      const strategy = createMaintenanceStrategy(configWithTemplate);
      const result = strategy.composeBranchName(makeParams({ config: configWithTemplate }));
      expect(result.branchName).toBe('maint/1.2');
    });

    test('custom branchTemplate bypasses reuse logic', () => {
      const configWithTemplate = {
        ...mockConfig,
        git: {
          ...mockConfig.git,
          branching: { branchTemplate: 'maint/{major}.{minor}' },
        },
      } as unknown as VersioningsConfig;
      const strategy = createMaintenanceStrategy(configWithTemplate);
      // custom template always returns reuseBranch: false
      const result = strategy.composeBranchName(makeParams({ config: configWithTemplate, version: '2.3.1' }));
      expect(result.reuseBranch).toBe(false);
      const result2 = strategy.composeBranchName(makeParams({ config: configWithTemplate, version: '2.3.0' }));
      expect(result2.reuseBranch).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // composeTagName
  // -------------------------------------------------------------------------

  describe('composeTagName', () => {
    test('returns v{version} by default', () => {
      const strategy = createMaintenanceStrategy(mockConfig);
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
      const strategy = createMaintenanceStrategy(configWithTemplate);
      expect(strategy.composeTagName(makeParams({ config: configWithTemplate }))).toBe('release-1.2.3');
    });
  });

  // -------------------------------------------------------------------------
  // composeCommitMessage
  // -------------------------------------------------------------------------

  describe('composeCommitMessage', () => {
    test('uses commit message template from config', () => {
      const strategy = createMaintenanceStrategy(mockConfig);
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
      const strategy = createMaintenanceStrategy(emptyConfig);
      expect(strategy.composeCommitMessage(makeParams({ config: emptyConfig }))).toBe(
        'Read documentation and try to use versioning tool according to the standard.',
      );
    });
  });

  // -------------------------------------------------------------------------
  // validateContext
  // -------------------------------------------------------------------------

  describe('validateContext', () => {
    test('valid when semver=patch and currentBranch is a support branch', () => {
      const strategy = createMaintenanceStrategy(mockConfig);
      const result = strategy.validateContext(makeParams({ currentBranch: 'support/1.2' }));
      expect(result).toEqual({ valid: true, errors: [] });
    });

    test('valid when semver=patch and currentBranch=master (first creation)', () => {
      const strategy = createMaintenanceStrategy(mockConfig);
      const result = strategy.validateContext(makeParams({ currentBranch: 'master' }));
      expect(result).toEqual({ valid: true, errors: [] });
    });

    test('valid when semver=patch and currentBranch=main (first creation)', () => {
      const strategy = createMaintenanceStrategy(mockConfig);
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
      const strategy = createMaintenanceStrategy(configWithMain);
      const result = strategy.validateContext(makeParams({ currentBranch: 'production' }));
      expect(result).toEqual({ valid: true, errors: [] });
    });

    test('invalid when semver is not patch — returns error about semver type', () => {
      const strategy = createMaintenanceStrategy(mockConfig);
      const result = strategy.validateContext(makeParams({ semver: 'minor' }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.stringContaining('Maintenance strategy only allows "patch" semver type, got "minor"'),
      );
    });

    test('invalid when semver is major', () => {
      const strategy = createMaintenanceStrategy(mockConfig);
      const result = strategy.validateContext(makeParams({ semver: 'major' }));
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('got "major"');
    });

    test('invalid when semver is prerelease', () => {
      const strategy = createMaintenanceStrategy(mockConfig);
      const result = strategy.validateContext(makeParams({ semver: 'prerelease' }));
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('got "prerelease"');
    });

    test('invalid when currentBranch is not support/* or main/master — returns error about branch', () => {
      const strategy = createMaintenanceStrategy(mockConfig);
      const result = strategy.validateContext(makeParams({ currentBranch: 'develop' }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.stringContaining('Maintenance strategy requires current branch to be a support branch or "master" or "main", but got "develop"'),
      );
    });

    test('returns both errors when semver is not patch AND branch is wrong', () => {
      const strategy = createMaintenanceStrategy(mockConfig);
      const result = strategy.validateContext(makeParams({ semver: 'minor', currentBranch: 'develop' }));
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]).toContain('Maintenance strategy only allows "patch" semver type');
      expect(result.errors[1]).toContain('Maintenance strategy requires current branch to be');
    });
  });
});
