// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

// Feature: documentation-pack, Property 1: Cross-reference integrity

import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';

// --- Constants ---

const DOCS_DIR = path.join(__dirname, '..', '..', '..', 'docs');
const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const README_PATH = path.join(ROOT_DIR, 'README.md');

// --- Helpers ---

/** List all .md files in docs/ directory */
function getDocFiles(): string[] {
  return fs.readdirSync(DOCS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.join(DOCS_DIR, f));
}

/** Get all documentation files (docs/*.md + README.md) */
function getAllDocFiles(): string[] {
  return [...getDocFiles(), README_PATH];
}

interface MarkdownLink {
  /** Source file (absolute path) */
  sourceFile: string;
  /** Link text */
  text: string;
  /** Raw href from markdown */
  href: string;
  /** File portion of href (without anchor) */
  filePart: string;
  /** Anchor portion (without #), or null */
  anchor: string | null;
}

/**
 * Extract all relative Markdown links from a file.
 * Skips: image links, external links (http/https/mailto), pure anchors (#only),
 * and links inside fenced code blocks.
 */
function extractRelativeLinks(filePath: string): MarkdownLink[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const links: MarkdownLink[] = [];

  // Remove fenced code blocks to avoid false positives
  const withoutCodeBlocks = content.replace(/```[\s\S]*?```/g, '');

  // Match [text](href) but not ![text](href)
  const linkRegex = /(?<!!)\[([^\]]*)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(withoutCodeBlocks)) !== null) {
    const href = match[2].trim();

    // Skip external links and pure anchors
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
      continue;
    }

    // Parse file part and anchor
    const hashIndex = href.indexOf('#');
    const filePart = hashIndex >= 0 ? href.substring(0, hashIndex) : href;
    const anchor = hashIndex >= 0 ? href.substring(hashIndex + 1) : null;

    // Skip pure same-file anchors (no file part)
    if (filePart === '') {
      continue;
    }

    links.push({
      sourceFile: filePath,
      text: match[1],
      href,
      filePart,
      anchor,
    });
  }

  return links;
}

/**
 * Convert a Markdown heading text to a GitHub-style anchor slug.
 * Algorithm: lowercase, replace spaces with hyphens, remove non-alphanumeric
 * chars (except hyphens), collapse consecutive hyphens, trim leading/trailing hyphens.
 */
function headingToAnchor(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Extract all heading anchors from a Markdown file.
 * Handles duplicate headings by appending -1, -2, etc. (GitHub behavior).
 */
function extractHeadingAnchors(filePath: string): Set<string> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const anchors = new Set<string>();
  const anchorCounts = new Map<string, number>();

  // Remove fenced code blocks
  const withoutCodeBlocks = content.replace(/```[\s\S]*?```/g, '');

  const headingRegex = /^#{1,6}\s+(.+)$/gm;
  let match: RegExpExecArray | null;

  while ((match = headingRegex.exec(withoutCodeBlocks)) !== null) {
    const baseAnchor = headingToAnchor(match[1]);
    const count = anchorCounts.get(baseAnchor) || 0;

    if (count === 0) {
      anchors.add(baseAnchor);
    } else {
      anchors.add(`${baseAnchor}-${count}`);
    }
    anchorCounts.set(baseAnchor, count + 1);
  }

  return anchors;
}

/**
 * Resolve a relative link href to an absolute file path.
 * Links from docs/*.md are resolved relative to docs/.
 * Links from README.md are resolved relative to project root.
 */
function resolveLink(sourceFile: string, filePart: string): string {
  const sourceDir = path.dirname(sourceFile);
  return path.resolve(sourceDir, filePart);
}

// --- Collect all links and documents ---

const allDocFiles = getAllDocFiles();
const docFiles = getDocFiles();

interface LinkEntry {
  sourceFile: string;
  sourceBasename: string;
  text: string;
  href: string;
  filePart: string;
  anchor: string | null;
  resolvedPath: string;
}

const allLinks: LinkEntry[] = allDocFiles.flatMap((file) =>
  extractRelativeLinks(file).map((link) => ({
    ...link,
    sourceBasename: path.basename(link.sourceFile),
    resolvedPath: resolveLink(link.sourceFile, link.filePart),
  })),
);

// --- Tests ---

/**
 * Property 1: Cross-reference integrity
 *
 * For any relative Markdown link in any document of the Documentation Pack
 * (docs/*.md and README.md), the link SHALL use a relative path, the target
 * file SHALL exist in the filesystem, and the anchor (if present) SHALL
 * correspond to a heading in the target file. Additionally, every document
 * in docs/ SHALL contain a navigation link to index.md.
 *
 * **Validates: Requirements 1.3, 1.5, 1.6**
 */
describe('Feature: documentation-pack, Property 1: Cross-reference integrity', () => {
  // --- Deterministic tests: check ALL links ---

  describe('deterministic: all links target existing files', () => {
    if (allLinks.length === 0) {
      test('no links found (skip)', () => {
        expect(allLinks.length).toBeGreaterThan(0);
      });
    } else {
      test.each(
        allLinks.map((l) => [`${l.sourceBasename} → ${l.href}`, l] as const),
      )('%s', (_label, link) => {
        expect(fs.existsSync(link.resolvedPath)).toBe(true);
      });
    }
  });

  describe('deterministic: all anchors match headings in target files', () => {
    const linksWithAnchors = allLinks.filter((l) => l.anchor !== null);

    if (linksWithAnchors.length === 0) {
      test('no anchor links found (skip)', () => {
        // No anchors to check — pass
        expect(true).toBe(true);
      });
    } else {
      test.each(
        linksWithAnchors.map((l) => [`${l.sourceBasename} → ${l.href}`, l] as const),
      )('%s', (_label, link) => {
        const targetPath = link.resolvedPath;
        expect(fs.existsSync(targetPath)).toBe(true);

        const headings = extractHeadingAnchors(targetPath);
        expect(headings.has(link.anchor!)).toBe(true);
      });
    }
  });

  describe('deterministic: every docs/*.md contains a link to index.md', () => {
    const docsWithoutIndex = docFiles.filter(
      (f) => path.basename(f) !== 'index.md',
    );

    test.each(
      docsWithoutIndex.map((f) => [path.basename(f), f] as const),
    )('%s links to index.md', (_basename, filePath) => {
      const links = extractRelativeLinks(filePath);
      const linksToIndex = links.filter((l) => {
        const resolved = resolveLink(filePath, l.filePart);
        return path.basename(resolved) === 'index.md';
      });
      expect(linksToIndex.length).toBeGreaterThanOrEqual(1);
    });
  });

  // --- Property-based tests: random sampling ---

  if (allLinks.length > 0) {
    const arbLink = fc.constantFrom(...allLinks);

    test('property: randomly sampled links target existing files', () => {
      fc.assert(
        fc.property(arbLink, (link) => {
          expect(fs.existsSync(link.resolvedPath)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    test('property: randomly sampled links with anchors match headings', () => {
      const linksWithAnchors = allLinks.filter((l) => l.anchor !== null);
      if (linksWithAnchors.length === 0) {
        // No anchor links — property trivially holds
        return;
      }

      const arbAnchorLink = fc.constantFrom(...linksWithAnchors);
      fc.assert(
        fc.property(arbAnchorLink, (link) => {
          const headings = extractHeadingAnchors(link.resolvedPath);
          expect(headings.has(link.anchor!)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  }

  if (docFiles.length > 0) {
    const docsWithoutIndex = docFiles.filter(
      (f) => path.basename(f) !== 'index.md',
    );

    if (docsWithoutIndex.length > 0) {
      const arbDocFile = fc.constantFrom(...docsWithoutIndex);

      test('property: randomly sampled docs/*.md files contain a link to index.md', () => {
        fc.assert(
          fc.property(arbDocFile, (filePath) => {
            const links = extractRelativeLinks(filePath);
            const linksToIndex = links.filter((l) => {
              const resolved = resolveLink(filePath, l.filePart);
              return path.basename(resolved) === 'index.md';
            });
            expect(linksToIndex.length).toBeGreaterThanOrEqual(1);
          }),
          { numRuns: 100 },
        );
      });
    }
  }
});
