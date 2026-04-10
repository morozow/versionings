// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import * as fc from 'fast-check';
import { createDefaultStrategy } from '../../default.strategy';
import { createTrunkStrategy } from '../../trunk.strategy';
import { createGitFlowStrategy } from '../../gitflow.strategy';
import { createReleaseBranchStrategy } from '../../release.strategy';
import { createHotfixStrategy } from '../../hotfix.strategy';
import { createMaintenanceStrategy } from '../../maintenance.strategy';
import { composeVersionBranchName, composeVersionTagName, semverMessage } from '../../version.utils';
import type { VersioningsConfig } from '../../config.validator';
import type { StrategyParams } from '../../branching.strategy';

// ---------------------------------------------------------------------------
// Shared mock config (same pattern as strategy unit tests)
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
// Generators
// ---------------------------------------------------------------------------

const arbSemver = fc.constantFrom(
  'patch', 'prepatch', 'minor', 'preminor', 'premajor', 'prerelease', 'major',
);

const arbVersion = fc
  .tuple(fc.integer({ min: 0, max: 99 }), fc.integer({ min: 0, max: 99 }), fc.integer({ min: 0, max: 99 }))
  .map(([x, y, z]) => `${x}.${y}.${z}`);

const arbComment = fc
  .stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
    { minLength: 1, maxLength: 20 },
  )
  .filter((s) => !s.includes('--') && !s.startsWith('-') && !s.endsWith('-'));

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
// Feature: branching-policy-enforcement, Property 2: Default_Strategy
// equivalence with legacy functions (model-based)
// ---------------------------------------------------------------------------

// **Validates: Requirements 2.2, 2.3, 2.4, 2.6**
describe('Property 2: Default_Strategy equivalence with legacy functions', () => {
  it('generates identical branch name as composeVersionBranchName()', () => {
    fc.assert(
      fc.property(arbSemver, arbVersion, arbComment, (semver, version, comment) => {
        const strategy = createDefaultStrategy(mockConfig);
        const params = makeParams({ semver, version, comment });
        const result = strategy.composeBranchName(params);
        const legacy = composeVersionBranchName(semver, version, comment, mockConfig);
        expect(result.branchName).toBe(legacy);
        expect(result.reuseBranch).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('generates identical tag name as composeVersionTagName()', () => {
    fc.assert(
      fc.property(arbSemver, arbVersion, arbComment, (semver, version, comment) => {
        const strategy = createDefaultStrategy(mockConfig);
        const params = makeParams({ semver, version, comment });
        const result = strategy.composeTagName(params);
        const legacy = composeVersionTagName(semver, version, comment);
        expect(result).toBe(legacy);
      }),
      { numRuns: 100 },
    );
  });

  it('generates identical commit message as semverMessage()', () => {
    fc.assert(
      fc.property(arbSemver, arbVersion, arbComment, (semver, version, comment) => {
        const strategy = createDefaultStrategy(mockConfig);
        const params = makeParams({ semver, version, comment });
        const result = strategy.composeCommitMessage(params);
        const legacy = semverMessage(semver, version, mockConfig);
        expect(result).toBe(legacy);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: branching-policy-enforcement, Property 3: Trunk-Based Strategy
// returns null for branch
// ---------------------------------------------------------------------------

// **Validates: Requirements 3.1, 3.3**
describe('Property 3: Trunk-Based Strategy returns null for branch', () => {
  it('composeBranchName() returns { branchName: null, reuseBranch: false } for any params', () => {
    fc.assert(
      fc.property(arbSemver, arbVersion, arbComment, (semver, version, comment) => {
        const strategy = createTrunkStrategy(mockConfig);
        const params = makeParams({ semver, version, comment });
        const result = strategy.composeBranchName(params);
        expect(result).toEqual({ branchName: null, reuseBranch: false });
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: branching-policy-enforcement, Property 4: Git-Flow branch routing
// ---------------------------------------------------------------------------

// **Validates: Requirements 4.1, 4.2, 4.6**
describe('Property 4: Git-Flow branch routing', () => {
  const releaseSemvers = ['minor', 'major', 'preminor', 'premajor', 'prerelease'] as const;
  const hotfixSemvers = ['patch', 'prepatch'] as const;

  it('minor/major/preminor/premajor/prerelease → release/{version}', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...releaseSemvers),
        arbVersion,
        arbComment,
        (semver, version, comment) => {
          const strategy = createGitFlowStrategy(mockConfig);
          const params = makeParams({ semver, version, comment });
          const result = strategy.composeBranchName(params);
          expect(result.branchName).toBe(`release/${version}`);
          expect(result.reuseBranch).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('patch/prepatch → hotfix/{version}', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...hotfixSemvers),
        arbVersion,
        arbComment,
        (semver, version, comment) => {
          const strategy = createGitFlowStrategy(mockConfig);
          const params = makeParams({ semver, version, comment });
          const result = strategy.composeBranchName(params);
          expect(result.branchName).toBe(`hotfix/${version}`);
          expect(result.reuseBranch).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: branching-policy-enforcement, Property 5: Tag v{version} for all
// non-default strategies
// ---------------------------------------------------------------------------

// **Validates: Requirements 3.2, 4.3, 5.2, 6.2, 7.2**
describe('Property 5: Tag v{version} for all non-default strategies', () => {
  const strategyFactories = [
    { name: 'trunk-based', factory: createTrunkStrategy },
    { name: 'git-flow', factory: createGitFlowStrategy },
    { name: 'release-branch', factory: createReleaseBranchStrategy },
    { name: 'hotfix', factory: createHotfixStrategy },
    { name: 'maintenance', factory: createMaintenanceStrategy },
  ] as const;

  for (const { name, factory } of strategyFactories) {
    it(`${name}: composeTagName() returns v{version} (without custom tagTemplate)`, () => {
      fc.assert(
        fc.property(arbSemver, arbVersion, arbComment, (semver, version, comment) => {
          const strategy = factory(mockConfig);
          const params = makeParams({ semver, version, comment });
          const tag = strategy.composeTagName(params);
          expect(tag).toBe(`v${version}`);
        }),
        { numRuns: 100 },
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Feature: branching-policy-enforcement, Property 9: Maintenance branch pattern
// ---------------------------------------------------------------------------

// **Validates: Requirements 7.1**
describe('Property 9: Maintenance branch pattern', () => {
  it('for any valid version X.Y.Z, maintenance returns support/{X}.{Y} (no patch component)', () => {
    fc.assert(
      fc.property(arbSemver, arbVersion, arbComment, (semver, version, comment) => {
        const strategy = createMaintenanceStrategy(mockConfig);
        const params = makeParams({ semver, version, comment });
        const result = strategy.composeBranchName(params);
        const parts = version.split('.');
        const expectedBranch = `support/${parts[0]}.${parts[1]}`;
        expect(result.branchName).toBe(expectedBranch);
      }),
      { numRuns: 100 },
    );
  });
});
