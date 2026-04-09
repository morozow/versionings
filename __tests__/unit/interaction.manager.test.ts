// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { PassThrough } from 'stream';
import { createInteractionManager } from '../../interaction.manager';
import type { InteractionOpts } from '../../interaction.manager';
import type { DryRunPlan } from '../../reporter';

const mockPlan: DryRunPlan = {
  dryRun: false,
  currentVersion: '1.0.0',
  nextVersion: '1.0.1',
  semver: 'patch',
  branch: 'version/patch/1.0.1/fix-bug',
  tag: '1.0.1--fix-bug',
  commitMessage: 'Patch: v1.0.1. You SHOULD consider changes.',
  pullRequestUrl: null,
  steps: ['npm --no-git-tag-version version patch', 'git checkout -b version/patch/1.0.1/fix-bug'],
};

function makeStreams() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  return { stdin, stdout };
}

describe('InteractionManager — isInteractive()', () => {
  test('returns true only when isTTY=true AND ci=false AND nonInteractive=false AND yes=false', () => {
    const { stdin, stdout } = makeStreams();
    const mgr = createInteractionManager(
      { isTTY: true, ci: false, nonInteractive: false, yes: false },
      stdin,
      stdout,
    );
    expect(mgr.isInteractive()).toBe(true);
  });

  test.each<[string, InteractionOpts, boolean]>([
    ['ci=true', { isTTY: true, ci: true, nonInteractive: false, yes: false }, false],
    ['nonInteractive=true', { isTTY: true, ci: false, nonInteractive: true, yes: false }, false],
    ['yes=true', { isTTY: true, ci: false, nonInteractive: false, yes: true }, false],
    ['isTTY=false', { isTTY: false, ci: false, nonInteractive: false, yes: false }, false],
    ['all flags true', { isTTY: true, ci: true, nonInteractive: true, yes: true }, false],
    ['isTTY=false + ci=true', { isTTY: false, ci: true, nonInteractive: false, yes: false }, false],
    ['isTTY=false + yes=true', { isTTY: false, ci: false, nonInteractive: false, yes: true }, false],
  ])('returns false when %s', (_label, opts, expected) => {
    const { stdin, stdout } = makeStreams();
    const mgr = createInteractionManager(opts, stdin, stdout);
    expect(mgr.isInteractive()).toBe(expected);
  });
});

describe('InteractionManager — confirm() in non-interactive mode', () => {
  test('returns true without reading stdin', async () => {
    const { stdin, stdout } = makeStreams();
    const mgr = createInteractionManager(
      { isTTY: false, ci: false, nonInteractive: false, yes: false },
      stdin,
      stdout,
    );
    expect(mgr.isInteractive()).toBe(false);

    const result = await mgr.confirm(mockPlan);
    expect(result).toBe(true);

    // stdout should NOT have received the plan output (no prompt in non-interactive)
    const written = stdout.read();
    expect(written).toBeNull();
  });
});

describe('InteractionManager — confirm() in interactive mode', () => {
  function createInteractive() {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const mgr = createInteractionManager(
      { isTTY: true, ci: false, nonInteractive: false, yes: false },
      stdin,
      stdout,
    );
    return { stdin, stdout, mgr };
  }

  test('user answers "y" — returns true', async () => {
    const { stdin, mgr } = createInteractive();
    const promise = mgr.confirm(mockPlan);
    // Simulate user typing "y\n"
    stdin.write('y\n');
    const result = await promise;
    expect(result).toBe(true);
  });

  test('user answers "n" — returns false', async () => {
    const { stdin, mgr } = createInteractive();
    const promise = mgr.confirm(mockPlan);
    stdin.write('n\n');
    const result = await promise;
    expect(result).toBe(false);
  });

  test('user answers "yes" — returns true', async () => {
    const { stdin, mgr } = createInteractive();
    const promise = mgr.confirm(mockPlan);
    stdin.write('yes\n');
    const result = await promise;
    expect(result).toBe(true);
  });

  test('user answers empty string — returns false', async () => {
    const { stdin, mgr } = createInteractive();
    const promise = mgr.confirm(mockPlan);
    stdin.write('\n');
    const result = await promise;
    expect(result).toBe(false);
  });

  test('user answers "maybe" — returns false', async () => {
    const { stdin, mgr } = createInteractive();
    const promise = mgr.confirm(mockPlan);
    stdin.write('maybe\n');
    const result = await promise;
    expect(result).toBe(false);
  });
});

describe('InteractionManager — plan output includes ANSI color codes', () => {
  test('confirm() writes plan with ANSI escape sequences to stdout', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    stdout.setEncoding('utf8');

    const mgr = createInteractionManager(
      { isTTY: true, ci: false, nonInteractive: false, yes: false },
      stdin,
      stdout,
    );

    const promise = mgr.confirm(mockPlan);
    stdin.write('y\n');
    await promise;

    // Collect all data written to stdout
    let output = '';
    let chunk: string | null;
    while ((chunk = stdout.read() as string | null) !== null) {
      output += chunk;
    }

    // eslint-disable-next-line no-control-regex
    const ansiPattern = /\x1b\[/;
    expect(ansiPattern.test(output)).toBe(true);
    expect(output).toContain('Release plan:');
    expect(output).toContain(mockPlan.nextVersion);
    expect(output).toContain(mockPlan.branch);
    expect(output).toContain(mockPlan.tag);
  });
});
