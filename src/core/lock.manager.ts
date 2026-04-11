// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { VersioningsError, EXIT_CODES } from './errors';
import type { StructuredLogger } from './structured.logger';

export interface LockData {
  pid: number;
  operationId: string;
  command: string;
  createdAt: string;    // ISO 8601
  hostname: string;
  ci: boolean;
}

export interface LockManagerDeps {
  lockDir: string;
  lockTimeoutMs: number;
  ci: boolean;
  processInfo?: {
    pid: number;
    kill: (pid: number, signal: number) => boolean;
    on: (event: string, handler: () => void) => void;
  };
  fs?: {
    writeFileSync: typeof import('fs').writeFileSync;
    readFileSync: typeof import('fs').readFileSync;
    renameSync: typeof import('fs').renameSync;
    unlinkSync: typeof import('fs').unlinkSync;
    existsSync: typeof import('fs').existsSync;
    mkdirSync: typeof import('fs').mkdirSync;
  };
  hostname?: string;
  logger?: StructuredLogger;
}

export interface LockManager {
  acquire(operationId: string, command: string): void;
  release(): void;
}

/**
 * Create a lock manager with dependency injection.
 * Prevents parallel runs of mutating operations on the same repository.
 */
export function createLockManager(deps: LockManagerDeps): LockManager {
  const fsOps = deps.fs ?? {
    writeFileSync: fs.writeFileSync,
    readFileSync: fs.readFileSync,
    renameSync: fs.renameSync,
    unlinkSync: fs.unlinkSync,
    existsSync: fs.existsSync,
    mkdirSync: fs.mkdirSync,
  };
  const proc = deps.processInfo ?? {
    pid: process.pid,
    kill: (pid: number, signal: number) => process.kill(pid, signal),
    on: (event: string, handler: () => void) => process.on(event, handler),
  };
  const hostname = deps.hostname ?? os.hostname();
  const logger = deps.logger;

  const lockFilePath = path.join(deps.lockDir, 'lock');
  const tmpFilePath = path.join(deps.lockDir, '.lock.tmp');

  let acquired = false;
  const cleanupHandlers: Array<{ event: string; handler: () => void }> = [];

  function removeLockFile(): void {
    try {
      fsOps.unlinkSync(lockFilePath);
    } catch {
      // Ignore errors — file may already be deleted
    }
  }

  function registerCleanupHandlers(): void {
    const handler = (): void => {
      if (acquired) {
        removeLockFile();
        acquired = false;
      }
    };

    const events = ['SIGINT', 'SIGTERM', 'exit'];
    for (const event of events) {
      proc.on(event, handler);
      cleanupHandlers.push({ event, handler });
    }
  }

  function isProcessAlive(pid: number): boolean {
    try {
      proc.kill(pid, 0);
      return true;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') {
        return false;
      }
      // EPERM means process exists but we lack permission — treat as alive
      if (code === 'EPERM') {
        return true;
      }
      // Unknown error — treat as alive to be safe
      return true;
    }
  }

  function isTimedOut(createdAt: string): boolean {
    return Date.now() - Date.parse(createdAt) > deps.lockTimeoutMs;
  }

  function throwActiveLockError(lockData: LockData): never {
    const details: Record<string, unknown> = {
      lockPid: lockData.pid,
      lockOperationId: lockData.operationId,
      lockCommand: lockData.command,
      lockCreatedAt: lockData.createdAt,
      lockHostname: lockData.hostname,
    };

    let message = `Another versionings process is running (PID: ${lockData.pid}, operation: ${lockData.operationId}, started: ${lockData.createdAt})`;

    if (deps.ci) {
      message += '. In CI environment — check for parallel jobs running versionings on the same repository';
    }

    throw new VersioningsError(EXIT_CODES.COMMAND_FAILED, message, details);
  }

  function handleExistingLock(): void {
    let raw: string;
    try {
      raw = fsOps.readFileSync(lockFilePath, 'utf-8') as string;
    } catch {
      // Lock file disappeared between existsSync and readFileSync — continue
      return;
    }

    let lockData: LockData;
    try {
      lockData = JSON.parse(raw) as LockData;
    } catch {
      // Corrupted lock file — delete and continue
      if (logger) {
        logger.warn('Corrupted lock file detected, removing', { lockFile: lockFilePath });
      }
      removeLockFile();
      return;
    }

    // In non-CI: check if the process is still alive via PID
    if (!deps.ci) {
      if (!isProcessAlive(lockData.pid)) {
        if (logger) {
          logger.warn('Stale lock detected: process not found', {
            lockPid: lockData.pid,
            lockOperationId: lockData.operationId,
            lockCreatedAt: lockData.createdAt,
            reason: 'process not found',
          });
        }
        removeLockFile();
        return;
      }
    }

    // Check timeout (both CI and non-CI)
    if (isTimedOut(lockData.createdAt)) {
      if (logger) {
        logger.warn('Stale lock detected: timeout exceeded', {
          lockPid: lockData.pid,
          lockOperationId: lockData.operationId,
          lockCreatedAt: lockData.createdAt,
          reason: 'timeout',
          lockTimeoutMs: deps.lockTimeoutMs,
        });
      }
      removeLockFile();
      return;
    }

    // Lock is active — throw error
    throwActiveLockError(lockData);
  }

  function writeLockAtomically(operationId: string, command: string): void {
    const lockData: LockData = {
      pid: proc.pid,
      operationId,
      command,
      createdAt: new Date().toISOString(),
      hostname,
      ci: deps.ci,
    };

    const content = JSON.stringify(lockData, null, 2);
    fsOps.writeFileSync(tmpFilePath, content, 'utf-8');
    fsOps.renameSync(tmpFilePath, lockFilePath);
  }

  return {
    acquire(operationId: string, command: string): void {
      // Ensure lock directory exists
      fsOps.mkdirSync(deps.lockDir, { recursive: true });

      // Check for existing lock
      if (fsOps.existsSync(lockFilePath)) {
        handleExistingLock();
      }

      // Write lock atomically
      writeLockAtomically(operationId, command);
      acquired = true;

      // Register cleanup handlers
      registerCleanupHandlers();
    },

    release(): void {
      removeLockFile();
      acquired = false;
    },
  };
}
