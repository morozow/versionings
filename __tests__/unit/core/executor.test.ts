// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { createExecutor, ExecFn } from '../../../src/core/executor';
import { EXIT_CODES, VersioningsError } from '../../../src/core/errors';
import type { StructuredLogger } from '../../../src/core/structured.logger';

describe('createExecutor', () => {
  describe('successful execution', () => {
    test('returns trimmed stdout and lines array', async () => {
      const mockExec: ExecFn = (cmd, callback) => callback(null, '  hello\nworld  \n', '');
      const executor = createExecutor(mockExec);
      const result = await executor.run('echo test');
      expect(result.stdout).toBe('hello\nworld');
      expect(result.lines).toEqual(['hello', 'world']);
    });

    test('handles empty output — returns empty string and empty lines', async () => {
      const mockExec: ExecFn = (cmd, callback) => callback(null, '   \n  \n  ', '');
      const executor = createExecutor(mockExec);
      const result = await executor.run('echo empty');
      expect(result.stdout).toBe('');
      expect(result.lines).toEqual([]);
    });

    test('handles multiline output and splits into lines correctly', async () => {
      const mockExec: ExecFn = (cmd, callback) =>
        callback(null, 'line1\nline2\nline3\n', '');
      const executor = createExecutor(mockExec);
      const result = await executor.run('git log');
      expect(result.stdout).toBe('line1\nline2\nline3');
      expect(result.lines).toEqual(['line1', 'line2', 'line3']);
    });

    test('normalizes \\r\\n line endings', async () => {
      const mockExec: ExecFn = (cmd, callback) =>
        callback(null, '  alpha\r\nbeta\r\n  ', '');
      const executor = createExecutor(mockExec);
      const result = await executor.run('cmd /c dir');
      expect(result.stdout).toBe('alpha\r\nbeta');
      expect(result.lines).toEqual(['alpha', 'beta']);
    });

    test('handles null stdout/stderr without throwing', async () => {
      const mockExec: ExecFn = (cmd, callback) => callback(null, null as any, undefined as any);
      const executor = createExecutor(mockExec);
      const result = await executor.run('noop');
      expect(result.stdout).toBe('');
      expect(result.lines).toEqual([]);
    });
  });

  describe('error handling', () => {
    test('rejects with VersioningsError(COMMAND_FAILED) on non-zero exit code', async () => {
      const mockExec: ExecFn = (cmd, callback) => {
        const error: any = new Error('command failed');
        error.code = 1;
        callback(error, 'partial output', 'error details');
      };
      const executor = createExecutor(mockExec);

      await expect(executor.run('bad-cmd')).rejects.toThrow(VersioningsError);

      try {
        await executor.run('bad-cmd');
      } catch (err: any) {
        expect(err.code).toBe(EXIT_CODES.COMMAND_FAILED);
        expect(err.details.cmd).toBe('bad-cmd');
        expect(err.details.exitCode).toBe(1);
        expect(err.details.stdout).toBe('partial output');
        expect(err.details.stderr).toBe('error details');
      }
    });

    test('defaults exitCode to 1 when error.code is not a number', async () => {
      const mockExec: ExecFn = (cmd, callback) => {
        const error = new Error('fail');
        callback(error, '', 'stderr msg');
      };
      const executor = createExecutor(mockExec);

      try {
        await executor.run('some-cmd');
      } catch (err: any) {
        expect(err).toBeInstanceOf(VersioningsError);
        expect(err.details.exitCode).toBe(1);
      }
    });

    test('catches synchronous throw from execFn', async () => {
      const throwingExec: ExecFn = () => {
        throw new Error('sync boom');
      };
      const executor = createExecutor(throwingExec);

      await expect(executor.run('will-throw')).rejects.toThrow(VersioningsError);

      try {
        await executor.run('will-throw');
      } catch (err: any) {
        expect(err.code).toBe(EXIT_CODES.COMMAND_FAILED);
        expect(err.details.cmd).toBe('will-throw');
        expect(err.details.stderr).toContain('sync boom');
      }
    });
  });

  describe('options and defaults', () => {
    test('logs command via console.log when opts.verbose is true', async () => {
      const spy = jest.spyOn(console, 'log').mockImplementation(() => { });
      const mockExec: ExecFn = (cmd, callback) => callback(null, 'ok', '');
      const executor = createExecutor(mockExec, { verbose: true });
      await executor.run('git status');
      expect(spy).toHaveBeenCalledWith('git status');
      spy.mockRestore();
    });

    test('does not log when verbose is not set', async () => {
      const spy = jest.spyOn(console, 'log').mockImplementation(() => { });
      const mockExec: ExecFn = (cmd, callback) => callback(null, 'ok', '');
      const executor = createExecutor(mockExec);
      await executor.run('git status');
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    test('uses child_process.exec when no execFn provided', () => {
      const executor = createExecutor({ verbose: false });
      expect(executor).toHaveProperty('run');
      expect(typeof executor.run).toBe('function');
    });

    test('uses child_process.exec when execFn is undefined', () => {
      const executor = createExecutor();
      expect(executor).toHaveProperty('run');
      expect(typeof executor.run).toBe('function');
    });

    test('uses logger.debug instead of console.log when logger is provided', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => { });
      const debugSpy = jest.fn();
      const logger: StructuredLogger = {
        debug: debugSpy,
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };
      const mockExec: ExecFn = (cmd, callback) => callback(null, 'ok', '');
      const executor = createExecutor(mockExec, { logger });
      await executor.run('git status');
      expect(debugSpy).toHaveBeenCalledWith('git status', { component: 'executor' });
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    test('uses logger.debug even when verbose is also true', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => { });
      const debugSpy = jest.fn();
      const logger: StructuredLogger = {
        debug: debugSpy,
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };
      const mockExec: ExecFn = (cmd, callback) => callback(null, 'ok', '');
      const executor = createExecutor(mockExec, { verbose: true, logger });
      await executor.run('git tag');
      expect(debugSpy).toHaveBeenCalledWith('git tag', { component: 'executor' });
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    test('falls back to console.log when logger is not provided and verbose is true', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => { });
      const mockExec: ExecFn = (cmd, callback) => callback(null, 'ok', '');
      const executor = createExecutor(mockExec, { verbose: true });
      await executor.run('git push');
      expect(consoleSpy).toHaveBeenCalledWith('git push');
      consoleSpy.mockRestore();
    });
  });
});
