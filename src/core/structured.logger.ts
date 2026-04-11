// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import * as crypto from 'crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface StructuredLoggerDeps {
  output: NodeJS.WritableStream;
  level: LogLevel;
  operationId: string;
  actor?: string;
  ci?: boolean;
}

export interface StructuredLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Generate a unique operation ID (UUID v4).
 * Uses crypto.randomUUID() when available, falls back to crypto.randomBytes(16).
 */
export function generateOperationId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    const bytes = crypto.randomBytes(16);
    // Set version 4 (bits 12-15 of time_hi_and_version)
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    // Set variant 1 (bits 6-7 of clock_seq_hi_and_reserved)
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ].join('-');
  }
}


/**
 * Create a structured JSON logger with dependency injection.
 * @param deps — logger dependencies (output stream, level, operationId, actor, ci)
 * @returns StructuredLogger with debug/info/warn/error methods
 */
export function createStructuredLogger(deps: StructuredLoggerDeps): StructuredLogger {
  const configuredPriority = LOG_LEVEL_PRIORITY[deps.level] ?? LOG_LEVEL_PRIORITY.warn;

  function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const messagePriority = LOG_LEVEL_PRIORITY[level];
    if (messagePriority < configuredPriority) {
      return;
    }

    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      message,
      operationId: deps.operationId,
    };

    if (context !== undefined) {
      entry.context = context;
    }

    // Include actor at info level and above
    if (messagePriority >= LOG_LEVEL_PRIORITY.info && deps.actor !== undefined) {
      entry.actor = deps.actor;
    }

    // Include ci field when in CI environment
    if (deps.ci === true) {
      entry.ci = true;
    }

    try {
      deps.output.write(JSON.stringify(entry) + '\n');
    } catch {
      // Logging must never throw — silently drop on serialization failure
    }
  }

  return {
    debug(message: string, context?: Record<string, unknown>): void {
      log('debug', message, context);
    },
    info(message: string, context?: Record<string, unknown>): void {
      log('info', message, context);
    },
    warn(message: string, context?: Record<string, unknown>): void {
      log('warn', message, context);
    },
    error(message: string, context?: Record<string, unknown>): void {
      log('error', message, context);
    },
  };
}
