// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * Integration tests: Config hierarchy with real files in tmpdir.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 5.1, 5.2, 5.3, 16.1, 16.2
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { loadConfig } from '../../src/config/config.loader';
import { EXIT_CODES, VersioningsError } from '../../src/core/errors';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versionings-cfg-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Minimal valid git config satisfying the schema (platform + url required). */
const VALID_GIT = {
  git: { platform: 'github', url: 'https://github.com/org/repo.git' },
};

function writeFile(name: string, content: string): void {
  fs.writeFileSync(path.join(tmpDir, name), content, 'utf8');
}

function writeJson(name: string, obj: Record<string, any>): void {
  writeFile(name, JSON.stringify(obj, null, 2));
}

describe('Integration: Config hierarchy (real files)', () => {
  // 1. Load from version.json (legacy, backward compatibility)
  test('loads config from version.json (legacy)', () => {
    writeJson('version.json', VALID_GIT);

    const result = loadConfig({ cwd: tmpDir, env: {} });

    expect(result.config.git.platform).toBe('github');
    expect(result.config.git.url).toBe('https://github.com/org/repo.git');
    expect(result.sources.some((s) => s.name === 'version.json')).toBe(true);
    // Defaults are merged in
    expect(result.config.git.remote).toBe('origin');
    expect(result.config.git.pr.target).toBe('master');
  });

  // 2. Load from .versioningsrc.json
  test('loads config from .versioningsrc.json', () => {
    writeJson('.versioningsrc.json', VALID_GIT);

    const result = loadConfig({ cwd: tmpDir, env: {} });

    expect(result.config.git.platform).toBe('github');
    expect(result.config.git.url).toBe('https://github.com/org/repo.git');
    expect(result.sources.some((s) => s.name === '.versioningsrc.json')).toBe(true);
  });

  // 3. Load from .versioningsrc.yml (YAML)
  test('loads config from .versioningsrc.yml (YAML)', () => {
    const yaml = [
      'git:',
      '  platform: bitbucket',
      '  url: https://bitbucket.org/org/repo.git',
      '  pr:',
      '    target: develop',
    ].join('\n') + '\n';
    writeFile('.versioningsrc.yml', yaml);

    const result = loadConfig({ cwd: tmpDir, env: {} });

    expect(result.config.git.platform).toBe('bitbucket');
    expect(result.config.git.url).toBe('https://bitbucket.org/org/repo.git');
    expect(result.config.git.pr.target).toBe('develop');
    expect(result.sources.some((s) => s.name === '.versioningsrc.yml')).toBe(true);
  });

  // 4. Load from package.json#versionings
  test('loads config from package.json#versionings', () => {
    writeJson('package.json', {
      name: 'test-project',
      version: '1.0.0',
      versionings: VALID_GIT,
    });

    const result = loadConfig({ cwd: tmpDir, env: {} });

    expect(result.config.git.platform).toBe('github');
    expect(result.config.git.url).toBe('https://github.com/org/repo.git');
    expect(result.sources.some((s) => s.name === 'package.json#versionings')).toBe(true);
  });

  // 5. Env vars override file sources
  test('env vars override file sources', () => {
    writeJson('version.json', VALID_GIT);

    const result = loadConfig({
      cwd: tmpDir,
      env: {
        VERSIONINGS_GIT_PLATFORM: 'bitbucket',
        VERSIONINGS_GIT_PR_TARGET: 'develop',
      },
    });

    // Env overrides version.json platform
    expect(result.config.git.platform).toBe('bitbucket');
    // Env overrides default pr.target
    expect(result.config.git.pr.target).toBe('develop');
    // URL still from version.json
    expect(result.config.git.url).toBe('https://github.com/org/repo.git');
    expect(result.sources.some((s) => s.name === 'env')).toBe(true);
    // Provenance reflects env as source for overridden fields
    expect(result.provenance['git.platform'].source).toBe('env');
    expect(result.provenance['git.url'].source).toBe('version.json');
  });

  // 6. CLI args override everything
  test('CLI args override everything', () => {
    writeJson('version.json', VALID_GIT);

    const result = loadConfig({
      cwd: tmpDir,
      env: { VERSIONINGS_GIT_PLATFORM: 'bitbucket' },
      cliOverrides: {
        git: { platform: 'github', pr: { target: 'main' } },
      },
    });

    // CLI wins over env
    expect(result.config.git.platform).toBe('github');
    // CLI wins over defaults
    expect(result.config.git.pr.target).toBe('main');
    expect(result.sources.some((s) => s.name === 'cli')).toBe(true);
    expect(result.provenance['git.platform'].source).toBe('cli');
    expect(result.provenance['git.pr.target'].source).toBe('cli');
  });

  // 7. Deep merge — fields from different sources combine
  test('deep merge — fields from different sources combine', () => {
    // version.json provides platform + url
    writeJson('version.json', {
      git: { platform: 'github', url: 'https://github.com/org/repo.git' },
    });
    // .versioningsrc.json provides pr.target
    writeJson('.versioningsrc.json', {
      git: { pr: { target: 'develop' } },
    });

    const result = loadConfig({
      cwd: tmpDir,
      env: { VERSIONINGS_GIT_REMOTE: 'upstream' },
    });

    // All fields from different sources are present
    expect(result.config.git.platform).toBe('github');
    expect(result.config.git.url).toBe('https://github.com/org/repo.git');
    expect(result.config.git.pr.target).toBe('develop');
    expect(result.config.git.remote).toBe('upstream');
    // Provenance tracks each source
    expect(result.provenance['git.platform'].source).toBe('version.json');
    expect(result.provenance['git.pr.target'].source).toBe('.versioningsrc.json');
    expect(result.provenance['git.remote'].source).toBe('env');
  });

  // 8. Multiple RC files — warning, first one used (deterministic order)
  test('multiple RC files — warning emitted, first in priority order used', () => {
    // Both .versioningsrc.json and .versioningsrc.yml exist
    writeJson('.versioningsrc.json', {
      git: { platform: 'github', url: 'https://github.com/org/repo.git' },
    });
    writeFile('.versioningsrc.yml', [
      'git:',
      '  platform: bitbucket',
      '  url: https://bitbucket.org/org/repo.git',
    ].join('\n') + '\n');

    const result = loadConfig({ cwd: tmpDir, env: {} });

    // .versioningsrc.json has higher priority than .versioningsrc.yml
    expect(result.config.git.platform).toBe('github');
    expect(result.sources.some((s) => s.name === '.versioningsrc.json')).toBe(true);
    expect(result.sources.every((s) => s.name !== '.versioningsrc.yml')).toBe(true);
    // Warning about multiple RC files
    expect(result.warnings.some((w) => w.includes('Multiple RC files'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('.versioningsrc.json') && w.includes('.versioningsrc.yml'))).toBe(true);
  });

  // 9. Strict mode — unknown top-level fields → error (additionalProperties: false at root)
  test('unknown top-level fields cause CONFIG_ERROR', () => {
    writeJson('version.json', {
      ...VALID_GIT,
      unknownField: 'should-fail',
    });

    expect(() => loadConfig({ cwd: tmpDir, env: {} })).toThrow(VersioningsError);

    try {
      loadConfig({ cwd: tmpDir, env: {} });
    } catch (err: any) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
    }
  });

  // 10. No sources → warning with example
  test('no configuration sources — throws CONFIG_ERROR (defaults alone fail schema)', () => {
    // Empty tmpdir — no config files at all

    expect(() => loadConfig({ cwd: tmpDir, env: {} })).toThrow(VersioningsError);

    try {
      loadConfig({ cwd: tmpDir, env: {} });
    } catch (err: any) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
    }
  });
});
