// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * Property tests for dry-run mode.
 */

import * as fc from 'fast-check';
import { EXIT_CODES, VersioningsError } from '../../errors';
// Mock fs — must come before requiring pipeline
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    readFileSync: jest.fn(),
    existsSync: jest.fn(),
  };
});

const fs = require('fs');

jest.mock('../../version.utils', () => ({
  AVAILABLE_SEMVERS: ['patch', 'minor', 'major', 'prepatch', 'preminor', 'premajor', 'prerelease'],
  composeVersionBranchName: (semver: string, version: string, comment: string) =>
    `version/${semver}/${version}/${comment}`,
  composeVersionTagName: (semver: string, version: string, comment: string) =>
    `${version}--${comment}`,
  semverMessage: (semver: string, version: string) =>
    `Patch: v${version}. You SHOULD consider changes.`,
  semverNpmMessage: (semver: string, branch: string) =>
    `Version: ${semver}. Comment: ${branch}.`,
  preidParam: (preid?: string) => (preid ? `--preid=${preid}` : ''),
  generatePullRequestUrl: (branch: string) =>
    `https://github.com/user/repo/compare/develop...${branch}?expand=1`,
}));

const { runPipeline } = require('../../pipeline');

const mockConfig = {
  git: {
    platform: 'github',
    url: 'https://github.com/user/repo.git',
    branchType: { version: 'version' },
    pr: { target: 'develop' },
    limits: { branchMaxCommentLength: 96 },
    remote: 'origin',
    commit: {
      message: {
        semver: {
          patch: 'Patch: v%s. You SHOULD consider changes.',
          minor: 'Minor: v%s. You MUST consider changes.',
          major: 'Release: v%s.',
          prepatch: 'Patch version is preparing now: v%s.',
          preminor: 'Minor version is preparing now: v%s.',
          premajor: 'Release is preparing now: v%s.',
          prerelease: 'Preparing: v%s.',
        }
      }
    },
  },
  package: { semver: { patch: 'patch', minor: 'minor', major: 'major', prepatch: 'prepatch', preminor: 'preminor', premajor: 'premajor', prerelease: 'prerelease' } },
  common: {
    messages: {
      unavailableSemanticVersion: 'Invalid semver',
      undefinedVersionBranchName: 'Branch name required',
      incorrectVersionBranchNameLength: 'Branch too long, max',
      incorrectVersionBranchNameCharactersDashes: 'No double dashes',
      untrackedGitFiles: 'Dirty tree',
      incorrectGitRemote: 'Wrong remote',
    }
  },
} as any;

const arbSemver = fc.constantFrom('patch', 'minor', 'major', 'prepatch', 'preminor', 'premajor', 'prerelease');
const arbBranch = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
  { minLength: 1, maxLength: 95 }
).filter((s) => !/-{2,}/.test(s) && s.trim().length > 0);
const arbPush = fc.boolean();

const MUTATING_PATTERNS = ['git checkout -b', 'git tag --annotate', 'git commit', 'git push'];
function isMutatingCommand(cmd: string): boolean {
  return MUTATING_PATTERNS.some((pattern) => cmd.includes(pattern));
}

function createMockExecutor() {
  const calls: string[] = [];
  return {
    run: jest.fn(async (cmd: string) => {
      calls.push(cmd);
      if (cmd.includes('git status --porcelain')) return { stdout: '', lines: [] };
      if (cmd.includes('git remote --verbose')) return { stdout: 'origin\thttps://github.com/user/repo.git (fetch)', lines: ['origin\thttps://github.com/user/repo.git (fetch)'] };
      if (cmd.includes('npm --no-git-tag-version version')) return { stdout: 'v1.2.3', lines: ['v1.2.3'] };
      if (cmd.includes('git checkout -- package')) return { stdout: '', lines: [] };
      if (cmd.includes('git tag --list')) return { stdout: '', lines: [] };
      if (cmd.includes('git branch --list')) return { stdout: '  main', lines: ['main'] };
      return { stdout: '', lines: [] };
    }),
    calls,
  };
}

function createMockRollbackManager() {
  return {
    record: jest.fn(),
    rollback: jest.fn(async () => ({ success: true, failedSteps: [] as any[] })),
  };
}

function createMockArtifactChecker() {
  return { checkUniqueness: jest.fn(async () => { }) };
}

beforeEach(() => {
  fs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.2.2' }));
  fs.existsSync.mockReturnValue(true);
});

afterEach(() => { jest.clearAllMocks(); });

describe('Property 1: Dry-run safety', () => {
  test('for any valid input with dryRun=true, executor receives NO mutating commands and pipeline resolves', async () => {
    await fc.assert(
      fc.asyncProperty(arbSemver, arbBranch, arbPush, async (semver, branch, push) => {
        const executor = createMockExecutor();
        const rollback = createMockRollbackManager();
        const artifactChecker = createMockArtifactChecker();
        const plan = await runPipeline(
          { semver, branch, push, dryRun: true, json: false, verbose: false },
          { executor, config: mockConfig, rollbackManager: rollback, artifactChecker },
        );
        expect(plan).toBeDefined();
        expect(plan.dryRun).toBe(true);
        const executedCmds = (executor.run as jest.Mock).mock.calls.map((c: any[]) => c[0]);
        const mutatingCmds = executedCmds.filter(isMutatingCommand);
        expect(mutatingCmds).toEqual([]);
        expect(rollback.record).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });

  test('validation checks still run in dry-run — invalid inputs cause errors, not plans', async () => {
    const arbInvalidBranch = fc.oneof(
      fc.constant(''),
      fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), { minLength: 96, maxLength: 120 }),
      fc.constant('my--branch'),
    );
    await fc.assert(
      fc.asyncProperty(arbSemver, arbInvalidBranch, arbPush, async (semver, branch, push) => {
        const executor = createMockExecutor();
        const rollback = createMockRollbackManager();
        const artifactChecker = createMockArtifactChecker();
        try {
          await runPipeline(
            { semver, branch, push, dryRun: true, json: false, verbose: false },
            { executor, config: mockConfig, rollbackManager: rollback, artifactChecker },
          );
          throw new Error('Expected VersioningsError');
        } catch (err: any) {
          expect(err).toBeInstanceOf(VersioningsError);
          expect(err.code).toBe(EXIT_CODES.INVALID_ARGS);
        }
        const executedCmds = (executor.run as jest.Mock).mock.calls.map((c: any[]) => c[0]);
        expect(executedCmds.filter(isMutatingCommand)).toEqual([]);
        expect(rollback.record).not.toHaveBeenCalled();
        expect(rollback.rollback).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 2: Dry-run plan completeness in JSON format', () => {
  test('for any valid input with dryRun=true and json=true, plan contains all required fields and is valid JSON', async () => {
    const { createReporter } = require('../../reporter');
    await fc.assert(
      fc.asyncProperty(arbSemver, arbBranch, arbPush, async (semver, branch, push) => {
        const executor = createMockExecutor();
        const rollback = createMockRollbackManager();
        const artifactChecker = createMockArtifactChecker();
        const plan = await runPipeline(
          { semver, branch, push, dryRun: true, json: true, verbose: false },
          { executor, config: mockConfig, rollbackManager: rollback, artifactChecker },
        );
        const reporter = createReporter({ json: true });
        const jsonOutput = reporter.reportDryRun(plan);
        const parsed = JSON.parse(jsonOutput);
        expect(parsed).toHaveProperty('dryRun');
        expect(parsed).toHaveProperty('currentVersion');
        expect(parsed).toHaveProperty('nextVersion');
        expect(parsed).toHaveProperty('semver');
        expect(parsed).toHaveProperty('branch');
        expect(parsed).toHaveProperty('tag');
        expect(parsed).toHaveProperty('commitMessage');
        expect(parsed).toHaveProperty('steps');
        expect(parsed.dryRun).toBe(true);
        expect(typeof parsed.currentVersion).toBe('string');
        expect(typeof parsed.nextVersion).toBe('string');
        expect(typeof parsed.semver).toBe('string');
        expect(typeof parsed.branch).toBe('string');
        expect(typeof parsed.tag).toBe('string');
        expect(typeof parsed.commitMessage).toBe('string');
        expect(Array.isArray(parsed.steps)).toBe(true);
        expect(parsed.steps.length).toBeGreaterThan(0);
        expect(parsed.semver).toBe(semver);
        expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed);
      }),
      { numRuns: 100 },
    );
  });
});
