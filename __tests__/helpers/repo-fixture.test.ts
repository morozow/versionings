/* Versioning automation tool, 2018-present */

/**
 * Tests for the repo-fixture test helper.
 * Verifies that isolated git repositories are created correctly.
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  createRepoFixture,
  snapshotRepoState,
  assertRepoState,
  assertNoMutation,
  cleanup,
  git,
} from './repo-fixture';

describe('repo-fixture helper', () => {
  let dirs: string[] = [];

  afterEach(() => {
    cleanup(dirs);
    dirs = [];
  });

  test('createRepoFixture creates a valid git repo with initial commit', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    expect(fs.existsSync(path.join(repoDir, '.git'))).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json'), 'utf8'));
    expect(pkg.version).toBe('1.0.0');
    const versionJson = JSON.parse(fs.readFileSync(path.join(repoDir, 'version.json'), 'utf8'));
    expect(versionJson.git.platform).toBe('github');
    expect(versionJson.git.url).toBe(remoteDir);
    const branch = git(repoDir, 'rev-parse --abbrev-ref HEAD');
    expect(branch).toBe('main');
    const status = git(repoDir, 'status --porcelain');
    expect(status).toBe('');
    const log = git(repoDir, 'log --oneline');
    expect(log).toContain('init');
  });

  test('createRepoFixture with pathWithSpaces handles spaces in paths', () => {
    const { repoDir, remoteDir } = createRepoFixture({ pathWithSpaces: true });
    dirs.push(repoDir, remoteDir);
    expect(repoDir).toMatch(/\s/);
    expect(remoteDir).toMatch(/\s/);
    const branch = git(repoDir, 'rev-parse --abbrev-ref HEAD');
    expect(branch).toBe('main');
    const status = git(repoDir, 'status --porcelain');
    expect(status).toBe('');
    const versionJson = JSON.parse(fs.readFileSync(path.join(repoDir, 'version.json'), 'utf8'));
    expect(versionJson.git.url).toContain(' ');
  });

  test('createRepoFixture with custom initialVersion', () => {
    const { repoDir, remoteDir } = createRepoFixture({ initialVersion: '2.5.0' });
    dirs.push(repoDir, remoteDir);
    const pkg = JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json'), 'utf8'));
    expect(pkg.version).toBe('2.5.0');
  });

  test('snapshotRepoState captures correct state', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    const snapshot = snapshotRepoState(repoDir);
    expect(snapshot.head).toMatch(/^[0-9a-f]{40}$/);
    expect(snapshot.branch).toBe('main');
    expect(snapshot.branches).toEqual(['main']);
    expect(snapshot.tags).toEqual([]);
    expect(snapshot.version).toBe('1.0.0');
    expect(snapshot.status).toBe('');
  });

  test('assertRepoState validates expected state', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    assertRepoState(repoDir, {
      branch: 'main',
      version: '1.0.0',
      tags: [],
      branches: ['main'],
      clean: true,
    });
  });

  test('assertNoMutation detects no changes', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    const snapshot = snapshotRepoState(repoDir);
    assertNoMutation(repoDir, snapshot);
  });

  test('assertNoMutation detects changes after mutation', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    const snapshot = snapshotRepoState(repoDir);
    git(repoDir, 'tag test-tag');
    expect(() => assertNoMutation(repoDir, snapshot)).toThrow();
  });

  test('bare remote receives pushed commits', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    const refs = git(remoteDir, 'for-each-ref --format="%(refname:short)"');
    expect(refs).toContain('main');
  });

  test('cleanup removes directories idempotently', () => {
    const { repoDir, remoteDir } = createRepoFixture();
    cleanup([repoDir, remoteDir]);
    expect(fs.existsSync(repoDir)).toBe(false);
    expect(fs.existsSync(remoteDir)).toBe(false);
    cleanup([repoDir, remoteDir]);
  });
});
