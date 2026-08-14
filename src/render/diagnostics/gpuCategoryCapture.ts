import type { WebGlGpuTimerSample } from "../../core/rendering/webglGpuTimer.js";

export const GPU_CAPTURE_CATEGORIES = [
  "baseline",
  "terrain",
  "vegetation",
  "structures",
  "fireFx",
  "water",
  "shadows"
] as const;

export type GpuCaptureCategory = typeof GPU_CAPTURE_CATEGORIES[number];

export type GpuCaptureMeasurement = {
  category: GpuCaptureCategory;
  gpuMs: number;
  calls: number;
  triangles: number;
};

export type GpuCategoryProfileResult = {
  sequence: number;
  status: "complete" | "unsupported" | "cancelled";
  reason: string;
  completedAtMs: number;
  measurements: GpuCaptureMeasurement[];
};

export type GpuCategoryCaptureSnapshot = {
  active: boolean;
  phase: GpuCaptureCategory | null;
  status: "idle" | "capturing" | GpuCategoryProfileResult["status"];
  result: GpuCategoryProfileResult | null;
};

type CaptureControllerOptions = {
  applyCategory: (category: GpuCaptureCategory | null) => void;
  warmupSamples?: number;
  measuredSamples?: number;
};

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) * 0.5
    : sorted[middle] ?? 0;
};

export const createGpuCategoryCaptureController = (options: CaptureControllerOptions) => {
  const warmupSamples = Math.max(0, Math.floor(options.warmupSamples ?? 2));
  const measuredSamples = Math.max(1, Math.floor(options.measuredSamples ?? 5));
  let active = false;
  let status: GpuCategoryCaptureSnapshot["status"] = "idle";
  let phaseIndex = -1;
  let sequence = 0;
  let lastAcceptedQuerySequence = 0;
  let warmupsSeen = 0;
  let gpuValues: number[] = [];
  let callValues: number[] = [];
  let triangleValues: number[] = [];
  let measurements: GpuCaptureMeasurement[] = [];
  let result: GpuCategoryProfileResult | null = null;

  const phase = (): GpuCaptureCategory | null =>
    active ? GPU_CAPTURE_CATEGORIES[phaseIndex] ?? null : null;

  const restore = (): void => {
    try {
      options.applyCategory(null);
    } finally {
      active = false;
      phaseIndex = -1;
    }
  };

  const finish = (nextStatus: GpuCategoryProfileResult["status"], reason: string): void => {
    restore();
    status = nextStatus;
    result = {
      sequence,
      status: nextStatus,
      reason,
      completedAtMs: performance.now(),
      measurements: measurements.map((entry) => ({ ...entry }))
    };
  };

  const applyPhase = (): void => {
    warmupsSeen = 0;
    gpuValues = [];
    callValues = [];
    triangleValues = [];
    const next = phase();
    if (next) options.applyCategory(next);
  };

  const start = (supported: boolean): boolean => {
    if (active) return false;
    sequence += 1;
    measurements = [];
    result = null;
    lastAcceptedQuerySequence = 0;
    if (!supported) {
      status = "unsupported";
      result = {
        sequence,
        status: "unsupported",
        reason: "timer-query-unavailable",
        completedAtMs: performance.now(),
        measurements: []
      };
      return false;
    }
    active = true;
    status = "capturing";
    phaseIndex = 0;
    applyPhase();
    return true;
  };

  const cancel = (reason = "cancelled"): void => {
    if (!active) return;
    finish("cancelled", reason);
  };

  const acceptSample = (sample: WebGlGpuTimerSample | null, calls: number, triangles: number): void => {
    const current = phase();
    if (!current || !sample || sample.sequence <= lastAcceptedQuerySequence) return;
    if (sample.tag !== `gpu-profile:${sequence}:${current}`) return;
    lastAcceptedQuerySequence = sample.sequence;
    if (warmupsSeen < warmupSamples) {
      warmupsSeen += 1;
      return;
    }
    gpuValues.push(Math.max(0, sample.valueMs));
    callValues.push(Math.max(0, calls));
    triangleValues.push(Math.max(0, triangles));
    if (gpuValues.length < measuredSamples) return;
    measurements.push({
      category: current,
      gpuMs: median(gpuValues),
      calls: Math.round(median(callValues)),
      triangles: Math.round(median(triangleValues))
    });
    phaseIndex += 1;
    if (phaseIndex >= GPU_CAPTURE_CATEGORIES.length) {
      finish("complete", "complete");
      return;
    }
    applyPhase();
  };

  const getQueryTag = (): string => {
    const current = phase();
    return current ? `gpu-profile:${sequence}:${current}` : "runtime";
  };

  const getSnapshot = (): GpuCategoryCaptureSnapshot => ({
    active,
    phase: phase(),
    status,
    result: result
      ? { ...result, measurements: result.measurements.map((entry) => ({ ...entry })) }
      : null
  });

  return { acceptSample, cancel, getQueryTag, getSnapshot, start };
};
