// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createOperationLog, OperationLogEntry } from '../../../src/core/operation.log';
import { VersioningsError, EXIT_CODES } from '../../../src/core/errors';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'oplog-test-'));
}

function rmrf(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function makeEntry(overrides: Partial<OperationLogEntry> = {}): OperationLogEntry {
  return {
    schemaVersion: 1,
    timestamp: '2025-01-15T10:30:00.000Z',
    semver: 'patch',
    version: '1.2.3',
    previousVersion: '1.2.2',
    branch: 'version/patch/1.2.3/fix-login',
    tag: '1.2.3--fix-login',
    steps: [
      { type: 'npm_version_bump', meta: {} },
      { type: 'branch_created', meta: { name: 'version/patch/1.2.3/fix-login' } },
    ],
    result: 'success',
    ...overrides,
  };
}

describe('operation.log', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmrf(tmpDir);
  });

  // --- Requirement 10.5, 10.6: save + loadLast round-trip ---

  test('save + loadLast round-trip — saved entry is loaded back identically', async () => {
    const log = createOperationLog(tmpDir);
    const entry = makeEntry();

    await log.save(entry);
    const loaded = await log.loadLast();

    expect(loaded).toEqual(entry);
  });

  test('save creates last.json as a symlink pointing to the saved file', async () => {
    const log = createOperationLog(tmpDir);
    const entry = makeEntry();

    const savedPath = await log.save(entry);
    const linkPath = path.join(tmpDir, 'last.json');

    const stat = fs.lstatSync(linkPath);
    expect(stat.isSymbolicLink()).toBe(true);

    const target = fs.readlinkSync(linkPath);
    expect(target).toBe(path.basename(savedPath));
  });

  test('multiple saves — loadLast returns the most recent entry', async () => {
    const log = createOperationLog(tmpDir);

    const entry1 = makeEntry({ version: '1.0.0', timestamp: '2025-01-15T10:00:00.000Z' });
    const entry2 = makeEntry({ version: '2.0.0', timestamp: '2025-01-15T11:00:00.000Z' });

    await log.save(entry1);
    await log.save(entry2);

    const loaded = await log.loadLast();
    expect(loaded).toEqual(entry2);
  });

  // --- Requirement 10.9: loadFrom specific file ---

  test('loadFrom — loads entry from a specific file path', async () => {
    const log = createOperationLog(tmpDir);
    const entry = makeEntry();

    const savedPath = await log.save(entry);
    const loaded = await log.loadFrom(savedPath);

    expect(loaded).toEqual(entry);
  });

  // --- Requirement 10.5: missing log returns null ---

  test('loadLast — returns null when no operations have been saved', async () => {
    const log = createOperationLog(tmpDir);
    const result = await log.loadLast();
    expect(result).toBeNull();
  });

  // --- Requirement 10.8: corrupted JSON ---

  test('loadFrom — throws VersioningsError for corrupted JSON', async () => {
    const filePath = path.join(tmpDir, 'corrupted.json');
    fs.writeFileSync(filePath, '{not valid json!!!', 'utf8');

    const log = createOperationLog(tmpDir);

    await expect(log.loadFrom(filePath)).rejects.toThrow(VersioningsError);
    await expect(log.loadFrom(filePath)).rejects.toMatchObject({
      code: EXIT_CODES.CONFIG_ERROR,
    });
  });

  test('loadFrom — error message mentions invalid JSON for corrupted file', async () => {
    const filePath = path.join(tmpDir, 'corrupted.json');
    fs.writeFileSync(filePath, '<<<garbage>>>', 'utf8');

    const log = createOperationLog(tmpDir);

    try {
      await log.loadFrom(filePath);
      fail('Expected VersioningsError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.message).toMatch(/invalid JSON/i);
    }
  });

  // --- Requirement 10.8: schemaVersion mismatch ---

  test('loadFrom — throws VersioningsError when schemaVersion does not match', async () => {
    const filePath = path.join(tmpDir, 'wrong-schema.json');
    const badEntry = { ...makeEntry(), schemaVersion: 99 };
    fs.writeFileSync(filePath, JSON.stringify(badEntry, null, 2), 'utf8');

    const log = createOperationLog(tmpDir);

    await expect(log.loadFrom(filePath)).rejects.toThrow(VersioningsError);
    await expect(log.loadFrom(filePath)).rejects.toMatchObject({
      code: EXIT_CODES.CONFIG_ERROR,
    });
  });

  test('loadFrom — schemaVersion mismatch error mentions expected and found versions', async () => {
    const filePath = path.join(tmpDir, 'wrong-schema.json');
    const badEntry = { ...makeEntry(), schemaVersion: 42 };
    fs.writeFileSync(filePath, JSON.stringify(badEntry, null, 2), 'utf8');

    const log = createOperationLog(tmpDir);

    try {
      await log.loadFrom(filePath);
      fail('Expected VersioningsError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect(err.message).toMatch(/schemaVersion/);
      expect(err.message).toMatch(/1/);  // expected
      expect(err.message).toMatch(/42/); // found
    }
  });

  // --- Requirement 10.6: atomic write (no temp files remain) ---

  test('save — no .tmp- files remain after successful write', async () => {
    const log = createOperationLog(tmpDir);
    const entry = makeEntry();

    await log.save(entry);

    const files = fs.readdirSync(tmpDir);
    const tmpFiles = files.filter(f => f.startsWith('.tmp-'));
    expect(tmpFiles).toHaveLength(0);
  });

  test('save — target file exists and contains valid JSON after write', async () => {
    const log = createOperationLog(tmpDir);
    const entry = makeEntry();

    const savedPath = await log.save(entry);

    expect(fs.existsSync(savedPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
    expect(content.schemaVersion).toBe(1);
    expect(content.version).toBe('1.2.3');
  });

  // --- Requirement 10.5: filename format ---

  test('save — filename matches pattern <timestamp>-<semver>-<version>.json', async () => {
    const log = createOperationLog(tmpDir);
    const entry = makeEntry({
      timestamp: '2025-01-15T10:30:00.000Z',
      semver: 'patch',
      version: '1.2.3',
    });

    const savedPath = await log.save(entry);
    const filename = path.basename(savedPath);

    // Filename should contain sanitized timestamp, semver, and version
    expect(filename).toMatch(/\.json$/);
    expect(filename).toContain('patch');
    expect(filename).toContain('1.2.3');
    // Timestamp colons/dots replaced with dashes
    expect(filename).toContain('2025-01-15T10-30-00-000Z');
  });

  test('save — filename sanitizes special characters', async () => {
    const log = createOperationLog(tmpDir);
    const entry = makeEntry({
      semver: 'prerelease',
      version: '1.0.0-beta.1',
    });

    const savedPath = await log.save(entry);
    const filename = path.basename(savedPath);

    // Dots and hyphens are allowed, but other specials should be sanitized
    expect(filename).toMatch(/^[a-zA-Z0-9._-]+\.json$/);
  });

  // --- Requirement 10.7: schemaVersion field ---

  test('saved entry always contains schemaVersion: 1', async () => {
    const log = createOperationLog(tmpDir);
    const entry = makeEntry();

    const savedPath = await log.save(entry);
    const raw = JSON.parse(fs.readFileSync(savedPath, 'utf8'));

    expect(raw.schemaVersion).toBe(1);
  });

  // --- Requirement 10.8: loadFrom non-existent file ---

  test('loadFrom — throws VersioningsError for non-existent file', async () => {
    const log = createOperationLog(tmpDir);
    const fakePath = path.join(tmpDir, 'does-not-exist.json');

    await expect(log.loadFrom(fakePath)).rejects.toThrow(VersioningsError);
    await expect(log.loadFrom(fakePath)).rejects.toMatchObject({
      code: EXIT_CODES.CONFIG_ERROR,
    });
  });

  // --- Requirement 10.5: failed result with error field ---

  test('save + loadLast round-trip for failed operation with error field', async () => {
    const log = createOperationLog(tmpDir);
    const entry = makeEntry({
      result: 'failed',
      error: { code: 5, message: 'git push failed' },
    });

    await log.save(entry);
    const loaded = await log.loadLast();

    expect(loaded).toEqual(entry);
    expect(loaded!.result).toBe('failed');
    expect(loaded!.error).toEqual({ code: 5, message: 'git push failed' });
  });
});
