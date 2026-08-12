import { buildAnchoredDrainageChannelNetwork } from "./anchoredDrainageChannelNetwork.js";

export type FlowAccumulationRiverInput = {
  cols: number;
  rows: number;
  elevations: ArrayLike<number>;
  oceanMask: Uint8Array;
  seaLevelMap: ArrayLike<number>;
  receiver: Int32Array;
  flowAccumulation: Float32Array;
  lakeMask?: Uint16Array;
  riverIntensity: number;
  riverBudget: number;
  minLakeDepth: number;
};

export type FlowAccumulationRiverResult = {
  riverMask: Uint8Array;
  riverSurface: Float32Array;
  riverBed: Float32Array;
  channelStrength: Float32Array;
  valleyDepth: Float32Array;
  threshold: number;
  tributaryThreshold: number;
  streamThreshold: number;
  riverThreshold: number;
  channelNodeMask: Uint8Array;
  channelDownstream: Int32Array;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const clamp01 = (value: number): number => clamp(value, 0, 1);
const mix = (a: number, b: number, t: number): number => a + (b - a) * clamp01(t);
const smoothstep = (edge0: number, edge1: number, value: number): number => {
  if (Math.abs(edge1 - edge0) < 1e-7) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

export const RIVER_TRIBUTARY_THRESHOLD_GAP = 0.12;
export const RIVER_STREAM_THRESHOLD_BLEND = 0.7;
export const RIVER_CLASS_THRESHOLD_BLEND = 0.55;
export const RIVER_MIN_TERMINAL_BRANCH_CELLS = 3;

export const buildFlowAccumulationRiverNetwork = (
  input: FlowAccumulationRiverInput
): FlowAccumulationRiverResult => {
  const total = input.cols * input.rows;
  if (
    input.elevations.length !== total ||
    input.oceanMask.length !== total ||
    input.seaLevelMap.length !== total ||
    input.receiver.length !== total ||
    input.flowAccumulation.length !== total
  ) {
    throw new Error("Flow-accumulation river input dimensions do not match the terrain grid.");
  }

  const riverMask = new Uint8Array(total);
  const riverSurface = new Float32Array(total).fill(Number.NaN);
  const riverBed = new Float32Array(total).fill(Number.NaN);
  const channelStrength = new Float32Array(total);
  const valleyDepth = new Float32Array(total);
  const intensity = clamp01(input.riverIntensity);
  const budget = clamp01(input.riverBudget);
  const effectiveIntensity = clamp01(intensity * mix(0.75, 1.15, budget));
  const threshold = effectiveIntensity < 0.025 ? 1.01 : mix(0.94, 0.7, effectiveIntensity);
  const tributaryThreshold = Math.max(0, threshold - RIVER_TRIBUTARY_THRESHOLD_GAP);
  const streamThreshold = mix(tributaryThreshold, threshold, RIVER_STREAM_THRESHOLD_BLEND);
  const riverThreshold = mix(threshold, 1, RIVER_CLASS_THRESHOLD_BLEND);
  const channelNetwork = buildAnchoredDrainageChannelNetwork({
    receiver: input.receiver,
    flowAccumulation: input.flowAccumulation,
    oceanMask: input.oceanMask,
    lakeMask: input.lakeMask,
    tributaryThreshold,
    trunkThreshold: threshold,
    minimumTerminalBranchCells: RIVER_MIN_TERMINAL_BRANCH_CELLS
  });
  const channelIndexes: number[] = [];

  for (let idx = 0; idx < total; idx += 1) {
    if (channelNetwork.channelNodeMask[idx] === 0 || input.oceanMask[idx] > 0) continue;
    const seaLevel = input.seaLevelMap[idx] ?? 0;
    const elevation = input.elevations[idx] ?? 0;
    const accumulation = input.flowAccumulation[idx] ?? 0;
    if (accumulation < streamThreshold) continue;
    riverMask[idx] = 1;
    channelStrength[idx] = smoothstep(streamThreshold, 1, accumulation);
    riverSurface[idx] = Math.max(
      seaLevel + 0.0002,
      elevation - mix(0.00008, 0.00022, channelStrength[idx] ?? 0)
    );
    channelIndexes.push(idx);
  }

  const originalChannelIndexes = [...channelIndexes];
  for (const idx of originalChannelIndexes) {
    const target = input.receiver[idx] ?? -1;
    if (target < 0) continue;
    const x = idx % input.cols;
    const y = Math.floor(idx / input.cols);
    const tx = target % input.cols;
    const ty = Math.floor(target / input.cols);
    if (Math.abs(tx - x) !== 1 || Math.abs(ty - y) !== 1) continue;
    const connector = [y * input.cols + tx, ty * input.cols + x]
      .filter((candidate) =>
        candidate >= 0 &&
        candidate < total &&
        input.oceanMask[candidate] === 0 &&
        channelNetwork.channelNodeMask[candidate] === 0
      )
      .sort((left, right) =>
        (input.elevations[left] ?? 0) - (input.elevations[right] ?? 0) || left - right
      )[0];
    if (connector === undefined) continue;
    if (riverMask[connector] === 0) {
      const strength = Math.max(
        channelStrength[idx] ?? 0,
        target >= 0 ? channelStrength[target] ?? 0 : 0
      );
      const seaLevel = input.seaLevelMap[connector] ?? 0;
      const elevation = input.elevations[connector] ?? 0;
      riverMask[connector] = 1;
      channelStrength[connector] = strength;
      riverSurface[connector] = Math.max(
        seaLevel + 0.0002,
        elevation - mix(0.00008, 0.00022, strength)
      );
      channelIndexes.push(connector);
    }
  }
  for (const idx of channelIndexes) {
    const elevation = input.elevations[idx] ?? 0;
    const strength = channelStrength[idx] ?? 0;
    const depth = Math.max(
      0.00045,
      input.minLakeDepth * mix(0.08, 0.2, effectiveIntensity) * mix(0.5, 1, strength)
    );
    const surface = riverSurface[idx] ?? elevation - 0.0005;
    const bed = clamp(Math.min(elevation, surface - depth), 0, 1);
    riverBed[idx] = bed;
    valleyDepth[idx] = Math.max(0, elevation - bed);
  }

  return {
    riverMask,
    riverSurface,
    riverBed,
    channelStrength,
    valleyDepth,
    threshold,
    tributaryThreshold,
    streamThreshold,
    riverThreshold,
    channelNodeMask: channelNetwork.channelNodeMask,
    channelDownstream: channelNetwork.channelDownstream
  };
};
