// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

export interface ActionTraceEntry {
  step: string;
  startedAt: string;    // ISO 8601
  endedAt: string;      // ISO 8601
  durationMs: number;
  status: 'success' | 'failed' | 'skipped';
  error?: string;
}

export interface ActionTracer {
  startStep(step: string): void;
  endStep(step: string, status: 'success' | 'failed' | 'skipped', error?: string): void;
  getTrace(): ActionTraceEntry[];
  getTotalDurationMs(): number;
}

/**
 * Create an action tracer that records pipeline step timings.
 * @param clock — optional DI for Date provider (testability)
 * @returns ActionTracer instance
 */
export function createActionTracer(clock?: () => Date): ActionTracer {
  const getClock = clock ?? (() => new Date());
  const entries: ActionTraceEntry[] = [];
  const pending: Map<string, Date> = new Map();

  return {
    startStep(step: string): void {
      pending.set(step, getClock());
    },

    endStep(step: string, status: 'success' | 'failed' | 'skipped', error?: string): void {
      const now = getClock();
      const startedAt = pending.get(step);
      pending.delete(step);

      const start = startedAt ?? now;
      const durationMs = now.getTime() - start.getTime();

      const entry: ActionTraceEntry = {
        step,
        startedAt: start.toISOString(),
        endedAt: now.toISOString(),
        durationMs,
        status,
      };

      if (error !== undefined) {
        entry.error = error;
      }

      entries.push(entry);
    },

    getTrace(): ActionTraceEntry[] {
      return entries.slice();
    },

    /** Sum of all recorded entry durations. */
    getTotalDurationMs(): number {
      let total = 0;
      for (const entry of entries) {
        total += entry.durationMs;
      }
      return total;
    },
  };
}
