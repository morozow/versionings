// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * Integration tests: Lock workflow — lock acquire/release in pipeline,
 * dry-run without lock, parallel lock conflict, stale lock cleanup.
 *
 * Uses real filesystem (temp directories) and real lock manager.
 * Mock executor simulates git commands (no real git).
 *
 * Note: lock.manager.ts requires esbuild pre-transform due to a Babel
 * limitation with `import type` bindings used in interface declarations.
 *
 * Validates: Requirements 6.1, 6.5, 7.1, 7.2, 9.1, 12.1, 12.2, 12.3
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PassThrough } from 'stream';
import { runPipeline } from '../../src/core/pipeline';
import { createStructuredLogger, generateOperationId } from '../../src/core/structured.logger';
import { createActionTracer } from '../../src/core/action.tracer';
import { createRollbackManager } from '../../src/core/rollback';
import { VersioningsError, EXIT_CODES } from '../../src/core/errors';
import type { Executor, ExecutorResult } from '../../src/core/executor';
import type { ArtifactChecker } from '../../src/core/artifact.checker';
import type { VersioningsConfig } from '../../src/config/config.validator';
import type { PipelineResult } from '../../src/core/reporter';
import type { LockData } from '../../src/core/lock.manager';

// ── Pre-transform lock.manager.ts (esbuild-jest Babel workaround) ──────────

// eslint-disable-next-line @typescript-eslint/no-var-requires
const esbuildLib = require('esbuild');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodeFs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodePath = require('path');

const lockManagerSrcPath = nodePath.resolve(__dirname, '../../src/core/lock.manager.ts');
const lockManagerSrcDir = nodePath.dirname(lockManagerSrcPath);
const lockManagerRaw = nodeFs.readFileSync(lockManagerSrcPath, 'utf-8');
const lockManagerTransformed = esbuildLib.transformSync(lockManagerRaw, {
  loader: 'ts',
  format: 'cjs',
  target: 'es2018',
});

const lockManagerRequire = (id: string): unknown => {
  if (id.startsWith('.')) {
    return require(nodePath.resolve(lockManagerSrcDir, id));
  }
  return require(id);
};

const lockManagerExports: Record<string, unknown> = {};
const lockManagerMod = { exports: lockManagerExports };
const lockManagerRunner = new Function(
  'exports', 'require', 'module', '__filename', '__dirname',
  lockManagerTransformed.code,
);
lockManagerRunner(
  lockManagerExports,
  lockManagerRequire,
  lockManagerMod,
  lockManagerSrcPath,
  lockManagerSrcDir,
);

const createLockManager = lockManagerMod.exports.createLockManager as
  typeof import('../../src/core/lock.manager').createLockManager;

// ── Helpers ─────────────────────────────────────────────────────────────────

let tempDirs: string[] = [];
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
});

afterEach(() => {
  process.chdir(originalCwd);
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tempDirs = [];
});

function createTempProject(version: string = '1.0.0'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'versionings-lock-'));
  tempDirs.push(dir);
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'test-project', version }, null, 2) + '\n',
  );
  return dir;
}

function createMockExecutor(): Executor {
  const responses: Record<string, string> = {
    'git status --porcelain': '',
    'git remote --verbose': 'origin\thttps://github.com/test/repo.git (fetch)\norigin\thttps://github.com/test/repo.git (push)',
    'git tag --list': '',
    'git branch --list': '* main',
    'git rev-parse --abbrev-ref HEAD': 'main',
  };

  return {
    async run(cmd: string): Promise<ExecutorResult> {
      if (cmd.startsWith('npm --no-git-tag-version version')) {
        return { stdout: 'v1.0.1', lines: ['v1.0.1'] };
      }
      if (cmd.startsWith('git checkout --')) {
        return { stdout: '', lines: [] };
      }
      if (cmd.startsWith('git checkout -b')) {
        return { stdout: '', lines: [] };
      }
      if (cmd.startsWith('git tag --annotate')) {
        return { stdout: '', lines: [] };
      }
      if (cmd.startsWith('git commit')) {
        return { stdout: '', lines: [] };
      }
      for (const [pattern, response] of Object.entries(responses)) {
        if (cmd === pattern) {
          const trimmed = response.trim();
          const lines = trimmed ? trimmed.split(/\r?\n/).filter(Boolean) : [];
          return { stdout: trimmed, lines };
        }
      }
      return { stdout: '', lines: [] };
    },
  };
}

function createMockArtifactChecker(): ArtifactChecker {
  return {
    async checkUniqueness(): Promise<void> { /* always passes */ },
  };
}

function createTestConfig(): VersioningsConfig {
  return {
    git: {
      platform: 'github',
      url: 'https://github.com/test/repo.git',
      branchType: { version: 'version' },
      pr: { target: 'master' },
      limits: { branchMaxCommentLength: 96 },
      remote: 'origin',
      commit: {
        message: {
          semver: {
            prepatch: 'Patch version is preparing now: v%s.',
            patch: 'Patch: v%s. You SHOULD consider changes.',
            preminor: 'Minor version is preparing now: v%s.',
            minor: 'Minor: v%s. You MUST consider changes.',
            premajor: 'Release is preparing now: v%s.',
            major: 'Release: v%s.',
            prerelease: 'Preparing: v%s.',
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
        versionConfigDoesNotExist: 'Version configuration DOES NOT exist.',
        undefinedGitRepositoryUrl: 'Git repository URL is undefined.',
        unavailableVersioningDirectory: 'Get back to the root directory.',
        unavailableSemanticVersion: 'Semantic version is unavailable.',
        undefinedVersionBranchName: 'Version branch name is undefined.',
        incorrectVersionBranchNameLength: 'Branch name too long, max',
        incorrectVersionBranchNameCharactersDashes: 'Branch name MUST NOT contain multi dashes.',
        versionBranchAlreadyExists: 'Version branch already exists.',
        untrackedGitFiles: 'You have untracked git files.',
        unavailableGitPlatform: 'Git platform is unavailable.',
        unavailableGitTargetBranch: 'Git target branch is unavailable.',
        versionAlreadyExists: 'Version number already exists.',
        versionAlreadyExistsTag: 'Version already exists (tag).',
        versionAlreadyExistsBranch: 'Version already exists (branch).',
        incorrectGitRemote: 'Git remote is unavailable.',
      },
    },
    logLevel: 'debug',
    lockTimeoutMs: 300000,
  };
}

function createSilentLogger() {
  const stream = new PassThrough();
  stream.on('data', () => { /* discard */ });
  return createStructuredLogger({
    output: stream,
    level: 'debug',
    operationId: generateOperationId(),
    ci: false,
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Integration: Lock workflow', () => {
  test('lock acquire creates .versionings/lock, release removes it after pipeline', async () => {
    const projectDir = createTempProject('1.0.0');
    process.chdir(projectDir);

    const lockDir = path.join(projectDir, '.versionings');
    const lockFilePath = path.join(lockDir, 'lock');
    const operationId = generateOperationId();
    const logger = createSilentLogger();

    const lockManager = createLockManager({
      lockDir,
      lockTimeoutMs: 300000,
      ci: false,
      hostname: 'test-host',
      logger,
    });

    const executor = createMockExecutor();
    const rollbackManager = createRollbackManager(executor, logger);

    const result = await runPipeline(
      {
        semver: 'patch',
        branch: 'fix-lock-test',
        push: false,
        dryRun: false,
        json: false,
        verbose: false,
      },
      {
        executor,
        config: createTestConfig(),
        rollbackManager,
        artifactChecker: createMockArtifactChecker(),
        logger,
        actionTracer: createActionTracer(),
        lockManager,
        operationId,
      },
    ) as PipelineResult;

    expect(result.success).toBe(true);
    expect(result.version).toBe('1.0.1');

    // After pipeline completes, lock file should be removed (release in finally)
    expect(fs.existsSync(lockFilePath)).toBe(false);

    // Lock directory should still exist (only the lock file is removed)
    expect(fs.existsSync(lockDir)).toBe(true);
  }, 15000);

  test('dry-run pipeline does NOT create lock file', async () => {
    const projectDir = createTempProject('1.0.0');
    process.chdir(projectDir);

    const lockDir = path.join(projectDir, '.versionings');
    const lockFilePath = path.join(lockDir, 'lock');
    const operationId = generateOperationId();
    const logger = createSilentLogger();

    const lockManager = createLockManager({
      lockDir,
      lockTimeoutMs: 300000,
      ci: false,
      hostname: 'test-host',
      logger,
    });

    const executor = createMockExecutor();
    const rollbackManager = createRollbackManager(executor, logger);

    const result = await runPipeline(
      {
        semver: 'patch',
        branch: 'fix-dryrun',
        push: false,
        dryRun: true,
        json: false,
        verbose: false,
      },
      {
        executor,
        config: createTestConfig(),
        rollbackManager,
        artifactChecker: createMockArtifactChecker(),
        logger,
        actionTracer: createActionTracer(),
        lockManager,
        operationId,
      },
    );

    expect((result as any).dryRun).toBe(true);

    // Lock file should NOT exist — dry-run skips lock acquisition
    expect(fs.existsSync(lockFilePath)).toBe(false);
  }, 15000);

  test('parallel lock conflict: second acquire throws VersioningsError(COMMAND_FAILED)', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versionings-lock-conflict-'));
    tempDirs.push(tempDir);

    const lockDir = path.join(tempDir, '.versionings');
    const lockFilePath = path.join(lockDir, 'lock');
    const logger = createSilentLogger();

    // First lock manager acquires the lock
    const lm1 = createLockManager({
      lockDir,
      lockTimeoutMs: 300000,
      ci: false,
      hostname: 'host-1',
      logger,
    });
    lm1.acquire(generateOperationId(), 'release');

    // Verify lock file was created
    expect(fs.existsSync(lockFilePath)).toBe(true);

    // Verify lock file contains valid JSON with expected fields
    const lockContent = JSON.parse(fs.readFileSync(lockFilePath, 'utf-8')) as LockData;
    expect(lockContent.pid).toBe(process.pid);
    expect(lockContent.command).toBe('release');
    expect(lockContent.hostname).toBe('host-1');
    expect(typeof lockContent.operationId).toBe('string');
    expect(typeof lockContent.createdAt).toBe('string');

    // Second lock manager tries to acquire — should fail
    const lm2 = createLockManager({
      lockDir,
      lockTimeoutMs: 300000,
      ci: false,
      hostname: 'host-2',
      logger,
    });

    try {
      lm2.acquire(generateOperationId(), 'release');
      fail('Expected VersioningsError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect((err as VersioningsError).code).toBe(EXIT_CODES.COMMAND_FAILED);
    }

    // Clean up: release the first lock
    lm1.release();
    expect(fs.existsSync(lockFilePath)).toBe(false);
  });

  test('stale lock (dead PID) is automatically cleaned up on acquire', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versionings-lock-stale-pid-'));
    tempDirs.push(tempDir);

    const lockDir = path.join(tempDir, '.versionings');
    fs.mkdirSync(lockDir, { recursive: true });

    // Write a lock file with a dead PID (use processInfo DI to simulate)
    const staleLockData: LockData = {
      pid: 999888777,
      operationId: generateOperationId(),
      command: 'release',
      createdAt: new Date().toISOString(),
      hostname: 'old-host',
      ci: false,
    };
    const lockFilePath = path.join(lockDir, 'lock');
    fs.writeFileSync(lockFilePath, JSON.stringify(staleLockData, null, 2), 'utf-8');
    expect(fs.existsSync(lockFilePath)).toBe(true);

    const logger = createSilentLogger();

    // Create lock manager with processInfo that reports the stale PID as dead
    const lm = createLockManager({
      lockDir,
      lockTimeoutMs: 300000,
      ci: false,
      hostname: 'new-host',
      logger,
      processInfo: {
        pid: process.pid,
        kill: (pid: number, signal: number) => {
          if (pid === staleLockData.pid) {
            const err = new Error('ESRCH') as NodeJS.ErrnoException;
            err.code = 'ESRCH';
            throw err;
          }
          return process.kill(pid, signal);
        },
        on: (event: string, handler: () => void) => { process.on(event, handler); },
      },
    });

    // Acquire should succeed — stale lock is cleaned up
    expect(() => lm.acquire(generateOperationId(), 'release')).not.toThrow();

    // New lock file should exist with our PID
    expect(fs.existsSync(lockFilePath)).toBe(true);
    const newLock = JSON.parse(fs.readFileSync(lockFilePath, 'utf-8')) as LockData;
    expect(newLock.pid).toBe(process.pid);
    expect(newLock.hostname).toBe('new-host');

    // Clean up
    lm.release();
  });

  test('stale lock (timeout exceeded) is automatically cleaned up on acquire', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versionings-lock-stale-timeout-'));
    tempDirs.push(tempDir);

    const lockDir = path.join(tempDir, '.versionings');
    fs.mkdirSync(lockDir, { recursive: true });

    const lockTimeoutMs = 5000; // 5 seconds

    // Write a lock file with a timestamp well past the timeout
    const staleLockData: LockData = {
      pid: process.pid, // PID is alive, but timeout exceeded
      operationId: generateOperationId(),
      command: 'release',
      createdAt: new Date(Date.now() - lockTimeoutMs - 10000).toISOString(), // 15 seconds ago
      hostname: 'old-host',
      ci: false,
    };
    const lockFilePath = path.join(lockDir, 'lock');
    fs.writeFileSync(lockFilePath, JSON.stringify(staleLockData, null, 2), 'utf-8');
    expect(fs.existsSync(lockFilePath)).toBe(true);

    const logger = createSilentLogger();

    const lm = createLockManager({
      lockDir,
      lockTimeoutMs,
      ci: false,
      hostname: 'new-host',
      logger,
    });

    // Acquire should succeed — stale lock (timeout) is cleaned up
    expect(() => lm.acquire(generateOperationId(), 'release')).not.toThrow();

    // New lock file should exist
    expect(fs.existsSync(lockFilePath)).toBe(true);
    const newLock = JSON.parse(fs.readFileSync(lockFilePath, 'utf-8')) as LockData;
    expect(newLock.hostname).toBe('new-host');

    // Clean up
    lm.release();
  });
});
