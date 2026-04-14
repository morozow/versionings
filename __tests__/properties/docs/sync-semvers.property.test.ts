// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

// Feature: documentation-pack, Property 11: --semver value synchronization with code

import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import { AVAILABLE_SEMVERS } from '../../../src/versioning/version.utils';

// --- Constants ---

const DOCS_DIR = path.join(__dirname, '..', '..', '..', 'docs');
const CLI_REF_PATH = path.join(DOCS_DIR, 'cli-reference.md');

// --- Source of truth ---

const sourceSet = new Set(AVAILABLE_SEMVERS);

// --- Helpers ---

/**
 * Extract --semver Choices values from cli-reference.md.
 * Looks for `--semver` parameter rows in tables where the description
 * contains "Choices:" followed by backtick-wrapped values.
 */
function extractSemverChoices(): string[] {
  const content = fs.readFileSync(CLI_REF_PATH, 'utf-8');
  const values = new Set<string>();

  // Match table rows that contain `--semver` and a Choices list
  // Pattern: | `--semver` | ... | ... Choices: `val1`, `val2`, ... |
  const rowRegex = /\|\s*`--semver`\s*\|[^|]*\|[^|]*\|[^|]*\|[^|]*Choices:\s*([^|]+)\|/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(content)) !== null) {
    const choicesPart = rowMatch[1];
    // Extract backtick-wrapped values
    const valRegex = /`([^`]+)`/g;
    let valMatch: RegExpExecArray | null;
    while ((valMatch = valRegex.exec(choicesPart)) !== null) {
      values.add(valMatch[1].trim());
    }
  }

  return Array.from(values);
}

// --- Collect data ---

const docSemvers = extractSemverChoices();
const docSet = new Set(docSemvers);

// --- Tests ---

/**
 * Property 11: --semver value synchronization with code
 *
 * For any document containing a list of allowed --semver values (cli-reference.md),
 * the set of documented values SHALL be equal to the set of AVAILABLE_SEMVERS
 * from src/versioning/version.utils.ts:
 * patch, prepatch, minor, preminor, premajor, prerelease, major, auto.
 *
 * **Validates: Requirements 14.6**
 */
describe('Feature: documentation-pack, Property 11: --semver value synchronization with code', () => {
  // --- Deterministic: cli-reference.md ---

  describe('deterministic: cli-reference.md semver choices match AVAILABLE_SEMVERS', () => {
    test('cli-reference contains all AVAILABLE_SEMVERS values', () => {
      const missing = AVAILABLE_SEMVERS.filter((s) => !docSet.has(s));
      expect(missing).toEqual([]);
    });

    test('cli-reference contains no extra semver values', () => {
      const extra = docSemvers.filter((s) => !sourceSet.has(s));
      expect(extra).toEqual([]);
    });

    test('cli-reference semver set equals AVAILABLE_SEMVERS set', () => {
      expect(docSet).toEqual(sourceSet);
    });
  });

  // --- Property-based: random sampling ---

  if (AVAILABLE_SEMVERS.length > 0) {
    const arbSemver = fc.constantFrom(...AVAILABLE_SEMVERS);

    test('property: every randomly sampled AVAILABLE_SEMVERS value appears in cli-reference.md', () => {
      fc.assert(
        fc.property(arbSemver, (semver) => {
          expect(docSet.has(semver)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  }
});
