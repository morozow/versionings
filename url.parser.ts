// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { VersioningsError, EXIT_CODES } from './errors';

// --- Parsed URL types ---

export interface ParsedGitHubUrl {
  platform: 'github' | 'github-enterprise';
  owner: string;
  repo: string;
}

export interface ParsedGitLabUrl {
  platform: 'gitlab';
  namespacePath: string;
  project: string;
}

export interface ParsedBitbucketCloudUrl {
  platform: 'bitbucket';
  workspace: string;
  repoSlug: string;
}

export interface ParsedBitbucketServerUrl {
  platform: 'bitbucket-server';
  projectKey: string;
  repositorySlug: string;
}

export interface ParsedAzureDevOpsUrl {
  platform: 'azure-devops';
  organization: string;
  project: string;
  repo: string;
}

export type ParsedUrl =
  | ParsedGitHubUrl
  | ParsedGitLabUrl
  | ParsedBitbucketCloudUrl
  | ParsedBitbucketServerUrl
  | ParsedAzureDevOpsUrl;

export interface UrlParser {
  parse(url: string, platform: string): ParsedUrl;
  format(parsed: ParsedUrl): string;
}

// --- Helpers ---

/**
 * Strips `.git` suffix and trailing slashes from a path string.
 */
function cleanPath(p: string): string {
  let result = p.replace(/\/+$/, '');
  if (result.endsWith('.git')) {
    result = result.slice(0, -4);
  }
  return result;
}

/**
 * Extracts the path from an SSH URL.
 * Supports:
 *   git@host:path.git
 *   ssh://git@host[:port]/path.git
 */
function extractSshPath(url: string): string | null {
  // ssh:// format
  const sshProto = /^ssh:\/\/[^@]+@[^/]+(\/.*)/i;
  const sshMatch = url.match(sshProto);
  if (sshMatch) {
    return cleanPath(sshMatch[1].replace(/^\/+/, ''));
  }
  // git@host:path format (colon-separated)
  const gitAt = /^git@[^:]+:(.+)/;
  const gitAtMatch = url.match(gitAt);
  if (gitAtMatch) {
    // Handle Bitbucket Server port format: git@host:7999/path
    const raw = gitAtMatch[1];
    const portPrefix = /^\d+\/(.*)/;
    const portMatch = raw.match(portPrefix);
    if (portMatch) {
      return cleanPath(portMatch[1]);
    }
    return cleanPath(raw);
  }
  return null;
}

/**
 * Extracts the path from an HTTPS URL.
 * Returns the path without leading slash.
 */
function extractHttpsPath(url: string): string | null {
  try {
    const parsed = new URL(url);
    const p = decodeURIComponent(parsed.pathname);
    return cleanPath(p.replace(/^\/+/, ''));
  } catch {
    return null;
  }
}

/**
 * Splits a path into segments, filtering out empty strings.
 */
function splitPath(p: string): string[] {
  return p.split('/').filter(Boolean);
}

// --- Platform-specific error messages ---

const EXPECTED_FORMATS: Record<string, string[]> = {
  'github': [
    'https://github.com/{owner}/{repo}',
    'git@github.com:{owner}/{repo}.git',
  ],
  'github-enterprise': [
    'https://{domain}/{owner}/{repo}',
    'git@{domain}:{owner}/{repo}.git',
  ],
  'gitlab': [
    'https://gitlab.com/{namespace}/{project}',
    'https://gitlab.com/{group}/{subgroup}/{project}',
    'git@gitlab.com:{namespace}/{project}.git',
  ],
  'bitbucket': [
    'https://bitbucket.org/{workspace}/{repo_slug}',
    'git@bitbucket.org:{workspace}/{repo_slug}.git',
  ],
  'bitbucket-server': [
    'https://{domain}/scm/{projectKey}/{repositorySlug}',
    'git@{domain}:{projectKey}/{repositorySlug}.git',
    'ssh://git@{domain}:{port}/{projectKey}/{repositorySlug}.git',
  ],
  'azure-devops': [
    'https://dev.azure.com/{org}/{project}/_git/{repo}',
    'git@ssh.dev.azure.com:v3/{org}/{project}/{repo}',
  ],
};

function throwParseError(url: string, platform: string): never {
  const formats = EXPECTED_FORMATS[platform] || [];
  const formatList = formats.length > 0
    ? `Expected formats:\n  ${formats.join('\n  ')}`
    : `No known formats for platform "${platform}".`;
  throw new VersioningsError(
    EXIT_CODES.CONFIG_ERROR,
    `Invalid repository URL "${url}" for platform "${platform}". ${formatList}`,
    { platform, input: url, expectedFormats: formats },
  );
}

// --- Platform parsers ---

function parseGitHub(url: string, enterprise: boolean): ParsedGitHubUrl {
  const platform = enterprise ? 'github-enterprise' : 'github';
  const path = extractSshPath(url) || extractHttpsPath(url);
  if (!path) throwParseError(url, platform);

  const segments = splitPath(path!);
  if (segments.length < 2) throwParseError(url, platform);

  return {
    platform: platform as 'github' | 'github-enterprise',
    owner: segments[0],
    repo: segments[1],
  };
}

function parseGitLab(url: string): ParsedGitLabUrl {
  const path = extractSshPath(url) || extractHttpsPath(url);
  if (!path) throwParseError(url, 'gitlab');

  const segments = splitPath(path!);
  if (segments.length < 2) throwParseError(url, 'gitlab');

  const project = segments[segments.length - 1];
  const namespacePath = segments.slice(0, -1).join('/');

  return {
    platform: 'gitlab',
    namespacePath,
    project,
  };
}

function parseBitbucketCloud(url: string): ParsedBitbucketCloudUrl {
  const path = extractSshPath(url) || extractHttpsPath(url);
  if (!path) throwParseError(url, 'bitbucket');

  const segments = splitPath(path!);
  if (segments.length < 2) throwParseError(url, 'bitbucket');

  return {
    platform: 'bitbucket',
    workspace: segments[0],
    repoSlug: segments[1],
  };
}

function parseBitbucketServer(url: string): ParsedBitbucketServerUrl {
  const path = extractSshPath(url) || extractHttpsPath(url);
  if (!path) throwParseError(url, 'bitbucket-server');

  const segments = splitPath(path!);

  // HTTPS format: /scm/{projectKey}/{repoSlug} — skip "scm" prefix
  if (segments.length >= 3 && segments[0].toLowerCase() === 'scm') {
    return {
      platform: 'bitbucket-server',
      projectKey: segments[1],
      repositorySlug: segments[2],
    };
  }

  // SSH format or simplified: /{projectKey}/{repoSlug}
  if (segments.length < 2) throwParseError(url, 'bitbucket-server');

  return {
    platform: 'bitbucket-server',
    projectKey: segments[0],
    repositorySlug: segments[1],
  };
}

function parseAzureDevOps(url: string): ParsedAzureDevOpsUrl {
  // SSH format: git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
  const sshPath = extractSshPath(url);
  if (sshPath) {
    const segments = splitPath(sshPath);
    // Strip "v3" prefix if present
    const filtered = segments[0] === 'v3' ? segments.slice(1) : segments;
    if (filtered.length < 3) throwParseError(url, 'azure-devops');
    return {
      platform: 'azure-devops',
      organization: filtered[0],
      project: filtered[1],
      repo: filtered[2],
    };
  }

  // HTTPS format: https://dev.azure.com/{org}/{project}/_git/{repo}
  const httpsPath = extractHttpsPath(url);
  if (!httpsPath) throwParseError(url, 'azure-devops');

  const segments = splitPath(httpsPath!);
  // Expected: {org}/{project}/_git/{repo}
  const gitIdx = segments.indexOf('_git');
  if (gitIdx < 2 || gitIdx + 1 >= segments.length) throwParseError(url, 'azure-devops');

  return {
    platform: 'azure-devops',
    organization: segments[0],
    project: segments[1],
    repo: segments[gitIdx + 1],
  };
}

// --- Platform formatters ---

const DEFAULT_HOSTS: Record<string, string> = {
  'github': 'github.com',
  'gitlab': 'gitlab.com',
  'bitbucket': 'bitbucket.org',
  'azure-devops': 'dev.azure.com',
};

function formatGitHub(parsed: ParsedGitHubUrl, host?: string): string {
  const domain = host || DEFAULT_HOSTS['github'];
  return `https://${domain}/${parsed.owner}/${parsed.repo}`;
}

function formatGitLab(parsed: ParsedGitLabUrl, host?: string): string {
  const domain = host || DEFAULT_HOSTS['gitlab'];
  return `https://${domain}/${parsed.namespacePath}/${parsed.project}`;
}

function formatBitbucketCloud(parsed: ParsedBitbucketCloudUrl, host?: string): string {
  const domain = host || DEFAULT_HOSTS['bitbucket'];
  return `https://${domain}/${parsed.workspace}/${parsed.repoSlug}`;
}

function formatBitbucketServer(parsed: ParsedBitbucketServerUrl, host?: string): string {
  const domain = host || 'bitbucket-server';
  return `https://${domain}/scm/${parsed.projectKey}/${parsed.repositorySlug}`;
}

function formatAzureDevOps(parsed: ParsedAzureDevOpsUrl, host?: string): string {
  const domain = host || DEFAULT_HOSTS['azure-devops'];
  return `https://${domain}/${parsed.organization}/${parsed.project}/_git/${parsed.repo}`;
}

// --- Supported platforms ---

const SUPPORTED_PLATFORMS = [
  'github',
  'github-enterprise',
  'bitbucket',
  'bitbucket-server',
  'gitlab',
  'azure-devops',
];

// --- Factory ---

/**
 * Creates a URL parser that supports HTTPS and SSH formats for all platforms.
 * Supports self-hosted URLs with custom domains.
 * Throws VersioningsError(CONFIG_ERROR) on invalid URL format.
 */
export function createUrlParser(): UrlParser {
  return {
    parse(url: string, platform: string): ParsedUrl {
      if (!SUPPORTED_PLATFORMS.includes(platform)) {
        throw new VersioningsError(
          EXIT_CODES.CONFIG_ERROR,
          `Unsupported platform "${platform}". Available platforms: ${SUPPORTED_PLATFORMS.join(', ')}`,
          { platform, availablePlatforms: SUPPORTED_PLATFORMS },
        );
      }

      const trimmed = url.trim();
      if (!trimmed) {
        throwParseError(url, platform);
      }

      switch (platform) {
        case 'github':
          return parseGitHub(trimmed, false);
        case 'github-enterprise':
          return parseGitHub(trimmed, true);
        case 'gitlab':
          return parseGitLab(trimmed);
        case 'bitbucket':
          return parseBitbucketCloud(trimmed);
        case 'bitbucket-server':
          return parseBitbucketServer(trimmed);
        case 'azure-devops':
          return parseAzureDevOps(trimmed);
        default:
          throwParseError(url, platform);
      }
    },

    format(parsed: ParsedUrl): string {
      switch (parsed.platform) {
        case 'github':
          return formatGitHub(parsed);
        case 'github-enterprise':
          return formatGitHub(parsed);
        case 'gitlab':
          return formatGitLab(parsed);
        case 'bitbucket':
          return formatBitbucketCloud(parsed);
        case 'bitbucket-server':
          return formatBitbucketServer(parsed);
        case 'azure-devops':
          return formatAzureDevOps(parsed);
        default: {
          const _exhaustive: never = parsed;
          throw new VersioningsError(
            EXIT_CODES.CONFIG_ERROR,
            `Cannot format URL for unknown platform: ${(parsed as any).platform}`,
          );
        }
      }
    },
  };
}
