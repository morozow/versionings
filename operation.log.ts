// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import * as fs from 'fs';
import * as path from 'path';
import { VersioningsError, EXIT_CODES } from './errors';
import { RollbackStep } from './rollback';

export interface OperationLogEntry {
  schemaVersion: 1;
  timestamp: string;
  semver: string;
  version: string;
  previousVersion: string;
  branch: string;
  tag: string;
  steps: RollbackStep[];
  result: 'success' | 'failed';
  error?: { code: number; message: string };
  pullRequest?: { url: string; number: number | null; status: string };
}

export interface OperationLog {
  save(entry: OperationLogEntry): Promise<string>;
  loadLast(): Promise<OperationLogEntry | null>;
  loadFrom(filePath: string): Promise<OperationLogEntry>;
}

const LAST_LINK = 'last.json';
const SCHEMA_VERSION = 1;

function sanitizeForFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function validateEntry(data: unknown, source: string): OperationLogEntry {
  if (data === null || typeof data !== 'object') {
    throw new VersioningsError(
      EXIT_CODES.CONFIG_ERROR,
      `Corrupted operation log: ${source} — expected JSON object`,
      { source }
    );
  }

  const obj = data as Record<string, unknown>;

  if (obj.schemaVersion !== SCHEMA_VERSION) {
    throw new VersioningsError(
      EXIT_CODES.CONFIG_ERROR,
      `Corrupted operation log: ${source} — expected schemaVersion ${SCHEMA_VERSION}, got ${JSON.stringify(obj.schemaVersion)}`,
      { source, expected: SCHEMA_VERSION, found: obj.schemaVersion }
    );
  }

  return data as OperationLogEntry;
}

export function createOperationLog(baseDir: string): OperationLog {
  fs.mkdirSync(baseDir, { recursive: true });

  async function save(entry: OperationLogEntry): Promise<string> {
    const ts = entry.timestamp.replace(/[:.]/g, '-');
    const semver = sanitizeForFilename(entry.semver);
    const version = sanitizeForFilename(entry.version);
    const filename = `${ts}-${semver}-${version}.json`;
    const filePath = path.join(baseDir, filename);
    const tmpPath = path.join(baseDir, `.tmp-${filename}`);

    const json = JSON.stringify(entry, null, 2) + '\n';

    fs.writeFileSync(tmpPath, json, 'utf8');
    fs.renameSync(tmpPath, filePath);

    const linkPath = path.join(baseDir, LAST_LINK);
    try { fs.unlinkSync(linkPath); } catch (_) { /* ignore */ }
    fs.symlinkSync(filename, linkPath);

    return filePath;
  }

  async function loadLast(): Promise<OperationLogEntry | null> {
    const linkPath = path.join(baseDir, LAST_LINK);
    if (!fs.existsSync(linkPath)) {
      return null;
    }

    const resolved = path.join(baseDir, fs.readlinkSync(linkPath));
    return loadFrom(resolved);
  }

  async function loadFrom(filePath: string): Promise<OperationLogEntry> {
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (err: any) {
      throw new VersioningsError(
        EXIT_CODES.CONFIG_ERROR,
        `Cannot read operation log: ${filePath} — ${err.message}`,
        { filePath, originalError: err.message }
      );
    }

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch (err: any) {
      throw new VersioningsError(
        EXIT_CODES.CONFIG_ERROR,
        `Corrupted operation log: ${filePath} — invalid JSON: ${err.message}`,
        { filePath, originalError: err.message }
      );
    }

    return validateEntry(data, filePath);
  }

  return { save, loadLast, loadFrom };
}
