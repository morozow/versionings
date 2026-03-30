/*
 * Versioning automation tool, 2018-present
 */

import { execSync } from 'child_process';
import * as querystring from 'querystring';

import { EMPTY_LINE, SSH_URL_MARKER, ANSI_FG_RED, ANSI_FG_NC, stop } from './utils';
import type { VersioningsConfig } from './config.validator';

export const AVAILABLE_SEMVERS: string[] = [
  'patch', 'prepatch', 'minor', 'preminor', 'premajor', 'prerelease', 'major',
];

export const GIT_URL_REG_EX = /git@([\w\.]+):([\w\.\/-]+)/gi;
export const DOUBLE_DASH_SYMBOL = '--';
export const SLASH_SYMBOL = '/';

export const repositorySourceBranch = (branch: string): string =>
  `refs/heads/${branch}`;

export const semverMessage = (semver: string, version: string, config?: VersioningsConfig): string => {
  if (config) {
    const tpl = config.git.commit.message.semver[semver as keyof typeof config.git.commit.message.semver];
    return tpl
      ? tpl.replace(/v%s/g, version)
      : 'Read documentation and try to use versioning tool according to the standard.';
  }
  return `Version ${semver}: ${version}`;
};

export const semverNpmMessage = (semver: string, branch: string, config?: VersioningsConfig): string => {
  if (config) {
    return `Version: ${config.package.semver[semver as keyof typeof config.package.semver]}. Comment: ${branch}.`;
  }
  return `Version: ${semver}. Comment: ${branch}.`;
};

const cleanGitUrl = (url: string): string => url.replace('.git', '');

export function composePullRequestUrl(
  httpsUrl: string,
  opts: { https: boolean }
): string {
  if (opts.https) {
    return cleanGitUrl(httpsUrl);
  } else {
    const regex = /git@([\w\.]+):([\w\.\/-]+)/gi;
    const result = regex.exec(httpsUrl);
    if (!result) return cleanGitUrl(httpsUrl);
    const [_, platformDomain, repositoryPath] = result;
    return `https://${platformDomain}/${cleanGitUrl(repositoryPath)}`;
  }
}

/**
 * Composition of the branch name for the next version.
 */
export function composeVersionBranchName(semver: string, version: string, comment: string, config?: VersioningsConfig): string {
  const branchType = config ? config.git.branchType.version : 'version';
  const semverType = config ? config.package.semver[semver as keyof typeof config.package.semver] : semver;
  return `${branchType}${SLASH_SYMBOL}${semverType}${SLASH_SYMBOL}${version}${SLASH_SYMBOL}${comment}`;
}

/**
 * Composition of the tag name for the next version.
 */
export function composeVersionTagName(semver: string, version: string, comment: string): string {
  return `${version}${DOUBLE_DASH_SYMBOL}${comment}`;
}

/**
 * Generates the url to create Pull Request.
 */
export function generatePullRequestUrl(branch: string, config?: VersioningsConfig): string {
  if (!config) {
    return `https://example.com/compare/master...${branch}`;
  }
  return config.git.platform === 'github'
    ? pullRequestUrlGenerator.github(branch, config)
    : pullRequestUrlGenerator.bitBucket(branch, config);
}

const pullRequestUrlGenerator = {
  github: (branch: string, config: VersioningsConfig): string => {
    const url = composePullRequestUrl(config.git.url!, { https: !config.git.url!.includes(SSH_URL_MARKER) });
    return `${url}/compare/${config.git.pr.target}...${branch}?${querystring.stringify({ expand: 1 })}`;
  },
  bitBucket: (branch: string, config: VersioningsConfig): string => {
    const url = composePullRequestUrl(config.git.url!, { https: !config.git.url!.includes(SSH_URL_MARKER) });
    return `${url}/pull-requests/new?${querystring.stringify({
      source: repositorySourceBranch(branch),
      dest: config.git.pr.target,
      t: 1,
    })}`;
  },
};

export function preidParam(preid?: string): string {
  return preid ? `--preid=${preid}` : '';
}

export function resetVersion(callback: () => void): void {
  try {
    execSync('git reset --hard');
  } catch (e) {
    stop([`${ANSI_FG_RED}%s${ANSI_FG_NC}`, `${e} ${EMPTY_LINE}`]);
  } finally {
    callback();
  }
}
