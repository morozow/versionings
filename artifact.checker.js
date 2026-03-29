/* Versioning automation tool, 2018-present */

const { EXIT_CODES, VersioningsError } = require('./errors');

/**
 * @param {Object} executor — executor instance with run(cmd) method
 * @returns {Object} — { checkUniqueness(opts): Promise<void> }
 */
function createArtifactChecker(executor) {
  return {
    /**
     * Checks that the given tag and branch names do not already exist
     * locally (and remotely when push is true). Throws on first conflict.
     *
     * @param {Object} opts
     * @param {string} opts.tagName — full tag name to check
     * @param {string} opts.branchName — full branch name to check
     * @param {boolean} opts.push — whether to also check remote artifacts
     * @param {string} [opts.remote='origin'] — remote name
     * @returns {Promise<void>}
     * @throws {VersioningsError} EXIT_CODES.ARTIFACT_CONFLICT on conflict
     */
    async checkUniqueness({ tagName, branchName, push, remote }) {
      const remoteName = remote || 'origin';

      // 1. Check local tags — exact match
      const tagResult = await executor.run('git tag --list');
      for (const line of tagResult.lines) {
        if (line === tagName) {
          throw new VersioningsError(
            EXIT_CODES.ARTIFACT_CONFLICT,
            `Tag already exists: ${tagName}`,
            { type: 'tag', name: tagName, scope: 'local' }
          );
        }
      }

      // 2. Check local branches — strip leading "* " and whitespace, exact match
      const branchResult = await executor.run('git branch --list');
      const localBranches = branchResult.stdout
        .split(/\r?\n/)
        .map(function (line) { return line.replace(/^\*?\s*/, ''); })
        .filter(Boolean);

      for (const name of localBranches) {
        if (name === branchName) {
          throw new VersioningsError(
            EXIT_CODES.ARTIFACT_CONFLICT,
            `Branch already exists: ${branchName}`,
            { type: 'branch', name: branchName, scope: 'local' }
          );
        }
      }

      // 3–4. Check remote artifacts only when push is true
      if (push === true) {
        // 3. Remote tags
        const remoteTagResult = await executor.run(
          'git ls-remote --tags ' + remoteName
        );
        const remoteTagLines = remoteTagResult.stdout.split(/\r?\n/).filter(Boolean);
        for (const line of remoteTagLines) {
          // Each line: "<hash>\trefs/tags/<name>" — ignore ^{} dereferenced lines
          const match = line.match(/\trefs\/tags\/(.+)$/);
          if (!match) continue;
          const refName = match[1];
          if (refName.endsWith('^{}')) continue;
          if (refName === tagName) {
            throw new VersioningsError(
              EXIT_CODES.ARTIFACT_CONFLICT,
              `Tag already exists on remote: ${tagName}`,
              { type: 'tag', name: tagName, scope: 'remote' }
            );
          }
        }

        // 4. Remote branches
        const remoteHeadResult = await executor.run(
          'git ls-remote --heads ' + remoteName
        );
        const remoteHeadLines = remoteHeadResult.stdout.split(/\r?\n/).filter(Boolean);
        for (const line of remoteHeadLines) {
          // Each line: "<hash>\trefs/heads/<name>"
          const match = line.match(/\trefs\/heads\/(.+)$/);
          if (!match) continue;
          if (match[1] === branchName) {
            throw new VersioningsError(
              EXIT_CODES.ARTIFACT_CONFLICT,
              `Branch already exists on remote: ${branchName}`,
              { type: 'branch', name: branchName, scope: 'remote' }
            );
          }
        }
      }
    },
  };
}

module.exports = { createArtifactChecker };
