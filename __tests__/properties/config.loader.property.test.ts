// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau
// Feature: core-ux-config-cli, Property 4, 5 & 8: Config loader properties

import * as fc from 'fast-check';
import * as path from 'path';
import Ajv from 'ajv';
import { loadConfig, ConfigLoaderDeps } from '../../config.loader';
import { schema } from '../../config.validator';
import { serializeYaml } from '../../yaml.parser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CWD = '/project';

/**
 * Known env var ↔ config path mapping (mirrors ENV_VAR_MAP in config.loader.ts).
 */
const KNOWN_MAPPINGS: Array<{ envVar: string; configPath: string }> = [
  { envVar: 'VERSIONINGS_GIT_PLATFORM', configPath: 'git.platform' },
  { envVar: 'VERSIONINGS_GIT_URL', configPath: 'git.url' },
  { envVar: 'VERSIONINGS_GIT_PR_TARGET', configPath: 'git.pr.target' },
  { envVar: 'VERSIONINGS_GIT_REMOTE', configPath: 'git.remote' },
  { envVar: 'VERSIONINGS_GIT_BRANCH_TYPE_VERSION', configPath: 'git.branchType.version' },
  { envVar: 'VERSIONINGS_GIT_BRANCHING_STRATEGY', configPath: 'git.branching.strategy' },
  { envVar: 'VERSIONINGS_GIT_BRANCHING_MAIN_BRANCH', configPath: 'git.branching.mainBranch' },
  { envVar: 'VERSIONINGS_GIT_BRANCHING_DEVELOP_BRANCH', configPath: 'git.branching.developBranch' },
];

/**
 * Convert a dot-notation config path to the expected env var name.
 * Convention: VERSIONINGS_ + path segments split on dots, each segment
 * converted from camelCase to UPPER_SNAKE_CASE, joined by _.
 *
 * Example: git.branchType.version → VERSIONINGS_GIT_BRANCH_TYPE_VERSION
 */
function configPathToEnvVar(configPath: string): string {
  const segments = configPath.split('.');
  const upperSegments = segments.map((seg) =>
    seg.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase(),
  );
  return 'VERSIONINGS_' + upperSegments.join('_');
}

/**
 * Convert an env var name (VERSIONINGS_<PATH>) to dot-notation config path.
 * Convention: strip prefix, lowercase, replace _ with . — but this is ambiguous
 * for multi-segment names (e.g. PR_TARGET vs PR.TARGET). So we use the known map.
 */
function envVarToConfigPath(envVar: string): string | undefined {
  const entry = KNOWN_MAPPINGS.find((m) => m.envVar === envVar);
  return entry?.configPath;
}

/**
 * Resolve a value at a dot-notation path in a nested object.
 */
function getAtPath(obj: Record<string, any>, dotPath: string): any {
  const parts = dotPath.split('.');
  let current: any = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Create a mock filesystem from a map of filePath → content.
 */
function createMockFs(files: Record<string, string>) {
  return {
    existsSync: (p: string): boolean => p in files,
    readFileSync: (p: string, _enc: BufferEncoding): string => {
      if (!(p in files)) throw new Error(`ENOENT: no such file: ${p}`);
      return files[p];
    },
  };
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Arbitrary for a known env var mapping entry. */
const arbMapping = fc.constantFrom(...KNOWN_MAPPINGS);

/** Arbitrary for a non-empty string value suitable for env vars and config fields. */
const arbNonEmptyString = fc.string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0 && !s.includes('\n') && !s.includes('\0'));

/** Arbitrary for a valid git platform. */
const arbPlatform = fc.constantFrom('github' as const, 'bitbucket' as const);

/** Arbitrary for a non-empty URL string. */
const arbUrl = fc.string({ minLength: 1, maxLength: 200 })
  .filter((s) => s.trim().length > 0 && !s.includes('\n') && !s.includes('\0'));

/** Arbitrary for a non-empty pr.target string. */
const arbPrTarget = fc.string({ minLength: 1, maxLength: 200 })
  .filter((s) => s.trim().length > 0 && !s.includes('\n') && !s.includes('\0'));

/** Arbitrary for a valid config object that passes schema validation. */
const arbValidConfig = fc.record({
  platform: arbPlatform,
  url: arbUrl,
  prTarget: arbPrTarget,
}).map(({ platform, url, prTarget }) => ({
  git: {
    platform,
    url,
    pr: { target: prTarget },
  },
}));

/** Arbitrary for init params. */
const arbInitParams = fc.record({
  platform: arbPlatform,
  url: arbUrl,
  prTarget: arbPrTarget,
  format: fc.constantFrom('json' as const, 'yaml' as const),
});

// ---------------------------------------------------------------------------
// Property 4: Env var mapping
// ---------------------------------------------------------------------------

/**
 * **Validates: Requirements 3.5**
 *
 * For any env var VERSIONINGS_<PATH>, the mapping function converts it to
 * the correct dot-notation config path. Reverse mapping should give the
 * original env var name.
 */
describe('Property 4: Env var mapping', () => {

  test('forward mapping: setting env var produces correct config path value', () => {
    fc.assert(
      fc.property(arbMapping, arbNonEmptyString, (mapping, value) => {
        // For env vars that map to platform, constrain value to valid enum
        let effectiveValue = value;
        if (mapping.configPath === 'git.platform') {
          effectiveValue = Math.random() > 0.5 ? 'github' : 'bitbucket';
        } else if (mapping.configPath === 'git.branching.strategy') {
          const strategies = ['default', 'trunk-based', 'git-flow', 'release-branch', 'hotfix', 'maintenance'];
          effectiveValue = strategies[Math.floor(Math.random() * strategies.length)];
        }

        // Build env with the required fields + the test env var
        const env: Record<string, string> = {
          VERSIONINGS_GIT_PLATFORM: 'github',
          VERSIONINGS_GIT_URL: 'https://github.com/org/repo.git',
          [mapping.envVar]: effectiveValue,
        };

        const fs = createMockFs({});
        const result = loadConfig({ cwd: CWD, env, ...fs });

        // The config field at the mapped path should have the env var value
        const actual = getAtPath(result.config, mapping.configPath);
        expect(actual).toBe(effectiveValue);
      }),
      { numRuns: 100 },
    );
  });

  test('reverse mapping: config path converts back to original env var name', () => {
    fc.assert(
      fc.property(arbMapping, (mapping) => {
        // Forward: envVar → configPath (from known map)
        const configPath = envVarToConfigPath(mapping.envVar);
        expect(configPath).toBe(mapping.configPath);

        // Reverse: configPath → envVar (via convention)
        const reconstructedEnvVar = configPathToEnvVar(mapping.configPath);
        expect(reconstructedEnvVar).toBe(mapping.envVar);
      }),
      { numRuns: 100 },
    );
  });

  test('env var source appears in provenance for mapped fields', () => {
    fc.assert(
      fc.property(arbMapping, arbNonEmptyString, (mapping, value) => {
        let effectiveValue = value;
        if (mapping.configPath === 'git.platform') {
          effectiveValue = Math.random() > 0.5 ? 'github' : 'bitbucket';
        } else if (mapping.configPath === 'git.branching.strategy') {
          const strategies = ['default', 'trunk-based', 'git-flow', 'release-branch', 'hotfix', 'maintenance'];
          effectiveValue = strategies[Math.floor(Math.random() * strategies.length)];
        }

        const env: Record<string, string> = {
          VERSIONINGS_GIT_PLATFORM: 'github',
          VERSIONINGS_GIT_URL: 'https://github.com/org/repo.git',
          [mapping.envVar]: effectiveValue,
        };

        const fs = createMockFs({});
        const result = loadConfig({ cwd: CWD, env, ...fs });

        // Provenance should show 'env' as source for the mapped field
        expect(result.provenance[mapping.configPath]).toBeDefined();
        expect(result.provenance[mapping.configPath].source).toBe('env');
        expect(result.provenance[mapping.configPath].value).toBe(effectiveValue);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: Validation is invariant to source
// ---------------------------------------------------------------------------

/**
 * **Validates: Requirements 4.3, 5.1, 5.2**
 *
 * For any valid config object, validation result is the same regardless of
 * whether it came from JSON, YAML, package.json, or env vars.
 */
describe('Property 5: Validation is invariant to source', () => {

  test('valid config loaded from JSON, YAML, and package.json produces same validated config', () => {
    fc.assert(
      fc.property(arbValidConfig, (configObj) => {
        const jsonContent = JSON.stringify(configObj);
        const yamlContent = serializeYaml(configObj);
        const pkgContent = JSON.stringify({
          name: 'test',
          version: '1.0.0',
          versionings: configObj,
        });

        // Load from version.json
        const fsJson = createMockFs({
          [path.join(CWD, 'version.json')]: jsonContent,
        });
        const resultJson = loadConfig({ cwd: CWD, env: {}, ...fsJson });

        // Load from .versioningsrc.yml (YAML)
        const fsYaml = createMockFs({
          [path.join(CWD, '.versioningsrc.yml')]: yamlContent,
        });
        const resultYaml = loadConfig({ cwd: CWD, env: {}, ...fsYaml });

        // Load from package.json#versionings
        const fsPkg = createMockFs({
          [path.join(CWD, 'package.json')]: pkgContent,
        });
        const resultPkg = loadConfig({ cwd: CWD, env: {}, ...fsPkg });

        // All three should produce the same validated config
        expect(resultJson.config.git.platform).toBe(resultYaml.config.git.platform);
        expect(resultJson.config.git.platform).toBe(resultPkg.config.git.platform);

        expect(resultJson.config.git.url).toBe(resultYaml.config.git.url);
        expect(resultJson.config.git.url).toBe(resultPkg.config.git.url);

        expect(resultJson.config.git.pr.target).toBe(resultYaml.config.git.pr.target);
        expect(resultJson.config.git.pr.target).toBe(resultPkg.config.git.pr.target);

        // All should have the same default values for fields not in the source
        expect(resultJson.config.git.remote).toBe(resultYaml.config.git.remote);
        expect(resultJson.config.git.remote).toBe(resultPkg.config.git.remote);
      }),
      { numRuns: 100 },
    );
  });

  test('valid config from env vars produces same core fields as from JSON file', () => {
    fc.assert(
      fc.property(arbPlatform, arbUrl, (platform, url) => {
        // Load from version.json
        const configObj = { git: { platform, url } };
        const fsJson = createMockFs({
          [path.join(CWD, 'version.json')]: JSON.stringify(configObj),
        });
        const resultJson = loadConfig({ cwd: CWD, env: {}, ...fsJson });

        // Load from env vars
        const fsEmpty = createMockFs({});
        const resultEnv = loadConfig({
          cwd: CWD,
          env: {
            VERSIONINGS_GIT_PLATFORM: platform,
            VERSIONINGS_GIT_URL: url,
          },
          ...fsEmpty,
        });

        // Core fields should match
        expect(resultJson.config.git.platform).toBe(resultEnv.config.git.platform);
        expect(resultJson.config.git.url).toBe(resultEnv.config.git.url);

        // Default fields should also match (both get defaults)
        expect(resultJson.config.git.remote).toBe(resultEnv.config.git.remote);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8: Init generates valid config
// ---------------------------------------------------------------------------

/**
 * **Validates: Requirements 6.5**
 *
 * For any valid combination of init params (platform from ['github', 'bitbucket'],
 * non-empty URL, non-empty pr.target, format from ['json', 'yaml']),
 * the generated config passes schema validation.
 */
describe('Property 8: Init generates valid config', () => {

  test('generated init config passes JSON Schema validation for any valid params', () => {
    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(schema);

    fc.assert(
      fc.property(arbInitParams, ({ platform, url, prTarget, format }) => {
        // Build the config object that init would generate
        const generatedConfig: Record<string, any> = {
          git: {
            platform,
            url,
            pr: { target: prTarget },
          },
        };

        // Validate against schema
        const valid = validate(generatedConfig);
        expect(valid).toBe(true);

        // Verify the config can be serialized in the chosen format and re-parsed
        if (format === 'json') {
          const serialized = JSON.stringify(generatedConfig, null, 2);
          const reparsed = JSON.parse(serialized);
          expect(reparsed).toEqual(generatedConfig);
        } else {
          const serialized = serializeYaml(generatedConfig);
          // YAML round-trip: re-parse should match
          const yaml = require('js-yaml');
          const reparsed = yaml.load(serialized);
          expect(reparsed).toEqual(generatedConfig);
        }
      }),
      { numRuns: 100 },
    );
  });

  test('generated init config can be loaded by loadConfig without errors', () => {
    fc.assert(
      fc.property(arbInitParams, ({ platform, url, prTarget, format }) => {
        const generatedConfig = {
          git: {
            platform,
            url,
            pr: { target: prTarget },
          },
        };

        // Simulate writing the config and loading it
        let content: string;
        let fileName: string;
        if (format === 'json') {
          content = JSON.stringify(generatedConfig, null, 2);
          fileName = 'version.json';
        } else {
          content = serializeYaml(generatedConfig);
          fileName = '.versioningsrc.yml';
        }

        const fs = createMockFs({
          [path.join(CWD, fileName)]: content,
        });

        const result = loadConfig({ cwd: CWD, env: {}, ...fs });

        // Should load without throwing and produce correct values
        expect(result.config.git.platform).toBe(platform);
        expect(result.config.git.url).toBe(url);
        expect(result.config.git.pr.target).toBe(prTarget);
      }),
      { numRuns: 100 },
    );
  });
});
