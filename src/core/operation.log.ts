// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import * as fs from 'fs';
import * as path from 'path';
import { VersioningsError, EXIT_CODES } from './errors';
import { RollbackStep } from './rollback';
import { ActorMetadata } from './actor.resolver';
import { ActionTraceEntry } from './action.tracer';

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

export interface AuditEntry {
  schemaVersion: 2;
  timestamp: string;
  operationId: string;
  semver: string;
  version: string;
  previousVersion: string;
  branch: string;
  tag: string;
  steps: RollbackStep[];
  result: 'success' | 'failed';
  error?: { code: number; message: string };
  pullRequest?: { url: string; number: number | null; status: string };
  actor: ActorMetadata | null;
  trace: ActionTraceEntry[];
  environment: {
    nodeVersion: string;
    cliVersion: string;
    os: string;
    ci: boolean;
  } | null;
  command: string | null;
}

export interface OperationLog {
  save(entry: OperationLogEntry | AuditEntry): Promise<string>;
  loadLast(): Promise<OperationLogEntry | null>;
  loadFrom(filePath: string): Promise<OperationLogEntry>;
}

const LAST_LINK = 'last.json';

/**
 * Mask tokens in a CLI command string.
 * Replaces:
 * - Hex strings >= 20 characters (case-insensitive)
 * - Base64-like strings >= 20 characters that contain at least one of +/=
 * - Values of common secret env var / flag patterns (*_TOKEN=, *_AUTH=, --token=, etc.)
 */
export function maskTokens(command: string): string {
  // 1. Mask values assigned to known secret-like keys
  //    Patterns: KEY_TOKEN=value, --token=value, --api-key value, GITHUB_TOKEN=value
  let result = command.replace(
    /(\b\w*(?:TOKEN|SECRET|PASSWORD|AUTH|KEY|CREDENTIAL)\s*=\s*)(\S+)/gi,
    '$1***'
  );
  result = result.replace(
    /(--(?:token|password|secret|auth|api-key|credentials)\s*[=\s]\s*)(\S+)/gi,
    '$1***'
  );

  // 2. Mask long hex strings (>= 20 hex chars, word-bounded)
  result = result.replace(/\b[a-f0-9]{20,}\b/gi, '***');

  // 3. Mask long base64-like strings (>= 20 chars, must contain at least one of +/=)
  result = result.replace(/\b[A-Za-z0-9+/=]{20,}\b/g, (match) => {
    if (/[+/=]/.test(match)) {
      return '***';
    }
    return match;
  });

  return result;
}

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
  const sv = obj.schemaVersion;

  if (sv !== 1 && sv !== 2) {
    throw new VersioningsError(
      EXIT_CODES.CONFIG_ERROR,
      `Corrupted operation log: ${source} — expected schemaVersion 1 or 2, got ${JSON.stringify(sv)}`,
      { source, expected: '1 or 2', found: sv }
    );
  }

  return data as OperationLogEntry;
}

/**
 * Normalize a v1 OperationLogEntry to v2 shape by filling missing fields with defaults.
 * The original schemaVersion is preserved (not overwritten).
 */
export function normalizeToV2(entry: OperationLogEntry): OperationLogEntry & {
  operationId: string | null;
  actor: ActorMetadata | null;
  trace: ActionTraceEntry[];
  environment: null;
  command: string | null;
} {
  const obj = entry as any;
  return {
    ...entry,
    operationId: obj.operationId ?? null,
    actor: obj.actor ?? null,
    trace: obj.trace ?? [],
    environment: obj.environment ?? null,
    command: obj.command ?? null,
  };
}

export function createOperationLog(baseDir: string): OperationLog {
  fs.mkdirSync(baseDir, { recursive: true });

  async function save(entry: OperationLogEntry | AuditEntry): Promise<string> {
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
