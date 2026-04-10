// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { loadAndValidateConfig, validateWithProvenance } from '../../../src/config/config.validator';
import { EXIT_CODES, VersioningsError } from '../../../src/core/errors';

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


describe('config.validator — git.branching section', () => {
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

  test('config without git.branching passes validation (backward compatibility)', () => {
    const filePath = writeConfig({
      git: { platform: 'github', url: 'https://github.com/org/repo.git' },
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.git.platform).toBe('github');
    // branching defaults should be applied
    expect(config.git.branching).toBeDefined();
    expect(config.git.branching!.strategy).toBe('default');
    expect(config.git.branching!.mainBranch).toBe('master');
    expect(config.git.branching!.developBranch).toBe('develop');
  });

  test('git.branching.strategy enum — valid values pass', () => {
    const strategies = ['default', 'trunk-based', 'git-flow', 'release-branch', 'hotfix', 'maintenance'];
    for (const strategy of strategies) {
      const filePath = writeConfig({
        git: {
          platform: 'github',
          url: 'https://github.com/org/repo.git',
          branching: { strategy },
        },
      });
      const config = loadAndValidateConfig(filePath);
      expect(config.git.branching!.strategy).toBe(strategy);
    }
  });

  test('git.branching.strategy — invalid value fails validation', () => {
    const filePath = writeConfig({
      git: {
        platform: 'github',
        url: 'https://github.com/org/repo.git',
        branching: { strategy: 'invalid-strategy' },
      },
    });
    expect(() => loadAndValidateConfig(filePath)).toThrow(VersioningsError);
    try {
      loadAndValidateConfig(filePath);
    } catch (err: any) {
      expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
      expect(Array.isArray(err.details.validationErrors)).toBe(true);
    }
  });

  test('git.branching.branchTemplate — non-empty string passes', () => {
    const filePath = writeConfig({
      git: {
        platform: 'github',
        url: 'https://github.com/org/repo.git',
        branching: { strategy: 'default', branchTemplate: '{branchType}/{semver}/{version}' },
      },
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.git.branching!.branchTemplate).toBe('{branchType}/{semver}/{version}');
  });

  test('git.branching.branchTemplate — empty string fails validation', () => {
    const filePath = writeConfig({
      git: {
        platform: 'github',
        url: 'https://github.com/org/repo.git',
        branching: { strategy: 'default', branchTemplate: '' },
      },
    });
    expect(() => loadAndValidateConfig(filePath)).toThrow(VersioningsError);
  });

  test('git.branching.tagTemplate — non-empty string passes', () => {
    const filePath = writeConfig({
      git: {
        platform: 'github',
        url: 'https://github.com/org/repo.git',
        branching: { strategy: 'default', tagTemplate: 'v{version}' },
      },
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.git.branching!.tagTemplate).toBe('v{version}');
  });

  test('git.branching.tagTemplate — empty string fails validation', () => {
    const filePath = writeConfig({
      git: {
        platform: 'github',
        url: 'https://github.com/org/repo.git',
        branching: { strategy: 'default', tagTemplate: '' },
      },
    });
    expect(() => loadAndValidateConfig(filePath)).toThrow(VersioningsError);
  });

  test('git.branching.mainBranch and developBranch — custom values pass', () => {
    const filePath = writeConfig({
      git: {
        platform: 'github',
        url: 'https://github.com/org/repo.git',
        branching: { strategy: 'git-flow', mainBranch: 'main', developBranch: 'dev' },
      },
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.git.branching!.mainBranch).toBe('main');
    expect(config.git.branching!.developBranch).toBe('dev');
  });

  test('git.branching.mainBranch and developBranch — defaults applied when not specified', () => {
    const filePath = writeConfig({
      git: {
        platform: 'github',
        url: 'https://github.com/org/repo.git',
        branching: { strategy: 'trunk-based' },
      },
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.git.branching!.mainBranch).toBe('master');
    expect(config.git.branching!.developBranch).toBe('develop');
  });

  test('git.branching — additionalProperties rejected', () => {
    const filePath = writeConfig({
      git: {
        platform: 'github',
        url: 'https://github.com/org/repo.git',
        branching: { strategy: 'default', unknownField: 'value' },
      },
    });
    expect(() => loadAndValidateConfig(filePath)).toThrow(VersioningsError);
  });

  test('git.branching with all fields passes', () => {
    const filePath = writeConfig({
      git: {
        platform: 'github',
        url: 'https://github.com/org/repo.git',
        branching: {
          strategy: 'git-flow',
          branchTemplate: 'release/{version}',
          tagTemplate: 'v{version}',
          mainBranch: 'main',
          developBranch: 'dev',
        },
      },
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.git.branching).toEqual({
      strategy: 'git-flow',
      branchTemplate: 'release/{version}',
      tagTemplate: 'v{version}',
      mainBranch: 'main',
      developBranch: 'dev',
    });
  });
});


describe('config.validator — conventionalCommits section', () => {
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

  const baseGit = { platform: 'github', url: 'https://github.com/org/repo.git' };

  test('valid conventionalCommits with all fields passes', () => {
    const filePath = writeConfig({
      git: baseGit,
      conventionalCommits: {
        enabled: true,
        types: { feat: 'minor', fix: 'patch', chore: 'none', breaking: 'major' },
        fallbackBump: 'patch',
      },
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.conventionalCommits).toBeDefined();
    expect(config.conventionalCommits!.enabled).toBe(true);
    expect(config.conventionalCommits!.types.feat).toBe('minor');
    expect(config.conventionalCommits!.types.breaking).toBe('major');
    expect(config.conventionalCommits!.fallbackBump).toBe('patch');
  });

  test('conventionalCommits.types — valid enum values (major, minor, patch, none) pass', () => {
    const filePath = writeConfig({
      git: baseGit,
      conventionalCommits: {
        types: { a: 'major', b: 'minor', c: 'patch', d: 'none' },
      },
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.conventionalCommits!.types.a).toBe('major');
    expect(config.conventionalCommits!.types.b).toBe('minor');
    expect(config.conventionalCommits!.types.c).toBe('patch');
    expect(config.conventionalCommits!.types.d).toBe('none');
  });

  test('conventionalCommits.types — invalid enum value fails', () => {
    const filePath = writeConfig({
      git: baseGit,
      conventionalCommits: {
        types: { feat: 'invalid-level' },
      },
    });
    expect(() => loadAndValidateConfig(filePath)).toThrow(VersioningsError);
    try {
      loadAndValidateConfig(filePath);
    } catch (err: any) {
      expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
      expect(Array.isArray(err.details.validationErrors)).toBe(true);
    }
  });

  test('conventionalCommits.types — partial map passes (not all types required)', () => {
    const filePath = writeConfig({
      git: baseGit,
      conventionalCommits: {
        types: { feat: 'minor' },
      },
    });
    const config = loadAndValidateConfig(filePath);
    // User-provided type merged with defaults
    expect(config.conventionalCommits!.types.feat).toBe('minor');
  });

  test('conventionalCommits.fallbackBump — valid string values pass', () => {
    for (const fb of ['patch', 'minor', 'major']) {
      const filePath = writeConfig({
        git: baseGit,
        conventionalCommits: { fallbackBump: fb },
      });
      const config = loadAndValidateConfig(filePath);
      expect(config.conventionalCommits!.fallbackBump).toBe(fb);
    }
  });

  test('conventionalCommits.fallbackBump — null passes', () => {
    const filePath = writeConfig({
      git: baseGit,
      conventionalCommits: { fallbackBump: null },
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.conventionalCommits!.fallbackBump).toBeNull();
  });

  test('conventionalCommits.fallbackBump — invalid value fails', () => {
    const filePath = writeConfig({
      git: baseGit,
      conventionalCommits: { fallbackBump: 'prerelease' },
    });
    expect(() => loadAndValidateConfig(filePath)).toThrow(VersioningsError);
    try {
      loadAndValidateConfig(filePath);
    } catch (err: any) {
      expect(err.code).toBe(EXIT_CODES.CONFIG_ERROR);
    }
  });

  test('conventionalCommits.enabled — boolean passes, non-boolean fails', () => {
    const validPath = writeConfig({
      git: baseGit,
      conventionalCommits: { enabled: false },
    });
    const config = loadAndValidateConfig(validPath);
    expect(config.conventionalCommits!.enabled).toBe(false);

    const invalidPath = writeConfig({
      git: baseGit,
      conventionalCommits: { enabled: 'yes' },
    });
    expect(() => loadAndValidateConfig(invalidPath)).toThrow(VersioningsError);
  });

  test('conventionalCommits — unknown field rejected (additionalProperties: false)', () => {
    const filePath = writeConfig({
      git: baseGit,
      conventionalCommits: { unknownField: 'value' },
    });
    expect(() => loadAndValidateConfig(filePath)).toThrow(VersioningsError);
  });

  test('conventionalCommits defaults applied when section is empty object', () => {
    const filePath = writeConfig({
      git: baseGit,
      conventionalCommits: {},
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.conventionalCommits!.enabled).toBe(true);
    expect(config.conventionalCommits!.fallbackBump).toBeNull();
    expect(config.conventionalCommits!.types.feat).toBe('minor');
    expect(config.conventionalCommits!.types.fix).toBe('patch');
  });
});


describe('config.validator — changelog section', () => {
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

  const baseGit = { platform: 'github', url: 'https://github.com/org/repo.git' };

  test('valid changelog with all fields passes', () => {
    const filePath = writeConfig({
      git: baseGit,
      changelog: {
        template: 'my-template.hbs',
        groupTitles: { feat: 'New Features', fix: 'Fixes' },
        excludeTypes: ['chore', 'docs'],
        includeNonConventional: true,
        file: 'CHANGELOG.md',
      },
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.changelog).toBeDefined();
    expect(config.changelog!.groupTitles.feat).toBe('New Features');
    expect(config.changelog!.excludeTypes).toEqual(['chore', 'docs']);
    expect(config.changelog!.includeNonConventional).toBe(true);
    expect(config.changelog!.file).toBe('CHANGELOG.md');
  });

  test('changelog.excludeTypes — valid array of strings passes', () => {
    const filePath = writeConfig({
      git: baseGit,
      changelog: { excludeTypes: ['chore', 'test', 'ci'] },
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.changelog!.excludeTypes).toEqual(['chore', 'test', 'ci']);
  });

  test('changelog.excludeTypes — empty array passes', () => {
    const filePath = writeConfig({
      git: baseGit,
      changelog: { excludeTypes: [] },
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.changelog!.excludeTypes).toEqual([]);
  });

  test('changelog.excludeTypes — array with empty string fails (minLength 1)', () => {
    const filePath = writeConfig({
      git: baseGit,
      changelog: { excludeTypes: ['chore', ''] },
    });
    expect(() => loadAndValidateConfig(filePath)).toThrow(VersioningsError);
  });

  test('changelog.excludeTypes — non-array value fails', () => {
    const filePath = writeConfig({
      git: baseGit,
      changelog: { excludeTypes: 'chore' },
    });
    expect(() => loadAndValidateConfig(filePath)).toThrow(VersioningsError);
  });

  test('changelog.groupTitles — valid object with string values passes', () => {
    const filePath = writeConfig({
      git: baseGit,
      changelog: { groupTitles: { feat: 'Features', fix: 'Bug Fixes', perf: 'Performance' } },
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.changelog!.groupTitles.feat).toBe('Features');
    expect(config.changelog!.groupTitles.fix).toBe('Bug Fixes');
  });

  test('changelog.groupTitles — empty string value fails (minLength 1)', () => {
    const filePath = writeConfig({
      git: baseGit,
      changelog: { groupTitles: { feat: '' } },
    });
    expect(() => loadAndValidateConfig(filePath)).toThrow(VersioningsError);
  });

  test('changelog.groupTitles — non-string value fails', () => {
    const filePath = writeConfig({
      git: baseGit,
      changelog: { groupTitles: { feat: 123 } },
    });
    expect(() => loadAndValidateConfig(filePath)).toThrow(VersioningsError);
  });

  test('changelog.file — valid string passes', () => {
    const filePath = writeConfig({
      git: baseGit,
      changelog: { file: 'CHANGELOG.md' },
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.changelog!.file).toBe('CHANGELOG.md');
  });

  test('changelog.file — empty string fails (minLength 1)', () => {
    const filePath = writeConfig({
      git: baseGit,
      changelog: { file: '' },
    });
    expect(() => loadAndValidateConfig(filePath)).toThrow(VersioningsError);
  });

  test('changelog.file — string exceeding maxLength (512) fails', () => {
    const filePath = writeConfig({
      git: baseGit,
      changelog: { file: 'a'.repeat(513) },
    });
    expect(() => loadAndValidateConfig(filePath)).toThrow(VersioningsError);
  });

  test('changelog.includeNonConventional — boolean passes, non-boolean fails', () => {
    const validPath = writeConfig({
      git: baseGit,
      changelog: { includeNonConventional: true },
    });
    const config = loadAndValidateConfig(validPath);
    expect(config.changelog!.includeNonConventional).toBe(true);

    const invalidPath = writeConfig({
      git: baseGit,
      changelog: { includeNonConventional: 'yes' },
    });
    expect(() => loadAndValidateConfig(invalidPath)).toThrow(VersioningsError);
  });

  test('changelog.template — valid non-empty string passes', () => {
    const filePath = writeConfig({
      git: baseGit,
      changelog: { template: 'custom-template.hbs' },
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.changelog!.template).toBe('custom-template.hbs');
  });

  test('changelog.template — empty string fails (minLength 1)', () => {
    const filePath = writeConfig({
      git: baseGit,
      changelog: { template: '' },
    });
    expect(() => loadAndValidateConfig(filePath)).toThrow(VersioningsError);
  });

  test('changelog — unknown field rejected (additionalProperties: false)', () => {
    const filePath = writeConfig({
      git: baseGit,
      changelog: { unknownField: 'value' },
    });
    expect(() => loadAndValidateConfig(filePath)).toThrow(VersioningsError);
  });

  test('changelog defaults applied when section is empty object', () => {
    const filePath = writeConfig({
      git: baseGit,
      changelog: {},
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.changelog!.includeNonConventional).toBe(false);
    expect(config.changelog!.excludeTypes).toEqual([]);
    expect(config.changelog!.groupTitles.feat).toBe('Features');
    expect(config.changelog!.groupTitles.fix).toBe('Bug Fixes');
    expect(config.changelog!.groupTitles.breaking).toBe('BREAKING CHANGES');
  });

  test('backward compatibility — old config without conventionalCommits and changelog passes', () => {
    const filePath = writeConfig({
      git: baseGit,
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.git.platform).toBe('github');
    // Defaults should be applied for new sections
    expect(config.conventionalCommits).toBeDefined();
    expect(config.conventionalCommits!.enabled).toBe(true);
    expect(config.conventionalCommits!.fallbackBump).toBeNull();
    expect(config.changelog).toBeDefined();
    expect(config.changelog!.excludeTypes).toEqual([]);
    expect(config.changelog!.includeNonConventional).toBe(false);
  });

  test('config with both conventionalCommits and changelog sections passes', () => {
    const filePath = writeConfig({
      git: baseGit,
      conventionalCommits: {
        enabled: true,
        types: { feat: 'minor', fix: 'patch' },
        fallbackBump: 'patch',
      },
      changelog: {
        groupTitles: { feat: 'New', fix: 'Fixed' },
        excludeTypes: ['chore'],
        includeNonConventional: false,
        file: 'CHANGES.md',
      },
    });
    const config = loadAndValidateConfig(filePath);
    expect(config.conventionalCommits!.enabled).toBe(true);
    expect(config.conventionalCommits!.fallbackBump).toBe('patch');
    expect(config.changelog!.file).toBe('CHANGES.md');
    expect(config.changelog!.groupTitles.feat).toBe('New');
    expect(config.changelog!.excludeTypes).toEqual(['chore']);
  });
});
