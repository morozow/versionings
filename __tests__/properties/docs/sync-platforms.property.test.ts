// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

// Feature: documentation-pack, Property 10: SCM platform synchronization with code

import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import { createSCMRegistry } from '../../../src/scm/scm.registry';

// --- Constants ---

const DOCS_DIR = path.join(__dirname, '..', '..', '..', 'docs');
const SCM_GUIDE_PATH = path.join(DOCS_DIR, 'scm-provider-guide.md');
const CONFIG_REF_PATH = path.join(DOCS_DIR, 'configuration-reference.md');

// --- Source of truth ---

const registry = createSCMRegistry();
const registryPlatforms = registry.availablePlatforms();
const registrySet = new Set(registryPlatforms);

// --- Helpers ---

/**
 * Extract platform values from scm-provider-guide.md.
 * Looks for `**Platform value:** \`<name>\`` patterns.
 */
function extractScmGuidePlatforms(): string[] {
  const content = fs.readFileSync(SCM_GUIDE_PATH, 'utf-8');
  const platforms: string[] = [];
  const regex = /\*\*Platform value:\*\*\s*`([^`]+)`/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    platforms.push(match[1].trim());
  }

  return platforms;
}

/**
 * Extract platform enum values from configuration-reference.md.
 * Looks for backtick-wrapped values in the table under `### git.platform`.
 */
function extractConfigRefPlatforms(): string[] {
  const content = fs.readFileSync(CONFIG_REF_PATH, 'utf-8');
  const lines = content.split('\n');

  let inSection = false;
  let inTable = false;
  let separatorSeen = false;
  const platforms: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Enter the git.platform section
    if (/^### git\.platform\s*$/.test(trimmed)) {
      inSection = true;
      inTable = false;
      separatorSeen = false;
      continue;
    }

    // Leave on next ### or ## heading
    if (inSection && /^#{2,3} /.test(trimmed) && !/^### git\.platform/.test(trimmed)) {
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
        const colMatch = firstCol.match(/^`([^`]+)`$/);
        if (colMatch) {
          platforms.push(colMatch[1].trim());
        }
      }
    } else if (inTable) {
      // Non-table line after table — table ended
      break;
    }
  }

  return platforms;
}

// --- Collect data ---

const scmGuidePlatforms = extractScmGuidePlatforms();
const configRefPlatforms = extractConfigRefPlatforms();
const scmGuideSet = new Set(scmGuidePlatforms);
const configRefSet = new Set(configRefPlatforms);

// --- Tests ---

/**
 * Property 10: SCM platform synchronization with code
 *
 * For any document containing a list of SCM platforms (scm-provider-guide.md,
 * configuration-reference.md), the set of documented platforms SHALL be equal to the set
 * of DEFAULT_PLATFORMS in src/scm/scm.registry.ts:
 * github, github-enterprise, bitbucket, bitbucket-server, gitlab, azure-devops.
 *
 * **Validates: Requirements 8.1, 8.2, 14.5**
 */
describe('Feature: documentation-pack, Property 10: SCM platform synchronization with code', () => {
  // --- Deterministic: scm-provider-guide.md ---

  describe('deterministic: scm-provider-guide.md platforms match registry', () => {
    test('scm guide contains all registry platforms', () => {
      const missing = registryPlatforms.filter((p) => !scmGuideSet.has(p));
      expect(missing).toEqual([]);
    });

    test('scm guide contains no extra platforms', () => {
      const extra = scmGuidePlatforms.filter((p) => !registrySet.has(p));
      expect(extra).toEqual([]);
    });

    test('scm guide platform set equals registry set', () => {
      expect(scmGuideSet).toEqual(registrySet);
    });
  });

  // --- Deterministic: configuration-reference.md ---

  describe('deterministic: configuration-reference.md platforms match registry', () => {
    test('config reference contains all registry platforms', () => {
      const missing = registryPlatforms.filter((p) => !configRefSet.has(p));
      expect(missing).toEqual([]);
    });

    test('config reference contains no extra platforms', () => {
      const extra = configRefPlatforms.filter((p) => !registrySet.has(p));
      expect(extra).toEqual([]);
    });

    test('config reference platform set equals registry set', () => {
      expect(configRefSet).toEqual(registrySet);
    });
  });

  // --- Property-based: random sampling ---

  if (registryPlatforms.length > 0) {
    const arbPlatform = fc.constantFrom(...registryPlatforms);

    test('property: every randomly sampled registry platform appears in scm-provider-guide.md', () => {
      fc.assert(
        fc.property(arbPlatform, (platform) => {
          expect(scmGuideSet.has(platform)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    test('property: every randomly sampled registry platform appears in configuration-reference.md', () => {
      fc.assert(
        fc.property(arbPlatform, (platform) => {
          expect(configRefSet.has(platform)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  }
});
