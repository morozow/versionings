// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau
// Feature: branching-policy-enforcement, Property 1: Strategy Registry Mapping

import * as fc from 'fast-check';
import { createStrategyRegistry } from '../../../src/branching/strategy.registry';
import { EXIT_CODES, VersioningsError } from '../../../src/core/errors';
import type { VersioningsConfig } from '../../../src/config/config.validator';

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

const KNOWN_STRATEGIES = ['default', 'trunk-based', 'git-flow', 'release-branch', 'hotfix', 'maintenance'];

const arbStrategyName = fc.constantFrom(...KNOWN_STRATEGIES);

const arbUnknownStrategyName = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => !KNOWN_STRATEGIES.includes(s));

describe('Property 1: Strategy Registry Mapping', () => {
  it('for any known strategy name, getStrategy returns a strategy with matching name()', () => {
    fc.assert(
      fc.property(arbStrategyName, (name: string) => {
        const registry = createStrategyRegistry();
        const strategy = registry.getStrategy(name, mockConfig);
        expect(strategy.name()).toBe(name);
      }),
      { numRuns: 100 },
    );
  });

  it('for any unknown strategy name, getStrategy throws VersioningsError(CONFIG_ERROR)', () => {
    fc.assert(
      fc.property(arbUnknownStrategyName, (name: string) => {
        const registry = createStrategyRegistry();
        try {
          registry.getStrategy(name, mockConfig);
          throw new Error('Expected VersioningsError to be thrown');
        } catch (err: any) {
          expect(err).toBeInstanceOf(VersioningsError);
          expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
          for (const s of KNOWN_STRATEGIES) {
            expect(err.message).toContain(s);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
