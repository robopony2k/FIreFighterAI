import type { RNG, Point, Tile, TileType } from "../core/types.js";
import { TreeType } from "../core/types.js";
import type { WorldState } from "../core/state.js";
import { getTerrainHeightScale } from "../core/terrainScale.js";
import { clamp } from "../core/utils.js";
import { inBounds, indexFor } from "../core/grid.js";
import {
  DOMINANT_FOREST_TYPES,
  FOREST_AGE_CAP_YEARS,
  clearVegetationState,
  computeForestTreeWeights,
  isForestType,
  isVegetationType,
  pickWeightedTreeType,
  syncDerivedVegetationState
} from "../core/vegetation.js";
import { applyFuel } from "../core/tiles.js";
import { getHouseFootprintBounds, pickHouseFootprint, type HouseFootprintBounds } from "../core/houseFootprints.js";
import { findBestRoadReferenceForPlot, pickHouseRotationFromRoadMask } from "../core/roadAlignment.js";
import {
  COAST_CLASS_BEACH,
  COAST_CLASS_CLIFF,
  COAST_CLASS_NONE,
  COAST_CLASS_SHELF_WATER,
  TILE_TYPE_IDS
} from "../core/state.js";
import { markTileSoADirty } from "../core/tileCache.js";
import {
  DEBUG_TERRAIN,
  DEBUG_TERRAIN_EDGE,
  DISABLE_DISCONNECTED_INLAND_WATER,
  EDGE_WATER_WIDTH_TILES,
  EDGE_WATER_WIDTH_SCALE,
  EDGE_WATER_NOISE_TILES,
  EDGE_WATER_VARIANCE,
  EDGE_WATER_VARIANCE_REF,
  EDGE_WATER_OFFSET_CAP,
  EDGE_WATER_JITTER_CAP,
  LAND_CENTER_HEIGHT_SCALE,
  BASIN_DEPTH_SCALE,
  LAND_CENTER_INSET_FRACTION,
  EDGE_LAND_ATTENUATION,
  EDGE_WATER_BASE_OFFSET,
  ELEVATION_MACRO_SCALE,
  ELEVATION_PEAK_CAP,
  ELEVATION_PEAK_SOFTNESS,
  ELEVATION_CONTRAST,
  LAND_MASS_BIAS_FRACTION,
  LAND_MASS_BIAS_STRENGTH,
  MOISTURE_BFS_CHUNK,
  MOISTURE_ELEV_DRYNESS_WEIGHT,
  MOISTURE_ELEV_DRY_RANGE,
  MOISTURE_ELEV_WET_REF,
  MOISTURE_GAMMA,
  MOISTURE_WATER_DIST_CAP,
  WATER_BASELINE_ELEV,
  NEIGHBOR_DIRS
} from "../core/config.js";
import { fractalNoise, hash2D } from "./noise.js";
import {
  ROAD_EDGE_DIRS,
  analyzeRoadSurfaceMetrics,
  getRoadGenerationStats,
  resetRoadGenerationStats,
  type RoadSurfaceMetrics
} from "./roads.js";
import {
  createSettlementPlacementPlan,
  connectSettlementsByRoad
} from "./communities.js";
import { ISLAND_ARCHETYPE_DEFINITIONS } from "./islandArchetypes.js";
import { DEFAULT_MAP_GEN_SETTINGS, type MapGenSettings } from "./settings.js";
import type { MapGenDebug, MapGenDebugPhase, MapGenReporter } from "./mapgenTypes.js";
import type { MapGenContext } from "./pipeline/MapGenContext.js";
import {
  buildBiomeSuitability,
  computeBiomeSuitabilityValue
} from "./biome/BiomeSuitability.js";
import {
  buildLocalBiomeContext,
  classifySeedSpreadTile,
  classifyTile
} from "./biome/BiomeClassification.js";
import { buildForestMask } from "./biome/ForestSpread.js";
import { buildNoiseLandmass } from "../systems/terrain/sim/noiseLandmass.js";
import { computeRenderedSlopeAngleDeg } from "../shared/terrainSlope.js";
import { generateWorldClimateSeed } from "../systems/climate/sim/worldClimateSeed.js";
import { buildWindDrivenMoistureMap } from "../systems/terrain/sim/windDrivenMoisture.js";
import { getTerrainResponsiveVegetationStructure } from "../systems/terrain/sim/vegetationStructure.js";
import { selectBaseSite } from "../systems/settlements/sim/baseSiteSelection.js";

const nextFrame = () =>
  new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });

const createYield = (maxIterations = 32) => {
  let lastYield = typeof performance !== "undefined" ? performance.now() : Date.now();
  let iterations = 0;
  return async (): Promise<boolean> => {
    iterations += 1;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - lastYield < 12 && iterations < maxIterations) {
      return false;
    }
    iterations = 0;
    lastYield = now;
    await nextFrame();
    return true;
  };
};

const getEdgeWidth = (cols: number, rows: number): number =>
  Math.max(EDGE_WATER_WIDTH_TILES, Math.floor(Math.min(cols, rows) * EDGE_WATER_WIDTH_SCALE));

const getEdgeJitter = (x: number, y: number, scale: number, seed: number, strength: number): number => {
  const noise = fractalNoise(x / scale, y / scale, seed);
  return (noise * 2 - 1) * strength;
};

const getEdgeWarp = (
  x: number,
  y: number,
  cols: number,
  rows: number,
  width: number,
  seed: number
): { x: number; y: number } => {
  const minDim = Math.min(cols, rows);
  const warpScale = Math.max(48, Math.floor(minDim * 0.08));
  const warpStrength = Math.max(EDGE_WATER_NOISE_TILES, Math.floor(width * 0.8));
  const warpX = getEdgeJitter(x, y, warpScale, seed + 9101, warpStrength);
  const warpY = getEdgeJitter(x, y, warpScale, seed + 9203, warpStrength);
  const safeWarpX = clamp(warpX, -x, cols - 1 - x);
  const safeWarpY = clamp(warpY, -y, rows - 1 - y);
  return { x: safeWarpX, y: safeWarpY };
};

const getEdgeFalloff = (x: number, y: number, cols: number, rows: number, width: number, seed: number): number => {
  if (width <= 0) {
    return 1;
  }
  if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) {
    return 0;
  }
  const radialDist = Math.min(x, y, cols - 1 - x, rows - 1 - y);
  const warp = getEdgeWarp(x, y, cols, rows, width, seed);
  const warpedX = x + warp.x;
  const warpedY = y + warp.y;
  const edgeDist = Math.max(0, Math.min(warpedX, warpedY, cols - 1 - warpedX, rows - 1 - warpedY));
  const minDim = Math.min(cols, rows);
  const coastScale = Math.max(120, Math.floor(minDim * 0.22));
  const macroScale = Math.max(220, Math.floor(minDim * 0.5));
  const varianceScale = Math.min(1, EDGE_WATER_VARIANCE_REF / Math.max(1, width));
  const variance = EDGE_WATER_VARIANCE * varianceScale;
  const offsetCap = Math.min(width, EDGE_WATER_OFFSET_CAP);
  const coastNoise = fractalNoise(x / coastScale, y / coastScale, seed + 7001);
  const macroNoise = fractalNoise(x / macroScale, y / macroScale, seed + 7027);
  const coastOffset = (coastNoise * 2 - 1) * Math.min(offsetCap, width * variance * 0.35);
  const macroOffset = (macroNoise * 2 - 1) * Math.min(offsetCap, width * variance * 0.7);
  const tRadial = clamp(radialDist / width, 0, 1);
  const noiseFade = clamp(1 - tRadial, 0, 1);
  const baseDist = edgeDist + (coastOffset + macroOffset) * noiseFade;
  const adjusted = Math.max(0, baseDist);
  const tNoise = clamp(adjusted / width, 0, 1);
  const t = clamp(tRadial * 0.6 + tNoise * 0.4, 0, 1);
  // Smoothstep plus jitter softens the ring and avoids a square moat.
  return t * t * (3 - 2 * t);
};

const getSeaLevelBounds = (settings: MapGenSettings): { min: number; max: number } => {
  if (Number.isFinite(settings.waterCoverage)) {
    return { min: 0.02, max: 0.72 };
  }
  return { min: 0.08, max: 0.34 };
};

export const clampSeaLevel = (value: number, settings: MapGenSettings): number => {
  const { min, max } = getSeaLevelBounds(settings);
  return clamp(value, min, max);
};

const countConnectedOceanAtBaseLevel = (
  state: WorldState,
  settings: MapGenSettings,
  elevationMap: ArrayLike<number>,
  seaLevelBase: number
): number => {
  const { cols, rows, totalTiles } = state.grid;
  const ocean = new Uint8Array(totalTiles);
  const queue = new Int32Array(totalTiles);
  let head = 0;
  let tail = 0;
  const enqueue = (idx: number): void => {
    if (idx < 0 || idx >= totalTiles || ocean[idx] > 0) {
      return;
    }
    const seaLevel = clampSeaLevel(seaLevelBase, settings);
    if ((elevationMap[idx] ?? 0) > seaLevel) {
      return;
    }
    ocean[idx] = 1;
    queue[tail] = idx;
    tail += 1;
  };
  for (let x = 0; x < cols; x += 1) {
    enqueue(x);
    enqueue((rows - 1) * cols + x);
  }
  for (let y = 1; y < rows - 1; y += 1) {
    enqueue(y * cols);
    enqueue(y * cols + cols - 1);
  }
  while (head < tail) {
    const idx = queue[head] ?? 0;
    head += 1;
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    if (x > 0) {
      enqueue(idx - 1);
    }
    if (x < cols - 1) {
      enqueue(idx + 1);
    }
    if (y > 0) {
      enqueue(idx - cols);
    }
    if (y < rows - 1) {
      enqueue(idx + cols);
    }
  }
  return tail;
};

export const resolveSeaLevelBase = (
  state: WorldState,
  settings: MapGenSettings,
  elevationMap: ArrayLike<number>,
  cellSizeM: number
): number => {
  void cellSizeM;
  const target = Number.isFinite(settings.landCoverageTarget)
    ? clamp(1 - settings.landCoverageTarget, 0.18, 0.68)
    : Number.isFinite(settings.waterCoverage)
      ? clamp(settings.waterCoverage, 0.05, 0.85)
    : null;
  if (target === null) {
    return settings.baseWaterThreshold;
  }
  const total = state.grid.totalTiles;
  const { min, max } = getSeaLevelBounds(settings);
  let low = min;
  let high = max;
  let best = settings.baseWaterThreshold;
  let bestError = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 18; i += 1) {
    const mid = (low + high) / 2;
    const oceanCount = countConnectedOceanAtBaseLevel(state, settings, elevationMap, mid);
    const ratio = oceanCount / Math.max(1, total);
    const error = Math.abs(ratio - target);
    if (error < bestError) {
      bestError = error;
      best = mid;
    }
    if (ratio < target) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return clamp(best, min, max);
};

const buildDebugTypeIds = (
  state: WorldState,
  settings: MapGenSettings,
  elevationMap: ArrayLike<number>,
  riverMask?: Uint8Array,
  seaLevelBase?: number
): Uint8Array => {
  const total = state.grid.totalTiles;
  const typeIds = new Uint8Array(total);
  const base = seaLevelBase ?? settings.baseWaterThreshold;
  const seaLevel = clampSeaLevel(base, settings);
  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = indexFor(state.grid, x, y);
      const elev = elevationMap[idx] ?? 0;
      const isRiver = riverMask ? riverMask[idx] > 0 : false;
      typeIds[idx] = elev < seaLevel || isRiver ? TILE_TYPE_IDS.water : TILE_TYPE_IDS.grass;
    }
  }
  return typeIds;
};

const buildSolidLandTypeIds = (state: WorldState): Uint8Array => {
  const typeIds = new Uint8Array(state.grid.totalTiles);
  typeIds.fill(TILE_TYPE_IDS.grass);
  return typeIds;
};

const emitDebugPhase = async (
  debug: MapGenDebug | undefined,
  phase: MapGenDebugPhase,
  state: WorldState,
  settings: MapGenSettings,
  elevationMap: ArrayLike<number>,
  riverMask?: Uint8Array,
  tileTypes?: Uint8Array,
  seaLevelBase?: number
): Promise<void> => {
  if (!debug) {
    return;
  }
  const elevations = Float32Array.from(elevationMap);
  const types = tileTypes
    ? Uint8Array.from(tileTypes)
    : buildDebugTypeIds(state, settings, elevationMap, riverMask, seaLevelBase);
  const rivers = riverMask ? Uint8Array.from(riverMask) : undefined;
  await debug.onPhase({ phase, elevations, tileTypes: types, riverMask: rivers });
  if (debug.waitForStep) {
    await debug.waitForStep();
  }
};

const getLandBias = (x: number, y: number, cols: number, rows: number, seed: number): number => {
  const edgeDist = Math.min(x, y, cols - 1 - x, rows - 1 - y);
  const width = Math.max(4, Math.floor(Math.min(cols, rows) * LAND_MASS_BIAS_FRACTION));
  const jitter = getEdgeJitter(x, y, Math.max(12, width), seed + 4301, Math.max(2, width * 0.08));
  const adjusted = Math.max(0, edgeDist + jitter);
  return clamp(adjusted / width, 0, 1);
};

const mix = (a: number, b: number, t: number): number => a + (b - a) * clamp(t, 0, 1);

export const smoothstep = (edge0: number, edge1: number, value: number): number => {
  if (Math.abs(edge1 - edge0) < 1e-6) {
    return value < edge0 ? 0 : 1;
  }
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

const quantile = (values: number[], q: number): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const position = clamp(q, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(sorted.length - 1, Math.ceil(position));
  const t = position - lower;
  return mix(sorted[lower] ?? 0, sorted[upper] ?? 0, t);
};

export const assertEdgeWater = (state: WorldState): void => {
  if (!DEBUG_TERRAIN_EDGE) {
    return;
  }
  const cols = state.grid.cols;
  const rows = state.grid.rows;
  let nonWater = 0;
  for (let x = 0; x < cols; x += 1) {
    if (state.tiles[x].type !== "water") {
      nonWater += 1;
    }
    const bottomIdx = (rows - 1) * cols + x;
    if (state.tiles[bottomIdx].type !== "water") {
      nonWater += 1;
    }
  }
  for (let y = 1; y < rows - 1; y += 1) {
    const leftIdx = y * cols;
    if (state.tiles[leftIdx].type !== "water") {
      nonWater += 1;
    }
    const rightIdx = y * cols + (cols - 1);
    if (state.tiles[rightIdx].type !== "water") {
      nonWater += 1;
    }
  }
  if (nonWater > 0) {
    throw new Error(`Edge water check failed: ${nonWater} non-water edge tiles (seed=${state.seed}).`);
  }
};

const WARP_WAVELENGTH_M = 1000;
const WARP_MAG_M = 80;
const MACRO_WAVELENGTH_M = 9000;
const MID_WAVELENGTH_M = 3500;
const DETAIL_WAVELENGTH_M = 1200;
const RIDGE_WAVELENGTH_M = 4200;
const BAND_SCALE_BASE_M = 2000;
const BAND_SCALE_RANGE_M = 2000;

export const getWorldX = (settings: MapGenSettings, x: number): number => settings.worldOffsetXM + x * settings.cellSizeM;
export const getWorldY = (settings: MapGenSettings, y: number): number => settings.worldOffsetYM + y * settings.cellSizeM;

const FOREST_MACRO_WEIGHT = 0.85;
const FOREST_DETAIL_WEIGHT = 0.15;

export { buildLocalBiomeContext, classifySeedSpreadTile, classifyTile };

export const getYieldEveryRows = (cols: number): number => Math.max(4, Math.floor(2048 / Math.max(1, cols)));

export const COAST_BEACH_MAX_SLOPE = 0.3;
export const COAST_BEACH_MAX_RELIEF = 0.16;
export const COAST_BEACH_MAX_HEIGHT_ABOVE_SEA = 0.28;
export const COAST_BEACH_LAND_BAND = 2;
export const COAST_BEACH_SHELF_BAND = 6;
const COAST_CLIFF_BARE_HEIGHT = 0.16;
const COAST_CLIFF_BARE_DRYNESS = 0.36;
export const COAST_LOCAL_SEA_MARGIN = 0.0005;
export const COAST_MIN_LAND_ABOVE_SEA = 0.001;
const OCEAN_BATHY_DEPTH_MIN = 0.012;
const OCEAN_BATHY_DEPTH_MAX = 0.036;
const OCEAN_BATHY_BLEND = 0.75;
const RIVER_MOUTH_MAX_BED_BELOW_SEA = 0.008;
const RIVER_MOUTH_SURFACE_ABOVE_SEA = 0.0005;

export const classifyCoastDryTileType = (slope: number, elevationAboveSea: number, moisture = 0.5): TileType => {
  if (elevationAboveSea >= COAST_CLIFF_BARE_HEIGHT && moisture <= COAST_CLIFF_BARE_DRYNESS && slope < 0.38) {
    return "bare";
  }
  return "rocky";
};

export const persistSeaLevelMapToState = (state: WorldState, seaLevelMap: ArrayLike<number>): void => {
  for (let i = 0; i < state.grid.totalTiles; i += 1) {
    state.tileSeaLevel[i] = clamp(seaLevelMap[i] ?? 0, 0, 1);
  }
};

export const persistCoastMetadataToState = (
  state: WorldState,
  oceanMask: Uint8Array,
  distToOcean: Uint16Array,
  distToLand: Uint16Array,
  slopeMap: Float32Array,
  moistureMap: ArrayLike<number> | null | undefined,
  seaLevelMap: ArrayLike<number>
): void => {
  for (let i = 0; i < state.grid.totalTiles; i += 1) {
    state.tileOceanMask[i] = oceanMask[i] > 0 ? 1 : 0;
    state.tileCoastDistance[i] = oceanMask[i] > 0 ? distToLand[i] ?? 0 : distToOcean[i] ?? 0;
    state.tileCoastClass[i] = COAST_CLASS_NONE;
  }
  for (let i = 0; i < state.grid.totalTiles; i += 1) {
    if (state.tileRiverMask[i] > 0) {
      continue;
    }
    const seaLevel = seaLevelMap[i] ?? 0;
    const elevation = state.tiles[i]?.elevation ?? 0;
    if (oceanMask[i] > 0) {
      const distLand = distToLand[i] ?? 0;
      if (distLand >= 1 && distLand <= COAST_BEACH_SHELF_BAND) {
        state.tileCoastClass[i] = COAST_CLASS_SHELF_WATER;
      }
      continue;
    }
    const distOceanLocal = distToOcean[i] ?? 0;
    if (distOceanLocal < 1 || distOceanLocal > COAST_BEACH_LAND_BAND) {
      continue;
    }
    const moisture = moistureMap ? clamp(moistureMap[i] ?? 0.5, 0, 1) : 0.5;
    const x = i % state.grid.cols;
    const y = Math.floor(i / state.grid.cols);
    let minElevation = Number.POSITIVE_INFINITY;
    let maxElevation = Number.NEGATIVE_INFINITY;
    let localSlope = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      const ny = y + dy;
      if (ny < 0 || ny >= state.grid.rows) {
        continue;
      }
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        if (nx < 0 || nx >= state.grid.cols) {
          continue;
        }
        const nIdx = ny * state.grid.cols + nx;
        if (oceanMask[nIdx] > 0 || state.tileRiverMask[nIdx] > 0) {
          continue;
        }
        const value = state.tiles[nIdx]?.elevation ?? elevation;
        minElevation = Math.min(minElevation, value);
        maxElevation = Math.max(maxElevation, value);
        if (nIdx !== i) {
          localSlope = Math.max(localSlope, Math.abs(elevation - value));
        }
      }
    }
    if (!Number.isFinite(minElevation) || !Number.isFinite(maxElevation)) {
      minElevation = elevation;
      maxElevation = elevation;
    }
    const relief = maxElevation - minElevation;
    const slope = Math.min(1, localSlope > 0 ? localSlope : (slopeMap[i] ?? 0));
    const isBeach =
      slope <= COAST_BEACH_MAX_SLOPE &&
      relief <= COAST_BEACH_MAX_RELIEF &&
      elevation - seaLevel <= COAST_BEACH_MAX_HEIGHT_ABOVE_SEA &&
      moisture >= 0.14;
    const isCliff =
      !isBeach &&
      (
        slope >= 0.4 ||
        relief >= 0.22 ||
        elevation - seaLevel >= 0.19
      );
    state.tileCoastClass[i] = isBeach || !isCliff ? COAST_CLASS_BEACH : COAST_CLASS_CLIFF;
  }
};

export const classifyOceanCoastTile = (
  state: WorldState,
  idx: number,
  oceanMask: Uint8Array,
  riverMask: Uint8Array,
  seaLevelMap: ArrayLike<number>,
  slope: number,
  elevation: number
): TileType | null => {
  if (riverMask[idx] > 0 || oceanMask[idx]) {
    return null;
  }
  const tile = state.tiles[idx];
  if (!tile || tile.type === "water" || tile.type === "road" || tile.type === "base" || tile.type === "house") {
    return null;
  }
  const coastClass = state.tileCoastClass[idx] ?? COAST_CLASS_NONE;
  const seaLevel = seaLevelMap[idx] ?? 0;
  if (coastClass === COAST_CLASS_BEACH) {
    return "beach";
  }
  if (coastClass === COAST_CLASS_CLIFF) {
    return classifyCoastDryTileType(slope, elevation - seaLevel);
  }
  const cols = state.grid.cols;
  const rows = state.grid.rows;
  const x = idx % cols;
  const y = Math.floor(idx / cols);
  for (const dir of NEIGHBOR_DIRS) {
    if (Math.abs(dir.x) + Math.abs(dir.y) !== 1) {
      continue;
    }
    const nx = x + dir.x;
    const ny = y + dir.y;
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
      continue;
    }
    const nIdx = ny * cols + nx;
    if (oceanMask[nIdx] > 0 && riverMask[nIdx] === 0) {
      const heightAboveSea = elevation - seaLevel;
      return heightAboveSea <= 0.075 || slope <= 0.035
        ? "beach"
        : classifyCoastDryTileType(slope, heightAboveSea);
    }
  }
  if (elevation <= seaLevel + COAST_LOCAL_SEA_MARGIN) {
    return null;
  }
  return null;
};

export const shapeOceanFloorAtSeaLevel = (current: number, seaLevel: number, noise01: number): number => {
  const clampedSea = clamp(seaLevel, 0, 1);
  const depth = OCEAN_BATHY_DEPTH_MIN + clamp(noise01, 0, 1) * (OCEAN_BATHY_DEPTH_MAX - OCEAN_BATHY_DEPTH_MIN);
  const maxFloor = Math.max(0, clampedSea - 0.001);
  const targetFloor = clamp(clampedSea - depth, 0, maxFloor);
  const blended = current * (1 - OCEAN_BATHY_BLEND) + targetFloor * OCEAN_BATHY_BLEND;
  return clamp(blended, 0, maxFloor);
};

function softenPeaks(value: number, cap: number, softness: number): number {
  if (value <= cap) {
    return value;
  }
  const excess = value - cap;
  return cap + (1 - cap) * (1 - Math.exp(-excess * softness));
}

function computeNormalizedHeightPressure(maxHeight01: number): number {
  return clamp(1 - (clamp(maxHeight01, 0, 1) - 0.62) * 0.45, 0.82, 1.16);
}

export function assignForestComposition(state: WorldState): void {
  const total = state.grid.totalTiles;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const { cols } = state.grid;

  for (let i = 0; i < total; i += 1) {
    const tile = state.tiles[i];
    if (tile.type !== "forest") {
      tile.dominantTreeType = null;
      tile.treeType = null;
      continue;
    }
    if (visited[i]) {
      continue;
    }
    const startX = i % cols;
    const startY = Math.floor(i / cols);
    let head = 0;
    let tail = 0;
    const indices: number[] = [];
    let moistureSum = 0;
    let elevationSum = 0;
    visited[i] = 1;
    queue[tail] = i;
    tail += 1;
    while (head < tail) {
      const idx = queue[head];
      head += 1;
      indices.push(idx);
      const current = state.tiles[idx];
      moistureSum += current.moisture;
      elevationSum += current.elevation;
      const x = idx % cols;
      const y = Math.floor(idx / cols);
      if (x > 0) {
        const nIdx = idx - 1;
        if (!visited[nIdx] && state.tiles[nIdx].type === "forest") {
          visited[nIdx] = 1;
          queue[tail] = nIdx;
          tail += 1;
        }
      }
      if (x < cols - 1) {
        const nIdx = idx + 1;
        if (!visited[nIdx] && state.tiles[nIdx].type === "forest") {
          visited[nIdx] = 1;
          queue[tail] = nIdx;
          tail += 1;
        }
      }
      if (y > 0) {
        const nIdx = idx - cols;
        if (!visited[nIdx] && state.tiles[nIdx].type === "forest") {
          visited[nIdx] = 1;
          queue[tail] = nIdx;
          tail += 1;
        }
      }
      if (y < state.grid.rows - 1) {
        const nIdx = idx + cols;
        if (!visited[nIdx] && state.tiles[nIdx].type === "forest") {
          visited[nIdx] = 1;
          queue[tail] = nIdx;
          tail += 1;
        }
      }
    }

    const areaSize = indices.length;
    const avgMoisture = moistureSum / Math.max(1, areaSize);
    const avgElevation = elevationSum / Math.max(1, areaSize);
    const seedBase = state.seed + 9001;
    const weights = computeForestTreeWeights(avgMoisture, avgElevation, startX, startY, seedBase);
    const pickSeed = hash2D(startX, startY, state.seed + 9011);
    const dominant = pickWeightedTreeType(pickSeed, DOMINANT_FOREST_TYPES, weights);

    const secondaryCandidates = DOMINANT_FOREST_TYPES.filter((type) => type !== dominant);
    let secondaryCount = 0;
    if (areaSize >= 96) {
      secondaryCount = 1;
    }
    if (areaSize >= 256) {
      secondaryCount = 2;
    }
    const secondaryTypes: TreeType[] = [];
    for (let s = 0; s < secondaryCount; s += 1) {
      if (secondaryCandidates.length === 0) {
        break;
      }
      const seed = hash2D(startX, startY, state.seed + 9037 + s * 17);
      const pick = pickWeightedTreeType(seed, secondaryCandidates, weights);
      secondaryTypes.push(pick);
      const index = secondaryCandidates.indexOf(pick);
      if (index >= 0) {
        secondaryCandidates.splice(index, 1);
      }
    }

    const areaSeed = hash2D(startX, startY, state.seed + 9077);
    const baseScale = clamp(Math.sqrt(areaSize) * 0.9, 12, 36);
    const secondaryConfigs = secondaryTypes.map((type, index) => ({
      type,
      scale: baseScale * (0.9 + index * 0.25),
      threshold: 0.62 + index * 0.05 + (areaSize < 140 ? 0.04 : 0),
      offset: Math.floor(areaSeed * 1000) + index * 137
    }));

    indices.forEach((idx) => {
      const tile = state.tiles[idx];
      tile.dominantTreeType = dominant;
      let chosen = dominant;
      let bestScore = 0;
      const x = idx % cols;
      const y = Math.floor(idx / cols);
      const standScale = areaSize >= 256 ? 34 : areaSize >= 96 ? 26 : 18;
      const standX = Math.floor(x / standScale);
      const standY = Math.floor(y / standScale);
      const localWeights = computeForestTreeWeights(tile.moisture, tile.elevation, standX, standY, state.seed + 12_331);
      const localDominant = pickWeightedTreeType(hash2D(standX, standY, state.seed + 12_367), DOMINANT_FOREST_TYPES, localWeights);
      const localPatchNoise = fractalNoise(
        (x + standX * 17) / Math.max(10, standScale * 0.82),
        (y - standY * 19) / Math.max(10, standScale * 0.82),
        state.seed + 12_401
      );
      const transitionMix = clamp(1 - (tile.canopyCover ?? tile.canopy ?? 0), 0, 1);
      if (localDominant !== dominant && localPatchNoise > 0.48 + transitionMix * 0.1) {
        chosen = localDominant;
        bestScore = localPatchNoise;
      }
      if (secondaryConfigs.length > 0) {
        secondaryConfigs.forEach((config) => {
          const noise = fractalNoise(
            (x + config.offset) / config.scale,
            (y - config.offset) / config.scale,
            state.seed + 1200 + config.offset
          );
          if (noise > config.threshold && noise > bestScore) {
            bestScore = noise;
            chosen = config.type;
          }
        });
      }
      tile.treeType = chosen;
    });
  }
}

function pickRiverSource(
  state: WorldState,
  rng: RNG,
  elevationMap: number[],
  riverMask?: Uint8Array
): Point | null {
  let best: Point | null = null;
  let bestElev = 0;
  for (let i = 0; i < 200; i += 1) {
    const x = 4 + Math.floor(rng.next() * (state.grid.cols - 8));
    const y = 4 + Math.floor(rng.next() * (state.grid.rows - 8));
    const idx = indexFor(state.grid, x, y);
    if (riverMask && riverMask[idx] > 0) {
      continue;
    }
    const elev = elevationMap[idx];
    if (elev > bestElev) {
      bestElev = elev;
      best = { x, y };
    }
  }
  if (best && bestElev > 0.25) {
    return best;
  }
  return null;
}

export function carveRiverValleys(
  state: WorldState,
  rng: RNG,
  elevationMap: number[],
  riverMask: Uint8Array,
  valleyDepth: number,
  riverBias: number,
  settings: MapGenSettings,
  seaLevelMap: ArrayLike<number>,
  oceanMask?: Uint8Array
): void {
  state.valleyMap = Array.from({ length: state.grid.totalTiles }, () => 0);
  const totalTiles = state.grid.totalTiles;
  const cols = state.grid.cols;
  const rows = state.grid.rows;
  const idxAt = (x: number, y: number): number => y * cols + x;
  const isInside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < cols && y < rows;
  const riverBedField = new Float32Array(totalTiles).fill(Number.NaN);
  const riverSurfaceField = new Float32Array(totalTiles).fill(Number.NaN);
  const riverSurfaceWeight = new Float32Array(totalTiles);
  const riverStepStrengthField = new Float32Array(totalTiles);
  const minDim = Math.min(state.grid.cols, state.grid.rows);
  const maxRivers = minDim >= 256 ? 4 : minDim >= 128 ? 3 : 2;
  const requestedRivers = Math.max(0, Math.round(settings.riverCount ?? 0));
  const riverCount =
    requestedRivers > 0 ? requestedRivers : Math.max(1, Math.floor(maxRivers * (0.6 + rng.next() * 0.4)));
  const maxRiverAttempts = Math.max(riverCount + 4, riverCount * 8);
  const maxSteps = state.grid.cols + state.grid.rows;
  const riverScale = clamp(riverBias / 0.3, 0, 2);
  const minRiverSteps = Math.max(10, Math.floor(minDim * 0.2));
  const pathWidth = 0;
  const edgePull = 0.06 + riverScale * 0.18;
  const bedSlope = 0.00012 + riverScale * 0.0001;
  const maxDepth = 0.03 + riverScale * 0.02;
  const SURFACE_DROP_MIN = 0.00025;
  const MIN_RIVER_DEPTH = 0.006;
  const OUTLET_EPS = 0.0015;
  const BANK_CLEARANCE = 0.002;
  const EDGE_SURFACE_RISE = 0.0018;
  const STEP_TARGET_DROP_BASE = 0.009;
  const STEP_TARGET_DROP_STEEP_BONUS = 0.01;
  const STEP_MIN_SPACING = 2;
  const STEP_MAX_SPACING = 6;
  const PLUNGE_POOL_STRENGTH = 0.01;
  const STEP_LIP_STRENGTH = 0.42;
  const POOL_STEP_THRESHOLD = 0.12;
  const POOL_MAX_DROP_PER_TILE = 0.00012;
  const POOL_MIN_MONOTONIC_DROP = 0.00002;
  const MOUTH_BLEND_START = 0.8;
  const MOUTH_BLEND_RANGE = 0.2;
  const RIVER_MASK_CORE_RADIUS = 0.42;
  const RIVER_MASK_MOUTH_RADIUS_GAIN = 0.78;
  const RIVER_MASK_STEP_GAIN = 0.16;
  const RIVER_WIDTH_UPSTREAM_BASE = 0.14;
  const RIVER_WIDTH_DOWNSTREAM_GAIN = 0.92;
  const RIVER_WIDTH_SLOPE_GAIN = 6.5;
  const RIVER_WIDTH_STEP_GAIN = 0.38;
  const RIVER_MIN_CHANNEL_WIDTH = 1;
  const edgeWidth = getEdgeWidth(state.grid.cols, state.grid.rows);
  const seaLevelAt = (x: number, y: number): number => seaLevelMap[idxAt(x, y)] ?? 0;
  const riverBedFloorAt = (idx: number): number => {
    const sea = seaLevelMap[idx] ?? 0;
    const terrain = elevationMap[idx] ?? sea;
    const terrainFloor = terrain - MIN_RIVER_DEPTH - BANK_CLEARANCE;
    const seaFloor = sea - (MIN_RIVER_DEPTH + OUTLET_EPS);
    return clamp(Math.min(terrainFloor, seaFloor), 0, 1);
  };
  const touchesOceanConnectedWater = (x: number, y: number): boolean => {
    if (!oceanMask || !isInside(x, y)) {
      return false;
    }
    if (oceanMask[idxAt(x, y)] > 0) {
      return true;
    }
    return (
      (x > 0 && oceanMask[idxAt(x - 1, y)] > 0) ||
      (x < cols - 1 && oceanMask[idxAt(x + 1, y)] > 0) ||
      (y > 0 && oceanMask[idxAt(x, y - 1)] > 0) ||
      (y < rows - 1 && oceanMask[idxAt(x, y + 1)] > 0)
    );
  };
  const isOceanConnectedWaterCell = (x: number, y: number): boolean =>
    Boolean(oceanMask && isInside(x, y) && oceanMask[idxAt(x, y)] > 0);
  const appendOceanNeighborIfPresent = (
    currentPoint: Point,
    visited: Uint8Array,
    path: number[],
    widths: number[],
    widthBase: number
  ): boolean => {
    if (!oceanMask) {
      return false;
    }
    let bestOceanIdx = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < NEIGHBOR_DIRS.length; i += 1) {
      const nx = currentPoint.x + NEIGHBOR_DIRS[i].x;
      const ny = currentPoint.y + NEIGHBOR_DIRS[i].y;
      if (!isInside(nx, ny)) {
        continue;
      }
      const nIdx = idxAt(nx, ny);
      if (oceanMask[nIdx] === 0) {
        continue;
      }
      if (visited[nIdx] > 0) {
        continue;
      }
      const nElev = elevationMap[nIdx] ?? 0;
      if (nElev < bestScore) {
        bestScore = nElev;
        bestOceanIdx = nIdx;
      }
    }
    if (bestOceanIdx < 0) {
      return false;
    }
    visited[bestOceanIdx] = 1;
    path.push(bestOceanIdx);
    widths.push(widthBase);
    return true;
  };
  const localRiverNeighborPenalty = (x: number, y: number): number => {
    let support = 0;
    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        if (ox === 0 && oy === 0) {
          continue;
        }
        const nx = x + ox;
        const ny = y + oy;
        if (!isInside(nx, ny)) {
          continue;
        }
        if (riverMask[idxAt(nx, ny)] > 0) {
          support += 1;
        }
      }
    }
    return support >= 3 ? 0.16 : support <= 1 ? 0.04 : 0;
  };
  type BridgeInsert = { position: number; idx: number };
  const densifyPathWithDiagonalBridges = (
    path: number[],
    widths: number[],
    widthBase: number
  ): { path: number[]; widths: number[]; bridgeInserts: BridgeInsert[] } => {
    if (path.length < 2) {
      return { path, widths, bridgeInserts: [] };
    }
    const expandedPath: number[] = [path[0]];
    const expandedWidths: number[] = [widths[0] ?? widthBase];
    const bridgeInserts: BridgeInsert[] = [];
    for (let i = 0; i < path.length - 1; i += 1) {
      const aIdx = path[i];
      const bIdx = path[i + 1];
      const ax = aIdx % cols;
      const ay = Math.floor(aIdx / cols);
      const bx = bIdx % cols;
      const by = Math.floor(bIdx / cols);
      const dx = bx - ax;
      const dy = by - ay;
      if (Math.abs(dx) === 1 && Math.abs(dy) === 1) {
        const bridgeA = idxAt(ax + dx, ay);
        const bridgeB = idxAt(ax, ay + dy);
        const elevA = elevationMap[aIdx] ?? 0;
        const elevB = elevationMap[bIdx] ?? 0;
        const elevBridgeA = elevationMap[bridgeA] ?? 0;
        const elevBridgeB = elevationMap[bridgeB] ?? 0;
        const scoreA =
          Math.abs(elevBridgeA - elevA) + Math.abs(elevBridgeA - elevB) + localRiverNeighborPenalty(ax + dx, ay);
        const scoreB =
          Math.abs(elevBridgeB - elevA) + Math.abs(elevBridgeB - elevB) + localRiverNeighborPenalty(ax, ay + dy);
        const bridgeIdx = scoreA <= scoreB ? bridgeA : bridgeB;
        expandedPath.push(bridgeIdx);
        expandedWidths.push(clamp(Math.round(((widths[i] ?? widthBase) + (widths[i + 1] ?? widthBase)) * 0.5), 0, 1));
        bridgeInserts.push({ position: expandedPath.length - 1, idx: bridgeIdx });
      }
      expandedPath.push(bIdx);
      expandedWidths.push(widths[i + 1] ?? widthBase);
    }
    return { path: expandedPath, widths: expandedWidths, bridgeInserts };
  };
  const markRiverPath = (path: number[], width: number) => {
    if (path.length === 0) {
      return;
    }
    for (const idx of path) {
      const cx = idx % cols;
      const cy = Math.floor(idx / cols);
      for (let dy = -width; dy <= width; dy += 1) {
        const ny = cy + dy;
        if (ny < 0 || ny >= rows) {
          continue;
        }
        const maxDx = width - Math.abs(dy);
        const rowBase = ny * cols;
        for (let dx = -maxDx; dx <= maxDx; dx += 1) {
          const nx = cx + dx;
          if (nx < 0 || nx >= cols) {
            continue;
          }
          riverMask[rowBase + nx] = 1;
        }
      }
    }
  };
  const safeBedAt = (idx: number): number => {
    const existing = riverBedField[idx];
    if (Number.isFinite(existing)) {
      return existing;
    }
    return clamp(elevationMap[idx] - MIN_RIVER_DEPTH, riverBedFloorAt(idx), 1);
  };
  const safeSurfaceAt = (idx: number): number => {
    const existing = riverSurfaceField[idx];
    if (Number.isFinite(existing)) {
      return existing;
    }
    const bed = safeBedAt(idx);
    const minSurface = bed + MIN_RIVER_DEPTH;
    const maxSurface = Math.max(minSurface, elevationMap[idx] - BANK_CLEARANCE);
    return clamp(minSurface, minSurface, maxSurface);
  };
  const safeStepAt = (idx: number): number => {
    const value = riverStepStrengthField[idx];
    return Number.isFinite(value) ? clamp(value, 0, 1) : 0;
  };
  const enforcePoolGradients = (surfaces: number[], stepProfile: number[]): void => {
    if (surfaces.length < 2 || stepProfile.length === 0) {
      return;
    }
    for (let pass = 0; pass < 3; pass += 1) {
      let changed = false;
      for (let i = 1; i < surfaces.length; i += 1) {
        const prevSurface = surfaces[i - 1];
        const currentSurface = surfaces[i];
        if (!Number.isFinite(prevSurface) || !Number.isFinite(currentSurface)) {
          continue;
        }
        const stepStrength = clamp(stepProfile[i] ?? 0, 0, 1);
        if (stepStrength >= POOL_STEP_THRESHOLD) {
          continue;
        }
        const drop = prevSurface - currentSurface;
        if (drop <= POOL_MAX_DROP_PER_TILE) {
          continue;
        }
        const excess = drop - POOL_MAX_DROP_PER_TILE;
        surfaces[i] += excess;
        let remaining = excess;
        for (let j = i + 1; j < surfaces.length; j += 1) {
          const downstreamStep = clamp(stepProfile[j] ?? 0, 0, 1);
          if (downstreamStep < POOL_STEP_THRESHOLD) {
            continue;
          }
          surfaces[j] = Math.max(0, surfaces[j] - remaining);
          const stepTarget = STEP_TARGET_DROP_BASE + STEP_TARGET_DROP_STEEP_BONUS;
          const stepBoost = clamp(remaining / Math.max(1e-5, stepTarget), 0, 1);
          stepProfile[j] = clamp(Math.max(downstreamStep, downstreamStep + stepBoost * 0.35), 0, 1);
          remaining = 0;
          break;
        }
        if (remaining > 0) {
          const tail = surfaces.length - 1;
          surfaces[tail] = Math.max(0, surfaces[tail] - remaining);
          stepProfile[tail] = clamp(Math.max(stepProfile[tail] ?? 0, POOL_STEP_THRESHOLD + remaining * 28), 0, 1);
        }
        changed = true;
      }
      if (!changed) {
        break;
      }
    }
  };
  const enforceOrthogonalRiverConnectivity = (): void => {
    const neighborPenalty = (x: number, y: number): number => {
      let support = 0;
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          if (ox === 0 && oy === 0) {
            continue;
          }
          const nx = x + ox;
          const ny = y + oy;
          if (!isInside(nx, ny)) {
            continue;
          }
          if (riverMask[idxAt(nx, ny)] > 0) {
            support += 1;
          }
        }
      }
      return support >= 3 ? 0.18 : support <= 1 ? 0.05 : 0;
    };
    const ensureRiverCell = (targetIdx: number, aIdx: number, bIdx: number): boolean => {
      const alreadyRiver = riverMask[targetIdx] > 0;
      const bedA = safeBedAt(aIdx);
      const bedB = safeBedAt(bIdx);
      const surfaceA = safeSurfaceAt(aIdx);
      const surfaceB = safeSurfaceAt(bIdx);
      const stepA = safeStepAt(aIdx);
      const stepB = safeStepAt(bIdx);
      const terrainElevation = elevationMap[targetIdx] ?? 0;
      const bedFloor = riverBedFloorAt(targetIdx);
      const terrainCap = Math.max(0, terrainElevation - BANK_CLEARANCE);
      let bed = Math.min(bedA, bedB);
      const maxBed = Math.max(0, terrainCap - 0.0015);
      if (bed > maxBed) {
        bed = maxBed;
      }
      bed = Math.max(bedFloor, bed);
      const effectiveDepth = Math.min(MIN_RIVER_DEPTH, Math.max(0.0015, terrainCap - bed));
      const minSurface = Math.max(bed, bed + effectiveDepth);
      const maxSurface = Math.max(minSurface, terrainCap);
      const surface = clamp((surfaceA + surfaceB) * 0.5, minSurface, maxSurface);
      const step = clamp(Math.max(stepA, stepB) * 0.7, 0, 1);

      riverMask[targetIdx] = 1;
      const existingBed = riverBedField[targetIdx];
      if (!Number.isFinite(existingBed) || bed < existingBed) {
        riverBedField[targetIdx] = bed;
      }
      const existingSurface = riverSurfaceField[targetIdx];
      const existingWeight = riverSurfaceWeight[targetIdx] ?? 0;
      if (!Number.isFinite(existingSurface) || existingWeight <= 0) {
        riverSurfaceField[targetIdx] = surface;
        riverSurfaceWeight[targetIdx] = 0.3;
      } else {
        const weight = 0.3;
        const totalWeight = existingWeight + weight;
        riverSurfaceField[targetIdx] = (existingSurface * existingWeight + surface * weight) / totalWeight;
        riverSurfaceWeight[targetIdx] = totalWeight;
      }
      riverStepStrengthField[targetIdx] = Math.max(riverStepStrengthField[targetIdx] ?? 0, step);
      return !alreadyRiver;
    };

    for (let pass = 0; pass < 8; pass += 1) {
      let changed = false;
      const additions = new Map<number, { a: number; b: number; score: number }>();
      const addCandidate = (targetIdx: number, aIdx: number, bIdx: number, score: number): void => {
        if (riverMask[targetIdx] > 0) {
          return;
        }
        const existing = additions.get(targetIdx);
        if (!existing || score < existing.score) {
          additions.set(targetIdx, { a: aIdx, b: bIdx, score });
        }
      };

      for (let y = 0; y < rows - 1; y += 1) {
        for (let x = 0; x < cols - 1; x += 1) {
          const aIdx = idxAt(x, y);
          const bIdx = idxAt(x + 1, y + 1);
          if (!(riverMask[aIdx] > 0 && riverMask[bIdx] > 0)) {
            continue;
          }
          const bridgeA = idxAt(x + 1, y);
          const bridgeB = idxAt(x, y + 1);
          if (riverMask[bridgeA] > 0 || riverMask[bridgeB] > 0) {
            continue;
          }
          const elevA = elevationMap[aIdx] ?? 0;
          const elevB = elevationMap[bIdx] ?? 0;
          const elevBridgeA = elevationMap[bridgeA] ?? 0;
          const elevBridgeB = elevationMap[bridgeB] ?? 0;
          const scoreA =
            Math.abs(elevBridgeA - elevA) + Math.abs(elevBridgeA - elevB) + neighborPenalty(x + 1, y);
          const scoreB =
            Math.abs(elevBridgeB - elevA) + Math.abs(elevBridgeB - elevB) + neighborPenalty(x, y + 1);
          if (scoreA <= scoreB) {
            addCandidate(bridgeA, aIdx, bIdx, scoreA);
          } else {
            addCandidate(bridgeB, aIdx, bIdx, scoreB);
          }
        }
      }

      for (let y = 0; y < rows; y += 1) {
        for (let x = 1; x < cols - 1; x += 1) {
          const center = idxAt(x, y);
          if (riverMask[center] > 0) {
            continue;
          }
          const left = idxAt(x - 1, y);
          const right = idxAt(x + 1, y);
          if (riverMask[left] > 0 && riverMask[right] > 0) {
            const elevCenter = elevationMap[center] ?? 0;
            const score =
              Math.abs(elevCenter - (elevationMap[left] ?? elevCenter)) +
              Math.abs(elevCenter - (elevationMap[right] ?? elevCenter)) +
              neighborPenalty(x, y);
            addCandidate(center, left, right, score);
          }
        }
      }
      for (let y = 1; y < rows - 1; y += 1) {
        for (let x = 0; x < cols; x += 1) {
          const center = idxAt(x, y);
          if (riverMask[center] > 0) {
            continue;
          }
          const up = idxAt(x, y - 1);
          const down = idxAt(x, y + 1);
          if (riverMask[up] > 0 && riverMask[down] > 0) {
            const elevCenter = elevationMap[center] ?? 0;
            const score =
              Math.abs(elevCenter - (elevationMap[up] ?? elevCenter)) +
              Math.abs(elevCenter - (elevationMap[down] ?? elevCenter)) +
              neighborPenalty(x, y);
            addCandidate(center, up, down, score);
          }
        }
      }

      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < cols; x += 1) {
          const idx = idxAt(x, y);
          if (riverMask[idx] === 0) {
            continue;
          }
          const west = x > 0 && riverMask[idxAt(x - 1, y)] > 0;
          const east = x < cols - 1 && riverMask[idxAt(x + 1, y)] > 0;
          const north = y > 0 && riverMask[idxAt(x, y - 1)] > 0;
          const south = y < rows - 1 && riverMask[idxAt(x, y + 1)] > 0;
          const orthCount = (west ? 1 : 0) + (east ? 1 : 0) + (north ? 1 : 0) + (south ? 1 : 0);
          if (orthCount > 0) {
            continue;
          }
          const diagNeighbors: { x: number; y: number; idx: number; score: number }[] = [];
          const tryDiag = (nx: number, ny: number) => {
            if (!isInside(nx, ny)) {
              return;
            }
            const nIdx = idxAt(nx, ny);
            if (riverMask[nIdx] === 0) {
              return;
            }
            const elevDiff = Math.abs((elevationMap[idx] ?? 0) - (elevationMap[nIdx] ?? 0));
            diagNeighbors.push({ x: nx, y: ny, idx: nIdx, score: elevDiff });
          };
          tryDiag(x - 1, y - 1);
          tryDiag(x + 1, y - 1);
          tryDiag(x - 1, y + 1);
          tryDiag(x + 1, y + 1);
          if (diagNeighbors.length === 0) {
            continue;
          }
          diagNeighbors.sort((a, b) => a.score - b.score);
          const best = diagNeighbors[0];
          const bridgeA = idxAt(best.x, y);
          const bridgeB = idxAt(x, best.y);
          const elev = elevationMap[idx] ?? 0;
          const scoreA =
            Math.abs((elevationMap[bridgeA] ?? elev) - elev) +
            Math.abs((elevationMap[bridgeA] ?? elev) - (elevationMap[best.idx] ?? elev)) +
            neighborPenalty(best.x, y);
          const scoreB =
            Math.abs((elevationMap[bridgeB] ?? elev) - elev) +
            Math.abs((elevationMap[bridgeB] ?? elev) - (elevationMap[best.idx] ?? elev)) +
            neighborPenalty(x, best.y);
          if (scoreA <= scoreB) {
            addCandidate(bridgeA, idx, best.idx, scoreA);
          } else {
            addCandidate(bridgeB, idx, best.idx, scoreB);
          }
        }
      }

      additions.forEach((candidate, idx) => {
        if (ensureRiverCell(idx, candidate.a, candidate.b)) {
          changed = true;
        }
      });
      if (!changed) {
        break;
      }
    }
  };
  let riversCarved = 0;
  for (let attemptNumber = 0; attemptNumber < maxRiverAttempts && riversCarved < riverCount; attemptNumber += 1) {
    let source: Point | null = null;
    for (let attempt = 0; attempt < 4 && !source; attempt += 1) {
      source = pickRiverSource(state, rng, elevationMap, riverMask);
    }
    if (!source) {
      continue;
    }
    const isWet = rng.next() < 0.55;
    const depthBase = (isWet ? 0.02 + rng.next() * 0.01 : 0.015 + rng.next() * 0.008) * (0.6 + riverScale * 0.4);
    const widthBase = 1;
    let current = source;
    let dir: Point | null = null;
    const visited = new Uint8Array(state.grid.totalTiles);
    const riverPath: number[] = [];
    const riverWidths: number[] = [];
    let reachedEdge = false;
    let reachedSea = false;
    let reachedExistingRiver = false;
    for (let step = 0; step < maxSteps; step += 1) {
      const idx = indexFor(state.grid, current.x, current.y);
      if (visited[idx]) {
        break;
      }
      visited[idx] = 1;
      riverPath.push(idx);
      const width = widthBase;
      riverWidths.push(width);
      if (riverPath.length > 1 && riverMask[idx] > 0) {
        reachedExistingRiver = true;
        break;
      }
      if (isOceanConnectedWaterCell(current.x, current.y)) {
        reachedSea = true;
        break;
      }
      const currentElev = elevationMap[idx];
      const currentFalloff = getEdgeFalloff(
        current.x,
        current.y,
        state.grid.cols,
        state.grid.rows,
        edgeWidth,
        state.seed
      );
      const routedCurrent = WATER_BASELINE_ELEV + (currentElev - WATER_BASELINE_ELEV) * currentFalloff;
      if (
        routedCurrent <= seaLevelAt(current.x, current.y) + 0.008 &&
        isOceanConnectedWaterCell(current.x, current.y)
      ) {
        reachedSea = true;
        break;
      }

      let next: Point | null = null;
      let nextIsExistingRiver = false;
      let joinScore = Number.POSITIVE_INFINITY;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const dirStep of NEIGHBOR_DIRS) {
        const nx = current.x + dirStep.x;
        const ny = current.y + dirStep.y;
        if (!inBounds(state.grid, nx, ny)) {
          continue;
        }
        const nIdx = indexFor(state.grid, nx, ny);
        if (visited[nIdx]) {
          continue;
        }
        const nextElev = elevationMap[nIdx];
        const nextFalloff = getEdgeFalloff(nx, ny, state.grid.cols, state.grid.rows, edgeWidth, state.seed);
        const routedNext = WATER_BASELINE_ELEV + (nextElev - WATER_BASELINE_ELEV) * nextFalloff;
        const slope = routedNext - routedCurrent;
        if (riverMask[nIdx] > 0) {
          const candidateScore = nextElev + rng.next() * 0.01;
          if (candidateScore < joinScore) {
            joinScore = candidateScore;
            next = { x: nx, y: ny };
            nextIsExistingRiver = true;
          }
          continue;
        }
        let score = routedNext + rng.next() * 0.03;
        if (oceanMask && oceanMask[nIdx]) {
          score = -1;
        }
        const edgeDist = Math.min(nx, ny, state.grid.cols - 1 - nx, state.grid.rows - 1 - ny);
        const edgeNorm = edgeDist / Math.max(1, minDim * 0.5);
        score += edgeNorm * edgePull;
        if (slope > 0) {
          score += slope * 1.8;
        }
        if (dir) {
          const dot = dir.x * dirStep.x + dir.y * dirStep.y;
          if (dot < 0) {
            score += 0.08;
          } else if (dot === 0) {
            score += 0.03;
          }
        }
        if (score < bestScore) {
          bestScore = score;
          if (!nextIsExistingRiver) {
            next = { x: nx, y: ny };
          }
        }
      }
      if (!next) {
        break;
      }
      if (nextIsExistingRiver) {
        const joinIdx = indexFor(state.grid, next.x, next.y);
        if (!visited[joinIdx]) {
          visited[joinIdx] = 1;
          riverPath.push(joinIdx);
          riverWidths.push(widthBase);
        }
        reachedExistingRiver = true;
        break;
      }
      dir = { x: next.x - current.x, y: next.y - current.y };
      current = next;
      if (
        current.x <= 1 ||
        current.y <= 1 ||
        current.x >= state.grid.cols - 2 ||
        current.y >= state.grid.rows - 2
      ) {
        const edgeIdx = indexFor(state.grid, current.x, current.y);
        if (!visited[edgeIdx]) {
          visited[edgeIdx] = 1;
          riverPath.push(edgeIdx);
          riverWidths.push(widthBase);
        }
        reachedEdge = true;
        break;
      }
    }
    if (!reachedSea && !reachedExistingRiver && touchesOceanConnectedWater(current.x, current.y)) {
      reachedSea = appendOceanNeighborIfPresent(current, visited, riverPath, riverWidths, widthBase);
    }
    if (!reachedEdge && !reachedSea && !reachedExistingRiver) {
      continue;
    }
    const densified = densifyPathWithDiagonalBridges(riverPath, riverWidths, widthBase);
    riverPath.length = 0;
    riverPath.push(...densified.path);
    riverWidths.length = 0;
    riverWidths.push(...densified.widths);
    const bridgeInserts = densified.bridgeInserts;
    markRiverPath(riverPath, pathWidth);
    if (riverPath.length === 0) {
      continue;
    }
    const riverBeds: number[] = [];
    const riverSurfaces: number[] = [];
    const riverStepProfile: number[] = [];
    const pathSlope: number[] = [];
    let lastBed = 0;
    let stepAccumulator = 0;
    let sinceLastStep = 0;
    for (let i = 0; i < riverPath.length; i += 1) {
      const idx = riverPath[i];
      const localElev = elevationMap[idx];
      const prevIdx = i > 0 ? riverPath[i - 1] : idx;
      const prevElev = elevationMap[prevIdx] ?? localElev;
      const localSlope = Math.max(0, prevElev - localElev);
      pathSlope.push(localSlope);
      if (i === 0) {
        lastBed = Math.max(riverBedFloorAt(idx), localElev - 0.01);
      } else {
        const slopeCarveBonus = clamp(localSlope * (1.1 + riverScale * 0.45), 0, 0.02);
        const target = Math.min(localElev - 0.004, lastBed - (bedSlope + slopeCarveBonus * 0.22));
        lastBed = Math.max(riverBedFloorAt(idx), target);
      }
      riverBeds.push(lastBed);
      const minSurface = lastBed + MIN_RIVER_DEPTH;
      const terrainCap = Math.max(minSurface, localElev - BANK_CLEARANCE);
      if (i === 0) {
        riverSurfaces.push(clamp(localElev - Math.max(0.004, depthBase * 0.45), minSurface, terrainCap));
        riverStepProfile.push(0);
      } else {
        const prevSurface = riverSurfaces[i - 1];
        stepAccumulator += localSlope * (0.62 + riverScale * 0.3) + SURFACE_DROP_MIN * 0.35;
        sinceLastStep += 1;
        const steepBonus = clamp(localSlope * 0.95, 0, STEP_TARGET_DROP_STEEP_BONUS);
        const stepTargetDrop = STEP_TARGET_DROP_BASE + steepBonus;
        const shouldEmitStep =
          (sinceLastStep >= STEP_MIN_SPACING && stepAccumulator >= stepTargetDrop) ||
          sinceLastStep >= STEP_MAX_SPACING;
        let drop = SURFACE_DROP_MIN * (0.32 + localSlope * 7.5);
        let stepStrength = 0;
        if (shouldEmitStep) {
          drop = clamp(stepAccumulator, stepTargetDrop * 0.65, stepTargetDrop * 1.8);
          stepStrength = clamp(drop / Math.max(0.0001, stepTargetDrop + STEP_TARGET_DROP_STEEP_BONUS), 0, 1);
          stepAccumulator = 0;
          sinceLastStep = 0;
        }
        const maxBySlope = prevSurface - drop;
        const target = Math.min(terrainCap, maxBySlope - depthBase * (0.045 + stepStrength * 0.04));
        riverSurfaces.push(Math.max(minSurface, target));
        riverStepProfile.push(stepStrength);
      }
    }
    for (let i = 0; i < bridgeInserts.length; i += 1) {
      const bridge = bridgeInserts[i];
      const pos = bridge.position;
      if (pos <= 0 || pos >= riverPath.length - 1) {
        continue;
      }
      const localElev = elevationMap[bridge.idx] ?? 0;
      const bridgeBedFloor = riverBedFloorAt(bridge.idx);
      const prevBed = riverBeds[pos - 1] ?? bridgeBedFloor;
      const nextBed = riverBeds[pos + 1] ?? prevBed;
      const minBedForSurface = localElev - MIN_RIVER_DEPTH - BANK_CLEARANCE;
      const bridgeBed = clamp(
        (prevBed + nextBed) * 0.5,
        bridgeBedFloor,
        Math.max(bridgeBedFloor, minBedForSurface)
      );
      riverBeds[pos] = bridgeBed;
      const minSurface = bridgeBed + MIN_RIVER_DEPTH;
      const terrainCap = Math.max(minSurface, localElev - BANK_CLEARANCE);
      const prevSurface = riverSurfaces[pos - 1] ?? minSurface;
      const nextSurface = riverSurfaces[pos + 1] ?? prevSurface;
      riverSurfaces[pos] = clamp((prevSurface + nextSurface) * 0.5, minSurface, terrainCap);
      const prevStep = clamp(riverStepProfile[pos - 1] ?? 0, 0, 1);
      const nextStep = clamp(riverStepProfile[pos + 1] ?? 0, 0, 1);
      riverStepProfile[pos] = clamp((prevStep + nextStep) * 0.5, 0, 1);
    }
    enforcePoolGradients(riverSurfaces, riverStepProfile);
    const outletIdx = riverPath[riverPath.length - 1];
    const outletX = outletIdx % state.grid.cols;
    const outletY = Math.floor(outletIdx / state.grid.cols);
    const outletBed = riverBeds[riverBeds.length - 1] ?? riverBedFloorAt(outletIdx);
    const outletMinSurface = outletBed + MIN_RIVER_DEPTH;
    const outletCap = Math.max(outletMinSurface, elevationMap[outletIdx] - BANK_CLEARANCE);
    const outletTarget = reachedExistingRiver
      ? clamp(safeSurfaceAt(outletIdx), outletMinSurface, outletCap)
      : clamp(seaLevelAt(outletX, outletY) + OUTLET_EPS, outletMinSurface, outletCap);
    const currentOutletSurface = riverSurfaces[riverSurfaces.length - 1] ?? outletTarget;
    if (currentOutletSurface > outletTarget) {
      const delta = currentOutletSurface - outletTarget;
      const denom = Math.max(1, riverSurfaces.length - 1);
      for (let i = 0; i < riverSurfaces.length; i += 1) {
        const t = i / denom;
        riverSurfaces[i] -= delta * (0.2 + 0.8 * t);
      }
    }
    for (let i = 0; i < riverSurfaces.length; i += 1) {
      const idx = riverPath[i];
      const bed = riverBeds[i] ?? riverBedFloorAt(idx);
      const minSurface = bed + MIN_RIVER_DEPTH;
      const terrainCap = Math.max(minSurface, elevationMap[idx] - BANK_CLEARANCE);
      let surface = clamp(riverSurfaces[i] ?? minSurface, minSurface, terrainCap);
      if (i > 0) {
        const prevStep = clamp(riverStepProfile[i - 1] ?? 0, 0, 1);
        const localStep = clamp(riverStepProfile[i] ?? 0, 0, 1);
        const inPoolSegment = Math.max(prevStep, localStep) < POOL_STEP_THRESHOLD;
        const minDrop = inPoolSegment ? POOL_MIN_MONOTONIC_DROP : SURFACE_DROP_MIN;
        const maxBySlope = (riverSurfaces[i - 1] ?? surface) - minDrop;
        if (surface > maxBySlope) {
          surface = maxBySlope;
        }
        if (surface < minSurface) {
          surface = minSurface;
        }
      }
      riverSurfaces[i] = surface;
    }
    const pathDenom = Math.max(1, riverPath.length - 1);
    for (let i = 0; i < riverPath.length; i += 1) {
      const slope = pathSlope[i] ?? 0;
      const stepStrength = riverStepProfile[i] ?? 0;
      const pathT = i / pathDenom;
      const mouthBlend = clamp((pathT - MOUTH_BLEND_START) / MOUTH_BLEND_RANGE, 0, 1);
      const adaptiveWidth =
        RIVER_WIDTH_UPSTREAM_BASE +
        pathT * RIVER_WIDTH_DOWNSTREAM_GAIN +
        slope * RIVER_WIDTH_SLOPE_GAIN +
        stepStrength * RIVER_WIDTH_STEP_GAIN +
        mouthBlend * 0.35;
      riverWidths[i] = clamp(Math.round(adaptiveWidth), RIVER_MIN_CHANNEL_WIDTH, 1);
    }
    const cols = state.grid.cols;
    const rows = state.grid.rows;
    for (let i = 0; i < riverPath.length; i += 1) {
      const idx = riverPath[i];
      const width = riverWidths[i] ?? widthBase;
      const bed = riverBeds[i] ?? riverBedFloorAt(idx);
      const centerSurface = riverSurfaces[i] ?? (bed + MIN_RIVER_DEPTH);
      const localSlope = pathSlope[i] ?? 0;
      const stepStrength = clamp(riverStepProfile[i] ?? 0, 0, 1);
      const pathT = i / pathDenom;
      const mouthBlend = clamp((pathT - MOUTH_BLEND_START) / MOUTH_BLEND_RANGE, 0, 1);
      const maskRadius =
        RIVER_MASK_CORE_RADIUS +
        mouthBlend * RIVER_MASK_MOUTH_RADIUS_GAIN +
        stepStrength * RIVER_MASK_STEP_GAIN;
      const influenceRadius = Math.max(width, Math.ceil(maskRadius));
      const cx = idx % cols;
      const cy = Math.floor(idx / cols);
      for (let dy = -influenceRadius; dy <= influenceRadius; dy += 1) {
        const ny = cy + dy;
        if (ny < 0 || ny >= rows) {
          continue;
        }
        for (let dx = -influenceRadius; dx <= influenceRadius; dx += 1) {
          const nx = cx + dx;
          if (nx < 0 || nx >= cols) {
            continue;
          }
          const dist = Math.hypot(dx, dy);
          const carveLimit = width + 0.1;
          const maskLimit = maskRadius + 0.05;
          if (dist > Math.max(carveLimit, maskLimit)) {
            continue;
          }
          const insideCarve = dist <= carveLimit;
          const falloff = 1 - dist / (width + 0.5);
          const slopeBonus = clamp(localSlope * (0.85 + riverScale * 0.35), 0, 0.016);
          const stepDepthBonus = stepStrength * 0.012;
          const segmentDepthBase = depthBase + slopeBonus + stepDepthBonus;
          const depth = segmentDepthBase * falloff;
          const localBed = bed + (1 - falloff) * 0.01 - stepStrength * 0.0022 * falloff;
          const nIdx = ny * cols + nx;
          if (dist <= maskLimit) {
            riverMask[nIdx] = 1;
          }
          if (!insideCarve) {
            continue;
          }
          const maxCarve = Math.max(0, elevationMap[nIdx] - localBed);
          const stepLipFactor = 1 - stepStrength * STEP_LIP_STRENGTH * falloff;
          const carve = Math.min(depth, maxCarve, (maxDepth + slopeBonus + stepDepthBonus) * falloff) * stepLipFactor;
          if (carve > 0) {
            elevationMap[nIdx] = clamp(elevationMap[nIdx] - carve, 0, 1);
            state.valleyMap[nIdx] = Math.max(state.valleyMap[nIdx], carve);
          }
          const minSurface = localBed + MIN_RIVER_DEPTH;
          const maxSurface = Math.max(minSurface, elevationMap[nIdx] - BANK_CLEARANCE);
          const localSurface = clamp(centerSurface + (1 - falloff) * EDGE_SURFACE_RISE, minSurface, maxSurface);
          const existingBed = riverBedField[nIdx];
          if (!Number.isFinite(existingBed) || localBed < existingBed) {
            riverBedField[nIdx] = localBed;
          }
          riverStepStrengthField[nIdx] = Math.max(riverStepStrengthField[nIdx] ?? 0, stepStrength * (0.45 + falloff * 0.55));
          const weight = Math.max(0.01, falloff * falloff);
          const existingSurface = riverSurfaceField[nIdx];
          const existingWeight = riverSurfaceWeight[nIdx] ?? 0;
          if (!Number.isFinite(existingSurface) || existingWeight <= 0) {
            riverSurfaceField[nIdx] = localSurface;
            riverSurfaceWeight[nIdx] = weight;
          } else {
            const totalWeight = existingWeight + weight;
            riverSurfaceField[nIdx] = (existingSurface * existingWeight + localSurface * weight) / totalWeight;
            riverSurfaceWeight[nIdx] = totalWeight;
          }
        }
      }
      if (stepStrength > 0.2 && i < riverPath.length - 1) {
        const nextIdx = riverPath[i + 1];
        const nextX = nextIdx % cols;
        const nextY = Math.floor(nextIdx / cols);
        const plungeRadius = Math.max(1, width);
        for (let py = -plungeRadius; py <= plungeRadius; py += 1) {
          const yy = nextY + py;
          if (yy < 0 || yy >= rows) {
            continue;
          }
          for (let px = -plungeRadius; px <= plungeRadius; px += 1) {
            const xx = nextX + px;
            if (xx < 0 || xx >= cols) {
              continue;
            }
            const dist = Math.hypot(px, py);
            if (dist > plungeRadius + 0.15) {
              continue;
            }
            const falloff = 1 - dist / (plungeRadius + 0.15);
            const plunge = (0.002 + stepStrength * PLUNGE_POOL_STRENGTH) * falloff;
            const pIdx = yy * cols + xx;
            if (plunge > 0) {
              elevationMap[pIdx] = clamp(elevationMap[pIdx] - plunge, 0, 1);
              state.valleyMap[pIdx] = Math.max(state.valleyMap[pIdx], plunge);
              riverStepStrengthField[pIdx] = Math.max(riverStepStrengthField[pIdx] ?? 0, stepStrength * (0.4 + falloff * 0.6));
            }
          }
        }
      }
    }
    riversCarved += 1;
  }
  enforceOrthogonalRiverConnectivity();
  for (let i = 0; i < totalTiles; i += 1) {
    if (!riverMask[i]) {
      riverBedField[i] = Number.NaN;
      riverSurfaceField[i] = Number.NaN;
      riverStepStrengthField[i] = 0;
      continue;
    }
    const bed = Number.isFinite(riverBedField[i])
      ? riverBedField[i]
      : clamp(elevationMap[i] - MIN_RIVER_DEPTH, riverBedFloorAt(i), 1);
    riverBedField[i] = bed;
    const minSurface = bed + MIN_RIVER_DEPTH;
    const maxSurface = Math.max(minSurface, elevationMap[i] - BANK_CLEARANCE);
    const surface = Number.isFinite(riverSurfaceField[i]) ? riverSurfaceField[i] : minSurface;
    riverSurfaceField[i] = clamp(surface, minSurface, maxSurface);
  }
  state.tileRiverBed = riverBedField;
  state.tileRiverSurface = riverSurfaceField;
  state.tileRiverStepStrength = riverStepStrengthField;
}

type ElevationBuildResult = {
  elevationMap: number[];
  riverMask: Uint8Array;
  seaLevelBase: number;
  erosionWearMap: Float32Array;
  erosionDepositMap: Float32Array;
  erosionHardnessMap: Float32Array;
  erosionFlowXMap: Float32Array;
  erosionFlowYMap: Float32Array;
  archetypeUpliftMap?: Float32Array;
  tectonicStressMap?: Float32Array;
  tectonicTrendXMap?: Float32Array;
  tectonicTrendYMap?: Float32Array;
};

const TERRAIN_SPIKE_THRESHOLD = 0.014;
const TERRAIN_SPIKE_MARGIN = 0.003;
const TERRAIN_SPIKE_PASSES = 3;
const TERRAIN_SPIKE_SUPPORTED_NEIGHBOR_MAX = 2;

export function suppressIsolatedElevationSpikes(
  elevationMap: number[],
  cols: number,
  rows: number,
  protectedMask?: ArrayLike<number> | null
): void {
  if (cols < 3 || rows < 3) {
    return;
  }
  const next = new Float32Array(elevationMap.length);
  const neighbors = new Float32Array(8);
  for (let pass = 0; pass < TERRAIN_SPIKE_PASSES; pass += 1) {
    let changed = false;
    for (let i = 0; i < elevationMap.length; i += 1) {
      next[i] = elevationMap[i] ?? 0;
    }
    for (let y = 1; y < rows - 1; y += 1) {
      for (let x = 1; x < cols - 1; x += 1) {
        const idx = y * cols + x;
        if ((protectedMask?.[idx] ?? 0) > 0) {
          continue;
        }
        const center = elevationMap[idx] ?? 0;
        let sum = 0;
        let count = 0;
        let supportCount = 0;
        let neighborWrite = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) {
              continue;
            }
            const value = elevationMap[(y + dy) * cols + (x + dx)] ?? center;
            neighbors[neighborWrite] = value;
            neighborWrite += 1;
            sum += value;
            count += 1;
            if (value >= center - TERRAIN_SPIKE_THRESHOLD * 0.45) {
              supportCount += 1;
            }
          }
        }
        if (count !== 8) {
          continue;
        }
        for (let i = 1; i < neighbors.length; i += 1) {
          const value = neighbors[i];
          let j = i - 1;
          while (j >= 0 && neighbors[j] > value) {
            neighbors[j + 1] = neighbors[j];
            j -= 1;
          }
          neighbors[j + 1] = value;
        }
        const avgNeighbor = sum / count;
        const medianNeighbor = (neighbors[3] + neighbors[4]) * 0.5;
        const supportedPeak = supportCount > TERRAIN_SPIKE_SUPPORTED_NEIGHBOR_MAX;
        const isolatedPeak =
          !supportedPeak &&
          center - medianNeighbor > TERRAIN_SPIKE_THRESHOLD &&
          center - avgNeighbor > TERRAIN_SPIKE_THRESHOLD * 0.7;
        if (!isolatedPeak) {
          continue;
        }
        const clampTarget = Math.max(avgNeighbor, medianNeighbor + TERRAIN_SPIKE_MARGIN);
        if (clampTarget >= center) {
          continue;
        }
        next[idx] = clampTarget;
        changed = true;
      }
    }
    for (let i = 0; i < elevationMap.length; i += 1) {
      elevationMap[i] = next[i];
    }
    if (!changed) {
      break;
    }
  }
}

export async function buildElevationMap(
  state: WorldState,
  rng: RNG,
  settings: MapGenSettings,
  report?: MapGenReporter,
  yieldIfNeeded?: () => Promise<boolean>,
  debug?: MapGenDebug
): Promise<ElevationBuildResult> {
  void rng;
  return buildNoiseLandmass({
    seed: state.seed,
    cols: state.grid.cols,
    rows: state.grid.rows,
    settings,
    report,
    yieldIfNeeded,
    debug,
    includeRivers: true
  });
}

export async function buildMoistureMap(
  state: WorldState,
  distToWater: Uint16Array,
  maxWaterDistance: number,
  report?: MapGenReporter,
  yieldIfNeeded?: () => Promise<boolean>
): Promise<Float32Array> {
  return buildWindDrivenMoistureMap({
    seed: state.seed,
    cols: state.grid.cols,
    rows: state.grid.rows,
    tiles: state.tiles,
    distToWater,
    maxWaterDistance,
    climate: generateWorldClimateSeed(state.seed),
    report,
    yieldIfNeeded
  });
}

async function smoothWater(
  state: WorldState,
  inputTiles: Tile[],
  report?: MapGenReporter,
  yieldIfNeeded?: () => Promise<boolean>
): Promise<Tile[]> {
  const total = inputTiles.length;
  const inputTypes = new Array<TileType>(total);
  for (let i = 0; i < total; i += 1) {
    inputTypes[i] = inputTiles[i].type;
  }
  const outputTypes = inputTypes.slice();
  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      let waterCount = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue;
          }
          const nx = x + dx;
          const ny = y + dy;
          if (!inBounds(state.grid, nx, ny)) {
            waterCount += 1;
            continue;
          }
          if (inputTypes[indexFor(state.grid, nx, ny)] === "water") {
            waterCount += 1;
          }
        }
      }
      const idx = indexFor(state.grid, x, y);
      if (waterCount >= 5) {
        outputTypes[idx] = "water";
      } else if (waterCount <= 2 && inputTypes[idx] === "water") {
        outputTypes[idx] = "grass";
      }
    }
    if (yieldIfNeeded && report) {
      if (await yieldIfNeeded()) {
        await report("Softening shoreline...", (y + 1) / state.grid.rows);
      }
    }
  }
  for (let i = 0; i < total; i += 1) {
    inputTiles[i].type = outputTypes[i];
  }
  return inputTiles;
}

export async function computeWaterDistances(
  state: WorldState,
  maxDistance: number,
  report?: MapGenReporter,
  yieldIfNeeded?: () => Promise<boolean>
): Promise<Uint16Array> {
  const total = state.grid.totalTiles;
  const cols = state.grid.cols;
  const rows = state.grid.rows;
  const unvisited = 0xffff;
  const maxDist = Math.max(1, Math.min(unvisited - 1, Math.floor(maxDistance)));
  const dist = new Uint16Array(total);
  dist.fill(unvisited);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  for (let y = 0; y < rows; y += 1) {
    const rowBase = y * cols;
    for (let x = 0; x < cols; x += 1) {
      const idx = rowBase + x;
      if (state.tiles[idx].type === "water") {
        dist[idx] = 0;
        queue[tail] = idx;
        tail += 1;
      }
    }
    if (yieldIfNeeded && report) {
      if (await yieldIfNeeded()) {
        await report("Charting shoreline distance...", Math.min(0.15, (y + 1) / rows * 0.15));
      }
    }
  }

  let pops = 0;
  const safetyLimit = total * 8;
  const chunkSize = Math.max(1, MOISTURE_BFS_CHUNK);
  while (head < tail) {
    const idx = queue[head];
    head += 1;
    pops += 1;
    if (pops > safetyLimit) {
      throw new Error(
        `Water distance BFS exceeded safety limit (seed=${state.seed}, pops=${pops}, head=${head}, tail=${tail}, total=${total}).`
      );
    }
    const currentDist = dist[idx];
    if (currentDist >= maxDist) {
      continue;
    }
    const x = idx % cols;
    const y = Math.floor(idx / cols);

    if (x > 0) {
      const nIdx = idx - 1;
      if (dist[nIdx] === unvisited) {
        dist[nIdx] = currentDist + 1;
        queue[tail] = nIdx;
        tail += 1;
      }
    }
    if (x < cols - 1) {
      const nIdx = idx + 1;
      if (dist[nIdx] === unvisited) {
        dist[nIdx] = currentDist + 1;
        queue[tail] = nIdx;
        tail += 1;
      }
    }
    if (y > 0) {
      const nIdx = idx - cols;
      if (dist[nIdx] === unvisited) {
        dist[nIdx] = currentDist + 1;
        queue[tail] = nIdx;
        tail += 1;
      }
    }
    if (y < rows - 1) {
      const nIdx = idx + cols;
      if (dist[nIdx] === unvisited) {
        dist[nIdx] = currentDist + 1;
        queue[tail] = nIdx;
        tail += 1;
      }
    }

    if (yieldIfNeeded && report && pops % chunkSize === 0) {
      if (await yieldIfNeeded()) {
        await report("Charting shoreline distance...", Math.min(1, pops / total));
      }
    }
  }

  for (let i = 0; i < total; i += 1) {
    const value = dist[i] === unvisited ? maxDist : Math.min(dist[i], maxDist);
    dist[i] = value;
    state.tiles[i].waterDist = value;
  }

  return dist;
}

async function computeWaterDistancesCoarse(
  state: WorldState,
  maxDistance: number,
  factor: number,
  report?: MapGenReporter,
  yieldIfNeeded?: () => Promise<boolean>
): Promise<void> {
  const cols = state.grid.cols;
  const rows = state.grid.rows;
  const coarseCols = Math.ceil(cols / factor);
  const coarseRows = Math.ceil(rows / factor);
  const coarseTotal = coarseCols * coarseRows;
  const dist = new Int16Array(coarseTotal);
  dist.fill(-1);
  const queue = new Int32Array(coarseTotal);
  let head = 0;
  let tail = 0;
  const maxCoarseDistance = Math.max(1, Math.ceil(maxDistance / factor));

  for (let cy = 0; cy < coarseRows; cy += 1) {
    const startY = cy * factor;
    const endY = Math.min(rows, startY + factor);
    for (let cx = 0; cx < coarseCols; cx += 1) {
      const startX = cx * factor;
      const endX = Math.min(cols, startX + factor);
      let hasWater = false;
      for (let y = startY; y < endY && !hasWater; y += 1) {
        const rowBase = y * cols;
        for (let x = startX; x < endX; x += 1) {
          if (state.tiles[rowBase + x].type === "water") {
            hasWater = true;
            break;
          }
        }
      }
      if (hasWater) {
        const idx = cy * coarseCols + cx;
        dist[idx] = 0;
        queue[tail] = idx;
        tail += 1;
      }
    }
    if (yieldIfNeeded && report) {
      if (await yieldIfNeeded()) {
        await report("Charting shoreline distance...", Math.min(1, (cy + 1) / coarseRows));
      }
    }
  }

  const dirs = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 }
  ];
  const reportStride = Math.max(256, coarseCols * 2);

  while (head < tail) {
    const idx = queue[head];
    head += 1;
    const currentDist = dist[idx];
    if (currentDist >= maxCoarseDistance) {
      continue;
    }
    const x = idx % coarseCols;
    const y = Math.floor(idx / coarseCols);
    for (const dir of dirs) {
      const nx = x + dir.x;
      const ny = y + dir.y;
      if (nx < 0 || ny < 0 || nx >= coarseCols || ny >= coarseRows) {
        continue;
      }
      const nIdx = ny * coarseCols + nx;
      if (dist[nIdx] !== -1) {
        continue;
      }
      dist[nIdx] = currentDist + 1;
      queue[tail] = nIdx;
      tail += 1;
    }
    if (yieldIfNeeded && report && head % reportStride === 0) {
      if (await yieldIfNeeded()) {
        await report("Charting shoreline distance...", Math.min(1, head / coarseTotal));
      }
    }
  }

  for (let y = 0; y < rows; y += 1) {
    const rowBase = y * cols;
    const cy = Math.floor(y / factor);
    const coarseRowBase = cy * coarseCols;
    for (let x = 0; x < cols; x += 1) {
      const tile = state.tiles[rowBase + x];
      const cx = Math.floor(x / factor);
      const coarseDist = dist[coarseRowBase + cx];
      let waterDist = coarseDist === -1 ? maxDistance : Math.min(maxDistance, coarseDist * factor);
      if (tile.type === "water") {
        waterDist = 0;
      }
      tile.waterDist = waterDist;
    }
    if (yieldIfNeeded && report) {
      if (await yieldIfNeeded()) {
        await report("Charting shoreline distance...", Math.min(1, (y + 1) / rows));
      }
    }
  }
}

export function findBasePoint(state: WorldState): Point {
  return selectBaseSite(state);
}

export function buildOceanMask(state: WorldState): Uint8Array {
  const { cols, rows, totalTiles } = state.grid;
  const mask = new Uint8Array(totalTiles);
  const queue = new Int32Array(totalTiles);
  let head = 0;
  let tail = 0;
  const pushIfWater = (idx: number) => {
    if (mask[idx] || state.tiles[idx].type !== "water") {
      return;
    }
    mask[idx] = 1;
    queue[tail] = idx;
    tail += 1;
  };
  for (let x = 0; x < cols; x += 1) {
    pushIfWater(x);
    pushIfWater((rows - 1) * cols + x);
  }
  for (let y = 1; y < rows - 1; y += 1) {
    pushIfWater(y * cols);
    pushIfWater(y * cols + (cols - 1));
  }
  while (head < tail) {
    const idx = queue[head];
    head += 1;
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    if (x > 0) {
      pushIfWater(idx - 1);
    }
    if (x < cols - 1) {
      pushIfWater(idx + 1);
    }
    if (y > 0) {
      pushIfWater(idx - cols);
    }
    if (y < rows - 1) {
      pushIfWater(idx + cols);
    }
  }
  return mask;
}

export function buildEdgeConnectedMask(mask: Uint8Array, cols: number, rows: number): Uint8Array {
  const total = cols * rows;
  const connected = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const push = (idx: number): void => {
    if (!mask[idx] || connected[idx]) {
      return;
    }
    connected[idx] = 1;
    queue[tail] = idx;
    tail += 1;
  };
  for (let x = 0; x < cols; x += 1) {
    push(x);
    if (rows > 1) {
      push((rows - 1) * cols + x);
    }
  }
  for (let y = 1; y < rows - 1; y += 1) {
    push(y * cols);
    if (cols > 1) {
      push(y * cols + (cols - 1));
    }
  }
  while (head < tail) {
    const idx = queue[head];
    head += 1;
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    if (x > 0) {
      push(idx - 1);
    }
    if (x < cols - 1) {
      push(idx + 1);
    }
    if (y > 0) {
      push(idx - cols);
    }
    if (y < rows - 1) {
      push(idx + cols);
    }
  }
  return connected;
}

export function buildDistanceFromMask(mask: Uint8Array, cols: number, rows: number): Uint16Array {
  const total = cols * rows;
  const unvisited = 0xffff;
  const dist = new Uint16Array(total);
  dist.fill(unvisited);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < total; i += 1) {
    if (!mask[i]) {
      continue;
    }
    dist[i] = 0;
    queue[tail] = i;
    tail += 1;
  }
  while (head < tail) {
    const idx = queue[head];
    head += 1;
    const nextDist = Math.min(0xfffe, (dist[idx] ?? 0) + 1);
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    if (x > 0) {
      const left = idx - 1;
      if (dist[left] === unvisited) {
        dist[left] = nextDist;
        queue[tail] = left;
        tail += 1;
      }
    }
    if (x < cols - 1) {
      const right = idx + 1;
      if (dist[right] === unvisited) {
        dist[right] = nextDist;
        queue[tail] = right;
        tail += 1;
      }
    }
    if (y > 0) {
      const up = idx - cols;
      if (dist[up] === unvisited) {
        dist[up] = nextDist;
        queue[tail] = up;
        tail += 1;
      }
    }
    if (y < rows - 1) {
      const down = idx + cols;
      if (dist[down] === unvisited) {
        dist[down] = nextDist;
        queue[tail] = down;
        tail += 1;
      }
    }
  }
  return dist;
}

export function clampRiverMouthDepthsToSeaLevel(
  state: WorldState,
  oceanMask: Uint8Array,
  riverMask: Uint8Array,
  seaLevelMap: ArrayLike<number>
): void {
  const cols = state.grid.cols;
  const rows = state.grid.rows;
  const total = state.grid.totalTiles;
  if (
    state.tileRiverBed.length !== total ||
    state.tileRiverSurface.length !== total
  ) {
    return;
  }
  for (let i = 0; i < total; i += 1) {
    if (riverMask[i] === 0) {
      continue;
    }
    const x = i % cols;
    const y = Math.floor(i / cols);
    let touchesOcean = false;
    if (x > 0 && oceanMask[i - 1]) {
      touchesOcean = true;
    } else if (x < cols - 1 && oceanMask[i + 1]) {
      touchesOcean = true;
    } else if (y > 0 && oceanMask[i - cols]) {
      touchesOcean = true;
    } else if (y < rows - 1 && oceanMask[i + cols]) {
      touchesOcean = true;
    }
    if (!touchesOcean) {
      continue;
    }
    const sea = seaLevelMap[i] ?? 0;
    const rawBed = state.tileRiverBed[i];
    const bed = Number.isFinite(rawBed) ? rawBed : sea - RIVER_MOUTH_MAX_BED_BELOW_SEA;
    const clampedBed = Math.max(bed, sea - RIVER_MOUTH_MAX_BED_BELOW_SEA);
    state.tileRiverBed[i] = clampedBed;
    const rawSurface = state.tileRiverSurface[i];
    const minSurface = Math.max(clampedBed + 0.002, sea + RIVER_MOUTH_SURFACE_ABOVE_SEA);
    state.tileRiverSurface[i] = Number.isFinite(rawSurface) ? Math.max(rawSurface, minSurface) : minSurface;
  }
}

const getOpenVegetationSeedAge = (
  state: WorldState,
  tile: Tile,
  type: TileType,
  x: number,
  y: number,
  meadowMask = 0,
  micro = 0.5
): number => {
  const waterInfluence = clamp(1 - tile.waterDist / 18, 0, 1);
  const meadowSuppression = 1 - clamp(meadowMask, 0, 1) * 0.45;
  const fertility =
    clamp(0.3 + tile.moisture * 0.4 + waterInfluence * 0.2 + clamp(micro, 0, 1) * 0.1, 0, 1) * meadowSuppression;
  const noise = hash2D(x, y, state.seed + 11027);
  const baseAge = 0.5 + noise * 2.5;
  if (type === "scrub") {
    return clamp(baseAge * (0.95 + fertility * 0.3), 0.5, 3);
  }
  if (type === "floodplain") {
    return clamp(baseAge * (0.9 + fertility * 0.25), 0.5, 3);
  }
  return clamp(baseAge * (0.8 + fertility * 0.25), 0.5, 3);
};

export function seedInitialVegetationState(
  state: WorldState,
  biomeSuitabilityMap?: ArrayLike<number> | null,
  microMap?: ArrayLike<number> | null,
  meadowMaskMap?: ArrayLike<number> | null,
  treeDensityMap?: ArrayLike<number> | null,
  siteQualityMap?: ArrayLike<number> | null
): void {
  const total = state.grid.totalTiles;
  const visited = new Uint8Array(total);
  const edgeDistance = new Int16Array(total);
  edgeDistance.fill(-1);
  const queue = new Int32Array(total);
  const { cols, rows } = state.grid;

  for (let i = 0; i < total; i += 1) {
    const tile = state.tiles[i];
    const x = i % cols;
    const y = Math.floor(i / cols);
    if (!isVegetationType(tile.type)) {
      clearVegetationState(tile);
      tile.dominantTreeType = null;
      tile.treeType = null;
      continue;
    }
    if (!isForestType(tile.type)) {
      tile.vegetationAgeYears = getOpenVegetationSeedAge(
        state,
        tile,
        tile.type,
        x,
        y,
        meadowMaskMap?.[i] ?? 0,
        microMap?.[i] ?? 0.5
      );
      syncDerivedVegetationState(tile, state.seed, x, y);
      const structure = getTerrainResponsiveVegetationStructure({
        worldSeed: state.seed,
        type: tile.type,
        ageYears: tile.vegetationAgeYears,
        x,
        y,
        siteQuality: siteQualityMap?.[i] ?? biomeSuitabilityMap?.[i] ?? 0.5
      });
      tile.canopy = structure.canopyCover;
      tile.canopyCover = structure.canopyCover;
      tile.stemDensity = structure.stemDensity;
      tile.dominantTreeType = null;
      tile.treeType = null;
    }
  }

  for (let i = 0; i < total; i += 1) {
    if (visited[i] || state.tiles[i].type !== "forest") {
      continue;
    }
    let head = 0;
    let tail = 0;
    const component: number[] = [];
    visited[i] = 1;
    queue[tail] = i;
    tail += 1;
    while (head < tail) {
      const idx = queue[head];
      head += 1;
      component.push(idx);
      const x = idx % cols;
      const y = Math.floor(idx / cols);
      if (x > 0) {
        const nIdx = idx - 1;
        if (!visited[nIdx] && state.tiles[nIdx].type === "forest") {
          visited[nIdx] = 1;
          queue[tail] = nIdx;
          tail += 1;
        }
      }
      if (x < cols - 1) {
        const nIdx = idx + 1;
        if (!visited[nIdx] && state.tiles[nIdx].type === "forest") {
          visited[nIdx] = 1;
          queue[tail] = nIdx;
          tail += 1;
        }
      }
      if (y > 0) {
        const nIdx = idx - cols;
        if (!visited[nIdx] && state.tiles[nIdx].type === "forest") {
          visited[nIdx] = 1;
          queue[tail] = nIdx;
          tail += 1;
        }
      }
      if (y < rows - 1) {
        const nIdx = idx + cols;
        if (!visited[nIdx] && state.tiles[nIdx].type === "forest") {
          visited[nIdx] = 1;
          queue[tail] = nIdx;
          tail += 1;
        }
      }
    }

    head = 0;
    tail = 0;
    for (let c = 0; c < component.length; c += 1) {
      const idx = component[c];
      edgeDistance[idx] = -1;
      const x = idx % cols;
      const y = Math.floor(idx / cols);
      const leftForest = x > 0 && state.tiles[idx - 1].type === "forest";
      const rightForest = x < cols - 1 && state.tiles[idx + 1].type === "forest";
      const upForest = y > 0 && state.tiles[idx - cols].type === "forest";
      const downForest = y < rows - 1 && state.tiles[idx + cols].type === "forest";
      const isEdge = !leftForest || !rightForest || !upForest || !downForest;
      if (isEdge) {
        edgeDistance[idx] = 0;
        queue[tail] = idx;
        tail += 1;
      }
    }
    if (tail === 0 && component.length > 0) {
      edgeDistance[component[0]] = 0;
      queue[tail] = component[0];
      tail += 1;
    }
    while (head < tail) {
      const idx = queue[head];
      head += 1;
      const distance = edgeDistance[idx];
      const x = idx % cols;
      const y = Math.floor(idx / cols);
      if (x > 0) {
        const nIdx = idx - 1;
        if (state.tiles[nIdx].type === "forest" && edgeDistance[nIdx] < 0) {
          edgeDistance[nIdx] = (distance + 1) as number;
          queue[tail] = nIdx;
          tail += 1;
        }
      }
      if (x < cols - 1) {
        const nIdx = idx + 1;
        if (state.tiles[nIdx].type === "forest" && edgeDistance[nIdx] < 0) {
          edgeDistance[nIdx] = (distance + 1) as number;
          queue[tail] = nIdx;
          tail += 1;
        }
      }
      if (y > 0) {
        const nIdx = idx - cols;
        if (state.tiles[nIdx].type === "forest" && edgeDistance[nIdx] < 0) {
          edgeDistance[nIdx] = (distance + 1) as number;
          queue[tail] = nIdx;
          tail += 1;
        }
      }
      if (y < rows - 1) {
        const nIdx = idx + cols;
        if (state.tiles[nIdx].type === "forest" && edgeDistance[nIdx] < 0) {
          edgeDistance[nIdx] = (distance + 1) as number;
          queue[tail] = nIdx;
          tail += 1;
        }
      }
    }

    for (let c = 0; c < component.length; c += 1) {
      const idx = component[c];
      const x = idx % cols;
      const y = Math.floor(idx / cols);
      const tile = state.tiles[idx];
      let forestNeighbors = 0;
      if (x > 0 && state.tiles[idx - 1].type === "forest") {
        forestNeighbors += 1;
      }
      if (x < cols - 1 && state.tiles[idx + 1].type === "forest") {
        forestNeighbors += 1;
      }
      if (y > 0 && state.tiles[idx - cols].type === "forest") {
        forestNeighbors += 1;
      }
      if (y < rows - 1 && state.tiles[idx + cols].type === "forest") {
        forestNeighbors += 1;
      }

      const suitability =
        biomeSuitabilityMap?.[idx] ??
        clamp(0.28 + tile.moisture * 0.42 + (1 - tile.elevation) * 0.18, 0, 1);
      const treeDensity = clamp(treeDensityMap?.[idx] ?? suitability, 0, 1);
      const micro = clamp(microMap?.[idx] ?? 0.5, 0, 1);
      const edgeDepth = Math.max(0, edgeDistance[idx]);
      const edgeDepth01 = clamp(edgeDepth / 3.5, 0, 1);
      const interiorBias = clamp((forestNeighbors - 1) / 3, 0, 1);
      const maturityBias = clamp(edgeDepth01 * 0.54 + interiorBias * 0.1 + suitability * 0.12 + treeDensity * 0.18 + micro * 0.06, 0, 1);
      const edgeAge = FOREST_AGE_CAP_YEARS * (0.18 + hash2D(x, y, state.seed + 12031) * 0.22);
      const upperAge = FOREST_AGE_CAP_YEARS * (0.48 + hash2D(x, y, state.seed + 12067) * 0.38);
      tile.vegetationAgeYears = clamp(edgeAge * (1 - maturityBias) + upperAge * maturityBias, 0, FOREST_AGE_CAP_YEARS);
      syncDerivedVegetationState(tile, state.seed, x, y);
      const structure = getTerrainResponsiveVegetationStructure({
        worldSeed: state.seed,
        type: tile.type,
        ageYears: tile.vegetationAgeYears,
        x,
        y,
        siteQuality: siteQualityMap?.[idx] ?? suitability
      });
      tile.canopy = structure.canopyCover;
      tile.canopyCover = structure.canopyCover;
      tile.stemDensity = structure.stemDensity;
    }
  }
}

export function countMaskTiles(mask: Uint8Array): number {
  let total = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i]) {
      total += 1;
    }
  }
  return total;
}

export function countEdgeMaskTiles(mask: Uint8Array, cols: number, rows: number): number {
  let total = 0;
  for (let x = 0; x < cols; x += 1) {
    if (mask[x]) {
      total += 1;
    }
    const bottom = (rows - 1) * cols + x;
    if (rows > 1 && mask[bottom]) {
      total += 1;
    }
  }
  for (let y = 1; y < rows - 1; y += 1) {
    const left = y * cols;
    if (mask[left]) {
      total += 1;
    }
    const right = left + (cols - 1);
    if (cols > 1 && mask[right]) {
      total += 1;
    }
  }
  return total;
}

export function enforceEdgeOceanMask(
  state: WorldState,
  elevationMap: number[],
  seaLevelMap: Float32Array,
  oceanMask: Uint8Array,
  riverMask: Uint8Array
): Uint8Array {
  const { cols, rows, totalTiles } = state.grid;
  if (countEdgeMaskTiles(oceanMask, cols, rows) > 0) {
    return oceanMask;
  }
  const forced = Uint8Array.from(oceanMask);
  const edgeBand = 2;
  let added = 0;
  for (let y = 0; y < rows; y += 1) {
    const rowBase = y * cols;
    for (let x = 0; x < cols; x += 1) {
      const edgeDist = Math.min(x, y, cols - 1 - x, rows - 1 - y);
      if (edgeDist >= edgeBand) {
        continue;
      }
      const idx = rowBase + x;
      if (riverMask[idx] > 0) {
        continue;
      }
      const localSea = seaLevelMap[idx] ?? 0;
      const elev = elevationMap[idx] ?? 0;
      const margin = edgeDist === 0 ? 0.08 : 0.04;
      if (elev <= localSea + margin) {
        forced[idx] = 1;
        if (elev > localSea) {
          elevationMap[idx] = localSea;
          state.tiles[idx].elevation = localSea;
        }
        added += 1;
      }
    }
  }
  if (added > 0) {
    return forced;
  }
  // Hard fallback: seed the perimeter as ocean and clamp elevations to local sea.
  const setPerimeter = (idx: number): void => {
    if (riverMask[idx] > 0) {
      return;
    }
    forced[idx] = 1;
    const localSea = seaLevelMap[idx] ?? 0;
    const target = Math.min(elevationMap[idx] ?? localSea, localSea);
    elevationMap[idx] = target;
    state.tiles[idx].elevation = target;
  };
  for (let x = 0; x < cols; x += 1) {
    setPerimeter(x);
    if (rows > 1) {
      setPerimeter((rows - 1) * cols + x);
    }
  }
  for (let y = 1; y < rows - 1; y += 1) {
    setPerimeter(y * cols);
    if (cols > 1) {
      setPerimeter(y * cols + (cols - 1));
    }
  }
  return forced;
}

export function buildLargestWaterMask(state: WorldState): Uint8Array {
  const { cols, rows, totalTiles } = state.grid;
  const component = new Int32Array(totalTiles);
  component.fill(-1);
  const queue = new Int32Array(totalTiles);
  const sizes: number[] = [];
  let componentId = 0;
  for (let i = 0; i < totalTiles; i += 1) {
    if (component[i] !== -1 || state.tiles[i].type !== "water") {
      continue;
    }
    let head = 0;
    let tail = 0;
    queue[tail] = i;
    tail += 1;
    component[i] = componentId;
    let size = 0;
    while (head < tail) {
      const idx = queue[head];
      head += 1;
      size += 1;
      const x = idx % cols;
      const y = Math.floor(idx / cols);
      if (x > 0) {
        const nIdx = idx - 1;
        if (component[nIdx] === -1 && state.tiles[nIdx].type === "water") {
          component[nIdx] = componentId;
          queue[tail] = nIdx;
          tail += 1;
        }
      }
      if (x < cols - 1) {
        const nIdx = idx + 1;
        if (component[nIdx] === -1 && state.tiles[nIdx].type === "water") {
          component[nIdx] = componentId;
          queue[tail] = nIdx;
          tail += 1;
        }
      }
      if (y > 0) {
        const nIdx = idx - cols;
        if (component[nIdx] === -1 && state.tiles[nIdx].type === "water") {
          component[nIdx] = componentId;
          queue[tail] = nIdx;
          tail += 1;
        }
      }
      if (y < rows - 1) {
        const nIdx = idx + cols;
        if (component[nIdx] === -1 && state.tiles[nIdx].type === "water") {
          component[nIdx] = componentId;
          queue[tail] = nIdx;
          tail += 1;
        }
      }
    }
    sizes[componentId] = size;
    componentId += 1;
  }
  const mask = new Uint8Array(totalTiles);
  if (componentId === 0) {
    return mask;
  }
  let largestId = 0;
  for (let i = 1; i < componentId; i += 1) {
    if ((sizes[i] ?? 0) > (sizes[largestId] ?? 0)) {
      largestId = i;
    }
  }
  for (let i = 0; i < totalTiles; i += 1) {
    if (component[i] === largestId) {
      mask[i] = 1;
    }
  }
  return mask;
}

function buildSeaLevelMap(
  state: WorldState,
  settings: MapGenSettings,
  cellSizeM: number,
  seaLevelBase: number
): Float32Array {
  void cellSizeM;
  const seaLevelMap = new Float32Array(state.grid.totalTiles);
  const seaLevel = clampSeaLevel(seaLevelBase, settings);
  for (let y = 0; y < state.grid.rows; y += 1) {
    const rowBase = y * state.grid.cols;
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = rowBase + x;
      seaLevelMap[idx] = seaLevel;
    }
  }
  return seaLevelMap;
}

export function buildOceanMaskFromElevation(
  state: WorldState,
  elevationMap: ArrayLike<number>,
  seaLevelMap: ArrayLike<number>
): Uint8Array {
  const { cols, rows, totalTiles } = state.grid;
  const waterMask = new Uint8Array(totalTiles);
  for (let y = 0; y < rows; y += 1) {
    const rowBase = y * cols;
    for (let x = 0; x < cols; x += 1) {
      const idx = rowBase + x;
      const localSea = seaLevelMap[idx] ?? 0;
      const elev = elevationMap[idx] ?? 0;
      // `elevationMap` is already the post-falloff terrain surface. Re-applying
      // edge attenuation here pushes ocean membership inland onto tiles that are
      // still visibly high above sea level.
      if (elev <= localSea + COAST_LOCAL_SEA_MARGIN) {
        waterMask[idx] = 1;
      }
    }
  }
  const mask = new Uint8Array(totalTiles);
  const queue = new Int32Array(totalTiles);
  let head = 0;
  let tail = 0;
  const pushIfWater = (idx: number) => {
    if (mask[idx] || waterMask[idx] === 0) {
      return;
    }
    mask[idx] = 1;
    queue[tail] = idx;
    tail += 1;
  };
  for (let x = 0; x < cols; x += 1) {
    pushIfWater(x);
    pushIfWater((rows - 1) * cols + x);
  }
  for (let y = 1; y < rows - 1; y += 1) {
    pushIfWater(y * cols);
    pushIfWater(y * cols + (cols - 1));
  }
  while (head < tail) {
    const idx = queue[head];
    head += 1;
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    if (x > 0) {
      pushIfWater(idx - 1);
    }
    if (x < cols - 1) {
      pushIfWater(idx + 1);
    }
    if (y > 0) {
      pushIfWater(idx - cols);
    }
    if (y < rows - 1) {
      pushIfWater(idx + cols);
    }
  }
  return mask;
}

export function computeOceanLevel(
  elevationMap: ArrayLike<number>,
  oceanMask: Uint8Array,
  riverMask?: Uint8Array
): number | null {
  const bins = 32;
  const counts = new Uint32Array(bins);
  const sums = new Float32Array(bins);
  let total = 0;
  for (let i = 0; i < oceanMask.length; i += 1) {
    if (!oceanMask[i] || (riverMask && riverMask[i] > 0)) {
      continue;
    }
    const height = clamp(elevationMap[i] ?? 0, 0, 1);
    const bin = Math.min(bins - 1, Math.floor(height * (bins - 1)));
    counts[bin] += 1;
    sums[bin] += height;
    total += 1;
  }
  if (total === 0) {
    return null;
  }
  if (total < 8) {
    const sum = sums.reduce((acc, value) => acc + value, 0);
    return clamp(sum / total, 0, 1);
  }
  const target = Math.max(1, Math.ceil(total * 0.25));
  let taken = 0;
  let sum = 0;
  let count = 0;
  for (let bin = bins - 1; bin >= 0; bin -= 1) {
    const binCount = counts[bin];
    if (binCount === 0) {
      continue;
    }
    const take = Math.min(binCount, target - taken);
    const avg = sums[bin] / binCount;
    sum += avg * take;
    count += take;
    taken += take;
    if (taken >= target) {
      break;
    }
  }
  return count > 0 ? clamp(sum / count, 0, 1) : null;
}

export function expandOceanMaskByElevation(
  state: WorldState,
  elevationMap: ArrayLike<number>,
  seaLevelMap: ArrayLike<number>,
  oceanMask: Uint8Array,
  riverMask: Uint8Array | undefined,
  seaLevel: number
): Uint8Array {
  const { cols, rows, totalTiles } = state.grid;
  const mask = Uint8Array.from(oceanMask);
  const queue = new Int32Array(totalTiles);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < totalTiles; i += 1) {
    if (mask[i]) {
      queue[tail] = i;
      tail += 1;
    }
  }
  while (head < tail) {
    const idx = queue[head];
    head += 1;
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    const isRiver = riverMask && riverMask[idx] > 0;
    const tryPush = (nIdx: number) => {
      if (mask[nIdx]) {
        return;
      }
      if (riverMask && riverMask[nIdx] > 0) {
        mask[nIdx] = 1;
        queue[tail] = nIdx;
        tail += 1;
        return;
      }
      if (isRiver) {
        return;
      }
      const localSea = seaLevelMap[nIdx] ?? seaLevel;
      const elev = elevationMap[nIdx] ?? 0;
      const threshold = Math.max(seaLevel, localSea);
      if (elev < threshold) {
        mask[nIdx] = 1;
        queue[tail] = nIdx;
        tail += 1;
      }
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
  return mask;
}

type RoadSegmentTrace = {
  indices: number[];
  loop: boolean;
};

type ShortBridgeApproachComponent = {
  tiles: number[];
  connectorRoads: number[];
};

const ROAD_GRADE_TARGET_LIMIT = 0.16;
const ROAD_GRADE_CHANGE_TARGET_LIMIT = 0.09;
const ROAD_FINAL_MAX_ANGLE_DEG = 40;
const ROAD_FINAL_STRUCTURE_MAX_ANGLE_DEG = 24;
const ROAD_FINAL_ANGLE_RELAX_PASSES = 5;
const ROAD_SHOULDER_BLEND_RADIUS = 1;
const ROAD_WALL_DROP_THRESHOLD = 0.09;
const ROAD_WALL_OUTER_DROP_THRESHOLD = 0.11;
const ROAD_LAKE_LIP_CLEARANCE = 0.012;
const ROAD_LAKE_LIP_SEARCH_RADIUS = 3;
const ROAD_LAKE_LIP_SHELF_RADIUS = 3;
const ROAD_PROFILE_MAX_FILL = 0.01;
const ROAD_PROFILE_MAX_CUT = 0.032;
const ROAD_PROFILE_STRAIGHT_MAX_FILL = 0.01;
const ROAD_PROFILE_STRAIGHT_MAX_CUT = 0.024;
const ROAD_SHOULDER_MAX_FILL_NEAR = 0.008;
const ROAD_SHOULDER_MAX_FILL_FAR = 0.004;
const ROAD_SHOULDER_MAX_CUT_NEAR = 0.018;
const ROAD_SHOULDER_MAX_CUT_FAR = 0.01;
const ROAD_HIGH_RELIEF_SHOULDER_TRIGGER = 0.024;
const ROAD_HIGH_RELIEF_SHOULDER_RADIUS = 2;
const ROAD_HIGH_RELIEF_SHOULDER_INNER_CUT = 0.095;
const ROAD_HIGH_RELIEF_SHOULDER_INNER_FILL = 0.055;
const ROAD_HIGH_RELIEF_SHOULDER_OUTER_CUT = 0.065;
const ROAD_HIGH_RELIEF_SHOULDER_OUTER_FILL = 0.03;
const SHORT_BRIDGE_APPROACH_MAX_COMPONENT_TILES = 2;
const SHORT_BRIDGE_APPROACH_MAX_CONNECTOR_DISTANCE = 3.1;

const isRoadLikeIndex = (state: WorldState, idx: number): boolean => {
  const type = state.tiles[idx]?.type;
  return type === "road" || type === "base" || state.tileRoadBridge[idx] > 0;
};

const isLandRoadLikeIndex = (state: WorldState, idx: number): boolean =>
  isRoadLikeIndex(state, idx) && state.tiles[idx]?.type !== "water";

const getNearbyRoadLakeSurface = (state: WorldState, idx: number): number | null => {
  const x = idx % state.grid.cols;
  const y = Math.floor(idx / state.grid.cols);
  let bestSurface = Number.NaN;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let dy = -ROAD_LAKE_LIP_SEARCH_RADIUS; dy <= ROAD_LAKE_LIP_SEARCH_RADIUS; dy += 1) {
    for (let dx = -ROAD_LAKE_LIP_SEARCH_RADIUS; dx <= ROAD_LAKE_LIP_SEARCH_RADIUS; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const neighborIdx = indexFor(state.grid, nx, ny);
      const neighbor = state.tiles[neighborIdx];
      if ((state.tileLakeMask[neighborIdx] ?? 0) === 0 && neighbor?.type !== "water") {
        continue;
      }
      const surface = state.tileLakeSurface[neighborIdx] ?? neighbor?.elevation ?? Number.NaN;
      if (!Number.isFinite(surface)) {
        continue;
      }
      const distance = Math.hypot(dx, dy);
      if (distance < bestDistance || (distance === bestDistance && surface > bestSurface)) {
        bestSurface = surface;
        bestDistance = distance;
      }
    }
  }
  return Number.isFinite(bestSurface) ? bestSurface : null;
};

const getRoadLakeLipMinElevation = (state: WorldState, idx: number): number => {
  if (!isLandRoadLikeIndex(state, idx) || state.tileRoadBridge[idx] > 0 || state.tiles[idx]?.type !== "road") {
    return 0;
  }
  const surface = getNearbyRoadLakeSurface(state, idx);
  return surface === null ? 0 : Math.min(1, surface + ROAD_LAKE_LIP_CLEARANCE);
};

const enforceRoadLakeLipClearance = (state: WorldState): void => {
  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    const minElevation = getRoadLakeLipMinElevation(state, idx);
    if (minElevation <= 0) {
      continue;
    }
    const tile = state.tiles[idx];
    if (!tile || tile.elevation >= minElevation) {
      continue;
    }
    tile.elevation = minElevation;
    state.tileElevation[idx] = minElevation;
  }
};

const terraceRoadLakeLipShoulders = (state: WorldState): void => {
  const targetByIdx = new Float32Array(state.grid.totalTiles);
  const weightByIdx = new Float32Array(state.grid.totalTiles);
  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    if (!isLandRoadLikeIndex(state, idx) || state.tileRoadBridge[idx] > 0 || state.tiles[idx]?.type !== "road") {
      continue;
    }
    const surface = getNearbyRoadLakeSurface(state, idx);
    if (surface === null) {
      continue;
    }
    const roadElevation = state.tiles[idx]?.elevation ?? surface + ROAD_LAKE_LIP_CLEARANCE;
    const x = idx % state.grid.cols;
    const y = Math.floor(idx / state.grid.cols);
    for (let dy = -ROAD_LAKE_LIP_SHELF_RADIUS; dy <= ROAD_LAKE_LIP_SHELF_RADIUS; dy += 1) {
      for (let dx = -ROAD_LAKE_LIP_SHELF_RADIUS; dx <= ROAD_LAKE_LIP_SHELF_RADIUS; dx += 1) {
        if (dx === 0 && dy === 0) {
          continue;
        }
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(state.grid, nx, ny)) {
          continue;
        }
        const neighborIdx = indexFor(state.grid, nx, ny);
        if (isRoadLikeIndex(state, neighborIdx)) {
          continue;
        }
        const neighbor = state.tiles[neighborIdx];
        if (
          !neighbor ||
          neighbor.type === "water" ||
          neighbor.type === "house" ||
          neighbor.type === "base" ||
          state.structureMask[neighborIdx] > 0
        ) {
          continue;
        }
        const neighborSurface = getNearbyRoadLakeSurface(state, neighborIdx);
        const nearLake = neighborSurface !== null;
        if (!nearLake) {
          continue;
        }
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        if (distance > ROAD_LAKE_LIP_SHELF_RADIUS) {
          continue;
        }
        const innerShelf = distance <= 1;
        const target = innerShelf
          ? roadElevation
          : neighbor.elevation * 0.5 + roadElevation * 0.5;
        const weight = innerShelf ? 1 : 0.38;
        targetByIdx[neighborIdx] += target * weight;
        weightByIdx[neighborIdx] += weight;
      }
    }
  }
  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    const weight = weightByIdx[idx] ?? 0;
    if (weight <= 0) {
      continue;
    }
    const tile = state.tiles[idx];
    if (!tile || tile.type === "house" || tile.type === "base" || isRoadLikeIndex(state, idx)) {
      continue;
    }
    const target = targetByIdx[idx] / Math.max(1e-6, weight);
    const blend = 1;
    const elevation = clamp(tile.elevation * (1 - blend) + target * blend, 0, 1);
    tile.elevation = elevation;
    state.tileElevation[idx] = elevation;
  }
};

const measureRoadShoulderRelief = (state: WorldState, idx: number): number => {
  if (!isLandRoadLikeIndex(state, idx)) {
    return 0;
  }
  const roadElevation = state.tiles[idx]?.elevation ?? 0;
  const x = idx % state.grid.cols;
  const y = Math.floor(idx / state.grid.cols);
  let relief = 0;
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
      const neighborIdx = indexFor(state.grid, nx, ny);
      if (isRoadLikeIndex(state, neighborIdx)) {
        continue;
      }
      const neighbor = state.tiles[neighborIdx];
      if (!neighbor || neighbor.type === "water" || neighbor.type === "house" || neighbor.type === "base") {
        continue;
      }
      relief = Math.max(relief, Math.abs((neighbor.elevation ?? roadElevation) - roadElevation));
    }
  }
  return relief;
};

const relaxHighReliefRoadShoulders = (state: WorldState): void => {
  const total = state.grid.totalTiles;
  const targetSum = new Float32Array(total);
  const targetWeight = new Float32Array(total);
  const maxCutByIdx = new Float32Array(total);
  const maxFillByIdx = new Float32Array(total);

  for (let idx = 0; idx < total; idx += 1) {
    if (!isLandRoadLikeIndex(state, idx) || state.tileRoadBridge[idx] > 0) {
      continue;
    }
    const shoulderRelief = measureRoadShoulderRelief(state, idx);
    const nearLake = getNearbyRoadLakeSurface(state, idx) !== null;
    if (shoulderRelief < ROAD_HIGH_RELIEF_SHOULDER_TRIGGER && !nearLake) {
      continue;
    }
    const roadElevation = state.tiles[idx]?.elevation ?? 0;
    const x = idx % state.grid.cols;
    const y = Math.floor(idx / state.grid.cols);
    for (let dy = -ROAD_HIGH_RELIEF_SHOULDER_RADIUS; dy <= ROAD_HIGH_RELIEF_SHOULDER_RADIUS; dy += 1) {
      for (let dx = -ROAD_HIGH_RELIEF_SHOULDER_RADIUS; dx <= ROAD_HIGH_RELIEF_SHOULDER_RADIUS; dx += 1) {
        if (dx === 0 && dy === 0) {
          continue;
        }
        const distance = Math.hypot(dx, dy);
        if (distance > ROAD_HIGH_RELIEF_SHOULDER_RADIUS + 0.01) {
          continue;
        }
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(state.grid, nx, ny)) {
          continue;
        }
        const neighborIdx = indexFor(state.grid, nx, ny);
        if (isRoadLikeIndex(state, neighborIdx)) {
          continue;
        }
        const neighbor = state.tiles[neighborIdx];
        if (
          !neighbor ||
          neighbor.type === "water" ||
          neighbor.type === "house" ||
          neighbor.type === "base" ||
          state.structureMask[neighborIdx] > 0
        ) {
          continue;
        }
        const inner = distance <= 1.05;
        const weight = inner ? 1 : 0.72;
        targetSum[neighborIdx] += roadElevation * weight;
        targetWeight[neighborIdx] += weight;
        maxCutByIdx[neighborIdx] = Math.max(
          maxCutByIdx[neighborIdx] ?? 0,
          inner ? ROAD_HIGH_RELIEF_SHOULDER_INNER_CUT : ROAD_HIGH_RELIEF_SHOULDER_OUTER_CUT
        );
        maxFillByIdx[neighborIdx] = Math.max(
          maxFillByIdx[neighborIdx] ?? 0,
          inner ? ROAD_HIGH_RELIEF_SHOULDER_INNER_FILL : ROAD_HIGH_RELIEF_SHOULDER_OUTER_FILL
        );
      }
    }
  }

  for (let idx = 0; idx < total; idx += 1) {
    const weight = targetWeight[idx] ?? 0;
    if (weight <= 0) {
      continue;
    }
    const tile = state.tiles[idx];
    if (!tile || tile.type === "water" || tile.type === "house" || tile.type === "base" || isRoadLikeIndex(state, idx)) {
      continue;
    }
    const target = targetSum[idx] / Math.max(1e-6, weight);
    const maxCut = maxCutByIdx[idx] ?? ROAD_HIGH_RELIEF_SHOULDER_OUTER_CUT;
    const maxFill = maxFillByIdx[idx] ?? ROAD_HIGH_RELIEF_SHOULDER_OUTER_FILL;
    const clampedTarget = clamp(target, tile.elevation - maxCut, tile.elevation + maxFill);
    const blend = Math.min(1, weight * 0.88);
    const elevation = clamp(tile.elevation * (1 - blend) + clampedTarget * blend, 0, 1);
    tile.elevation = elevation;
    state.tileElevation[idx] = elevation;
  }
};

const countEdgeBits = (mask: number): number => {
  let count = 0;
  for (let bits = mask; bits !== 0; bits &= bits - 1) {
    count += 1;
  }
  return count;
};

const getRoadMaskAtIndex = (state: WorldState, idx: number, landOnly: boolean): number => {
  if (!(landOnly ? isLandRoadLikeIndex(state, idx) : isRoadLikeIndex(state, idx))) {
    return 0;
  }
  const cols = state.grid.cols;
  const x = idx % cols;
  const y = Math.floor(idx / cols);
  const stored = state.tileRoadEdges[idx] ?? 0;
  let mask = 0;
  if (stored !== 0) {
    for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
      const dir = ROAD_EDGE_DIRS[i];
      if ((stored & dir.bit) === 0) {
        continue;
      }
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const neighborIdx = indexFor(state.grid, nx, ny);
      if (!(landOnly ? isLandRoadLikeIndex(state, neighborIdx) : isRoadLikeIndex(state, neighborIdx))) {
        continue;
      }
      mask |= dir.bit;
    }
    if (mask !== 0) {
      return mask;
    }
  }
  for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
    const dir = ROAD_EDGE_DIRS[i];
    const nx = x + dir.dx;
    const ny = y + dir.dy;
    if (!inBounds(state.grid, nx, ny)) {
      continue;
    }
    const neighborIdx = indexFor(state.grid, nx, ny);
    if (landOnly ? isLandRoadLikeIndex(state, neighborIdx) : isRoadLikeIndex(state, neighborIdx)) {
      mask |= dir.bit;
    }
  }
  return mask;
};

const touchesStructurePad = (state: WorldState, idx: number): boolean => {
  const cols = state.grid.cols;
  const x = idx % cols;
  const y = Math.floor(idx / cols);
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
      const neighbor = state.tiles[indexFor(state.grid, nx, ny)];
      if (!neighbor) {
        continue;
      }
      if (neighbor.type === "house" || neighbor.type === "base") {
        return true;
      }
    }
  }
  return false;
};

const traceRoadSegment = (
  state: WorldState,
  startIdx: number,
  startDirIndex: number,
  landMaskByIdx: Uint8Array,
  anchorMask: Uint8Array,
  visitedEdges: Uint8Array
): RoadSegmentTrace => {
  const segment = [startIdx];
  let currentIdx = startIdx;
  let dir = ROAD_EDGE_DIRS[startDirIndex];
  let loop = false;
  while (dir) {
    const cols = state.grid.cols;
    const x = currentIdx % cols;
    const y = Math.floor(currentIdx / cols);
    const nextX = x + dir.dx;
    const nextY = y + dir.dy;
    if (!inBounds(state.grid, nextX, nextY)) {
      break;
    }
    const nextIdx = indexFor(state.grid, nextX, nextY);
    visitedEdges[currentIdx] |= dir.bit;
    visitedEdges[nextIdx] |= dir.opposite;
    if (nextIdx === startIdx) {
      loop = true;
      break;
    }
    segment.push(nextIdx);
    if (anchorMask[nextIdx] > 0) {
      break;
    }
    const nextMask = landMaskByIdx[nextIdx] ?? 0;
    let nextDir: (typeof ROAD_EDGE_DIRS)[number] | null = null;
    for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
      const candidate = ROAD_EDGE_DIRS[i];
      if ((nextMask & candidate.bit) === 0 || candidate.bit === dir.opposite) {
        continue;
      }
      nextDir = candidate;
      break;
    }
    if (!nextDir) {
      break;
    }
    currentIdx = nextIdx;
    dir = nextDir;
  }
  return { indices: segment, loop };
};

const collectShortBridgeApproachComponents = (state: WorldState): ShortBridgeApproachComponent[] => {
  const total = state.grid.totalTiles;
  const visited = new Uint8Array(total);
  const components: ShortBridgeApproachComponent[] = [];
  for (let idx = 0; idx < total; idx += 1) {
    if (state.tileRoadBridge[idx] === 0 || visited[idx] > 0) {
      continue;
    }
    const tiles: number[] = [];
    const connectorRoads: number[] = [];
    const connectorSeen = new Set<number>();
    const queue = [idx];
    visited[idx] = 1;
    for (let head = 0; head < queue.length; head += 1) {
      const currentIdx = queue[head]!;
      tiles.push(currentIdx);
      const x = currentIdx % state.grid.cols;
      const y = Math.floor(currentIdx / state.grid.cols);
      const mask = getRoadMaskAtIndex(state, currentIdx, false);
      for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
        const dir = ROAD_EDGE_DIRS[i]!;
        if ((mask & dir.bit) === 0) {
          continue;
        }
        const nx = x + dir.dx;
        const ny = y + dir.dy;
        if (!inBounds(state.grid, nx, ny)) {
          continue;
        }
        const neighborIdx = indexFor(state.grid, nx, ny);
        if (state.tileRoadBridge[neighborIdx] > 0) {
          if (visited[neighborIdx] === 0) {
            visited[neighborIdx] = 1;
            queue.push(neighborIdx);
          }
          continue;
        }
        if (!isLandRoadLikeIndex(state, neighborIdx) || connectorSeen.has(neighborIdx)) {
          continue;
        }
        connectorSeen.add(neighborIdx);
        connectorRoads.push(neighborIdx);
      }
    }
    components.push({ tiles, connectorRoads });
  }
  return components;
};

const prepareShortBridgeApproaches = (state: WorldState): void => {
  const components = collectShortBridgeApproachComponents(state);
  for (let i = 0; i < components.length; i += 1) {
    const component = components[i]!;
    if (
      component.tiles.length === 0 ||
      component.tiles.length > SHORT_BRIDGE_APPROACH_MAX_COMPONENT_TILES ||
      component.connectorRoads.length !== 2
    ) {
      continue;
    }
    const startRoadIdx = component.connectorRoads[0]!;
    const endRoadIdx = component.connectorRoads[1]!;
    const startX = startRoadIdx % state.grid.cols;
    const startY = Math.floor(startRoadIdx / state.grid.cols);
    const endX = endRoadIdx % state.grid.cols;
    const endY = Math.floor(endRoadIdx / state.grid.cols);
    if (Math.hypot(startX - endX, startY - endY) > SHORT_BRIDGE_APPROACH_MAX_CONNECTOR_DISTANCE) {
      continue;
    }
    const startTile = state.tiles[startRoadIdx];
    const endTile = state.tiles[endRoadIdx];
    if (!startTile || !endTile || startTile.type === "water" || endTile.type === "water") {
      continue;
    }
    const startMin = Math.max(0, startTile.elevation - ROAD_PROFILE_MAX_CUT);
    const startMax = Math.min(1, startTile.elevation + ROAD_PROFILE_MAX_FILL);
    const endMin = Math.max(0, endTile.elevation - ROAD_PROFILE_MAX_CUT);
    const endMax = Math.min(1, endTile.elevation + ROAD_PROFILE_MAX_FILL);
    const commonMin = Math.max(startMin, endMin);
    const commonMax = Math.min(startMax, endMax);
    if (commonMin > commonMax) {
      continue;
    }
    const targetElevation = clamp((startTile.elevation + endTile.elevation) * 0.5, commonMin, commonMax);
    startTile.elevation = targetElevation;
    endTile.elevation = targetElevation;
  }
};

const buildRoadSegmentProfile = (
  state: WorldState,
  indices: number[],
  loop: boolean,
  originalElevations: Float32Array,
  heightScaleMultiplier = 1
): number[] => {
  if (indices.length <= 1) {
    return indices.map((idx) => state.tiles[idx]?.elevation ?? 0);
  }
  const original = indices.map((idx) => state.tiles[idx]?.elevation ?? 0);
  const elevationToGradeScale = getTerrainHeightScale(state.grid.cols, state.grid.rows, heightScaleMultiplier);
  const gradeTargetLimit = ROAD_GRADE_TARGET_LIMIT / Math.max(1e-6, elevationToGradeScale);
  const gradeChangeTargetLimit = ROAD_GRADE_CHANGE_TARGET_LIMIT / Math.max(1e-6, elevationToGradeScale);
  const runs = new Array<number>(indices.length - 1);
  const cumulative = new Array<number>(indices.length).fill(0);
  let totalRun = 0;
  let directionChanges = 0;
  let previousDx = 0;
  let previousDy = 0;
  for (let i = 1; i < indices.length; i += 1) {
    const prevIdx = indices[i - 1];
    const idx = indices[i];
    const prevX = prevIdx % state.grid.cols;
    const prevY = Math.floor(prevIdx / state.grid.cols);
    const x = idx % state.grid.cols;
    const y = Math.floor(idx / state.grid.cols);
    const stepDx = Math.sign(x - prevX);
    const stepDy = Math.sign(y - prevY);
    if (i > 1 && (stepDx !== previousDx || stepDy !== previousDy)) {
      directionChanges += 1;
    }
    previousDx = stepDx;
    previousDy = stepDy;
    const run = Math.hypot(x - prevX, y - prevY);
    runs[i - 1] = Math.max(1, run);
    totalRun += runs[i - 1];
    cumulative[i] = totalRun;
  }
  const isLongStraightSegment = !loop && indices.length >= 7 && directionChanges <= 1;

  let target = original.slice();
  if (!loop) {
    const start = original[0];
    const end = original[original.length - 1];
    const linearWeight = totalRun > 18 ? 0.18 : totalRun > 10 ? 0.28 : 0.42;
    for (let i = 1; i < target.length - 1; i += 1) {
      const t = totalRun > 1e-6 ? cumulative[i] / totalRun : i / Math.max(1, target.length - 1);
      const linear = start * (1 - t) + end * t;
      target[i] = clamp(original[i] * (1 - linearWeight) + linear * linearWeight, 0, 1);
    }
  } else {
    const mean = original.reduce((sum, value) => sum + value, 0) / Math.max(1, original.length);
    for (let i = 0; i < target.length; i += 1) {
      target[i] = clamp(original[i] * 0.74 + mean * 0.26, 0, 1);
    }
  }

  const smoothPasses = loop ? 2 : totalRun > 18 ? 1 : 2;
  for (let pass = 0; pass < smoothPasses; pass += 1) {
    const next = target.slice();
    const startIndex = loop ? 0 : 1;
    const endIndex = loop ? target.length : target.length - 1;
    for (let i = startIndex; i < endIndex; i += 1) {
      const prevIndex = loop ? (i + target.length - 1) % target.length : i - 1;
      const nextIndex = loop ? (i + 1) % target.length : i + 1;
      const prevValue = target[prevIndex] ?? target[i];
      const nextValue = target[nextIndex] ?? target[i];
      next[i] = clamp(target[i] * 0.64 + (prevValue + nextValue) * 0.18, 0, 1);
    }
    target = next;
  }

  if (!loop) {
    const forward = target.slice();
    let prevSlope: number | null = null;
    for (let i = 1; i < forward.length; i += 1) {
      let slope = (forward[i] - forward[i - 1]) / runs[i - 1];
      slope = clamp(slope, -gradeTargetLimit, gradeTargetLimit);
      if (prevSlope !== null) {
        slope = clamp(
          slope,
          prevSlope - gradeChangeTargetLimit,
          prevSlope + gradeChangeTargetLimit
        );
      }
      forward[i] = clamp(forward[i - 1] + slope * runs[i - 1], 0, 1);
      prevSlope = slope;
    }

    const backward = target.slice();
    prevSlope = null;
    for (let i = backward.length - 2; i >= 0; i -= 1) {
      let slope = (backward[i + 1] - backward[i]) / runs[i];
      slope = clamp(slope, -gradeTargetLimit, gradeTargetLimit);
      if (prevSlope !== null) {
        slope = clamp(
          slope,
          prevSlope - gradeChangeTargetLimit,
          prevSlope + gradeChangeTargetLimit
        );
      }
      backward[i] = clamp(backward[i + 1] - slope * runs[i], 0, 1);
      prevSlope = slope;
    }

    for (let i = 1; i < target.length - 1; i += 1) {
      const t = totalRun > 1e-6 ? cumulative[i] / totalRun : i / Math.max(1, target.length - 1);
      target[i] = clamp(forward[i] * (1 - t) + backward[i] * t, 0, 1);
    }
    target[0] = original[0];
    target[target.length - 1] = original[original.length - 1];
  } else {
    let prevSlope = 0;
    for (let i = 1; i < target.length; i += 1) {
      let slope = (target[i] - target[i - 1]) / runs[i - 1];
      slope = clamp(slope, -gradeTargetLimit, gradeTargetLimit);
      slope = clamp(slope, prevSlope - gradeChangeTargetLimit, prevSlope + gradeChangeTargetLimit);
      target[i] = clamp(target[i - 1] + slope * runs[i - 1], 0, 1);
      prevSlope = slope;
    }
  }

  for (let i = 0; i < target.length; i += 1) {
    const idx = indices[i];
    const originalElevation = originalElevations[idx] ?? original[i];
    const maxCut = isLongStraightSegment ? ROAD_PROFILE_STRAIGHT_MAX_CUT : ROAD_PROFILE_MAX_CUT;
    const maxFill = isLongStraightSegment ? ROAD_PROFILE_STRAIGHT_MAX_FILL : ROAD_PROFILE_MAX_FILL;
    const minElevation = Math.max(0, originalElevation - maxCut);
    const maxElevation = Math.min(1, originalElevation + maxFill);
    target[i] = clamp(target[i], minElevation, maxElevation);
  }

  return target;
};

const reconcileHighAngleRoadEdges = (state: WorldState, heightScaleMultiplier = 1): void => {
  const elevationScale = getTerrainHeightScale(state.grid.cols, state.grid.rows, heightScaleMultiplier);
  for (let pass = 0; pass < ROAD_FINAL_ANGLE_RELAX_PASSES; pass += 1) {
    let adjusted = false;
    for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
      if (!isLandRoadLikeIndex(state, idx)) {
        continue;
      }
      const x = idx % state.grid.cols;
      const y = Math.floor(idx / state.grid.cols);
      const mask = getRoadMaskAtIndex(state, idx, true);
      for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
        const dir = ROAD_EDGE_DIRS[i]!;
        if ((mask & dir.bit) === 0) {
          continue;
        }
        const nx = x + dir.dx;
        const ny = y + dir.dy;
        if (!inBounds(state.grid, nx, ny)) {
          continue;
        }
        const neighborIdx = indexFor(state.grid, nx, ny);
        if (neighborIdx <= idx || !isLandRoadLikeIndex(state, neighborIdx)) {
          continue;
        }
        const tile = state.tiles[idx];
        const neighbor = state.tiles[neighborIdx];
        if (!tile || !neighbor) {
          continue;
        }
        const maxAngleDeg =
          touchesStructurePad(state, idx) || touchesStructurePad(state, neighborIdx)
            ? ROAD_FINAL_STRUCTURE_MAX_ANGLE_DEG
            : ROAD_FINAL_MAX_ANGLE_DEG;
        const slopeLimit = Math.tan((maxAngleDeg * Math.PI) / 180) / Math.max(1e-6, elevationScale);
        const run = Math.hypot(dir.dx, dir.dy);
        const maxDelta = slopeLimit * Math.max(1, run);
        const delta = neighbor.elevation - tile.elevation;
        const absDelta = Math.abs(delta);
        if (absDelta <= maxDelta + 1e-6) {
          continue;
        }
        const sign = Math.sign(delta) || 1;
        const targetDelta = sign * maxDelta;
        const excess = delta - targetDelta;
        const minTileElevation = getRoadLakeLipMinElevation(state, idx);
        const minNeighborElevation = getRoadLakeLipMinElevation(state, neighborIdx);
        if (tile.type === "base" && neighbor.type !== "base") {
          neighbor.elevation = clamp(Math.max(minNeighborElevation, tile.elevation + targetDelta), 0, 1);
        } else if (neighbor.type === "base" && tile.type !== "base") {
          tile.elevation = clamp(Math.max(minTileElevation, neighbor.elevation - targetDelta), 0, 1);
        } else {
          let nextTileElevation = tile.elevation + excess * 0.5;
          let nextNeighborElevation = neighbor.elevation - excess * 0.5;
          if (nextTileElevation < minTileElevation) {
            nextNeighborElevation += minTileElevation - nextTileElevation;
            nextTileElevation = minTileElevation;
          }
          if (nextNeighborElevation < minNeighborElevation) {
            nextTileElevation += minNeighborElevation - nextNeighborElevation;
            nextNeighborElevation = minNeighborElevation;
          }
          tile.elevation = clamp(nextTileElevation, 0, 1);
          neighbor.elevation = clamp(nextNeighborElevation, 0, 1);
        }
        state.tileElevation[idx] = tile.elevation;
        state.tileElevation[neighborIdx] = neighbor.elevation;
        adjusted = true;
      }
    }
    if (!adjusted) {
      break;
    }
  }
};

export function gradeRoadNetworkTerrain(state: WorldState, heightScaleMultiplier = 1): RoadSurfaceMetrics {
  const total = state.grid.totalTiles;
  prepareShortBridgeApproaches(state);
  const originalElevations = new Float32Array(total);
  for (let i = 0; i < total; i += 1) {
    originalElevations[i] = state.tiles[i]?.elevation ?? 0;
  }
  if (state.tileRoadWallEdges.length !== total) {
    state.tileRoadWallEdges = new Uint8Array(total);
  } else {
    state.tileRoadWallEdges.fill(0);
  }

  const fullMaskByIdx = new Uint8Array(total);
  const landMaskByIdx = new Uint8Array(total);
  const anchorMask = new Uint8Array(total);
  const visitedEdges = new Uint8Array(total);

  for (let idx = 0; idx < total; idx += 1) {
    if (!isRoadLikeIndex(state, idx)) {
      continue;
    }
    fullMaskByIdx[idx] = getRoadMaskAtIndex(state, idx, false);
    if (isLandRoadLikeIndex(state, idx)) {
      landMaskByIdx[idx] = getRoadMaskAtIndex(state, idx, true);
    }
  }

  for (let idx = 0; idx < total; idx += 1) {
    if (!isLandRoadLikeIndex(state, idx)) {
      continue;
    }
    const tile = state.tiles[idx];
    const landMask = landMaskByIdx[idx] ?? 0;
    const fullMask = fullMaskByIdx[idx] ?? 0;
    if (tile.type === "base" || countEdgeBits(landMask) !== 2 || touchesStructurePad(state, idx)) {
      anchorMask[idx] = 1;
      continue;
    }
    const x = idx % state.grid.cols;
    const y = Math.floor(idx / state.grid.cols);
    let attachedToBridge = false;
    for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
      const dir = ROAD_EDGE_DIRS[i];
      if ((fullMask & dir.bit) === 0) {
        continue;
      }
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const neighborIdx = indexFor(state.grid, nx, ny);
      if (state.tileRoadBridge[neighborIdx] > 0 || state.tiles[neighborIdx]?.type === "water") {
        attachedToBridge = true;
        break;
      }
    }
    if (attachedToBridge) {
      anchorMask[idx] = 1;
    }
  }

  const segments: RoadSegmentTrace[] = [];
  for (let idx = 0; idx < total; idx += 1) {
    if (!isLandRoadLikeIndex(state, idx) || anchorMask[idx] === 0) {
      continue;
    }
    const mask = landMaskByIdx[idx] ?? 0;
    for (let dirIndex = 0; dirIndex < ROAD_EDGE_DIRS.length; dirIndex += 1) {
      const dir = ROAD_EDGE_DIRS[dirIndex];
      if ((mask & dir.bit) === 0 || (visitedEdges[idx] & dir.bit) !== 0) {
        continue;
      }
      const segment = traceRoadSegment(state, idx, dirIndex, landMaskByIdx, anchorMask, visitedEdges);
      if (segment.indices.length > 1) {
        segments.push(segment);
      }
    }
  }

  for (let idx = 0; idx < total; idx += 1) {
    if (!isLandRoadLikeIndex(state, idx)) {
      continue;
    }
    const mask = landMaskByIdx[idx] ?? 0;
    if (mask === 0) {
      continue;
    }
    for (let dirIndex = 0; dirIndex < ROAD_EDGE_DIRS.length; dirIndex += 1) {
      const dir = ROAD_EDGE_DIRS[dirIndex];
      if ((mask & dir.bit) === 0 || (visitedEdges[idx] & dir.bit) !== 0) {
        continue;
      }
      const segment = traceRoadSegment(state, idx, dirIndex, landMaskByIdx, anchorMask, visitedEdges);
      if (segment.indices.length > 1) {
        segments.push(segment);
      }
    }
  }

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const profile = buildRoadSegmentProfile(state, segment.indices, segment.loop, originalElevations, heightScaleMultiplier);
    for (let j = 0; j < segment.indices.length; j += 1) {
      const idx = segment.indices[j];
      const tile = state.tiles[idx];
      if (!tile || tile.type === "water") {
        continue;
      }
      tile.elevation = clamp(profile[j] ?? tile.elevation, 0, 1);
    }
  }
  enforceRoadLakeLipClearance(state);
  terraceRoadLakeLipShoulders(state);
  reconcileHighAngleRoadEdges(state, heightScaleMultiplier);

  const shoulderSum = new Float32Array(total);
  const shoulderWeight = new Float32Array(total);
  for (let idx = 0; idx < total; idx += 1) {
    if (!isLandRoadLikeIndex(state, idx)) {
      continue;
    }
    const roadElevation = state.tiles[idx]?.elevation ?? 0;
    const x = idx % state.grid.cols;
    const y = Math.floor(idx / state.grid.cols);
    for (let dy = -ROAD_SHOULDER_BLEND_RADIUS; dy <= ROAD_SHOULDER_BLEND_RADIUS; dy += 1) {
      for (let dx = -ROAD_SHOULDER_BLEND_RADIUS; dx <= ROAD_SHOULDER_BLEND_RADIUS; dx += 1) {
        if (dx === 0 && dy === 0) {
          continue;
        }
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(state.grid, nx, ny)) {
          continue;
        }
        const nIdx = indexFor(state.grid, nx, ny);
        const neighbor = state.tiles[nIdx];
        if (
          !neighbor ||
          neighbor.type === "water" ||
          neighbor.type === "house" ||
          neighbor.type === "base" ||
          state.structureMask[nIdx] > 0
        ) {
          continue;
        }
        if (isRoadLikeIndex(state, nIdx)) {
          continue;
        }
        const dist = Math.hypot(dx, dy);
        if (dist > ROAD_SHOULDER_BLEND_RADIUS + 0.01) {
          continue;
        }
        const weight = dist <= 1.05 ? 0.18 : 0.08;
        shoulderSum[nIdx] += roadElevation * weight;
        shoulderWeight[nIdx] += weight;
      }
    }
  }

  for (let idx = 0; idx < total; idx += 1) {
    const weight = shoulderWeight[idx] ?? 0;
    if (weight <= 0) {
      continue;
    }
    const tile = state.tiles[idx];
    if (
      !tile ||
      tile.type === "water" ||
      tile.type === "house" ||
      tile.type === "base" ||
      state.structureMask[idx] > 0 ||
      isRoadLikeIndex(state, idx)
    ) {
      continue;
    }
    const blend = Math.min(0.68, weight);
    const target = shoulderSum[idx] / Math.max(1e-6, weight);
    const originalElevation = originalElevations[idx] ?? tile.elevation;
    const nearRoad = blend >= 0.3;
    const maxFill = nearRoad ? ROAD_SHOULDER_MAX_FILL_NEAR : ROAD_SHOULDER_MAX_FILL_FAR;
    const maxCut = nearRoad ? ROAD_SHOULDER_MAX_CUT_NEAR : ROAD_SHOULDER_MAX_CUT_FAR;
    const clampedTarget = clamp(target, originalElevation - maxCut, originalElevation + maxFill);
    tile.elevation = clamp(tile.elevation * (1 - blend) + clampedTarget * blend, 0, 1);
  }
  flattenRenderedHouseFootprints(state);
  enforceRoadLakeLipClearance(state);
  terraceRoadLakeLipShoulders(state);
  reconcileHighAngleRoadEdges(state, heightScaleMultiplier);
  relaxHighReliefRoadShoulders(state);
  stabilizeTownSeedElevations(state, heightScaleMultiplier);
  flattenRenderedHouseFootprints(state);

  for (let idx = 0; idx < total; idx += 1) {
    if (!isLandRoadLikeIndex(state, idx)) {
      continue;
    }
    const x = idx % state.grid.cols;
    const y = Math.floor(idx / state.grid.cols);
    const roadElevation = state.tiles[idx]?.elevation ?? 0;
    for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
      const dir = ROAD_EDGE_DIRS[i];
      if (dir.diagonal) {
        continue;
      }
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const neighborIdx = indexFor(state.grid, nx, ny);
      const neighbor = state.tiles[neighborIdx];
      if (!neighbor || neighbor.type === "water" || neighbor.type === "house" || neighbor.type === "base") {
        continue;
      }
      if (isRoadLikeIndex(state, neighborIdx)) {
        continue;
      }
      const outsideX = nx + dir.dx;
      const outsideY = ny + dir.dy;
      const outsideElevation = inBounds(state.grid, outsideX, outsideY)
        ? state.tiles[indexFor(state.grid, outsideX, outsideY)]?.elevation ?? neighbor.elevation
        : neighbor.elevation;
      const localDrop = roadElevation - neighbor.elevation;
      const outerDrop = roadElevation - Math.min(neighbor.elevation, outsideElevation);
      if (localDrop >= ROAD_WALL_DROP_THRESHOLD && outerDrop >= ROAD_WALL_OUTER_DROP_THRESHOLD) {
        state.tileRoadWallEdges[idx] |= dir.bit;
      }
    }
  }

  const metrics = analyzeRoadSurfaceMetrics(state, heightScaleMultiplier);
  let maxRoadGradingDelta = 0;
  for (let idx = 0; idx < total; idx += 1) {
    if (!isLandRoadLikeIndex(state, idx)) {
      continue;
    }
    maxRoadGradingDelta = Math.max(
      maxRoadGradingDelta,
      Math.abs((state.tiles[idx]?.elevation ?? 0) - (originalElevations[idx] ?? 0))
    );
  }
  metrics.maxRoadGradingDelta = maxRoadGradingDelta;
  return metrics;
}

const SETTLEMENT_PAD_BLEND_RADIUS = 4;
const SETTLEMENT_PAD_RING_WEIGHTS = [0.88, 0.64, 0.38, 0.18] as const;
const SETTLEMENT_PAD_ROAD_ADJUST_LIMIT = 0.03;

const flattenRenderedHouseFootprints = (state: WorldState): void => {
  const cols = state.grid.cols;
  const rows = state.grid.rows;
  const total = state.grid.totalTiles;
  const footprints: Array<{ bounds: HouseFootprintBounds; target: number }> = [];
  const isRoadLikeAt = (x: number, y: number): boolean => {
    if (!inBounds(state.grid, x, y)) {
      return false;
    }
    const type = state.tiles[indexFor(state.grid, x, y)]?.type;
    return type === "road" || type === "base";
  };
  const getRoadMaskAt = (x: number, y: number): number => {
    if (!inBounds(state.grid, x, y)) {
      return 0;
    }
    return state.tileRoadEdges[indexFor(state.grid, x, y)] ?? 0;
  };
  const setElevation = (idx: number, elevation: number): void => {
    const value = clamp(elevation, 0, 1);
    state.tiles[idx].elevation = value;
    if (state.tileElevation.length === total) {
      state.tileElevation[idx] = value;
    }
  };
  for (let idx = 0; idx < total; idx += 1) {
    const tile = state.tiles[idx];
    if (!tile || tile.type !== "house") {
      continue;
    }
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    const seed = Number.isFinite(tile.houseStyleSeed) ? Math.trunc(tile.houseStyleSeed as number) : idx;
    const reference = findBestRoadReferenceForPlot(x, y, isRoadLikeAt, getRoadMaskAt);
    const rotation = pickHouseRotationFromRoadMask(reference?.roadMask ?? 0, seed);
    const footprint = pickHouseFootprint(seed);
    const bounds = getHouseFootprintBounds(x, y, rotation, footprint, "asset");
    footprints.push({ bounds, target: tile.elevation });
  }
  if (footprints.length === 0) {
    return;
  }

  const parent = Int32Array.from({ length: footprints.length }, (_, index) => index);
  const ownerByTile = new Int32Array(total);
  ownerByTile.fill(-1);
  const findRoot = (index: number): number => {
    let root = index;
    while (parent[root] !== root) {
      root = parent[root] ?? root;
    }
    let current = index;
    while (parent[current] !== current) {
      const next = parent[current] ?? root;
      parent[current] = root;
      current = next;
    }
    return root;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = findRoot(left);
    const rightRoot = findRoot(right);
    if (leftRoot !== rightRoot) {
      parent[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
    }
  };

  for (let footprintIndex = 0; footprintIndex < footprints.length; footprintIndex += 1) {
    const { bounds } = footprints[footprintIndex]!;
    for (let fy = bounds.minY; fy <= bounds.maxY; fy += 1) {
      for (let fx = bounds.minX; fx <= bounds.maxX; fx += 1) {
        if (fx < 0 || fy < 0 || fx >= cols || fy >= rows) {
          continue;
        }
        const footprintIdx = indexFor(state.grid, fx, fy);
        if (state.tiles[footprintIdx]?.type === "water") {
          continue;
        }
        const owner = ownerByTile[footprintIdx] ?? -1;
        if (owner >= 0) {
          union(footprintIndex, owner);
        } else {
          ownerByTile[footprintIdx] = footprintIndex;
        }
      }
    }
  }

  const targetSum = new Float64Array(footprints.length);
  const targetCount = new Uint16Array(footprints.length);
  for (let index = 0; index < footprints.length; index += 1) {
    const root = findRoot(index);
    targetSum[root] += footprints[index]?.target ?? 0;
    targetCount[root] += 1;
  }
  for (let footprintIndex = 0; footprintIndex < footprints.length; footprintIndex += 1) {
    const { bounds } = footprints[footprintIndex]!;
    const root = findRoot(footprintIndex);
    const target = targetSum[root] / Math.max(1, targetCount[root] ?? 0);
    for (let fy = bounds.minY; fy <= bounds.maxY; fy += 1) {
      for (let fx = bounds.minX; fx <= bounds.maxX; fx += 1) {
        if (fx < 0 || fy < 0 || fx >= cols || fy >= rows) {
          continue;
        }
        const footprintIdx = indexFor(state.grid, fx, fy);
        if (state.tiles[footprintIdx]?.type !== "water") {
          setElevation(footprintIdx, target);
        }
      }
    }
  }
};

const stabilizeTownSeedElevations = (state: WorldState, heightScaleMultiplier: number): void => {
  const maxDelta = Math.tan((32 * Math.PI) / 180) /
    Math.max(1e-6, getTerrainHeightScale(state.grid.cols, state.grid.rows, heightScaleMultiplier));
  for (let townIndex = 0; townIndex < state.towns.length; townIndex += 1) {
    const town = state.towns[townIndex]!;
    const x = Math.round(town.x);
    const y = Math.round(town.y);
    if (!inBounds(state.grid, x, y)) {
      continue;
    }
    const idx = indexFor(state.grid, x, y);
    const tile = state.tiles[idx];
    if (!tile || tile.type === "water" || tile.type === "base") {
      continue;
    }
    let lower = 0;
    let upper = 1;
    let neighborCount = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const neighbor = state.tiles[indexFor(state.grid, nx, ny)];
      if (!neighbor || neighbor.type === "water") {
        continue;
      }
      lower = Math.max(lower, neighbor.elevation - maxDelta);
      upper = Math.min(upper, neighbor.elevation + maxDelta);
      neighborCount += 1;
    }
    if (neighborCount === 0 || lower > upper) {
      continue;
    }
    const elevation = clamp(tile.elevation, lower, upper);
    tile.elevation = elevation;
    if (state.tileElevation.length === state.grid.totalTiles) {
      state.tileElevation[idx] = elevation;
    }
  }
};

export function flattenSettlementGround(state: WorldState): void {
  const tiles = state.tiles;
  const cols = state.grid.cols;
  const rows = state.grid.rows;
  const total = state.grid.totalTiles;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const ringInfluence = new Float32Array(total);
  const ringTarget = new Float32Array(total);
  const roadAdjustSum = new Float32Array(total);
  const roadAdjustCount = new Uint8Array(total);
  const setElevation = (idx: number, elevation: number): void => {
    const value = clamp(elevation, 0, 1);
    tiles[idx].elevation = value;
    if (state.tileElevation.length === total) {
      state.tileElevation[idx] = value;
    }
  };
  const isStructureTile = (idx: number): boolean => {
    const type = tiles[idx].type;
    return type === "house" || type === "base" || state.structureMask[idx] === 1;
  };
  const recordRingInfluence = (idx: number, weight: number, target: number): void => {
    if (weight <= 0 || tiles[idx].type === "water" || tiles[idx].type === "road" || isStructureTile(idx)) {
      return;
    }
    if (weight > ringInfluence[idx]) {
      ringInfluence[idx] = weight;
      ringTarget[idx] = target;
      return;
    }
    if (Math.abs(weight - ringInfluence[idx]) <= 1e-6) {
      ringTarget[idx] = (ringTarget[idx] + target) * 0.5;
    }
  };
  let housePadReliefMax = 0;
  let housePadReliefSum = 0;
  let housePadCount = 0;

  for (let i = 0; i < total; i += 1) {
    if (visited[i]) {
      continue;
    }
    if (!isStructureTile(i)) {
      continue;
    }
    let head = 0;
    let tail = 0;
    queue[tail] = i;
    tail += 1;
    visited[i] = 1;
    let componentHasHouse = false;
    let componentMinX = cols;
    let componentMaxX = -1;
    let componentMinY = rows;
    let componentMaxY = -1;

    while (head < tail) {
      const idx = queue[head];
      head += 1;
      if (tiles[idx].type === "house") {
        componentHasHouse = true;
      }
      const x = idx % cols;
      const y = Math.floor(idx / cols);
      componentMinX = Math.min(componentMinX, x);
      componentMaxX = Math.max(componentMaxX, x);
      componentMinY = Math.min(componentMinY, y);
      componentMaxY = Math.max(componentMaxY, y);
      if (x > 0) {
        const nIdx = idx - 1;
        if (!visited[nIdx]) {
          if (isStructureTile(nIdx)) {
            visited[nIdx] = 1;
            queue[tail] = nIdx;
            tail += 1;
          }
        }
      }
      if (x < cols - 1) {
        const nIdx = idx + 1;
        if (!visited[nIdx]) {
          if (isStructureTile(nIdx)) {
            visited[nIdx] = 1;
            queue[tail] = nIdx;
            tail += 1;
          }
        }
      }
      if (y > 0) {
        const nIdx = idx - cols;
        if (!visited[nIdx]) {
          if (isStructureTile(nIdx)) {
            visited[nIdx] = 1;
            queue[tail] = nIdx;
            tail += 1;
          }
        }
      }
      if (y < rows - 1) {
        const nIdx = idx + cols;
        if (!visited[nIdx]) {
          if (isStructureTile(nIdx)) {
            visited[nIdx] = 1;
            queue[tail] = nIdx;
            tail += 1;
          }
        }
      }
    }

    if (componentMaxX < componentMinX || componentMaxY < componentMinY) {
      continue;
    }
    const padExpansion = componentHasHouse ? 1 : 0;
    const padMinX = Math.max(0, componentMinX - padExpansion);
    const padMaxX = Math.min(cols - 1, componentMaxX + padExpansion);
    const padMinY = Math.max(0, componentMinY - padExpansion);
    const padMaxY = Math.min(rows - 1, componentMaxY + padExpansion);
    const padTiles: number[] = [];
    const padSamples: number[] = [];
    for (let y = padMinY; y <= padMaxY; y += 1) {
      const rowBase = y * cols;
      for (let x = padMinX; x <= padMaxX; x += 1) {
        const idx = rowBase + x;
        const tile = tiles[idx];
        if (!tile || tile.type === "water") {
          continue;
        }
        const elevation = tile.elevation;
        padTiles.push(idx);
        padSamples.push(elevation);
      }
    }
    if (padSamples.length === 0) {
      continue;
    }
    padSamples.sort((a, b) => a - b);
    const targetIndex = Math.max(0, Math.min(padSamples.length - 1, Math.floor((padSamples.length - 1) * 0.35)));
    const target = clamp(padSamples[targetIndex] ?? 0, 0, 1);
    padTiles.forEach((idx) => {
      setElevation(idx, target);
    });

    padTiles.forEach((idx) => {
      const cx = idx % cols;
      const cy = Math.floor(idx / cols);
      if (cx > 0) {
        const nIdx = idx - 1;
        if (tiles[nIdx].type === "road") {
          roadAdjustSum[nIdx] += clamp(target - tiles[nIdx].elevation, -SETTLEMENT_PAD_ROAD_ADJUST_LIMIT, SETTLEMENT_PAD_ROAD_ADJUST_LIMIT);
          roadAdjustCount[nIdx] += 1;
        }
      }
      if (cx < cols - 1) {
        const nIdx = idx + 1;
        if (tiles[nIdx].type === "road") {
          roadAdjustSum[nIdx] += clamp(target - tiles[nIdx].elevation, -SETTLEMENT_PAD_ROAD_ADJUST_LIMIT, SETTLEMENT_PAD_ROAD_ADJUST_LIMIT);
          roadAdjustCount[nIdx] += 1;
        }
      }
      if (cy > 0) {
        const nIdx = idx - cols;
        if (tiles[nIdx].type === "road") {
          roadAdjustSum[nIdx] += clamp(target - tiles[nIdx].elevation, -SETTLEMENT_PAD_ROAD_ADJUST_LIMIT, SETTLEMENT_PAD_ROAD_ADJUST_LIMIT);
          roadAdjustCount[nIdx] += 1;
        }
      }
      if (cy < rows - 1) {
        const nIdx = idx + cols;
        if (tiles[nIdx].type === "road") {
          roadAdjustSum[nIdx] += clamp(target - tiles[nIdx].elevation, -SETTLEMENT_PAD_ROAD_ADJUST_LIMIT, SETTLEMENT_PAD_ROAD_ADJUST_LIMIT);
          roadAdjustCount[nIdx] += 1;
        }
      }
    });

    for (let y = padMinY - SETTLEMENT_PAD_BLEND_RADIUS; y <= padMaxY + SETTLEMENT_PAD_BLEND_RADIUS; y += 1) {
      if (y < 0 || y >= rows) {
        continue;
      }
      for (let x = padMinX - SETTLEMENT_PAD_BLEND_RADIUS; x <= padMaxX + SETTLEMENT_PAD_BLEND_RADIUS; x += 1) {
        if (x < 0 || x >= cols) {
          continue;
        }
        const dx =
          x < padMinX ? padMinX - x : x > padMaxX ? x - padMaxX : 0;
        const dy =
          y < padMinY ? padMinY - y : y > padMaxY ? y - padMaxY : 0;
        const chebyshev = Math.max(dx, dy);
        if (chebyshev <= 0 || chebyshev > SETTLEMENT_PAD_BLEND_RADIUS) {
          continue;
        }
        const weight = SETTLEMENT_PAD_RING_WEIGHTS[chebyshev - 1] ?? 0;
        if (weight <= 0) {
          continue;
        }
        const nIdx = y * cols + x;
        recordRingInfluence(nIdx, weight, target);
      }
    }

    if (componentHasHouse) {
      let minElevation = Number.POSITIVE_INFINITY;
      let maxElevation = Number.NEGATIVE_INFINITY;
      padTiles.forEach((idx) => {
        minElevation = Math.min(minElevation, tiles[idx].elevation);
        maxElevation = Math.max(maxElevation, tiles[idx].elevation);
      });
      const relief =
        Number.isFinite(minElevation) && Number.isFinite(maxElevation) ? maxElevation - minElevation : 0;
      housePadReliefMax = Math.max(housePadReliefMax, relief);
      housePadReliefSum += relief;
      housePadCount += 1;
    }
  }

  for (let i = 0; i < total; i += 1) {
    if (tiles[i].type === "water" || ringInfluence[i] <= 0) {
      continue;
    }
    const target = ringTarget[i];
    const t = ringInfluence[i];
    setElevation(i, tiles[i].elevation * (1 - t) + target * t);
  }

  for (let i = 0; i < total; i += 1) {
    const count = roadAdjustCount[i];
    if (count === 0 || tiles[i].type !== "road") {
      continue;
    }
    const delta = clamp(
      roadAdjustSum[i] / count,
      -SETTLEMENT_PAD_ROAD_ADJUST_LIMIT,
      SETTLEMENT_PAD_ROAD_ADJUST_LIMIT
    );
    setElevation(i, tiles[i].elevation + delta);
  }
  flattenRenderedHouseFootprints(state);
  state.tileSoaDirty = true;
  state.terrainDirty = true;
  state.settlementPadReliefMax = Number(housePadReliefMax.toFixed(4));
  state.settlementPadReliefMean = Number((housePadCount > 0 ? housePadReliefSum / housePadCount : 0).toFixed(4));
}

async function generateMapLegacy(
  state: WorldState,
  rng: RNG,
  report?: MapGenReporter,
  settings?: MapGenSettings,
  debug?: MapGenDebug
): Promise<void> {
  const yieldIfNeeded = createYield();
  const mapSettings = { ...DEFAULT_MAP_GEN_SETTINGS, ...(settings ?? {}) };
  const cellSizeM = Math.max(0.1, mapSettings.cellSizeM);
  const worldOffsetXM = mapSettings.worldOffsetXM;
  const worldOffsetYM = mapSettings.worldOffsetYM;
  const microScaleM = Math.max(1, mapSettings.microScaleM);
  const forestMacroScaleM = Math.max(1, mapSettings.forestMacroScale * cellSizeM);
  const forestDetailScaleM = Math.max(1, mapSettings.forestDetailScale * cellSizeM);
  const meadowScaleM = Math.max(1, mapSettings.meadowScale * cellSizeM);
  const maxDim = Math.max(state.grid.cols, state.grid.rows);
  const biomeBlock = maxDim >= 1024 ? 8 : maxDim >= 512 ? 4 : 2;
  state.tiles = new Array(state.grid.totalTiles);
  if (report) {
    await report("Reticulating splines...", 0);
  }

  type BiomeSample = {
    micro: number;
    forestNoise: number;
    meadowMask: number;
  };

  const { elevationMap, riverMask, seaLevelBase, erosionWearMap } = await buildElevationMap(
    state,
    rng,
    mapSettings,
    report
      ? async (message, progress) => {
          await report(message, progress * 0.6);
        }
      : undefined,
    yieldIfNeeded,
    debug
  );
  if (state.tileErosionWear.length !== erosionWearMap.length) {
    state.tileErosionWear = new Float32Array(erosionWearMap.length);
  }
  state.tileErosionWear.set(erosionWearMap);

  const slopeMap = new Float32Array(state.grid.totalTiles);
  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = indexFor(state.grid, x, y);
      const e = elevationMap[idx];
      let maxDiff = 0;
      if (y > 0) {
        maxDiff = Math.max(maxDiff, Math.abs(e - elevationMap[idx - state.grid.cols]));
      }
      if (y < state.grid.rows - 1) {
        maxDiff = Math.max(maxDiff, Math.abs(e - elevationMap[idx + state.grid.cols]));
      }
      if (x > 0) {
        maxDiff = Math.max(maxDiff, Math.abs(e - elevationMap[idx - 1]));
      }
      if (x < state.grid.cols - 1) {
        maxDiff = Math.max(maxDiff, Math.abs(e - elevationMap[idx + 1]));
      }
      slopeMap[idx] = clamp(maxDiff, 0, 1);
    }
  }

  const blockCols = Math.ceil(state.grid.cols / biomeBlock);
  const blockRows = Math.ceil(state.grid.rows / biomeBlock);
  let biomeSamples: BiomeSample[] | null = null;
  if (biomeBlock > 1) {
    biomeSamples = new Array(blockCols * blockRows);
    for (let by = 0; by < blockRows; by += 1) {
      const sampleY = (by + 0.5) * biomeBlock;
      for (let bx = 0; bx < blockCols; bx += 1) {
        const sampleX = (bx + 0.5) * biomeBlock;
        const worldX = worldOffsetXM + sampleX * cellSizeM;
        const worldY = worldOffsetYM + sampleY * cellSizeM;
        const micro = fractalNoise(worldX / microScaleM, worldY / microScaleM, state.seed + 211);
        const forestMacro = fractalNoise(
          worldX / forestMacroScaleM,
          worldY / forestMacroScaleM,
          state.seed + 415
        );
        const forestDetail = fractalNoise(
          worldX / forestDetailScaleM,
          worldY / forestDetailScaleM,
          state.seed + 619
        );
        const forestNoise = forestMacro * FOREST_MACRO_WEIGHT + forestDetail * FOREST_DETAIL_WEIGHT;
        const meadowNoise = fractalNoise(
          worldX / meadowScaleM,
          worldY / meadowScaleM,
          state.seed + 933
        );
        const meadowMask = clamp(
          (meadowNoise - mapSettings.meadowThreshold) / (1 - mapSettings.meadowThreshold),
          0,
          1
        );
        biomeSamples[by * blockCols + bx] = {
          micro,
          forestNoise,
          meadowMask
        };
      }
      if (report && (await yieldIfNeeded())) {
        await report("Seeding biomes...", 0.6 + (by + 1) / blockRows * 0.02);
      }
    }
  }

  const totalTiles = state.grid.totalTiles;
  const microMap = new Float32Array(totalTiles);
  const forestNoiseMap = new Float32Array(totalTiles);
  const meadowMaskMap = new Float32Array(totalTiles);
  const seaLevelMap = new Float32Array(totalTiles);
  const trackTerrainStats = DEBUG_TERRAIN;
  let elevMin = 1;
  let elevMax = 0;
  let elevSum = 0;
  let waterCount = 0;

  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = indexFor(state.grid, x, y);
      const elevation = elevationMap[idx];
      const valley = state.valleyMap[idx];
      let micro = 0.5;
      let forestNoise = 0.5;
      let meadowMask = 0;
      if (biomeBlock > 1 && biomeSamples) {
        const bx = Math.floor(x / biomeBlock);
        const by = Math.floor(y / biomeBlock);
        const sample = biomeSamples[by * blockCols + bx];
        micro = sample.micro;
        forestNoise = sample.forestNoise;
        meadowMask = sample.meadowMask;
      } else {
        const worldX = worldOffsetXM + x * cellSizeM;
        const worldY = worldOffsetYM + y * cellSizeM;
        micro = fractalNoise(worldX / microScaleM, worldY / microScaleM, state.seed + 211);
        const forestMacro = fractalNoise(
          worldX / forestMacroScaleM,
          worldY / forestMacroScaleM,
          state.seed + 415
        );
        const forestDetail = fractalNoise(
          worldX / forestDetailScaleM,
          worldY / forestDetailScaleM,
          state.seed + 619
        );
        forestNoise = forestMacro * FOREST_MACRO_WEIGHT + forestDetail * FOREST_DETAIL_WEIGHT;
        const meadowNoise = fractalNoise(worldX / meadowScaleM, worldY / meadowScaleM, state.seed + 933);
        meadowMask = clamp(
          (meadowNoise - mapSettings.meadowThreshold) / (1 - mapSettings.meadowThreshold),
          0,
          1
        );
      }
      microMap[idx] = micro;
      forestNoiseMap[idx] = forestNoise;
      meadowMaskMap[idx] = meadowMask;

      const seaLevel = clampSeaLevel(seaLevelBase, mapSettings);
      seaLevelMap[idx] = seaLevel;
      if (trackTerrainStats) {
        elevMin = Math.min(elevMin, elevation);
        elevMax = Math.max(elevMax, elevation);
        elevSum += elevation;
        if (elevation < seaLevel) {
          waterCount += 1;
        }
      }

      const type: TileType = elevation < seaLevel ? "water" : "grass";
      state.tiles[idx] = {
        type,
        fuel: 0,
        fire: 0,
        isBase: false,
        elevation,
        heat: 0,
        ignitionPoint: 0,
        burnRate: 0,
        heatOutput: 0,
        spreadBoost: 0,
        heatTransferCap: 0,
        heatRetention: 1,
        windFactor: 0,
        moisture: 0,
        waterDist: 0,
        vegetationAgeYears: 0,
        canopy: 0,
        canopyCover: 0,
        stemDensity: 0,
        dominantTreeType: null,
        treeType: null,
        houseValue: 0,
        houseResidents: 0,
        houseDestroyed: false,
        ashAge: 0
      };
    }
    if (report && (await yieldIfNeeded())) {
      await report("Seeding biomes...", 0.6 + (y + 1) / state.grid.rows * 0.12);
    }
  }
  for (let i = 0; i < riverMask.length; i += 1) {
    if (riverMask[i] > 0) {
      state.tiles[i].type = "water";
    }
  }
  let inlandAdjusted = false;
  let slopeDirty = false;
  let oceanMask = buildOceanMask(state);
  let oceanMaskCount = countMaskTiles(oceanMask);
  if (oceanMaskCount === 0) {
    oceanMask = buildOceanMaskFromElevation(state, elevationMap, seaLevelMap);
    oceanMaskCount = countMaskTiles(oceanMask);
  }
  if (oceanMaskCount === 0) {
    oceanMask = buildLargestWaterMask(state);
    oceanMaskCount = countMaskTiles(oceanMask);
  }
  oceanMask = enforceEdgeOceanMask(state, elevationMap, seaLevelMap, oceanMask, riverMask);
  oceanMaskCount = countMaskTiles(oceanMask);
  const oceanLevel = oceanMaskCount > 0 ? computeOceanLevel(elevationMap, oceanMask, riverMask) : null;
  if (oceanLevel !== null) {
    oceanMask = expandOceanMaskByElevation(state, elevationMap, seaLevelMap, oceanMask, riverMask, oceanLevel);
    for (let i = 0; i < state.tiles.length; i += 1) {
      if (!oceanMask[i]) {
        continue;
      }
      if (state.tiles[i].type !== "water") {
        state.tiles[i].type = "water";
        inlandAdjusted = true;
      }
    }
  }
  if (DISABLE_DISCONNECTED_INLAND_WATER && oceanMaskCount > 0) {
    for (let i = 0; i < state.tiles.length; i += 1) {
      if (oceanMask[i] || riverMask[i] > 0) {
        continue;
      }
      const tile = state.tiles[i];
      const belowOceanLevel = oceanLevel !== null && elevationMap[i] < oceanLevel;
      if (tile.type !== "water" && !belowOceanLevel) {
        continue;
      }
      inlandAdjusted = true;
      const seaLevel = seaLevelMap[i];
      const floorLevel = oceanLevel !== null ? Math.max(seaLevel, oceanLevel) : seaLevel;
      const nextElevation = Math.max(elevationMap[i], floorLevel + 0.002);
      if (nextElevation !== elevationMap[i]) {
        elevationMap[i] = nextElevation;
        tile.elevation = nextElevation;
        slopeDirty = true;
      } else {
        tile.elevation = nextElevation;
      }
      tile.type = "grass";
    }
    if (slopeDirty) {
      for (let y = 0; y < state.grid.rows; y += 1) {
        for (let x = 0; x < state.grid.cols; x += 1) {
          const idx = indexFor(state.grid, x, y);
          const e = elevationMap[idx];
          let maxDiff = 0;
          if (y > 0) {
            maxDiff = Math.max(maxDiff, Math.abs(e - elevationMap[idx - state.grid.cols]));
          }
          if (y < state.grid.rows - 1) {
            maxDiff = Math.max(maxDiff, Math.abs(e - elevationMap[idx + state.grid.cols]));
          }
          if (x > 0) {
            maxDiff = Math.max(maxDiff, Math.abs(e - elevationMap[idx - 1]));
          }
          if (x < state.grid.cols - 1) {
            maxDiff = Math.max(maxDiff, Math.abs(e - elevationMap[idx + 1]));
          }
          slopeMap[idx] = clamp(maxDiff, 0, 1);
        }
      }
    }
  }
  if (trackTerrainStats && inlandAdjusted) {
    elevMin = 1;
    elevMax = 0;
    elevSum = 0;
    waterCount = 0;
    for (let i = 0; i < totalTiles; i += 1) {
      const elevation = state.tiles[i].elevation;
      elevMin = Math.min(elevMin, elevation);
      elevMax = Math.max(elevMax, elevation);
      elevSum += elevation;
      if (state.tiles[i].type === "water") {
        waterCount += 1;
      }
    }
  }
  if (DEBUG_TERRAIN) {
    let riverTiles = 0;
    for (let i = 0; i < riverMask.length; i += 1) {
      if (riverMask[i] > 0) {
        riverTiles += 1;
      }
    }
    console.log(`MapGen rivers: tiles=${riverTiles}`);
  }
  if (trackTerrainStats) {
    const mean = elevSum / Math.max(1, totalTiles);
    const waterShare = (waterCount / Math.max(1, totalTiles)) * 100;
    const borderElevations: number[] = [];
    const coastalAboveSea: number[] = [];
    const coastalSlopes: number[] = [];
    const interiorSlopes: number[] = [];
    const summitElevations: number[] = [];
    let landCount = 0;
    for (let y = 0; y < state.grid.rows; y += 1) {
      for (let x = 0; x < state.grid.cols; x += 1) {
        const idx = indexFor(state.grid, x, y);
        const tile = state.tiles[idx];
        const elevation = tile.elevation;
        const edgeDist = Math.min(x, y, state.grid.cols - 1 - x, state.grid.rows - 1 - y);
        if (edgeDist <= 4) {
          borderElevations.push(elevation);
        }
        if (tile.type !== "water") {
          landCount += 1;
          summitElevations.push(elevation);
          if (edgeDist >= Math.max(6, Math.floor(Math.min(state.grid.cols, state.grid.rows) * 0.12))) {
            interiorSlopes.push(slopeMap[idx] ?? 0);
          }
        }
        if (tile.type === "water") {
          continue;
        }
        let adjacentWater = false;
        const neighbors = [
          idx - 1,
          idx + 1,
          idx - state.grid.cols,
          idx + state.grid.cols
        ];
        if (x === 0) {
          neighbors[0] = idx;
        }
        if (x === state.grid.cols - 1) {
          neighbors[1] = idx;
        }
        if (y === 0) {
          neighbors[2] = idx;
        }
        if (y === state.grid.rows - 1) {
          neighbors[3] = idx;
        }
        for (let n = 0; n < neighbors.length; n += 1) {
          const nIdx = neighbors[n]!;
          if (nIdx === idx) {
            adjacentWater = true;
            break;
          }
          if (state.tiles[nIdx]?.type === "water") {
            adjacentWater = true;
            break;
          }
        }
        if (adjacentWater) {
          coastalAboveSea.push(Math.max(0, elevation - seaLevelMap[idx]));
          coastalSlopes.push(slopeMap[idx] ?? 0);
        }
      }
    }
    console.log(
      `MapGen elevation: min=${elevMin.toFixed(3)} max=${elevMax.toFixed(3)} mean=${mean.toFixed(3)} water=${waterShare.toFixed(1)}%`
    );
    console.log(
      `[terrainshape] archetype=${mapSettings.terrainArchetype} embayment=${mapSettings.embayment.toFixed(2)} anisotropy=${mapSettings.anisotropy.toFixed(2)} asymmetry=${mapSettings.asymmetry.toFixed(2)} ridgeAlignment=${mapSettings.ridgeAlignment.toFixed(2)} uplandDistribution=${mapSettings.uplandDistribution.toFixed(2)} land=${((landCount / Math.max(1, totalTiles)) * 100).toFixed(1)}% borderP90=${quantile(borderElevations, 0.9).toFixed(3)} coastAboveSeaP50=${quantile(coastalAboveSea, 0.5).toFixed(3)} coastSlopeP90=${quantile(coastalSlopes, 0.9).toFixed(3)} interiorSlopeP90=${quantile(interiorSlopes, 0.9).toFixed(3)} summitP95=${quantile(summitElevations, 0.95).toFixed(3)} summitP99=${quantile(summitElevations, 0.99).toFixed(3)}`
    );
  }
  if (debug) {
    const typeIds = new Uint8Array(totalTiles);
    for (let i = 0; i < totalTiles; i += 1) {
      typeIds[i] = TILE_TYPE_IDS[state.tiles[i].type];
    }
    await debug.onPhase({
      phase: "biome:classify",
      elevations: Float32Array.from(elevationMap),
      tileTypes: typeIds,
      riverMask: Uint8Array.from(riverMask)
    });
    if (debug.waitForStep) {
      await debug.waitForStep();
    }
  }

  const waterDistanceCap = MOISTURE_WATER_DIST_CAP;
  if (report) {
    await report("Charting shoreline distance...", 0.72);
  }
  const waterDistMap = await computeWaterDistances(
    state,
    waterDistanceCap,
    report
      ? async (message, progress) => {
          await report(message, 0.72 + progress * 0.08);
        }
      : undefined,
    yieldIfNeeded
  );

  const moistureMap = await buildMoistureMap(
    state,
    waterDistMap,
    waterDistanceCap,
    report
      ? async (message, progress) => {
          await report(message, 0.8 + progress * 0.08);
        }
      : undefined,
    yieldIfNeeded
  );
  state.tileRiverMask = riverMask;

  const computeStemDensity = (type: TileType, canopyCover: number, x: number, y: number): number => {
    if (canopyCover <= 0) {
      return 0;
    }
    const jitter = (hash2D(x, y, state.seed + 1729) - 0.5) * 2;
    if (type === "forest") {
      const base = 2 + canopyCover * 9;
      return Math.round(clamp(base + jitter * 2, 0, 12));
    }
    if (type === "grass" || type === "scrub" || type === "floodplain") {
      const base = canopyCover * 3;
      return Math.round(clamp(base + jitter, 0, 3));
    }
    return 0;
  };

  for (let i = 0; i < state.tiles.length; i += 1) {
    const tile = state.tiles[i];
    const x = i % state.grid.cols;
    const y = Math.floor(i / state.grid.cols);
    if (oceanMask[i]) {
      tile.type = "water";
      clearVegetationState(tile);
      tile.dominantTreeType = null;
      tile.treeType = null;
      tile.moisture = moistureMap[i];
      continue;
    }
    if (riverMask[i] > 0) {
      tile.type = "water";
      clearVegetationState(tile);
      tile.dominantTreeType = null;
      tile.treeType = null;
      tile.moisture = moistureMap[i];
      continue;
    }
    const elevation = tile.elevation;
    const valley = state.valleyMap[i];
    const slope = slopeMap[i];
    const slopeAngleDeg = computeRenderedSlopeAngleDeg(
      slope,
      state.grid.cols,
      state.grid.rows,
      mapSettings.heightScaleMultiplier
    );
    const seaLevel = seaLevelMap[i];
    const moisture = moistureMap[i];
    const forestNoise = forestNoiseMap[i];
    const waterDistM = tile.waterDist * cellSizeM;
    const nextType = classifyTile({
      elevation,
      slope,
      waterDistM,
      valley,
      moisture,
      forestNoise,
      seaLevel,
      forestThreshold: mapSettings.forestThreshold,
      highlandForestElevation: mapSettings.highlandForestElevation,
      slopeAngleDeg
    });
    tile.type = nextType;
    tile.moisture = moisture;

    let canopyCover = 0;
    if (nextType === "forest" || nextType === "grass" || nextType === "scrub" || nextType === "floodplain") {
      const micro = microMap[i];
      const meadowMask = meadowMaskMap[i];
      const grassCanopyBase =
        (mapSettings.grassCanopyBase + micro * mapSettings.grassCanopyRange) *
        (1 - meadowMask * mapSettings.meadowStrength);
      const valleyDry = valley > 0.1 && elevation < 0.6;
      const canopyBase = nextType === "forest" ? 0.55 + micro * 0.55 : grassCanopyBase - (valleyDry ? 0.08 : 0);
      canopyCover = clamp(canopyBase, 0, 1);
    }
    tile.canopy = canopyCover;
    tile.canopyCover = canopyCover;
    tile.stemDensity = computeStemDensity(nextType, canopyCover, x, y);

    if (yieldIfNeeded && report && i % state.grid.cols === state.grid.cols - 1) {
      if (await yieldIfNeeded()) {
        const row = Math.floor(i / state.grid.cols);
        await report("Classifying terrain...", 0.88 + (row + 1) / state.grid.rows * 0.05);
      }
    }
  }
  for (let i = 0; i < state.tiles.length; i += 1) {
    const tile = state.tiles[i];
    if (
      tile.type === "water" &&
      oceanMask[i] &&
      riverMask[i] === 0 &&
      (state.tileCoastClass[i] ?? COAST_CLASS_NONE) !== COAST_CLASS_SHELF_WATER
    ) {
      tile.elevation = shapeOceanFloorAtSeaLevel(tile.elevation, seaLevelMap[i] ?? tile.elevation, rng.next());
    }
  }
  assertEdgeWater(state);

  if (report) {
    await report("Placing communities...", 0.93);
  }
  state.basePoint = findBasePoint(state);
  if (state.tileRoadBridge.length !== state.grid.totalTiles) {
    state.tileRoadBridge = new Uint8Array(state.grid.totalTiles);
  } else {
    state.tileRoadBridge.fill(0);
  }
  if (state.tileRoadEdges.length !== state.grid.totalTiles) {
    state.tileRoadEdges = new Uint8Array(state.grid.totalTiles);
  } else {
    state.tileRoadEdges.fill(0);
  }
  if (state.tileRoadWallEdges.length !== state.grid.totalTiles) {
    state.tileRoadWallEdges = new Uint8Array(state.grid.totalTiles);
  } else {
    state.tileRoadWallEdges.fill(0);
  }

  for (let y = -2; y <= 2; y += 1) {
    for (let x = -2; x <= 2; x += 1) {
      const nx = state.basePoint.x + x;
      const ny = state.basePoint.y + y;
      if (inBounds(state.grid, nx, ny) && Math.hypot(x, y) <= 2.2) {
        const idx = indexFor(state.grid, nx, ny);
        state.tiles[idx].type = "base";
        state.tiles[idx].isBase = true;
        clearVegetationState(state.tiles[idx]);
        state.tiles[idx].dominantTreeType = null;
        state.tiles[idx].treeType = null;
      }
    }
  }

  const legacySettlementPlan = createSettlementPlacementPlan({
    heightScaleMultiplier: mapSettings.heightScaleMultiplier,
    diagonalPenalty: mapSettings.road.diagonalPenalty,
    pruneRedundantDiagonals: mapSettings.road.pruneRedundantDiagonals,
    bridgeTransitions: mapSettings.road.bridgeTransitions,
    townDensity: mapSettings.townDensity,
    bridgeAllowance: mapSettings.bridgeAllowance,
    settlementSpacing: mapSettings.settlementSpacing,
    roadStrictness: mapSettings.roadStrictness,
    roadMaxGrade: mapSettings.roadMaxGrade
  });
  resetRoadGenerationStats();
  connectSettlementsByRoad(state, rng, legacySettlementPlan);
  flattenSettlementGround(state);

  for (let i = 0; i < state.tiles.length; i += 1) {
    if (riverMask[i] === 0) {
      continue;
    }
    const tile = state.tiles[i];
    tile.type = "water";
    clearVegetationState(tile);
    tile.dominantTreeType = null;
    tile.treeType = null;
    tile.isBase = false;
  }

  seedInitialVegetationState(state, null, microMap, meadowMaskMap);
  assignForestComposition(state);
  state.vegetationRevision += 1;

  state.totalLandTiles = 0;
  state.tiles.forEach((tile) => {
    applyFuel(tile, tile.moisture, rng);
    if (tile.type !== "water" && !tile.isBase) {
      state.totalLandTiles += 1;
    }
  });

  state.colorNoiseMap = Array.from({ length: state.grid.totalTiles }, () => 0.5);
  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = indexFor(state.grid, x, y);
      const worldX = getWorldX(mapSettings, x);
      const worldY = getWorldY(mapSettings, y);
      const low = fractalNoise(worldX / (14 * cellSizeM), worldY / (14 * cellSizeM), state.seed + 801);
      const broad = fractalNoise(worldX / (38 * cellSizeM), worldY / (38 * cellSizeM), state.seed + 1001);
      state.colorNoiseMap[idx] = clamp(low * 0.65 + broad * 0.35, 0, 1);
    }
    if (report && (await yieldIfNeeded())) {
      await report("Coloring terrain...", 0.97 + (y + 1) / state.grid.rows * 0.03);
    }
  }

  state.burnedTiles = 0;
  state.containedCount = 0;
  state.terrainDirty = true;
  markTileSoADirty(state);
  if (report) {
    await report("Finalizing map...", 1);
  }
}

const buildTypeIdsFromState = (state: WorldState): Uint8Array => {
  const ids = new Uint8Array(state.grid.totalTiles);
  for (let i = 0; i < state.grid.totalTiles; i += 1) {
    ids[i] = TILE_TYPE_IDS[state.tiles[i]?.type ?? "grass"];
  }
  return ids;
};

const emitStageSnapshot = async (ctx: MapGenContext, phase: MapGenDebugPhase): Promise<void> => {
  if (!ctx.debug || !ctx.elevationMap) {
    return;
  }
  await ctx.debug.onPhase({
    phase,
    elevations: Float32Array.from(ctx.elevationMap),
    tileTypes: buildTypeIdsFromState(ctx.state),
    riverMask: ctx.riverMask ? Uint8Array.from(ctx.riverMask) : undefined,
    oceanMask: ctx.oceanMask ? Uint8Array.from(ctx.oceanMask) : undefined,
    seaLevel: ctx.seaLevelMap ? Float32Array.from(ctx.seaLevelMap) : undefined,
    coastDistance: ctx.state.tileCoastDistance.length > 0 ? Uint16Array.from(ctx.state.tileCoastDistance) : undefined,
    coastClass: ctx.state.tileCoastClass.length > 0 ? Uint8Array.from(ctx.state.tileCoastClass) : undefined
  });
  if (ctx.debug.waitForStep) {
    await ctx.debug.waitForStep();
  }
};

const createBlankTile = (elevation: number): Tile => ({
  type: "grass",
  fuel: 0,
  fire: 0,
  isBase: false,
  elevation,
  heat: 0,
  ignitionPoint: 0,
  burnRate: 0,
  heatOutput: 0,
  spreadBoost: 0,
  heatTransferCap: 0,
  heatRetention: 1,
  windFactor: 0,
  moisture: 0,
  waterDist: 0,
  vegetationAgeYears: 0,
  canopy: 0,
  canopyCover: 0,
  stemDensity: 0,
  dominantTreeType: null,
  treeType: null,
  houseValue: 0,
  houseResidents: 0,
  houseDestroyed: false,
  ashAge: 0
});

export const buildSlopeMap = (state: WorldState, elevationMap: number[]): Float32Array => {
  const slopeMap = new Float32Array(state.grid.totalTiles);
  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = indexFor(state.grid, x, y);
      const e = elevationMap[idx] ?? 0;
      let maxDiff = 0;
      if (y > 0) {
        maxDiff = Math.max(maxDiff, Math.abs(e - (elevationMap[idx - state.grid.cols] ?? e)));
      }
      if (y < state.grid.rows - 1) {
        maxDiff = Math.max(maxDiff, Math.abs(e - (elevationMap[idx + state.grid.cols] ?? e)));
      }
      if (x > 0) {
        maxDiff = Math.max(maxDiff, Math.abs(e - (elevationMap[idx - 1] ?? e)));
      }
      if (x < state.grid.cols - 1) {
        maxDiff = Math.max(maxDiff, Math.abs(e - (elevationMap[idx + 1] ?? e)));
      }
      slopeMap[idx] = clamp(maxDiff, 0, 1);
    }
  }
  return slopeMap;
};

export const computeStemDensityForTile = (state: WorldState, type: TileType, canopyCover: number, x: number, y: number): number => {
  if (canopyCover <= 0) {
    return 0;
  }
  const jitter = (hash2D(x, y, state.seed + 1729) - 0.5) * 2;
  if (type === "forest") {
    const base = 2 + canopyCover * 9;
    return Math.round(clamp(base + jitter * 2, 0, 12));
  }
  if (type === "grass" || type === "scrub" || type === "floodplain") {
    const base = canopyCover * 3;
    return Math.round(clamp(base + jitter, 0, 3));
  }
  return 0;
};

const computeMoistureValue = (elevation: number, waterDist: number): number => {
  const maxDistance = Math.max(1, Math.min(0xffff - 1, Math.floor(MOISTURE_WATER_DIST_CAP)));
  const dryRange = Math.max(0.0001, MOISTURE_ELEV_DRY_RANGE);
  const gamma = Math.max(0.01, MOISTURE_GAMMA);
  const dNorm = clamp(waterDist / maxDistance, 0, 1);
  let moisture = 1 - dNorm;
  const eNorm = clamp((elevation - MOISTURE_ELEV_WET_REF) / dryRange, 0, 1);
  moisture = clamp(moisture - eNorm * MOISTURE_ELEV_DRYNESS_WEIGHT, 0, 1);
  return clamp(Math.pow(moisture, gamma), 0, 1);
};

type BiomeSample = {
  micro: number;
  forestNoise: number;
  meadowMask: number;
};

const buildBiomeSamples = async (ctx: MapGenContext): Promise<BiomeSample[] | null> => {
  const { state, biomeBlock, cellSizeM, worldOffsetXM, worldOffsetYM, microScaleM } = ctx;
  const blockCols = Math.ceil(state.grid.cols / biomeBlock);
  const blockRows = Math.ceil(state.grid.rows / biomeBlock);
  if (biomeBlock <= 1) {
    return null;
  }
  const samples = new Array<BiomeSample>(blockCols * blockRows);
  for (let by = 0; by < blockRows; by += 1) {
    const sampleY = (by + 0.5) * biomeBlock;
    for (let bx = 0; bx < blockCols; bx += 1) {
      const sampleX = (bx + 0.5) * biomeBlock;
      const worldX = worldOffsetXM + sampleX * cellSizeM;
      const worldY = worldOffsetYM + sampleY * cellSizeM;
      const micro = fractalNoise(worldX / microScaleM, worldY / microScaleM, state.seed + 211);
      const forestMacro = fractalNoise(worldX / ctx.forestMacroScaleM, worldY / ctx.forestMacroScaleM, state.seed + 415);
      const forestDetail = fractalNoise(
        worldX / ctx.forestDetailScaleM,
        worldY / ctx.forestDetailScaleM,
        state.seed + 619
      );
      const forestNoise = forestMacro * FOREST_MACRO_WEIGHT + forestDetail * FOREST_DETAIL_WEIGHT;
      const meadowNoise = fractalNoise(worldX / ctx.meadowScaleM, worldY / ctx.meadowScaleM, state.seed + 933);
      const meadowMask = clamp(
        (meadowNoise - ctx.settings.meadowThreshold) / (1 - ctx.settings.meadowThreshold),
        0,
        1
      );
      samples[by * blockCols + bx] = { micro, forestNoise, meadowMask };
    }
    if (await ctx.yieldIfNeeded()) {
      await ctx.reportStage("Seeding biome fields...", (by + 1) / blockRows);
    }
  }
  return samples;
};

async function runHydrologyStage(ctx: MapGenContext): Promise<void> {
  const { state, settings } = ctx;
  const elevationMap = ctx.elevationMap;
  const riverMask = ctx.riverMask;
  if (!elevationMap || !riverMask) {
    throw new Error("Hydrology stage missing elevation/river inputs.");
  }

  const totalTiles = state.grid.totalTiles;
  const seaLevelMap = new Float32Array(totalTiles);
  ctx.seaLevelMap = seaLevelMap;
  const seaLevel = clampSeaLevel(ctx.seaLevelBase, settings);

  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = indexFor(state.grid, x, y);
      seaLevelMap[idx] = seaLevel;
      const elevation = elevationMap[idx] ?? 0;
      const tile = createBlankTile(elevation);
      tile.type = elevation < seaLevel ? "water" : "grass";
      state.tiles[idx] = tile;
    }
    if (await ctx.yieldIfNeeded()) {
      await ctx.reportStage("Solving coastlines...", (y + 1) / state.grid.rows * 0.7);
    }
  }
  persistSeaLevelMapToState(state, seaLevelMap);

  for (let i = 0; i < riverMask.length; i += 1) {
    if (riverMask[i] > 0) {
      state.tiles[i].type = "water";
    }
  }

  let oceanMask = buildOceanMask(state);
  let oceanMaskCount = countMaskTiles(oceanMask);
  if (oceanMaskCount === 0) {
    oceanMask = buildOceanMaskFromElevation(state, elevationMap, seaLevelMap);
    oceanMaskCount = countMaskTiles(oceanMask);
  }
  if (oceanMaskCount === 0) {
    oceanMask = buildLargestWaterMask(state);
    oceanMaskCount = countMaskTiles(oceanMask);
  }
  oceanMask = enforceEdgeOceanMask(state, elevationMap, seaLevelMap, oceanMask, riverMask);
  oceanMaskCount = countMaskTiles(oceanMask);
  const oceanLevel = oceanMaskCount > 0 ? computeOceanLevel(elevationMap, oceanMask, riverMask) : null;
  if (oceanLevel !== null) {
    oceanMask = expandOceanMaskByElevation(state, elevationMap, seaLevelMap, oceanMask, riverMask, oceanLevel);
    for (let i = 0; i < state.tiles.length; i += 1) {
      if (oceanMask[i]) {
        state.tiles[i].type = "water";
      }
    }
  }

  if (DISABLE_DISCONNECTED_INLAND_WATER && oceanMaskCount > 0) {
    for (let i = 0; i < state.tiles.length; i += 1) {
      if (oceanMask[i] || riverMask[i] > 0) {
        continue;
      }
      const tile = state.tiles[i];
      const belowOceanLevel = oceanLevel !== null && (elevationMap[i] ?? 0) < oceanLevel;
      if (tile.type !== "water" && !belowOceanLevel) {
        continue;
      }
      const seaLevel = seaLevelMap[i] ?? 0;
      const floorLevel = oceanLevel !== null ? Math.max(seaLevel, oceanLevel) : seaLevel;
      const nextElevation = Math.max(elevationMap[i] ?? seaLevel, floorLevel + 0.002);
      elevationMap[i] = nextElevation;
      tile.elevation = nextElevation;
      tile.type = "grass";
    }
  }

  ctx.oceanMask = oceanMask;
  for (let i = 0; i < totalTiles; i += 1) {
    state.tileOceanMask[i] = oceanMask[i] > 0 ? 1 : 0;
    state.tileCoastDistance[i] = 0;
    state.tileCoastClass[i] = COAST_CLASS_NONE;
  }
  state.tileRiverMask = riverMask;
  await ctx.reportStage("Hydrology solved.", 1);
  await emitStageSnapshot(ctx, "hydro:solve");
}


async function runRiverStage(ctx: MapGenContext): Promise<void> {
  const { state, settings, elevationMap, seaLevelMap, oceanMask, riverMask } = ctx;
  if (!elevationMap || !seaLevelMap || !oceanMask || !riverMask) {
    throw new Error("River stage missing terrain or shoreline fields.");
  }

  const total = state.grid.totalTiles;
  riverMask.fill(0);
  if (state.tileRiverMask.length !== total) {
    state.tileRiverMask = new Uint8Array(total);
  } else {
    state.tileRiverMask.fill(0);
  }
  if (state.tileRiverBed.length !== total) {
    state.tileRiverBed = new Float32Array(total).fill(Number.NaN);
  } else {
    state.tileRiverBed.fill(Number.NaN);
  }
  if (state.tileRiverSurface.length !== total) {
    state.tileRiverSurface = new Float32Array(total).fill(Number.NaN);
  } else {
    state.tileRiverSurface.fill(Number.NaN);
  }
  if (state.tileRiverStepStrength.length !== total) {
    state.tileRiverStepStrength = new Float32Array(total);
  } else {
    state.tileRiverStepStrength.fill(0);
  }

  await ctx.reportStage("Routing rivers to final coast...", 0.2);
  carveRiverValleys(
    state,
    ctx.rng,
    elevationMap,
    riverMask,
    clamp(settings.valleyDepth, 0.4, 3),
    settings.riverWaterBias,
    settings,
    seaLevelMap,
    oceanMask
  );

  for (let i = 0; i < total; i += 1) {
    state.tiles[i].elevation = elevationMap[i] ?? state.tiles[i].elevation;
    if (riverMask[i] > 0) {
      state.tiles[i].type = "water";
      clearVegetationState(state.tiles[i]);
      state.tiles[i].dominantTreeType = null;
      state.tiles[i].treeType = null;
      state.tiles[i].isBase = false;
    }
  }
  const protectedRiverWater = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) {
    protectedRiverWater[i] = oceanMask[i] > 0 || riverMask[i] > 0 ? 1 : 0;
  }
  suppressIsolatedElevationSpikes(elevationMap, state.grid.cols, state.grid.rows, protectedRiverWater);
  for (let i = 0; i < total; i += 1) {
    const resolvedElevation = elevationMap[i] ?? state.tiles[i].elevation;
    state.tiles[i].elevation = resolvedElevation;
    state.tileElevation[i] = resolvedElevation;
  }
  state.tileRiverMask = riverMask;
  clampRiverMouthDepthsToSeaLevel(state, oceanMask, riverMask, seaLevelMap);
  await ctx.reportStage("Rivers carved.", 1);
  await emitStageSnapshot(ctx, "hydro:rivers");
}

async function runBiomeFieldsStage(ctx: MapGenContext): Promise<void> {
  const { state, elevationMap } = ctx;
  if (!elevationMap) {
    throw new Error("Biome field stage missing elevation map.");
  }
  ctx.slopeMap = buildSlopeMap(state, elevationMap);

  const totalTiles = state.grid.totalTiles;
  const microMap = new Float32Array(totalTiles);
  const forestNoiseMap = new Float32Array(totalTiles);
  const meadowMaskMap = new Float32Array(totalTiles);
  ctx.microMap = microMap;
  ctx.forestNoiseMap = forestNoiseMap;
  ctx.meadowMaskMap = meadowMaskMap;

  const blockCols = Math.ceil(state.grid.cols / ctx.biomeBlock);
  const biomeSamples = await buildBiomeSamples(ctx);
  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = indexFor(state.grid, x, y);
      let micro = 0.5;
      let forestNoise = 0.5;
      let meadowMask = 0;
      if (ctx.biomeBlock > 1 && biomeSamples) {
        const bx = Math.floor(x / ctx.biomeBlock);
        const by = Math.floor(y / ctx.biomeBlock);
        const sample = biomeSamples[by * blockCols + bx];
        micro = sample?.micro ?? 0.5;
        forestNoise = sample?.forestNoise ?? 0.5;
        meadowMask = sample?.meadowMask ?? 0;
      } else {
        const worldX = ctx.worldOffsetXM + x * ctx.cellSizeM;
        const worldY = ctx.worldOffsetYM + y * ctx.cellSizeM;
        micro = fractalNoise(worldX / ctx.microScaleM, worldY / ctx.microScaleM, state.seed + 211);
        const forestMacro = fractalNoise(worldX / ctx.forestMacroScaleM, worldY / ctx.forestMacroScaleM, state.seed + 415);
        const forestDetail = fractalNoise(
          worldX / ctx.forestDetailScaleM,
          worldY / ctx.forestDetailScaleM,
          state.seed + 619
        );
        forestNoise = forestMacro * FOREST_MACRO_WEIGHT + forestDetail * FOREST_DETAIL_WEIGHT;
        const meadowNoise = fractalNoise(worldX / ctx.meadowScaleM, worldY / ctx.meadowScaleM, state.seed + 933);
        meadowMask = clamp(
          (meadowNoise - ctx.settings.meadowThreshold) / (1 - ctx.settings.meadowThreshold),
          0,
          1
        );
      }
      microMap[idx] = micro;
      forestNoiseMap[idx] = forestNoise;
      meadowMaskMap[idx] = meadowMask;
    }
    if (await ctx.yieldIfNeeded()) {
      await ctx.reportStage("Deriving biome fields...", (y + 1) / state.grid.rows * 0.6);
    }
  }

  const waterDistMap = await computeWaterDistances(
    state,
    MOISTURE_WATER_DIST_CAP,
    async (message, progress) => ctx.reportStage(message, 0.6 + progress * 0.2),
    ctx.yieldIfNeeded
  );
  ctx.waterDistMap = waterDistMap;
  const moistureMap = await buildMoistureMap(
    state,
    waterDistMap,
    MOISTURE_WATER_DIST_CAP,
    async (message, progress) => ctx.reportStage(message, 0.8 + progress * 0.2),
    ctx.yieldIfNeeded
  );
  ctx.moistureMap = moistureMap;
  await emitStageSnapshot(ctx, "biome:fields");
}

async function runBiomeSpreadStage(ctx: MapGenContext): Promise<void> {
  if (ctx.settings.biomeClassifierMode === "legacy") {
    ctx.biomeSuitabilityMap = null;
    ctx.elevationStressMap = null;
    ctx.slopeStressMap = null;
    ctx.treeSuitabilityMap = null;
    ctx.treeProbabilityMap = null;
    ctx.treeDensityMap = null;
    ctx.forestMask = null;
    await ctx.reportStage("Biome spread skipped (legacy mode).", 1);
    await emitStageSnapshot(ctx, "biome:spread");
    return;
  }

  await ctx.reportStage("Scoring biome suitability...", 0.35);
  const suitability = buildBiomeSuitability(ctx);
  ctx.biomeSuitabilityMap = suitability;

  await ctx.reportStage("Growing forest stands...", 0.7);
  ctx.forestMask = buildForestMask(ctx, suitability);
  await ctx.reportStage("Biome spread solved.", 1);
  await emitStageSnapshot(ctx, "biome:spread");
}

async function runBiomeClassificationStage(ctx: MapGenContext): Promise<void> {
  const {
    state,
    settings,
    oceanMask,
    riverMask,
    seaLevelMap,
    slopeMap,
    moistureMap,
    forestNoiseMap,
    microMap,
    meadowMaskMap,
    biomeSuitabilityMap,
    forestMask
  } = ctx;
  if (
    !oceanMask ||
    !riverMask ||
    !seaLevelMap ||
    !slopeMap ||
    !moistureMap ||
    !forestNoiseMap ||
    !microMap ||
    !meadowMaskMap
  ) {
    throw new Error("Biome classification stage missing derived fields.");
  }

  const useSeedSpread = settings.biomeClassifierMode === "seedSpread";
  if (useSeedSpread && (!biomeSuitabilityMap || !forestMask)) {
    throw new Error("Seed-spread biome classification missing spread maps.");
  }

  const nextTypes: TileType[] = new Array(state.grid.totalTiles);
  const nextMoisture = new Float32Array(state.grid.totalTiles);
  const nextCanopy = new Float32Array(state.grid.totalTiles);
  const nextStemDensity = new Uint8Array(state.grid.totalTiles);
  const yieldEveryRows = getYieldEveryRows(state.grid.cols);

  for (let y = 0; y < state.grid.rows; y += 1) {
    const rowBase = y * state.grid.cols;
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = rowBase + x;
      const tile = state.tiles[idx];
      const moisture = moistureMap[idx] ?? 0;
      nextMoisture[idx] = moisture;
      if (oceanMask[idx] || riverMask[idx] > 0) {
        nextTypes[idx] = "water";
        nextCanopy[idx] = 0;
        nextStemDensity[idx] = 0;
        continue;
      }

      const elevation = tile.elevation;
      const valley = state.valleyMap[idx] ?? 0;
      const slope = slopeMap[idx] ?? 0;
      const slopeAngleDeg = computeRenderedSlopeAngleDeg(
        slope,
        state.grid.cols,
        state.grid.rows,
        settings.heightScaleMultiplier
      );
      const seaLevel = seaLevelMap[idx] ?? 0;
      const waterDistM = tile.waterDist * ctx.cellSizeM;
      const coastlineOverride = classifyOceanCoastTile(
        state,
        idx,
        oceanMask,
        riverMask,
        seaLevelMap,
        slope,
        elevation
      );
      const nextType =
        coastlineOverride ??
        (useSeedSpread
          ? classifySeedSpreadTile({
              elevation,
              slope,
              waterDistM,
              valley,
              moisture,
              seaLevel,
              highlandForestElevation: settings.highlandForestElevation,
              forestCandidate: (forestMask?.[idx] ?? 0) > 0,
              slopeAngleDeg
            })
          : classifyTile({
              elevation,
              slope,
              waterDistM,
              valley,
              moisture,
              forestNoise: forestNoiseMap[idx] ?? 0.5,
              seaLevel,
              forestThreshold: settings.forestThreshold,
              highlandForestElevation: settings.highlandForestElevation,
              slopeAngleDeg
            }));
      nextTypes[idx] = nextType;

      let canopyCover = 0;
      if (nextType === "forest" || nextType === "grass" || nextType === "scrub" || nextType === "floodplain") {
        const micro = microMap[idx] ?? 0;
        const grassCanopyBase =
          (settings.grassCanopyBase + micro * settings.grassCanopyRange) *
          (1 - (meadowMaskMap[idx] ?? 0) * settings.meadowStrength);
        const valleyDry = valley > 0.1 && elevation < 0.6;
        if (nextType === "forest" && useSeedSpread) {
          canopyCover = clamp(0.48 + 0.42 * (biomeSuitabilityMap?.[idx] ?? 0) + 0.1 * micro, 0, 1);
        } else {
          const canopyBase = nextType === "forest" ? 0.55 + micro * 0.55 : grassCanopyBase - (valleyDry ? 0.08 : 0);
          canopyCover = clamp(canopyBase, 0, 1);
        }
      }
      nextCanopy[idx] = canopyCover;
      nextStemDensity[idx] = computeStemDensityForTile(state, nextType, canopyCover, x, y);
    }
    if ((y === state.grid.rows - 1 || (y + 1) % yieldEveryRows === 0) && (await ctx.yieldIfNeeded())) {
      await ctx.reportStage("Classifying terrain...", ((y + 1) / state.grid.rows) * 0.8);
    }
  }

  for (let y = 0; y < state.grid.rows; y += 1) {
    const rowBase = y * state.grid.cols;
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = rowBase + x;
      const tile = state.tiles[idx];
      tile.type = nextTypes[idx] ?? tile.type;
      tile.moisture = nextMoisture[idx] ?? tile.moisture;
      tile.canopy = nextCanopy[idx] ?? 0;
      tile.canopyCover = tile.canopy;
      tile.stemDensity = nextStemDensity[idx] ?? 0;
      const seaLevel = seaLevelMap[idx] ?? tile.elevation;
      if (
        tile.type === "water" &&
        oceanMask[idx] &&
        riverMask[idx] === 0 &&
        (state.tileCoastClass[idx] ?? COAST_CLASS_NONE) !== COAST_CLASS_SHELF_WATER
      ) {
        tile.elevation = shapeOceanFloorAtSeaLevel(
          tile.elevation,
          seaLevel,
          ctx.rng.next()
        );
      } else if (tile.type !== "water" && riverMask[idx] === 0 && tile.elevation <= seaLevel + COAST_LOCAL_SEA_MARGIN) {
        tile.elevation = seaLevel + COAST_MIN_LAND_ABOVE_SEA;
      }
      if (ctx.elevationMap) {
        ctx.elevationMap[idx] = tile.elevation;
      }
    }
    if ((y === state.grid.rows - 1 || (y + 1) % yieldEveryRows === 0) && (await ctx.yieldIfNeeded())) {
      await ctx.reportStage("Classifying terrain...", 0.8 + ((y + 1) / state.grid.rows) * 0.2);
    }
  }

  seedInitialVegetationState(state, biomeSuitabilityMap, microMap, meadowMaskMap);
  assignForestComposition(state);
  assertEdgeWater(state);
  await emitStageSnapshot(ctx, "biome:classify");
}

async function runSettlementPlacementStage(ctx: MapGenContext): Promise<void> {
  const { state } = ctx;
  const beforeType = new Uint8Array(state.grid.totalTiles);
  const beforeElevation = new Float32Array(state.grid.totalTiles);
  for (let i = 0; i < state.grid.totalTiles; i += 1) {
    beforeType[i] = TILE_TYPE_IDS[state.tiles[i]?.type ?? "grass"];
    beforeElevation[i] = state.tiles[i]?.elevation ?? 0;
  }
  ctx.settlementSnapshot = { typeBefore: beforeType, elevationBefore: beforeElevation };

  state.basePoint = findBasePoint(state);
  if (state.tileRoadBridge.length !== state.grid.totalTiles) {
    state.tileRoadBridge = new Uint8Array(state.grid.totalTiles);
  } else {
    state.tileRoadBridge.fill(0);
  }
  if (state.tileRoadEdges.length !== state.grid.totalTiles) {
    state.tileRoadEdges = new Uint8Array(state.grid.totalTiles);
  } else {
    state.tileRoadEdges.fill(0);
  }
  if (state.tileRoadWallEdges.length !== state.grid.totalTiles) {
    state.tileRoadWallEdges = new Uint8Array(state.grid.totalTiles);
  } else {
    state.tileRoadWallEdges.fill(0);
  }
  for (let y = -2; y <= 2; y += 1) {
    for (let x = -2; x <= 2; x += 1) {
      const nx = state.basePoint.x + x;
      const ny = state.basePoint.y + y;
      if (inBounds(state.grid, nx, ny) && Math.hypot(x, y) <= 2.2) {
        const idx = indexFor(state.grid, nx, ny);
        const tile = state.tiles[idx];
        tile.type = "base";
        tile.isBase = true;
        clearVegetationState(tile);
        tile.dominantTreeType = null;
        tile.treeType = null;
      }
    }
  }

  await ctx.reportStage("Planning settlements...", 0.4);
  ctx.settlementPlan = createSettlementPlacementPlan({
    heightScaleMultiplier: ctx.settings.heightScaleMultiplier,
    diagonalPenalty: ctx.settings.road.diagonalPenalty,
    pruneRedundantDiagonals: ctx.settings.road.pruneRedundantDiagonals,
    bridgeTransitions: ctx.settings.road.bridgeTransitions,
    townDensity: ctx.settings.townDensity,
    bridgeAllowance: ctx.settings.bridgeAllowance,
    settlementSpacing: ctx.settings.settlementSpacing,
    roadStrictness: ctx.settings.roadStrictness,
    roadMaxGrade: ctx.settings.roadMaxGrade
  });

  await ctx.reportStage("Settlement plan ready.", 1);
  await emitStageSnapshot(ctx, "settlement:place");
}

async function runRoadNetworkStage(ctx: MapGenContext): Promise<void> {
  resetRoadGenerationStats();
  connectSettlementsByRoad(ctx.state, ctx.rng, ctx.settlementPlan ?? null);
  flattenSettlementGround(ctx.state);
  let roadSurfaceMetrics = gradeRoadNetworkTerrain(ctx.state, ctx.settings.heightScaleMultiplier);
  flattenSettlementGround(ctx.state);
  roadSurfaceMetrics = gradeRoadNetworkTerrain(ctx.state, ctx.settings.heightScaleMultiplier);
  if (ctx.riverMask) {
    for (let i = 0; i < ctx.state.tiles.length; i += 1) {
      if (ctx.riverMask[i] === 0) {
        continue;
      }
      const tile = ctx.state.tiles[i];
      tile.type = "water";
      clearVegetationState(tile);
      tile.dominantTreeType = null;
      tile.treeType = null;
      tile.isBase = false;
    }
  }
  seedInitialVegetationState(ctx.state, ctx.biomeSuitabilityMap, ctx.microMap, ctx.meadowMaskMap);
  assignForestComposition(ctx.state);
  if (DEBUG_TERRAIN) {
    const stats = getRoadGenerationStats();
    const finalMetrics: RoadSurfaceMetrics = roadSurfaceMetrics;
    console.log(
      `[roadsurface] maxGrade=${finalMetrics.maxRoadGrade.toFixed(3)} maxCrossfall=${finalMetrics.maxRoadCrossfall.toFixed(3)} maxGradeChange=${finalMetrics.maxRoadGradeChange.toFixed(3)} maxAngle=${finalMetrics.maxRoadAngleDeg.toFixed(2)} highAngle=${finalMetrics.highAngleRoadStepCount} straightSteep=${finalMetrics.longStraightSteepSegmentCount} gradingDelta=${finalMetrics.maxRoadGradingDelta.toFixed(3)} wallEdges=${finalMetrics.wallEdgeCount} routedMaxGrade=${stats.maxRealizedGrade.toFixed(3)} routedMaxCrossfall=${stats.maxRealizedCrossfall.toFixed(3)} routedMaxGradeChange=${stats.maxRealizedGradeChange.toFixed(3)} routedAngle=${stats.maxRealizedAngleDeg.toFixed(2)}/${stats.meanRealizedAngleDeg.toFixed(2)} pass=${stats.mountainPassFallbackCount} switchbackRoutes=${stats.switchbackRouteCount}/${stats.switchbackRouteAttempts} junctions=${stats.generatedJunctionCount}`
    );
  }
  await ctx.reportStage("Connecting roads...", 1);
  await emitStageSnapshot(ctx, "roads:connect");
}

async function runPostSettlementReconcileStage(ctx: MapGenContext): Promise<void> {
  const snapshot = ctx.settlementSnapshot;
  if (
    !snapshot ||
    !ctx.elevationMap ||
    !ctx.slopeMap ||
    !ctx.moistureMap ||
    !ctx.forestNoiseMap ||
    !ctx.microMap ||
    !ctx.meadowMaskMap ||
    !ctx.seaLevelMap ||
    !ctx.riverMask ||
    !ctx.oceanMask
  ) {
    await ctx.reportStage("Reconciling terrain...", 1);
    await emitStageSnapshot(ctx, "reconcile:postSettlement");
    return;
  }

  const { state } = ctx;
  ctx.dirtyRegions.clear();
  for (let i = 0; i < state.grid.totalTiles; i += 1) {
    const tile = state.tiles[i];
    const oldType = snapshot.typeBefore[i];
    const oldElevation = snapshot.elevationBefore[i] ?? 0;
    if (oldType !== TILE_TYPE_IDS[tile.type] || Math.abs(oldElevation - tile.elevation) > 1e-5) {
      const x = i % state.grid.cols;
      const y = Math.floor(i / state.grid.cols);
      ctx.dirtyRegions.markTile(x, y, 1);
    }
  }

  const regions = ctx.dirtyRegions.getMergedRegions(1);
  if (regions.length === 0) {
    await ctx.reportStage("Reconciling terrain...", 1);
    await emitStageSnapshot(ctx, "reconcile:postSettlement");
    return;
  }

  let processed = 0;
  const total = regions.reduce((sum, region) => sum + (region.maxX - region.minX + 1) * (region.maxY - region.minY + 1), 0);
  for (const region of regions) {
    for (let y = region.minY; y <= region.maxY; y += 1) {
      for (let x = region.minX; x <= region.maxX; x += 1) {
        const idx = indexFor(state.grid, x, y);
        const tile = state.tiles[idx];
        ctx.elevationMap[idx] = tile.elevation;
        const slopeLocal = (() => {
          const center = ctx.elevationMap?.[idx] ?? tile.elevation;
          let maxDiff = 0;
          if (x > 0) {
            maxDiff = Math.max(maxDiff, Math.abs(center - (ctx.elevationMap?.[idx - 1] ?? center)));
          }
          if (x < state.grid.cols - 1) {
            maxDiff = Math.max(maxDiff, Math.abs(center - (ctx.elevationMap?.[idx + 1] ?? center)));
          }
          if (y > 0) {
            maxDiff = Math.max(maxDiff, Math.abs(center - (ctx.elevationMap?.[idx - state.grid.cols] ?? center)));
          }
          if (y < state.grid.rows - 1) {
            maxDiff = Math.max(maxDiff, Math.abs(center - (ctx.elevationMap?.[idx + state.grid.cols] ?? center)));
          }
          return clamp(maxDiff, 0, 1);
        })();
        ctx.slopeMap[idx] = slopeLocal;
        const slopeAngleDeg = computeRenderedSlopeAngleDeg(
          slopeLocal,
          state.grid.cols,
          state.grid.rows,
          ctx.settings.heightScaleMultiplier
        );
        const moisture = computeMoistureValue(tile.elevation, tile.waterDist);
        ctx.moistureMap[idx] = moisture;
        tile.moisture = moisture;

        if (ctx.oceanMask[idx] || ctx.riverMask[idx] > 0) {
          tile.type = "water";
          clearVegetationState(tile);
          tile.dominantTreeType = null;
          tile.treeType = null;
          processed += 1;
          continue;
        }
        if (tile.type === "road" || tile.type === "house" || tile.type === "base") {
          clearVegetationState(tile);
          tile.dominantTreeType = null;
          tile.treeType = null;
          processed += 1;
          continue;
        }

        const valley = state.valleyMap[idx] ?? 0;
        const seaLevel = ctx.seaLevelMap[idx] ?? 0;
        let nextType: TileType;
        const coastlineOverride = classifyOceanCoastTile(
          state,
          idx,
          ctx.oceanMask,
          ctx.riverMask,
          ctx.seaLevelMap,
          slopeLocal,
          tile.elevation
        );
        if (coastlineOverride) {
          nextType = coastlineOverride;
        } else if (ctx.settings.biomeClassifierMode === "seedSpread" && ctx.forestMask && ctx.biomeSuitabilityMap) {
          const suitability = computeBiomeSuitabilityValue({
            elevation: tile.elevation,
            slope: slopeLocal,
            moisture,
            valley,
            seaLevel,
            highlandForestElevation: ctx.settings.highlandForestElevation,
            slopeAngleDeg
          });
          ctx.biomeSuitabilityMap[idx] = suitability;
          let forestNeighborCount = 0;
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
              const nIdx = indexFor(state.grid, nx, ny);
              if (ctx.forestMask[nIdx] > 0) {
                forestNeighborCount += 1;
              }
            }
          }
          const wasForest = ctx.forestMask[idx] > 0;
          let forestCandidate = false;
          if (wasForest) {
            forestCandidate = suitability >= 0.42;
          } else if (suitability >= 0.62 && forestNeighborCount >= 2) {
            forestCandidate = true;
          }
          if (suitability < 0.3) {
            forestCandidate = false;
          }
          ctx.forestMask[idx] = forestCandidate ? 1 : 0;
          nextType = classifySeedSpreadTile({
            elevation: tile.elevation,
            slope: slopeLocal,
            waterDistM: tile.waterDist * ctx.cellSizeM,
            valley,
            moisture,
            seaLevel,
            highlandForestElevation: ctx.settings.highlandForestElevation,
            forestCandidate,
            slopeAngleDeg
          });
        } else {
          nextType = classifyTile({
            elevation: tile.elevation,
            slope: slopeLocal,
            waterDistM: tile.waterDist * ctx.cellSizeM,
            valley,
            moisture,
            forestNoise: ctx.forestNoiseMap[idx] ?? 0.5,
            seaLevel,
            forestThreshold: ctx.settings.forestThreshold,
            highlandForestElevation: ctx.settings.highlandForestElevation,
            slopeAngleDeg
          });
        }
        tile.type = nextType;
        if (tile.type !== "water" && tile.elevation <= seaLevel + COAST_LOCAL_SEA_MARGIN) {
          tile.elevation = seaLevel + COAST_MIN_LAND_ABOVE_SEA;
          ctx.elevationMap[idx] = tile.elevation;
        }
        let canopy = 0;
        if (nextType === "forest" || nextType === "grass" || nextType === "scrub" || nextType === "floodplain") {
          const grassCanopyBase =
            (ctx.settings.grassCanopyBase + (ctx.microMap[idx] ?? 0) * ctx.settings.grassCanopyRange) *
            (1 - (ctx.meadowMaskMap[idx] ?? 0) * ctx.settings.meadowStrength);
          const valleyDry = valley > 0.1 && tile.elevation < 0.6;
          if (nextType === "forest" && ctx.settings.biomeClassifierMode === "seedSpread" && ctx.biomeSuitabilityMap) {
            canopy = clamp(
              0.48 + 0.42 * (ctx.biomeSuitabilityMap[idx] ?? 0) + 0.1 * (ctx.microMap[idx] ?? 0),
              0,
              1
            );
          } else {
            canopy = clamp(
              nextType === "forest" ? 0.55 + (ctx.microMap[idx] ?? 0) * 0.55 : grassCanopyBase - (valleyDry ? 0.08 : 0),
              0,
              1
            );
          }
        }
        tile.canopy = canopy;
        tile.canopyCover = canopy;
        tile.stemDensity = computeStemDensityForTile(state, nextType, canopy, x, y);
        processed += 1;
      }
      if (await ctx.yieldIfNeeded()) {
        await ctx.reportStage("Reconciling terrain...", processed / Math.max(1, total));
      }
    }
  }
  seedInitialVegetationState(state, ctx.biomeSuitabilityMap, ctx.microMap, ctx.meadowMaskMap);
  assignForestComposition(state);
  await emitStageSnapshot(ctx, "reconcile:postSettlement");
}

async function runFinalizeStage(ctx: MapGenContext): Promise<void> {
  const { state, rng, settings, cellSizeM } = ctx;
  seedInitialVegetationState(state, ctx.biomeSuitabilityMap, ctx.microMap, ctx.meadowMaskMap);
  assignForestComposition(state);
  state.vegetationRevision += 1;
  state.totalLandTiles = 0;
  state.tiles.forEach((tile) => {
    applyFuel(tile, tile.moisture, rng);
    if (tile.type !== "water" && !tile.isBase) {
      state.totalLandTiles += 1;
    }
  });

  state.colorNoiseMap = Array.from({ length: state.grid.totalTiles }, () => 0.5);
  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = indexFor(state.grid, x, y);
      const worldX = getWorldX(settings, x);
      const worldY = getWorldY(settings, y);
      const low = fractalNoise(worldX / (14 * cellSizeM), worldY / (14 * cellSizeM), state.seed + 801);
      const broad = fractalNoise(worldX / (38 * cellSizeM), worldY / (38 * cellSizeM), state.seed + 1001);
      state.colorNoiseMap[idx] = clamp(low * 0.65 + broad * 0.35, 0, 1);
    }
    if (await ctx.yieldIfNeeded()) {
      await ctx.reportStage("Coloring terrain...", (y + 1) / state.grid.rows);
    }
  }

  state.burnedTiles = 0;
  state.containedCount = 0;
  state.terrainDirty = true;
  markTileSoADirty(state);
  await ctx.reportStage("Finalizing map...", 1);
  await emitStageSnapshot(ctx, "map:finalize");
}

