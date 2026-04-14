// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

// Feature: documentation-pack, Property 12: CI example completeness

import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';

// --- Constants ---

const DOCS_DIR = path.join(__dirname, '..', '..', '..', 'docs');
const CI_EXAMPLES_PATH = path.join(DOCS_DIR, 'ci-examples.md');

const CI_PLATFORMS = ['GitHub Actions', 'GitLab CI', 'Azure Pipelines', 'Bitbucket Pipelines'] as const;
type CIPlatform = (typeof CI_PLATFORMS)[number];

// Token patterns per platform (any of these is acceptable)
const TOKEN_PATTERNS: Record<CIPlatform, RegExp[]> = {
  'GitHub Actions': [/GITHUB_TOKEN/, /VERSIONINGS_TOKEN/, /secrets\./],
  'GitLab CI': [/GITLAB_TOKEN/, /VERSIONINGS_TOKEN/, /secrets\./],
  'Azure Pipelines': [/AZURE_DEVOPS_TOKEN/, /VERSIONINGS_TOKEN/, /secrets\./],
  'Bitbucket Pipelines': [/BITBUCKET_TOKEN/, /VERSIONINGS_TOKEN/, /secrets\./],
};

// --- Helpers ---

interface CISection {
  platform: CIPlatform;
  content: string;
}

/**
 * Read ci-examples.md and split into sections by `## ` headings.
 * Returns only the 4 CI platform sections.
 */
function extractCISections(): CISection[] {
  const content = fs.readFileSync(CI_EXAMPLES_PATH, 'utf-8');
  const lines = content.split('\n');

  const sections: CISection[] = [];
  let currentPlatform: CIPlatform | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      // Flush previous section
      if (currentPlatform !== null) {
        sections.push({ platform: currentPlatform, content: currentLines.join('\n') });
      }

      // Check if this heading matches a CI platform
      const heading = line.replace(/^## /, '').trim();
      const matched = CI_PLATFORMS.find((p) => heading === p);
      currentPlatform = matched ?? null;
      currentLines = matched ? [line] : [];
    } else if (currentPlatform !== null) {
      currentLines.push(line);
    }
  }

  // Flush last section
  if (currentPlatform !== null) {
    sections.push({ platform: currentPlatform, content: currentLines.join('\n') });
  }

  return sections;
}

// --- Collect data ---

const ciSections = extractCISections();
const ciSectionMap = new Map<CIPlatform, string>(ciSections.map((s) => [s.platform, s.content]));

// --- Tests ---

/**
 * Property 12: CI example completeness
 *
 * For each CI example section in ci-examples.md (GitHub Actions, GitLab CI,
 * Azure Pipelines, Bitbucket Pipelines):
 * - Verify the section contains `--ci` flag
 * - Verify the section contains `--json` flag
 * - Verify the section contains token passing via environment variables/secrets
 * - Verify the section contains `versionings validate` step
 *
 * **Validates: Requirements 6.5, 6.6, 6.7**
 */
describe('Feature: documentation-pack, Property 12: CI example completeness', () => {
  // --- Guard: all 4 CI platform sections must be present ---

  describe('deterministic: all 4 CI platform sections exist', () => {
    test.each(CI_PLATFORMS)('ci-examples.md contains a "## %s" section', (platform) => {
      expect(ciSectionMap.has(platform)).toBe(true);
    });

    test('exactly 4 CI platform sections are extracted', () => {
      expect(ciSections.length).toBe(CI_PLATFORMS.length);
    });
  });

  // --- Deterministic: each section contains --ci flag ---

  describe('deterministic: each CI section contains --ci flag', () => {
    test.each(CI_PLATFORMS)('%s section contains --ci', (platform) => {
      const content = ciSectionMap.get(platform)!;
      expect(content).toContain('--ci');
    });
  });

  // --- Deterministic: each section contains --json flag ---

  describe('deterministic: each CI section contains --json flag', () => {
    test.each(CI_PLATFORMS)('%s section contains --json', (platform) => {
      const content = ciSectionMap.get(platform)!;
      expect(content).toContain('--json');
    });
  });

  // --- Deterministic: each section contains token pattern ---

  describe('deterministic: each CI section contains token passing', () => {
    test.each(CI_PLATFORMS)('%s section contains a TOKEN pattern', (platform) => {
      const content = ciSectionMap.get(platform)!;
      const patterns = TOKEN_PATTERNS[platform];
      const hasToken = patterns.some((re) => re.test(content));
      expect(hasToken).toBe(true);
    });
  });

  // --- Deterministic: each section contains versionings validate ---

  describe('deterministic: each CI section contains versionings validate step', () => {
    test.each(CI_PLATFORMS)('%s section contains "versionings validate"', (platform) => {
      const content = ciSectionMap.get(platform)!;
      expect(content).toContain('versionings validate');
    });
  });

  // --- Property-based: random sampling of CI sections ---

  if (ciSections.length > 0) {
    const arbCISection = fc.constantFrom(...ciSections);

    test('property: randomly sampled CI section contains --ci flag', () => {
      fc.assert(
        fc.property(arbCISection, (section) => {
          expect(section.content).toContain('--ci');
        }),
        { numRuns: 100 },
      );
    });

    test('property: randomly sampled CI section contains --json flag', () => {
      fc.assert(
        fc.property(arbCISection, (section) => {
          expect(section.content).toContain('--json');
        }),
        { numRuns: 100 },
      );
    });

    test('property: randomly sampled CI section contains token pattern', () => {
      fc.assert(
        fc.property(arbCISection, (section) => {
          const patterns = TOKEN_PATTERNS[section.platform];
          const hasToken = patterns.some((re) => re.test(section.content));
          expect(hasToken).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    test('property: randomly sampled CI section contains versionings validate', () => {
      fc.assert(
        fc.property(arbCISection, (section) => {
          expect(section.content).toContain('versionings validate');
        }),
        { numRuns: 100 },
      );
    });
  }
});
