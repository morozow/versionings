// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { EXIT_CODES, VersioningsError } from '../../errors';

describe('EXIT_CODES', () => {
  test('contains all expected codes with correct values', () => {
    expect(EXIT_CODES).toEqual({
      SUCCESS: 0,
      CONFIG_ERROR: 1,
      DIRTY_TREE: 2,
      INVALID_ARGS: 3,
      ARTIFACT_CONFLICT: 4,
      COMMAND_FAILED: 5,
      NETWORK_ERROR: 6,
      INCOMPLETE_ROLLBACK: 7,
    });
  });

  test('has exactly 8 entries', () => {
    expect(Object.keys(EXIT_CODES)).toHaveLength(8);
  });

  test('is frozen (immutable)', () => {
    expect(Object.isFrozen(EXIT_CODES)).toBe(true);
    (EXIT_CODES as any).SUCCESS = 99;
    expect(EXIT_CODES.SUCCESS).toBe(0);
    (EXIT_CODES as any).NEW_CODE = 10;
    expect((EXIT_CODES as any).NEW_CODE).toBeUndefined();
  });
});

describe('VersioningsError', () => {
  test('extends Error', () => {
    const err = new VersioningsError(1, 'test');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(VersioningsError);
  });

  test('sets code, message, and details correctly', () => {
    const details = { path: '/some/path' };
    const err = new VersioningsError(EXIT_CODES.CONFIG_ERROR, 'Config missing', details);
    expect(err.code).toBe(1);
    expect(err.message).toBe('Config missing');
    expect(err.details).toBe(details);
  });

  test('defaults details to null', () => {
    const err = new VersioningsError(EXIT_CODES.COMMAND_FAILED, 'cmd failed');
    expect(err.details).toBeNull();
  });

  test('has name set to VersioningsError', () => {
    const err = new VersioningsError(0, 'ok');
    expect(err.name).toBe('VersioningsError');
  });

  test('has a stack trace', () => {
    const err = new VersioningsError(EXIT_CODES.DIRTY_TREE, 'dirty');
    expect(err.stack).toBeDefined();
    expect(typeof err.stack).toBe('string');
    expect(err.stack!.length).toBeGreaterThan(0);
  });

  test('works with all exit codes', () => {
    for (const [key, code] of Object.entries(EXIT_CODES)) {
      const err = new VersioningsError(code, `error for ${key}`);
      expect(err.code).toBe(code);
      expect(err.message).toBe(`error for ${key}`);
      expect(err.details).toBeNull();
    }
  });
});
