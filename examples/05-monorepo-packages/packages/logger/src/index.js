'use strict';

/**
 * Creates a structured logger with JSON output.
 *
 * @param {Object} [options={}]
 * @param {string} [options.name] - logger name (included in every log entry)
 * @param {string} [options.level='info'] - minimum log level
 * @returns {{ info: Function, warn: Function, error: Function, debug: Function }}
 */
function createLogger(options) {
  const opts = options || {};
  const name = opts.name || undefined;
  const minLevel = opts.level || 'info';

  const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
  const minLevelValue = LEVELS[minLevel] !== undefined ? LEVELS[minLevel] : LEVELS.info;

  function formatEntry(level, message, context) {
    const entry = {
      timestamp: new Date().toISOString(),
      level: level,
      message: message,
    };

    if (name) {
      entry.name = name;
    }

    if (context !== undefined && context !== null) {
      entry.context = context;
    }

    return JSON.stringify(entry);
  }

  function log(level, message, context) {
    if (LEVELS[level] < minLevelValue) {
      return;
    }

    const output = formatEntry(level, message, context);

    if (level === 'error') {
      process.stderr.write(output + '\n');
    } else {
      process.stdout.write(output + '\n');
    }
  }

  return {
    info: function info(msg, ctx) {
      log('info', msg, ctx);
    },
    warn: function warn(msg, ctx) {
      log('warn', msg, ctx);
    },
    error: function error(msg, ctx) {
      log('error', msg, ctx);
    },
    debug: function debug(msg, ctx) {
      log('debug', msg, ctx);
    },
  };
}

module.exports = { createLogger };
