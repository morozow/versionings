// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * Test helper: utilities for creating isolated git repositories.
 *
 * All git commands use execSync with proper quoting for paths with spaces.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface RepoFixture {
  repoDir: string;
  remoteDir: string;
  remoteUrl: string;
}

export interface RepoSnapshot {
  head: string;
  branch: string;
  branches: string[];
  tags: string[];
  version: string;
  status: string;
}

export interface RepoFixtureOpts {
  pathWithSpaces?: boolean;
  initialVersion?: string;
}

export interface ExpectedRepoState {
  branch?: string;
  version?: string;
  tags?: string[];
  branches?: string[];
  clean?: boolean;
}

/**
 * Run a git command in the given directory.
 */
export function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim();
}

function createBareRemote(repoDir: string, opts: RepoFixtureOpts = {}): { remoteDir: string; remoteUrl: string } {
  const prefix = opts.pathWithSpaces
    ? 'versionings bare remote '
    : 'versionings-bare-';
  const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  git(remoteDir, 'init --bare -b main');
  const remoteUrl = remoteDir;
  git(repoDir, `remote add origin "${remoteUrl}"`);
  return { remoteDir, remoteUrl };
}

export function createRepoFixture(opts: RepoFixtureOpts = {}): RepoFixture {
  const prefix = opts.pathWithSpaces
    ? 'versionings fixture '
    : 'versionings-fixture-';
  const initialVersion = opts.initialVersion || '1.0.0';
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  git(repoDir, 'init -b main');
  git(repoDir, 'config user.name "Test User"');
  git(repoDir, 'config user.email "test@example.com"');
  const { remoteDir, remoteUrl } = createBareRemote(repoDir, opts);
  const packageJson = {
    name: 'test-project',
    version: initialVersion,
    description: 'Test project for integration tests',
  };
  fs.writeFileSync(
    path.join(repoDir, 'package.json'),
    JSON.stringify(packageJson, null, 2) + '\n',
  );
  const versionJson = { git: { platform: 'github', url: remoteUrl } };
  fs.writeFileSync(
    path.join(repoDir, 'version.json'),
    JSON.stringify(versionJson, null, 2) + '\n',
  );
  fs.writeFileSync(path.join(repoDir, '.npmrc'), 'loglevel = "silent"\n');
  git(repoDir, 'add .');
  git(repoDir, 'commit -m "init"');
  git(repoDir, 'push origin main');
  return { repoDir, remoteDir, remoteUrl };
}

export function snapshotRepoState(repoDir: string): RepoSnapshot {
  const head = git(repoDir, 'rev-parse HEAD');
  const branch = git(repoDir, 'rev-parse --abbrev-ref HEAD');
  const branchesRaw = git(repoDir, 'branch --list');
  const branches = branchesRaw
    .split(/\r?\n/)
    .map((l) => l.replace(/^\*?\s*/, '').trim())
    .filter(Boolean)
    .sort();
  let tags: string[] = [];
  try {
    const tagsRaw = git(repoDir, 'tag --list');
    tags = tagsRaw.split(/\r?\n/).filter(Boolean).sort();
  } catch (_) {
    // no tags
  }
  const pkgPath = path.join(repoDir, 'package.json');
  const version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
  const status = git(repoDir, 'status --porcelain');
  return { head, branch, branches, tags, version, status };
}

export function assertRepoState(repoDir: string, expected: ExpectedRepoState): void {
  const state = snapshotRepoState(repoDir);
  if (expected.branch !== undefined) {
    expect(state.branch).toBe(expected.branch);
  }
  if (expected.version !== undefined) {
    expect(state.version).toBe(expected.version);
  }
  if (expected.tags !== undefined) {
    expect(state.tags).toEqual([...expected.tags].sort());
  }
  if (expected.branches !== undefined) {
    expect(state.branches).toEqual([...expected.branches].sort());
  }
  if (expected.clean !== undefined && expected.clean) {
    expect(state.status).toBe('');
  }
}

export function assertNoMutation(repoDir: string, snapshot: RepoSnapshot): void {
  const current = snapshotRepoState(repoDir);
  expect(current.head).toBe(snapshot.head);
  expect(current.branch).toBe(snapshot.branch);
  expect(current.branches).toEqual(snapshot.branches);
  expect(current.tags).toEqual(snapshot.tags);
  expect(current.version).toBe(snapshot.version);
}

export function cleanup(dirs: string[]): void {
  for (const dir of dirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {
      // ignore — directory may already be removed
    }
  }
}

export interface StrategyFixtureOpts extends RepoFixtureOpts {
  strategy: string;
  platform?: string;
  apiUrl?: string;
  branchingConfig?: Record<string, unknown>;
}

/**
 * Create a repo fixture pre-configured with a branching strategy.
 *
 * Calls createRepoFixture(), then overwrites version.json with the
 * specified strategy/platform/apiUrl/branchingConfig and commits the change.
 */
export function createRepoFixtureWithStrategy(opts: StrategyFixtureOpts): RepoFixture {
  const { strategy, platform = 'github', apiUrl, branchingConfig, ...baseOpts } = opts;
  const fixture = createRepoFixture(baseOpts);

  const gitConfig: Record<string, unknown> = {
    platform,
    url: fixture.remoteUrl,
    branching: {
      ...(branchingConfig || {}),
      strategy,
    },
  };

  if (apiUrl) {
    gitConfig.apiUrl = apiUrl;
  }

  const versionJson = { git: gitConfig };
  fs.writeFileSync(
    path.join(fixture.repoDir, 'version.json'),
    JSON.stringify(versionJson, null, 2) + '\n',
  );
  git(fixture.repoDir, 'add version.json');
  git(fixture.repoDir, 'commit -m "configure strategy fixture"');
  git(fixture.repoDir, 'push origin main');

  return fixture;
}
