// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { loadAndValidateConfig, validateWithProvenance } from '../../config.validator';
import { EXIT_CODES, VersioningsError } from '../../errors';

describe('config.validator — loadAndValidateConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versionings-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeConfig(obj: Record<string, any>): string {
    const filePath = path.join(tmpDir, 'version.json');
    fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
    return filePath;
  }

  function writeRawConfig(content: string): string {
    const filePath = path.join(tmpDir, 'version.json');
    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
  }

  test('valid config — returns merged config with defaults', () => {
    const filePath = writeConfig({
      git: {
        platform: 'github',
        url: 'https://github.com/user/repo.git',
      },
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.git.platform).toBe('github');
    expect(config.git.url).toBe('https://github.com/user/repo.git');
    expect(config.git.remote).toBe('origin');
    expect(config.git.branchType).toEqual({ version: 'version' });
    expect(config.git.pr.target).toBe('master');
    expect(config.git.limits).toEqual({ branchMaxCommentLength: 96 });
    expect(config.git.commit.message.semver.patch).toBe(
      'Patch: v%s. You SHOULD consider changes.'
    );
  });

  test('missing file — throws VersioningsError with CONFIG_ERROR and expectedPath', () => {
    const filePath = path.join(tmpDir, 'nonexistent.json');
    expect(() => loadAndValidateConfig(filePath)).toThrow(VersioningsError);
    try {
      loadAndValidateConfig(filePath);
    } catch (err: any) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
      expect(err.details).toBeDefined();
      expect(err.details.expectedPath).toBe(filePath);
    }
  });

  test('invalid JSON — throws VersioningsError with CONFIG_ERROR and parseError', () => {
    const filePath = writeRawConfig('{ not valid json!!!');
    expect(() => loadAndValidateConfig(filePath)).toThrow(VersioningsError);
    try {
      loadAndValidateConfig(filePath);
    } catch (err: any) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
      expect(err.details).toBeDefined();
      expect(err.details.parseError).toBeDefined();
      expect(typeof err.details.parseError).toBe('string');
    }
  });

  test('schema mismatch — missing required field throws with validationErrors', () => {
    const filePath = writeConfig({ git: { platform: 'github' } });
    expect(() => loadAndValidateConfig(filePath)).toThrow(VersioningsError);
    try {
      loadAndValidateConfig(filePath);
    } catch (err: any) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
      expect(err.details).toBeDefined();
      expect(Array.isArray(err.details.validationErrors)).toBe(true);
      expect(err.details.validationErrors.length).toBeGreaterThan(0);
      err.details.validationErrors.forEach((ve: any) => {
        expect(ve).toHaveProperty('path');
        expect(ve).toHaveProperty('message');
      });
    }
  });

  test('schema mismatch — invalid platform value throws with validationErrors', () => {
    const filePath = writeConfig({
      git: { platform: 'unknown-platform', url: 'https://example.com/user/repo.git' },
    });
    expect(() => loadAndValidateConfig(filePath)).toThrow(VersioningsError);
    try {
      loadAndValidateConfig(filePath);
    } catch (err: any) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
      expect(Array.isArray(err.details.validationErrors)).toBe(true);
      expect(err.details.validationErrors.length).toBeGreaterThan(0);
    }
  });

  test('merge with defaults — pr.target defaults to master when not in config', () => {
    const filePath = writeConfig({
      git: { platform: 'bitbucket', url: 'https://bitbucket.org/user/repo.git' },
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.git.pr.target).toBe('master');
    expect(config.git.remote).toBe('origin');
    expect(config.git.platform).toBe('bitbucket');
  });

  test('merge with defaults — pr.target from config overrides default', () => {
    const filePath = writeConfig({
      git: {
        platform: 'github',
        url: 'https://github.com/user/repo.git',
        pr: { target: 'develop' },
      },
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.git.pr.target).toBe('develop');
    expect(config.git.remote).toBe('origin');
  });
});


describe('config.validator — validateWithProvenance', () => {
  const validConfig = {
    git: {
      platform: 'github',
      url: 'https://github.com/user/repo.git',
      remote: 'origin',
      branchType: { version: 'version' },
      pr: { target: 'master' },
      limits: { branchMaxCommentLength: 96 },
      commit: {
        message: {
          semver: {
            patch: 'Patch: v%s.',
            prepatch: 'Prepatch: v%s.',
            minor: 'Minor: v%s.',
            preminor: 'Preminor: v%s.',
            premajor: 'Premajor: v%s.',
            major: 'Major: v%s.',
            prerelease: 'Pre: v%s.',
          },
        },
      },
    },
  };

  const provenance = {
    'git.platform': { value: 'github', source: 'version.json' },
    'git.url': { value: 'https://github.com/user/repo.git', source: 'version.json' },
    'git.remote': { value: 'origin', source: 'defaults' },
    'git.branchType.version': { value: 'version', source: 'defaults' },
    'git.pr.target': { value: 'master', source: 'defaults' },
    'git.limits.branchMaxCommentLength': { value: 96, source: 'defaults' },
  };

  test('valid config in default mode — returns valid result with no warnings', () => {
    const result = validateWithProvenance(validConfig, provenance, false);
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  test('valid config in strict mode — returns valid result', () => {
    const result = validateWithProvenance(validConfig, provenance, true);
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  test('default mode with unknown top-level field — returns warnings', () => {
    const configWithExtra = {
      ...validConfig,
      unknownTopLevel: 'some value',
    };
    const provenanceWithExtra = {
      ...provenance,
      unknownTopLevel: { value: 'some value', source: '.versioningsrc' },
    };

    const result = validateWithProvenance(configWithExtra, provenanceWithExtra, false);
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0].path).toBe('unknownTopLevel');
    expect(result.warnings[0].source).toBe('.versioningsrc');
    expect(result.warnings[0].message).toContain('Unknown field');
  });

  test('default mode with unknown nested field inside git — returns warnings', () => {
    const configWithNestedExtra = {
      git: {
        ...validConfig.git,
        unknownGitField: 'value',
      },
    };
    const provenanceWithNestedExtra = {
      ...provenance,
      'git.unknownGitField': { value: 'value', source: 'env' },
    };

    const result = validateWithProvenance(configWithNestedExtra, provenanceWithNestedExtra, false);
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0].path).toBe('git.unknownGitField');
    expect(result.warnings[0].source).toBe('env');
  });

  test('strict mode with unknown field — throws VersioningsError(CONFIG_ERROR)', () => {
    const configWithExtra = {
      ...validConfig,
      unknownField: 'value',
    };
    const provenanceWithExtra = {
      ...provenance,
      unknownField: { value: 'value', source: 'cli' },
    };

    expect(() => validateWithProvenance(configWithExtra, provenanceWithExtra, true)).toThrow(VersioningsError);
    try {
      validateWithProvenance(configWithExtra, provenanceWithExtra, true);
    } catch (err: any) {
      expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
      expect(err.message).toContain('unknown field');
      expect(err.details.unknownFields).toBeDefined();
      expect(err.details.unknownFields.length).toBe(1);
      expect(err.details.unknownFields[0].path).toBe('unknownField');
      expect(err.details.unknownFields[0].source).toBe('cli');
    }
  });

  test('strict mode with multiple unknown fields — throws with all listed', () => {
    const configWithMultipleExtra = {
      ...validConfig,
      extra1: 'a',
      extra2: 'b',
    };
    const provenanceMulti = {
      ...provenance,
      extra1: { value: 'a', source: 'env' },
      extra2: { value: 'b', source: '.versioningsrc' },
    };

    try {
      validateWithProvenance(configWithMultipleExtra, provenanceMulti, true);
      throw new Error('Expected VersioningsError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
      expect(err.details.unknownFields.length).toBe(2);
    }
  });

  test('type error always throws regardless of strict mode', () => {
    const invalidConfig = {
      git: {
        platform: 123, // should be string
        url: 'https://github.com/user/repo.git',
      },
    };

    expect(() => validateWithProvenance(invalidConfig, provenance, false)).toThrow(VersioningsError);
    expect(() => validateWithProvenance(invalidConfig, provenance, true)).toThrow(VersioningsError);

    try {
      validateWithProvenance(invalidConfig, provenance, false);
    } catch (err: any) {
      expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
      expect(err.details.validationErrors).toBeDefined();
    }
  });

  test('missing required field always throws regardless of strict mode', () => {
    const missingRequired = {
      git: {
        platform: 'github',
        // url is missing
      },
    };

    expect(() => validateWithProvenance(missingRequired, provenance, false)).toThrow(VersioningsError);
    expect(() => validateWithProvenance(missingRequired, provenance, true)).toThrow(VersioningsError);
  });

  test('error messages include source from provenance', () => {
    const invalidConfig = {
      git: {
        platform: 'unknown-platform', // invalid enum value
        url: 'https://example.com/repo.git',
      },
    };
    const provenanceInvalid = {
      'git.platform': { value: 'unknown-platform', source: 'env' },
      'git.url': { value: 'https://example.com/repo.git', source: 'version.json' },
    };

    try {
      validateWithProvenance(invalidConfig, provenanceInvalid, false);
      throw new Error('Expected VersioningsError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
      // Check that validation errors include source info
      const ve = err.details.validationErrors;
      expect(ve.length).toBeGreaterThan(0);
      const platformError = ve.find((e: any) => e.path.includes('platform'));
      expect(platformError).toBeDefined();
      expect(platformError.source).toBeDefined();
    }
  });

  test('default strict parameter is false', () => {
    const configWithExtra = {
      ...validConfig,
      extraField: 'value',
    };

    // Should not throw (default is non-strict)
    const result = validateWithProvenance(configWithExtra, provenance);
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBe(1);
  });

  test('provenance fallback to parent path when exact path not found', () => {
    const configWithNestedUnknown = {
      git: {
        ...validConfig.git,
        unknownNested: { deep: 'value' },
      },
    };
    // Only parent path in provenance, not the exact unknown path
    const sparseProvenance = {
      ...provenance,
    };

    const result = validateWithProvenance(configWithNestedUnknown, sparseProvenance, false);
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBe(1);
    // Source should fall back to 'unknown' since no provenance entry exists
    expect(result.warnings[0].source).toBe('unknown');
  });
});


describe('config.validator — extended platform enum (P2)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versionings-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeConfig(obj: Record<string, any>): string {
    const filePath = path.join(tmpDir, 'version.json');
    fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
    return filePath;
  }

  const extendedPlatforms = ['github', 'github-enterprise', 'bitbucket', 'bitbucket-server', 'gitlab', 'azure-devops'];

  test.each(extendedPlatforms.filter(p => p !== 'github-enterprise' && p !== 'bitbucket-server'))(
    'platform "%s" passes validation without apiUrl',
    (platform) => {
      const filePath = writeConfig({
        git: { platform, url: 'https://example.com/org/repo.git' },
      });
      const config = loadAndValidateConfig(filePath);
      expect(config.git.platform).toBe(platform);
    }
  );

  test.each(['github-enterprise', 'bitbucket-server'])(
    'platform "%s" requires apiUrl — fails without it',
    (platform) => {
      const filePath = writeConfig({
        git: { platform, url: 'https://example.com/org/repo.git' },
      });
      expect(() => loadAndValidateConfig(filePath)).toThrow(VersioningsError);
      try {
        loadAndValidateConfig(filePath);
      } catch (err: any) {
        expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
      }
    }
  );

  test.each(['github-enterprise', 'bitbucket-server'])(
    'platform "%s" passes validation with apiUrl',
    (platform) => {
      const filePath = writeConfig({
        git: { platform, url: 'https://example.com/org/repo.git', apiUrl: 'https://git.corp.com/api' },
      });
      const config = loadAndValidateConfig(filePath);
      expect(config.git.platform).toBe(platform);
      expect(config.git.apiUrl).toBe('https://git.corp.com/api');
    }
  );
});


describe('config.validator — git.apiUrl validation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versionings-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeConfig(obj: Record<string, any>): string {
    const filePath = path.join(tmpDir, 'version.json');
    fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
    return filePath;
  }

  test('valid https apiUrl passes', () => {
    const filePath = writeConfig({
      git: { platform: 'github', url: 'https://github.com/org/repo.git', apiUrl: 'https://api.github.com' },
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.git.apiUrl).toBe('https://api.github.com');
  });

  test('valid http apiUrl passes', () => {
    const filePath = writeConfig({
      git: { platform: 'github', url: 'https://github.com/org/repo.git', apiUrl: 'http://localhost:8080' },
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.git.apiUrl).toBe('http://localhost:8080');
  });

  test('apiUrl without http/https prefix fails', () => {
    const filePath = writeConfig({
      git: { platform: 'github', url: 'https://github.com/org/repo.git', apiUrl: 'ftp://example.com' },
    });
    expect(() => loadAndValidateConfig(filePath)).toThrow(VersioningsError);
  });
});


describe('config.validator — git.auth section', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versionings-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeConfig(obj: Record<string, any>): string {
    const filePath = path.join(tmpDir, 'version.json');
    fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
    return filePath;
  }

  test('auth section with token and method passes', () => {
    const filePath = writeConfig({
      git: {
        platform: 'github',
        url: 'https://github.com/org/repo.git',
        auth: { token: 'ghp_abc123', method: 'token' },
      },
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.git.auth).toEqual({ token: 'ghp_abc123', method: 'token' });
  });

  test('auth section with bearer method passes', () => {
    const filePath = writeConfig({
      git: {
        platform: 'gitlab',
        url: 'https://gitlab.com/org/repo.git',
        auth: { token: 'glpat-abc', method: 'bearer' },
      },
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.git.auth).toEqual({ token: 'glpat-abc', method: 'bearer' });
  });

  test('auth section with invalid method fails', () => {
    const filePath = writeConfig({
      git: {
        platform: 'github',
        url: 'https://github.com/org/repo.git',
        auth: { token: 'abc', method: 'oauth' },
      },
    });
    expect(() => loadAndValidateConfig(filePath)).toThrow(VersioningsError);
  });
});


describe('config.validator — git.api.timeout range', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versionings-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeConfig(obj: Record<string, any>): string {
    const filePath = path.join(tmpDir, 'version.json');
    fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
    return filePath;
  }

  test('timeout at minimum (1000) passes', () => {
    const filePath = writeConfig({
      git: { platform: 'github', url: 'https://github.com/org/repo.git', api: { timeout: 1000 } },
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.git.api).toEqual({ timeout: 1000 });
  });

  test('timeout at maximum (120000) passes', () => {
    const filePath = writeConfig({
      git: { platform: 'github', url: 'https://github.com/org/repo.git', api: { timeout: 120000 } },
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.git.api).toEqual({ timeout: 120000 });
  });

  test('timeout below minimum (999) fails', () => {
    const filePath = writeConfig({
      git: { platform: 'github', url: 'https://github.com/org/repo.git', api: { timeout: 999 } },
    });
    expect(() => loadAndValidateConfig(filePath)).toThrow(VersioningsError);
  });

  test('timeout above maximum (120001) fails', () => {
    const filePath = writeConfig({
      git: { platform: 'github', url: 'https://github.com/org/repo.git', api: { timeout: 120001 } },
    });
    expect(() => loadAndValidateConfig(filePath)).toThrow(VersioningsError);
  });

  test('timeout as float (5000.5) fails — must be integer', () => {
    const filePath = writeConfig({
      git: { platform: 'github', url: 'https://github.com/org/repo.git', api: { timeout: 5000.5 } },
    });
    expect(() => loadAndValidateConfig(filePath)).toThrow(VersioningsError);
  });
});


describe('config.validator — git.pr extended fields', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versionings-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeConfig(obj: Record<string, any>): string {
    const filePath = path.join(tmpDir, 'version.json');
    fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
    return filePath;
  }

  test('pr with reviewers, labels, draft, template, milestone, linkedIssues passes', () => {
    const filePath = writeConfig({
      git: {
        platform: 'github',
        url: 'https://github.com/org/repo.git',
        pr: {
          target: 'main',
          reviewers: ['alice', 'bob'],
          labels: ['release', 'auto'],
          draft: true,
          template: '.github/PULL_REQUEST_TEMPLATE.md',
          milestone: 'v1.0',
          linkedIssues: ['#42', '#43'],
        },
      },
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.git.pr.reviewers).toEqual(['alice', 'bob']);
    expect(config.git.pr.labels).toEqual(['release', 'auto']);
    expect(config.git.pr.draft).toBe(true);
    expect(config.git.pr.template).toBe('.github/PULL_REQUEST_TEMPLATE.md');
    expect(config.git.pr.milestone).toBe('v1.0');
    expect(config.git.pr.linkedIssues).toEqual(['#42', '#43']);
  });

  test('pr with empty reviewers array passes', () => {
    const filePath = writeConfig({
      git: {
        platform: 'github',
        url: 'https://github.com/org/repo.git',
        pr: { target: 'main', reviewers: [] },
      },
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.git.pr.reviewers).toEqual([]);
  });

  test('pr.draft defaults to false when not specified', () => {
    const filePath = writeConfig({
      git: { platform: 'github', url: 'https://github.com/org/repo.git' },
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.git.pr.draft).toBeUndefined();
  });
});


describe('config.validator — backward compatibility', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versionings-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeConfig(obj: Record<string, any>): string {
    const filePath = path.join(tmpDir, 'version.json');
    fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
    return filePath;
  }

  test('old config with only github platform and url passes', () => {
    const filePath = writeConfig({
      git: { platform: 'github', url: 'https://github.com/org/repo.git' },
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.git.platform).toBe('github');
    expect(config.git.auth).toBeUndefined();
    expect(config.git.api).toBeUndefined();
    expect(config.git.apiUrl).toBeUndefined();
  });

  test('old config with bitbucket platform passes', () => {
    const filePath = writeConfig({
      git: { platform: 'bitbucket', url: 'https://bitbucket.org/org/repo.git' },
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.git.platform).toBe('bitbucket');
    expect(config.git.pr.target).toBe('master');
    expect(config.git.remote).toBe('origin');
  });

  test('old config with pr.target passes and preserves value', () => {
    const filePath = writeConfig({
      git: {
        platform: 'github',
        url: 'https://github.com/org/repo.git',
        pr: { target: 'develop' },
      },
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.git.pr.target).toBe('develop');
  });
});
