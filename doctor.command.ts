// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import * as fs from 'fs';
import * as path from 'path';

import { loadConfig } from './config.loader';
import { Executor } from './executor';
import { Reporter, DoctorCheck } from './reporter';
import { ConfigProvenance } from './config.merger';
import { VersioningsError, EXIT_CODES } from './errors';
import { resolveAuth } from './auth.resolver';
import { createHttpClient } from './http.client';
import { parseCommit } from './commit.parser';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface DoctorCommandDeps {
  configLoader: typeof loadConfig;
  executor: Executor;
  reporter: Reporter;
  cwd: string;
  env: Record<string, string | undefined>;
  stdout: NodeJS.WritableStream;
  existsSync?: (p: string) => boolean;
  /** DI: override for process.version (testability) */
  nodeVersion?: string;
  /** DI: override for HTTP client (testability) */
  httpClient?: { get(url: string, headers?: Record<string, string>): Promise<{ status: number }> };
}

export interface DoctorResult {
  checks: DoctorCheck[];
  provenance: ConfigProvenance;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_NODE_MAJOR = 18;

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

function checkNodeVersion(nodeVersion: string): DoctorCheck {
  const raw = nodeVersion.replace(/^v/, '');
  const major = parseInt(raw.split('.')[0], 10);

  if (isNaN(major)) {
    return {
      name: 'node_version',
      status: 'fail',
      found: nodeVersion,
      expected: `>= ${MIN_NODE_MAJOR}.0.0`,
    };
  }

  if (major < MIN_NODE_MAJOR) {
    return {
      name: 'node_version',
      status: 'fail',
      found: nodeVersion,
      expected: `>= ${MIN_NODE_MAJOR}.0.0`,
    };
  }

  return {
    name: 'node_version',
    status: 'pass',
    found: nodeVersion,
    expected: `>= ${MIN_NODE_MAJOR}.0.0`,
  };
}

async function checkGitVersion(executor: Executor): Promise<DoctorCheck> {
  try {
    const result = await executor.run('git --version');
    const version = result.stdout.replace(/^git version\s*/, '').trim();
    return {
      name: 'git_version',
      status: 'pass',
      found: version,
    };
  } catch {
    return {
      name: 'git_version',
      status: 'fail',
      found: 'not found',
      expected: 'git installed',
    };
  }
}

function checkConfigValidity(
  deps: DoctorCommandDeps,
): { check: DoctorCheck; provenance: ConfigProvenance } {
  try {
    const loadResult = deps.configLoader({
      cwd: deps.cwd,
      env: deps.env,
    });

    // Check if any user-provided source exists
    const userSources = loadResult.sources.filter((s) => s.name !== 'defaults');
    if (userSources.length === 0) {
      return {
        check: {
          name: 'config',
          status: 'warn',
          found: 'defaults only (no user configuration)',
        },
        provenance: loadResult.provenance,
      };
    }

    const sourceNames = userSources.map((s) => s.name).join(', ');
    return {
      check: {
        name: 'config',
        status: 'pass',
        found: `valid (sources: ${sourceNames})`,
      },
      provenance: loadResult.provenance,
    };
  } catch (err: any) {
    const details = err instanceof VersioningsError
      ? err.message
      : `Failed to load configuration: ${String(err.message || err)}`;
    return {
      check: {
        name: 'config',
        status: 'fail',
        found: details,
        expected: 'valid configuration',
      },
      provenance: {},
    };
  }
}

async function checkGitRemote(executor: Executor): Promise<DoctorCheck> {
  try {
    const result = await executor.run('git remote get-url origin');
    return {
      name: 'git_remote',
      status: 'pass',
      found: result.stdout.trim(),
    };
  } catch {
    return {
      name: 'git_remote',
      status: 'warn',
      found: 'not accessible',
      expected: 'git remote "origin" configured',
    };
  }
}

function checkPackageJson(
  cwd: string,
  exists: (p: string) => boolean,
): DoctorCheck {
  const filePath = path.join(cwd, 'package.json');
  if (exists(filePath)) {
    return {
      name: 'package_json',
      status: 'pass',
      found: filePath,
    };
  }
  return {
    name: 'package_json',
    status: 'warn',
    found: 'not found',
    expected: 'package.json in project root',
  };
}

// ---------------------------------------------------------------------------
// Branching strategy check
// ---------------------------------------------------------------------------

async function checkBranchingStrategy(
  executor: Executor,
  config: Record<string, any>,
): Promise<DoctorCheck | null> {
  const branching = config?.git?.branching;
  const strategy = branching?.strategy || 'default';

  if (strategy === 'default') return null; // No branch constraints for default strategy

  let currentBranch: string;
  try {
    const result = await executor.run('git rev-parse --abbrev-ref HEAD');
    currentBranch = result.stdout.trim();
  } catch {
    return {
      name: 'branching_strategy',
      status: 'warn',
      found: 'cannot determine current branch',
      expected: `branch matching "${strategy}" strategy`,
    };
  }

  const mainBranch = branching?.mainBranch || 'master';
  const developBranch = branching?.developBranch || 'develop';

  // Check if current branch is appropriate for the strategy
  switch (strategy) {
    case 'trunk-based':
    case 'hotfix':
      if (currentBranch === mainBranch || currentBranch === 'main') {
        return { name: 'branching_strategy', status: 'pass', found: `${currentBranch} (strategy: ${strategy})` };
      }
      return { name: 'branching_strategy', status: 'warn', found: `${currentBranch} (strategy: ${strategy})`, expected: `${mainBranch} or main` };

    case 'git-flow':
      if (currentBranch === developBranch || currentBranch === mainBranch || currentBranch === 'main') {
        return { name: 'branching_strategy', status: 'pass', found: `${currentBranch} (strategy: ${strategy})` };
      }
      return { name: 'branching_strategy', status: 'warn', found: `${currentBranch} (strategy: ${strategy})`, expected: `${developBranch} or ${mainBranch}` };

    default:
      return { name: 'branching_strategy', status: 'pass', found: `${currentBranch} (strategy: ${strategy})` };
  }
}

// ---------------------------------------------------------------------------
// SCM API availability check
// ---------------------------------------------------------------------------

const DEFAULT_API_URLS: Record<string, string> = {
  'github': 'https://api.github.com',
  'github-enterprise': '',
  'gitlab': 'https://gitlab.com',
  'bitbucket': 'https://api.bitbucket.org',
  'bitbucket-server': '',
  'azure-devops': 'https://dev.azure.com',
};

async function checkScmApi(
  config: Record<string, any>,
  env: Record<string, string | undefined>,
  httpClient?: { get(url: string, headers?: Record<string, string>): Promise<{ status: number }> },
): Promise<DoctorCheck | null> {
  const platform: string = config?.git?.platform || '';
  if (!platform) return null;

  const auth = resolveAuth({ config, env }, platform);
  if (!auth.token) return null;

  const apiUrl = config?.git?.apiUrl || DEFAULT_API_URLS[platform] || '';
  if (!apiUrl) {
    return {
      name: 'scm_api',
      status: 'warn',
      found: `no API URL for platform "${platform}"`,
      expected: 'git.apiUrl configured for self-hosted platforms',
    };
  }

  const client = httpClient ?? createHttpClient();

  try {
    const authHeader = auth.method === 'bearer'
      ? `Bearer ${auth.token}`
      : `token ${auth.token}`;
    const response = await client.get(apiUrl, { Authorization: authHeader });
    return {
      name: 'scm_api',
      status: 'pass',
      found: `${apiUrl} (HTTP ${response.status})`,
    };
  } catch (err: any) {
    const message = err instanceof VersioningsError ? err.message : String(err.message || err);
    return {
      name: 'scm_api',
      status: 'fail',
      found: `${apiUrl} — ${message}`,
      expected: 'SCM API endpoint accessible',
    };
  }
}

// ---------------------------------------------------------------------------
// Conventional Commits history check
// ---------------------------------------------------------------------------

async function checkConventionalCommits(executor: Executor): Promise<DoctorCheck> {
  try {
    const result = await executor.run('git log -10 --format=%s');
    const subjects = result.stdout.split('\n').filter((l) => l.trim() !== '');

    if (subjects.length === 0) {
      return {
        name: 'conventional_commits',
        status: 'warn',
        found: 'no commits found',
        expected: 'commits following Conventional Commits format',
      };
    }

    let ccCount = 0;
    for (const subject of subjects) {
      const parsed = parseCommit(subject);
      if (parsed.valid) {
        ccCount++;
      }
    }

    if (ccCount === 0) {
      return {
        name: 'conventional_commits',
        status: 'warn',
        found: `0/${subjects.length} recent commits match Conventional Commits format`,
        expected: 'at least one commit in Conventional Commits format',
      };
    }

    return {
      name: 'conventional_commits',
      status: 'pass',
      found: `${ccCount}/${subjects.length} recent commits match Conventional Commits format`,
    };
  } catch {
    return {
      name: 'conventional_commits',
      status: 'warn',
      found: 'unable to read commit history',
      expected: 'git log accessible',
    };
  }
}

// ---------------------------------------------------------------------------
// Conventional Commits & Changelog config check
// ---------------------------------------------------------------------------

function checkCCConfig(config: Record<string, any>): DoctorCheck {
  const cc = config?.conventionalCommits;
  const cl = config?.changelog;

  const parts: string[] = [];

  if (cc) {
    const enabled = cc.enabled !== false ? 'enabled' : 'disabled';
    parts.push(`conventionalCommits: ${enabled}`);
    if (cc.fallbackBump !== undefined && cc.fallbackBump !== null) {
      parts.push(`fallbackBump: ${cc.fallbackBump}`);
    }
  } else {
    parts.push('conventionalCommits: not configured');
  }

  if (cl) {
    if (cl.file) {
      parts.push(`changelog.file: ${cl.file}`);
    }
    if (cl.excludeTypes && cl.excludeTypes.length > 0) {
      parts.push(`changelog.excludeTypes: ${cl.excludeTypes.join(', ')}`);
    }
  } else {
    parts.push('changelog: not configured');
  }

  const hasCc = !!cc;
  const hasCl = !!cl;

  if (!hasCc && !hasCl) {
    return {
      name: 'cc_config',
      status: 'warn',
      found: parts.join('; '),
      expected: 'conventionalCommits and/or changelog sections in configuration',
    };
  }

  return {
    name: 'cc_config',
    status: 'pass',
    found: parts.join('; '),
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Diagnoses the environment: Node.js version, Git, config, remote, package.json.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 15.3
 */
export async function runDoctorCommand(
  opts: { json: boolean },
  deps: DoctorCommandDeps,
): Promise<DoctorCheck[]> {
  const exists = deps.existsSync ?? fs.existsSync;
  const nodeVersion = deps.nodeVersion ?? process.version;
  const checks: DoctorCheck[] = [];

  // 1. Node.js version
  checks.push(checkNodeVersion(nodeVersion));

  // 2. Git version
  checks.push(await checkGitVersion(deps.executor));

  // 3. Config existence and validity (+ provenance)
  const { check: configCheck, provenance } = checkConfigValidity(deps);
  checks.push(configCheck);

  // 4. Git remote accessibility
  checks.push(await checkGitRemote(deps.executor));

  // 5. package.json presence
  checks.push(checkPackageJson(deps.cwd, exists));

  // 6. Conventional Commits history (runs independently of config)
  checks.push(await checkConventionalCommits(deps.executor));

  // 7. SCM API availability + 8. Branching strategy + 9. CC/Changelog config
  try {
    const loadResult = deps.configLoader({ cwd: deps.cwd, env: deps.env });
    const configObj = loadResult.config as Record<string, any>;

    // 7. SCM API availability (only when auth token is available)
    const scmCheck = await checkScmApi(
      configObj,
      deps.env,
      deps.httpClient,
    );
    if (scmCheck) checks.push(scmCheck);

    // 8. Branching strategy check
    const bsCheck = await checkBranchingStrategy(deps.executor, configObj);
    if (bsCheck) checks.push(bsCheck);

    // 9. Conventional Commits & Changelog config check
    checks.push(checkCCConfig(configObj));
  } catch (_) {
    // Config load failed — skip SCM API, branching, and CC config checks (config check already reported the error)
  }

  // Output via reporter
  const output = deps.reporter.reportDoctor(checks);
  deps.stdout.write(output + '\n');

  // If --json and provenance available, include provenance in diagnostics
  if (Object.keys(provenance).length > 0) {
    const provOutput = deps.reporter.reportProvenance(provenance);
    deps.stdout.write(provOutput + '\n');
  }

  return checks;
}
