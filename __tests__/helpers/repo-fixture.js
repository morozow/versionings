/* Versioning automation tool, 2018-present */

/**
 * Test helper: utilities for creating isolated git repositories.
 *
 * All git commands use execSync with proper quoting for paths with spaces.
 * CommonJS module — not matched by Jest transform.
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Run a git command in the given directory.
 * All paths are properly quoted to handle spaces.
 *
 * @param {string} cwd — working directory
 * @param {string} args — git arguments
 * @returns {string} trimmed stdout
 */
function git(cwd, args) {
  return execSync(`git ${args}`, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim();
}

/**
 * Creates a bare git repository and adds it as 'origin' to the working repo.
 *
 * @param {string} repoDir — path to the working repository
 * @param {object} [opts]
 * @param {boolean} [opts.pathWithSpaces] — force spaces in the bare repo path
 * @returns {{ remoteDir: string, remoteUrl: string }}
 */
function createBareRemote(repoDir, opts = {}) {
  const prefix = opts.pathWithSpaces
    ? 'versionings bare remote '
    : 'versionings-bare-';
  const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));

  git(remoteDir, 'init --bare -b main');

  const remoteUrl = remoteDir;
  git(repoDir, `remote add origin "${remoteUrl}"`);

  return { remoteDir, remoteUrl };
}

/**
 * Creates an isolated git repository with initial commit.
 *
 * Sets up:
 * - tmpdir with git init -b main
 * - user.name / user.email configured locally
 * - package.json (version: "1.0.0")
 * - version.json (platform: github, url pointing to bare remote)
 * - Initial commit "init"
 * - Bare remote added as origin
 *
 * @param {object} [opts]
 * @param {boolean} [opts.pathWithSpaces] — force spaces in tmpdir name
 * @param {string} [opts.initialVersion] — initial package.json version (default "1.0.0")
 * @returns {{ repoDir: string, remoteDir: string, remoteUrl: string }}
 */
function createRepoFixture(opts = {}) {
  const prefix = opts.pathWithSpaces
    ? 'versionings fixture '
    : 'versionings-fixture-';
  const initialVersion = opts.initialVersion || '1.0.0';

  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));

  // Initialize git repo
  git(repoDir, 'init -b main');
  git(repoDir, 'config user.name "Test User"');
  git(repoDir, 'config user.email "test@example.com"');

  // Create bare remote first so we can reference its path in version.json
  const { remoteDir, remoteUrl } = createBareRemote(repoDir, opts);

  // Write package.json
  const packageJson = {
    name: 'test-project',
    version: initialVersion,
    description: 'Test project for integration tests',
  };
  fs.writeFileSync(
    path.join(repoDir, 'package.json'),
    JSON.stringify(packageJson, null, 2) + '\n',
  );

  // Write version.json — url points to the bare remote
  const versionJson = {
    git: {
      platform: 'github',
      url: remoteUrl,
    },
  };
  fs.writeFileSync(
    path.join(repoDir, 'version.json'),
    JSON.stringify(versionJson, null, 2) + '\n',
  );

  // Write .npmrc to suppress npm output during version bumps
  fs.writeFileSync(path.join(repoDir, '.npmrc'), 'loglevel = "silent"\n');

  // Initial commit
  git(repoDir, 'add .');
  git(repoDir, 'commit -m "init"');

  // Push initial commit to bare remote so it has a main branch
  git(repoDir, 'push origin main');

  return { repoDir, remoteDir, remoteUrl };
}

/**
 * Captures a snapshot of the repository state.
 * Used by assertNoMutation to compare before/after.
 *
 * @param {string} repoDir
 * @returns {{ head: string, branch: string, branches: string[], tags: string[], version: string, status: string }}
 */
function snapshotRepoState(repoDir) {
  const head = git(repoDir, 'rev-parse HEAD');
  const branch = git(repoDir, 'rev-parse --abbrev-ref HEAD');

  const branchesRaw = git(repoDir, 'branch --list');
  const branches = branchesRaw
    .split(/\r?\n/)
    .map((l) => l.replace(/^\*?\s*/, '').trim())
    .filter(Boolean)
    .sort();

  let tags = [];
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

/**
 * Asserts the repository is in the expected state.
 *
 * @param {string} repoDir
 * @param {object} expected
 * @param {string} [expected.branch] — expected current branch name
 * @param {string} [expected.version] — expected version in package.json
 * @param {string[]} [expected.tags] — expected list of tags (sorted)
 * @param {string[]} [expected.branches] — expected list of branches (sorted)
 * @param {boolean} [expected.clean] — expected clean working tree (default true)
 */
function assertRepoState(repoDir, expected) {
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

/**
 * Asserts that the repository state has NOT changed compared to a snapshot.
 * Proves that an operation (e.g. dry-run) did not mutate the repo.
 *
 * @param {string} repoDir
 * @param {{ head: string, branch: string, branches: string[], tags: string[], version: string }} snapshot
 */
function assertNoMutation(repoDir, snapshot) {
  const current = snapshotRepoState(repoDir);

  expect(current.head).toBe(snapshot.head);
  expect(current.branch).toBe(snapshot.branch);
  expect(current.branches).toEqual(snapshot.branches);
  expect(current.tags).toEqual(snapshot.tags);
  expect(current.version).toBe(snapshot.version);
}

/**
 * Removes temporary directories. Idempotent — ignores missing dirs.
 *
 * @param {string[]} dirs — array of directory paths to remove
 */
function cleanup(dirs) {
  for (const dir of dirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {
      // ignore — directory may already be removed
    }
  }
}

module.exports = {
  git,
  createRepoFixture,
  createBareRemote,
  snapshotRepoState,
  assertRepoState,
  assertNoMutation,
  cleanup,
};
