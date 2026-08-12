export const RIVER_CHANNEL_CLASS = {
  none: 0,
  ephemeralCreek: 1,
  stream: 2,
  river: 3
} as const;

export type RiverChannelClass = typeof RIVER_CHANNEL_CLASS[keyof typeof RIVER_CHANNEL_CLASS];

export const RIVER_CHANNEL_VISIBLE_FLOW_MIN = 0.001;
export const RIVER_CHANNEL_STREAM_FLOW_MIN = 0.35;
export const RIVER_CHANNEL_RIVER_FLOW_MIN = 0.7;
export const RIVER_CHANNEL_EPHEMERAL_MAX_WIDTH_CELLS = 0.45;
export const RIVER_CHANNEL_STREAM_MAX_WIDTH_CELLS = 0.9;
export const RIVER_CHANNEL_MAX_WIDTH_CELLS = 1.35;
export const RIVER_CHANNEL_WIDTH_EXPONENT = 0.65;

export type RiverChannelHierarchyThresholds = {
  tributary: number;
  stream: number;
  river: number;
};

export type RiverChannelHierarchy = {
  channelClass: Uint8Array;
  channelWidth: Float32Array;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const DEFAULT_THRESHOLDS: RiverChannelHierarchyThresholds = {
  tributary: RIVER_CHANNEL_VISIBLE_FLOW_MIN,
  stream: RIVER_CHANNEL_STREAM_FLOW_MIN,
  river: RIVER_CHANNEL_RIVER_FLOW_MIN
};
const normalizedRange = (value: number, start: number, end: number): number =>
  clamp01((value - start) / Math.max(1e-6, end - start));

export const classifyRiverChannelStrength = (
  strength: number,
  thresholds: RiverChannelHierarchyThresholds = DEFAULT_THRESHOLDS
): RiverChannelClass => {
  const flow = clamp01(Number.isFinite(strength) ? strength : 0);
  if (flow < thresholds.tributary) return RIVER_CHANNEL_CLASS.none;
  if (flow < thresholds.stream) return RIVER_CHANNEL_CLASS.ephemeralCreek;
  if (flow < thresholds.river) return RIVER_CHANNEL_CLASS.stream;
  return RIVER_CHANNEL_CLASS.river;
};

export const resolveRiverChannelWidth = (
  strength: number,
  thresholds: RiverChannelHierarchyThresholds = DEFAULT_THRESHOLDS
): number => {
  const flow = clamp01(Number.isFinite(strength) ? strength : 0);
  if (flow < thresholds.tributary) return 0;
  if (flow < thresholds.stream) {
    const t = normalizedRange(flow, thresholds.tributary, thresholds.stream);
    return RIVER_CHANNEL_EPHEMERAL_MAX_WIDTH_CELLS * Math.pow(t, RIVER_CHANNEL_WIDTH_EXPONENT);
  }
  if (flow < thresholds.river) {
    const t = normalizedRange(flow, thresholds.stream, thresholds.river);
    return RIVER_CHANNEL_EPHEMERAL_MAX_WIDTH_CELLS +
      (RIVER_CHANNEL_STREAM_MAX_WIDTH_CELLS - RIVER_CHANNEL_EPHEMERAL_MAX_WIDTH_CELLS) *
        Math.pow(t, RIVER_CHANNEL_WIDTH_EXPONENT);
  }
  const t = normalizedRange(flow, thresholds.river, 1);
  return RIVER_CHANNEL_STREAM_MAX_WIDTH_CELLS +
    (RIVER_CHANNEL_MAX_WIDTH_CELLS - RIVER_CHANNEL_STREAM_MAX_WIDTH_CELLS) *
      Math.pow(t, RIVER_CHANNEL_WIDTH_EXPONENT);
};

export const buildRiverChannelHierarchy = (
  channelNodeMask: Uint8Array,
  accumulationStrength: ArrayLike<number>,
  thresholds: RiverChannelHierarchyThresholds = DEFAULT_THRESHOLDS
): RiverChannelHierarchy => {
  if (channelNodeMask.length !== accumulationStrength.length) {
    throw new Error("River channel hierarchy inputs must have matching lengths.");
  }
  const channelClass = new Uint8Array(channelNodeMask.length);
  const channelWidth = new Float32Array(channelNodeMask.length);
  for (let index = 0; index < channelNodeMask.length; index += 1) {
    if (channelNodeMask[index] === 0) continue;
    const strength = accumulationStrength[index] ?? 0;
    channelClass[index] = classifyRiverChannelStrength(strength, thresholds);
    channelWidth[index] = resolveRiverChannelWidth(strength, thresholds);
  }
  return { channelClass, channelWidth };
};
