/*
 * Versioning automation tool, 2018-present
 */

const { execSync } = require('child_process');
const querystring = require('querystring');

const config = require('./config');

const { EMPTY_LINE, SSH_URL_MARKER, ANSI_FG_RED, ANSI_FG_NC, stop } = require('./utils');

const HELP_MESSAGE = `${EMPTY_LINE}` +
  'versionings ' +
  `--semver=[<semantic-version> | ${Object.keys(config.package.semver).join(' | ')}] ` +
  '--branch=[<version-branch-name> | any-hyphen-case-less-100-characters-string] ' +
  `[--push]${EMPTY_LINE}`;
const AVAILABLE_SEMVERS = Object.keys(config.package.semver);
const GIT_URL_REG_EX = /git@([\w\.]+):([\w\.\/-]+)/gi;
const DOUBLE_DASH_SYMBOL = '--'; // Only tag name MUST contain double dash separator
const SLASH_SYMBOL = '/';

const repositorySourceBranch = (branch) => `refs/heads/${branch}`;
const semverMessage = (semver) =>
  config.git.commit.message.semver[semver]
    || 'Read documentation and try to use versioning tool according to the standard.';

const cleanGitUrl = (url) => url.replace('.git', '');

function composePullRequestUrl(httpsUrl, { https }) {
  if (https) {
    return cleanGitUrl(httpsUrl);
  } else {
    const [_, platformDomain, repositoryPath] = GIT_URL_REG_EX.exec(httpsUrl);
    return `https://${platformDomain}/${cleanGitUrl(repositoryPath)}`;
  }
}

/**
 * Composition of the branch name for the next version.
 * @param semver Semantic version: patch | prepatch | minor | preminor | premajor | prerelease | major
 * @param version Version: Major.Minor.Patch[-Prerelease]
 * @param comment Hyphen case branch comment. Length: less 100 characters
 * @returns {string}
 */
function composeVersionBranchName(semver, version, comment) {
  return `${config.git.branchType.version}${SLASH_SYMBOL}${config.package.semver[semver]}${SLASH_SYMBOL}${version}${SLASH_SYMBOL}${comment}`;
}

/**
 * Composition of the tag name for the next version.
 * @param semver Semantic version: patch | minor | major | premajor | release
 * @param version Version: Major.Minor.Patch[-Prerelease]
 * @param comment Hyphen case branch comment. Length: less 100 characters
 * @returns {string}
 */
function composeVersionTagName(semver, version, comment) {
  return `${version}${DOUBLE_DASH_SYMBOL}${comment}`;
}

/**
 * Generates the url to create Pull Request.
 * @param branch Branch name for Pull Request
 * @returns {string}
 */
function generatePullRequestUrl(branch) {
  return config.git.platform === 'github'
    ? pullRequestUrlGenerator.github(branch)
    : pullRequestUrlGenerator.bitBucket(branch);
}

const pullRequestUrlGenerator = {
  github: (branch) => {
    const url = composePullRequestUrl(config.git.url, { https: !config.git.url.includes(SSH_URL_MARKER) });
    return `${url}/compare/${config.git.pr.target}...${branch}?${querystring.stringify({ expand: 1 })}`;
  },
  bitBucket: (branch) => {
    const url = composePullRequestUrl(config.git.url, { https: !config.git.url.includes(SSH_URL_MARKER) });
    return `${url}/pull-requests/new?${querystring.stringify({
      source: repositorySourceBranch(branch),
      dest: config.git.pr.target,
      t: 1,
    })}`;
  },
};

function preidParam(preid) {
  return preid ? `--preid=${preid}` : '';
}

function resetVersion(callback) {
  try {
    execSync('git reset --hard');
  } catch (e) {
    stop([`${ANSI_FG_RED}%s${ANSI_FG_NC}`, `${e} ${EMPTY_LINE}`]);
  } finally {
    callback();
  }
}

module.exports = {
  DOUBLE_DASH_SYMBOL,
  SLASH_SYMBOL,
  HELP_MESSAGE,
  AVAILABLE_SEMVERS,
  preidParam,
  composeVersionTagName,
  semverMessage,
  composeVersionBranchName,
  generatePullRequestUrl,
  resetVersion,
};
