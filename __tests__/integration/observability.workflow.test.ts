// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * Integration tests: Observability workflow — structured logger, action tracer, audit entry v2.
 *
 * Tests the full release pipeline with all observability dependencies wired in:
 * - Structured Logger writing JSON to a PassThrough stream (captures stderr output)
 * - Action Tracer recording step timings
 * - Operation Log saving AuditEntry (schemaVersion: 2)
 * - Reporter JSON output including operationId and totalDurationMs
 *
 * Uses a mock executor (no real git commands) but real structured logger,
 * action tracer, and operation log.
 *
 * Validates: Requirements 1.1, 2.2, 2.4, 3.5, 4.1, 4.5, 5.1, 14.1, 14.2
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PassThrough } from 'stream';
import { runPipeline } from '../../src/core/pipeline';
import { createStructuredLogger, generateOperationId } from '../../src/core/structured.logger';
import { createActionTracer } from '../../src/core/action.tracer';
import { createOperationLog } from '../../src/core/operation.log';
import { createReporter } from '../../src/core/reporter';
import { createRollbackManager } from '../../src/core/rollback';
import type { Executor, ExecutorResult } from '../../src/core/executor';
import type { ArtifactChecker } from '../../src/core/artifact.checker';
import type { VersioningsConfig } from '../../src/config/config.validator';
import type { PipelineResult } from '../../src/core/reporter';
import type { ActorMetadata } from '../../src/core/actor.resolver';
import type { AuditEntry } from '../../src/core/operation.log';

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

/**
 * Create a temp directory with a package.json for the pipeline to read.
 */
function createTempProject(version: string = '1.0.0'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'versionings-obs-'));
  tempDirs.push(dir);
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'test-project', version }, null, 2) + '\n',
  );
  return dir;
}

/**
 * Create a mock executor that simulates git commands for a successful release.
 */
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
      // npm version probe — return the bumped version
      if (cmd.startsWith('npm --no-git-tag-version version')) {
        return { stdout: 'v1.0.1', lines: ['v1.0.1'] };
      }
      // git checkout to restore package.json after probe
      if (cmd.startsWith('git checkout --')) {
        return { stdout: '', lines: [] };
      }
      // git checkout -b (branch creation)
      if (cmd.startsWith('git checkout -b')) {
        return { stdout: '', lines: [] };
      }
      // git tag --annotate
      if (cmd.startsWith('git tag --annotate')) {
        return { stdout: '', lines: [] };
      }
      // git commit
      if (cmd.startsWith('git commit')) {
        return { stdout: '', lines: [] };
      }
      // Known responses
      for (const [pattern, response] of Object.entries(responses)) {
        if (cmd === pattern) {
          const trimmed = response.trim();
          const lines = trimmed ? trimmed.split(/\r?\n/).filter(Boolean) : [];
          return { stdout: trimmed, lines };
        }
      }
      // Default: return empty for unknown commands
      return { stdout: '', lines: [] };
    },
  };
}

/**
 * Create a mock artifact checker that always passes.
 */
function createMockArtifactChecker(): ArtifactChecker {
  return {
    async checkUniqueness(): Promise<void> {
      // Always passes
    },
  };
}

/**
 * Create a minimal VersioningsConfig for testing.
 */
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

/**
 * Collect all data written to a PassThrough stream as a string.
 */
function captureStream(stream: PassThrough): () => string {
  let data = '';
  stream.on('data', (chunk: Buffer) => { data += chunk.toString(); });
  return () => data;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Integration: Observability workflow', () => {
  test('full release pipeline with structured logger, action tracer, and audit entry v2', async () => {
    // --- Setup temp project directory ---
    const projectDir = createTempProject('1.0.0');
    process.chdir(projectDir);

    // --- Create real observability dependencies ---
    const operationId = generateOperationId();
    const actor: ActorMetadata = {
      gitUserName: 'Test User',
      gitUserEmail: 'test@example.com',
      hostname: 'test-host',
      ciActor: null,
    };

    // Structured logger writing to a PassThrough stream
    const logStream = new PassThrough();
    const getLogOutput = captureStream(logStream);
    const logger = createStructuredLogger({
      output: logStream,
      level: 'debug',
      operationId,
      actor: actor.gitUserName,
      ci: false,
    });

    // Real action tracer
    const actionTracer = createActionTracer();

    // Real operation log in a temp directory
    const opLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versionings-oplog-'));
    tempDirs.push(opLogDir);
    const operationLog = createOperationLog(opLogDir);

    // Mock executor and artifact checker
    const executor = createMockExecutor();
    const artifactChecker = createMockArtifactChecker();
    const rollbackManager = createRollbackManager(executor, logger);

    // --- Run pipeline ---
    const result = await runPipeline(
      {
        semver: 'patch',
        branch: 'fix-obs',
        push: false,
        dryRun: false,
        json: false,
        verbose: true,
      },
      {
        executor,
        config: createTestConfig(),
        rollbackManager,
        artifactChecker,
        operationLog,
        logger,
        actionTracer,
        operationId,
        actor,
      },
    ) as PipelineResult;

    // --- Verify pipeline result ---
    expect(result.success).toBe(true);
    expect(result.version).toBe('1.0.1');

    // --- Verify structured logs in stderr contain operationId, actor, timestamps ---
    const logOutput = getLogOutput();
    const logLines = logOutput.trim().split('\n').filter(Boolean);
    expect(logLines.length).toBeGreaterThan(0);

    for (const line of logLines) {
      const entry = JSON.parse(line);
      expect(entry.operationId).toBe(operationId);
      expect(entry.timestamp).toBeDefined();
      // Verify timestamp is valid ISO 8601
      expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
      expect(entry.level).toBeDefined();
      expect(['debug', 'info', 'warn', 'error']).toContain(entry.level);
      expect(entry.message).toBeDefined();
      // Actor should be present on info-level and above entries
      if (['info', 'warn', 'error'].includes(entry.level)) {
        expect(entry.actor).toBe('Test User');
      }
    }

    // Verify at least some info-level step logs exist
    const infoLogs = logLines
      .map((l: string) => JSON.parse(l))
      .filter((e: any) => e.level === 'info');
    expect(infoLogs.length).toBeGreaterThan(0);
    // At least one log should mention a step
    const stepLogs = infoLogs.filter((e: any) =>
      e.message.includes('Step started') || e.message.includes('step'),
    );
    expect(stepLogs.length).toBeGreaterThan(0);

    // --- Verify audit entry saved with schemaVersion: 2 ---
    const savedEntry = await operationLog.loadLast() as unknown as AuditEntry;
    expect(savedEntry).not.toBeNull();
    expect(savedEntry.schemaVersion).toBe(2);
    expect(savedEntry.operationId).toBe(operationId);
    expect(savedEntry.result).toBe('success');
    expect(savedEntry.version).toBe('1.0.1');
    expect(savedEntry.previousVersion).toBe('1.0.0');

    // Actor metadata
    expect(savedEntry.actor).toEqual({
      gitUserName: 'Test User',
      gitUserEmail: 'test@example.com',
      hostname: 'test-host',
      ciActor: null,
    });

    // Environment
    expect(savedEntry.environment).not.toBeNull();
    expect(savedEntry.environment!.nodeVersion).toBe(process.version);
    expect(savedEntry.environment!.os).toBeDefined();
    expect(typeof savedEntry.environment!.ci).toBe('boolean');

    // Command
    expect(savedEntry.command).toBeDefined();

    // --- Verify trace array has entries for pipeline steps ---
    expect(Array.isArray(savedEntry.trace)).toBe(true);
    expect(savedEntry.trace.length).toBeGreaterThan(0);

    // Each trace entry should have required fields
    for (const traceEntry of savedEntry.trace) {
      expect(traceEntry.step).toBeDefined();
      expect(typeof traceEntry.step).toBe('string');
      expect(traceEntry.startedAt).toBeDefined();
      expect(new Date(traceEntry.startedAt).toISOString()).toBe(traceEntry.startedAt);
      expect(traceEntry.endedAt).toBeDefined();
      expect(new Date(traceEntry.endedAt).toISOString()).toBe(traceEntry.endedAt);
      expect(typeof traceEntry.durationMs).toBe('number');
      expect(traceEntry.durationMs).toBeGreaterThanOrEqual(0);
      expect(['success', 'failed', 'skipped']).toContain(traceEntry.status);
    }

    // Verify expected pipeline steps are traced
    const tracedSteps = savedEntry.trace.map((t: any) => t.step);
    expect(tracedSteps).toContain('validate-input');
    expect(tracedSteps).toContain('check-git-status');
    expect(tracedSteps).toContain('check-remote');
    expect(tracedSteps).toContain('compute-version');
    expect(tracedSteps).toContain('artifact-check');
    expect(tracedSteps).toContain('npm-version-bump');
    expect(tracedSteps).toContain('branch-create');
    expect(tracedSteps).toContain('tag-create');
    expect(tracedSteps).toContain('commit');

    // All steps should be successful
    for (const traceEntry of savedEntry.trace) {
      expect(traceEntry.status).toBe('success');
    }

    // --- Verify reporter JSON includes operationId and totalDurationMs ---
    const reporter = createReporter({ json: true });
    const totalDurationMs = actionTracer.getTotalDurationMs();
    const reporterOutput = reporter.reportSuccess({
      ...result,
      operationId,
      totalDurationMs,
    });

    const reporterJson = JSON.parse(reporterOutput);
    expect(reporterJson.operationId).toBe(operationId);
    expect(typeof reporterJson.totalDurationMs).toBe('number');
    expect(reporterJson.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(reporterJson.success).toBe(true);
    expect(reporterJson.version).toBe('1.0.1');
  }, 30000);
});
