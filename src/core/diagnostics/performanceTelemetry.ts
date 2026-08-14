export type PerfCounter = { last: number; avg: number; max: number; samples: number; updatedAt: number };

export type RetainedPerformanceEvent = {
  id: string;
  recordedAtMs: number;
};

export type RetainedPerformanceEventStore<T extends RetainedPerformanceEvent> = {
  clear: () => void;
  get: (nowMs: number) => T | null;
  set: (event: T) => T;
};

export const updatePerfCounter = (stat: PerfCounter | null, value: number, now: number, alpha = 0.18): PerfCounter => {
  if (!Number.isFinite(value)) {
    return stat ?? { last: 0, avg: 0, max: 0, samples: 0, updatedAt: now };
  }
  const safe = Math.max(0, value);
  if (!stat) {
    return { last: safe, avg: safe, max: safe, samples: 1, updatedAt: now };
  }
  return {
    last: safe,
    avg: stat.avg * (1 - alpha) + safe * alpha,
    max: Math.max(safe, stat.max * 0.996),
    samples: stat.samples + 1,
    updatedAt: now
  };
};

export const createRetainedPerformanceEventStore = <T extends RetainedPerformanceEvent>(
  retentionMs = 60_000
): RetainedPerformanceEventStore<T> => {
  let latest: T | null = null;
  return {
    clear: () => {
      latest = null;
    },
    get: (nowMs: number) => {
      if (!latest || nowMs - latest.recordedAtMs > retentionMs) {
        return null;
      }
      return latest;
    },
    set: (event: T) => {
      latest = event;
      return event;
    }
  };
};
