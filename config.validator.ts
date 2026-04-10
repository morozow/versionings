// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import * as fs from 'fs';
import Ajv from 'ajv';

import { EXIT_CODES, VersioningsError } from './errors';

const schema = require('./version.schema.json');

const AVAILABLE_GIT_PLATFORMS: string[] = ['github', 'github-enterprise', 'bitbucket', 'bitbucket-server', 'gitlab', 'azure-devops'];

interface GitPrConfig {
  target: string;
  reviewers?: string[];
  labels?: string[];
  draft?: boolean;
  template?: string;
  milestone?: string;
  linkedIssues?: string[];
}

interface GitAuthConfig {
  token?: string;
  method?: 'token' | 'bearer';
}

interface GitApiConfig {
  timeout?: number;
}

interface GitLimitsConfig {
  branchMaxCommentLength: number;
}

interface GitCommitSemverMessages {
  prepatch: string;
  patch: string;
  preminor: string;
  minor: string;
  premajor: string;
  major: string;
  prerelease: string;
}

interface GitCommitConfig {
  message: {
    semver: GitCommitSemverMessages;
  };
}

interface GitBranchTypeConfig {
  version: string;
}

export interface BranchingConfig {
  strategy: string;
  branchTemplate?: string;
  tagTemplate?: string;
  mainBranch: string;
  developBranch: string;
}

export type BumpLevel = 'major' | 'minor' | 'patch' | 'none';

export interface ConventionalCommitsConfig {
  enabled: boolean;
  types: Record<string, BumpLevel>;
  fallbackBump: 'patch' | 'minor' | 'major' | null;
}

export interface ChangelogConfig {
  template?: string;
  groupTitles: Record<string, string>;
  excludeTypes: string[];
  includeNonConventional: boolean;
  file?: string;
}

interface GitConfig {
  platform: string | undefined;
  url: string | undefined;
  apiUrl?: string;
  branchType: GitBranchTypeConfig;
  pr: GitPrConfig;
  limits: GitLimitsConfig;
  remote: string;
  commit: GitCommitConfig;
  auth?: GitAuthConfig;
  api?: GitApiConfig;
  project?: string;
  repo?: string;
  branching?: BranchingConfig;
}

interface PackageSemverConfig {
  patch: string;
  prepatch: string;
  minor: string;
  preminor: string;
  premajor: string;
  prerelease: string;
  major: string;
}

interface CommonMessages {
  versionConfigDoesNotExist: string;
  undefinedGitRepositoryUrl: string;
  unavailableVersioningDirectory: string;
  unavailableSemanticVersion: string;
  undefinedVersionBranchName: string;
  incorrectVersionBranchNameLength: string;
  incorrectVersionBranchNameCharactersDashes: string;
  versionBranchAlreadyExists: string;
  untrackedGitFiles: string;
  unavailableGitPlatform: string;
  unavailableGitTargetBranch: string;
  versionAlreadyExists: string;
  versionAlreadyExistsTag: string;
  versionAlreadyExistsBranch: string;
  incorrectGitRemote: string;
}

export interface VersioningsConfig {
  git: GitConfig;
  package: {
    semver: PackageSemverConfig;
  };
  common: {
    messages: CommonMessages;
  };
  conventionalCommits?: ConventionalCommitsConfig;
  changelog?: ChangelogConfig;
}

const DEFAULT_CONVENTIONAL_COMMITS_TYPES: Record<string, BumpLevel> = {
  feat: 'minor',
  fix: 'patch',
  perf: 'patch',
  revert: 'patch',
  chore: 'none',
  docs: 'none',
  style: 'none',
  refactor: 'none',
  test: 'none',
  build: 'none',
  ci: 'none',
};

const DEFAULT_GROUP_TITLES: Record<string, string> = {
  breaking: 'BREAKING CHANGES',
  feat: 'Features',
  fix: 'Bug Fixes',
  perf: 'Performance Improvements',
  revert: 'Reverts',
};

const defaultConfig: VersioningsConfig = {
  git: {
    platform: void 0,
    url: void 0,
    branchType: {
      version: 'version',
    },
    pr: {
      target: 'master',
    },
    limits: {
      branchMaxCommentLength: 96,
    },
    branching: {
      strategy: 'default',
      mainBranch: 'master',
      developBranch: 'develop',
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
  conventionalCommits: {
    enabled: true,
    types: { ...DEFAULT_CONVENTIONAL_COMMITS_TYPES },
    fallbackBump: null,
  },
  changelog: {
    groupTitles: { ...DEFAULT_GROUP_TITLES },
    excludeTypes: [],
    includeNonConventional: false,
  },
  package: {
    semver: {
      patch: 'patch',
      prepatch: 'prepatch',
      minor: 'minor',
      preminor: 'preminor',
      premajor: 'premajor',
      prerelease: 'prerelease',
      major: 'major',
    },
  },
  common: {
    messages: {
      versionConfigDoesNotExist: 'Version configuration DOES NOT exist. Define ./version.json file.',
      undefinedGitRepositoryUrl: 'Git repository URL is undefined. Define correct git.url in ./version.json file.',
      unavailableVersioningDirectory: 'Get back to the root directory that contains project package.json.',
      unavailableSemanticVersion: 'Semantic version is unavailable. Define correct --semver CLI parameter.',
      undefinedVersionBranchName: 'Version branch name is undefined. Define correct --branch CLI parameter.',
      incorrectVersionBranchNameLength: 'Correct --branch CLI parameter MUST have length less',
      incorrectVersionBranchNameCharactersDashes: 'Correct --branch CLI parameter MUST NOT contain multi dashes, "--".',
      versionBranchAlreadyExists: 'Version branch already exists.',
      untrackedGitFiles: 'You have untracked git files. Commit changes and try again.',
      unavailableGitPlatform: `Git platform is unavailable. Define correct git.platform in ./version.json file. Available platforms: ${AVAILABLE_GIT_PLATFORMS.join(', ')}.`,
      unavailableGitTargetBranch: 'Git target branch is unavailable. Define correct git.pr.target in ./version.json file.',
      versionAlreadyExists: 'Version number already exists.',
      versionAlreadyExistsTag: 'Version number already exists. Pay attention to git version tags.',
      versionAlreadyExistsBranch: 'Version number already exists. Pay attention to git version branches.',
      incorrectGitRemote: 'Git remote is unavailable. Define correct config git.url, local Git remote.',
    },
  },
};

/**
 * Loads, validates, and merges version.json configuration.
 *
 * @param configPath — path to version.json
 * @returns validated and merged config
 * @throws VersioningsError — EXIT_CODES.CONFIG_ERROR
 */
export function loadAndValidateConfig(configPath: string): VersioningsConfig {
  // 1. Check file existence
  if (!fs.existsSync(configPath)) {
    throw new VersioningsError(
      EXIT_CODES.CONFIG_ERROR,
      'Version configuration does not exist.',
      { expectedPath: configPath }
    );
  }

  // 2. Parse JSON
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (err: any) {
    throw new VersioningsError(
      EXIT_CODES.CONFIG_ERROR,
      `Cannot read configuration file: ${err.message}`,
      { expectedPath: configPath }
    );
  }

  let versionConfig: any;
  try {
    versionConfig = JSON.parse(raw);
  } catch (err: any) {
    const details: Record<string, any> = { parseError: err.message };
    if (typeof err.message === 'string') {
      const posMatch = err.message.match(/position\s+(\d+)/i);
      if (posMatch) {
        const position = Number(posMatch[1]);
        details.position = position;
        const prefix = raw.substring(0, position);
        details.line = prefix.split('\n').length;
      }
    }
    throw new VersioningsError(
      EXIT_CODES.CONFIG_ERROR,
      'Invalid JSON in configuration file.',
      details
    );
  }

  // 3. Validate against JSON Schema using ajv
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);
  const valid = validate(versionConfig);

  if (!valid) {
    const errors = validate.errors!.map((err) => ({
      path: err.instancePath || '/',
      message: err.message,
      params: err.params,
    }));
    throw new VersioningsError(
      EXIT_CODES.CONFIG_ERROR,
      'Configuration does not match schema.',
      { validationErrors: errors }
    );
  }

  // 4. Merge with defaultConfig and return
  const gitConfig = versionConfig.git || {};
  const prConfig = gitConfig.pr || {};
  const authConfig = gitConfig.auth || {};
  const apiConfig = gitConfig.api || {};
  const branchingConfig = gitConfig.branching || {};
  const ccConfig = versionConfig.conventionalCommits || {};
  const clConfig = versionConfig.changelog || {};

  const config: VersioningsConfig = {
    ...defaultConfig,
    git: {
      ...defaultConfig.git,
      url: gitConfig.url !== undefined ? gitConfig.url : defaultConfig.git.url,
      platform: gitConfig.platform !== undefined ? gitConfig.platform : defaultConfig.git.platform,
      apiUrl: gitConfig.apiUrl !== undefined ? gitConfig.apiUrl : undefined,
      pr: {
        ...defaultConfig.git.pr,
        target: prConfig.target !== undefined ? prConfig.target : defaultConfig.git.pr.target,
        ...(prConfig.reviewers !== undefined ? { reviewers: prConfig.reviewers } : {}),
        ...(prConfig.labels !== undefined ? { labels: prConfig.labels } : {}),
        ...(prConfig.draft !== undefined ? { draft: prConfig.draft } : {}),
        ...(prConfig.template !== undefined ? { template: prConfig.template } : {}),
        ...(prConfig.milestone !== undefined ? { milestone: prConfig.milestone } : {}),
        ...(prConfig.linkedIssues !== undefined ? { linkedIssues: prConfig.linkedIssues } : {}),
      },
      branching: {
        strategy: branchingConfig.strategy !== undefined ? branchingConfig.strategy : defaultConfig.git.branching!.strategy,
        mainBranch: branchingConfig.mainBranch !== undefined ? branchingConfig.mainBranch : defaultConfig.git.branching!.mainBranch,
        developBranch: branchingConfig.developBranch !== undefined ? branchingConfig.developBranch : defaultConfig.git.branching!.developBranch,
        ...(branchingConfig.branchTemplate !== undefined ? { branchTemplate: branchingConfig.branchTemplate } : {}),
        ...(branchingConfig.tagTemplate !== undefined ? { tagTemplate: branchingConfig.tagTemplate } : {}),
      },
      ...(Object.keys(authConfig).length > 0 ? { auth: authConfig } : {}),
      ...(Object.keys(apiConfig).length > 0 ? { api: apiConfig } : {}),
      ...(gitConfig.project !== undefined ? { project: gitConfig.project } : {}),
      ...(gitConfig.repo !== undefined ? { repo: gitConfig.repo } : {}),
    },
    conventionalCommits: {
      enabled: ccConfig.enabled !== undefined ? ccConfig.enabled : defaultConfig.conventionalCommits!.enabled,
      types: {
        ...defaultConfig.conventionalCommits!.types,
        ...(ccConfig.types || {}),
      },
      fallbackBump: ccConfig.fallbackBump !== undefined ? ccConfig.fallbackBump : defaultConfig.conventionalCommits!.fallbackBump,
    },
    changelog: {
      groupTitles: {
        ...defaultConfig.changelog!.groupTitles,
        ...(clConfig.groupTitles || {}),
      },
      excludeTypes: clConfig.excludeTypes !== undefined ? clConfig.excludeTypes : defaultConfig.changelog!.excludeTypes,
      includeNonConventional: clConfig.includeNonConventional !== undefined ? clConfig.includeNonConventional : defaultConfig.changelog!.includeNonConventional,
      ...(clConfig.template !== undefined ? { template: clConfig.template } : {}),
      ...(clConfig.file !== undefined ? { file: clConfig.file } : {}),
    },
  };

  return config;
}

// ---------------------------------------------------------------------------
// validateWithProvenance — strict / default mode validation with provenance
// ---------------------------------------------------------------------------

export interface ValidationWarning {
  path: string;
  message: string;
  source?: string;
}

export interface ValidationResult {
  valid: boolean;
  warnings: ValidationWarning[];
}

/**
 * Recursively clone a JSON Schema, setting `additionalProperties` to the
 * given value on every object-typed node that declares `properties`.
 */
function cloneSchemaWithAdditionalProps(
  node: Record<string, any>,
  additionalProperties: boolean,
): Record<string, any> {
  const clone: Record<string, any> = {};
  for (const key of Object.keys(node)) {
    const val = node[key];
    if (key === 'additionalProperties') {
      clone[key] = additionalProperties;
    } else if (key === 'properties' && typeof val === 'object' && val !== null) {
      // Recurse into each property definition
      const propsClone: Record<string, any> = {};
      for (const propName of Object.keys(val)) {
        propsClone[propName] = cloneSchemaWithAdditionalProps(val[propName], additionalProperties);
      }
      clone[key] = propsClone;
      // Ensure additionalProperties is set on this object node
      if (!('additionalProperties' in node)) {
        clone['additionalProperties'] = additionalProperties;
      }
    } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      clone[key] = cloneSchemaWithAdditionalProps(val, additionalProperties);
    } else {
      clone[key] = val;
    }
  }
  return clone;
}

/**
 * Collect all keys from a config object that are not declared in the schema.
 * Returns an array of dot-notation paths.
 */
function collectUnknownPaths(
  config: Record<string, any>,
  schemaNode: Record<string, any>,
  prefix: string,
): string[] {
  const unknown: string[] = [];
  const schemaProps = schemaNode.properties || {};

  for (const key of Object.keys(config)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (!(key in schemaProps)) {
      unknown.push(fullPath);
    } else {
      const val = config[key];
      const propSchema = schemaProps[key];
      if (
        val !== null &&
        typeof val === 'object' &&
        !Array.isArray(val) &&
        propSchema &&
        propSchema.type === 'object' &&
        propSchema.properties
      ) {
        unknown.push(...collectUnknownPaths(val, propSchema, fullPath));
      }
    }
  }

  return unknown;
}

/**
 * Look up the source of a field path in provenance.
 * Falls back to parent paths if exact path not found.
 */
function findSource(
  provenance: Record<string, { value: any; source: string }>,
  fieldPath: string,
): string {
  // Exact match
  if (provenance[fieldPath]) {
    return provenance[fieldPath].source;
  }
  // Walk up parent paths
  const parts = fieldPath.split('.');
  for (let i = parts.length - 1; i > 0; i--) {
    const parentPath = parts.slice(0, i).join('.');
    if (provenance[parentPath]) {
      return provenance[parentPath].source;
    }
  }
  return 'unknown';
}

/**
 * Format a schema constraint description for a given schema node.
 */
function describeExpected(schemaNode: Record<string, any> | undefined): string {
  if (!schemaNode) return 'not defined in schema';
  const parts: string[] = [];
  if (schemaNode.type) parts.push(`type: ${schemaNode.type}`);
  if (schemaNode.enum) parts.push(`enum: ${JSON.stringify(schemaNode.enum)}`);
  if (schemaNode.minLength !== undefined) parts.push(`minLength: ${schemaNode.minLength}`);
  if (schemaNode.maxLength !== undefined) parts.push(`maxLength: ${schemaNode.maxLength}`);
  if (schemaNode.minimum !== undefined) parts.push(`minimum: ${schemaNode.minimum}`);
  if (schemaNode.maximum !== undefined) parts.push(`maximum: ${schemaNode.maximum}`);
  return parts.length > 0 ? parts.join(', ') : 'valid value';
}

/**
 * Resolve a schema property node by dot-notation path.
 */
function resolveSchemaNode(
  schemaRoot: Record<string, any>,
  fieldPath: string,
): Record<string, any> | undefined {
  const parts = fieldPath.split('.');
  let node = schemaRoot;
  for (const part of parts) {
    if (!node.properties || !node.properties[part]) return undefined;
    node = node.properties[part];
  }
  return node;
}

/**
 * Validates a merged config object with provenance tracking.
 *
 * - strict=true: additionalProperties: false at all levels → throws VersioningsError(CONFIG_ERROR) on unknown fields
 * - strict=false (default): additionalProperties: true → returns warnings for unknown fields with sources
 *
 * In both modes, type/format/required errors always throw.
 *
 * @param config — merged config object
 * @param provenance — provenance map from config.merger (fieldPath → { value, source })
 * @param strict — whether to treat unknown fields as errors
 * @returns ValidationResult with warnings (default mode) or throws (strict mode)
 * @throws VersioningsError(CONFIG_ERROR) — on schema violations or unknown fields in strict mode
 */
export function validateWithProvenance(
  config: Record<string, any>,
  provenance: Record<string, { value: any; source: string }>,
  strict: boolean = false,
): ValidationResult {
  const warnings: ValidationWarning[] = [];

  // 1. Always validate with permissive schema first (type/required/enum errors)
  const permissiveSchema = cloneSchemaWithAdditionalProps(schema, true);
  const ajvPermissive = new Ajv({ allErrors: true });
  const validatePermissive = ajvPermissive.compile(permissiveSchema);
  const permissiveValid = validatePermissive(config);

  if (!permissiveValid && validatePermissive.errors) {
    // Type/required/enum errors — always throw regardless of strict mode
    const errorLines = validatePermissive.errors.map((err) => {
      const fieldPath = err.instancePath
        ? err.instancePath.replace(/^\//, '').replace(/\//g, '.')
        : '/';
      const source = findSource(provenance, fieldPath);
      const schemaNode = resolveSchemaNode(schema, fieldPath);
      const expected = describeExpected(schemaNode);
      return `  ${fieldPath}: ${err.message} (expected ${expected})\n    source: ${source}`;
    });

    throw new VersioningsError(
      EXIT_CODES.CONFIG_ERROR,
      `Configuration does not match schema.\n${errorLines.join('\n')}`,
      {
        validationErrors: validatePermissive.errors.map((err) => {
          const fieldPath = err.instancePath
            ? err.instancePath.replace(/^\//, '').replace(/\//g, '.')
            : '/';
          return {
            path: err.instancePath || '/',
            message: err.message,
            params: err.params,
            source: findSource(provenance, fieldPath),
            expected: describeExpected(resolveSchemaNode(schema, fieldPath)),
          };
        }),
      },
    );
  }

  // 2. Detect unknown fields
  const unknownPaths = collectUnknownPaths(config, schema, '');

  if (unknownPaths.length > 0) {
    if (strict) {
      // Strict mode: throw error with all unknown fields
      const errorLines = unknownPaths.map((p) => {
        const source = findSource(provenance, p);
        return `  ${p}: unknown field\n    source: ${source}`;
      });

      throw new VersioningsError(
        EXIT_CODES.CONFIG_ERROR,
        `Configuration contains unknown fields.\n${errorLines.join('\n')}`,
        {
          unknownFields: unknownPaths.map((p) => ({
            path: p,
            source: findSource(provenance, p),
          })),
        },
      );
    } else {
      // Default mode: collect warnings
      for (const p of unknownPaths) {
        const source = findSource(provenance, p);
        warnings.push({
          path: p,
          message: `Unknown field "${p}"`,
          source,
        });
      }
    }
  }

  return { valid: true, warnings };
}

export { schema, DEFAULT_CONVENTIONAL_COMMITS_TYPES, DEFAULT_GROUP_TITLES };
