// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

export const EMPTY_LINE = '\n';
export const EMPTY_STRING = '';

export const ANSI_FG_RED = '\x1b[31m';
export const ANSI_FG_YELLOW = '\x1b[33m';
export const ANSI_FG_GREEN = '\x1b[32m';
export const ANSI_FG_NC = '\x1b[0m'; // no color

export const CURRENT_BRANCH = '*';
export const SSH_URL_MARKER = 'git@';

type ExitConditions = { error: boolean; stderr: boolean };

export function execAction(
  callback: (response: string, stderr: string, error: Error | null) => void,
  exitConditions: ExitConditions = { error: true, stderr: true }
): (error: Error | null, response: string, stderr: string) => void {
  return (error: Error | null, response: string, stderr: string) => {
    Logger.error(error, stderr, exitConditions);
    callback(response, stderr, error);
  };
}

export function stop(action?: any[]): void {
  if (action && action.length !== 0) {
    Logger.stack([action]);
  }
  process.exit(0);
}

export class Logger {
  static stack(logStack: any[][]): void {
    logStack.forEach((log) => {
      console.log(...log);
    });
  }

  static error(
    error: Error | null,
    stderr: string,
    exitConditions: ExitConditions = { error: true, stderr: true }
  ): void {
    if (error !== null) {
      Logger.stack([[`${ANSI_FG_RED}%s${ANSI_FG_NC}`, `Error: ${error}`]]);
      if (exitConditions.error) {
        process.exit(0);
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

export function get(obj: any, path: string, defaultValue: any = void 0): any {
  let value = obj;
  path.split('.').forEach((propName) => {
    value = value[propName] || defaultValue;
  });
  return value;
}
