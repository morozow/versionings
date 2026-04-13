// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

// Feature: documentation-pack, Property 2: JSON example validity
// Feature: documentation-pack, Property 3: YAML example validity
// Feature: documentation-pack, Property 4: Config examples match JSON Schema
// Feature: documentation-pack, Property 5: CLI invocation correctness

import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import Ajv from 'ajv';

import { SUBCOMMANDS } from '../../../src/cli/command.router';
import { AVAILABLE_SEMVERS } from '../../../src/versioning/version.utils';

// --- Constants ---

const DOCS_DIR = path.join(__dirname, '..', '..', '..', 'docs');
const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const README_PATH = path.join(ROOT_DIR, 'README.md');
const SCHEMA_PATH = path.join(ROOT_DIR, 'version.schema.json');

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

interface CodeBlock {
  /** Source file (absolute path) */
  sourceFile: string;
  /** Source file basename for display */
  sourceBasename: string;
  /** Language tag (json, yaml, bash, etc.) */
  language: string;
  /** Content of the code block */
  content: string;
}

/**
 * Extract all fenced code blocks with language tags from a Markdown file.
 * Matches ```<lang>\n...\n``` patterns.
 */
function extractCodeBlocks(filePath: string): CodeBlock[] {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const blocks: CodeBlock[] = [];
  const regex = /```([a-z]+)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(fileContent)) !== null) {
    blocks.push({
      sourceFile: filePath,
      sourceBasename: path.basename(filePath),
      language: match[1],
      content: match[2].trimEnd(),
    });
  }

  return blocks;
}

/** Check if a parsed config object looks like a Versionings config (has git.platform) */
function isVersioningsConfig(obj: unknown): boolean {
  if (typeof obj !== 'object' || obj === null) return false;
  const record = obj as Record<string, unknown>;
  const git = record['git'];
  if (typeof git !== 'object' || git === null) return false;
  const gitRecord = git as Record<string, unknown>;
  return typeof gitRecord['platform'] === 'string';
}

/**
 * Extract CLI invocations of `versionings` from a bash code block.
 * Returns an array of parsed invocations with subcommand and semver value.
 */
interface CliInvocation {
  /** The raw line */
  line: string;
  /** Subcommand name (first arg not starting with -), or null */
  subcommand: string | null;
  /** Value of --semver flag, or null */
  semverValue: string | null;
}

function extractCliInvocations(content: string): CliInvocation[] {
  const invocations: CliInvocation[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Match lines that invoke versionings (directly or via npx/pnpm/npm exec)
    const versioningsIndex = trimmed.indexOf('versionings');
    if (versioningsIndex < 0) continue;

    // Get everything after 'versionings'
    const afterCmd = trimmed.substring(versioningsIndex + 'versionings'.length).trim();
    const tokens = afterCmd.split(/\s+/).filter(Boolean);

    // Extract subcommand: first token that doesn't start with '-'
    let subcommand: string | null = null;
    for (const token of tokens) {
      if (!token.startsWith('-')) {
        subcommand = token;
        break;
      }
    }

    // Extract --semver value
    let semverValue: string | null = null;
    const semverMatch = afterCmd.match(/--semver[=\s]+([a-z-]+)/);
    if (semverMatch) {
      semverValue = semverMatch[1];
    }

    invocations.push({ line: trimmed, subcommand, semverValue });
  }

  return invocations;
}

// --- Collect all code blocks ---

const allDocFiles = getAllDocFiles();
const allCodeBlocks = allDocFiles.flatMap((f) => extractCodeBlocks(f));

const jsonBlocks = allCodeBlocks.filter((b) => b.language === 'json');
const yamlBlocks = allCodeBlocks.filter((b) => b.language === 'yaml');
const bashBlocks = allCodeBlocks.filter((b) => b.language === 'bash' || b.language === 'shell');

// Config blocks: JSON or YAML blocks that represent Versionings config
const configBlocks: Array<CodeBlock & { parsed: unknown }> = [];
for (const block of jsonBlocks) {
  try {
    const parsed = JSON.parse(block.content);
    if (isVersioningsConfig(parsed)) {
      configBlocks.push({ ...block, parsed });
    }
  } catch {
    // Will be caught by Property 2
  }
}
for (const block of yamlBlocks) {
  try {
    const parsed = yaml.load(block.content);
    if (isVersioningsConfig(parsed)) {
      configBlocks.push({ ...block, parsed });
    }
  } catch {
    // Will be caught by Property 3
  }
}

// CLI invocation blocks: bash blocks containing 'versionings'
interface CliBlock {
  sourceBasename: string;
  content: string;
  invocations: CliInvocation[];
}

const cliBlocks: CliBlock[] = bashBlocks
  .filter((b) => b.content.includes('versionings'))
  .map((b) => ({
    sourceBasename: b.sourceBasename,
    content: b.content,
    invocations: extractCliInvocations(b.content),
  }))
  .filter((b) => b.invocations.length > 0);

// Load JSON Schema
const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
const ajv = new Ajv({ allErrors: true, strict: false });
const validateSchema = ajv.compile(schema);

// --- Tests ---

/**
 * Property 2: JSON example validity
 *
 * For any fenced code block with tag `json` in any document of the
 * Documentation Pack, the content SHALL parse as syntactically valid JSON.
 *
 * **Validates: Requirements 12.1**
 */
describe('Feature: documentation-pack, Property 2: JSON example validity', () => {
  describe('deterministic: all JSON blocks parse successfully', () => {
    if (jsonBlocks.length === 0) {
      test('no JSON blocks found', () => {
        expect(jsonBlocks.length).toBeGreaterThan(0);
      });
    } else {
      test.each(
        jsonBlocks.map((b, i) => [
          `${b.sourceBasename} #${i + 1}`,
          b,
        ] as const),
      )('%s', (_label, block) => {
        expect(() => JSON.parse(block.content)).not.toThrow();
      });
    }
  });

  if (jsonBlocks.length > 0) {
    const arbJsonBlock = fc.constantFrom(...jsonBlocks);

    test('property: randomly sampled JSON blocks parse successfully', () => {
      fc.assert(
        fc.property(arbJsonBlock, (block) => {
          expect(() => JSON.parse(block.content)).not.toThrow();
        }),
        { numRuns: 100 },
      );
    });
  }
});

/**
 * Property 3: YAML example validity
 *
 * For any fenced code block with tag `yaml` in any document of the
 * Documentation Pack, the content SHALL parse as syntactically valid YAML.
 *
 * **Validates: Requirements 12.2**
 */
describe('Feature: documentation-pack, Property 3: YAML example validity', () => {
  describe('deterministic: all YAML blocks parse successfully', () => {
    if (yamlBlocks.length === 0) {
      test('no YAML blocks found', () => {
        expect(yamlBlocks.length).toBeGreaterThan(0);
      });
    } else {
      test.each(
        yamlBlocks.map((b, i) => [
          `${b.sourceBasename} #${i + 1}`,
          b,
        ] as const),
      )('%s', (_label, block) => {
        expect(() => yaml.load(block.content)).not.toThrow();
      });
    }
  });

  if (yamlBlocks.length > 0) {
    const arbYamlBlock = fc.constantFrom(...yamlBlocks);

    test('property: randomly sampled YAML blocks parse successfully', () => {
      fc.assert(
        fc.property(arbYamlBlock, (block) => {
          expect(() => yaml.load(block.content)).not.toThrow();
        }),
        { numRuns: 100 },
      );
    });
  }
});

/**
 * Property 4: Config examples match JSON Schema
 *
 * For any fenced code block (JSON or YAML) in the Documentation Pack that
 * represents a Versionings configuration (containing `git.platform`), the
 * content SHALL validate against version.schema.json.
 *
 * **Validates: Requirements 12.3**
 */
describe('Feature: documentation-pack, Property 4: Config examples match JSON Schema', () => {
  describe('deterministic: all config blocks validate against schema', () => {
    if (configBlocks.length === 0) {
      test('no config blocks found', () => {
        expect(configBlocks.length).toBeGreaterThan(0);
      });
    } else {
      test.each(
        configBlocks.map((b, i) => [
          `${b.sourceBasename} #${i + 1} (${b.language})`,
          b,
        ] as const),
      )('%s', (_label, block) => {
        const valid = validateSchema(block.parsed);
        if (!valid) {
          // Include schema errors in failure message for debugging
          const errors = validateSchema.errors?.map((e) => `${e.instancePath} ${e.message}`).join('; ');
          expect(valid).toBe(true); // Will fail with context
          throw new Error(`Schema validation failed: ${errors}`);
        }
      });
    }
  });

  if (configBlocks.length > 0) {
    const arbConfigBlock = fc.constantFrom(...configBlocks);

    test('property: randomly sampled config blocks validate against schema', () => {
      fc.assert(
        fc.property(arbConfigBlock, (block) => {
          const valid = validateSchema(block.parsed);
          expect(valid).toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  }
});

/**
 * Property 5: CLI invocation correctness
 *
 * For any fenced code block with tag `bash` or `shell` in the Documentation
 * Pack containing a `versionings` invocation, the subcommand name (if present)
 * SHALL belong to SUBCOMMANDS, and the --semver value (if present) SHALL
 * belong to AVAILABLE_SEMVERS.
 *
 * **Validates: Requirements 12.4**
 */
describe('Feature: documentation-pack, Property 5: CLI invocation correctness', () => {
  // Flatten all invocations for deterministic testing
  interface FlatInvocation {
    sourceBasename: string;
    line: string;
    subcommand: string | null;
    semverValue: string | null;
  }

  const allInvocations: FlatInvocation[] = cliBlocks.flatMap((b) =>
    b.invocations.map((inv) => ({
      sourceBasename: b.sourceBasename,
      line: inv.line,
      subcommand: inv.subcommand,
      semverValue: inv.semverValue,
    })),
  );

  const invocationsWithSubcommand = allInvocations.filter((inv) => inv.subcommand !== null);
  const invocationsWithSemver = allInvocations.filter((inv) => inv.semverValue !== null);

  describe('deterministic: all subcommands are valid', () => {
    if (invocationsWithSubcommand.length === 0) {
      test('no CLI invocations with subcommands found', () => {
        expect(invocationsWithSubcommand.length).toBeGreaterThan(0);
      });
    } else {
      test.each(
        invocationsWithSubcommand.map((inv) => [
          `${inv.sourceBasename}: ${inv.line}`,
          inv,
        ] as const),
      )('%s', (_label, inv) => {
        expect(SUBCOMMANDS).toContain(inv.subcommand);
      });
    }
  });

  describe('deterministic: all --semver values are valid', () => {
    if (invocationsWithSemver.length === 0) {
      test('no CLI invocations with --semver found', () => {
        expect(invocationsWithSemver.length).toBeGreaterThan(0);
      });
    } else {
      test.each(
        invocationsWithSemver.map((inv) => [
          `${inv.sourceBasename}: --semver=${inv.semverValue}`,
          inv,
        ] as const),
      )('%s', (_label, inv) => {
        expect(AVAILABLE_SEMVERS).toContain(inv.semverValue);
      });
    }
  });

  if (allInvocations.length > 0) {
    const arbInvocation = fc.constantFrom(...allInvocations);

    test('property: randomly sampled CLI invocations use valid subcommands', () => {
      fc.assert(
        fc.property(arbInvocation, (inv) => {
          if (inv.subcommand !== null) {
            expect(SUBCOMMANDS).toContain(inv.subcommand);
          }
        }),
        { numRuns: 100 },
      );
    });

    test('property: randomly sampled CLI invocations use valid --semver values', () => {
      fc.assert(
        fc.property(arbInvocation, (inv) => {
          if (inv.semverValue !== null) {
            expect(AVAILABLE_SEMVERS).toContain(inv.semverValue);
          }
        }),
        { numRuns: 100 },
      );
    });
  }
});
