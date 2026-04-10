// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau
// Feature: version-intelligence-release-narrative
// Property 1: Round-trip of parsing and printing Conventional Commits
// Property 2: Invalid messages return valid: false

import * as fc from 'fast-check';
import { parseCommit } from '../../commit.parser';
import { printCommit } from '../../commit.printer';
import type { ConventionalCommit, CommitFooter } from '../../commit.parser';

// ── Arbitraries ─────────────────────────────────────────────────────────────

/** Word-char string suitable for CC type (e.g. feat, fix, customType123) */
const arbType = fc.stringOf(
  fc.mapToConstant(
    { num: 26, build: (v) => String.fromCharCode(97 + v) },  // a-z
    { num: 26, build: (v) => String.fromCharCode(65 + v) },  // A-Z
    { num: 10, build: (v) => String.fromCharCode(48 + v) },  // 0-9
    { num: 1, build: () => '_' },
  ),
  { minLength: 1, maxLength: 20 },
);

/** Scope: null or a non-empty word-char string (no parens, no spaces) */
const arbScope = fc.oneof(
  fc.constant(null),
  fc.stringOf(
    fc.mapToConstant(
      { num: 26, build: (v) => String.fromCharCode(97 + v) },
      { num: 10, build: (v) => String.fromCharCode(48 + v) },
      { num: 1, build: () => '-' },
    ),
    { minLength: 1, maxLength: 30 },
  ),
);

/**
 * Description: non-empty, single-line, no leading/trailing whitespace.
 * Avoids chars that could confuse the parser.
 */
const arbDescription = fc.stringOf(
  fc.mapToConstant(
    { num: 26, build: (v) => String.fromCharCode(97 + v) },
    { num: 26, build: (v) => String.fromCharCode(65 + v) },
    { num: 10, build: (v) => String.fromCharCode(48 + v) },
    { num: 1, build: () => ' ' },
    { num: 1, build: () => '-' },
    { num: 1, build: () => '.' },
  ),
  { minLength: 1, maxLength: 80 },
).map((s) => s.trim()).filter((s) => s.length > 0);

/**
 * Body: null or multi-line text that does NOT contain footer-like lines.
 * We use simple alphanumeric + space lines to avoid ambiguity with footer patterns.
 */
const arbBodyLine = fc.stringOf(
  fc.mapToConstant(
    { num: 26, build: (v) => String.fromCharCode(97 + v) },
    { num: 26, build: (v) => String.fromCharCode(65 + v) },
    { num: 10, build: (v) => String.fromCharCode(48 + v) },
    { num: 1, build: () => ' ' },
    { num: 1, build: () => ',' },
    { num: 1, build: () => '.' },
  ),
  { minLength: 1, maxLength: 60 },
).map((s) => s.trim()).filter((s) => s.length > 0);

const arbBody = fc.oneof(
  fc.constant(null),
  fc.array(arbBodyLine, { minLength: 1, maxLength: 3 }).map((lines) => lines.join('\n')),
);

/**
 * Footer token: word-char string (not BREAKING CHANGE/BREAKING-CHANGE,
 * those are handled separately). Must not be empty.
 */
const arbFooterToken = fc.stringOf(
  fc.mapToConstant(
    { num: 26, build: (v) => String.fromCharCode(65 + v) },
    { num: 26, build: (v) => String.fromCharCode(97 + v) },
    { num: 1, build: () => '-' },
  ),
  { minLength: 2, maxLength: 20 },
).filter((s) => s !== 'BREAKING-CHANGE' && !s.startsWith('-') && !s.endsWith('-'));

/** Footer value: non-empty, single-line */
const arbFooterValue = fc.stringOf(
  fc.mapToConstant(
    { num: 26, build: (v) => String.fromCharCode(97 + v) },
    { num: 10, build: (v) => String.fromCharCode(48 + v) },
    { num: 1, build: () => ' ' },
  ),
  { minLength: 1, maxLength: 40 },
).map((s) => s.trim()).filter((s) => s.length > 0);

/** Regular footer (non-breaking) */
const arbRegularFooter: fc.Arbitrary<CommitFooter> = fc.record({
  token: arbFooterToken,
  value: arbFooterValue,
});

/** Breaking footer */
const arbBreakingFooter: fc.Arbitrary<CommitFooter> = fc.record({
  token: fc.constantFrom('BREAKING CHANGE', 'BREAKING-CHANGE'),
  value: arbFooterValue,
});

/**
 * Generate a valid ConventionalCommit with consistent breaking flag.
 * The printer omits `!` when a BREAKING CHANGE footer exists,
 * so we model this correctly for round-trip.
 */
const arbConventionalCommit: fc.Arbitrary<ConventionalCommit> = fc.record({
  type: arbType,
  scope: arbScope,
  description: arbDescription,
  body: arbBody,
  regularFooters: fc.array(arbRegularFooter, { minLength: 0, maxLength: 3 }),
  breakingVia: fc.constantFrom('none', 'bang', 'footer') as fc.Arbitrary<'none' | 'bang' | 'footer'>,
}).chain(({ type, scope, description, body, regularFooters, breakingVia }) => {
  if (breakingVia === 'footer') {
    return arbBreakingFooter.map((bf) => ({
      valid: true as const,
      type,
      scope,
      description,
      body,
      footers: [...regularFooters, bf],
      breaking: true,
      rawMessage: '',
    }));
  }

  return fc.constant({
    valid: true as const,
    type,
    scope,
    description,
    body,
    footers: regularFooters,
    breaking: breakingVia === 'bang',
    rawMessage: '',
  });
});

// ── Header regex (same as in commit.parser.ts) ─────────────────────────────

const HEADER_RE = /^(\w+)(?:\(([^)]*)\))?(!)?\s*:\s*(.+)$/;

// ── Property Tests ──────────────────────────────────────────────────────────

describe('Property 1: Round-trip of parsing and printing Conventional Commits', () => {
  /**
   * **Validates: Requirements 1.1, 1.2, 1.3, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5**
   *
   * For any valid ConventionalCommit, printCommit → parseCommit should
   * produce an equivalent ConventionalCommit (same type, scope, description,
   * body, footers, breaking).
   */
  test('parseCommit(printCommit(commit)) preserves all semantic fields', () => {
    fc.assert(
      fc.property(arbConventionalCommit, (commit) => {
        const printed = printCommit(commit);
        const reparsed = parseCommit(printed);

        expect(reparsed.valid).toBe(true);
        const c = reparsed as ConventionalCommit;
        expect(c.type).toBe(commit.type);
        expect(c.scope).toBe(commit.scope);
        expect(c.description).toBe(commit.description);
        expect(c.body).toBe(commit.body);
        expect(c.footers).toEqual(commit.footers);
        expect(c.breaking).toBe(commit.breaking);
      }),
      { numRuns: 200 },
    );
  });

  test('printed output is always parseable as valid', () => {
    fc.assert(
      fc.property(arbConventionalCommit, (commit) => {
        const printed = printCommit(commit);
        const reparsed = parseCommit(printed);
        expect(reparsed.valid).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});

describe('Property 2: Invalid messages return valid: false', () => {
  /**
   * **Validates: Requirements 1.5**
   *
   * Any string whose first line does not match the Conventional Commits
   * header format should be parsed as invalid.
   */
  test('strings not matching CC header format return valid: false', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 200 }),
        (message) => {
          const firstLine = message.split('\n')[0];
          fc.pre(!HEADER_RE.test(firstLine));

          const result = parseCommit(message);
          expect(result.valid).toBe(false);
          expect(result.rawMessage).toBe(message);
        },
      ),
      { numRuns: 200 },
    );
  });

  test('empty and whitespace-only strings return valid: false', () => {
    fc.assert(
      fc.property(
        fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 0, maxLength: 20 }),
        (message) => {
          const result = parseCommit(message);
          expect(result.valid).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  test('strings without colon separator return valid: false', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => !s.includes(':')),
        (message) => {
          const result = parseCommit(message);
          expect(result.valid).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
