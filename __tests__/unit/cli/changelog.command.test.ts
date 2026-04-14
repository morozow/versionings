// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { PassThrough } from 'stream';
import { runChangelogCommand, ChangelogCommandOpts, ChangelogCommandDeps } from '../../../src/cli/commands/changelog.command';
import { COMMIT_SEPARATOR, GIT_LOG_FORMAT } from '../../../src/versioning/commit.parser';
import { DEFAULT_BUMP_POLICY } from '../../../src/versioning/commit.analyzer';
import { DEFAULT_GROUP_TITLES } from '../../../src/versioning/changelog.generator';
import type { Executor, ExecutorResult } from '../../../src/core/executor';
import { EXIT_CODES, VersioningsError } from '../../../src/core/errors';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build a mock git log output string from commit entries */
function buildGitLogOutput(commits: Array<{ hash: string; message: string }>): string {
  return commits
    .map((c) => `${c.hash}\n${c.message}\n${COMMIT_SEPARATOR}`)
    .join('\n');
}

const SAMPLE_COMMITS = [
  { hash: 'aaa1111111111111111111111111111111111111', message: 'feat(auth): add login endpoint' },
  { hash: 'bbb2222222222222222222222222222222222222', message: 'fix(db): resolve connection leak' },
  { hash: 'ccc3333333333333333333333333333333333333', message: 'chore: update deps' },
];

const SAMPLE_GIT_LOG = buildGitLogOutput(SAMPLE_COMMITS);

function createMockExecutor(overrides: Record<string, string | Error> = {}): Executor {
  const defaults: Record<string, string> = {
    [`git tag --list "v*" --sort=-version:refSort`]: 'v1.0.0',
    [`git log v1.0.0..HEAD --format="${GIT_LOG_FORMAT}"`]: SAMPLE_GIT_LOG,
  };

  return {
    run: jest.fn(async (cmd: string): Promise<ExecutorResult> => {
      const val = overrides[cmd] ?? defaults[cmd];
      if (val instanceof Error) throw val;
      if (val !== undefined) {
        const s = val as string;
        return { stdout: s, lines: s.split('\n').filter(Boolean) };
      }
      // Fallback: return empty for unknown commands
      return { stdout: '', lines: [] };
    }),
  };
}

function createDeps(overrides: Partial<ChangelogCommandDeps> = {}): ChangelogCommandDeps & { stdout: PassThrough } {
  const stdout = new PassThrough();
  stdout.setEncoding('utf8');

  return {
    executor: overrides.executor ?? createMockExecutor(),
    bumpPolicy: overrides.bumpPolicy ?? DEFAULT_BUMP_POLICY,
    changelogConfig: overrides.changelogConfig ?? {
      groupTitles: DEFAULT_GROUP_TITLES,
      excludeTypes: [],
      includeNonConventional: false,
    },
    stdout: overrides.stdout as any ?? stdout,
    existsSync: overrides.existsSync ?? (() => false),
    readFileSync: overrides.readFileSync ?? (() => ''),
    writeFileSync: overrides.writeFileSync ?? jest.fn(),
    ...overrides,
  };
}

function drainStdout(stdout: PassThrough): string {
  let output = '';
  let chunk: string | null;
  while ((chunk = stdout.read() as string | null) !== null) {
    output += chunk;
  }
  return output;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('changelog.command — generate to stdout', () => {
  test('outputs markdown changelog to stdout by default', async () => {
    const deps = createDeps();

    await runChangelogCommand({ json: false }, deps);

    const output = drainStdout(deps.stdout);
    expect(output).toContain('Features');
    expect(output).toContain('add login endpoint');
    expect(output).toContain('Bug Fixes');
    expect(output).toContain('resolve connection leak');
  });

  test('does not include chore commits (mapped to none in default policy)', async () => {
    const deps = createDeps();

    await runChangelogCommand({ json: false }, deps);

    const output = drainStdout(deps.stdout);
    expect(output).not.toContain('update deps');
  });

  test('includes markdown header with Unreleased and date', async () => {
    const deps = createDeps();

    await runChangelogCommand({ json: false }, deps);

    const output = drainStdout(deps.stdout);
    expect(output).toMatch(/^## \[Unreleased\] - \d{4}-\d{2}-\d{2}/);
  });
});

describe('changelog.command — --output writes to file', () => {
  test('writes changelog to a new file when file does not exist', async () => {
    const writeFileSync = jest.fn();
    const deps = createDeps({
      existsSync: () => false,
      writeFileSync,
    });

    await runChangelogCommand({ json: false, output: 'CHANGELOG.md' }, deps);

    expect(writeFileSync).toHaveBeenCalledTimes(1);
    const [path, content, encoding] = writeFileSync.mock.calls[0];
    expect(path).toBe('CHANGELOG.md');
    expect(encoding).toBe('utf8');
    expect(content).toContain('# Changelog');
    expect(content).toContain('Features');
    expect(content).toContain('add login endpoint');
  });

  test('does not write to stdout when --output is specified', async () => {
    const writeFileSync = jest.fn();
    const deps = createDeps({
      existsSync: () => false,
      writeFileSync,
    });

    await runChangelogCommand({ json: false, output: 'CHANGELOG.md' }, deps);

    const output = drainStdout(deps.stdout);
    expect(output).toBe('');
  });
});

describe('changelog.command — --json outputs JSON', () => {
  test('outputs valid JSON with required fields', async () => {
    const deps = createDeps();

    await runChangelogCommand({ json: true }, deps);

    const output = drainStdout(deps.stdout);
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('version', null);
    expect(parsed).toHaveProperty('date');
    expect(parsed).toHaveProperty('groups');
    expect(parsed).toHaveProperty('range');
    expect(parsed).toHaveProperty('markdown');
    expect(parsed.range).toHaveProperty('from');
    expect(parsed.range).toHaveProperty('to');
  });

  test('JSON groups contain correct commit data', async () => {
    const deps = createDeps();

    await runChangelogCommand({ json: true }, deps);

    const output = drainStdout(deps.stdout);
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed.groups)).toBe(true);
    const featGroup = parsed.groups.find((g: any) => g.title === 'Features');
    expect(featGroup).toBeDefined();
    expect(featGroup.commits.some((c: any) => c.description === 'add login endpoint')).toBe(true);
  });

  test('JSON markdown field contains rendered changelog', async () => {
    const deps = createDeps();

    await runChangelogCommand({ json: true }, deps);

    const output = drainStdout(deps.stdout);
    const parsed = JSON.parse(output);
    expect(parsed.markdown).toContain('Features');
    expect(parsed.markdown).toContain('add login endpoint');
  });
});

describe('changelog.command — --from/--to specify range', () => {
  test('uses --from and --to to build git log command', async () => {
    const executor = createMockExecutor({
      [`git log v0.5.0..v1.0.0 --format="${GIT_LOG_FORMAT}"`]: SAMPLE_GIT_LOG,
    });
    const deps = createDeps({ executor });

    await runChangelogCommand({ json: false, from: 'v0.5.0', to: 'v1.0.0' }, deps);

    expect(executor.run).toHaveBeenCalledWith(
      `git log v0.5.0..v1.0.0 --format="${GIT_LOG_FORMAT}"`,
    );
    const output = drainStdout(deps.stdout);
    expect(output).toContain('Features');
  });

  test('uses --from with default --to=HEAD', async () => {
    const executor = createMockExecutor({
      [`git log v0.5.0..HEAD --format="${GIT_LOG_FORMAT}"`]: SAMPLE_GIT_LOG,
    });
    const deps = createDeps({ executor });

    await runChangelogCommand({ json: false, from: 'v0.5.0' }, deps);

    expect(executor.run).toHaveBeenCalledWith(
      `git log v0.5.0..HEAD --format="${GIT_LOG_FORMAT}"`,
    );
  });
});


describe('changelog.command — prepend to existing file', () => {
  test('prepends new section after # Changelog header in existing file', async () => {
    const existingContent = '# Changelog\n\n## [1.0.0] - 2024-01-01\n\n### Features\n\n- old feature\n';
    const writeFileSync = jest.fn();
    const deps = createDeps({
      existsSync: () => true,
      readFileSync: () => existingContent,
      writeFileSync,
    });

    await runChangelogCommand({ json: false, output: 'CHANGELOG.md' }, deps);

    expect(writeFileSync).toHaveBeenCalledTimes(1);
    const content: string = writeFileSync.mock.calls[0][1];
    // New content should start with # Changelog header
    expect(content).toMatch(/^# Changelog/);
    // New section should appear before old content
    const newSectionIdx = content.indexOf('add login endpoint');
    const oldSectionIdx = content.indexOf('old feature');
    expect(newSectionIdx).toBeGreaterThan(-1);
    expect(oldSectionIdx).toBeGreaterThan(-1);
    expect(newSectionIdx).toBeLessThan(oldSectionIdx);
  });

  test('prepends to existing file without # Changelog header', async () => {
    const existingContent = '## [1.0.0] - 2024-01-01\n\n- old feature\n';
    const writeFileSync = jest.fn();
    const deps = createDeps({
      existsSync: () => true,
      readFileSync: () => existingContent,
      writeFileSync,
    });

    await runChangelogCommand({ json: false, output: 'CHANGELOG.md' }, deps);

    expect(writeFileSync).toHaveBeenCalledTimes(1);
    const content: string = writeFileSync.mock.calls[0][1];
    // New section should appear before old content
    const newSectionIdx = content.indexOf('add login endpoint');
    const oldSectionIdx = content.indexOf('old feature');
    expect(newSectionIdx).toBeGreaterThan(-1);
    expect(oldSectionIdx).toBeGreaterThan(-1);
    expect(newSectionIdx).toBeLessThan(oldSectionIdx);
  });
});

describe('changelog.command — no commits → NO_OPERATION (exit 8)', () => {
  test('throws VersioningsError with NO_OPERATION when no commits in range', async () => {
    const executor = createMockExecutor({
      [`git tag --list "v*" --sort=-version:refSort`]: 'v1.0.0',
      [`git log v1.0.0..HEAD --format="${GIT_LOG_FORMAT}"`]: '',
    });
    const deps = createDeps({ executor });

    await expect(
      runChangelogCommand({ json: false }, deps),
    ).rejects.toThrow(VersioningsError);

    try {
      await runChangelogCommand({ json: false }, deps);
    } catch (err: any) {
      expect(err.code).toBe(EXIT_CODES.NO_OPERATION);
      expect(err.message).toContain('No commits found');
    }
  });

  test('throws NO_OPERATION when git log returns only whitespace', async () => {
    const executor = createMockExecutor({
      [`git tag --list "v*" --sort=-version:refSort`]: 'v1.0.0',
      [`git log v1.0.0..HEAD --format="${GIT_LOG_FORMAT}"`]: '   \n  \n  ',
    });
    const deps = createDeps({ executor });

    await expect(
      runChangelogCommand({ json: false }, deps),
    ).rejects.toThrow(VersioningsError);
  });
});

describe('changelog.command — markdown vs plain format', () => {
  test('markdown format includes ### headers for groups', async () => {
    const deps = createDeps();

    await runChangelogCommand({ json: false, format: 'markdown' }, deps);

    const output = drainStdout(deps.stdout);
    expect(output).toContain('### Features');
    expect(output).toContain('### Bug Fixes');
    expect(output).toMatch(/^## \[Unreleased\]/);
  });

  test('plain format does not include markdown headers', async () => {
    const deps = createDeps();

    await runChangelogCommand({ json: false, format: 'plain' }, deps);

    const output = drainStdout(deps.stdout);
    expect(output).not.toContain('### ');
    expect(output).not.toContain('## ');
    expect(output).toContain('Features');
    expect(output).toContain('Bug Fixes');
    expect(output).toMatch(/^\[Unreleased\]/);
  });
});

describe('changelog.command — no tags fallback', () => {
  test('falls back to root commit range when no version tags exist', async () => {
    const rootHash = 'ddd4444444444444444444444444444444444444';
    const executor = createMockExecutor({
      [`git tag --list "v*" --sort=-version:refSort`]: '',
      [`git rev-list --max-parents=0 HEAD`]: rootHash,
      [`git log ${rootHash}..HEAD --format="${GIT_LOG_FORMAT}"`]: SAMPLE_GIT_LOG,
    });
    const deps = createDeps({ executor });

    await runChangelogCommand({ json: false }, deps);

    expect(executor.run).toHaveBeenCalledWith(
      `git log ${rootHash}..HEAD --format="${GIT_LOG_FORMAT}"`,
    );
    const output = drainStdout(deps.stdout);
    expect(output).toContain('Features');
  });

  test('uses git log HEAD when findLastVersionTag returns null', async () => {
    // Simulate both git tag and git rev-list failing → findLastVersionTag returns null → from=''
    const executor: Executor = {
      run: jest.fn(async (cmd: string): Promise<ExecutorResult> => {
        if (cmd.includes('git tag --list')) {
          throw new VersioningsError(EXIT_CODES.COMMAND_FAILED, 'no tags', {});
        }
        if (cmd.includes('git rev-list')) {
          throw new VersioningsError(EXIT_CODES.COMMAND_FAILED, 'empty repo', {});
        }
        if (cmd === `git log HEAD --format="${GIT_LOG_FORMAT}"`) {
          return { stdout: SAMPLE_GIT_LOG, lines: SAMPLE_GIT_LOG.split('\n').filter(Boolean) };
        }
        return { stdout: '', lines: [] };
      }),
    };
    const deps = createDeps({ executor });

    await runChangelogCommand({ json: false }, deps);

    expect(executor.run).toHaveBeenCalledWith(
      `git log HEAD --format="${GIT_LOG_FORMAT}"`,
    );
    const output = drainStdout(deps.stdout);
    expect(output).toContain('Features');
  });
});

describe('changelog.command — scope in output', () => {
  test('includes scope in parentheses for scoped commits', async () => {
    const deps = createDeps();

    await runChangelogCommand({ json: false }, deps);

    const output = drainStdout(deps.stdout);
    expect(output).toContain('add login endpoint (auth)');
    expect(output).toContain('resolve connection leak (db)');
  });
});
