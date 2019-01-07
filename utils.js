/*
 * Raman Marozau <engineer.morozov@gmail.com>, 2018
 */

const EMPTY_LINE = '\n';

const ANSI_FG_RED = '\x1b[31m';
const ANSI_FG_YELLOW = '\x1b[33m';
const ANSI_FG_GREEN = '\x1b[32m';
const ANSI_FG_NC = '\x1b[0m'; // no color

const CURRENT_BRANCH = '*';
const SSH_URL_MARKER = 'git@';

function execAction(callback, exitConditions = { error: true, stderr: true }) {
  return (error, response, stderr) => {
    Logger.error(error, stderr, exitConditions);
    callback(response, stderr, error);
  }
}

function stop(action) {
  if (action && action.length !== 0) {
    Logger.stack([action]);
  }
  process.exit(0);
}

class Logger {
  static stack(logStack) {
    logStack.forEach((log) => {
      console.log(...log);
    });
  }

  static error(error, stderr, exitConditions = { error: true, stderr: true }) {
    if (error !== null) {
      Logger.stack([[`${ANSI_FG_RED}%s${ANSI_FG_NC}`, `Error: ${error}`]]);
      if (exitConditions.error) {
        process.exit(0)
      }
    }
    if (stderr) {
      Logger.stack([[`%s`, stderr]]);
      if (exitConditions.stderr) {
        process.exit(0);
      }
    }
  }
}

function get(obj, path, defaultValue = void 0) {
  let value = obj;
  path.split('.').forEach((propName) => {
    value = value[propName] || defaultValue;
  });
  return value;
}

module.exports = {
  EMPTY_LINE,
  ANSI_FG_RED,
  ANSI_FG_YELLOW,
  ANSI_FG_GREEN,
  ANSI_FG_NC,
  CURRENT_BRANCH,
  SSH_URL_MARKER,
  execAction,
  stop,
  Logger,
  get,
};
