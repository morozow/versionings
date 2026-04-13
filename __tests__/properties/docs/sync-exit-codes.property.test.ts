// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

// Feature: documentation-pack, Property 8: Exit code synchronization with code

import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import { EXIT_CODES } from '../../../src/core/errors';

// --- Constants ---

const DOCS_DIR = path.join(__dirname, '..', '..', '..', 'docs');
const CLI_REFERENCE_PATH = path.join(DOCS_DIR, 'cli-reference.md');
const FAILURE_MATRIX_PATH = path.join(DOCS_DIR, 'failure-matrix.md');
const README_PATH = path.join(__dirname, '..', '..', '..', 'README.md');

// All expected exit code values from the source of truth
const EXPECTED_CODES: number[] = Object.values(EXIT_CODES).filter(
  (v): v is number => typeof v === 'number' && Number.isInteger(v),
);
const EXPECTED_SET = new Set(EXPECTED_CODES);

// Codes 1–11 must each have a dedicated ## Exit Code N: section in failure-matrix.md
const FAILURE_SECTION_CODES = EXPECTED_CODES.filter((c) => c >= 1 && c <= 11);

// --- Helpers ---

/**
 * Extract exit code numbers from a Markdown table inside the `## Exit Codes` section.
 * Reads the first column of each data row and parses it as an integer.
 */
function extractExitCodesFromSection(filePath: string): number[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  let inSection = false;
  let inTable = false;
  let separatorSeen = false;
  const codes: number[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Enter the Exit Codes section
    if (/^## Exit Codes\s*$/i.test(trimmed) || /^## Exit Codes Overview\s*$/i.test(trimmed)) {
      inSection = true;
      inTable = false;
      separatorSeen = false;
      continue;
    }

    // Leave on next ## heading (but not ### headings)
    if (inSection && /^## /.test(trimmed) && !/^### /.test(trimmed)) {
      break;
    }

    if (!inSection) continue;

    if (trimmed.startsWith('|')) {
      if (!inTable) {
        // First | line is the header row — skip it
        inTable = true;
        continue;
      }

      // Separator row (|---|---|...)
      if (/^\|[\s\-:|]+\|$/.test(trimmed)) {
        separatorSeen = true;
        continue;
      }

      if (!separatorSeen) continue;

      // Data row — extract first column
      const columns = trimmed.split('|').filter((c) => c.trim() !== '');
      if (columns.length > 0) {
        const val = Number(columns[0].trim());
        if (Number.isInteger(val)) {
          codes.push(val);
        }
      }
    } else if (inTable) {
      // Non-table line after table — table ended
      break;
    }
  }

  return codes;
}

/**
 * Extract `## Exit Code N:` section heading numbers from failure-matrix.md.
 * Returns the set of N values found.
 */
function extractFailureMatrixSectionCodes(): number[] {
  const content = fs.readFileSync(FAILURE_MATRIX_PATH, 'utf-8');
  const codes: number[] = [];
  const regex = /^## Exit Code (\d+):/gm;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const val = Number(match[1]);
    if (Number.isInteger(val)) {
      codes.push(val);
    }
  }

  return codes;
}

// --- Collect data ---

const cliRefCodes = extractExitCodesFromSection(CLI_REFERENCE_PATH);
const failureMatrixCodes = extractExitCodesFromSection(FAILURE_MATRIX_PATH);
const readmeCodes = extractExitCodesFromSection(README_PATH);
const failureSectionCodes = extractFailureMatrixSectionCodes();

const cliRefSet = new Set(cliRefCodes);
const failureMatrixSet = new Set(failureMatrixCodes);
const readmeSet = new Set(readmeCodes);
const failureSectionSet = new Set(failureSectionCodes);

// --- Tests ---

/**
 * Property 8: Exit code synchronization with code
 *
 * For any document containing an exit codes table (cli-reference.md, failure-matrix.md,
 * README.md), the set of documented codes SHALL be equal to the set of values from
 * EXIT_CODES in src/core/errors.ts: SUCCESS (0) through NO_CONVENTIONAL_COMMITS (11).
 * Additionally, failure-matrix.md SHALL have a separate `## Exit Code N:` section
 * for each code 1–11.
 *
 * **Validates: Requirements 4.5, 5.1, 5.2, 11.3, 14.2**
 */
describe('Feature: documentation-pack, Property 8: Exit code synchronization with code', () => {
  // --- Deterministic: cli-reference.md ---

  describe('deterministic: cli-reference.md exit codes match EXIT_CODES', () => {
    test('cli-reference.md contains all EXIT_CODES values', () => {
      const missing = EXPECTED_CODES.filter((c) => !cliRefSet.has(c));
      expect(missing).toEqual([]);
    });

    test('cli-reference.md contains no extra exit codes', () => {
      const extra = cliRefCodes.filter((c) => !EXPECTED_SET.has(c));
      expect(extra).toEqual([]);
    });

    test('cli-reference.md exit code set equals EXIT_CODES set', () => {
      expect(cliRefSet).toEqual(EXPECTED_SET);
    });
  });

  // --- Deterministic: failure-matrix.md ---

  describe('deterministic: failure-matrix.md exit codes match EXIT_CODES', () => {
    test('failure-matrix.md overview table contains all EXIT_CODES values', () => {
      const missing = EXPECTED_CODES.filter((c) => !failureMatrixSet.has(c));
      expect(missing).toEqual([]);
    });

    test('failure-matrix.md overview table contains no extra exit codes', () => {
      const extra = failureMatrixCodes.filter((c) => !EXPECTED_SET.has(c));
      expect(extra).toEqual([]);
    });

    test('failure-matrix.md overview table set equals EXIT_CODES set', () => {
      expect(failureMatrixSet).toEqual(EXPECTED_SET);
    });
  });

  // --- Deterministic: failure-matrix.md section headings ---

  describe('deterministic: failure-matrix.md has ## Exit Code N: sections for codes 1–11', () => {
    test('failure-matrix.md has a section for every code 1–11', () => {
      const missing = FAILURE_SECTION_CODES.filter((c) => !failureSectionSet.has(c));
      expect(missing).toEqual([]);
    });

    test('failure-matrix.md has no extra Exit Code sections beyond expected', () => {
      const extra = failureSectionCodes.filter((c) => !EXPECTED_SET.has(c));
      expect(extra).toEqual([]);
    });
  });

  // --- Deterministic: README.md ---

  describe('deterministic: README.md exit codes match EXIT_CODES', () => {
    test('README.md contains all EXIT_CODES values', () => {
      const missing = EXPECTED_CODES.filter((c) => !readmeSet.has(c));
      expect(missing).toEqual([]);
    });

    test('README.md contains no extra exit codes', () => {
      const extra = readmeCodes.filter((c) => !EXPECTED_SET.has(c));
      expect(extra).toEqual([]);
    });

    test('README.md exit code set equals EXIT_CODES set', () => {
      expect(readmeSet).toEqual(EXPECTED_SET);
    });
  });

  // --- Property-based: random sampling ---

  if (EXPECTED_CODES.length > 0) {
    const arbExitCode = fc.constantFrom(...EXPECTED_CODES);

    test('property: every randomly sampled EXIT_CODE appears in cli-reference.md', () => {
      fc.assert(
        fc.property(arbExitCode, (code) => {
          expect(cliRefSet.has(code)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    test('property: every randomly sampled EXIT_CODE appears in failure-matrix.md overview', () => {
      fc.assert(
        fc.property(arbExitCode, (code) => {
          expect(failureMatrixSet.has(code)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    test('property: every randomly sampled EXIT_CODE appears in README.md', () => {
      fc.assert(
        fc.property(arbExitCode, (code) => {
          expect(readmeSet.has(code)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    const arbSectionCode = fc.constantFrom(...FAILURE_SECTION_CODES);

    test('property: every randomly sampled code 1–11 has a ## Exit Code section in failure-matrix.md', () => {
      fc.assert(
        fc.property(arbSectionCode, (code) => {
          expect(failureSectionSet.has(code)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  }
});
