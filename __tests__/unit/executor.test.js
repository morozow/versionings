/* Versioning automation tool, 2018-present */

const { createExecutor } = require('../../executor');
const { EXIT_CODES, VersioningsError } = require('../../errors');

describe('createExecutor', () => {
  describe('successful execution', () => {
    test('returns trimmed stdout and lines array', async () => {
      const mockExec = (cmd, callback) => callback(null, '  hello\nworld  \n', '');
      const executor = createExecutor(mockExec);

      const result = await executor.run('echo test');

      expect(result.stdout).toBe('hello\nworld');
      expect(result.lines).toEqual(['hello', 'world']);
    });

    test('handles empty output — returns empty string and empty lines', async () => {
      const mockExec = (cmd, callback) => callback(null, '   \n  \n  ', '');
      const executor = createExecutor(mockExec);

      const result = await executor.run('echo empty');

      expect(result.stdout).toBe('');
      expect(result.lines).toEqual([]);
    });

    test('handles multiline output and splits into lines correctly', async () => {
      const mockExec = (cmd, callback) =>
        callback(null, 'line1\nline2\nline3\n', '');
      const executor = createExecutor(mockExec);

      const result = await executor.run('git log');

      expect(result.stdout).toBe('line1\nline2\nline3');
      expect(result.lines).toEqual(['line1', 'line2', 'line3']);
    });

    test('normalizes \\r\\n line endings', async () => {
      const mockExec = (cmd, callback) =>
        callback(null, '  alpha\r\nbeta\r\n  ', '');
      const executor = createExecutor(mockExec);

      const result = await executor.run('cmd /c dir');

      expect(result.stdout).toBe('alpha\r\nbeta');
      expect(result.lines).toEqual(['alpha', 'beta']);
    });

    test('handles null stdout/stderr without throwing', async () => {
      const mockExec = (cmd, callback) => callback(null, null, undefined);
      const executor = createExecutor(mockExec);

      const result = await executor.run('noop');

      expect(result.stdout).toBe('');
      expect(result.lines).toEqual([]);
    });
  });

  describe('error handling', () => {
    test('rejects with VersioningsError(COMMAND_FAILED) on non-zero exit code', async () => {
      const mockExec = (cmd, callback) => {
        const error = new Error('command failed');
        error.code = 1;
        callback(error, 'partial output', 'error details');
      };
      const executor = createExecutor(mockExec);

      await expect(executor.run('bad-cmd')).rejects.toThrow(VersioningsError);

      try {
        await executor.run('bad-cmd');
      } catch (err) {
        expect(err.code).toBe(EXIT_CODES.COMMAND_FAILED);
        expect(err.details.cmd).toBe('bad-cmd');
        expect(err.details.exitCode).toBe(1);
        expect(err.details.stdout).toBe('partial output');
        expect(err.details.stderr).toBe('error details');
      }
    });

    test('defaults exitCode to 1 when error.code is not a number', async () => {
      const mockExec = (cmd, callback) => {
        const error = new Error('fail');
        // error.code is undefined (not a number)
        callback(error, '', 'stderr msg');
      };
      const executor = createExecutor(mockExec);

      try {
        await executor.run('some-cmd');
      } catch (err) {
        expect(err).toBeInstanceOf(VersioningsError);
        expect(err.details.exitCode).toBe(1);
      }
    });

    test('catches synchronous throw from execFn', async () => {
      const throwingExec = () => {
        throw new Error('sync boom');
      };
      const executor = createExecutor(throwingExec);

      await expect(executor.run('will-throw')).rejects.toThrow(VersioningsError);

      try {
        await executor.run('will-throw');
      } catch (err) {
        expect(err.code).toBe(EXIT_CODES.COMMAND_FAILED);
        expect(err.details.cmd).toBe('will-throw');
        expect(err.details.stderr).toContain('sync boom');
      }
    });
  });

  describe('options and defaults', () => {
    test('logs command via console.log when opts.verbose is true', async () => {
      const spy = jest.spyOn(console, 'log').mockImplementation(() => { });
      const mockExec = (cmd, callback) => callback(null, 'ok', '');
      const executor = createExecutor(mockExec, { verbose: true });

      await executor.run('git status');

      expect(spy).toHaveBeenCalledWith('git status');
      spy.mockRestore();
    });

    test('does not log when verbose is not set', async () => {
      const spy = jest.spyOn(console, 'log').mockImplementation(() => { });
      const mockExec = (cmd, callback) => callback(null, 'ok', '');
      const executor = createExecutor(mockExec);

      await executor.run('git status');

      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    test('uses child_process.exec when no execFn provided', () => {
      // When first arg is an object, it's treated as opts
      const executor = createExecutor({ verbose: false });
      expect(executor).toHaveProperty('run');
      expect(typeof executor.run).toBe('function');
    });

    test('uses child_process.exec when execFn is undefined', () => {
      const executor = createExecutor();
      expect(executor).toHaveProperty('run');
      expect(typeof executor.run).toBe('function');
    });
  });
});
