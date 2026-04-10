// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { createStrategyRegistry } from '../../strategy.registry';
import { EXIT_CODES, VersioningsError } from '../../errors';
import type { VersioningsConfig } from '../../config.validator';
import type { Branching_Strategy } from '../../branching.strategy';

// ---------------------------------------------------------------------------
// Minimal mock config for testing
// ---------------------------------------------------------------------------

const mockConfig = {
  git: {
    platform: 'github',
    url: 'https://github.com/test/repo',
    branchType: { version: 'version' },
    pr: { target: 'master' },
    limits: { branchMaxCommentLength: 96 },
    remote: 'origin',
    commit: { message: { semver: { prepatch: '', patch: '', preminor: '', minor: '', premajor: '', major: '', prerelease: '' } } },
  },
  package: { semver: { patch: 'patch', prepatch: 'prepatch', minor: 'minor', preminor: 'preminor', premajor: 'premajor', prerelease: 'prerelease', major: 'major' } },
  common: { messages: {} },
} as unknown as VersioningsConfig;

// ---------------------------------------------------------------------------
// All 6 default strategies
// ---------------------------------------------------------------------------

const ALL_STRATEGIES = [
  'default',
  'trunk-based',
  'git-flow',
  'release-branch',
  'hotfix',
  'maintenance',
];

// ---------------------------------------------------------------------------
// availableStrategies() returns all 6 strategies
// ---------------------------------------------------------------------------

describe('availableStrategies()', () => {
  test('returns all 6 default strategies', () => {
    const registry = createStrategyRegistry();
    const strategies = registry.availableStrategies();
    expect(strategies).toHaveLength(6);
    for (const s of ALL_STRATEGIES) {
      expect(strategies).toContain(s);
    }
  });
});


// ---------------------------------------------------------------------------
// getStrategy returns a strategy for each registered name, name() matches
// ---------------------------------------------------------------------------

describe('getStrategy for each strategy name', () => {
  const registry = createStrategyRegistry();

  test.each(ALL_STRATEGIES)('returns a strategy for name "%s"', (name) => {
    const strategy = registry.getStrategy(name, mockConfig);
    expect(strategy).toBeDefined();
    expect(typeof strategy.name).toBe('function');
    expect(typeof strategy.composeBranchName).toBe('function');
    expect(typeof strategy.composeTagName).toBe('function');
    expect(typeof strategy.composeCommitMessage).toBe('function');
    expect(typeof strategy.validateContext).toBe('function');
  });
});

describe('name() matches the strategy name', () => {
  const registry = createStrategyRegistry();

  test.each(ALL_STRATEGIES)('strategy.name() === "%s"', (name) => {
    const strategy = registry.getStrategy(name, mockConfig);
    expect(strategy.name()).toBe(name);
  });
});

// ---------------------------------------------------------------------------
// Unknown strategy → VersioningsError(CONFIG_ERROR) with available strategies
// ---------------------------------------------------------------------------

describe('unknown strategy throws VersioningsError', () => {
  const registry = createStrategyRegistry();

  test('throws VersioningsError with CONFIG_ERROR code', () => {
    expect(() => registry.getStrategy('nonexistent', mockConfig)).toThrow(VersioningsError);
  });

  test('error code is CONFIG_ERROR', () => {
    try {
      registry.getStrategy('nonexistent', mockConfig);
      fail('Expected VersioningsError');
    } catch (err) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect((err as VersioningsError).code).toBe(EXIT_CODES.CONFIG_ERROR);
    }
  });

  test('error message lists all available strategies', () => {
    try {
      registry.getStrategy('nonexistent', mockConfig);
      fail('Expected VersioningsError');
    } catch (err) {
      const message = (err as VersioningsError).message;
      for (const s of ALL_STRATEGIES) {
        expect(message).toContain(s);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// register() allows adding a custom strategy
// ---------------------------------------------------------------------------

describe('register custom strategy', () => {
  test('registers a new strategy and getStrategy returns it', () => {
    const registry = createStrategyRegistry();

    const customStrategy: Branching_Strategy = {
      name: () => 'custom',
      composeBranchName: jest.fn(),
      composeTagName: jest.fn().mockReturnValue('v1.0.0'),
      composeCommitMessage: jest.fn().mockReturnValue('bump'),
      validateContext: jest.fn().mockReturnValue({ valid: true, errors: [] }),
    };

    registry.register('custom', () => customStrategy);

    const strategy = registry.getStrategy('custom', mockConfig);
    expect(strategy.name()).toBe('custom');
  });

  test('registered strategy appears in availableStrategies()', () => {
    const registry = createStrategyRegistry();
    registry.register('custom', () => ({
      name: () => 'custom',
      composeBranchName: jest.fn(),
      composeTagName: jest.fn().mockReturnValue(''),
      composeCommitMessage: jest.fn().mockReturnValue(''),
      validateContext: jest.fn().mockReturnValue({ valid: true, errors: [] }),
    }));
    expect(registry.availableStrategies()).toContain('custom');
  });

  test('overrides an existing default strategy factory', () => {
    const registry = createStrategyRegistry();

    const overriddenStrategy: Branching_Strategy = {
      name: () => 'default',
      composeBranchName: jest.fn().mockReturnValue({ branchName: 'overridden/branch', reuseBranch: false }),
      composeTagName: jest.fn().mockReturnValue('overridden-tag'),
      composeCommitMessage: jest.fn().mockReturnValue('overridden commit'),
      validateContext: jest.fn().mockReturnValue({ valid: true, errors: [] }),
    };

    registry.register('default', () => overriddenStrategy);

    const strategy = registry.getStrategy('default', mockConfig);
    expect(strategy.composeTagName({} as any)).toBe('overridden-tag');
  });
});
