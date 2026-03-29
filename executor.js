/* Versioning automation tool, 2018-present */

const { exec } = require('child_process');
const { EXIT_CODES, VersioningsError } = require('./errors');

/**
 * @param {Function} execFn — execution function (defaults to child_process.exec)
 * @param {Object} opts — { verbose: boolean }
 * @returns {Object} — { run(cmd): Promise<{ stdout: string, lines: string[] }> }
 */
function createExecutor(execFn, opts) {
  if (typeof execFn === 'object' && execFn !== null) {
    opts = execFn;
    execFn = exec;
  }

  if (!execFn) {
    execFn = exec;
  }

  if (!opts) {
    opts = {};
  }

  return {
    run(cmd) {
      return new Promise((resolve, reject) => {
        if (opts.verbose) {
          console.log(cmd);
        }

        try {
          execFn(cmd, (error, stdout, stderr) => {
            const out = String(stdout != null ? stdout : '');
            const err = String(stderr != null ? stderr : '');

            if (error) {
              const exitCode = typeof error.code === 'number' ? error.code : 1;
              reject(
                new VersioningsError(
                  EXIT_CODES.COMMAND_FAILED,
                  `Command failed: ${cmd} (exit code ${exitCode})`,
                  { cmd, exitCode, stdout: out, stderr: err }
                )
              );
              return;
            }

            const trimmed = out.trim();
            const lines = trimmed.split(/\r?\n/).filter(Boolean);

            resolve({ stdout: trimmed, lines });
          });
        } catch (err) {
          reject(
            new VersioningsError(
              EXIT_CODES.COMMAND_FAILED,
              `Command failed: ${cmd}`,
              { cmd, exitCode: 1, stdout: '', stderr: String(err.message || err) }
            )
          );
        }
      });
    },
  };
}

module.exports = { createExecutor };
