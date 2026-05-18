import type { WorldState } from "../../../core/state.js";
import { clamp } from "../../../core/utils.js";
import type { MapGenSettings } from "../../../mapgen/settings.js";
import { hash2D } from "../../../mapgen/noise.js";
import { generateWorldClimateSeed } from "../../climate/sim/worldClimateSeed.js";
import type { StaticHydrologyFields } from "../types/staticHydrologyTypes.js";

const NEIGHBORS_8 = [
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: -1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: 1 },
  { dx: 1, dy: 1 }
] as const;

export const buildOceanDistanceField = (
  cols: number,
  rows: number,
  oceanMask: Uint8Array,
  maxDistance: number
): Uint16Array => {
  const total = cols * rows;
  const unvisited = 0xffff;
  const maxDist = Math.max(1, Math.min(unvisited - 1, Math.floor(maxDistance)));
  const dist = new Uint16Array(total);
  dist.fill(unvisited);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < total; i += 1) {
    if (oceanMask[i] > 0) {
      dist[i] = 0;
      queue[tail] = i;
      tail += 1;
    }
  }
  while (head < tail) {
    const idx = queue[head];
    head += 1;
    const current = dist[idx] ?? maxDist;
    if (current >= maxDist) {
      continue;
    }
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    const tryPush = (nIdx: number): void => {
      if (dist[nIdx] !== unvisited) {
        return;
      }
      dist[nIdx] = current + 1;
      queue[tail] = nIdx;
      tail += 1;
    };
    if (x > 0) {
      tryPush(idx - 1);
    }
    if (x < cols - 1) {
      tryPush(idx + 1);
    }
    if (y > 0) {
      tryPush(idx - cols);
    }
    if (y < rows - 1) {
      tryPush(idx + cols);
    }
  }
  for (let i = 0; i < total; i += 1) {
    if (dist[i] === unvisited) {
      dist[i] = maxDist;
    }
  }
  return dist;
};

const findDownslopeTarget = (
  idx: number,
  cols: number,
  rows: number,
  elevationMap: ArrayLike<number>,
  oceanMask: Uint8Array
): number => {
  const x = idx % cols;
  const y = Math.floor(idx / cols);
  const center = elevationMap[idx] ?? 0;
  let bestIdx = -1;
  let bestScore = 0;
  for (const dir of NEIGHBORS_8) {
    const nx = x + dir.dx;
    const ny = y + dir.dy;
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
      continue;
    }
    const nIdx = ny * cols + nx;
    const drop = center - (elevationMap[nIdx] ?? center);
    const oceanBonus = oceanMask[nIdx] > 0 ? 0.02 : 0;
    const diagonalPenalty = dir.dx !== 0 && dir.dy !== 0 ? 0.0004 : 0;
    const score = drop + oceanBonus - diagonalPenalty;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = nIdx;
    }
  }
  return bestIdx;
};

export const buildStaticHydrologyFields = (
  state: WorldState,
  elevationMap: ArrayLike<number>,
  oceanMask: Uint8Array,
  settings: MapGenSettings
): StaticHydrologyFields => {
  const cols = state.grid.cols;
  const rows = state.grid.rows;
  const total = state.grid.totalTiles;
  const rainfall = new Float32Array(total);
  const runoff = new Float32Array(total);
  const flow = new Float32Array(total);
  const climate = generateWorldClimateSeed(state.seed);
  const windX = Math.cos(climate.prevailingWindAngleRad);
  const windY = Math.sin(climate.prevailingWindAngleRad);
  const windStrength = clamp(climate.prevailingWindStrength, 0, 1);
  const oceanDistance = buildOceanDistanceField(
    cols,
    rows,
    oceanMask,
    Math.max(cols, rows)
  );
  const distanceNormDenom = Math.max(1, Math.min(cols, rows) * 0.5);
  const aridityBias = clamp(climate.aridityBias ?? 0, -0.35, 0.35);
  const rainfallBias = clamp(climate.rainfallBias ?? 0, -0.35, 0.35);
  for (let y = 0; y < rows; y += 1) {
    const rowBase = y * cols;
    for (let x = 0; x < cols; x += 1) {
      const idx = rowBase + x;
      if (oceanMask[idx] > 0) {
        rainfall[idx] = 1;
        runoff[idx] = 0;
        continue;
      }
      const elevation = clamp(elevationMap[idx] ?? 0, 0, 1);
      const upwindX = Math.max(0, Math.min(cols - 1, Math.round(x - windX)));
      const upwindY = Math.max(0, Math.min(rows - 1, Math.round(y - windY)));
      const downwindX = Math.max(0, Math.min(cols - 1, Math.round(x + windX)));
      const downwindY = Math.max(0, Math.min(rows - 1, Math.round(y + windY)));
      const upwindElevation = elevationMap[upwindY * cols + upwindX] ?? elevation;
      const downwindElevation = elevationMap[downwindY * cols + downwindX] ?? elevation;
      const windwardRise = Math.max(0, elevation - upwindElevation);
      const leewardDrop = Math.max(0, elevation - downwindElevation);
      const inland = clamp((oceanDistance[idx] ?? 0) / distanceNormDenom, 0, 1);
      const localNoise = (hash2D(x, y, state.seed + 27_331) * 2 - 1) * 0.025;
      const value =
        0.34 +
        rainfallBias * 0.18 -
        aridityBias * 0.2 -
        inland * settings.rainfallInlandDecay +
        windwardRise * settings.rainfallWindwardBoost * (1 + windStrength) +
        elevation * settings.rainfallElevationBoost -
        leewardDrop * settings.rainfallLeewardPenalty * (1 + windStrength) -
        inland * leewardDrop * settings.rainfallRainShadowStrength * windStrength +
        localNoise;
      rainfall[idx] = clamp(value, 0, 1);
      runoff[idx] = rainfall[idx];
    }
  }

  const order = Array.from({ length: total }, (_, idx) => idx);
  order.sort((a, b) => (elevationMap[b] ?? 0) - (elevationMap[a] ?? 0) || a - b);
  for (const idx of order) {
    if (oceanMask[idx] > 0) {
      continue;
    }
    const target = findDownslopeTarget(idx, cols, rows, elevationMap, oceanMask);
    if (target < 0) {
      continue;
    }
    runoff[target] += runoff[idx] * 0.82;
  }

  let p95 = 0;
  const samples: number[] = [];
  for (let i = 0; i < total; i += 1) {
    if (oceanMask[i] === 0 && runoff[i] > 0) {
      samples.push(runoff[i]);
    }
  }
  if (samples.length > 0) {
    samples.sort((a, b) => a - b);
    p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))] ?? 1;
  }
  const denom = Math.max(0.0001, p95);
  for (let i = 0; i < total; i += 1) {
    flow[i] = clamp(runoff[i] / denom, 0, 1);
  }

  return { rainfall, runoff, flow };
};
