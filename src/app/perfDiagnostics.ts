export type PerfCounter = { last: number; avg: number; max: number; samples: number; updatedAt: number };

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
