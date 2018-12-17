/*
 * Raman Marozau <engineer.morozov@gmail.com>, 2018
 */

const querystring = require('querystring');

const config = require('./config');

const { EMPTY_LINE } = require('./utils');

const HELP_MESSAGE = `${EMPTY_LINE}` +
  'versionings ' +
  `--semver=[<semantic-version> | ${Object.keys(config.package.semver).join(' | ')}] ` +
  '--name=[<version-branch-name> | any-hyphen-case-less-100-characters-string] ' +
  `[--push]${EMPTY_LINE}`;
const AVAILABLE_SEMVERS = Object.keys(config.package.semver);

const repositorySourceBranch = (branch) => `refs/heads/${branch}`;
const semverMessage = (semver) =>
  config.git.commit.message.semver[semver]
    || 'Read documentation and try to use versioning tool according to the standard.';

/**
 * Composition of the branch name for the next version.
 * @param semver Semantic version: patch | minor | major | premajor | release
 * @param version Version: Major.Minor.Patch[-Prerelease]
 * @param branchName Hyphen case branch name. Length: less 100 characters
 * @returns {string}
 */
function composeVersionBranchName(semver, version, branchName) {
  return `${config.git.branchType.version}/${config.package.semver[semver]}/${version}-${branchName}`;
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
  github: (branch) => `${config.git.url.replace('.git', '')}/compare/${config.git.pr.target}...${branch}?${querystring.stringify({
    expand: 1,
  })}`,
  bitBucket: (branch) => `${config.git.url}/pull-requests?${querystring.stringify({
    create: true,
    sourceBranch: repositorySourceBranch(branch),
    targetBranch: config.git.pr.target,
  })}`,
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
