/*
 * Raman Marozau <engineer.morozov@gmail.com>, 2018
 */

const querystring = require('querystring');

const config = require('./config');

const { EMPTY_LINE, SSH_URL_MARKER } = require('./utils');

const HELP_MESSAGE = `${EMPTY_LINE}` +
  'versionings ' +
  `--semver=[<semantic-version> | ${Object.keys(config.package.semver).join(' | ')}] ` +
  '--name=[<version-branch-name> | any-hyphen-case-less-100-characters-string] ' +
  `[--push]${EMPTY_LINE}`;
const AVAILABLE_SEMVERS = Object.keys(config.package.semver);
const GIT_URL_REG_EX = /git@([\w\.]+):([\w\.\/-]+)/gi;

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
 * @param semver Semantic version: patch | minor | major | premajor | release
 * @param version Version: Major.Minor.Patch[-Prerelease]
 * @param comment Hyphen case branch comment. Length: less 100 characters
 * @returns {string}
 */
function composeVersionBranchName(semver, version, comment) {
  return `${config.git.branchType.version}/${config.package.semver[semver]}/${version}-${comment}`;
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

module.exports = {
  HELP_MESSAGE,
  AVAILABLE_SEMVERS,
  preidParam,
  semverMessage,
  composeVersionBranchName,
  generatePullRequestUrl,
};
