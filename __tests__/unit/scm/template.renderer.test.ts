// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { parseTemplate, formatTemplate, renderTemplate, TEMPLATE_VARIABLES, INVALID_BRANCH_CHARS } from '../../../src/scm/template.renderer';
import { EXIT_CODES, VersioningsError } from '../../../src/core/errors';
import type { TemplateContext } from '../../../src/scm/template.renderer';

const defaultContext: TemplateContext = {
  version: '1.2.3',
  major: '1',
  minor: '2',
  patch: '3',
  semver: 'patch',
  comment: 'fix-login',
  branchType: 'version',
};

describe('parseTemplate', () => {
  it('parses template with literals and variables', () => {
    const parts = parseTemplate('release/{version}');
    expect(parts).toEqual([
      { type: 'literal', value: 'release/' },
      { type: 'variable', value: 'version' },
    ]);
  });

  it('parses template without variables (static branch)', () => {
    const parts = parseTemplate('static-branch');
    expect(parts).toEqual([
      { type: 'literal', value: 'static-branch' },
    ]);
  });

  it('parses template only from variables', () => {
    const parts = parseTemplate('{semver}/{version}');
    expect(parts).toEqual([
      { type: 'variable', value: 'semver' },
      { type: 'literal', value: '/' },
      { type: 'variable', value: 'version' },
    ]);
  });

  it('parses complex template with multiple variables and literals', () => {
    const parts = parseTemplate('{branchType}/{semver}/{version}/{comment}');
    expect(parts).toEqual([
      { type: 'variable', value: 'branchType' },
      { type: 'literal', value: '/' },
      { type: 'variable', value: 'semver' },
      { type: 'literal', value: '/' },
      { type: 'variable', value: 'version' },
      { type: 'literal', value: '/' },
      { type: 'variable', value: 'comment' },
    ]);
  });

  it('throws VersioningsError with CONFIG_ERROR for unknown variable', () => {
    try {
      parseTemplate('{unknown}');
      fail('Expected VersioningsError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect((err as VersioningsError).code).toBe(EXIT_CODES.CONFIG_ERROR);
      expect((err as VersioningsError).message).toContain('unknown');
      expect((err as VersioningsError).message).toContain('{version}');
    }
  });

  it('throws VersioningsError for unknown variable mixed with valid ones', () => {
    try {
      parseTemplate('release/{version}/{foo}');
      fail('Expected VersioningsError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect((err as VersioningsError).code).toBe(EXIT_CODES.CONFIG_ERROR);
      expect((err as VersioningsError).message).toContain('foo');
    }
  });
});

describe('formatTemplate', () => {
  it('formats parts back to template string', () => {
    const parts = [
      { type: 'literal' as const, value: 'release/' },
      { type: 'variable' as const, value: 'version' },
    ];
    expect(formatTemplate(parts)).toBe('release/{version}');
  });

  it('formats literal-only parts', () => {
    const parts = [{ type: 'literal' as const, value: 'static-branch' }];
    expect(formatTemplate(parts)).toBe('static-branch');
  });

  it('formats variable-only parts', () => {
    const parts = [
      { type: 'variable' as const, value: 'semver' },
      { type: 'literal' as const, value: '/' },
      { type: 'variable' as const, value: 'version' },
    ];
    expect(formatTemplate(parts)).toBe('{semver}/{version}');
  });
});

describe('round-trip: formatTemplate(parseTemplate(template))', () => {
  const templates = [
    'release/{version}',
    '{branchType}/{semver}/{version}/{comment}',
    'static-branch',
    '{semver}/{version}',
    'v{version}',
    '{version}--{comment}',
    'hotfix/{version}',
    'support/{major}.{minor}',
  ];

  it.each(templates)('round-trip preserves template: %s', (template) => {
    expect(formatTemplate(parseTemplate(template))).toBe(template);
  });
});

describe('renderTemplate', () => {
  it('substitutes all variables correctly', () => {
    const result = renderTemplate('{branchType}/{semver}/{version}/{comment}', defaultContext);
    expect(result).toBe('version/patch/1.2.3/fix-login');
  });

  it('renders template with single variable', () => {
    const result = renderTemplate('v{version}', defaultContext);
    expect(result).toBe('v1.2.3');
  });

  it('renders tag template with version and comment', () => {
    const result = renderTemplate('{version}--{comment}', defaultContext);
    expect(result).toBe('1.2.3--fix-login');
  });

  it('renders support branch with major and minor', () => {
    const result = renderTemplate('support/{major}.{minor}', defaultContext);
    expect(result).toBe('support/1.2');
  });

  it('trims leading / and -', () => {
    const result = renderTemplate('/{version}', defaultContext);
    expect(result).toBe('1.2.3');
  });

  it('trims trailing / and -', () => {
    const ctx: TemplateContext = { ...defaultContext, comment: '' };
    const result = renderTemplate('{version}/{comment}', ctx);
    // After substitution: "1.2.3/" → trimmed to "1.2.3"
    expect(result).toBe('1.2.3');
  });

  it('trims leading and trailing - characters', () => {
    const result = renderTemplate('-{version}-', defaultContext);
    expect(result).toBe('1.2.3');
  });

  it('renders empty comment correctly (trailing separator trimmed)', () => {
    const ctx: TemplateContext = { ...defaultContext, comment: '' };
    const result = renderTemplate('{version}--{comment}', ctx);
    // After substitution: "1.2.3--" → trimmed trailing "-" → "1.2.3"
    expect(result).toBe('1.2.3');
  });

  it('renders template without variables', () => {
    const result = renderTemplate('static-branch', defaultContext);
    expect(result).toBe('static-branch');
  });

  it('renders template only from variables', () => {
    const result = renderTemplate('{semver}/{version}', defaultContext);
    expect(result).toBe('patch/1.2.3');
  });

  it('throws VersioningsError with INVALID_ARGS for invalid characters in result', () => {
    const ctx: TemplateContext = { ...defaultContext, comment: 'has space' };
    try {
      renderTemplate('{version}/{comment}', ctx);
      fail('Expected VersioningsError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect((err as VersioningsError).code).toBe(EXIT_CODES.INVALID_ARGS);
      expect((err as VersioningsError).message).toContain('invalid');
    }
  });

  it('throws VersioningsError with INVALID_ARGS for tilde in result', () => {
    const ctx: TemplateContext = { ...defaultContext, comment: 'bad~ref' };
    try {
      renderTemplate('{version}/{comment}', ctx);
      fail('Expected VersioningsError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect((err as VersioningsError).code).toBe(EXIT_CODES.INVALID_ARGS);
    }
  });

  it('throws VersioningsError with INVALID_ARGS for caret in result', () => {
    const ctx: TemplateContext = { ...defaultContext, comment: 'bad^ref' };
    try {
      renderTemplate('{version}/{comment}', ctx);
      fail('Expected VersioningsError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect((err as VersioningsError).code).toBe(EXIT_CODES.INVALID_ARGS);
    }
  });
});

describe('TEMPLATE_VARIABLES', () => {
  it('contains all expected variables', () => {
    expect(TEMPLATE_VARIABLES).toEqual(
      expect.arrayContaining(['version', 'major', 'minor', 'patch', 'semver', 'comment', 'branchType']),
    );
  });

  it('has exactly 7 variables', () => {
    expect(TEMPLATE_VARIABLES).toHaveLength(7);
  });
});

describe('INVALID_BRANCH_CHARS', () => {
  it('matches space', () => {
    expect(INVALID_BRANCH_CHARS.test(' ')).toBe(true);
  });

  it('matches tilde', () => {
    expect(INVALID_BRANCH_CHARS.test('~')).toBe(true);
  });

  it('matches caret', () => {
    expect(INVALID_BRANCH_CHARS.test('^')).toBe(true);
  });

  it('matches colon', () => {
    expect(INVALID_BRANCH_CHARS.test(':')).toBe(true);
  });

  it('does not match valid branch characters', () => {
    expect(INVALID_BRANCH_CHARS.test('a')).toBe(false);
    expect(INVALID_BRANCH_CHARS.test('1')).toBe(false);
    expect(INVALID_BRANCH_CHARS.test('-')).toBe(false);
    expect(INVALID_BRANCH_CHARS.test('/')).toBe(false);
    expect(INVALID_BRANCH_CHARS.test('.')).toBe(false);
  });
});
