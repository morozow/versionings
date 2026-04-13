// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

// Feature: documentation-pack, Property 6: Document format requirements

import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';

// --- Constants ---

const DOCS_DIR = path.join(__dirname, '..', '..', '..', 'docs');

// --- Helpers ---

/** List all .md files in docs/ directory */
function getDocFiles(): string[] {
  return fs.readdirSync(DOCS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.join(DOCS_DIR, f));
}

/**
 * Get the first non-empty, non-navigation line from a Markdown file.
 * Navigation lines start with `>` (blockquote used for navigation sections).
 */
function getFirstContentLine(filePath: string): string | null {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (trimmed.startsWith('>')) continue;
    return trimmed;
  }

  return null;
}

interface CodeBlockViolation {
  /** Line number (1-based) of the opener without a language tag */
  lineNumber: number;
  /** The raw line content */
  line: string;
}

/**
 * Find fenced code block openers that lack a language tag.
 * Uses a line-by-line state machine to distinguish openers from closers.
 * A valid opener is a line matching /^```[a-zA-Z]/ (backticks followed by at least one letter).
 * A bare opener is a line that is exactly ``` (with optional trailing whitespace) when not inside a block.
 */
function findBareCodeBlockOpeners(filePath: string): CodeBlockViolation[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const violations: CodeBlockViolation[] = [];
  let insideCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!insideCodeBlock) {
      // Check if this line opens a fenced code block
      if (trimmed.startsWith('```')) {
        insideCodeBlock = true;
        // Check if it has a language tag: at least one alphanumeric char after ```
        const afterBackticks = trimmed.slice(3).trim();
        if (!/^[a-zA-Z]/.test(afterBackticks)) {
          violations.push({ lineNumber: i + 1, line: trimmed });
        }
      }
    } else {
      // Inside a code block — check for closer
      if (trimmed === '```') {
        insideCodeBlock = false;
      }
    }
  }

  return violations;
}

// --- Collect data ---

const docFiles = getDocFiles();

interface DocFileEntry {
  filePath: string;
  basename: string;
}

const docEntries: DocFileEntry[] = docFiles.map((f) => ({
  filePath: f,
  basename: path.basename(f),
}));

// --- Tests ---

/**
 * Property 6: Document format requirements
 *
 * For every Markdown file in docs/*.md:
 * - The first non-empty content line (skipping navigation blockquotes) starts with `# ` (H1 heading)
 * - Every fenced code block has a language tag (not just bare ```)
 *
 * **Validates: Requirements 13.3, 13.4**
 */
describe('Feature: documentation-pack, Property 6: Document format requirements', () => {
  // --- Deterministic: H1 heading ---

  describe('deterministic: every docs/*.md has an H1 heading as first content line', () => {
    if (docEntries.length === 0) {
      test('no doc files found', () => {
        expect(docEntries.length).toBeGreaterThan(0);
      });
    } else {
      test.each(
        docEntries.map((e) => [e.basename, e] as const),
      )('%s', (_label, entry) => {
        const firstLine = getFirstContentLine(entry.filePath);
        expect(firstLine).not.toBeNull();
        expect(firstLine!.startsWith('# ')).toBe(true);
      });
    }
  });

  // --- Deterministic: language tags on code blocks ---

  describe('deterministic: every fenced code block in docs/*.md has a language tag', () => {
    if (docEntries.length === 0) {
      test('no doc files found', () => {
        expect(docEntries.length).toBeGreaterThan(0);
      });
    } else {
      test.each(
        docEntries.map((e) => [e.basename, e] as const),
      )('%s', (_label, entry) => {
        const violations = findBareCodeBlockOpeners(entry.filePath);
        if (violations.length > 0) {
          const details = violations
            .map((v) => `  line ${v.lineNumber}: ${v.line}`)
            .join('\n');
          fail(
            `Found ${violations.length} code block(s) without language tag in ${entry.basename}:\n${details}`,
          );
        }
      });
    }
  });

  // --- Property-based: random sampling ---

  if (docEntries.length > 0) {
    const arbDocEntry = fc.constantFrom(...docEntries);

    test('property: randomly sampled docs/*.md files have H1 as first content line', () => {
      fc.assert(
        fc.property(arbDocEntry, (entry) => {
          const firstLine = getFirstContentLine(entry.filePath);
          expect(firstLine).not.toBeNull();
          expect(firstLine!.startsWith('# ')).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    test('property: randomly sampled docs/*.md files have language tags on all code blocks', () => {
      fc.assert(
        fc.property(arbDocEntry, (entry) => {
          const violations = findBareCodeBlockOpeners(entry.filePath);
          expect(violations).toHaveLength(0);
        }),
        { numRuns: 100 },
      );
    });
  }
});
