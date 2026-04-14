// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { parseYaml, serializeYaml } from '../../../src/config/yaml.parser';
import { EXIT_CODES, VersioningsError } from '../../../src/core/errors';

describe('parseYaml', () => {
  test('parses valid YAML into a JavaScript object', () => {
    const yaml = `
git:
  platform: github
  url: https://github.com/org/repo
`;
    const result = parseYaml(yaml, '.versioningsrc.yml');
    expect(result).toEqual({
      git: {
        platform: 'github',
        url: 'https://github.com/org/repo',
      },
    });
  });

  test('parses YAML with strings, numbers, booleans, and nested objects', () => {
    const yaml = `
name: my-project
version: 42
enabled: true
nested:
  deep:
    value: hello
`;
    const result = parseYaml(yaml, 'test.yml');
    expect(result).toEqual({
      name: 'my-project',
      version: 42,
      enabled: true,
      nested: { deep: { value: 'hello' } },
    });
  });

  test('throws VersioningsError with CONFIG_ERROR on invalid YAML syntax', () => {
    const badYaml = `
git:
  platform: github
    url: bad-indent
`;
    try {
      parseYaml(badYaml, 'broken.yml');
      fail('Expected VersioningsError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(VersioningsError);
      const ve = err as VersioningsError;
      expect(ve.code).toBe(EXIT_CODES.CONFIG_ERROR);
      expect(ve.message).toContain('broken.yml');
    }
  });

  test('includes line number in error for invalid YAML', () => {
    const badYaml = `key: value\n  bad: indent`;
    try {
      parseYaml(badYaml, 'file.yml');
      fail('Expected VersioningsError to be thrown');
    } catch (err) {
      const ve = err as VersioningsError;
      expect(ve.code).toBe(EXIT_CODES.CONFIG_ERROR);
      expect(ve.message).toMatch(/line \d+/);
      expect(ve.details).toBeDefined();
      expect(ve.details!.filePath).toBe('file.yml');
    }
  });

  test('throws VersioningsError when YAML is null', () => {
    expect(() => parseYaml('', 'empty.yml')).toThrow(VersioningsError);
    try {
      parseYaml('', 'empty.yml');
    } catch (err) {
      const ve = err as VersioningsError;
      expect(ve.code).toBe(EXIT_CODES.CONFIG_ERROR);
      expect(ve.message).toContain('null');
    }
  });

  test('throws VersioningsError when YAML is an array', () => {
    const arrayYaml = `- one\n- two\n- three`;
    expect(() => parseYaml(arrayYaml, 'array.yml')).toThrow(VersioningsError);
    try {
      parseYaml(arrayYaml, 'array.yml');
    } catch (err) {
      const ve = err as VersioningsError;
      expect(ve.code).toBe(EXIT_CODES.CONFIG_ERROR);
      expect(ve.message).toContain('array');
    }
  });

  test('throws VersioningsError when YAML is a scalar', () => {
    expect(() => parseYaml('just a string', 'scalar.yml')).toThrow(VersioningsError);
    try {
      parseYaml('just a string', 'scalar.yml');
    } catch (err) {
      const ve = err as VersioningsError;
      expect(ve.code).toBe(EXIT_CODES.CONFIG_ERROR);
      expect(ve.details!.filePath).toBe('scalar.yml');
    }
  });
});

describe('serializeYaml', () => {
  test('produces valid YAML that can be parsed back', () => {
    const obj = {
      git: {
        platform: 'github',
        url: 'https://github.com/org/repo',
        pr: { target: 'main' },
      },
    };
    const yamlStr = serializeYaml(obj);
    const parsed = parseYaml(yamlStr, 'roundtrip.yml');
    expect(parsed).toEqual(obj);
  });

  test('round-trip preserves strings, numbers, booleans, and nested objects', () => {
    const obj = {
      str: 'hello',
      num: 123,
      float: 3.14,
      bool: true,
      boolFalse: false,
      nested: {
        a: 1,
        b: 'two',
        deep: { c: true },
      },
    };
    const yamlStr = serializeYaml(obj);
    const parsed = parseYaml(yamlStr, 'types.yml');
    expect(parsed).toEqual(obj);
  });

  test('returns a string', () => {
    const result = serializeYaml({ key: 'value' });
    expect(typeof result).toBe('string');
  });
});
