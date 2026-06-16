import type { WorldState } from "../../../core/state.js";
import type { Wind } from "../../../core/types.js";
import { clamp } from "../../../core/utils.js";
import { resolveTerrainAdjustedWind, type TerrainAdjustedWind } from "./fireTerrainInfluence.js";

export type TerrainWindField = {
  cols: number;
  rows: number;
  dx: Float32Array;
  dy: Float32Array;
  strength: Float32Array;
};

type TerrainWindFieldCacheEntry = {
  key: string;
  field: TerrainWindField;
};

const fieldCache = new WeakMap<WorldState, TerrainWindFieldCacheEntry>();
const MIN_WIND_MAGNITUDE = 0.0001;
const WIND_ANGLE_BUCKET_DEGREES = 5;
const WIND_STRENGTH_BUCKETS_PER_UNIT = 20;

const finiteOr = (value: number | undefined, fallback: number): number =>
  Number.isFinite(value) ? Number(value) : fallback;

const signStep = (value: number): -1 | 0 | 1 => (value > 0.2 ? 1 : value < -0.2 ? -1 : 0);

const hashSigned = (x: number, y: number, seed: number): number => {
  let n = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  n = (n ^ (n >>> 13)) | 0;
  n = Math.imul(n, 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 0xffffffff * 2 - 1;
};

const readElevation = (elevation: Float32Array, cols: number, rows: number, x: number, y: number, fallback: number): number => {
  if (x < 0 || y < 0 || x >= cols || y >= rows) {
    return fallback;
  }
  const value = elevation[y * cols + x];
  return Number.isFinite(value) ? value : fallback;
};

const buildElevationSignature = (state: WorldState): number => {
  const { cols, rows } = state.grid;
  const elevation = state.tileElevation;
  if (cols <= 0 || rows <= 0 || elevation.length === 0) {
    return 0;
  }
  let hash = 2166136261;
  const sampleCount = 32;
  for (let i = 0; i < sampleCount; i += 1) {
    const x = Math.min(cols - 1, Math.floor(((i * 17 + 3) % sampleCount) * cols / sampleCount));
    const y = Math.min(rows - 1, Math.floor(((i * 11 + 7) % sampleCount) * rows / sampleCount));
    const value = Math.round((elevation[y * cols + x] ?? 0) * 10000);
    hash ^= value + i * 16777619;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const buildCacheKey = (state: WorldState): string => {
  const wind = state.wind;
  const settings = state.fireSettings;
  const angleBucket = Math.round((Math.atan2(wind.dy, wind.dx) * 180 / Math.PI) / WIND_ANGLE_BUCKET_DEGREES);
  const strengthBucket = Math.round((wind.strength ?? 0) * WIND_STRENGTH_BUCKETS_PER_UNIT);
  return [
    state.grid.cols,
    state.grid.rows,
    state.terrainTypeRevision ?? 0,
    buildElevationSignature(state),
    angleBucket,
    strengthBucket,
    Math.round(finiteOr(settings.terrainWindSteerStrength, 0) * 1000),
    Math.round(finiteOr(settings.terrainWindSpeedMin, 0) * 1000),
    Math.round(finiteOr(settings.terrainWindSpeedMax, 0) * 1000),
    Math.round(finiteOr(settings.terrainWindObstructionPenalty, 0) * 1000),
    Math.round(finiteOr(settings.terrainWindFunnelBonus, 0) * 1000)
  ].join(":");
};

const accumulateUpwind = (
  x: number,
  y: number,
  cols: number,
  rows: number,
  stepX: number,
  stepY: number,
  field: TerrainWindField,
  shelter: Float32Array,
  baseDx: number,
  baseDy: number,
  baseStrength: number
): { dx: number; dy: number; strength: number; shelter: number } => {
  let vx = baseDx * baseStrength * 0.55;
  let vy = baseDy * baseStrength * 0.55;
  let strength = baseStrength * 0.55;
  let inheritedShelter = 0;
  let weight = 0.55;
  const add = (nx: number, ny: number, sampleWeight: number): void => {
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
      return;
    }
    const nIdx = ny * cols + nx;
    const nStrength = field.strength[nIdx] || baseStrength;
    vx += (field.dx[nIdx] || baseDx) * nStrength * sampleWeight;
    vy += (field.dy[nIdx] || baseDy) * nStrength * sampleWeight;
    strength += nStrength * sampleWeight;
    inheritedShelter += (shelter[nIdx] || 0) * sampleWeight;
    weight += sampleWeight;
  };

  if (stepX !== 0) {
    add(x - stepX, y, 0.48);
  }
  if (stepY !== 0) {
    add(x, y - stepY, 0.48);
  }
  if (stepX !== 0 && stepY !== 0) {
    add(x - stepX, y - stepY, 0.64);
    add(x - stepX, y, 0.2);
    add(x, y - stepY, 0.2);
  }
  if (stepX !== 0 && stepY === 0) {
    add(x - stepX, y - 1, 0.18);
    add(x - stepX, y + 1, 0.18);
  } else if (stepY !== 0 && stepX === 0) {
    add(x - 1, y - stepY, 0.18);
    add(x + 1, y - stepY, 0.18);
  }

  const magnitude = Math.hypot(vx, vy);
  return {
    dx: magnitude > MIN_WIND_MAGNITUDE ? vx / magnitude : baseDx,
    dy: magnitude > MIN_WIND_MAGNITUDE ? vy / magnitude : baseDy,
    strength: weight > 0 ? strength / weight : baseStrength,
    shelter: weight > 0 ? inheritedShelter / weight : 0
  };
};

const buildTerrainWindField = (state: WorldState): TerrainWindField => {
  const cols = state.grid.cols;
  const rows = state.grid.rows;
  const total = Math.max(0, cols * rows);
  const field: TerrainWindField = {
    cols,
    rows,
    dx: new Float32Array(total),
    dy: new Float32Array(total),
    strength: new Float32Array(total)
  };
  const wind = state.wind;
  const baseMagnitude = Math.hypot(wind.dx, wind.dy);
  const baseDx = baseMagnitude > MIN_WIND_MAGNITUDE ? wind.dx / baseMagnitude : 1;
  const baseDy = baseMagnitude > MIN_WIND_MAGNITUDE ? wind.dy / baseMagnitude : 0;
  const baseStrength = Math.max(0, wind.strength ?? 0);
  if (total === 0 || baseStrength <= 0) {
    return field;
  }

  const stepX = signStep(baseDx);
  const stepY = signStep(baseDy);
  const xStart = stepX >= 0 ? 0 : cols - 1;
  const xEnd = stepX >= 0 ? cols : -1;
  const xStep = stepX >= 0 ? 1 : -1;
  const yStart = stepY >= 0 ? 0 : rows - 1;
  const yEnd = stepY >= 0 ? rows : -1;
  const yStep = stepY >= 0 ? 1 : -1;
  const elevation = state.tileElevation;
  const shelter = new Float32Array(total);
  const local = { dx: baseDx, dy: baseDy, strength: baseStrength };
  const minSpeed = clamp(finiteOr(state.fireSettings.terrainWindSpeedMin, 0.55), 0.05, 1);
  const maxSpeed = Math.max(1, finiteOr(state.fireSettings.terrainWindSpeedMax, 1.55));
  const obstructionPenalty = Math.max(0, finiteOr(state.fireSettings.terrainWindObstructionPenalty, 1.45));

  for (let x = xStart; x !== xEnd; x += xStep) {
    for (let y = yStart; y !== yEnd; y += yStep) {
      const idx = y * cols + x;
      const inherited = accumulateUpwind(
        x,
        y,
        cols,
        rows,
        stepX,
        stepY,
        field,
        shelter,
        baseDx,
        baseDy,
        baseStrength
      );
      resolveTerrainAdjustedWind(
        x,
        y,
        idx,
        cols,
        rows,
        elevation,
        inherited.dx,
        inherited.dy,
        inherited.strength,
        state.fireSettings,
        local
      );

      const currentElevation = readElevation(elevation, cols, rows, x, y, 0);
      const upwindElevation = readElevation(
        elevation,
        cols,
        rows,
        x - stepX,
        y - stepY,
        currentElevation
      );
      const downwindElevation = readElevation(
        elevation,
        cols,
        rows,
        x + stepX,
        y + stepY,
        currentElevation
      );
      const leeDrop = Math.max(0, upwindElevation - currentElevation - 0.012);
      const windwardClimb = Math.max(0, currentElevation - upwindElevation - 0.01);
      const downwindDrop = Math.max(0, currentElevation - downwindElevation - 0.01);
      const crestLift = Math.min(windwardClimb, downwindDrop);
      const nextShelter = clamp(inherited.shelter * 0.82 + leeDrop * obstructionPenalty * 1.55, 0, 0.68);
      const wakeNoise = hashSigned(Math.floor(x / 3), Math.floor(y / 3), state.seed ^ 0x5bd1e995);
      const turbulence = wakeNoise * nextShelter * 0.42;
      const localMagnitude = Math.hypot(local.dx, local.dy);
      const localDx = localMagnitude > MIN_WIND_MAGNITUDE ? local.dx / localMagnitude : baseDx;
      const localDy = localMagnitude > MIN_WIND_MAGNITUDE ? local.dy / localMagnitude : baseDy;
      let adjustedDx = localDx - localDy * turbulence;
      let adjustedDy = localDy + localDx * turbulence;
      const adjustedMagnitude = Math.hypot(adjustedDx, adjustedDy);
      if (adjustedMagnitude > MIN_WIND_MAGNITUDE) {
        adjustedDx /= adjustedMagnitude;
        adjustedDy /= adjustedMagnitude;
      } else {
        adjustedDx = baseDx;
        adjustedDy = baseDy;
      }
      const forwardDot = adjustedDx * baseDx + adjustedDy * baseDy;
      const diversionBoost = clamp((1 - forwardDot) * 0.28, 0, 0.18);
      if (forwardDot < 0.55) {
        adjustedDx = adjustedDx * 0.45 + baseDx * 0.55;
        adjustedDy = adjustedDy * 0.45 + baseDy * 0.55;
        const restoredMagnitude = Math.hypot(adjustedDx, adjustedDy) || 1;
        adjustedDx /= restoredMagnitude;
        adjustedDy /= restoredMagnitude;
      }

      shelter[idx] = nextShelter;
      field.dx[idx] = adjustedDx;
      field.dy[idx] = adjustedDy;
      const windwardBoost = windwardClimb * 0.72 + crestLift * 1.55;
      const wakeGust = Math.max(0, wakeNoise) * nextShelter * 0.46;
      const speedMultiplier = 1 - nextShelter + windwardBoost + diversionBoost + wakeGust;
      field.strength[idx] = clamp(local.strength * speedMultiplier, baseStrength * minSpeed, baseStrength * maxSpeed);
    }
  }

  return field;
};

export const getTerrainWindField = (world: WorldState): TerrainWindField => {
  const key = buildCacheKey(world);
  const cached = fieldCache.get(world);
  if (cached?.key === key) {
    return cached.field;
  }
  const field = buildTerrainWindField(world);
  fieldCache.set(world, { key, field });
  return field;
};

export const sampleTerrainWindAt = (
  field: TerrainWindField | null | undefined,
  idx: number,
  fallbackWind: Wind | TerrainAdjustedWind,
  out: TerrainAdjustedWind = { dx: 0, dy: 0, strength: 0 }
): TerrainAdjustedWind => {
  if (!field || idx < 0 || idx >= field.strength.length) {
    out.dx = fallbackWind.dx;
    out.dy = fallbackWind.dy;
    out.strength = fallbackWind.strength;
    return out;
  }
  const strength = field.strength[idx];
  const dx = field.dx[idx];
  const dy = field.dy[idx];
  if (strength <= 0 || Math.hypot(dx, dy) <= MIN_WIND_MAGNITUDE) {
    out.dx = fallbackWind.dx;
    out.dy = fallbackWind.dy;
    out.strength = fallbackWind.strength;
    return out;
  }
  out.dx = dx;
  out.dy = dy;
  out.strength = strength;
  return out;
};
