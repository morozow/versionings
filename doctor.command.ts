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

  // 6. SCM API availability (only when auth token is available)
  try {
    const loadResult = deps.configLoader({ cwd: deps.cwd, env: deps.env });
    const scmCheck = await checkScmApi(
      loadResult.config as Record<string, any>,
      deps.env,
      deps.httpClient,
    );
    if (scmCheck) checks.push(scmCheck);
  } catch (_) {
    // Config load failed — skip SCM API check (config check already reported the error)
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
