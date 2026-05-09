import type { Tile } from "../../../core/types.js";
import { clamp } from "../../../core/utils.js";
import { hash2D } from "../../../mapgen/noise.js";
import type { WorldClimateSeed } from "../../climate/types/worldClimateSeed.js";

export type WindDrivenMoistureInput = {
  seed: number;
  cols: number;
  rows: number;
  tiles: ArrayLike<Tile>;
  distToWater: Uint16Array;
  maxWaterDistance: number;
  climate: WorldClimateSeed;
  report?: (message: string, progress: number) => void | Promise<void>;
  yieldIfNeeded?: () => Promise<boolean>;
};

const AIR_INJECTION_WATER = 0.96;
const AIR_DECAY = 0.985;
const SHADOW_DECAY = 0.9;
const MIN_BUCKETS = 32;
const MAX_BUCKETS_PER_AXIS = 3;

const bucketIndexFor = (
  x: number,
  y: number,
  minOrder: number,
  orderRange: number,
  bucketCount: number,
  windX: number,
  windY: number
): number => {
  const order = x * windX + y * windY;
  const t = clamp((order - minOrder) / orderRange, 0, 0.999999);
  return Math.max(0, Math.min(bucketCount - 1, Math.floor(t * bucketCount)));
};

const getDirectionalStep = (windX: number, windY: number): { x: number; y: number } => {
  const x = windX > 0.33 ? 1 : windX < -0.33 ? -1 : 0;
  const y = windY > 0.33 ? 1 : windY < -0.33 ? -1 : 0;
  if (x !== 0 || y !== 0) {
    return { x, y };
  }
  return Math.abs(windX) >= Math.abs(windY)
    ? { x: windX >= 0 ? 1 : -1, y: 0 }
    : { x: 0, y: windY >= 0 ? 1 : -1 };
};

const getElevationAt = (
  tiles: ArrayLike<Tile>,
  cols: number,
  rows: number,
  x: number,
  y: number,
  fallback: number
): number => {
  if (x < 0 || y < 0 || x >= cols || y >= rows) {
    return fallback;
  }
  const elevation = tiles[y * cols + x]?.elevation;
  return Number.isFinite(elevation) ? elevation : fallback;
};

const propagateAir = (
  idx: number,
  x: number,
  y: number,
  step: { x: number; y: number },
  cols: number,
  rows: number,
  air: Float32Array,
  shadow: Float32Array,
  nextAir: number,
  nextShadow: number
): void => {
  const targets = [
    { x: x + step.x, y: y + step.y, weight: 0.72 },
    { x: x + step.x - step.y, y: y + step.y + step.x, weight: 0.14 },
    { x: x + step.x + step.y, y: y + step.y - step.x, weight: 0.14 }
  ];

  for (const target of targets) {
    if (target.x < 0 || target.y < 0 || target.x >= cols || target.y >= rows) {
      continue;
    }
    const targetIdx = target.y * cols + target.x;
    air[targetIdx] = Math.max(air[targetIdx], nextAir * target.weight);
    shadow[targetIdx] = Math.max(shadow[targetIdx], nextShadow * target.weight);
  }

  // Keep diagonal-only winds from losing all moisture when the main target is invalid near borders.
  if (air[idx] < 0) {
    air[idx] = 0;
  }
};

export const buildWindDrivenMoistureMap = async (
  input: WindDrivenMoistureInput
): Promise<Float32Array> => {
  const { seed, cols, rows, tiles, distToWater, climate, report, yieldIfNeeded } = input;
  const total = cols * rows;
  const moisture = new Float32Array(total);
  const air = new Float32Array(total);
  const shadow = new Float32Array(total);
  const rainfall = new Float32Array(total);
  const maxWaterDistance = Math.max(1, Math.min(0xffff - 1, Math.floor(input.maxWaterDistance)));
  const windX = Math.cos(climate.prevailingWindAngleRad);
  const windY = Math.sin(climate.prevailingWindAngleRad);
  const windStrength = clamp(climate.prevailingWindStrength, 0, 1);
  const rainfallBias = clamp(climate.rainfallBias ?? 0, -0.35, 0.35);
  const aridityBias = clamp(climate.aridityBias ?? 0, -0.35, 0.35);
  const step = getDirectionalStep(windX, windY);

  let minOrder = Number.POSITIVE_INFINITY;
  let maxOrder = Number.NEGATIVE_INFINITY;
  const corners = [
    [0, 0],
    [cols - 1, 0],
    [0, rows - 1],
    [cols - 1, rows - 1]
  ];
  for (const [x, y] of corners) {
    const order = x * windX + y * windY;
    minOrder = Math.min(minOrder, order);
    maxOrder = Math.max(maxOrder, order);
  }
  const orderRange = Math.max(0.0001, maxOrder - minOrder);
  const bucketCount = Math.max(MIN_BUCKETS, Math.ceil(Math.max(cols, rows) * MAX_BUCKETS_PER_AXIS));
  const bucketHeads = new Int32Array(bucketCount);
  const bucketTails = new Int32Array(bucketCount);
  const bucketNext = new Int32Array(total);
  bucketHeads.fill(-1);
  bucketTails.fill(-1);
  bucketNext.fill(-1);

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const idx = y * cols + x;
      const bucket = bucketIndexFor(x, y, minOrder, orderRange, bucketCount, windX, windY);
      const tail = bucketTails[bucket] ?? -1;
      if (tail >= 0) {
        bucketNext[tail] = idx;
      } else {
        bucketHeads[bucket] = idx;
      }
      bucketTails[bucket] = idx;
    }
  }

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    for (let idx = bucketHeads[bucket] ?? -1; idx >= 0; idx = bucketNext[idx] ?? -1) {
      const tile = tiles[idx];
      const x = idx % cols;
      const y = Math.floor(idx / cols);
      const elevation = tile?.elevation ?? 0;
      if (tile?.type === "water") {
        air[idx] = Math.max(air[idx], AIR_INJECTION_WATER + rainfallBias * 0.15);
        rainfall[idx] = 1;
        moisture[idx] = 1;
      } else {
        const incomingAir = clamp(air[idx], 0, 1.3);
        const incomingShadow = clamp(shadow[idx], 0, 1);
        const upwindElevation = getElevationAt(tiles, cols, rows, x - step.x, y - step.y, elevation);
        const downwindElevation = getElevationAt(tiles, cols, rows, x + step.x, y + step.y, elevation);
        const windwardRise = Math.max(0, elevation - upwindElevation);
        const leewardDrop = Math.max(0, elevation - downwindElevation);
        const orographicRain = clamp(windwardRise * (1.8 + windStrength * 1.6), 0, 0.44);
        const baseDeposit = incomingAir * (0.09 + windStrength * 0.11);
        const deposit = clamp(baseDeposit + orographicRain + rainfallBias * 0.08 - incomingShadow * 0.16, 0, 0.78);
        rainfall[idx] = deposit;

        const distanceNorm = clamp(distToWater[idx] / maxWaterDistance, 0, 1);
        const distanceMoisture = Math.pow(1 - distanceNorm, 1.08);
        const elevationDryness = clamp((elevation - 0.42) / 0.42, 0, 1);
        const localNoise = (hash2D(x, y, seed + 17491) * 2 - 1) * 0.035;
        const shadowDrying = incomingShadow * (0.24 + windStrength * 0.16);
        const leewardDrying = leewardDrop * windStrength * 0.28;

        moisture[idx] = clamp(
          distanceMoisture * 0.46 +
            deposit * 0.52 +
            orographicRain * 0.26 -
            elevationDryness * 0.22 -
            shadowDrying -
            leewardDrying -
            aridityBias * 0.22 +
            localNoise,
          0,
          1
        );
      }

      const retainedAir = clamp(
        (air[idx] + (tile?.type === "water" ? AIR_INJECTION_WATER : 0)) * AIR_DECAY -
          rainfall[idx] * (0.42 + windStrength * 0.18),
        0,
        1.2
      );
      const ridgeShadow = clamp(Math.max(0, rainfall[idx] - 0.18) * 0.5 + Math.max(0, (tile?.elevation ?? 0) - 0.68) * 0.16, 0, 1);
      const nextShadow = clamp(shadow[idx] * SHADOW_DECAY + ridgeShadow, 0, 1);
      propagateAir(idx, x, y, step, cols, rows, air, shadow, retainedAir, nextShadow);
    }

    if (yieldIfNeeded && report && (bucket === bucketCount - 1 || bucket % 16 === 0)) {
      if (await yieldIfNeeded()) {
        await report("Mapping wind-carried moisture...", (bucket + 1) / bucketCount);
      }
    }
  }

  for (let i = 0; i < total; i += 1) {
    moisture[i] = tiles[i]?.type === "water" ? 1 : clamp(moisture[i] ?? 0, 0, 1);
  }
  return moisture;
};
