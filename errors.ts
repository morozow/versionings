// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

export interface ExitCodes {
  readonly SUCCESS: 0;
  readonly CONFIG_ERROR: 1;
  readonly DIRTY_TREE: 2;
  readonly INVALID_ARGS: 3;
  readonly ARTIFACT_CONFLICT: 4;
  readonly COMMAND_FAILED: 5;
  readonly NETWORK_ERROR: 6;
  readonly INCOMPLETE_ROLLBACK: 7;
  readonly NO_OPERATION: 8;
  readonly USER_CANCELLED: 9;
  readonly POLICY_VIOLATION: 10;
}

export const EXIT_CODES: ExitCodes = Object.freeze({
  SUCCESS: 0 as const,
  CONFIG_ERROR: 1 as const,
  DIRTY_TREE: 2 as const,
  INVALID_ARGS: 3 as const,
  ARTIFACT_CONFLICT: 4 as const,
  COMMAND_FAILED: 5 as const,
  NETWORK_ERROR: 6 as const,
  INCOMPLETE_ROLLBACK: 7 as const,
  NO_OPERATION: 8 as const,
  USER_CANCELLED: 9 as const,
  POLICY_VIOLATION: 10 as const,
});

export class VersioningsError extends Error {
  public code: number;
  public details: Record<string, any> | null;

  constructor(code: number, message: string, details: Record<string, any> | null = null) {
    super(message);
    this.name = 'VersioningsError';
    this.code = code;
    this.details = details;
    if ((Error as any).captureStackTrace) {
      (Error as any).captureStackTrace(this, VersioningsError);
    }
  }
}
