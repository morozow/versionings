/*
 * Raman Marozau <engineer.morozov@gmail.com>, 2018
 */

const fs = require('fs');
const path = require('path');

const { ANSI_FG_RED, ANSI_FG_NC, stop, get } = require('./utils');

const GITHUB_GIT_PLATFORM = 'github';
const BITBUCKET_GIT_PLATFORM = 'bitbucket';
const AVAILABLE_GIT_PLATFORMS = [GITHUB_GIT_PLATFORM, BITBUCKET_GIT_PLATFORM];

const defaultConfig = {
  git: {
    platform: void 0, // required
    url: void 0, // required
    branchType: {
      version: 'version',
    },
    pr: {
      target: 'master',
    },
    limits: {
      branchMaxLength: 100,
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
  package: {
    semver: {
      patch: 'patch',
      prepatch: 'prepatch',
      minor: 'minor',
      preminor: 'preminor',
      premajor: 'premajor',
      prerelease: 'prerelease',
      major: 'major',
    }
  },
  common: {
    project: {
      title: 'Project',
    },
    messages: {
      versionConfigDoesNotExist: 'Version configuration DOES NOT exist. Define: ./version.json file.',
      undefinedGitRepositoryUrl: 'Undefined Git repository URL.',
      unavailableVersioningDirectory: 'Get back to root directory that contains project package.json.',
      unavailableSemanticVersion: 'Unavailable semantic version. Define: semantic version according to config.',
      undefinedVersionBranchName: 'Undefined version branch name.',
      incorrectVersionBranchNameLength: 'Branch name MUST have length less.',
      untrackedGitFiles: 'You have untracked git files. Commit all changes and try again.',
      unavailableGitPlatform: `Unavailable Git platform. Available platforms: ${AVAILABLE_GIT_PLATFORMS.join(', ')}`,
      unavailableGitTargetBranch: `Unavailable Git target branch. Define: git.pr.target in ./version.json file.`,
    }
  }
};

const versionConfigPath = path.join(process.env.PWD, 'version.json');
if (!fs.existsSync(versionConfigPath)) {
  stop([`${ANSI_FG_RED}%s${ANSI_FG_NC}`, defaultConfig.common.messages.versionConfigDoesNotExist]);
}
const versionConfig = require(versionConfigPath);
if (!versionConfig.git.url) {
  stop([`${ANSI_FG_RED}%s${ANSI_FG_NC}`, defaultConfig.common.messages.undefinedGitRepositoryUrl]);
}
if (!AVAILABLE_GIT_PLATFORMS.includes(versionConfig.git.platform)) {
  stop([`${ANSI_FG_RED}%s${ANSI_FG_NC}`, defaultConfig.common.messages.unavailableGitPlatform]);
}

const config = {
  ...defaultConfig,
  git: {
    ...defaultConfig.git,
    url: get(versionConfig, 'git.url', defaultConfig.git.url),
    platform: get(versionConfig, 'git.platform', defaultConfig.git.platform),
    pr: {
      ...defaultConfig.git.pr,
      target: get(versionConfig, 'git.pr.target', defaultConfig.git.pr.target)
    }
  }
};

module.exports = config;
