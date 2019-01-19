#!/usr/bin/env node

/*
 * Versioning automation tool, 2018-present
 */

const { exec } = require('child_process');
const { argv } = require('yargs');
const opn = require('opn');
const fs = require('fs');

const config = require('./config');

const {
  DOUBLE_DASH_SYMBOL,
  SLASH_SYMBOL,
  HELP_MESSAGE,
  AVAILABLE_SEMVERS,
  preidParam,
  composeVersionBranchName,
  composeVersionTagName,
  semverMessage,
  generatePullRequestUrl,
  resetVersion,
} = require('./version.utils');
const {
  EMPTY_LINE,
  EMPTY_STRING,
  ANSI_FG_GREEN,
  ANSI_FG_NC,
  ANSI_FG_YELLOW,
  ANSI_FG_RED,
  CURRENT_BRANCH,
  Logger,
  execAction,
  stop,
} = require('./utils');

/**
 * CLI:
 * versionings --semver=[<semantic-version> | patch | prepatch | minor | preminor | premajor | prerelease | major] --branch=[<version-branch-name> | any-hyphen-case-less-100-characters-string] [--push]
 */

const { semver, branch, push, preid } = argv;
const { version: currentVersion } = JSON.parse(fs.readFileSync('./package.json', 'utf8'));

if (!currentVersion) {
  stop([`${ANSI_FG_YELLOW}%s${ANSI_FG_NC}`, `${config.common.messages.unavailableVersioningDirectory} ${EMPTY_LINE}`]);
} else if (!semver || !AVAILABLE_SEMVERS.includes(semver)) {
  stop([`${ANSI_FG_RED}%s${ANSI_FG_NC}`, `${config.common.messages.unavailableSemanticVersion} ${HELP_MESSAGE}`]);
} else if (!branch || branch === true) { // true is an empty --branch parameter
  stop([`${ANSI_FG_RED}%s${ANSI_FG_NC}`, `${config.common.messages.undefinedVersionBranchName} ${HELP_MESSAGE}`]);
} else if (branch.length >= config.git.limits.branchMaxCommentLength) {
  stop([`${ANSI_FG_RED}%s${ANSI_FG_NC}`, `${config.common.messages.incorrectVersionBranchNameLength} ${config.git.limits.branchMaxCommentLength} characters. ${HELP_MESSAGE}`]);
} else if (branch.match(/-{2,}/g)) {
  stop([`${ANSI_FG_RED}%s${ANSI_FG_NC}`, `${config.common.messages.incorrectVersionBranchNameCharactersDashes} ${HELP_MESSAGE}`]);
}

exec('git remote --verbose', execAction((remotes) => {
  const isCorrectGitUrl = remotes
    .trim()
    .split(EMPTY_LINE)
    .some((remote) =>
      remote
        .trim()
        .split(/\s+/)
        .some((remoteInfoPart) => remoteInfoPart.trim() === config.git.url));
  if (!isCorrectGitUrl) {
    stop([`${ANSI_FG_RED}%s${ANSI_FG_NC}`, `${config.common.messages.incorrectGitRemote} ${EMPTY_LINE}`]);
  }
  exec('git status --porcelain', execAction((changes) => {
    if (changes) {
      stop([`${ANSI_FG_YELLOW}%s${ANSI_FG_NC}`, `${config.common.messages.untrackedGitFiles} ${EMPTY_LINE}`]);
    }
    exec(`npm --no-git-tag-version version ${semver} --message "${semverMessage(semver)}" ${preidParam(preid)}`, execAction((_version) => {
      const version = _version.trim(); // remove new line of the version number string
      const tagName = composeVersionTagName(semver, version, branch);
      exec('git tag', execAction((tags) => {
        const isVersionTagExists = tags
          .trim()
          .split(EMPTY_LINE)
          .some((tag) => tag.trim().split(DOUBLE_DASH_SYMBOL)[0] === version);
        if (isVersionTagExists) {
          resetVersion(() => {
            stop([`${ANSI_FG_RED}%s${ANSI_FG_NC}`, `${config.common.messages.versionAlreadyExistsTag} ${EMPTY_LINE}Version number: ${version} ${EMPTY_LINE}`]);
          });
        }
        const versionBranchName = composeVersionBranchName(semver, version, branch);
        exec('git branch --all', execAction((branches) => {
          const isTargetBranchExists = branches
            .trim()
            .split(EMPTY_LINE)
            .some((branch) => branch.replace(CURRENT_BRANCH, EMPTY_STRING).trim() === config.git.pr.target);
          if (!isTargetBranchExists) {
            resetVersion(() => {
              stop([`${ANSI_FG_RED}%s${ANSI_FG_NC}`, `${config.common.messages.unavailableGitTargetBranch} ${EMPTY_LINE}`]);
            });
          }
          const isVersionBranchExists = branches
            .trim()
            .split(EMPTY_LINE)
            .some((branch) => branch.replace(CURRENT_BRANCH, EMPTY_STRING).trim().split(SLASH_SYMBOL)[2] === version);
          if (isVersionBranchExists) {
            resetVersion(() => {
              stop([
                `${ANSI_FG_RED}%s${ANSI_FG_NC}`, `${config.common.messages.versionAlreadyExistsBranch} ${EMPTY_LINE}Version number: ${version} ${EMPTY_LINE}`]);
            });
          }
          exec(`git checkout -b ${versionBranchName}`, execAction(() => {
            exec(`git tag --annotate ${tagName} --message "${semverMessage(semver)}"`, execAction(() => {
              exec(`git commit --all --message "${semverMessage(semver)}"`, execAction(() => {
                if (!push) {
                  Logger.stack([
                    [`Version updated %s`, `${ANSI_FG_GREEN}locally${ANSI_FG_NC}.`],
                    [`Version: %s`, `${ANSI_FG_GREEN}${version}${ANSI_FG_NC}`],
                    [`Branch: %s`, `${ANSI_FG_GREEN}${versionBranchName}${ANSI_FG_NC}`],
                    [`Semantic version: %s`, `${ANSI_FG_GREEN}${semver}${ANSI_FG_NC}${EMPTY_LINE}`],
                  ]);
                  stop();
                }
                exec(`git push ${config.git.remote} ${versionBranchName} --follow-tags`, execAction(() => {
                  const pullRequestUrl = generatePullRequestUrl(versionBranchName);
                  opn(pullRequestUrl);
                  Logger.stack([
                    [`Version updated %s`, `${ANSI_FG_GREEN}remotely${ANSI_FG_NC}.`],
                    [`Version: %s`, `${ANSI_FG_GREEN}${version}${ANSI_FG_NC}`],
                    [`Branch: %s`, `${ANSI_FG_GREEN}${versionBranchName}${ANSI_FG_NC}`],
                    [`Semantic version: %s`, `${ANSI_FG_GREEN}${semver}${ANSI_FG_NC}${EMPTY_LINE}`],
                    [`Pull request URL: %s`, `${ANSI_FG_GREEN}${pullRequestUrl}${ANSI_FG_NC}${EMPTY_LINE}`],
                  ]);
                  stop();
                }, { error: true, stderr: false }));
              }));
            }))
          }, { error: true }));
        }));
      }));
    }));
  }));
}));
