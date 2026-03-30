// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { loadAndValidateConfig } from '../../config.validator';
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
      git: { platform: 'gitlab', url: 'https://gitlab.com/user/repo.git' },
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
