// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import * as fc from 'fast-check';
import { createTrunkStrategy } from '../../trunk.strategy';
import { createHotfixStrategy } from '../../hotfix.strategy';
import { createMaintenanceStrategy } from '../../maintenance.strategy';
import { createGitFlowStrategy } from '../../gitflow.strategy';
import type { VersioningsConfig } from '../../config.validator';
import type { StrategyParams } from '../../branching.strategy';

// ---------------------------------------------------------------------------
// Shared mock config (same pattern as strategy.naming.property.test.ts)
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

const arbBranchName = fc
  .stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-/'.split('')),
    { minLength: 1, maxLength: 30 },
  )
  .filter((s) => s !== 'master' && s !== 'main' && s !== 'develop');

const arbNonPatchSemver = fc.constantFrom(
  'prepatch', 'minor', 'preminor', 'premajor', 'prerelease', 'major',
);

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
// Feature: branching-policy-enforcement, Property 6: Validation of current
// branch for strategies requiring main/master
// ---------------------------------------------------------------------------

// **Validates: Requirements 3.6, 6.3**
describe('Property 6: Validation of current branch for strategies requiring main/master', () => {
  it('trunk-based: valid=true when currentBranch is master or main', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('master', 'main'),
        arbSemver,
        arbVersion,
        arbComment,
        (branch, semver, version, comment) => {
          const strategy = createTrunkStrategy(mockConfig);
          const params = makeParams({ semver, version, comment, currentBranch: branch });
          const result = strategy.validateContext(params);
          expect(result.valid).toBe(true);
          expect(result.errors).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('trunk-based: valid=false for any branch other than master/main', () => {
    fc.assert(
      fc.property(
        arbBranchName,
        arbSemver,
        arbVersion,
        arbComment,
        (branch, semver, version, comment) => {
          const strategy = createTrunkStrategy(mockConfig);
          const params = makeParams({ semver, version, comment, currentBranch: branch });
          const result = strategy.validateContext(params);
          expect(result.valid).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('hotfix: valid=true when currentBranch is master or main AND semver=patch', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('master', 'main'),
        arbVersion,
        arbComment,
        (branch, version, comment) => {
          const strategy = createHotfixStrategy(mockConfig);
          const params = makeParams({ semver: 'patch', version, comment, currentBranch: branch });
          const result = strategy.validateContext(params);
          expect(result.valid).toBe(true);
          expect(result.errors).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('hotfix: valid=false for any branch other than master/main (with semver=patch)', () => {
    fc.assert(
      fc.property(
        arbBranchName,
        arbVersion,
        arbComment,
        (branch, version, comment) => {
          const strategy = createHotfixStrategy(mockConfig);
          const params = makeParams({ semver: 'patch', version, comment, currentBranch: branch });
          const result = strategy.validateContext(params);
          expect(result.valid).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: branching-policy-enforcement, Property 7: Validation of source
// branch in Git-Flow Strategy
// ---------------------------------------------------------------------------

// **Validates: Requirements 4.4, 4.5**
describe('Property 7: Validation of source branch in Git-Flow Strategy', () => {
  const releaseSemvers = ['minor', 'major', 'preminor', 'premajor', 'prerelease'] as const;
  const hotfixSemvers = ['patch', 'prepatch'] as const;

  it('release semvers: valid only if currentBranch === develop (default developBranch)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...releaseSemvers),
        arbVersion,
        arbComment,
        (semver, version, comment) => {
          const strategy = createGitFlowStrategy(mockConfig);
          // On develop → valid
          const validParams = makeParams({ semver, version, comment, currentBranch: 'develop' });
          const validResult = strategy.validateContext(validParams);
          expect(validResult.valid).toBe(true);
          expect(validResult.errors).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('release semvers: invalid if currentBranch !== develop', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...releaseSemvers),
        arbBranchName,
        arbVersion,
        arbComment,
        (semver, branch, version, comment) => {
          const strategy = createGitFlowStrategy(mockConfig);
          const params = makeParams({ semver, version, comment, currentBranch: branch });
          const result = strategy.validateContext(params);
          expect(result.valid).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('hotfix semvers (patch/prepatch): valid if currentBranch is master or main', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...hotfixSemvers),
        fc.constantFrom('master', 'main'),
        arbVersion,
        arbComment,
        (semver, branch, version, comment) => {
          const strategy = createGitFlowStrategy(mockConfig);
          const params = makeParams({ semver, version, comment, currentBranch: branch });
          const result = strategy.validateContext(params);
          expect(result.valid).toBe(true);
          expect(result.errors).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('hotfix semvers (patch/prepatch): invalid if currentBranch is not master/main', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...hotfixSemvers),
        arbBranchName,
        arbVersion,
        arbComment,
        (semver, branch, version, comment) => {
          const strategy = createGitFlowStrategy(mockConfig);
          const params = makeParams({ semver, version, comment, currentBranch: branch });
          const result = strategy.validateContext(params);
          expect(result.valid).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: branching-policy-enforcement, Property 8: Semver type restriction
// for hotfix and maintenance strategies
// ---------------------------------------------------------------------------

// **Validates: Requirements 6.4, 7.4**
describe('Property 8: Semver type restriction for hotfix and maintenance strategies', () => {
  it('hotfix: any semver != patch returns valid=false with error mentioning only patch allowed', () => {
    fc.assert(
      fc.property(
        arbNonPatchSemver,
        arbVersion,
        arbComment,
        (semver, version, comment) => {
          const strategy = createHotfixStrategy(mockConfig);
          const params = makeParams({ semver, version, comment, currentBranch: 'master' });
          const result = strategy.validateContext(params);
          expect(result.valid).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);
          const joined = result.errors.join(' ');
          expect(joined.toLowerCase()).toContain('patch');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('maintenance: any semver != patch returns valid=false with error mentioning only patch allowed', () => {
    fc.assert(
      fc.property(
        arbNonPatchSemver,
        arbVersion,
        arbComment,
        (semver, version, comment) => {
          const strategy = createMaintenanceStrategy(mockConfig);
          const params = makeParams({ semver, version, comment, currentBranch: 'master' });
          const result = strategy.validateContext(params);
          expect(result.valid).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);
          const joined = result.errors.join(' ');
          expect(joined.toLowerCase()).toContain('patch');
        },
      ),
      { numRuns: 100 },
    );
  });
});
