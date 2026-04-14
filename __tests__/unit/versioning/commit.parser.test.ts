// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import {
  parseCommit,
  parseGitLog,
  CONVENTIONAL_TYPES,
  COMMIT_SEPARATOR,
  GIT_LOG_FORMAT,
} from '../../../src/versioning/commit.parser';
import type { ConventionalCommit } from '../../../src/versioning/commit.parser';

describe('parseCommit', () => {
  test('parses feat(scope): description', () => {
    const result = parseCommit('feat(parser): add new feature');
    expect(result.valid).toBe(true);
    const c = result as ConventionalCommit;
    expect(c.type).toBe('feat');
    expect(c.scope).toBe('parser');
    expect(c.description).toBe('add new feature');
    expect(c.breaking).toBe(false);
    expect(c.body).toBeNull();
    expect(c.footers).toEqual([]);
  });

  test('parses fix!: breaking change via bang', () => {
    const result = parseCommit('fix!: breaking change');
    expect(result.valid).toBe(true);
    const c = result as ConventionalCommit;
    expect(c.type).toBe('fix');
    expect(c.scope).toBeNull();
    expect(c.description).toBe('breaking change');
    expect(c.breaking).toBe(true);
  });

  test('parses chore: routine', () => {
    const result = parseCommit('chore: routine maintenance');
    expect(result.valid).toBe(true);
    const c = result as ConventionalCommit;
    expect(c.type).toBe('chore');
    expect(c.scope).toBeNull();
    expect(c.description).toBe('routine maintenance');
    expect(c.breaking).toBe(false);
  });

  test('parses multiline body with footers', () => {
    const msg = [
      'feat(api): add user endpoint',
      '',
      'This adds a new REST endpoint for user management.',
      'It supports CRUD operations.',
      '',
      'Reviewed-by: Alice',
      'Refs: #42',
    ].join('\n');

    const result = parseCommit(msg);
    expect(result.valid).toBe(true);
    const c = result as ConventionalCommit;
    expect(c.type).toBe('feat');
    expect(c.scope).toBe('api');
    expect(c.description).toBe('add user endpoint');
    expect(c.body).toBe(
      'This adds a new REST endpoint for user management.\nIt supports CRUD operations.',
    );
    expect(c.footers).toEqual([
      { token: 'Reviewed-by', value: 'Alice' },
      { token: 'Refs', value: '#42' },
    ]);
    expect(c.breaking).toBe(false);
  });

  test('parses footer BREAKING CHANGE: desc', () => {
    const msg = [
      'refactor: change API surface',
      '',
      'BREAKING CHANGE: removed deprecated endpoints',
    ].join('\n');

    const result = parseCommit(msg);
    expect(result.valid).toBe(true);
    const c = result as ConventionalCommit;
    expect(c.type).toBe('refactor');
    expect(c.breaking).toBe(true);
    expect(c.footers).toEqual([
      { token: 'BREAKING CHANGE', value: 'removed deprecated endpoints' },
    ]);
  });

  test('parses footer with # (Fixes #123)', () => {
    const msg = [
      'fix(core): resolve crash on startup',
      '',
      'Fixes #123',
    ].join('\n');

    const result = parseCommit(msg);
    expect(result.valid).toBe(true);
    const c = result as ConventionalCommit;
    expect(c.type).toBe('fix');
    expect(c.footers).toEqual([
      { token: 'Fixes', value: '123' },
    ]);
  });

  test('returns valid: false for invalid message', () => {
    const result = parseCommit('this is not a conventional commit');
    expect(result.valid).toBe(false);
    expect(result.rawMessage).toBe('this is not a conventional commit');
  });

  test('returns valid: false for empty string', () => {
    const result = parseCommit('');
    expect(result.valid).toBe(false);
    expect(result.rawMessage).toBe('');
  });

  test('parses BREAKING-CHANGE footer variant', () => {
    const msg = [
      'feat: new feature',
      '',
      'BREAKING-CHANGE: old API removed',
    ].join('\n');

    const result = parseCommit(msg);
    expect(result.valid).toBe(true);
    const c = result as ConventionalCommit;
    expect(c.breaking).toBe(true);
    expect(c.footers).toEqual([
      { token: 'BREAKING-CHANGE', value: 'old API removed' },
    ]);
  });

  test('handles Windows-style CRLF newlines', () => {
    const msg = 'feat(ui): add button\r\n\r\nNew button component.\r\n\r\nFixes #10';
    const result = parseCommit(msg);
    expect(result.valid).toBe(true);
    const c = result as ConventionalCommit;
    expect(c.body).toBe('New button component.');
    expect(c.footers).toEqual([{ token: 'Fixes', value: '10' }]);
  });
});

describe('parseGitLog', () => {
  test('parses multiple commits from git log output', () => {
    const log = [
      'abc1234567890123456789012345678901234567',
      'feat(core): first feature',
      '',
      COMMIT_SEPARATOR,
      'def1234567890123456789012345678901234567',
      'fix: second fix',
      '',
      COMMIT_SEPARATOR,
      'aaa1234567890123456789012345678901234567',
      'not a conventional commit',
      '',
      COMMIT_SEPARATOR,
    ].join('\n');

    const results = parseGitLog(log);
    expect(results).toHaveLength(3);

    expect(results[0].hash).toBe('abc1234567890123456789012345678901234567');
    expect(results[0].parsed.valid).toBe(true);
    expect((results[0].parsed as ConventionalCommit).type).toBe('feat');

    expect(results[1].hash).toBe('def1234567890123456789012345678901234567');
    expect(results[1].parsed.valid).toBe(true);
    expect((results[1].parsed as ConventionalCommit).type).toBe('fix');

    expect(results[2].hash).toBe('aaa1234567890123456789012345678901234567');
    expect(results[2].parsed.valid).toBe(false);
  });

  test('returns empty array for empty input', () => {
    expect(parseGitLog('')).toEqual([]);
  });

  test('skips chunks with invalid hash', () => {
    const log = [
      'not-a-hash',
      'feat: something',
      '',
      COMMIT_SEPARATOR,
    ].join('\n');

    expect(parseGitLog(log)).toEqual([]);
  });
});

describe('exports', () => {
  test('CONVENTIONAL_TYPES contains standard types', () => {
    expect(CONVENTIONAL_TYPES).toContain('feat');
    expect(CONVENTIONAL_TYPES).toContain('fix');
    expect(CONVENTIONAL_TYPES).toContain('chore');
    expect(CONVENTIONAL_TYPES).toContain('docs');
    expect(CONVENTIONAL_TYPES).toContain('refactor');
    expect(CONVENTIONAL_TYPES).toContain('perf');
    expect(CONVENTIONAL_TYPES).toContain('test');
    expect(CONVENTIONAL_TYPES).toContain('build');
    expect(CONVENTIONAL_TYPES).toContain('ci');
    expect(CONVENTIONAL_TYPES).toContain('revert');
  });

  test('COMMIT_SEPARATOR is a non-empty string', () => {
    expect(typeof COMMIT_SEPARATOR).toBe('string');
    expect(COMMIT_SEPARATOR.length).toBeGreaterThan(0);
  });

  test('GIT_LOG_FORMAT contains COMMIT_SEPARATOR', () => {
    expect(GIT_LOG_FORMAT).toContain(COMMIT_SEPARATOR);
  });
});
