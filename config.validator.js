/*
 * Versioning automation tool, 2018-present
 */

const fs = require('fs');
const Ajv = require('ajv');

const { EXIT_CODES, VersioningsError } = require('./errors');

const schema = require('./version.schema.json');

const AVAILABLE_GIT_PLATFORMS = ['github', 'bitbucket'];

const defaultConfig = {
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
 * @param {string} configPath — path to version.json
 * @returns {Object} — validated and merged config
 * @throws {VersioningsError} — EXIT_CODES.CONFIG_ERROR
 */
function loadAndValidateConfig(configPath) {
  // 1. Check file existence
  if (!fs.existsSync(configPath)) {
    throw new VersioningsError(
      EXIT_CODES.CONFIG_ERROR,
      'Version configuration does not exist.',
      { expectedPath: configPath }
    );
  }

  // 2. Parse JSON
  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (err) {
    throw new VersioningsError(
      EXIT_CODES.CONFIG_ERROR,
      `Cannot read configuration file: ${err.message}`,
      { expectedPath: configPath }
    );
  }

  let versionConfig;
  try {
    versionConfig = JSON.parse(raw);
  } catch (err) {
    const details = { parseError: err.message };
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
    const errors = validate.errors.map((err) => ({
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

  const config = {
    ...defaultConfig,
    git: {
      ...defaultConfig.git,
      url: gitConfig.url !== undefined ? gitConfig.url : defaultConfig.git.url,
      platform: gitConfig.platform !== undefined ? gitConfig.platform : defaultConfig.git.platform,
      pr: {
        ...defaultConfig.git.pr,
        target: prConfig.target !== undefined ? prConfig.target : defaultConfig.git.pr.target,
      },
    },
  };

  return config;
}

module.exports = { loadAndValidateConfig, schema };
