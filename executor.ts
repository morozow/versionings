/* Versioning automation tool, 2018-present */

import { exec } from 'child_process';
import { EXIT_CODES, VersioningsError } from './errors';

export type ExecFn = (
  cmd: string,
  callback: (error: Error | null, stdout: string, stderr: string) => void
) => void;

export interface ExecutorOpts {
  verbose?: boolean;
}

export interface ExecutorResult {
  stdout: string;
  lines: string[];
}

export interface Executor {
  run(cmd: string): Promise<ExecutorResult>;
}

/**
 * @param execFn — execution function (defaults to child_process.exec)
 * @param opts — { verbose: boolean }
 * @returns { run(cmd): Promise<{ stdout: string, lines: string[] }> }
 */
export function createExecutor(execFn?: ExecFn | ExecutorOpts, opts?: ExecutorOpts): Executor {
  let resolvedExecFn: ExecFn;
  let resolvedOpts: ExecutorOpts;

  if (typeof execFn === 'object' && execFn !== null) {
    resolvedOpts = execFn as ExecutorOpts;
    resolvedExecFn = exec as unknown as ExecFn;
  } else if (!execFn) {
    resolvedExecFn = exec as unknown as ExecFn;
    resolvedOpts = opts || {};
  } else {
    resolvedExecFn = execFn as ExecFn;
    resolvedOpts = opts || {};
  }

  return {
    run(cmd: string): Promise<ExecutorResult> {
      return new Promise((resolve, reject) => {
        if (resolvedOpts.verbose) {
          console.log(cmd);
        }

        try {
          resolvedExecFn(cmd, (error: Error | null, stdout: string, stderr: string) => {
            const out = String(stdout != null ? stdout : '');
            const err = String(stderr != null ? stderr : '');

            if (error) {
              const exitCode = typeof (error as any).code === 'number' ? (error as any).code : 1;
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
        } catch (err: any) {
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
