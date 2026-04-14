// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau
// Feature: version-intelligence-release-narrative
// Property 13: Prepend changelog to existing file preserves content

import * as fc from 'fast-check';
import { prependChangelogContent } from '../../../src/core/pipeline';

// ── Arbitraries ─────────────────────────────────────────────────────────────

/** Safe printable string without null bytes */
const arbSafeLine = fc.stringOf(
  fc.mapToConstant(
    { num: 26, build: (v) => String.fromCharCode(97 + v) },
    { num: 26, build: (v) => String.fromCharCode(65 + v) },
    { num: 10, build: (v) => String.fromCharCode(48 + v) },
    { num: 1, build: () => ' ' },
    { num: 1, build: () => '-' },
    { num: 1, build: () => '#' },
    { num: 1, build: () => '.' },
  ),
  { minLength: 1, maxLength: 60 },
);

/** Generates multi-line content (simulating existing file body) */
const arbMultiLineContent = fc.array(arbSafeLine, { minLength: 1, maxLength: 10 })
  .map((lines) => lines.join('\n'));

/** Generates existing file content WITH `# Changelog` header */
const arbExistingWithHeader = arbMultiLineContent.map(
  (body) => `# Changelog\n\n${body}\n`,
);

/** Generates existing file content WITHOUT `# Changelog` header */
const arbExistingWithoutHeader = arbMultiLineContent.filter(
  (s) => !s.startsWith('# Changelog'),
);

/** Generates a new changelog section (like what generateChangelog produces) */
const arbNewSection = fc.tuple(
  fc.stringOf(fc.mapToConstant({ num: 10, build: (v) => String.fromCharCode(48 + v) }, { num: 1, build: () => '.' }), { minLength: 3, maxLength: 11 }),
  fc.array(arbSafeLine, { minLength: 1, maxLength: 5 }),
).map(([version, items]) => {
  const lines = [`## [${version}] - 2024-01-15`, '', '### Features', ''];
  for (const item of items) {
    lines.push(`- ${item}`);
  }
  lines.push('');
  return lines.join('\n');
});

// ── Property 13 ─────────────────────────────────────────────────────────────

describe('Property 13: Prepend changelog to existing file preserves content', () => {
  /**
   * **Validates: Requirements 7.5, 10.2**
   *
   * For any existing file content and any new changelog section, the prepend
   * operation SHALL:
   * (a) preserve all existing file content
   * (b) insert new section before existing content (after `# Changelog` header if present)
   * (c) not duplicate the `# Changelog` header
   */

  test('file with # Changelog header: new section inserted after header, existing body preserved', () => {
    fc.assert(
      fc.property(arbExistingWithHeader, arbNewSection, (existing, newSection) => {
        const result = prependChangelogContent(existing, newSection);

        // (a) Existing body content (after header line) is preserved in result
        const headerEnd = existing.indexOf('\n');
        const existingBody = existing.slice(headerEnd + 1);
        expect(result).toContain(existingBody);

        // (b) New section appears in result
        expect(result).toContain(newSection);

        // (c) `# Changelog` header appears exactly once
        const headerCount = (result.match(/^# Changelog$/gm) || []).length;
        expect(headerCount).toBe(1);

        // Result starts with the header
        expect(result.startsWith('# Changelog')).toBe(true);

        // New section appears before existing body
        const newSectionIdx = result.indexOf(newSection);
        const existingBodyIdx = result.indexOf(existingBody);
        expect(newSectionIdx).toBeLessThan(existingBodyIdx);
      }),
      { numRuns: 100 },
    );
  });

  test('file without # Changelog header: new section prepended before existing content', () => {
    fc.assert(
      fc.property(arbExistingWithoutHeader, arbNewSection, (existing, newSection) => {
        const result = prependChangelogContent(existing, newSection);

        // (a) All existing content is preserved
        expect(result).toContain(existing);

        // (b) New section appears in result
        expect(result).toContain(newSection);

        // New section appears before existing content
        const newSectionIdx = result.indexOf(newSection);
        const existingIdx = result.indexOf(existing);
        expect(newSectionIdx).toBeLessThan(existingIdx);
      }),
      { numRuns: 100 },
    );
  });

  test('no existing file (null): creates content with # Changelog header and new section', () => {
    fc.assert(
      fc.property(arbNewSection, (newSection) => {
        const result = prependChangelogContent(null, newSection);

        // Starts with # Changelog header
        expect(result.startsWith('# Changelog')).toBe(true);

        // Contains the new section
        expect(result).toContain(newSection);

        // Header appears exactly once
        const headerCount = (result.match(/^# Changelog$/gm) || []).length;
        expect(headerCount).toBe(1);
      }),
      { numRuns: 100 },
    );
  });

  test('file with only # Changelog header (no trailing newline): new section appended correctly', () => {
    fc.assert(
      fc.property(arbNewSection, (newSection) => {
        const existing = '# Changelog';
        const result = prependChangelogContent(existing, newSection);

        // Starts with header
        expect(result.startsWith('# Changelog')).toBe(true);

        // Contains new section
        expect(result).toContain(newSection);

        // Header appears exactly once
        const headerCount = (result.match(/^# Changelog$/gm) || []).length;
        expect(headerCount).toBe(1);
      }),
      { numRuns: 100 },
    );
  });
});
