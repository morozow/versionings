/* Versioning automation tool, 2018-present */

const EXIT_CODES = Object.freeze({
  SUCCESS: 0,
  CONFIG_ERROR: 1,
  DIRTY_TREE: 2,
  INVALID_ARGS: 3,
  ARTIFACT_CONFLICT: 4,
  COMMAND_FAILED: 5,
  NETWORK_ERROR: 6,
  INCOMPLETE_ROLLBACK: 7,
});

class VersioningsError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'VersioningsError';
    this.code = code;
    this.details = details;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, VersioningsError);
    }
  }
}

module.exports = { EXIT_CODES, VersioningsError };
