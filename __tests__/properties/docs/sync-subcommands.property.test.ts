// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

// Feature: documentation-pack, Property 7: Subcommand synchronization with code

import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import { SUBCOMMANDS } from '../../../src/cli/command.router';

// --- Constants ---

const DOCS_DIR = path.join(__dirname, '..', '..', '..', 'docs');
const CLI_REFERENCE_PATH = path.join(DOCS_DIR, 'cli-reference.md');
const README_PATH = path.join(__dirname, '..', '..', '..', 'README.md');

// --- Helpers ---

/**
 * Extract subcommand names from cli-reference.md.
 * Looks for `### <name>` headings within the `## Commands` section.
 * Stops at the next `## ` heading (not `### `).
 */
function extractCliReferenceSubcommands(): string[] {
  const content = fs.readFileSync(CLI_REFERENCE_PATH, 'utf-8');
  const lines = content.split('\n');

  let inCommandsSection = false;
  const subcommands: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === '## Commands') {
      inCommandsSection = true;
      continue;
    }

    // Stop at the next ## heading (but not ### headings)
    if (inCommandsSection && /^## /.test(trimmed) && !/^### /.test(trimmed)) {
      break;
    }

    if (inCommandsSection && /^### /.test(trimmed)) {
      const name = trimmed.replace(/^###\s+/, '').trim().toLowerCase();
      if (name.length > 0) {
        subcommands.push(name);
      }
    }
  }

  return subcommands;
}

/**
 * Extract subcommand names from README.md Commands table.
 * Looks for backtick-wrapped names in the first column of the table
 * under the `## Commands` section.
 */
function extractReadmeSubcommands(): string[] {
  const content = fs.readFileSync(README_PATH, 'utf-8');
  const lines = content.split('\n');

  let inCommandsSection = false;
  let inTable = false;
  let headerSkipped = false;
  const subcommands: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === '## Commands') {
      inCommandsSection = true;
      inTable = false;
      headerSkipped = false;
      continue;
    }

    // Stop at the next ## heading
    if (inCommandsSection && /^## /.test(trimmed)) {
      break;
    }

    if (!inCommandsSection) continue;

    // Detect table rows (lines starting with |)
    if (trimmed.startsWith('|')) {
      if (!inTable) {
        inTable = true;
        // Skip header row
        continue;
      }

      // Skip separator row (|---|---|...)
      if (/^\|[\s-|]+\|$/.test(trimmed)) {
        headerSkipped = true;
        continue;
      }

      if (!headerSkipped) {
        headerSkipped = true;
        continue;
      }

      // Extract first column value (backtick-wrapped command name)
      const columns = trimmed.split('|').filter((c) => c.trim() !== '');
      if (columns.length > 0) {
        const firstCol = columns[0].trim();
        const match = firstCol.match(/^`([^`]+)`$/);
        if (match) {
          subcommands.push(match[1].trim().toLowerCase());
        }
      }
    } else if (inTable) {
      // Non-table line after table started — table ended
      inTable = false;
    }
  }

  return subcommands;
}

// --- Collect data ---

const cliRefSubcommands = extractCliReferenceSubcommands();
const readmeSubcommands = extractReadmeSubcommands();
const expectedSet = new Set(SUBCOMMANDS.map((s) => s.toLowerCase()));
const cliRefSet = new Set(cliRefSubcommands);
const readmeSet = new Set(readmeSubcommands);

// --- Tests ---

/**
 * Property 7: Subcommand synchronization with code
 *
 * For any document containing a list of subcommands (cli-reference.md, README.md),
 * the set of documented subcommands SHALL be equal to the set SUBCOMMANDS from
 * src/cli/command.router.ts: init, validate, plan, release, rollback, doctor, changelog.
 *
 * **Validates: Requirements 4.2, 11.2, 14.1**
 */
describe('Feature: documentation-pack, Property 7: Subcommand synchronization with code', () => {
  // --- Deterministic: cli-reference.md ---

  describe('deterministic: cli-reference.md subcommands match SUBCOMMANDS', () => {
    test('cli-reference.md contains all SUBCOMMANDS', () => {
      const missing = SUBCOMMANDS.filter((s) => !cliRefSet.has(s.toLowerCase()));
      expect(missing).toEqual([]);
    });

    test('cli-reference.md contains no extra subcommands', () => {
      const extra = cliRefSubcommands.filter((s) => !expectedSet.has(s));
      expect(extra).toEqual([]);
    });

    test('cli-reference.md subcommand set equals SUBCOMMANDS set', () => {
      expect(cliRefSet).toEqual(expectedSet);
    });
  });

  // --- Deterministic: README.md ---

  describe('deterministic: README.md subcommands match SUBCOMMANDS', () => {
    test('README.md contains all SUBCOMMANDS', () => {
      const missing = SUBCOMMANDS.filter((s) => !readmeSet.has(s.toLowerCase()));
      expect(missing).toEqual([]);
    });

    test('README.md contains no extra subcommands', () => {
      const extra = readmeSubcommands.filter((s) => !expectedSet.has(s));
      expect(extra).toEqual([]);
    });

    test('README.md subcommand set equals SUBCOMMANDS set', () => {
      expect(readmeSet).toEqual(expectedSet);
    });
  });

  // --- Property-based: random sampling ---

  if (SUBCOMMANDS.length > 0) {
    const arbSubcommand = fc.constantFrom(...SUBCOMMANDS);

    test('property: every randomly sampled SUBCOMMAND appears in cli-reference.md', () => {
      fc.assert(
        fc.property(arbSubcommand, (subcommand) => {
          expect(cliRefSet.has(subcommand.toLowerCase())).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    test('property: every randomly sampled SUBCOMMAND appears in README.md', () => {
      fc.assert(
        fc.property(arbSubcommand, (subcommand) => {
          expect(readmeSet.has(subcommand.toLowerCase())).toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  }
});
