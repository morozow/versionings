#!/usr/bin/env node

/*
 * Raman Marozau <engineer.morozov@gmail.com>, 2018
 */

const { exec } = require('child_process');
const { argv } = require('yargs');
const opn = require('opn');
const fs = require('fs');

const config = require('./config');

const {
  HELP_MESSAGE,
  AVAILABLE_SEMVERS,
  preidParam,
  composeVersionBranchName,
  semverMessage,
  generatePullRequestUrl,
} = require('./version.utils');
const {
  EMPTY_LINE,
  ANSI_FG_GREEN,
  ANSI_FG_NC,
  ANSI_FG_YELLOW,
  ANSI_FG_RED,
  Logger,
  execAction,
  stop,
} = require('./utils');

/**
 * CLI:
 * versionings --semver=[<semantic-version> | patch | prepatch | minor | preminor | premajor | prerelease | major] --branch=[<version-branch-name> | any-hyphen-case-less-100-characters-string] [--push]
 */

const { branch, semver, push, preid } = argv;
const { version: currentVersion } = JSON.parse(fs.readFileSync('./package.json', 'utf8'));

if (!currentVersion) {
  stop([`${ANSI_FG_YELLOW}%s${ANSI_FG_NC}`, config.common.messages.unavailableVersioningDirectory]);
} else if (!semver || !AVAILABLE_SEMVERS.includes(semver)) {
  stop([`${ANSI_FG_RED}%s${ANSI_FG_NC}`, `${config.common.messages.unavailableSemanticVersion} ${HELP_MESSAGE}`]);
} else if (!branch || branch === true) { // true is an empty --branch parameter
  stop([`${ANSI_FG_RED}%s${ANSI_FG_NC}`, `${config.common.messages.undefinedVersionBranchName} ${HELP_MESSAGE}`]);
} else if (branch.length >= config.git.limits.branchMaxLength) {
  stop([`${ANSI_FG_RED}%s${ANSI_FG_NC}`, `${config.common.messages.incorrectVersionBranchNameLength} ${config.git.limits.branchMaxLength} characters. ${HELP_MESSAGE}`]);
}

exec('git branch -a', execAction((branches) => {
  const isTargetBranchExists = branches
    .trim()
    .split(EMPTY_LINE)
    .some((branch) => branch === config.git.pr.target);
  if (!isTargetBranchExists) {
    stop([`${ANSI_FG_RED}%s${ANSI_FG_NC}`, config.common.messages.unavailableGitTargetBranch]);
  }
  exec('git status --porcelain', execAction((changes) => {
    if (changes) {
      stop([`${ANSI_FG_YELLOW}%s${ANSI_FG_NC}`, config.common.messages.untrackedGitFiles]);
    }
    exec(`npm version ${semver} -m "${semverMessage(semver)}" ${preidParam(preid)}`, execAction((_version) => {
      const version = _version.trim(); // remove new line of the version number string
      const versionBranchName = composeVersionBranchName(semver, version, branch);
      exec(`git checkout -b ${versionBranchName}`, execAction(() => {
        if (!push) {
          Logger.stack([
            [`${config.common.project.title} version updated %s`, `${ANSI_FG_GREEN}locally${ANSI_FG_NC}.`],
            [`Version: %s`, `${ANSI_FG_GREEN}${version}${ANSI_FG_NC}`],
            [`Semantic version: %s`, `${ANSI_FG_GREEN}${semver}${ANSI_FG_NC}${EMPTY_LINE}`],
          ]);
          stop();
        }
        exec(`git push ${config.git.remote} ${versionBranchName} --follow-tags`, execAction(() => {
          const pullRequestUrl = generatePullRequestUrl(versionBranchName);
          opn(pullRequestUrl);
          Logger.stack([
            [`${config.common.project.title} version updated %s`, `${ANSI_FG_GREEN}remotely${ANSI_FG_NC}.`],
            [`Version: %s`, `${ANSI_FG_GREEN}${version}${ANSI_FG_NC}`],
            [`Branch: %s`, `${ANSI_FG_GREEN}${versionBranchName}${ANSI_FG_NC}`],
            [`Semantic version: %s`, `${ANSI_FG_GREEN}${semver}${ANSI_FG_NC}${EMPTY_LINE}`],
            [`Pull request URL: %s`, `${ANSI_FG_GREEN}${pullRequestUrl}${ANSI_FG_NC}${EMPTY_LINE}`],
          ]);
          stop();
        }, { error: true, stderr: false }));
      }, { error: true }));
    }));
  }));
}));
