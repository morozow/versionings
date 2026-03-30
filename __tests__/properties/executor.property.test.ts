/* Versioning automation tool, 2018-present */

import * as fc from 'fast-check';
import { createExecutor, ExecFn } from '../../executor';
import { EXIT_CODES, VersioningsError } from '../../errors';

// --- Generators ---

const arbStdout = fc.stringOf(
  fc.oneof(
    fc.char(),
    fc.constantFrom(' ', '\t', '\n', '\r\n', '  ', '\t\t')
  ),
  { minLength: 0, maxLength: 200 }
);

const arbCommand = fc.string({ minLength: 1, maxLength: 100 });
const arbExitCode = fc.integer({ min: 1, max: 255 });

// --- Mock factories ---

const mockExec = (stdout: string): ExecFn => (cmd, callback) => callback(null, stdout, '');

const mockExecError = (exitCode: number, stdout: string, stderr: string): ExecFn => (cmd, callback) => {
  const error: any = new Error('fail');
  error.code = exitCode;
  callback(error, stdout, stderr);
};

// --- Property 5 ---
describe('Property 5: Output normalization', () => {

  test('stdout field is trimmed of leading/trailing whitespace', async () => {
    await fc.assert(
      fc.asyncProperty(arbCommand, arbStdout, async (cmd, rawStdout) => {
        const executor = createExecutor(mockExec(rawStdout));
        const result = await executor.run(cmd);
        expect(result.stdout).toBe(String(rawStdout).trim());
      }),
      { numRuns: 100 }
    );
  });

  test('lines is an array of non-empty strings split by newline', async () => {
    await fc.assert(
      fc.asyncProperty(arbCommand, arbStdout, async (cmd, rawStdout) => {
        const executor = createExecutor(mockExec(rawStdout));
        const result = await executor.run(cmd);
        expect(Array.isArray(result.lines)).toBe(true);
        for (const line of result.lines) {
          expect(typeof line).toBe('string');
          expect(line.length).toBeGreaterThan(0);
        }
        const expected = String(rawStdout).trim().split(/\r?\n/).filter(Boolean);
        expect(result.lines).toEqual(expected);
      }),
      { numRuns: 100 }
    );
  });
});

// --- Property 6 ---
describe('Property 6: Structured error', () => {

  test('non-zero exit code throws VersioningsError with code COMMAND_FAILED', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbCommand,
        arbExitCode,
        arbStdout,
        arbStdout,
        async (cmd, exitCode, stdout, stderr) => {
          const executor = createExecutor(mockExecError(exitCode, stdout, stderr));
          try {
            await executor.run(cmd);
            throw new Error('Expected VersioningsError to be thrown');
          } catch (err: any) {
            expect(err).toBeInstanceOf(VersioningsError);
            expect(err.code).toBe(EXIT_CODES.COMMAND_FAILED);
            expect(err.details).toBeDefined();
            expect(err.details.cmd).toBe(cmd);
            expect(err.details.exitCode).toBe(exitCode);
            expect(typeof err.details.stdout).toBe('string');
            expect(typeof err.details.stderr).toBe('string');
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// --- Property 7 ---
describe('Property 7: Verbose logging', () => {

  test('command is logged before execution when verbose is true', async () => {
    await fc.assert(
      fc.asyncProperty(arbCommand, async (cmd) => {
        const loggedMessages: string[] = [];
        const originalLog = console.log;
        console.log = (...args: any[]) => loggedMessages.push(args.join(' '));
        try {
          const executor = createExecutor(mockExec('ok'), { verbose: true });
          await executor.run(cmd);
          expect(loggedMessages).toContain(cmd);
        } finally {
          console.log = originalLog;
        }
      }),
      { numRuns: 100 }
    );
  });

  test('command is NOT logged when verbose is false or unset', async () => {
    await fc.assert(
      fc.asyncProperty(arbCommand, async (cmd) => {
        const loggedMessages: string[] = [];
        const originalLog = console.log;
        console.log = (...args: any[]) => loggedMessages.push(args.join(' '));
        try {
          const executor = createExecutor(mockExec('ok'));
          await executor.run(cmd);
          expect(loggedMessages).not.toContain(cmd);
        } finally {
          console.log = originalLog;
        }
      }),
      { numRuns: 100 }
    );
  });
});
