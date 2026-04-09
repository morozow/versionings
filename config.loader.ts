// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import * as fs from 'fs';
import * as path from 'path';
import Ajv from 'ajv';

import { ConfigSource, ConfigProvenance, mergeConfigs } from './config.merger';
import { VersioningsConfig, schema } from './config.validator';
import { parseYaml } from './yaml.parser';
import { EXIT_CODES, VersioningsError } from './errors';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface ConfigLoaderDeps {
  cwd: string;
  env: Record<string, string | undefined>;
  cliOverrides?: Record<string, any>;
  strict?: boolean;
  /** DI: override for fs.existsSync (testability) */
  existsSync?: (p: string) => boolean;
  /** DI: override for fs.readFileSync (testability) */
  readFileSync?: (p: string, enc: BufferEncoding) => string;
}

export interface ConfigLoadResult {
  config: VersioningsConfig;
  sources: ConfigSource[];
  provenance: ConfigProvenance;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RC_FILE_NAMES: readonly string[] = [
  '.versioningsrc',
  '.versioningsrc.json',
  '.versioningsrc.yml',
  '.versioningsrc.yaml',
];

/**
 * Explicit mapping: env var name → dot-notation config path.
 * Only known variables are mapped; unknown VERSIONINGS_* are ignored
 * (or warned about in strict mode — handled by validator).
 */
const ENV_VAR_MAP: Record<string, string> = {
  VERSIONINGS_GIT_PLATFORM: 'git.platform',
  VERSIONINGS_GIT_URL: 'git.url',
  VERSIONINGS_GIT_PR_TARGET: 'git.pr.target',
  VERSIONINGS_GIT_REMOTE: 'git.remote',
  VERSIONINGS_GIT_BRANCH_TYPE_VERSION: 'git.branchType.version',
  VERSIONINGS_GIT_API_URL: 'git.apiUrl',
  VERSIONINGS_GIT_AUTH_TOKEN: 'git.auth.token',
  VERSIONINGS_GIT_API_TIMEOUT: 'git.api.timeout',
};

// ---------------------------------------------------------------------------
// Default config (reuses the shape from config.validator.ts)
// ---------------------------------------------------------------------------

const defaultConfig: Record<string, any> = {
  git: {
    platform: undefined,
    url: undefined,
    branchType: {
      version: 'version',
    },
    pr: {
      target: 'master',
    },
    limits: {
      branchMaxCommentLength: 96,
    },
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
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------


/**
 * Set a value at a dot-notation path inside a nested object.
 * Creates intermediate objects as needed.
 */
function setByPath(obj: Record<string, any>, dotPath: string, value: any): void {
  const parts = dotPath.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (current[key] == null || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }
  current[parts[parts.length - 1]] = value;
}

/**
 * Determine whether a file name is a YAML RC file.
 */
function isYamlRcFile(name: string): boolean {
  return name.endsWith('.yml') || name.endsWith('.yaml');
}

/**
 * Parse an RC file's content based on its extension.
 */
function parseRcContent(content: string, filePath: string, fileName: string): Record<string, any> {
  if (isYamlRcFile(fileName)) {
    return parseYaml(content, filePath);
  }
  // .versioningsrc (plain) and .versioningsrc.json are both JSON
  try {
    return JSON.parse(content);
  } catch (err: any) {
    throw new VersioningsError(
      EXIT_CODES.CONFIG_ERROR,
      `Invalid JSON in ${filePath}: ${err.message}`,
      { filePath, parseError: err.message },
    );
  }
}

// ---------------------------------------------------------------------------
// Source loaders
// ---------------------------------------------------------------------------

function loadDefaults(): ConfigSource {
  return { name: 'defaults', data: defaultConfig };
}

function loadVersionJson(
  cwd: string,
  exists: (p: string) => boolean,
  read: (p: string, enc: BufferEncoding) => string,
): ConfigSource | null {
  const filePath = path.join(cwd, 'version.json');
  if (!exists(filePath)) return null;

  let raw: string;
  try {
    raw = read(filePath, 'utf8');
  } catch (err: any) {
    throw new VersioningsError(
      EXIT_CODES.CONFIG_ERROR,
      `Cannot read configuration file: ${err.message}`,
      { expectedPath: filePath },
    );
  }

  let data: Record<string, any>;
  try {
    data = JSON.parse(raw);
  } catch (err: any) {
    throw new VersioningsError(
      EXIT_CODES.CONFIG_ERROR,
      `Invalid JSON in version.json: ${err.message}`,
      { filePath, parseError: err.message },
    );
  }

  return { name: 'version.json', data, filePath };
}

function loadRcFile(
  cwd: string,
  exists: (p: string) => boolean,
  read: (p: string, enc: BufferEncoding) => string,
  warnings: string[],
): ConfigSource | null {
  const found: string[] = [];
  for (const name of RC_FILE_NAMES) {
    const filePath = path.join(cwd, name);
    if (exists(filePath)) {
      found.push(name);
    }
  }

  if (found.length === 0) return null;

  if (found.length > 1) {
    warnings.push(
      `Multiple RC files found: ${found.join(', ')}. Using ${found[0]}, ignoring the rest.`,
    );
  }

  const chosen = found[0];
  const filePath = path.join(cwd, chosen);
  let raw: string;
  try {
    raw = read(filePath, 'utf8');
  } catch (err: any) {
    throw new VersioningsError(
      EXIT_CODES.CONFIG_ERROR,
      `Cannot read RC file: ${err.message}`,
      { filePath },
    );
  }

  const data = parseRcContent(raw, filePath, chosen);
  return { name: chosen, data, filePath };
}

function loadPackageJsonVersionings(
  cwd: string,
  exists: (p: string) => boolean,
  read: (p: string, enc: BufferEncoding) => string,
): ConfigSource | null {
  const filePath = path.join(cwd, 'package.json');
  if (!exists(filePath)) return null;

  let raw: string;
  try {
    raw = read(filePath, 'utf8');
  } catch {
    return null;
  }

  let pkg: Record<string, any>;
  try {
    pkg = JSON.parse(raw);
  } catch {
    return null; // package.json parse errors are not our concern
  }

  if (!pkg.versionings || typeof pkg.versionings !== 'object') return null;

  return { name: 'package.json#versionings', data: pkg.versionings, filePath };
}

function loadEnvVars(env: Record<string, string | undefined>): ConfigSource | null {
  const data: Record<string, any> = {};
  let hasAny = false;

  for (const [envName, configPath] of Object.entries(ENV_VAR_MAP)) {
    const value = env[envName];
    if (value !== undefined && value !== '') {
      setByPath(data, configPath, value);
      hasAny = true;
    }
  }

  if (!hasAny) return null;
  return { name: 'env', data };
}

function loadCliOverrides(overrides?: Record<string, any>): ConfigSource | null {
  if (!overrides || Object.keys(overrides).length === 0) return null;
  return { name: 'cli', data: overrides };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Loads configuration from all sources, merges, validates, and returns the result.
 *
 * Priority (lowest → highest):
 *   1. defaults
 *   2. version.json (legacy)
 *   3. RC-file (.versioningsrc, .versioningsrc.json, .versioningsrc.yml, .versioningsrc.yaml)
 *   4. package.json#versionings
 *   5. env (VERSIONINGS_*)
 *   6. CLI args
 */
export function loadConfig(deps: ConfigLoaderDeps): ConfigLoadResult {
  const exists = deps.existsSync ?? fs.existsSync;
  const read = deps.readFileSync ?? fs.readFileSync;
  const warnings: string[] = [];

  // 1. Collect sources
  const sources: ConfigSource[] = [];

  sources.push(loadDefaults());

  const versionJsonSrc = loadVersionJson(deps.cwd, exists, read);
  if (versionJsonSrc) sources.push(versionJsonSrc);

  const rcSrc = loadRcFile(deps.cwd, exists, read, warnings);
  if (rcSrc) sources.push(rcSrc);

  const pkgSrc = loadPackageJsonVersionings(deps.cwd, exists, read);
  if (pkgSrc) sources.push(pkgSrc);

  const envSrc = loadEnvVars(deps.env);
  if (envSrc) sources.push(envSrc);

  const cliSrc = loadCliOverrides(deps.cliOverrides);
  if (cliSrc) sources.push(cliSrc);

  // 2. Warn if no user-provided sources found (only defaults)
  if (sources.length === 1) {
    warnings.push(
      'No configuration sources found. Supported sources:\n' +
      '  - version.json\n' +
      '  - .versioningsrc / .versioningsrc.json / .versioningsrc.yml / .versioningsrc.yaml\n' +
      '  - package.json "versionings" section\n' +
      '  - Environment variables (VERSIONINGS_GIT_PLATFORM, VERSIONINGS_GIT_URL, ...)\n' +
      '\nMinimal example (version.json):\n' +
      '  {\n' +
      '    "git": {\n' +
      '      "platform": "github",\n' +
      '      "url": "https://github.com/org/repo.git"\n' +
      '    }\n' +
      '  }',
    );
  }

  // 3. Merge
  const { merged, provenance } = mergeConfigs(sources);

  // 4. Validate merged config against JSON Schema
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);
  const valid = validate(merged);

  if (!valid && validate.errors) {
    const errors = validate.errors.map((err) => ({
      path: err.instancePath || '/',
      message: err.message,
      params: err.params,
    }));
    throw new VersioningsError(
      EXIT_CODES.CONFIG_ERROR,
      'Configuration does not match schema.',
      { validationErrors: errors },
    );
  }

  return {
    config: merged as VersioningsConfig,
    sources,
    provenance,
    warnings,
  };
}
