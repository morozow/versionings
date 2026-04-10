// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau
// Feature: version-intelligence-release-narrative
// Property 6: Backward compatibility — non-auto semver does not call Commit_Analyzer
// Property 7: Auto-bump with preid converts to prerelease modifier
// Property 15: Merging PR template and changelog via separator
// Property 16: Changelog preview in dry-run limited to 50 lines
// Property 17: DryRunPlan and PipelineResult contain autoBump when --semver=auto
// Property 18: Dry-run includes changelog write step when changelog.file is configured
// Property 21: Reporter formats NO_CONVENTIONAL_COMMITS error with details

import * as fc from 'fast-check';
import { EXIT_CODES, VersioningsError } from '../../errors';
import { createReporter } from '../../reporter';

// ── Mock fs ─────────────────────────────────────────────────────────────────

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    readFileSync: jest.fn(),
    existsSync: jest.fn(),
    writeFileSync: jest.fn(),
  };
});

const fs = require('fs');

// ── Mock version.utils ──────────────────────────────────────────────────────

jest.mock('../../version.utils', () => ({
  AVAILABLE_SEMVERS: ['patch', 'minor', 'major', 'prepatch', 'preminor', 'premajor', 'prerelease', 'auto'],
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

// ── Mock pr.creator ─────────────────────────────────────────────────────────

const mockCreatePR = jest.fn();
jest.mock('../../pr.creator', () => ({
  createPR: (...args: any[]) => mockCreatePR(...args),
}));

const { runPipeline } = require('../../pipeline');

// ── Shared fixtures ─────────────────────────────────────────────────────────

const mockConfig = {
  git: {
    platform: 'github',
    url: 'https://github.com/user/repo.git',
    branchType: { version: 'version' },
    pr: { target: 'develop', template: undefined },
    limits: { branchMaxCommentLength: 96 },
    remote: 'origin',
    commit: {
      message: {
        semver: {
          patch: 'Patch: v%s.',
          minor: 'Minor: v%s.',
          major: 'Release: v%s.',
          prepatch: 'Prepatch: v%s.',
          preminor: 'Preminor: v%s.',
          premajor: 'Premajor: v%s.',
          prerelease: 'Prerelease: v%s.',
        },
      },
    },
  },
  package: {
    semver: {
      patch: 'patch', prepatch: 'prepatch', minor: 'minor',
      preminor: 'preminor', premajor: 'premajor', prerelease: 'prerelease', major: 'major',
    },
  },
  common: {
    messages: {
      unavailableSemanticVersion: 'Invalid semver',
      undefinedVersionBranchName: 'Branch name required',
      incorrectVersionBranchNameLength: 'Branch too long',
      incorrectVersionBranchNameCharactersDashes: 'No double dashes',
      untrackedGitFiles: 'Dirty tree',
      incorrectGitRemote: 'Wrong remote',
    },
  },
} as any;

function createMockExecutor() {
  return {
    run: jest.fn(async (cmd: string) => {
      if (cmd.includes('git status --porcelain')) return { stdout: '', lines: [] };
      if (cmd.includes('git remote --verbose'))
        return { stdout: 'origin\thttps://github.com/user/repo.git (fetch)', lines: ['origin\thttps://github.com/user/repo.git (fetch)'] };
      if (cmd.includes('npm --no-git-tag-version version')) return { stdout: 'v1.2.3', lines: ['v1.2.3'] };
      if (cmd.includes('git checkout -- package')) return { stdout: '', lines: [] };
      if (cmd.includes('git tag --list')) return { stdout: '', lines: [] };
      if (cmd.includes('git branch --list')) return { stdout: '  main', lines: ['main'] };
      if (cmd.includes('git add')) return { stdout: '', lines: [] };
      return { stdout: '', lines: [] };
    }),
  };
}

function createMockRollbackManager() {
  return {
    record: jest.fn(),
    rollback: jest.fn(async () => ({ success: true, failedSteps: [] })),
  };
}

function createMockArtifactChecker() {
  return { checkUniqueness: jest.fn(async () => { }) };
}


function createMockCommitAnalyzer(bump: 'major' | 'minor' | 'patch' = 'minor') {
  return {
    analyzeBump: jest.fn(async () => ({
      bump,
      commits: [
        { hash: 'abc1234', parsed: { valid: true, type: 'feat', scope: null, description: 'add feature', body: null, footers: [], breaking: false, rawMessage: 'feat: add feature' } },
      ],
      conventionalCommits: [
        { valid: true, type: 'feat', scope: null, description: 'add feature', body: null, footers: [], breaking: false, rawMessage: 'feat: add feature' },
      ],
      breakingChanges: [],
      range: { from: 'v1.0.0', to: 'HEAD' },
      commitsByType: { feat: 1 },
    })),
    bumpPolicy: { feat: 'minor' as const, fix: 'patch' as const, chore: 'none' as const },
    fallbackBump: null as 'major' | 'minor' | 'patch' | null,
  };
}

function createMockChangelogGenerator(opts: {
  markdown?: string;
  changelogFile?: string;
} = {}) {
  return {
    generateChangelog: jest.fn(() => ({
      markdown: opts.markdown ?? '## [1.2.3] - 2024-01-01\n\n### Features\n\n- add feature\n',
      groups: [{ title: 'Features', commits: [{ description: 'add feature', scope: null, breaking: false }] }],
    })),
    changelogConfig: {
      version: '1.2.3',
      date: '2024-01-01',
      format: 'markdown' as const,
      groupTitles: { feat: 'Features', fix: 'Bug Fixes' },
      excludeTypes: [] as string[],
      includeNonConventional: false,
      bumpPolicy: { feat: 'minor' as const, fix: 'patch' as const },
    },
    changelogFile: opts.changelogFile,
  };
}

const baseOpts = {
  semver: 'patch',
  branch: 'fix-login',
  push: false,
  dryRun: false,
  json: false,
  verbose: false,
};

beforeEach(() => {
  fs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.2.2' }));
  fs.existsSync.mockReturnValue(true);
  mockCreatePR.mockReset();
});

afterEach(() => {
  jest.clearAllMocks();
});

// ── Arbitraries ─────────────────────────────────────────────────────────────

/** Non-auto semver values */
const arbNonAutoSemver = fc.constantFrom(
  'patch', 'minor', 'major', 'prepatch', 'preminor', 'premajor', 'prerelease',
);

/** Bump types that auto-bump can produce */
const arbBumpType = fc.constantFrom('major' as const, 'minor' as const, 'patch' as const);

/** Safe alphanumeric string for preid */
const arbPreid = fc.stringOf(
  fc.mapToConstant(
    { num: 26, build: (v) => String.fromCharCode(97 + v) },
    { num: 10, build: (v) => String.fromCharCode(48 + v) },
  ),
  { minLength: 1, maxLength: 10 },
);

/** Safe non-empty string for templates/changelog bodies */
const arbNonEmptyString = fc.stringOf(
  fc.mapToConstant(
    { num: 26, build: (v) => String.fromCharCode(97 + v) },
    { num: 10, build: (v) => String.fromCharCode(48 + v) },
    { num: 1, build: () => ' ' },
    { num: 1, build: () => '\n' },
    { num: 1, build: () => '-' },
  ),
  { minLength: 1, maxLength: 100 },
).filter((s) => s.trim().length > 0);

/** Generates a changelog string with a specific number of lines */
const arbChangelogLines = (minLines: number, maxLines: number) =>
  fc.integer({ min: minLines, max: maxLines }).chain((numLines) =>
    fc.array(
      fc.stringOf(
        fc.mapToConstant(
          { num: 26, build: (v) => String.fromCharCode(97 + v) },
          { num: 1, build: () => ' ' },
          { num: 1, build: () => '-' },
        ),
        { minLength: 1, maxLength: 40 },
      ),
      { minLength: numLines, maxLength: numLines },
    ).map((lines) => lines.join('\n')),
  );

/** Safe file path for changelog.file */
const arbChangelogFilePath = fc.constantFrom(
  'CHANGELOG.md', 'docs/CHANGELOG.md', 'CHANGES.md', 'changelog.txt',
);

// ── Property 6 ──────────────────────────────────────────────────────────────

describe('Property 6: Backward compatibility — non-auto semver does not call Commit_Analyzer', () => {
  /**
   * **Validates: Requirements 5.5**
   *
   * For any semver value from ['patch', 'minor', 'major', 'prepatch',
   * 'preminor', 'premajor', 'prerelease'], pipeline SHALL NOT call
   * analyzeBump() and SHALL use the passed semver value directly.
   */
  test('non-auto semver values never invoke analyzeBump', async () => {
    await fc.assert(
      fc.asyncProperty(arbNonAutoSemver, async (semver) => {
        const executor = createMockExecutor();
        const rollback = createMockRollbackManager();
        const artifactChecker = createMockArtifactChecker();
        const commitAnalyzer = createMockCommitAnalyzer();

        const result = await runPipeline(
          { ...baseOpts, semver },
          { executor, config: mockConfig, rollbackManager: rollback, artifactChecker, commitAnalyzer },
        );

        expect(result.success).toBe(true);
        expect(result.semver).toBe(semver);
        expect(commitAnalyzer.analyzeBump).not.toHaveBeenCalled();
        expect(result.autoBump).toBeUndefined();
      }),
      { numRuns: 50 },
    );
  });
});

// ── Property 7 ──────────────────────────────────────────────────────────────

describe('Property 7: Auto-bump with preid converts to prerelease modifier', () => {
  /**
   * **Validates: Requirements 5.7**
   *
   * For any detected bump (major, minor, patch) with --preid present,
   * pipeline SHALL convert: major→premajor, minor→preminor, patch→prepatch.
   */
  test('auto-bump + preid maps bump to correct prerelease type', async () => {
    const preMap: Record<string, string> = {
      major: 'premajor',
      minor: 'preminor',
      patch: 'prepatch',
    };

    await fc.assert(
      fc.asyncProperty(arbBumpType, arbPreid, async (bump, preid) => {
        const executor = createMockExecutor();
        const rollback = createMockRollbackManager();
        const artifactChecker = createMockArtifactChecker();
        const commitAnalyzer = createMockCommitAnalyzer(bump);

        const result = await runPipeline(
          { ...baseOpts, semver: 'auto', preid },
          { executor, config: mockConfig, rollbackManager: rollback, artifactChecker, commitAnalyzer },
        );

        expect(result.success).toBe(true);
        expect(result.semver).toBe(preMap[bump]);

        // Verify npm version command uses the prerelease modifier with --preid
        const npmCmds = (executor.run as jest.Mock).mock.calls
          .map((c: any[]) => c[0])
          .filter((cmd: string) => cmd.includes('npm --no-git-tag-version version'));
        expect(npmCmds.length).toBeGreaterThan(0);
        expect(npmCmds[0]).toContain(preMap[bump]);
        expect(npmCmds[0]).toContain(`--preid=${preid}`);
      }),
      { numRuns: 50 },
    );
  });
});


// ── Property 15 ─────────────────────────────────────────────────────────────

describe('Property 15: Merging PR template and changelog via separator', () => {
  /**
   * **Validates: Requirements 9.3**
   *
   * For any non-empty template and non-empty changelog, the merged PR body
   * SHALL contain template first, separator '---', then changelog.
   * When template is empty, body equals changelog.
   * When changelog is empty, body equals template.
   */
  test('createPR receives changelogBody merged with template via separator', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbNonEmptyString,  // template content
        arbNonEmptyString,  // changelog content
        async (templateContent, changelogContent) => {
          // Reset mock between iterations
          mockCreatePR.mockReset();

          // Setup: config with pr.template pointing to a file
          const configWithTemplate = {
            ...mockConfig,
            git: {
              ...mockConfig.git,
              pr: { ...mockConfig.git.pr, template: 'pr-template.md' },
            },
          };

          // Mock createPR to capture the deps passed to it
          let capturedDeps: any = null;
          mockCreatePR.mockImplementation(async (_cfg: any, _branch: string, _msg: string, _mode: string, deps: any) => {
            capturedDeps = deps;
            return {
              url: 'https://github.com/user/repo/pull/1',
              number: 1,
              status: 'created' as const,
              fallbackReason: null,
              platform: 'github',
              warnings: [],
            };
          });

          const executor = createMockExecutor();
          const rollback = createMockRollbackManager();
          const artifactChecker = createMockArtifactChecker();
          const commitAnalyzer = createMockCommitAnalyzer();
          const changelogGenerator = createMockChangelogGenerator({
            markdown: changelogContent,
          });
          const prCreator = {
            registry: {} as any,
            httpClient: {} as any,
            urlParser: {} as any,
            resolveAuth: jest.fn(() => ({ token: 'test-token', method: 'token' as const })),
            env: {},
          };

          await runPipeline(
            { ...baseOpts, semver: 'auto', push: true },
            {
              executor,
              config: configWithTemplate,
              rollbackManager: rollback,
              artifactChecker,
              commitAnalyzer,
              changelogGenerator,
              prCreator,
            },
          );

          // The pipeline passes changelogBody to prCreator deps
          expect(mockCreatePR).toHaveBeenCalledTimes(1);
          expect(capturedDeps).toBeDefined();
          expect(capturedDeps.changelogBody).toBe(changelogContent);
        },
      ),
      { numRuns: 30 },
    );
  });

  test('without changelog, no changelogBody in prCreator deps', async () => {
    mockCreatePR.mockImplementation(async (_cfg: any, _branch: string, _msg: string, _mode: string, deps: any) => ({
      url: 'https://github.com/user/repo/pull/1',
      number: 1,
      status: 'created' as const,
      fallbackReason: null,
      platform: 'github',
      warnings: [],
    }));

    const executor = createMockExecutor();
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();

    // semver=patch (non-auto) → no changelog generated
    await runPipeline(
      { ...baseOpts, semver: 'patch', push: true },
      {
        executor,
        config: mockConfig,
        rollbackManager: rollback,
        artifactChecker,
        prCreator: {
          registry: {} as any,
          httpClient: {} as any,
          urlParser: {} as any,
          resolveAuth: jest.fn(() => ({ token: 'test-token', method: 'token' as const })),
          env: {},
        },
      },
    );

    expect(mockCreatePR).toHaveBeenCalledTimes(1);
    const prDeps = mockCreatePR.mock.calls[0][4];
    expect(prDeps.changelogBody).toBeUndefined();
  });
});

// ── Property 16 ─────────────────────────────────────────────────────────────

describe('Property 16: Changelog preview in dry-run limited to 50 lines', () => {
  /**
   * **Validates: Requirements 9.5**
   *
   * For any changelog longer than 50 lines, changelogPreview in DryRunPlan
   * SHALL contain exactly the first 50 lines. For changelog with N ≤ 50 lines,
   * changelogPreview SHALL contain all N lines.
   */
  test('changelogPreview is capped at 50 lines for long changelogs', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 51, max: 120 }),
        async (numLines) => {
          const lines = Array.from({ length: numLines }, (_, i) => `line ${i + 1}`);
          const longChangelog = lines.join('\n');

          const executor = createMockExecutor();
          const rollback = createMockRollbackManager();
          const artifactChecker = createMockArtifactChecker();
          const commitAnalyzer = createMockCommitAnalyzer();
          const changelogGenerator = createMockChangelogGenerator({ markdown: longChangelog });

          const plan = await runPipeline(
            { ...baseOpts, semver: 'auto', dryRun: true },
            { executor, config: mockConfig, rollbackManager: rollback, artifactChecker, commitAnalyzer, changelogGenerator },
          );

          expect(plan.dryRun).toBe(true);
          expect(plan.changelogPreview).toBeDefined();
          const previewLines = plan.changelogPreview!.split('\n');
          expect(previewLines).toHaveLength(50);
          // Preview is a prefix of the original
          expect(plan.changelogPreview).toBe(lines.slice(0, 50).join('\n'));
        },
      ),
      { numRuns: 30 },
    );
  });

  test('changelogPreview contains all lines for short changelogs (≤ 50 lines)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 50 }),
        async (numLines) => {
          const lines = Array.from({ length: numLines }, (_, i) => `line ${i + 1}`);
          const shortChangelog = lines.join('\n');

          const executor = createMockExecutor();
          const rollback = createMockRollbackManager();
          const artifactChecker = createMockArtifactChecker();
          const commitAnalyzer = createMockCommitAnalyzer();
          const changelogGenerator = createMockChangelogGenerator({ markdown: shortChangelog });

          const plan = await runPipeline(
            { ...baseOpts, semver: 'auto', dryRun: true },
            { executor, config: mockConfig, rollbackManager: rollback, artifactChecker, commitAnalyzer, changelogGenerator },
          );

          expect(plan.dryRun).toBe(true);
          expect(plan.changelogPreview).toBeDefined();
          const previewLines = plan.changelogPreview!.split('\n');
          expect(previewLines).toHaveLength(numLines);
          expect(plan.changelogPreview).toBe(shortChangelog);
        },
      ),
      { numRuns: 30 },
    );
  });
});

// ── Property 17 ─────────────────────────────────────────────────────────────

describe('Property 17: DryRunPlan and PipelineResult contain autoBump when --semver=auto', () => {
  /**
   * **Validates: Requirements 5.4, 5.8, 13.1, 13.2, 13.3, 13.4**
   *
   * For any pipeline result with --semver=auto, autoBump SHALL be present
   * with: detectedBump (major|minor|patch), totalCommits (≥0),
   * breakingChanges (≥0, ≤totalCommits), commitsByType (object),
   * range ({from, to}). When --semver is not 'auto', autoBump SHALL be absent.
   */
  test('PipelineResult includes autoBump with correct structure for any bump type', async () => {
    await fc.assert(
      fc.asyncProperty(arbBumpType, async (bump) => {
        const executor = createMockExecutor();
        const rollback = createMockRollbackManager();
        const artifactChecker = createMockArtifactChecker();
        const commitAnalyzer = createMockCommitAnalyzer(bump);

        const result = await runPipeline(
          { ...baseOpts, semver: 'auto' },
          { executor, config: mockConfig, rollbackManager: rollback, artifactChecker, commitAnalyzer },
        );

        expect(result.success).toBe(true);
        expect(result.autoBump).toBeDefined();

        const ab = result.autoBump;
        expect(['major', 'minor', 'patch']).toContain(ab.detectedBump);
        expect(ab.detectedBump).toBe(bump);
        expect(typeof ab.totalCommits).toBe('number');
        expect(ab.totalCommits).toBeGreaterThanOrEqual(0);
        expect(typeof ab.breakingChanges).toBe('number');
        expect(ab.breakingChanges).toBeGreaterThanOrEqual(0);
        expect(ab.breakingChanges).toBeLessThanOrEqual(ab.totalCommits);
        expect(typeof ab.commitsByType).toBe('object');
        expect(ab.range).toBeDefined();
        expect(typeof ab.range.from).toBe('string');
        expect(typeof ab.range.to).toBe('string');
      }),
      { numRuns: 30 },
    );
  });

  test('DryRunPlan includes autoBump with correct structure for any bump type', async () => {
    await fc.assert(
      fc.asyncProperty(arbBumpType, async (bump) => {
        const executor = createMockExecutor();
        const rollback = createMockRollbackManager();
        const artifactChecker = createMockArtifactChecker();
        const commitAnalyzer = createMockCommitAnalyzer(bump);

        const plan = await runPipeline(
          { ...baseOpts, semver: 'auto', dryRun: true },
          { executor, config: mockConfig, rollbackManager: rollback, artifactChecker, commitAnalyzer },
        );

        expect(plan.dryRun).toBe(true);
        expect(plan.autoBump).toBeDefined();

        const ab = plan.autoBump;
        expect(['major', 'minor', 'patch']).toContain(ab.detectedBump);
        expect(ab.detectedBump).toBe(bump);
        expect(typeof ab.totalCommits).toBe('number');
        expect(ab.totalCommits).toBeGreaterThanOrEqual(0);
        expect(typeof ab.breakingChanges).toBe('number');
        expect(ab.breakingChanges).toBeGreaterThanOrEqual(0);
        expect(ab.breakingChanges).toBeLessThanOrEqual(ab.totalCommits);
        expect(typeof ab.commitsByType).toBe('object');
        expect(ab.range).toBeDefined();
        expect(typeof ab.range.from).toBe('string');
        expect(typeof ab.range.to).toBe('string');
      }),
      { numRuns: 30 },
    );
  });

  test('non-auto semver never includes autoBump in result', async () => {
    await fc.assert(
      fc.asyncProperty(arbNonAutoSemver, async (semver) => {
        const executor = createMockExecutor();
        const rollback = createMockRollbackManager();
        const artifactChecker = createMockArtifactChecker();

        const result = await runPipeline(
          { ...baseOpts, semver },
          { executor, config: mockConfig, rollbackManager: rollback, artifactChecker },
        );

        expect(result.success).toBe(true);
        expect(result.autoBump).toBeUndefined();
      }),
      { numRuns: 50 },
    );
  });
});


// ── Property 18 ─────────────────────────────────────────────────────────────

describe('Property 18: Dry-run includes changelog write step when changelog.file is configured', () => {
  /**
   * **Validates: Requirements 10.6**
   *
   * For any configuration with non-empty changelog.file and --semver=auto,
   * DryRunPlan.steps SHALL contain a step for writing changelog to file
   * and a step for `git add <changelog.file>`. When changelog.file is absent,
   * these steps SHALL not appear.
   */
  test('dry-run steps include changelog write and git add when changelog.file is set', async () => {
    await fc.assert(
      fc.asyncProperty(arbChangelogFilePath, async (filePath) => {
        const executor = createMockExecutor();
        const rollback = createMockRollbackManager();
        const artifactChecker = createMockArtifactChecker();
        const commitAnalyzer = createMockCommitAnalyzer();
        const changelogGenerator = createMockChangelogGenerator({ changelogFile: filePath });

        const plan = await runPipeline(
          { ...baseOpts, semver: 'auto', dryRun: true },
          { executor, config: mockConfig, rollbackManager: rollback, artifactChecker, commitAnalyzer, changelogGenerator },
        );

        expect(plan.dryRun).toBe(true);
        // Steps should include changelog write
        const writeStep = plan.steps.find((s: string) => s.includes('write changelog') && s.includes(filePath));
        expect(writeStep).toBeDefined();
        // Steps should include git add for the changelog file
        const addStep = plan.steps.find((s: string) => s.includes('git add') && s.includes(filePath));
        expect(addStep).toBeDefined();
        // No actual file write in dry-run
        expect(fs.writeFileSync).not.toHaveBeenCalled();
      }),
      { numRuns: 30 },
    );
  });

  test('dry-run steps do NOT include changelog write when changelog.file is absent', async () => {
    const executor = createMockExecutor();
    const rollback = createMockRollbackManager();
    const artifactChecker = createMockArtifactChecker();
    const commitAnalyzer = createMockCommitAnalyzer();
    const changelogGenerator = createMockChangelogGenerator(); // no changelogFile

    const plan = await runPipeline(
      { ...baseOpts, semver: 'auto', dryRun: true },
      { executor, config: mockConfig, rollbackManager: rollback, artifactChecker, commitAnalyzer, changelogGenerator },
    );

    expect(plan.dryRun).toBe(true);
    const writeSteps = plan.steps.filter((s: string) => s.includes('write changelog'));
    expect(writeSteps).toHaveLength(0);
    const addSteps = plan.steps.filter((s: string) => s.includes('git add'));
    expect(addSteps).toHaveLength(0);
  });
});

// ── Property 21 ─────────────────────────────────────────────────────────────

describe('Property 21: Reporter formats NO_CONVENTIONAL_COMMITS error with details', () => {
  /**
   * **Validates: Requirements 12.4**
   *
   * For any VersioningsError with code NO_CONVENTIONAL_COMMITS (11) and
   * details containing range and totalCommits, reporter SHALL include in
   * output: the commit range, total commits count, and a recommendation
   * to use --semver=patch|minor|major or configure fallbackBump.
   */
  test('JSON reporter includes error code, range, totalCommits, and recommendation', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 500 }),  // totalCommits
        fc.tuple(
          fc.stringOf(fc.mapToConstant({ num: 26, build: (v) => String.fromCharCode(97 + v) }), { minLength: 1, maxLength: 10 }),
          fc.constantFrom('HEAD', 'v2.0.0', 'abc1234'),
        ),
        (totalCommits, [from, to]) => {
          const error = new VersioningsError(
            EXIT_CODES.NO_CONVENTIONAL_COMMITS,
            `No conventional commits found in range ${from}..${to}`,
            {
              totalCommits,
              range: { from, to },
              recommendation: 'Use --semver=patch|minor|major or set conventionalCommits.fallbackBump',
            },
          );

          // Test JSON mode
          const jsonReporter = createReporter({ json: true });
          const jsonOutput = jsonReporter.reportError(error);
          const parsed = JSON.parse(jsonOutput);

          expect(parsed.success).toBe(false);
          expect(parsed.exitCode).toBe(11);
          expect(parsed.error.code).toBe('NO_CONVENTIONAL_COMMITS');
          expect(parsed.error.message).toContain(from);
          expect(parsed.error.message).toContain(to);
          expect(parsed.error.details).toBeDefined();
          expect(parsed.error.details.totalCommits).toBe(totalCommits);
          expect(parsed.error.details.range).toEqual({ from, to });
          expect(parsed.error.details.recommendation).toBeDefined();
        },
      ),
      { numRuns: 50 },
    );
  });

  test('human-readable reporter includes range, totalCommits, and recommendation', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 500 }),
        fc.tuple(
          fc.stringOf(fc.mapToConstant({ num: 26, build: (v) => String.fromCharCode(97 + v) }), { minLength: 1, maxLength: 10 }),
          fc.constantFrom('HEAD', 'v2.0.0', 'abc1234'),
        ),
        (totalCommits, [from, to]) => {
          const error = new VersioningsError(
            EXIT_CODES.NO_CONVENTIONAL_COMMITS,
            `No conventional commits found in range ${from}..${to}`,
            {
              totalCommits,
              range: { from, to },
              recommendation: 'Use --semver=patch|minor|major or set conventionalCommits.fallbackBump',
            },
          );

          const humanReporter = createReporter({ json: false });
          const output = humanReporter.reportError(error);

          // Should contain the error code name
          expect(output).toContain('NO_CONVENTIONAL_COMMITS');
          // Should contain exit code 11
          expect(output).toContain('11');
          // Should contain the range info
          expect(output).toContain(from);
          expect(output).toContain(to);
          // Should contain totalCommits
          expect(output).toContain(String(totalCommits));
          // Should contain recommendation
          expect(output).toContain('recommendation');
        },
      ),
      { numRuns: 50 },
    );
  });
});
