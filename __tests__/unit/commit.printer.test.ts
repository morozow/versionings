// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { printCommit } from '../../commit.printer';
import { parseCommit } from '../../commit.parser';
import type { ConventionalCommit } from '../../commit.parser';

/** Helper to build a valid ConventionalCommit object */
function makeCommit(overrides: Partial<ConventionalCommit> = {}): ConventionalCommit {
  return {
    valid: true,
    type: 'feat',
    scope: null,
    description: 'add feature',
    body: null,
    footers: [],
    breaking: false,
    rawMessage: '',
    ...overrides,
  };
}

describe('printCommit', () => {
  test('prints commit with scope', () => {
    const result = printCommit(makeCommit({ type: 'feat', scope: 'parser', description: 'add new feature' }));
    expect(result).toBe('feat(parser): add new feature');
  });

  test('prints commit without scope', () => {
    const result = printCommit(makeCommit({ type: 'fix', description: 'resolve crash' }));
    expect(result).toBe('fix: resolve crash');
  });

  test('prints commit with breaking ! when no BREAKING CHANGE footer', () => {
    const result = printCommit(makeCommit({ type: 'fix', breaking: true, description: 'drop old API' }));
    expect(result).toBe('fix!: drop old API');
  });

  test('omits ! when breaking is true but BREAKING CHANGE footer exists', () => {
    const result = printCommit(makeCommit({
      type: 'refactor',
      breaking: true,
      description: 'change API surface',
      footers: [{ token: 'BREAKING CHANGE', value: 'removed deprecated endpoints' }],
    }));
    expect(result).not.toContain('!:');
    expect(result).toContain('BREAKING CHANGE: removed deprecated endpoints');
  });

  test('omits ! when breaking is true but BREAKING-CHANGE footer exists', () => {
    const result = printCommit(makeCommit({
      type: 'feat',
      breaking: true,
      description: 'new feature',
      footers: [{ token: 'BREAKING-CHANGE', value: 'old API removed' }],
    }));
    expect(result).not.toContain('!:');
    expect(result).toContain('BREAKING-CHANGE: old API removed');
  });

  test('prints commit with footers', () => {
    const result = printCommit(makeCommit({
      type: 'feat',
      scope: 'api',
      description: 'add user endpoint',
      footers: [
        { token: 'Reviewed-by', value: 'Alice' },
        { token: 'Refs', value: '#42' },
      ],
    }));
    expect(result).toBe(
      'feat(api): add user endpoint\n\nReviewed-by: Alice\nRefs: #42',
    );
  });

  test('prints commit with body', () => {
    const result = printCommit(makeCommit({
      type: 'feat',
      description: 'add feature',
      body: 'This is a detailed body.\nWith multiple lines.',
    }));
    expect(result).toBe(
      'feat: add feature\n\nThis is a detailed body.\nWith multiple lines.',
    );
  });

  test('prints commit with body and footers separated by blank lines', () => {
    const result = printCommit(makeCommit({
      type: 'feat',
      scope: 'core',
      description: 'add feature',
      body: 'Detailed body text.',
      footers: [{ token: 'Fixes', value: '#99' }],
    }));
    expect(result).toBe(
      'feat(core): add feature\n\nDetailed body text.\n\nFixes: #99',
    );
  });
});

describe('printCommit → parseCommit round-trip', () => {
  test('round-trip preserves fields for simple commit', () => {
    const original = makeCommit({ type: 'fix', description: 'resolve crash' });
    const printed = printCommit(original);
    const reparsed = parseCommit(printed);

    expect(reparsed.valid).toBe(true);
    const c = reparsed as ConventionalCommit;
    expect(c.type).toBe(original.type);
    expect(c.scope).toBe(original.scope);
    expect(c.description).toBe(original.description);
    expect(c.body).toBe(original.body);
    expect(c.footers).toEqual(original.footers);
    expect(c.breaking).toBe(original.breaking);
  });

  test('round-trip preserves fields for commit with scope, body, and footers', () => {
    const original = makeCommit({
      type: 'feat',
      scope: 'api',
      description: 'add user endpoint',
      body: 'This adds a new REST endpoint.\nIt supports CRUD.',
      footers: [
        { token: 'Reviewed-by', value: 'Alice' },
        { token: 'Refs', value: '#42' },
      ],
    });
    const printed = printCommit(original);
    const reparsed = parseCommit(printed);

    expect(reparsed.valid).toBe(true);
    const c = reparsed as ConventionalCommit;
    expect(c.type).toBe(original.type);
    expect(c.scope).toBe(original.scope);
    expect(c.description).toBe(original.description);
    expect(c.body).toBe(original.body);
    expect(c.footers).toEqual(original.footers);
    expect(c.breaking).toBe(original.breaking);
  });

  test('round-trip preserves breaking via ! indicator', () => {
    const original = makeCommit({
      type: 'fix',
      breaking: true,
      description: 'drop old API',
    });
    const printed = printCommit(original);
    const reparsed = parseCommit(printed);

    expect(reparsed.valid).toBe(true);
    const c = reparsed as ConventionalCommit;
    expect(c.breaking).toBe(true);
    expect(c.type).toBe('fix');
    expect(c.description).toBe('drop old API');
  });

  test('round-trip preserves breaking via BREAKING CHANGE footer', () => {
    const original = makeCommit({
      type: 'refactor',
      breaking: true,
      description: 'change API surface',
      footers: [{ token: 'BREAKING CHANGE', value: 'removed deprecated endpoints' }],
    });
    const printed = printCommit(original);
    const reparsed = parseCommit(printed);

    expect(reparsed.valid).toBe(true);
    const c = reparsed as ConventionalCommit;
    expect(c.breaking).toBe(true);
    expect(c.footers).toEqual([{ token: 'BREAKING CHANGE', value: 'removed deprecated endpoints' }]);
  });
});
