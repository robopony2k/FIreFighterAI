import type { WorldState } from "../../../core/state.js";
import { indexFor, inBounds } from "../../../core/grid.js";
import { clamp } from "../../../core/utils.js";
import { computeRenderedSlopeAngleDeg } from "../../../shared/terrainSlope.js";
import { computeTreeSuitability } from "./treeSuitability.js";
import { buildVegetationTerrainFields, type VegetationTerrainFields } from "./vegetationTerrainFields.js";
import { generateWorldClimateSeed } from "../../climate/sim/worldClimateSeed.js";

const MAX_SUITABILITY_SLOPE = 0.5;

type RuntimeVegetationSuitabilityCache = {
  cols: number;
  rows: number;
  totalTiles: number;
  seed: number;
  elevationRef: Float32Array;
  seaLevelRef: Float32Array | null;
  valleyRef: Float32Array | number[] | null;
  suitability: Float32Array;
  siteQuality: Float32Array;
};

const caches = new WeakMap<WorldState, RuntimeVegetationSuitabilityCache>();

const computeLocalSlope = (state: WorldState, x: number, y: number): number => {
  const idx = indexFor(state.grid, x, y);
  const center = state.tiles[idx]?.elevation ?? 0;
  let maxDiff = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      maxDiff = Math.max(maxDiff, Math.abs(center - (state.tiles[indexFor(state.grid, nx, ny)]?.elevation ?? center)));
    }
  }
  return clamp(maxDiff / MAX_SUITABILITY_SLOPE, 0, 1);
};

const computeSuitabilityAt = (
  state: WorldState,
  fields: VegetationTerrainFields,
  x: number,
  y: number
): ReturnType<typeof computeTreeSuitability> => {
  const idx = indexFor(state.grid, x, y);
  const tile = state.tiles[idx];
  const seaLevel = state.tileSeaLevel?.[idx] ?? 0.08;
  const slope = computeLocalSlope(state, x, y);
  const details = computeTreeSuitability({
    seed: state.seed,
    x,
    y,
    worldX: x * 10,
    worldY: y * 10,
    cellSizeM: 10,
    elevation: tile?.elevation ?? 0,
    slope,
    moisture: tile?.moisture ?? 0,
    valley: state.valleyMap?.[idx] ?? 0,
    seaLevel,
    waterDist: tile?.waterDist ?? 24,
    highlandForestElevation: 0.72,
    vegetationDensity: 0.62,
    forestPatchiness: 0.48,
    slopeAngleDeg: computeRenderedSlopeAngleDeg(slope, state.grid.cols, state.grid.rows),
    isWater: tile?.type === "water",
    windExposure: fields.windExposure[idx] ?? 0,
    leeShelter: fields.leeShelter[idx] ?? 0,
    curvature: fields.curvature[idx] ?? 0,
    drainage: fields.drainage[idx] ?? 0,
    coastExposure: fields.coastExposure[idx] ?? 0
  });
  return details;
};

const cacheMatches = (cache: RuntimeVegetationSuitabilityCache, state: WorldState): boolean =>
  cache.cols === state.grid.cols &&
  cache.rows === state.grid.rows &&
  cache.totalTiles === state.grid.totalTiles &&
  cache.seed === state.seed &&
  cache.elevationRef === state.tileElevation &&
  cache.seaLevelRef === (state.tileSeaLevel ?? null) &&
  cache.valleyRef === (state.valleyMap ?? null);

export const getRuntimeVegetationSuitabilityMap = (state: WorldState): Float32Array => {
  const cached = caches.get(state);
  if (cached && cacheMatches(cached, state)) {
    return cached.suitability;
  }

  const suitability = new Float32Array(state.grid.totalTiles);
  const siteQuality = new Float32Array(state.grid.totalTiles);
  const waterDistance = new Uint16Array(state.grid.totalTiles);
  for (let i = 0; i < state.grid.totalTiles; i += 1) {
    waterDistance[i] = Math.max(0, Math.min(0xffff, Math.round(state.tiles[i]?.waterDist ?? 24)));
  }
  const climate = generateWorldClimateSeed(state.seed);
  const fields = buildVegetationTerrainFields({
    cols: state.grid.cols,
    rows: state.grid.rows,
    cellSizeM: 10,
    elevations: state.tileElevation,
    baseMoisture: state.tileMoisture,
    waterDistance,
    coastDistance: state.tileCoastDistance,
    valley: state.valleyMap,
    oceanMask: state.tileOceanMask,
    riverMask: state.tileRiverMask,
    lakeMask: state.tileLakeMask,
    prevailingWindDx: Math.cos(climate.prevailingWindAngleRad),
    prevailingWindDy: Math.sin(climate.prevailingWindAngleRad),
    prevailingWindStrength: climate.prevailingWindStrength,
    refineMoisture: false
  });
  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = indexFor(state.grid, x, y);
      const details = computeSuitabilityAt(state, fields, x, y);
      suitability[idx] = details.treeSuitability;
      siteQuality[idx] = details.siteQuality;
    }
  }
  caches.set(state, {
    cols: state.grid.cols,
    rows: state.grid.rows,
    totalTiles: state.grid.totalTiles,
    seed: state.seed,
    elevationRef: state.tileElevation,
    seaLevelRef: state.tileSeaLevel ?? null,
    valleyRef: state.valleyMap ?? null,
    suitability,
    siteQuality
  });
  return suitability;
};

export const getRuntimeVegetationSuitabilityAt = (state: WorldState, x: number, y: number): number =>
  getRuntimeVegetationSuitabilityMap(state)[indexFor(state.grid, x, y)] ?? 0;

export const getRuntimeVegetationSiteQualityAt = (state: WorldState, x: number, y: number): number => {
  getRuntimeVegetationSuitabilityMap(state);
  return caches.get(state)?.siteQuality[indexFor(state.grid, x, y)] ?? 0;
};
