// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { PassThrough } from 'stream';
import * as path from 'path';
import { runInitCommand, InitCommandDeps } from '../../../src/cli/commands/init.command';
import type { InteractionManager } from '../../../src/cli/interaction.manager';
import type { Executor, ExecutorResult } from '../../../src/core/executor';
import { EXIT_CODES, VersioningsError } from '../../../src/core/errors';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockExecutor(remoteUrl?: string): Executor {
  return {
    run: jest.fn(async (_cmd: string): Promise<ExecutorResult> => {
      if (remoteUrl !== undefined) {
        return { stdout: remoteUrl, lines: remoteUrl ? [remoteUrl] : [] };
      }
      throw new VersioningsError(EXIT_CODES.COMMAND_FAILED, 'git remote failed', {});
    }),
  };
}

function createMockInteractionManager(interactive: boolean): InteractionManager {
  return {
    isInteractive: jest.fn(() => interactive),
    confirm: jest.fn(async () => true),
  };
}

function makeDeps(overrides: Partial<InitCommandDeps> & {
  interactive?: boolean;
  remoteUrl?: string;
} = {}): InitCommandDeps & { stdin: PassThrough; stdout: PassThrough; written: { path?: string; data?: string } } {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  stdout.setEncoding('utf8');

  const written: { path?: string; data?: string } = {};

  return {
    interactionManager: overrides.interactionManager
      ?? createMockInteractionManager(overrides.interactive ?? false),
    executor: overrides.executor ?? createMockExecutor(overrides.remoteUrl ?? 'https://github.com/org/repo'),
    cwd: overrides.cwd ?? '/tmp/test-project',
    stdin: overrides.stdin as any ?? stdin,
    stdout: overrides.stdout as any ?? stdout,
    existsSync: overrides.existsSync ?? jest.fn(() => false),
    writeFileSync: overrides.writeFileSync ?? jest.fn((p: string, data: string) => {
      written.path = p;
      written.data = data;
    }),
    written,
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('init.command — JSON generation (non-interactive)', () => {
  test('generates version.json with defaults from auto-detected URL', async () => {
    const deps = makeDeps({ remoteUrl: 'https://github.com/org/repo' });

    await runInitCommand({}, deps);

    expect(deps.writeFileSync).toHaveBeenCalledTimes(1);
    const [filePath, content] = (deps.writeFileSync as jest.Mock).mock.calls[0];
    expect(filePath).toBe(path.join('/tmp/test-project', 'version.json'));

    const parsed = JSON.parse(content);
    expect(parsed.git.platform).toBe('github');
    expect(parsed.git.url).toBe('https://github.com/org/repo');
    expect(parsed.git.pr.target).toBe('main');
  });

  test('infers bitbucket platform from URL', async () => {
    const deps = makeDeps({ remoteUrl: 'https://bitbucket.org/team/repo' });

    await runInitCommand({}, deps);

    const [, content] = (deps.writeFileSync as jest.Mock).mock.calls[0];
    const parsed = JSON.parse(content);
    expect(parsed.git.platform).toBe('bitbucket');
  });
});

describe('init.command — YAML generation (non-interactive)', () => {
  test('generates .versioningsrc.yml when --format=yaml', async () => {
    const deps = makeDeps({ remoteUrl: 'https://github.com/org/repo' });

    await runInitCommand({ format: 'yaml' }, deps);

    expect(deps.writeFileSync).toHaveBeenCalledTimes(1);
    const [filePath, content] = (deps.writeFileSync as jest.Mock).mock.calls[0];
    expect(filePath).toBe(path.join('/tmp/test-project', '.versioningsrc.yml'));

    // YAML content should contain the key fields
    expect(content).toContain('platform');
    expect(content).toContain('github');
    expect(content).toContain('https://github.com/org/repo');
  });
});

describe('init.command — --format=json flag', () => {
  test('generates version.json when --format=json explicitly', async () => {
    const deps = makeDeps({ remoteUrl: 'https://github.com/org/repo' });

    await runInitCommand({ format: 'json' }, deps);

    const [filePath] = (deps.writeFileSync as jest.Mock).mock.calls[0];
    expect(filePath).toBe(path.join('/tmp/test-project', 'version.json'));
  });
});

describe('init.command — overwrite existing file', () => {
  test('non-interactive mode overwrites existing file silently', async () => {
    const existsSync = jest.fn(() => true);
    const deps = makeDeps({ remoteUrl: 'https://github.com/org/repo', existsSync });

    await runInitCommand({}, deps);

    expect(deps.writeFileSync).toHaveBeenCalledTimes(1);
  });

  test('interactive mode asks for overwrite confirmation — user accepts', async () => {
    const existsSync = jest.fn(() => true);
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    stdout.setEncoding('utf8');

    const deps = makeDeps({
      interactive: true,
      remoteUrl: 'https://github.com/org/repo',
      existsSync,
      stdin,
      stdout,
    });

    const promise = runInitCommand({}, deps);

    // Answer wizard questions: platform, url (accept default), pr target (accept default), format (accept default)
    stdin.write('github\n');
    // Small delay to let readline process each answer
    await new Promise((r) => setTimeout(r, 20));
    stdin.write('https://github.com/org/repo\n');
    await new Promise((r) => setTimeout(r, 20));
    stdin.write('main\n');
    await new Promise((r) => setTimeout(r, 20));
    stdin.write('json\n');
    await new Promise((r) => setTimeout(r, 20));
    // Overwrite confirmation
    stdin.write('y\n');

    await promise;
    expect(deps.writeFileSync).toHaveBeenCalledTimes(1);
  });

  test('interactive mode asks for overwrite confirmation — user declines', async () => {
    const existsSync = jest.fn(() => true);
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    stdout.setEncoding('utf8');

    const deps = makeDeps({
      interactive: true,
      remoteUrl: 'https://github.com/org/repo',
      existsSync,
      stdin,
      stdout,
    });

    const promise = runInitCommand({}, deps);

    // Answer wizard questions
    stdin.write('github\n');
    await new Promise((r) => setTimeout(r, 20));
    stdin.write('https://github.com/org/repo\n');
    await new Promise((r) => setTimeout(r, 20));
    stdin.write('main\n');
    await new Promise((r) => setTimeout(r, 20));
    stdin.write('json\n');
    await new Promise((r) => setTimeout(r, 20));
    // Decline overwrite
    stdin.write('n\n');

    await expect(promise).rejects.toThrow(VersioningsError);
    await expect(promise).rejects.toMatchObject({ code: EXIT_CODES.USER_CANCELLED });
    expect(deps.writeFileSync).not.toHaveBeenCalled();
  });
});

describe('init.command — non-interactive mode', () => {
  test('generates config with defaults without reading stdin', async () => {
    const deps = makeDeps({ remoteUrl: 'https://github.com/org/repo' });

    await runInitCommand({}, deps);

    expect(deps.writeFileSync).toHaveBeenCalledTimes(1);
    const [, content] = (deps.writeFileSync as jest.Mock).mock.calls[0];
    const parsed = JSON.parse(content);
    expect(parsed.git.platform).toBe('github');
    expect(parsed.git.pr.target).toBe('main');
  });

  test('throws CONFIG_ERROR when no remote URL detected in non-interactive mode', async () => {
    const executor = createMockExecutor(undefined);
    const deps = makeDeps({ executor });

    try {
      await runInitCommand({}, deps);
      fail('Expected VersioningsError to be thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
    }
    expect(deps.writeFileSync).not.toHaveBeenCalled();
  });
});

describe('init.command — auto-detect URL', () => {
  test('calls git remote get-url origin via executor', async () => {
    const executor = createMockExecutor('https://github.com/org/repo');
    const deps = makeDeps({ executor });

    await runInitCommand({}, deps);

    expect(executor.run).toHaveBeenCalledWith('git remote get-url origin');
  });

  test('uses detected URL in generated config', async () => {
    const deps = makeDeps({ remoteUrl: 'https://github.com/my-org/my-repo' });

    await runInitCommand({}, deps);

    const [, content] = (deps.writeFileSync as jest.Mock).mock.calls[0];
    const parsed = JSON.parse(content);
    expect(parsed.git.url).toBe('https://github.com/my-org/my-repo');
  });
});

describe('init.command — validation before writing', () => {
  test('generated JSON config is valid against schema', async () => {
    const deps = makeDeps({ remoteUrl: 'https://github.com/org/repo' });

    await runInitCommand({}, deps);

    const [, content] = (deps.writeFileSync as jest.Mock).mock.calls[0];
    const parsed = JSON.parse(content);

    // Must have required fields
    expect(parsed.git).toBeDefined();
    expect(parsed.git.platform).toBeDefined();
    expect(parsed.git.url).toBeDefined();
    expect(['github', 'bitbucket']).toContain(parsed.git.platform);
    expect(parsed.git.url.length).toBeGreaterThan(0);
  });

  test('generated YAML config is valid against schema', async () => {
    const deps = makeDeps({ remoteUrl: 'https://bitbucket.org/team/repo' });

    await runInitCommand({ format: 'yaml' }, deps);

    const [, content] = (deps.writeFileSync as jest.Mock).mock.calls[0];
    // YAML should be parseable and contain required fields
    const yaml = require('js-yaml');
    const parsed = yaml.load(content);
    expect(parsed.git).toBeDefined();
    expect(parsed.git.platform).toBe('bitbucket');
    expect(parsed.git.url).toBe('https://bitbucket.org/team/repo');
  });

  test('writes "Created <filename>" to stdout on success', async () => {
    const deps = makeDeps({ remoteUrl: 'https://github.com/org/repo' });

    await runInitCommand({}, deps);

    const output = drainStdout(deps.stdout);
    expect(output).toContain('Created version.json');
  });
});

describe('init.command — interactive wizard', () => {
  test('runs full wizard and generates JSON config', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    stdout.setEncoding('utf8');

    const deps = makeDeps({
      interactive: true,
      remoteUrl: 'https://github.com/org/repo',
      stdin,
      stdout,
    });

    const promise = runInitCommand({}, deps);

    // Answer all wizard questions
    stdin.write('github\n');
    await new Promise((r) => setTimeout(r, 20));
    stdin.write('https://github.com/org/repo\n');
    await new Promise((r) => setTimeout(r, 20));
    stdin.write('main\n');
    await new Promise((r) => setTimeout(r, 20));
    stdin.write('json\n');

    await promise;

    expect(deps.writeFileSync).toHaveBeenCalledTimes(1);
    const [filePath, content] = (deps.writeFileSync as jest.Mock).mock.calls[0];
    expect(filePath).toContain('version.json');
    const parsed = JSON.parse(content);
    expect(parsed.git.platform).toBe('github');
    expect(parsed.git.url).toBe('https://github.com/org/repo');
  });

  test('wizard with --format=yaml skips format question', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    stdout.setEncoding('utf8');

    const deps = makeDeps({
      interactive: true,
      remoteUrl: 'https://github.com/org/repo',
      stdin,
      stdout,
    });

    const promise = runInitCommand({ format: 'yaml' }, deps);

    // Only 3 questions (no format question)
    stdin.write('github\n');
    await new Promise((r) => setTimeout(r, 20));
    stdin.write('https://github.com/org/repo\n');
    await new Promise((r) => setTimeout(r, 20));
    stdin.write('main\n');

    await promise;

    const [filePath] = (deps.writeFileSync as jest.Mock).mock.calls[0];
    expect(filePath).toContain('.versioningsrc.yml');
  });
});
