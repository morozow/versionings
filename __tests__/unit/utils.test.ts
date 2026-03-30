/* Versioning automation tool, 2018-present */

import {
  ANSI_FG_RED,
  ANSI_FG_YELLOW,
  ANSI_FG_GREEN,
  ANSI_FG_NC,
  EMPTY_LINE,
  EMPTY_STRING,
  get,
  Logger,
  execAction,
  stop,
} from '../../utils';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ANSI color constants', () => {
  test('ANSI_FG_RED is a non-empty string', () => {
    expect(typeof ANSI_FG_RED).toBe('string');
    expect(ANSI_FG_RED.length).toBeGreaterThan(0);
  });

  test('ANSI_FG_YELLOW is a non-empty string', () => {
    expect(typeof ANSI_FG_YELLOW).toBe('string');
    expect(ANSI_FG_YELLOW.length).toBeGreaterThan(0);
  });

  test('ANSI_FG_GREEN is a non-empty string', () => {
    expect(typeof ANSI_FG_GREEN).toBe('string');
    expect(ANSI_FG_GREEN.length).toBeGreaterThan(0);
  });

  test('ANSI_FG_NC is a non-empty string (no color / reset)', () => {
    expect(typeof ANSI_FG_NC).toBe('string');
    expect(ANSI_FG_NC.length).toBeGreaterThan(0);
  });

  test('EMPTY_LINE is a newline character', () => {
    expect(EMPTY_LINE).toBe('\n');
  });

  test('EMPTY_STRING is an empty string', () => {
    expect(EMPTY_STRING).toBe('');
  });
});

describe('get()', () => {
  test('retrieves a top-level property', () => {
    expect(get({ a: 1 }, 'a')).toBe(1);
  });

  test('retrieves a nested property', () => {
    const obj = { a: { b: { c: 42 } } };
    expect(get(obj, 'a.b.c')).toBe(42);
  });

  test('returns default value for missing path', () => {
    expect(get({ a: 1 }, 'b.c', 'default')).toBe('default');
  });

  test('throws when path is missing and no default given (unsafe traversal)', () => {
    expect(() => get({ a: 1 }, 'x.y.z')).toThrow(TypeError);
  });

  test('returns default when intermediate property is undefined', () => {
    expect(get({ a: {} }, 'a.b.c', 'fallback')).toBe('fallback');
  });
});

describe('Logger.stack()', () => {
  test('calls console.log for each entry in the log stack', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => { });
    const logStack: any[][] = [['hello'], ['world', 42]];
    Logger.stack(logStack);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, 'hello');
    expect(spy).toHaveBeenNthCalledWith(2, 'world', 42);
  });

  test('does nothing for an empty stack', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => { });
    Logger.stack([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('Logger.error()', () => {
  test('logs and exits when error is non-null and exitConditions.error is true', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => { });
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => { }) as any);
    Logger.error(new Error('boom'), '', { error: true, stderr: true });
    expect(logSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  test('logs error but does not exit when exitConditions.error is false', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => { });
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => { }) as any);
    Logger.error(new Error('boom'), '', { error: false, stderr: true });
    expect(logSpy).toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('logs stderr and exits when stderr is truthy and exitConditions.stderr is true', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => { });
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => { }) as any);
    Logger.error(null, 'some stderr', { error: true, stderr: true });
    expect(logSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  test('does nothing when error is null and stderr is empty', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => { });
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => { }) as any);
    Logger.error(null, '', { error: true, stderr: true });
    expect(logSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

describe('execAction()', () => {
  test('returns a function', () => {
    const wrapper = execAction(() => { });
    expect(typeof wrapper).toBe('function');
  });

  test('returned function calls Logger.error then the callback', () => {
    const errorSpy = jest.spyOn(Logger, 'error').mockImplementation(() => { });
    const callback = jest.fn();
    const wrapper = execAction(callback, { error: false, stderr: false });
    wrapper(null, 'response', 'stderr');
    expect(errorSpy).toHaveBeenCalledWith(null, 'stderr', { error: false, stderr: false });
    expect(callback).toHaveBeenCalledWith('response', 'stderr', null);
  });

  test('uses default exitConditions { error: true, stderr: true }', () => {
    const errorSpy = jest.spyOn(Logger, 'error').mockImplementation(() => { });
    const callback = jest.fn();
    const wrapper = execAction(callback);
    wrapper(null, 'resp', '');
    expect(errorSpy).toHaveBeenCalledWith(null, '', { error: true, stderr: true });
  });
});

describe('stop()', () => {
  test('calls process.exit(0)', () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => { }) as any);
    stop();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  test('calls Logger.stack when action is a non-empty array, then exits', () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => { }) as any);
    const stackSpy = jest.spyOn(Logger, 'stack').mockImplementation(() => { });
    stop(['some message']);
    expect(stackSpy).toHaveBeenCalledWith([['some message']]);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  test('does not call Logger.stack when action is undefined', () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => { }) as any);
    const stackSpy = jest.spyOn(Logger, 'stack').mockImplementation(() => { });
    stop();
    expect(stackSpy).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  test('does not call Logger.stack when action is an empty array', () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => { }) as any);
    const stackSpy = jest.spyOn(Logger, 'stack').mockImplementation(() => { });
    stop([]);
    expect(stackSpy).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
