// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

// Feature: documentation-pack, Property 9: Branching strategy synchronization with code

import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import { createStrategyRegistry } from '../../../src/branching/strategy.registry';

// --- Constants ---

const DOCS_DIR = path.join(__dirname, '..', '..', '..', 'docs');
const COOKBOOK_PATH = path.join(DOCS_DIR, 'branch-strategy-cookbook.md');
const CONFIG_REF_PATH = path.join(DOCS_DIR, 'configuration-reference.md');

// Heading-name → registry-key mapping for branch-strategy-cookbook.md
const HEADING_TO_KEY: Record<string, string> = {
  'Default': 'default',
  'Trunk-Based': 'trunk-based',
  'Git-Flow': 'git-flow',
  'Release Branch': 'release-branch',
  'Hotfix': 'hotfix',
  'Maintenance': 'maintenance',
};

// --- Source of truth ---

const registry = createStrategyRegistry();
const registryStrategies = registry.availableStrategies();
const registrySet = new Set(registryStrategies);

// --- Helpers ---

/**
 * Extract strategy names from branch-strategy-cookbook.md.
 * Looks for `## <Name> Strategy` headings and maps them to registry keys.
 */
function extractCookbookStrategies(): string[] {
  const content = fs.readFileSync(COOKBOOK_PATH, 'utf-8');
  const strategies: string[] = [];
  const regex = /^## (.+?) Strategy\s*$/gm;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const headingName = match[1].trim();
    const key = HEADING_TO_KEY[headingName];
    if (key) {
      strategies.push(key);
    }
  }

  return strategies;
}

/**
 * Extract strategy enum values from configuration-reference.md.
 * Looks for backtick-wrapped values in the table under `### git.branching.strategy`.
 */
function extractConfigRefStrategies(): string[] {
  const content = fs.readFileSync(CONFIG_REF_PATH, 'utf-8');
  const lines = content.split('\n');

  let inSection = false;
  let inTable = false;
  let separatorSeen = false;
  const strategies: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Enter the git.branching.strategy section
    if (/^### git\.branching\.strategy\s*$/.test(trimmed)) {
      inSection = true;
      inTable = false;
      separatorSeen = false;
      continue;
    }

    // Leave on next ### or ## heading
    if (inSection && /^#{2,3} /.test(trimmed) && !/^### git\.branching\.strategy/.test(trimmed)) {
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

      // Data row — extract first column backtick-wrapped value
      const columns = trimmed.split('|').filter((c) => c.trim() !== '');
      if (columns.length > 0) {
        const firstCol = columns[0].trim();
        const match = firstCol.match(/^`([^`]+)`$/);
        if (match) {
          strategies.push(match[1].trim());
        }
      }
    } else if (inTable) {
      // Non-table line after table — table ended
      break;
    }
  }

  return strategies;
}

// --- Collect data ---

const cookbookStrategies = extractCookbookStrategies();
const configRefStrategies = extractConfigRefStrategies();
const cookbookSet = new Set(cookbookStrategies);
const configRefSet = new Set(configRefStrategies);

// --- Tests ---

/**
 * Property 9: Branching strategy synchronization with code
 *
 * For any document containing a list of branching strategies (branch-strategy-cookbook.md,
 * configuration-reference.md), the set of documented strategies SHALL be equal to the set
 * of keys in the strategy registry from src/branching/strategy.registry.ts:
 * default, trunk-based, git-flow, release-branch, hotfix, maintenance.
 *
 * **Validates: Requirements 7.1, 14.4**
 */
describe('Feature: documentation-pack, Property 9: Branching strategy synchronization with code', () => {
  // --- Deterministic: branch-strategy-cookbook.md ---

  describe('deterministic: branch-strategy-cookbook.md strategies match registry', () => {
    test('cookbook contains all registry strategies', () => {
      const missing = registryStrategies.filter((s) => !cookbookSet.has(s));
      expect(missing).toEqual([]);
    });

    test('cookbook contains no extra strategies', () => {
      const extra = cookbookStrategies.filter((s) => !registrySet.has(s));
      expect(extra).toEqual([]);
    });

    test('cookbook strategy set equals registry set', () => {
      expect(cookbookSet).toEqual(registrySet);
    });
  });

  // --- Deterministic: configuration-reference.md ---

  describe('deterministic: configuration-reference.md strategies match registry', () => {
    test('config reference contains all registry strategies', () => {
      const missing = registryStrategies.filter((s) => !configRefSet.has(s));
      expect(missing).toEqual([]);
    });

    test('config reference contains no extra strategies', () => {
      const extra = configRefStrategies.filter((s) => !registrySet.has(s));
      expect(extra).toEqual([]);
    });

    test('config reference strategy set equals registry set', () => {
      expect(configRefSet).toEqual(registrySet);
    });
  });

  // --- Property-based: random sampling ---

  if (registryStrategies.length > 0) {
    const arbStrategy = fc.constantFrom(...registryStrategies);

    test('property: every randomly sampled registry strategy appears in branch-strategy-cookbook.md', () => {
      fc.assert(
        fc.property(arbStrategy, (strategy) => {
          expect(cookbookSet.has(strategy)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    test('property: every randomly sampled registry strategy appears in configuration-reference.md', () => {
      fc.assert(
        fc.property(arbStrategy, (strategy) => {
          expect(configRefSet.has(strategy)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  }
});
