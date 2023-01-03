/*
 * Versioning automation tool, 2018-present
 */

const fs = require("fs");
const path = require("path");

const { ANSI_FG_RED, ANSI_FG_NC, EMPTY_LINE, stop, get } = require("./utils");

const GITHUB_GIT_PLATFORM = "github";
const BITBUCKET_GIT_PLATFORM = "bitbucket";
const AVAILABLE_GIT_PLATFORMS = [GITHUB_GIT_PLATFORM, BITBUCKET_GIT_PLATFORM];

const defaultConfig = {
  git: {
    platform: void 0, // required
    url: void 0, // required
    branchType: {
      version: "version",
    },
    pr: {
      target: "master",
    },
    limits: {
      branchMaxCommentLength: 96,
    },
    remote: "origin",
    commit: {
      message: {
        semver: {
          prepatch: "Patch version is preparing now: v%s.",
          patch: "Patch: v%s. You SHOULD consider changes.",
          preminor: "Minor version is preparing now: v%s.",
          minor: "Minor: v%s. You MUST consider changes.",
          premajor: "Release is preparing now: v%s.",
          major: "Release: v%s.",
          prerelease: "Preparing: v%s.",
        },
      },
    },
  },
  package: {
    semver: {
      patch: "patch",
      prepatch: "prepatch",
      minor: "minor",
      preminor: "preminor",
      premajor: "premajor",
      prerelease: "prerelease",
      major: "major",
    },
  },
  common: {
    messages: {
      versionConfigDoesNotExist:
        "Version configuration DOES NOT exist. Define ./version.json file.",
      undefinedGitRepositoryUrl:
        "Git repository URL is undefined. Define correct git.url in ./version.json file.",
      unavailableVersioningDirectory:
        "Get back to the root directory that contains project package.json.",
      unavailableSemanticVersion:
        "Semantic version is unavailable. Define correct --semver CLI parameter.",
      undefinedVersionBranchName:
        "Version branch name is undefined. Define correct --branch CLI parameter.",
      incorrectVersionBranchNameLength:
        "Correct --branch CLI parameter MUST have length less",
      incorrectVersionBranchNameCharactersDashes:
        'Correct --branch CLI parameter MUST NOT contain multi dashes, "--".',
      versionBranchAlreadyExists: "Version branch already exists.",
      untrackedGitFiles:
        "You have untracked git files. Commit changes and try again.",
      unavailableGitPlatform: `Git platform is unavailable. Define correct git.platform in ./version.json file. Available platforms: ${AVAILABLE_GIT_PLATFORMS.join(
        ", "
      )}.`,
      unavailableGitTargetBranch: `Git target branch is unavailable. Define correct git.pr.target in ./version.json file.`,
      versionAlreadyExists: "Version number already exists.",
      versionAlreadyExistsTag:
        "Version number already exists. Pay attention to git version tags.",
      versionAlreadyExistsBranch:
        "Version number already exists. Pay attention to git version branches.",
      incorrectGitRemote:
        "Git remote is unavailable. Define correct config git.url, local Git remote.",
    },
  },
};

const versionConfigPath = path.join(process.cwd(), "version.json");
if (!fs.existsSync(versionConfigPath)) {
  stop([
    `${ANSI_FG_RED}%s${ANSI_FG_NC}`,
    `${defaultConfig.common.messages.versionConfigDoesNotExist} ${EMPTY_LINE}`,
  ]);
}
const versionConfig = require(versionConfigPath);
if (!versionConfig.git.url) {
  stop([
    `${ANSI_FG_RED}%s${ANSI_FG_NC}`,
    `${defaultConfig.common.messages.undefinedGitRepositoryUrl} ${EMPTY_LINE}`,
  ]);
}
if (!AVAILABLE_GIT_PLATFORMS.includes(versionConfig.git.platform)) {
  stop([
    `${ANSI_FG_RED}%s${ANSI_FG_NC}`,
    `${defaultConfig.common.messages.unavailableGitPlatform} ${EMPTY_LINE}`,
  ]);
}

const config = {
  ...defaultConfig,
  git: {
    ...defaultConfig.git,
    url: get(versionConfig, "git.url", defaultConfig.git.url),
    platform: get(versionConfig, "git.platform", defaultConfig.git.platform),
    pr: {
      ...defaultConfig.git.pr,
      target: get(versionConfig, "git.pr.target", defaultConfig.git.pr.target),
    },
  },
};

module.exports = config;
