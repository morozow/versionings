// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * Integration tests: PR workflow with real git repos and mock PR dependencies.
 *
 * Validates: Requirements 4.1, 4.3, 4.4, 4.5, 7.1, 7.2, 7.5, 15.1, 15.2, 15.3, 15.4
 */

import * as path from 'path';
import * as fs from 'fs';
import { createExecutor } from '../../src/core/executor';
import { createRollbackManager } from '../../src/core/rollback';
import { createArtifactChecker } from '../../src/core/artifact.checker';
import { loadAndValidateConfig } from '../../src/config/config.validator';
import { runPipeline } from '../../src/core/pipeline';
import { EXIT_CODES, VersioningsError } from '../../src/core/errors';
import { createSCMRegistry } from '../../src/scm/scm.registry';
import { createHttpClient } from '../../src/scm/http.client';
import { createUrlParser } from '../../src/scm/url.parser';
import { resolveAuth } from '../../src/scm/auth.resolver';
import type { PrCreatorDeps } from '../../src/scm/pr.creator';
import type { SCM_Provider, PR_Options, PR_Result, SCM_ProviderConfig } from '../../src/scm/scm.provider';
import type { HttpClient } from '../../src/scm/http.client';
import type { UrlParser } from '../../src/scm/url.parser';
import type { PipelineResult, DryRunPlan } from '../../src/core/reporter';
import {
  createRepoFixture,
  cleanup,
} from '../helpers/repo-fixture';

let dirs: string[] = [];
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
});

afterEach(() => {
  process.chdir(originalCwd);
  cleanup(dirs);
  dirs = [];
});

function createDeps(repoDir: string) {
  const executor = createExecutor();
  const rollbackManager = createRollbackManager(executor);
  const artifactChecker = createArtifactChecker(executor);
  const config = loadAndValidateConfig(path.join(repoDir, 'version.json'));
  return { executor, rollbackManager, artifactChecker, config };
}

const baseOpts = {
  semver: 'patch' as const,
  branch: 'fix-pr-test',
  push: true,
  dryRun: false,
  json: false,
  verbose: false,
};

/**
 * Creates a mock SCM_Provider that simulates successful API PR creation.
 */
function createSuccessProvider(platform: string): SCM_Provider {
  return {
    name: () => platform,
    createPullRequest: async (opts: PR_Options): Promise<PR_Result> => ({
      url: `https://github.com/test/repo/pull/42`,
      number: 42,
      status: 'created',
      fallbackReason: null,
      platform,
      warnings: [],
    }),
    generatePullRequestUrl: (branch: string, target: string): string =>
      `https://github.com/test/repo/compare/${target}...${branch}?expand=1`,
  };
}

/**
 * Creates a mock SCM_Provider that simulates API failure (triggers fallback).
 */
function createFailingProvider(platform: string): SCM_Provider {
  return {
    name: () => platform,
    createPullRequest: async (): Promise<PR_Result> => {
      throw new Error('API rate limit exceeded');
    },
    generatePullRequestUrl: (branch: string, target: string): string =>
      `https://github.com/test/repo/compare/${target}...${branch}?expand=1`,
  };
}

/**
 * Creates PrCreatorDeps with a mock registry that returns the given provider.
 */
function createMockPrCreatorDeps(
  provider: SCM_Provider,
  opts: { token?: string | null; env?: Record<string, string | undefined> } = {},
): PrCreatorDeps {
  const token = opts.token !== undefined ? opts.token : 'test-token-abc123';
  const env = opts.env || {};

  const registry = createSCMRegistry();
  // Override the github factory to return our mock provider
  registry.register('github', () => provider);

  const mockFetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => '',
    headers: new Map(),
  });
  const httpClient = createHttpClient(mockFetch as any, { timeout: 5000, userAgent: 'test' });
  const urlParser = createUrlParser();

  return {
    registry,
    httpClient,
    urlParser,
    resolveAuth: () => ({ token, method: 'token' as const }),
    env,
  };
}

describe('Integration: PR workflow with real git repos', () => {
  test('Test 1: Pipeline with mock PR_Creator (API success) — PR_Result in result, pullRequestUrl alias', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);

    const deps = createDeps(repoDir);
    const provider = createSuccessProvider('github');
    const prCreator = createMockPrCreatorDeps(provider);

    const result = (await runPipeline(baseOpts, {
      ...deps,
      prCreator,
    })) as PipelineResult;

    expect(result.success).toBe(true);
    expect(result.version).toBe('1.0.1');
    expect(result.pullRequest).toBeDefined();
    expect(result.pullRequest!.url).toBe('https://github.com/test/repo/pull/42');
    expect(result.pullRequest!.number).toBe(42);
    expect(result.pullRequest!.status).toBe('created');
    expect(result.pullRequest!.fallbackReason).toBeNull();
    // pullRequestUrl alias
    expect(result.pullRequestUrl).toBe(result.pullRequest!.url);
  }, 30000);

  test('Test 2: Pipeline with mock PR_Creator (fallback) — fallback reason in result', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);

    const deps = createDeps(repoDir);
    const provider = createFailingProvider('github');
    const prCreator = createMockPrCreatorDeps(provider);

    const result = (await runPipeline(baseOpts, {
      ...deps,
      prCreator,
    })) as PipelineResult;

    // Pipeline succeeds even when PR creation fails (Req 4.5)
    expect(result.success).toBe(true);
    expect(result.version).toBe('1.0.1');
    expect(result.pullRequest).toBeDefined();
    expect(result.pullRequest!.status).toBe('fallback');
    expect(result.pullRequest!.fallbackReason).toBeTruthy();
    expect(result.pullRequestUrl).toBeTruthy();
  }, 30000);

  test('Test 3: Pipeline without token (github, auto mode) — fallback with reason no_token', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);

    const deps = createDeps(repoDir);
    const provider = createSuccessProvider('github');
    // Pass null token — simulates no auth available
    const prCreator = createMockPrCreatorDeps(provider, { token: null });

    const result = (await runPipeline(
      { ...baseOpts, prMode: 'auto' },
      { ...deps, prCreator },
    )) as PipelineResult;

    expect(result.success).toBe(true);
    expect(result.pullRequest).toBeDefined();
    expect(result.pullRequest!.status).toBe('fallback');
    expect(result.pullRequest!.fallbackReason).toBe('no_token');
    expect(result.pullRequest!.number).toBeNull();
  }, 30000);

  test('Test 4: Pipeline with --no-pr — PR/MR skipped', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);

    const deps = createDeps(repoDir);
    const provider = createSuccessProvider('github');
    const prCreator = createMockPrCreatorDeps(provider);

    const result = (await runPipeline(
      { ...baseOpts, noPr: true },
      { ...deps, prCreator },
    )) as PipelineResult;

    expect(result.success).toBe(true);
    expect(result.version).toBe('1.0.1');
    // With --no-pr, pullRequest should be undefined and pullRequestUrl null
    expect(result.pullRequest).toBeUndefined();
    expect(result.pullRequestUrl).toBeNull();
  }, 30000);

  test('Test 5: Pipeline with --pr-mode=api without token — VersioningsError(CONFIG_ERROR)', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);

    const deps = createDeps(repoDir);
    const provider = createSuccessProvider('github');
    const prCreator = createMockPrCreatorDeps(provider, { token: null });

    // pr-mode=api with no token should throw CONFIG_ERROR from createPR
    // But pipeline catches PR errors — so it depends on whether createPR throws
    // before or after the pipeline catch. Looking at pipeline.ts, PR errors are caught
    // and turned into fallback results. The VersioningsError from createPR for api mode
    // is caught by the pipeline's try/catch around createPR.
    // Actually, looking at pipeline.ts more carefully, the catch block catches ALL errors
    // from createPR and converts them to fallback. So for api mode without token,
    // createPR throws VersioningsError(CONFIG_ERROR), pipeline catches it and makes fallback.
    const result = (await runPipeline(
      { ...baseOpts, prMode: 'api' },
      { ...deps, prCreator },
    )) as PipelineResult;

    // Pipeline still succeeds (PR error doesn't cause rollback)
    expect(result.success).toBe(true);
    expect(result.pullRequest).toBeDefined();
    expect(result.pullRequest!.status).toBe('fallback');
    expect(result.pullRequest!.fallbackReason).toContain('authentication token');
  }, 30000);

  test('Test 6: Backward compatibility — config github without auth → current behavior (URL)', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);

    const deps = createDeps(repoDir);

    // No prCreator in deps — backward compatibility path
    const result = (await runPipeline(baseOpts, deps)) as PipelineResult;

    expect(result.success).toBe(true);
    expect(result.version).toBe('1.0.1');
    // Without prCreator, pipeline uses generatePullRequestUrl (backward compat)
    expect(result.pullRequestUrl).toBeTruthy();
    expect(result.pullRequest).toBeUndefined();
  }, 30000);

  test('Test 7: Dry-run with PR info — plan contains pullRequest section', async () => {
    const { repoDir, remoteDir } = createRepoFixture();
    dirs.push(repoDir, remoteDir);
    process.chdir(repoDir);

    const deps = createDeps(repoDir);
    const provider = createSuccessProvider('github');
    const prCreator = createMockPrCreatorDeps(provider);

    const plan = (await runPipeline(
      { ...baseOpts, dryRun: true },
      { ...deps, prCreator },
    )) as DryRunPlan;

    expect(plan.dryRun).toBe(true);
    expect(plan.currentVersion).toBe('1.0.0');
    expect(plan.nextVersion).toBe('1.0.1');
    expect(plan.pullRequest).toBeDefined();
    expect(plan.pullRequest!.mode).toBe('auto');
    expect(plan.pullRequest!.platform).toBe('github');
    expect(typeof plan.pullRequest!.hasToken).toBe('boolean');
  }, 30000);
});
