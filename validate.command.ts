// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { loadConfig, ConfigLoadResult } from './config.loader';
import { Executor } from './executor';
import { Reporter, ValidateResult } from './reporter';
import { ConfigProvenance } from './config.merger';
import { VersioningsError, EXIT_CODES } from './errors';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface ValidateCommandDeps {
  configLoader: typeof loadConfig;
  executor: Executor;
  reporter: Reporter;
  cwd: string;
  env: Record<string, string | undefined>;
  stdout: NodeJS.WritableStream;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a git URL for comparison: strip trailing .git, trailing slash,
 * and lowercase the result.
 */
function normalizeUrl(url: string): string {
  return url
    .trim()
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

async function checkConfig(
  deps: ValidateCommandDeps,
  strict: boolean,
): Promise<{
  loadResult: ConfigLoadResult | null;
  checks: ValidateResult['checks'];
}> {
  const checks: ValidateResult['checks'] = [];
  let loadResult: ConfigLoadResult | null = null;

  try {
    loadResult = deps.configLoader({
      cwd: deps.cwd,
      env: deps.env,
      strict,
    });

    // Check if any user-provided source exists (not just defaults)
    const userSources = loadResult.sources.filter((s) => s.name !== 'defaults');
    if (userSources.length === 0) {
      checks.push({
        name: 'config_exists',
        status: 'warn',
        details: 'No user-provided configuration sources found. Using defaults only.',
      });
    } else {
      const sourceNames = userSources.map((s) => s.name).join(', ');
      checks.push({
        name: 'config_exists',
        status: 'pass',
        details: `Configuration loaded from: ${sourceNames}`,
      });
    }

    checks.push({
      name: 'config_valid',
      status: 'pass',
      details: 'Configuration passes schema validation.',
    });

    // Report warnings from loader (e.g. multiple RC files)
    for (const w of loadResult.warnings) {
      checks.push({
        name: 'config_warning',
        status: 'warn',
        details: w,
      });
    }
  } catch (err: any) {
    checks.push({
      name: 'config_exists',
      status: 'fail',
      details: err instanceof VersioningsError
        ? err.message
        : `Failed to load configuration: ${String(err.message || err)}`,
    });
  }

  return { loadResult, checks };
}

async function checkGitRepo(
  executor: Executor,
): Promise<{ accessible: boolean; check: ValidateResult['checks'][0] }> {
  try {
    await executor.run('git rev-parse --is-inside-work-tree');
    return {
      accessible: true,
      check: { name: 'git_repo', status: 'pass', details: 'Git repository is accessible.' },
    };
  } catch {
    return {
      accessible: false,
      check: { name: 'git_repo', status: 'fail', details: 'Not inside a git repository.' },
    };
  }
}

async function checkGitRemote(
  executor: Executor,
  configUrl: string | undefined,
): Promise<ValidateResult['checks'][0]> {
  if (!configUrl) {
    return {
      name: 'git_remote',
      status: 'warn',
      details: 'git.url is not configured. Cannot verify remote match.',
    };
  }

  try {
    const result = await executor.run('git remote get-url origin');
    const actualUrl = result.stdout.trim();

    if (normalizeUrl(actualUrl) === normalizeUrl(configUrl)) {
      return {
        name: 'git_remote',
        status: 'pass',
        details: `Git remote "origin" matches configured URL.`,
      };
    }

    return {
      name: 'git_remote',
      status: 'fail',
      details: `Git remote "origin" (${actualUrl}) does not match configured git.url (${configUrl}).`,
    };
  } catch {
    return {
      name: 'git_remote',
      status: 'warn',
      details: 'Cannot read git remote "origin". Remote may not be configured.',
    };
  }
}

function checkBranchingStrategy(
  config: any,
): ValidateResult['checks'][0] {
  const branching = config?.git?.branching;
  if (!branching || !branching.strategy || branching.strategy === 'default') {
    return {
      name: 'branching_strategy',
      status: 'pass',
      details: 'Branching strategy: default (backward compatible)',
    };
  }

  const validStrategies = ['default', 'trunk-based', 'git-flow', 'release-branch', 'hotfix', 'maintenance'];
  if (!validStrategies.includes(branching.strategy)) {
    return {
      name: 'branching_strategy',
      status: 'fail',
      details: `Unknown branching strategy: "${branching.strategy}". Available: ${validStrategies.join(', ')}`,
    };
  }

  const details: string[] = [`strategy: ${branching.strategy}`];
  if (branching.mainBranch) details.push(`mainBranch: ${branching.mainBranch}`);
  if (branching.developBranch) details.push(`developBranch: ${branching.developBranch}`);
  if (branching.branchTemplate) details.push(`branchTemplate: ${branching.branchTemplate}`);
  if (branching.tagTemplate) details.push(`tagTemplate: ${branching.tagTemplate}`);

  return {
    name: 'branching_strategy',
    status: 'pass',
    details: `Branching: ${details.join(', ')}`,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Validates configuration and environment without performing any mutations.
 *
 * Checks:
 *   1. Config existence and validity (via configLoader)
 *   2. Git repository accessibility
 *   3. Git remote URL match with config
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 15.2
 */
export async function runValidateCommand(
  opts: { json: boolean; strict?: boolean },
  deps: ValidateCommandDeps,
): Promise<ValidateResult> {
  const allChecks: ValidateResult['checks'] = [];
  let provenance: ConfigProvenance = {};

  // 1. Config checks
  const { loadResult, checks: configChecks } = await checkConfig(deps, opts.strict ?? false);
  allChecks.push(...configChecks);

  if (loadResult) {
    provenance = loadResult.provenance;
  }

  // 2. Git repo check
  const { accessible: gitAccessible, check: gitRepoCheck } = await checkGitRepo(deps.executor);
  allChecks.push(gitRepoCheck);

  // 3. Git remote check (only if git repo is accessible)
  if (gitAccessible) {
    const configUrl = loadResult?.config?.git?.url;
    const gitRemoteCheck = await checkGitRemote(deps.executor, configUrl);
    allChecks.push(gitRemoteCheck);
  } else {
    allChecks.push({
      name: 'git_remote',
      status: 'warn',
      details: 'Skipped: git repository is not accessible.',
    });
  }

  // 4. Branching strategy check
  if (loadResult) {
    allChecks.push(checkBranchingStrategy(loadResult.config));
  }

  // Build result
  const hasFail = allChecks.some((c) => c.status === 'fail');
  const result: ValidateResult = {
    valid: !hasFail,
    checks: allChecks,
    provenance,
  };

  // Output via reporter
  const output = deps.reporter.reportValidation(result);
  deps.stdout.write(output + '\n');

  return result;
}
