import type { RNG, Point, Tile, TileType } from "../core/types.js";
import { TreeType } from "../core/types.js";
import type { WorldState } from "../core/state.js";
import { getTerrainHeightScale } from "../core/terrainScale.js";
import { clamp } from "../core/utils.js";
import { inBounds, indexFor } from "../core/grid.js";
import {
  DOMINANT_FOREST_TYPES,
  clearVegetationState,
  computeForestTreeWeights,
  isForestType,
  isVegetationType,
  pickWeightedTreeType,
  syncDerivedVegetationState
} from "../core/vegetation.js";
import { applyFuel } from "../core/tiles.js";
import { TILE_TYPE_IDS } from "../core/state.js";
import { markTileSoADirty } from "../core/tileCache.js";
import {
  DEBUG_TERRAIN,
  DEBUG_TERRAIN_EDGE,
  DISABLE_INLAND_LAKES,
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
  EDGE_LAND_EXPONENT,
  EDGE_WATER_BASE_OFFSET,
  ELEVATION_DETAIL_WEIGHT,
  ELEVATION_MACRO_SCALE,
  ELEVATION_MACRO_WEIGHT,
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
  computeBiomeSuitabilityValue,
  isFloodplainCandidate
} from "./biome/BiomeSuitability.js";
import { buildForestMask } from "./biome/ForestSpread.js";

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

export const createYieldController = (maxIterations = 32): (() => Promise<boolean>) => createYield(maxIterations);

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
    return { min: 0.04, max: 0.5 };
  }
  return { min: 0.08, max: 0.34 };
};

const clampSeaLevel = (value: number, settings: MapGenSettings): number => {
  const { min, max } = getSeaLevelBounds(settings);
  return clamp(value, min, max);
};

const resolveSeaLevelBase = (
  state: WorldState,
  settings: MapGenSettings,
  elevationMap: ArrayLike<number>,
  cellSizeM: number
): number => {
  const target = Number.isFinite(settings.waterCoverage)
    ? clamp(settings.waterCoverage, 0.05, 0.85)
    : null;
  if (target === null) {
    return settings.baseWaterThreshold;
  }
  const total = state.grid.totalTiles;
  const edgeDenomM = (Math.min(state.grid.cols, state.grid.rows) * cellSizeM) / 2;
  const edgeBias = new Float32Array(total);
  for (let y = 0; y < state.grid.rows; y += 1) {
    const rowBase = y * state.grid.cols;
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = rowBase + x;
      const edgeDistM = Math.min(x, y, state.grid.cols - 1 - x, state.grid.rows - 1 - y) * cellSizeM;
      const edgeFactor = clamp(edgeDistM / edgeDenomM, 0, 1);
      edgeBias[idx] = (1 - edgeFactor) * settings.edgeWaterBias;
    }
  }
  const { min, max } = getSeaLevelBounds(settings);
  let low = min - settings.edgeWaterBias;
  let high = max;
  for (let i = 0; i < 18; i += 1) {
    const mid = (low + high) / 2;
    let waterCount = 0;
    for (let j = 0; j < total; j += 1) {
      const seaLevel = clampSeaLevel(mid + edgeBias[j], settings);
      if ((elevationMap[j] ?? 0) <= seaLevel) {
        waterCount += 1;
      }
    }
    const ratio = waterCount / Math.max(1, total);
    if (ratio < target) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return clamp(high, min - settings.edgeWaterBias, max);
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
  const cellSizeM = Math.max(0.1, settings.cellSizeM);
  const edgeDenomM = (Math.min(state.grid.cols, state.grid.rows) * cellSizeM) / 2;
  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = indexFor(state.grid, x, y);
      const edgeDistM =
        Math.min(x, y, state.grid.cols - 1 - x, state.grid.rows - 1 - y) * cellSizeM;
      const edgeFactor = clamp(edgeDistM / edgeDenomM, 0, 1);
      const seaLevel = clampSeaLevel(base + (1 - edgeFactor) * settings.edgeWaterBias, settings);
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

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  if (Math.abs(edge1 - edge0) < 1e-6) {
    return value < edge0 ? 0 : 1;
  }
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

const assertEdgeWater = (state: WorldState): void => {
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

const getWorldX = (settings: MapGenSettings, x: number): number => settings.worldOffsetXM + x * settings.cellSizeM;
const getWorldY = (settings: MapGenSettings, y: number): number => settings.worldOffsetYM + y * settings.cellSizeM;

const FOREST_MACRO_WEIGHT = 0.85;
const FOREST_DETAIL_WEIGHT = 0.15;

type TileClassificationInput = {
  elevation: number;
  slope: number;
  waterDistM: number;
  valley: number;
  moisture: number;
  forestNoise: number;
  seaLevel: number;
  forestThreshold: number;
  highlandForestElevation: number;
};

function classifyTile(input: TileClassificationInput): TileType {
  const {
    elevation,
    slope,
    waterDistM,
    valley,
    moisture,
    forestNoise,
    seaLevel,
    forestThreshold,
    highlandForestElevation
  } = input;
  if (elevation < seaLevel) {
    return "water";
  }
  if (waterDistM <= 15 && slope < 0.15) {
    return "beach";
  }
  const isFloodplain = valley > 0.08 && slope < 0.12 && elevation < seaLevel + 0.15;
  if (isFloodplain) {
    return "floodplain";
  }
  if (slope > 0.45 && elevation > seaLevel + 0.25) {
    return "rocky";
  }
  if (elevation > seaLevel + 0.35 && moisture < 0.25 && slope <= 0.45) {
    return "bare";
  }
  if (
    elevation <= highlandForestElevation &&
    moisture > 0.45 &&
    slope < 0.35 &&
    forestNoise > forestThreshold &&
    !isFloodplain
  ) {
    return "forest";
  }
  if (moisture > 0.3) {
    return "scrub";
  }
  return "grass";
}

const getYieldEveryRows = (cols: number): number => Math.max(4, Math.floor(2048 / Math.max(1, cols)));

const SHORELINE_SEA_BAND = 0.06;
const SHORELINE_NOISE_SCALE_FINE_M = 180;
const SHORELINE_NOISE_SCALE_BROAD_M = 420;
const SHORELINE_NOISE_AMPLITUDE = 0.016;
const SHORELINE_SMOOTH_PASSES = 2;

const COAST_BEACH_MAX_SLOPE = 0.22;
const COAST_BEACH_MAX_RELIEF = 0.1;
const COAST_BEACH_MAX_HEIGHT_ABOVE_SEA = 0.1;
const COAST_BEACH_SCULPT_MAX_HEIGHT_ABOVE_SEA = 0.12;
const COAST_BEACH_NEAR_TARGET = 0.012;
const COAST_BEACH_FAR_TARGET = 0.022;
const COAST_BEACH_NEAR_BLEND = 0.82;
const COAST_BEACH_FAR_BLEND = 0.58;
const COAST_BEACH_NEAR_MAX_DROP = 0.025;
const COAST_BEACH_FAR_MAX_DROP = 0.015;
const COAST_CLIFF_NEAR_MIN = 0.04;
const COAST_CLIFF_FAR_MIN = 0.055;
const COAST_CLIFF_NEAR_BLEND = 0.2;
const COAST_CLIFF_FAR_BLEND = 0.12;
const COAST_OCEAN_SHELF_DEEPEN = 0.006;
const COAST_LOCAL_SEA_MARGIN = 0.0005;
const COAST_MIN_LAND_ABOVE_SEA = 0.001;
const OCEAN_BATHY_DEPTH_MIN = 0.012;
const OCEAN_BATHY_DEPTH_MAX = 0.036;
const OCEAN_BATHY_BLEND = 0.75;
const RIVER_MOUTH_MAX_BED_BELOW_SEA = 0.008;
const RIVER_MOUTH_SURFACE_ABOVE_SEA = 0.0005;

type SeedSpreadClassificationInput = {
  elevation: number;
  slope: number;
  waterDistM: number;
  valley: number;
  moisture: number;
  seaLevel: number;
  highlandForestElevation: number;
  forestCandidate: boolean;
};

const classifySeedSpreadTile = (input: SeedSpreadClassificationInput): TileType => {
  const { elevation, slope, waterDistM, valley, moisture, seaLevel, highlandForestElevation, forestCandidate } = input;
  if (elevation < seaLevel) {
    return "water";
  }
  if (waterDistM <= 15 && slope < 0.15) {
    return "beach";
  }
  if (isFloodplainCandidate(elevation, slope, valley, seaLevel)) {
    return "floodplain";
  }
  if (slope > 0.45 && elevation > seaLevel + 0.25) {
    return "rocky";
  }
  if (elevation > seaLevel + 0.35 && moisture < 0.25 && slope <= 0.45) {
    return "bare";
  }
  if (forestCandidate && elevation <= highlandForestElevation + 0.05) {
    return "forest";
  }
  if (moisture > 0.33) {
    return "scrub";
  }
  return "grass";
};

const classifyOceanCoastTile = (
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
  const cols = state.grid.cols;
  const rows = state.grid.rows;
  const x = idx % cols;
  const y = Math.floor(idx / cols);
  let touchesOcean = false;
  if (x > 0 && oceanMask[idx - 1]) {
    touchesOcean = true;
  } else if (x < cols - 1 && oceanMask[idx + 1]) {
    touchesOcean = true;
  } else if (y > 0 && oceanMask[idx - cols]) {
    touchesOcean = true;
  } else if (y < rows - 1 && oceanMask[idx + cols]) {
    touchesOcean = true;
  }
  if (!touchesOcean) {
    return null;
  }
  const seaLevel = seaLevelMap[idx] ?? 0;
  if (elevation <= seaLevel + COAST_LOCAL_SEA_MARGIN) {
    return null;
  }
  if (slope <= COAST_BEACH_MAX_SLOPE && elevation - seaLevel <= COAST_BEACH_MAX_HEIGHT_ABOVE_SEA) {
    return "beach";
  }
  return "rocky";
};

const shapeOceanFloorAtSeaLevel = (current: number, seaLevel: number, noise01: number): number => {
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

function assignForestComposition(state: WorldState): void {
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
      if (secondaryConfigs.length > 0) {
        const x = idx % cols;
        const y = Math.floor(idx / cols);
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

function carveRiverValleys(
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
  const minRiverElev = 0.18;
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
    return clamp(elevationMap[idx] - MIN_RIVER_DEPTH, 0, 1);
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
      const bed = Math.min(bedA, bedB);
      const minElevation = bed + MIN_RIVER_DEPTH + BANK_CLEARANCE;
      if ((elevationMap[targetIdx] ?? 0) < minElevation) {
        elevationMap[targetIdx] = minElevation;
      }
      const minSurface = bed + MIN_RIVER_DEPTH;
      const maxSurface = Math.max(minSurface, (elevationMap[targetIdx] ?? 0) - BANK_CLEARANCE);
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
        lastBed = Math.max(minRiverElev, localElev - 0.01);
      } else {
        const slopeCarveBonus = clamp(localSlope * (1.1 + riverScale * 0.45), 0, 0.02);
        const target = Math.min(localElev - 0.004, lastBed - (bedSlope + slopeCarveBonus * 0.22));
        lastBed = Math.max(minRiverElev, target);
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
      const prevBed = riverBeds[pos - 1] ?? minRiverElev;
      const nextBed = riverBeds[pos + 1] ?? prevBed;
      const minBedForSurface = localElev - MIN_RIVER_DEPTH - BANK_CLEARANCE;
      const bridgeBed = clamp((prevBed + nextBed) * 0.5, minRiverElev, Math.max(minRiverElev, minBedForSurface));
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
    const outletBed = riverBeds[riverBeds.length - 1] ?? minRiverElev;
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
      const bed = riverBeds[i] ?? minRiverElev;
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
      const bed = riverBeds[i] ?? minRiverElev;
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
      continue;
    }
    const bed = Number.isFinite(riverBedField[i]) ? riverBedField[i] : clamp(elevationMap[i] - MIN_RIVER_DEPTH, 0, 1);
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

async function buildElevationMap(
  state: WorldState,
  rng: RNG,
  settings: MapGenSettings,
  report?: MapGenReporter,
  yieldIfNeeded?: () => Promise<boolean>,
  debug?: MapGenDebug
): Promise<{ elevationMap: number[]; riverMask: Uint8Array; seaLevelBase: number }> {
  const maxDim = Math.max(state.grid.cols, state.grid.rows);
  const elevationBlock = maxDim >= 1024 ? 8 : maxDim >= 512 ? 4 : 2;
  return buildElevationMapCoarse(state, rng, elevationBlock, settings, report, yieldIfNeeded, debug);
}

async function buildElevationMapCoarse(
  state: WorldState,
  rng: RNG,
  blockSize: number,
  settings: MapGenSettings,
  report?: MapGenReporter,
  yieldIfNeeded?: () => Promise<boolean>,
  debug?: MapGenDebug
): Promise<{ elevationMap: number[]; riverMask: Uint8Array; seaLevelBase: number }> {
  const cols = state.grid.cols;
  const rows = state.grid.rows;
  const coarseCols = Math.ceil(cols / blockSize);
  const coarseRows = Math.ceil(rows / blockSize);
  const coarseTotal = coarseCols * coarseRows;
  const coarseElevation = Array.from({ length: coarseTotal }, () => 0);
  const coarseTemp = Array.from({ length: coarseTotal }, () => 0);
  const coarseValleyMap = Array.from({ length: coarseTotal }, () => 0);
  const coarseShapeMap = Array.from({ length: coarseTotal }, () => 0);
  const coarseSampleXMap = Array.from({ length: coarseTotal }, () => 0);
  const coarseSampleYMap = Array.from({ length: coarseTotal }, () => 0);
  const cellSizeM = Math.max(0.1, settings.cellSizeM);
  const worldOffsetXM = settings.worldOffsetXM;
  const worldOffsetYM = settings.worldOffsetYM;
  const worldWidthM = cols * cellSizeM;
  const worldHeightM = rows * cellSizeM;
  const minDimM = Math.min(worldWidthM, worldHeightM);
  const elevationScale = clamp(settings.elevationScale, 0.72, 2.45);
  const elevationExponent = clamp(settings.elevationExponent, 0.6, 2.6);
  const mountainScale = clamp(settings.mountainScale, 0.68, 1.6);
  const ridgeStrength = clamp(settings.ridgeStrength, 0, 0.42);
  const valleyDepth = clamp(settings.valleyDepth, 0.4, 3);
  const terrainArchetype = settings.terrainArchetype;
  const relief01 = clamp(settings.relief, 0, 1);
  const maxHeight01 = clamp(settings.maxHeight, 0, 1);
  const normalizedHeightPressure = computeNormalizedHeightPressure(maxHeight01);
  const reliefCurve = Math.pow(relief01, 1.4);
  const reliefPeakCurve = Math.pow(relief01, 1.85);
  const ruggedness01 = clamp(settings.ruggedness, 0, 1);
  const coastComplexity = clamp(settings.coastComplexity, 0, 1);
  const riverIntensity = clamp(settings.riverIntensity, 0, 1);
  const interiorRise = clamp(settings.interiorRise, 0, 1);
  const islandCompactness = clamp(settings.islandCompactness, 0, 1);
  const ridgeFrequency = clamp(settings.ridgeFrequency, 0, 1);
  const basinStrength = clamp(settings.basinStrength, 0, 1);
  const coastalShelfWidth = clamp(settings.coastalShelfWidth, 0, 1);
  const bridgeAllowance = clamp(settings.bridgeAllowance, 0, 1);
  const centerFactorM = minDimM / 2;
  const warpScaleM = WARP_WAVELENGTH_M * mountainScale;
  const macroScaleM = MACRO_WAVELENGTH_M * mountainScale * ELEVATION_MACRO_SCALE;
  const midScaleM = MID_WAVELENGTH_M * mountainScale;
  const detailScaleM = DETAIL_WAVELENGTH_M * mountainScale;
  const ridgeScaleM = RIDGE_WAVELENGTH_M * mountainScale * mix(1.15, 0.6, ridgeFrequency);
  const bandAngle = rng.next() * Math.PI;
  const bandDir = { x: Math.cos(bandAngle), y: Math.sin(bandAngle) };
  const bandScaleM = (BAND_SCALE_BASE_M + rng.next() * BAND_SCALE_RANGE_M) * mix(1.2, 0.75, ridgeFrequency);
  const bandPhase = rng.next() * Math.PI * 2;
  const bandStrength = mix(0.12, 0.28, ruggedness01);
  const ridgeSpineAngle = bandAngle + (rng.next() - 0.5) * Math.PI * mix(0.08, 0.28, coastComplexity);
  const ridgeSpineDir = { x: Math.cos(ridgeSpineAngle), y: Math.sin(ridgeSpineAngle) };
  const ridgeSpineCurvePhaseA = rng.next() * Math.PI * 2;
  const ridgeSpineCurvePhaseB = rng.next() * Math.PI * 2;
  const splitStraitAngle = bandAngle + (rng.next() - 0.5) * Math.PI * mix(0.06, 0.24, coastComplexity);
  const splitStraitDir = { x: Math.cos(splitStraitAngle), y: Math.sin(splitStraitAngle) };
  const splitStraitCurvePhaseA = rng.next() * Math.PI * 2;
  const splitStraitCurvePhaseB = rng.next() * Math.PI * 2;
  const splitStraitCurvePhaseC = rng.next() * Math.PI * 2;
  const splitStraitAsymmetry = (rng.next() - 0.5) * mix(0.08, 0.26, clamp(coastComplexity * 0.6 + ruggedness01 * 0.4, 0, 1));
  const archetypeDefinition = ISLAND_ARCHETYPE_DEFINITIONS[terrainArchetype];
  const longSpineAngle = ridgeSpineAngle;
  const longSpineDir = ridgeSpineDir;
  const longSpineCurvePhaseA = ridgeSpineCurvePhaseA;
  const longSpineCurvePhaseB = ridgeSpineCurvePhaseB;
  const twinBayAngle = splitStraitAngle;
  const twinBayDir = splitStraitDir;
  const twinBayCurvePhaseA = splitStraitCurvePhaseA;
  const twinBayCurvePhaseB = splitStraitCurvePhaseB;
  const twinBayCurvePhaseC = splitStraitCurvePhaseC;
  const twinBayAsymmetry = splitStraitAsymmetry;
  const shapeRotation = (rng.next() - 0.5) * Math.PI * mix(0.18, 0.68, clamp(coastComplexity * 0.65 + ruggedness01 * 0.35, 0, 1));
  const shapeRotationCos = Math.cos(shapeRotation);
  const shapeRotationSin = Math.sin(shapeRotation);
  const shapeDriftX = (rng.next() - 0.5) * mix(0.08, 0.26, coastComplexity);
  const shapeDriftY = (rng.next() - 0.5) * mix(0.08, 0.26, coastComplexity);
  const shapeLobeCountA = 2 + Math.floor(rng.next() * 3);
  const shapeLobeCountB = shapeLobeCountA + 1 + Math.floor(rng.next() * 2);
  const shapeLobePhaseA = rng.next() * Math.PI * 2;
  const shapeLobePhaseB = rng.next() * Math.PI * 2;
  const macroShapeLobeCountA = 1 + Math.floor(rng.next() * 2);
  const macroShapeLobeCountB = macroShapeLobeCountA + 1 + Math.floor(rng.next() * 2);
  const macroShapeLobePhaseA = rng.next() * Math.PI * 2;
  const macroShapeLobePhaseB = rng.next() * Math.PI * 2;
  const shapeLobeAmpA = mix(0.02, 0.1, coastComplexity);
  const shapeLobeAmpB = mix(0.01, 0.06, clamp(coastComplexity * 0.55 + ruggedness01 * 0.45, 0, 1));
  const macroShapeLobeAmpA = mix(0.015, 0.2, Math.pow(coastComplexity, 1.08));
  const macroShapeLobeAmpB = mix(0.008, 0.11, clamp(coastComplexity * 0.72 + ruggedness01 * 0.28, 0, 1));
  const macroCoastStrength = smoothstep(0.12, 0.96, coastComplexity);
  const landPeakSharpness = mix(2.1, 4.2, clamp(reliefCurve * 0.65 + ruggedness01 * 0.35, 0, 1));

  const insetM = Math.min(minDimM * LAND_CENTER_INSET_FRACTION, Math.min(worldWidthM, worldHeightM) * 0.45);
  const landMinX = worldOffsetXM + insetM;
  const landMaxX = worldOffsetXM + Math.max(0, worldWidthM - insetM);
  const landMinY = worldOffsetYM + insetM;
  const landMaxY = worldOffsetYM + Math.max(0, worldHeightM - insetM);
  const toWorldCenter = (u: number, v: number, radius: number, height: number) => ({
    x: landMinX + (landMaxX - landMinX) * clamp(u, 0, 1),
    y: landMinY + (landMaxY - landMinY) * clamp(v, 0, 1),
    radius: minDimM * radius,
    height
  });
  const createLandCenter = (
    u: number,
    v: number,
    radius: number,
    height: number,
    jitter = 0.08
  ) => {
    const jitterScale = jitter * mix(0.45, 1.08, clamp(coastComplexity * 0.5 + ruggedness01 * 0.5, 0, 1));
    const jitteredU = clamp(u + (rng.next() - 0.5) * jitterScale, 0.08, 0.92);
    const jitteredV = clamp(v + (rng.next() - 0.5) * jitterScale, 0.08, 0.92);
    const radiusScale = mix(0.84, 1.22, rng.next());
    const heightScale = mix(0.82, 1.3, rng.next());
    return toWorldCenter(jitteredU, jitteredV, radius * radiusScale, height * heightScale);
  };
  type SilhouetteBlob = {
    x: number;
    y: number;
    radiusX: number;
    radiusY: number;
    weight: number;
    inner: number;
    outer: number;
    cos: number;
    sin: number;
  };
  const createSilhouetteBlob = (
    u: number,
    v: number,
    radiusX: number,
    radiusY: number,
    weight: number,
    jitter = 0.1
  ): SilhouetteBlob => {
    const jitterScale = jitter * mix(0.5, 1.25, clamp(coastComplexity * 0.6 + ruggedness01 * 0.4, 0, 1));
    const centerU = clamp(u + (rng.next() - 0.5) * jitterScale, 0.04, 0.96);
    const centerV = clamp(v + (rng.next() - 0.5) * jitterScale, 0.04, 0.96);
    const scaleX = Math.max(0.08, radiusX * mix(0.68, 1.42, rng.next()));
    const scaleY = Math.max(0.08, radiusY * mix(0.68, 1.42, rng.next()));
    const angle = rng.next() * Math.PI * 2;
    return {
      x: centerU * 2 - 1,
      y: centerV * 2 - 1,
      radiusX: scaleX,
      radiusY: scaleY,
      weight: weight * mix(0.76, 1.28, rng.next()),
      inner: mix(0.14, 0.34, rng.next()),
      outer: mix(0.88, 1.22, rng.next()),
      cos: Math.cos(angle),
      sin: Math.sin(angle)
    };
  };
  const createAlignedSilhouetteBlob = (
    u: number,
    v: number,
    radiusAlong: number,
    radiusAcross: number,
    weight: number,
    angle: number,
    jitter = 0.1
  ): SilhouetteBlob => {
    const blob = createSilhouetteBlob(u, v, radiusAlong, radiusAcross, weight, jitter);
    return {
      ...blob,
      cos: Math.cos(angle),
      sin: Math.sin(angle)
    };
  };
  const longSpineToUV = (along: number, across: number) => ({
    u: 0.5 + (along * longSpineDir.x - across * longSpineDir.y) * 0.5,
    v: 0.5 + (along * longSpineDir.y + across * longSpineDir.x) * 0.5
  });
  const twinBayToUV = (along: number, across: number) => ({
    u: 0.5 + (along * twinBayDir.x - across * twinBayDir.y) * 0.5,
    v: 0.5 + (along * twinBayDir.y + across * twinBayDir.x) * 0.5
  });
  const createDistributedAngles = (
    count: number,
    baseAngle: number,
    span: number,
    jitter = 0.18
  ): number[] => {
    if (count <= 0) {
      return [];
    }
    return Array.from({ length: count }, (_, index) => {
      const offset =
        span >= Math.PI * 1.99
          ? (index / Math.max(1, count)) * span
          : mix(-span * 0.5, span * 0.5, count <= 1 ? 0.5 : index / Math.max(1, count - 1));
      return baseAngle + offset + (rng.next() - 0.5) * jitter;
    });
  };
  const polarToUV = (angle: number, radius: number) => ({
    u: 0.5 + Math.cos(angle) * radius * 0.5,
    v: 0.5 + Math.sin(angle) * radius * 0.5
  });
  const createCoastMacroBlob = (
    angle: number,
    radialDistance: number,
    tangentRadius: number,
    radialRadius: number,
    weight: number,
    orientation: "tangent" | "radial" = "tangent",
    jitter = 0.06
  ): SilhouetteBlob => {
    const point = polarToUV(radialDistance > 0 ? angle : angle + Math.PI, Math.abs(radialDistance));
    const majorRadius = orientation === "tangent" ? tangentRadius : radialRadius;
    const minorRadius = orientation === "tangent" ? radialRadius : tangentRadius;
    const rotation =
      (orientation === "tangent" ? angle + Math.PI * 0.5 : angle)
      + (rng.next() - 0.5) * Math.PI * mix(0.04, 0.18, macroCoastStrength);
    return createAlignedSilhouetteBlob(point.u, point.v, majorRadius, minorRadius, weight, rotation, jitter);
  };
  const sampleSilhouetteBlob = (blob: SilhouetteBlob, px: number, py: number): number => {
    const dx = px - blob.x;
    const dy = py - blob.y;
    const lx = dx * blob.cos + dy * blob.sin;
    const ly = -dx * blob.sin + dy * blob.cos;
    const normalized = Math.hypot(lx / Math.max(0.08, blob.radiusX), ly / Math.max(0.08, blob.radiusY));
    return (1 - smoothstep(blob.inner, blob.outer, normalized)) * blob.weight;
  };
  const sampleSilhouetteField = (blobs: readonly SilhouetteBlob[], px: number, py: number): number => {
    let sum = 0;
    let peak = 0;
    for (const blob of blobs) {
      const contribution = sampleSilhouetteBlob(blob, px, py);
      peak = Math.max(peak, contribution);
      sum += contribution;
    }
    return clamp(peak * 0.72 + sum * 0.34, 0, 1.25);
  };
  type RidgeSpineNode = {
    along: number;
    across: number;
    length: number;
    width: number;
    weight: number;
  };
  const ridgeSpineNodeCount = terrainArchetype === "LONG_SPINE" ? 4 + Math.floor(rng.next() * 3) : 0;
  const ridgeSpineNodes: RidgeSpineNode[] =
    terrainArchetype === "LONG_SPINE"
      ? Array.from({ length: ridgeSpineNodeCount }, (_, index) => {
          const t = ridgeSpineNodeCount <= 1 ? 0.5 : index / Math.max(1, ridgeSpineNodeCount - 1);
          return {
            along: mix(-0.66, 0.66, t) + (rng.next() - 0.5) * 0.12,
            across: (rng.next() - 0.5) * mix(0.04, 0.16, ruggedness01),
            length: mix(0.14, 0.3, rng.next()),
            width: mix(0.05, 0.12, rng.next()),
            weight: mix(0.3, 0.74, rng.next())
          };
        })
      : [];
  const sampleRidgeSpineProfile = (
    px: number,
    py: number
  ): { footprint: number; crest: number } => {
    const along = px * ridgeSpineDir.x + py * ridgeSpineDir.y;
    const across = -px * ridgeSpineDir.y + py * ridgeSpineDir.x;
    const primaryCurve =
      Math.sin(along * Math.PI * mix(0.75, 1.3, coastComplexity) + ridgeSpineCurvePhaseA) * mix(0.04, 0.18, coastComplexity);
    const secondaryCurve =
      Math.sin(along * Math.PI * mix(1.4, 2.7, ruggedness01) + ridgeSpineCurvePhaseB) * mix(0.015, 0.055, ruggedness01);
    const bentAcross = across - primaryCurve - secondaryCurve;
    const widthMod = Math.max(
      0.74,
      1 + Math.sin(along * Math.PI * mix(1.1, 2.2, ridgeFrequency) - shapeLobePhaseB) * mix(0.08, 0.22, ruggedness01)
    );
    const endTaper = 1 - smoothstep(
      mix(0.72, 0.88, islandCompactness),
      mix(1.0, 1.18, islandCompactness),
      Math.abs(along)
    );
    const bodyWidth = Math.max(0.05, mix(0.22, 0.08, ridgeFrequency) * widthMod);
    const shoulderWidth = Math.max(bodyWidth * 1.9, mix(0.44, 0.18, ridgeFrequency) * widthMod);
    const body = Math.exp(-(bentAcross * bentAcross) / Math.max(0.012, bodyWidth * bodyWidth * 2.2));
    const shoulders = Math.exp(-(bentAcross * bentAcross) / Math.max(0.024, shoulderWidth * shoulderWidth * 2.4));
    let nodeField = 0;
    for (const node of ridgeSpineNodes) {
      const alongDelta = along - node.along;
      const acrossDelta = bentAcross - node.across;
      const contribution =
        Math.exp(-(alongDelta * alongDelta) / Math.max(0.018, node.length * node.length * 2))
        * Math.exp(-(acrossDelta * acrossDelta) / Math.max(0.008, node.width * node.width * 2))
        * node.weight;
      nodeField = Math.max(nodeField, contribution);
    }
    const footprint = clamp(Math.max(shoulders * endTaper, nodeField * 0.7), 0, 1);
    const crest = clamp((body * 0.82 + nodeField * 0.68) * endTaper, 0, 1);
    return { footprint, crest };
  };
  type SplitStraitShelfNode = {
    along: number;
    across: number;
    length: number;
    width: number;
    weight: number;
  };
  type SplitStraitPinch = {
    along: number;
    radius: number;
    strength: number;
  };
  const splitStraitShelfNodeCount = terrainArchetype === "TWIN_BAY" ? 3 + Math.floor(rng.next() * 2) : 0;
  const splitStraitShelfNodes: SplitStraitShelfNode[] =
    terrainArchetype === "TWIN_BAY"
      ? Array.from({ length: splitStraitShelfNodeCount * 2 }, (_, index) => {
          const side = index < splitStraitShelfNodeCount ? -1 : 1;
          const sideIndex = index % splitStraitShelfNodeCount;
          const t = splitStraitShelfNodeCount <= 1 ? 0.5 : sideIndex / Math.max(1, splitStraitShelfNodeCount - 1);
          return {
            along: mix(-0.72, 0.72, t) + (rng.next() - 0.5) * 0.16,
            across:
              side * mix(0.18, 0.34, Math.pow(rng.next(), 0.84))
              + splitStraitAsymmetry * side * 0.2
              + (rng.next() - 0.5) * 0.06,
            length: mix(0.18, 0.34, rng.next()),
            width: mix(0.05, 0.12, rng.next()),
            weight: mix(0.28, 0.68, rng.next())
          };
        })
      : [];
  const splitStraitPinches: SplitStraitPinch[] =
    terrainArchetype === "TWIN_BAY"
      ? Array.from({ length: 2 + Math.floor(rng.next() * 2) }, () => ({
          along: mix(-0.56, 0.56, rng.next()),
          radius: mix(0.1, 0.22, rng.next()),
          strength: mix(0.12, 0.3, rng.next())
        }))
      : [];
  const sampleSplitStraitProfile = (
    px: number,
    py: number
  ): { footprint: number; crest: number } => {
    const along = px * splitStraitDir.x + py * splitStraitDir.y;
    const across = -px * splitStraitDir.y + py * splitStraitDir.x;
    const coastlineCurve =
      Math.sin(along * Math.PI * mix(0.72, 1.2, coastComplexity) + splitStraitCurvePhaseA) * mix(0.03, 0.11, coastComplexity)
      + Math.sin(along * Math.PI * mix(1.5, 2.5, ruggedness01) + splitStraitCurvePhaseB) * mix(0.01, 0.04, ruggedness01)
      + splitStraitAsymmetry * mix(0.04, 0.12, coastComplexity);
    const curvedAcross = across - coastlineCurve;
    const endTaper = 1 - smoothstep(
      mix(0.82, 0.92, islandCompactness),
      mix(1.02, 1.16, islandCompactness),
      Math.abs(along)
    );
    const parentShelf = 1 - smoothstep(
      mix(0.68, 0.86, islandCompactness),
      mix(0.94, 1.1, islandCompactness),
      Math.hypot(
        along * mix(0.8, 0.7, coastComplexity),
        (curvedAcross - splitStraitAsymmetry * 0.04) * mix(1.04, 0.92, coastComplexity)
      )
    );
    const centralWaistWidth = mix(0.18, 0.26, islandCompactness);
    const centralWaist = Math.exp(
      -(curvedAcross * curvedAcross) / Math.max(0.02, centralWaistWidth * centralWaistWidth * 2.2)
    ) * endTaper;
    const centralShield =
      Math.exp(-(along * along) / Math.max(0.06, mix(0.32, 0.52, islandCompactness) ** 2 * 2.1))
      * Math.exp(-(curvedAcross * curvedAcross) / Math.max(0.03, mix(0.18, 0.26, islandCompactness) ** 2 * 2.2));
    const shelfOffset = mix(0.18, 0.28, 1 - ruggedness01 * 0.3);
    const shelfWidth = Math.max(0.08, mix(0.16, 0.24, 1 - ruggedness01 * 0.4));
    const leftShelf = Math.exp(-((curvedAcross + shelfOffset) * (curvedAcross + shelfOffset)) / Math.max(0.02, shelfWidth * shelfWidth * 2.1));
    const rightShelf = Math.exp(-((curvedAcross - shelfOffset) * (curvedAcross - shelfOffset)) / Math.max(0.02, shelfWidth * shelfWidth * 2.1));
    const bayAlongOffset = mix(0.2, 0.34, coastComplexity);
    const bayAcrossOffset = mix(0.54, 0.7, clamp(coastComplexity * 0.7 + settings.waterLevel * 0.3, 0, 1));
    const bayAlongRadius = mix(0.16, 0.26, coastComplexity);
    const bayAcrossRadius = mix(0.11, 0.18, coastComplexity);
    const bayA = Math.exp(
      -((along + bayAlongOffset + splitStraitAsymmetry * 0.18) * (along + bayAlongOffset + splitStraitAsymmetry * 0.18))
        / Math.max(0.02, bayAlongRadius * bayAlongRadius * 2)
    ) * Math.exp(
      -((curvedAcross + bayAcrossOffset) * (curvedAcross + bayAcrossOffset))
        / Math.max(0.016, bayAcrossRadius * bayAcrossRadius * 2)
    );
    const bayB = Math.exp(
      -((along - bayAlongOffset + splitStraitAsymmetry * 0.18) * (along - bayAlongOffset + splitStraitAsymmetry * 0.18))
        / Math.max(0.02, bayAlongRadius * bayAlongRadius * 2)
    ) * Math.exp(
      -((curvedAcross - bayAcrossOffset) * (curvedAcross - bayAcrossOffset))
        / Math.max(0.016, bayAcrossRadius * bayAcrossRadius * 2)
    );
    let minorBayField = 0;
    for (let index = 0; index < splitStraitPinches.length; index += 1) {
      if (index > 0 && coastComplexity < 0.75) {
        break;
      }
      const pinch = splitStraitPinches[index]!;
      const side = index % 2 === 0 ? -1 : 1;
      const alongDelta = along - pinch.along * 0.42;
      const acrossDelta = curvedAcross - side * mix(0.62, 0.76, coastComplexity);
      const contribution =
        Math.exp(-(alongDelta * alongDelta) / Math.max(0.02, pinch.radius * pinch.radius * 2.1))
        * Math.exp(-(acrossDelta * acrossDelta) / Math.max(0.018, pinch.radius * pinch.radius * 1.6))
        * pinch.strength;
      minorBayField = Math.max(minorBayField, contribution);
    }
    let shelfNodeField = 0;
    for (const node of splitStraitShelfNodes) {
      const alongDelta = along - node.along;
      const acrossDelta = curvedAcross - node.across;
      const contribution =
        Math.exp(-(alongDelta * alongDelta) / Math.max(0.02, node.length * node.length * 2))
        * Math.exp(-(acrossDelta * acrossDelta) / Math.max(0.008, node.width * node.width * 2))
        * node.weight;
      shelfNodeField = Math.max(shelfNodeField, contribution);
    }
    const shelfFootprint = Math.max(leftShelf, rightShelf) * endTaper;
    const footprint = clamp(
      parentShelf * 0.52
      + centralShield * 0.2
      + centralWaist * 0.18
      + shelfFootprint * 0.2
      + shelfNodeField * 0.2
      - bayA * 0.22
      - bayB * 0.22
      - minorBayField * 0.12,
      0,
      1
    );
    const crest = clamp(
      (centralWaist * 0.46 + centralShield * 0.22 + shelfFootprint * 0.26 + shelfNodeField * 0.72) * endTaper
      - (bayA + bayB) * 0.04,
      0,
      1
    );
    return { footprint, crest };
  };
  const silhouetteBlobs = (() => {
    switch (terrainArchetype) {
      case "LONG_SPINE": {
        const nodeCount = 4 + Math.floor(rng.next() * 2);
        return Array.from({ length: nodeCount }, (_, index) => {
          const t = nodeCount <= 1 ? 0.5 : index / (nodeCount - 1);
          const along = mix(-0.68, 0.68, t) + (rng.next() - 0.5) * 0.1;
          const across =
            Math.sin(t * Math.PI * mix(0.8, 1.4, coastComplexity) + ridgeSpineCurvePhaseA) * mix(0.04, 0.16, coastComplexity)
            + (rng.next() - 0.5) * 0.06;
          const point = longSpineToUV(along, across);
          return createAlignedSilhouetteBlob(
            point.u,
            point.v,
            mix(0.22, 0.42, rng.next()),
            mix(0.08, 0.16, rng.next()),
            mix(0.34, 0.62, rng.next()),
            ridgeSpineAngle,
            0.06
          );
        });
      }
      case "TWIN_BAY": {
        const core = createAlignedSilhouetteBlob(0.5, 0.5, 0.44, 0.32, 0.96, twinBayAngle, 0.04);
        const bayShoulders = [
          { along: -0.2 + twinBayAsymmetry * 0.18, across: -0.16, radiusAlong: 0.32, radiusAcross: 0.18, weight: 0.56 },
          { along: 0.2 + twinBayAsymmetry * 0.18, across: 0.16, radiusAlong: 0.32, radiusAcross: 0.18, weight: 0.56 }
        ];
        return [
          core,
          ...bayShoulders.map((shoulder) => {
            const point = twinBayToUV(shoulder.along, shoulder.across);
            return createAlignedSilhouetteBlob(
              point.u,
              point.v,
              shoulder.radiusAlong,
              shoulder.radiusAcross,
              shoulder.weight,
              twinBayAngle,
              0.05
            );
          }),
          ...splitStraitShelfNodes.slice(0, 4).map((node) => {
            const point = twinBayToUV(node.along * 0.72, node.across * 0.84);
            return createAlignedSilhouetteBlob(
              point.u,
              point.v,
              mix(0.18, 0.28, rng.next()),
              mix(0.08, 0.14, rng.next()),
              mix(0.14, 0.28, node.weight),
              twinBayAngle,
              0.05
            );
          })
        ];
      }
      case "SHELF": {
        const plateauBlobs = [
          createAlignedSilhouetteBlob(0.5, 0.5, 0.48, 0.34, 0.98, shapeRotation, 0.04),
          createAlignedSilhouetteBlob(0.38, 0.52, 0.26, 0.22, 0.62, shapeRotation + 0.24, 0.05),
          createAlignedSilhouetteBlob(0.64, 0.46, 0.24, 0.2, 0.58, shapeRotation - 0.22, 0.05)
        ];
        if (coastComplexity > 0.55) {
          plateauBlobs.push(createAlignedSilhouetteBlob(0.54, 0.66, 0.18, 0.16, 0.38, shapeRotation + 0.1, 0.05));
        }
        return plateauBlobs;
      }
      case "MASSIF":
      default: {
        const blobs = [
          createSilhouetteBlob(0.5, 0.5, mix(0.3, 0.48, rng.next()), mix(0.28, 0.44, rng.next()), 0.96, 0.08)
        ];
        const supportCount = 2 + Math.floor(rng.next() * 3);
        for (let i = 0; i < supportCount; i += 1) {
          const angle = rng.next() * Math.PI * 2;
          const dist = mix(0.12, 0.28, rng.next());
          blobs.push(
            createSilhouetteBlob(
              0.5 + Math.cos(angle) * dist,
              0.5 + Math.sin(angle) * dist * mix(0.84, 1.12, rng.next()),
              mix(0.12, 0.24, rng.next()),
              mix(0.12, 0.22, rng.next()),
              mix(0.42, 0.74, rng.next()),
              0.12
            )
          );
        }
        return blobs;
      }
    }
  })();
  const silhouetteCuts = (() => {
    if (terrainArchetype === "LONG_SPINE") {
      const cutCount = 2 + Math.floor(rng.next() * 2);
      return Array.from({ length: cutCount }, (_, index) => {
        const side = index % 2 === 0 ? -1 : 1;
        const along = mix(-0.72, 0.72, rng.next());
        const across = side * mix(0.28, 0.5, rng.next());
        const point = longSpineToUV(along, across);
        return createAlignedSilhouetteBlob(
          point.u,
          point.v,
          mix(0.14, 0.24, rng.next()),
          mix(0.08, 0.16, rng.next()),
          mix(0.1, 0.22, rng.next()),
          ridgeSpineAngle,
          0.05
        );
      });
    }
    if (terrainArchetype === "TWIN_BAY") {
      const bayCuts = [
        { along: -0.22 + twinBayAsymmetry * 0.2, across: -0.74, radiusAlong: 0.24, radiusAcross: 0.18, weight: 0.34 },
        { along: 0.22 + twinBayAsymmetry * 0.2, across: 0.74, radiusAlong: 0.24, radiusAcross: 0.18, weight: 0.34 }
      ];
      if (coastComplexity >= 0.75) {
        bayCuts.push({
          along: twinBayAsymmetry * 0.18,
          across: rng.next() < 0.5 ? -0.66 : 0.66,
          radiusAlong: 0.18,
          radiusAcross: 0.14,
          weight: 0.18
        });
      }
      return bayCuts.map((bay) => {
        const point = twinBayToUV(bay.along, bay.across);
        return createAlignedSilhouetteBlob(
          point.u,
          point.v,
          bay.radiusAlong,
          bay.radiusAcross,
          bay.weight,
          twinBayAngle + Math.sign(bay.across) * Math.PI * 0.08,
          0.04
        );
      });
    }
    const cutCount =
      terrainArchetype === "SHELF"
        ? (coastComplexity > 0.64 ? 1 : 0)
        : 1 + Math.floor(rng.next() * (coastComplexity > 0.48 ? 3 : 2));
    return Array.from({ length: cutCount }, () => {
      const angle = rng.next() * Math.PI * 2;
      const dist = terrainArchetype === "SHELF" ? mix(0.38, 0.5, rng.next()) : mix(0.28, 0.46, rng.next());
      return createSilhouetteBlob(
        0.5 + Math.cos(angle) * dist,
        0.5 + Math.sin(angle) * dist * mix(0.84, 1.16, rng.next()),
        terrainArchetype === "SHELF" ? mix(0.08, 0.14, rng.next()) : mix(0.08, 0.18, rng.next()),
        terrainArchetype === "SHELF" ? mix(0.08, 0.14, rng.next()) : mix(0.08, 0.18, rng.next()),
        terrainArchetype === "SHELF" ? mix(0.08, 0.18, rng.next()) : mix(0.18, 0.46, rng.next()),
        0.04
      );
    });
  })();
  const coastHeadlands = (() => {
    if (macroCoastStrength <= 0.001) {
      return [];
    }
    switch (terrainArchetype) {
      case "LONG_SPINE": {
        const sideAngles = [ridgeSpineAngle + Math.PI * 0.5, ridgeSpineAngle - Math.PI * 0.5];
        return sideAngles.flatMap((sideAngle, sideIndex) => {
          const featureCount = 1 + Math.floor(mix(0.8, 2.2, macroCoastStrength) + rng.next() * 0.6);
          return createDistributedAngles(
            featureCount,
            sideAngle + sideIndex * 0.18,
            mix(0.7, 1.45, macroCoastStrength),
            mix(0.16, 0.42, macroCoastStrength)
          ).map((angle) =>
            createCoastMacroBlob(
              angle,
              mix(0.68, 0.9, rng.next()),
              mix(0.12, 0.28, macroCoastStrength * 0.7 + rng.next() * 0.3),
              mix(0.07, 0.16, macroCoastStrength * 0.65 + rng.next() * 0.35),
              mix(0.08, 0.22, macroCoastStrength * 0.8 + rng.next() * 0.2),
              rng.next() < 0.24 ? "radial" : "tangent",
              0.05
            )
          );
        });
      }
      case "TWIN_BAY": {
        const outerAngles = [twinBayAngle + Math.PI * 0.5, twinBayAngle - Math.PI * 0.5];
        return outerAngles.flatMap((outerAngle, sideIndex) => {
          const featureCount = 1 + Math.floor(mix(0.6, 1.4, macroCoastStrength) + rng.next() * 0.4);
          return createDistributedAngles(
            featureCount,
            outerAngle + sideIndex * 0.14,
            mix(0.48, 0.9, macroCoastStrength),
            mix(0.12, 0.26, macroCoastStrength)
          ).map((angle) =>
            createCoastMacroBlob(
              angle,
              mix(0.64, 0.82, rng.next()),
              mix(0.1, 0.2, macroCoastStrength * 0.65 + rng.next() * 0.35),
              mix(0.06, 0.12, macroCoastStrength * 0.55 + rng.next() * 0.45),
              mix(0.06, 0.14, macroCoastStrength * 0.72 + rng.next() * 0.28),
              "tangent",
              0.05
            )
          );
        });
      }
      case "SHELF": {
        const featureCount = Math.max(1, Math.floor(mix(0.4, 1.4, macroCoastStrength) + rng.next() * 0.4));
        return createDistributedAngles(
          featureCount,
          rng.next() * Math.PI * 2,
          Math.PI * 2,
          mix(0.12, 0.26, macroCoastStrength)
        ).map((angle) =>
          createCoastMacroBlob(
            angle,
            mix(0.58, 0.76, rng.next()),
            mix(0.1, 0.18, macroCoastStrength * 0.52 + rng.next() * 0.48),
            mix(0.06, 0.12, macroCoastStrength * 0.48 + rng.next() * 0.52),
            mix(0.04, 0.1, macroCoastStrength * 0.55 + rng.next() * 0.45),
            "tangent",
            0.06
          )
        );
      }
      case "MASSIF":
      default: {
        const featureCount = 1 + Math.floor(mix(1.1, 3.8, macroCoastStrength) + rng.next() * 0.8);
        return createDistributedAngles(
          featureCount,
          rng.next() * Math.PI * 2,
          Math.PI * 2,
          mix(0.18, 0.44, macroCoastStrength)
        ).map((angle) =>
          createCoastMacroBlob(
            angle,
            mix(0.62, 0.92, rng.next()),
            mix(0.16, 0.34, macroCoastStrength * 0.72 + rng.next() * 0.28),
            mix(0.08, 0.2, macroCoastStrength * 0.6 + rng.next() * 0.4),
            mix(0.1, 0.26, macroCoastStrength * 0.78 + rng.next() * 0.22),
            rng.next() < 0.28 ? "radial" : "tangent",
            0.06
          )
        );
      }
    }
  })();
  const coastBays = (() => {
    if (macroCoastStrength <= 0.001) {
      return [];
    }
    switch (terrainArchetype) {
      case "LONG_SPINE": {
        const flankAngles = [ridgeSpineAngle + Math.PI * 0.5, ridgeSpineAngle - Math.PI * 0.5];
        return flankAngles.flatMap((flankAngle, sideIndex) => {
          const featureCount = 1 + Math.floor(mix(0.9, 2.5, macroCoastStrength) + rng.next() * 0.8);
          return createDistributedAngles(
            featureCount,
            flankAngle + sideIndex * 0.12,
            mix(0.8, 1.55, macroCoastStrength),
            mix(0.18, 0.46, macroCoastStrength)
          ).map((angle) =>
            createCoastMacroBlob(
              angle,
              mix(0.86, 1.08, rng.next()),
              mix(0.18, 0.34, macroCoastStrength * 0.76 + rng.next() * 0.24),
              mix(0.1, 0.22, macroCoastStrength * 0.7 + rng.next() * 0.3),
              mix(0.12, 0.3, macroCoastStrength * 0.82 + rng.next() * 0.18),
              rng.next() < 0.16 ? "radial" : "tangent",
              0.05
            )
          );
        });
      }
      case "TWIN_BAY": {
        const outerAngles = [twinBayAngle + Math.PI * 0.5, twinBayAngle - Math.PI * 0.5];
        return outerAngles.flatMap((outerAngle, sideIndex) => {
          const featureCount = 1 + Math.floor(mix(0.9, 1.4, macroCoastStrength) + rng.next() * 0.2);
          return createDistributedAngles(
            featureCount,
            outerAngle + sideIndex * 0.12,
            mix(0.54, 0.94, macroCoastStrength),
            mix(0.12, 0.24, macroCoastStrength)
          ).map((angle) =>
            createCoastMacroBlob(
              angle,
              mix(0.88, 1.02, rng.next()),
              mix(0.18, 0.28, macroCoastStrength * 0.72 + rng.next() * 0.28),
              mix(0.1, 0.18, macroCoastStrength * 0.64 + rng.next() * 0.36),
              mix(0.18, 0.26, macroCoastStrength * 0.74 + rng.next() * 0.26),
              "tangent",
              0.05
            )
          );
        });
      }
      case "SHELF": {
        const featureCount = coastComplexity > 0.72 ? 1 : 0;
        return createDistributedAngles(
          featureCount,
          rng.next() * Math.PI * 2 + Math.PI / Math.max(2, featureCount),
          Math.PI * 2,
          mix(0.12, 0.22, macroCoastStrength)
        ).map((angle) =>
          createCoastMacroBlob(
            angle,
            mix(0.86, 0.98, rng.next()),
            mix(0.16, 0.24, macroCoastStrength * 0.62 + rng.next() * 0.38),
            mix(0.1, 0.16, macroCoastStrength * 0.58 + rng.next() * 0.42),
            mix(0.08, 0.16, macroCoastStrength * 0.58 + rng.next() * 0.42),
            "tangent",
            0.06
          )
        );
      }
      case "MASSIF":
      default: {
        const featureCount = 1 + Math.floor(mix(1.2, 4.2, macroCoastStrength) + rng.next() * 0.8);
        return createDistributedAngles(
          featureCount,
          rng.next() * Math.PI * 2 + Math.PI / Math.max(2, featureCount),
          Math.PI * 2,
          mix(0.2, 0.52, macroCoastStrength)
        ).map((angle) =>
          createCoastMacroBlob(
            angle,
            mix(0.84, 1.08, rng.next()),
            mix(0.2, 0.4, macroCoastStrength * 0.8 + rng.next() * 0.2),
            mix(0.12, 0.28, macroCoastStrength * 0.72 + rng.next() * 0.28),
            mix(0.14, 0.34, macroCoastStrength * 0.84 + rng.next() * 0.16),
            rng.next() < 0.22 ? "radial" : "tangent",
            0.06
          )
        );
      }
    }
  })();
  const landCenters = (() => {
    switch (terrainArchetype) {
      case "LONG_SPINE":
        return [];
      case "TWIN_BAY":
        return [
          createLandCenter(0.5, 0.52, 0.22, 0.22 + relief01 * 0.14, 0.08),
          createLandCenter(0.34, 0.42, 0.14, 0.12 + ruggedness01 * 0.08, 0.08),
          createLandCenter(0.66, 0.58, 0.14, 0.12 + ruggedness01 * 0.08, 0.08)
        ];
      case "SHELF":
        return [createLandCenter(0.58, 0.44, 0.14, 0.12 + relief01 * 0.08, 0.08)];
      case "MASSIF":
      default:
        return [
          createLandCenter(0.5, 0.52, 0.34, 0.34 + relief01 * 0.28, 0.08),
          createLandCenter(0.36, 0.38, 0.2, 0.18 + ruggedness01 * 0.14, 0.11),
          createLandCenter(0.66, 0.64, 0.18, 0.16 + ruggedness01 * 0.12, 0.11)
        ];
    }
  })();

  const basinCount = Math.max(1, Math.round(1 + basinStrength * 3));
  const basinCenters = Array.from({ length: basinCount }, (_, index) => {
    const arc = bandAngle + (index / basinCount) * Math.PI * 2 + rng.next() * 0.7;
    const radiusT = mix(0.12, 0.28, rng.next());
    return {
      x: mix(landMinX, landMaxX, 0.5 + Math.cos(arc) * radiusT),
      y: mix(landMinY, landMaxY, 0.5 + Math.sin(arc) * radiusT),
      radius: minDimM * mix(0.08, 0.18, basinStrength + rng.next() * 0.25),
      depth: mix(0.06, 0.18, basinStrength) * valleyDepth * BASIN_DEPTH_SCALE
    };
  });

  const macroWeight = clamp(ELEVATION_MACRO_WEIGHT, 0, 1);
  const detailWeight = clamp(ELEVATION_DETAIL_WEIGHT, 0, 1);
  const weightSum = Math.max(0.0001, macroWeight + detailWeight);
  const peakWeight = 0.65;
  const sampleOffsets = [
    { x: 0.25, y: 0.25 },
    { x: 0.75, y: 0.25 },
    { x: 0.25, y: 0.75 },
    { x: 0.75, y: 0.75 },
    { x: 0.5, y: 0.5 }
  ];
  const sampleIslandShapeAt = (sampleX: number, sampleY: number): number => {
    const u = sampleX / Math.max(1, cols - 1);
    const v = sampleY / Math.max(1, rows - 1);
    const nx = u * 2 - 1;
    const ny = v * 2 - 1;
    const shiftedNX = nx + shapeDriftX;
    const shiftedNY = ny + shapeDriftY;
    const rotatedNX = shiftedNX * shapeRotationCos - shiftedNY * shapeRotationSin;
    const rotatedNY = shiftedNX * shapeRotationSin + shiftedNY * shapeRotationCos;
    const radial = Math.hypot(rotatedNX, rotatedNY);
    const theta = Math.atan2(rotatedNY, rotatedNX);
    const worldX = worldOffsetXM + sampleX * cellSizeM;
    const worldY = worldOffsetYM + sampleY * cellSizeM;
    const coastNoise = fractalNoise(worldX / Math.max(700, macroScaleM * 0.58), worldY / Math.max(700, macroScaleM * 0.58), state.seed + 1877);
    const coastNoiseB = fractalNoise(worldX / Math.max(420, macroScaleM * 0.36), worldY / Math.max(420, macroScaleM * 0.36), state.seed + 1919);
    const coastlineDistortionCap = mix(0.04, archetypeDefinition.coastlineDistortionCap, coastComplexity);
    const coastWarp = clamp(
      (coastNoise * 2 - 1) * mix(0.04, 0.18, coastComplexity)
      + (coastNoiseB * 2 - 1) * mix(0.02, 0.12, clamp(coastComplexity * 0.55 + ruggedness01 * 0.45, 0, 1)),
      -coastlineDistortionCap,
      coastlineDistortionCap
    );
    const macroHarmonicWarp = clamp(
      Math.sin(theta * macroShapeLobeCountA + macroShapeLobePhaseA) * macroShapeLobeAmpA
      + Math.sin(theta * macroShapeLobeCountB - macroShapeLobePhaseB) * macroShapeLobeAmpB,
      -coastlineDistortionCap * 0.9,
      coastlineDistortionCap * 0.9
    );
    const harmonicWarp = clamp(
      Math.sin(theta * shapeLobeCountA + shapeLobePhaseA) * shapeLobeAmpA
      + Math.sin(theta * shapeLobeCountB - shapeLobePhaseB) * shapeLobeAmpB,
      -coastlineDistortionCap * 0.72,
      coastlineDistortionCap * 0.72
    );
    const blobShape = sampleSilhouetteField(silhouetteBlobs, rotatedNX, rotatedNY);
    const cutShape = sampleSilhouetteField(silhouetteCuts, rotatedNX, rotatedNY);
    const headlandShape = sampleSilhouetteField(coastHeadlands, rotatedNX, rotatedNY);
    const bayShape = sampleSilhouetteField(coastBays, rotatedNX, rotatedNY);
    switch (terrainArchetype) {
      case "LONG_SPINE": {
        const spineProfile = sampleRidgeSpineProfile(rotatedNX, rotatedNY);
        const ellipse = 1 - smoothstep(
          mix(0.62, 0.84, islandCompactness),
          mix(0.94, 1.12, islandCompactness),
          Math.hypot(rotatedNX * 0.74, rotatedNY * 1.18) - coastWarp * 0.62 - harmonicWarp * 0.16 - macroHarmonicWarp * 0.34
        );
        return clamp(
          ellipse * 0.24
          + spineProfile.footprint * 0.7
          + spineProfile.crest * 0.24
          + blobShape * 0.16
          + headlandShape * 0.1
          - cutShape * 0.08
          - bayShape * 0.12
          + harmonicWarp * 0.03
          + macroHarmonicWarp * 0.07,
          0,
          1
        );
      }
      case "TWIN_BAY": {
        const splitStraitProfile = sampleSplitStraitProfile(rotatedNX, rotatedNY);
        const compactShield = 1 - smoothstep(
          mix(0.66, 0.82, islandCompactness),
          mix(0.92, 1.06, islandCompactness),
          Math.hypot(rotatedNX * 0.78, rotatedNY * 0.92) - coastWarp * 0.42 - harmonicWarp * 0.12 - macroHarmonicWarp * 0.16
        );
        return clamp(
          compactShield * 0.28
          + splitStraitProfile.footprint * 0.62
          + splitStraitProfile.crest * 0.18
          + blobShape * 0.12
          + headlandShape * 0.08
          - cutShape * 0.1
          - bayShape * 0.18
          + coastWarp * 0.03
          + harmonicWarp * 0.02
          + macroHarmonicWarp * 0.04,
          0,
          1
        );
      }
      case "SHELF": {
        const plateau = 1 - smoothstep(
          mix(0.72, 0.9, islandCompactness),
          mix(0.96, 1.1, islandCompactness),
          Math.hypot(rotatedNX * 0.82, rotatedNY * 0.9) - coastWarp * 0.28 - harmonicWarp * 0.08 - macroHarmonicWarp * 0.1
        );
        return clamp(
          plateau * 0.58
          + blobShape * 0.34
          + headlandShape * 0.06
          - cutShape * 0.04
          - bayShape * 0.08
          + coastWarp * 0.02
          + harmonicWarp * 0.01
          + macroHarmonicWarp * 0.02,
          0,
          1
        );
      }
      case "MASSIF":
      default: {
        const baseRadius = mix(0.72, 0.9, islandCompactness);
        const lobe =
          macroHarmonicWarp * mix(0.7, 1.25, coastComplexity)
          + harmonicWarp * mix(0.45, 1.0, coastComplexity)
          + coastWarp * mix(0.5, 0.88, coastComplexity);
        const base = 1 - smoothstep(baseRadius - 0.28, baseRadius + 0.06, radial - lobe);
        return clamp(
          base * 0.18
          + blobShape * 0.72
          + headlandShape * 0.18
          - cutShape * 0.14
          - bayShape * 0.2,
          0,
          1
        );
      }
    }
  };

  const sampleCarvingAt = (sampleX: number, sampleY: number): { carve: number; landShape: number } => {
    const worldX = worldOffsetXM + sampleX * cellSizeM;
    const worldY = worldOffsetYM + sampleY * cellSizeM;
    const drainageA = fractalNoise(worldX / Math.max(600, midScaleM * 0.8), worldY / Math.max(600, midScaleM * 0.8), state.seed + 4001);
    const drainageB = fractalNoise(worldX / Math.max(400, detailScaleM * 1.15), worldY / Math.max(400, detailScaleM * 1.15), state.seed + 4027);
    const valleyNoise = 1 - Math.abs(drainageA * 2 - 1);
    const basinNoise = 1 - Math.abs(drainageB * 2 - 1);
    const u = sampleX / Math.max(1, cols - 1);
    const v = sampleY / Math.max(1, rows - 1);
    const interior = Math.pow(clamp(1 - Math.hypot(u * 2 - 1, v * 2 - 1), 0, 1), 1.15);
    const islandShape = clamp(sampleIslandShapeAt(sampleX, sampleY), 0, 1);
    const landEnvelope = smoothstep(0.14, 0.6, islandShape);
    const channelSignal = smoothstep(
      mix(0.54, 0.64, 1 - riverIntensity),
      mix(0.82, 0.94, riverIntensity),
      valleyNoise
    );
    const basinSignal = smoothstep(0.72, 0.94, basinNoise) * interior;
    const coastGuard = smoothstep(0.08, 0.3, landEnvelope * 0.7 + interior * 0.3);
    return {
      carve: clamp(
        channelSignal * mix(0.42, 0.88, riverIntensity) * landEnvelope
        + basinSignal * mix(0.04, 0.24, basinStrength) * coastGuard,
        0,
        1
      ),
      landShape: islandShape
    };
  };
  const sampleElevationAt = (sampleX: number, sampleY: number): number => {
    const edgeDistM = Math.min(sampleX, sampleY, cols - 1 - sampleX, rows - 1 - sampleY) * cellSizeM;
    const edgeFactor = clamp(edgeDistM / centerFactorM, 0, 1);
    const worldX = worldOffsetXM + sampleX * cellSizeM;
    const worldY = worldOffsetYM + sampleY * cellSizeM;
    const warpA = fractalNoise(worldX / warpScaleM, worldY / warpScaleM, state.seed + 33);
    const warpB = fractalNoise(worldX / warpScaleM, worldY / warpScaleM, state.seed + 67);
    const warpX = (warpA - 0.5) * WARP_MAG_M;
    const warpY = (warpB - 0.5) * WARP_MAG_M;
    const worldNX = worldX + warpX;
    const worldNY = worldY + warpY;
    const macroNoise = fractalNoise(worldNX / macroScaleM, worldNY / macroScaleM, state.seed + 991);
    const detailNoiseA = fractalNoise(worldNX / midScaleM, worldNY / midScaleM, state.seed + 517);
    const detailNoiseB = fractalNoise(worldNX / detailScaleM, worldNY / detailScaleM, state.seed + 151);
    const ridgeNoise = fractalNoise(worldNX / ridgeScaleM, worldNY / ridgeScaleM, state.seed + 703);
    const ridge = 1 - Math.abs(ridgeNoise * 2 - 1);
    const ridgeCentered = ridge * 2 - 1;
    const lowFreqWeight = 0.72 + archetypeDefinition.lowFreqAmplitude * 1.4;
    const midFreqWeight = 0.48 + archetypeDefinition.midFreqAmplitude * 1.7;
    const highFreqWeight = 0.22 + archetypeDefinition.highFreqAmplitude * 2.3;
    const bandCoord = (worldX * bandDir.x + worldY * bandDir.y) / bandScaleM;
    const band = (Math.sin(bandCoord + bandPhase) + 1) * 0.5;
    const bandBoost = (band - 0.5) * bandStrength;
    let macroElevation = (macroNoise * 2 - 1) * lowFreqWeight;
    const landBias = getLandBias(sampleX, sampleY, cols, rows, state.seed);
    macroElevation = clamp(macroElevation + (landBias - 0.5) * LAND_MASS_BIAS_STRENGTH, -1, 1);
    const detailElevationBase =
      ((detailNoiseA * 2 - 1) * midFreqWeight + (detailNoiseB * 2 - 1) * highFreqWeight)
      / Math.max(0.0001, midFreqWeight + highFreqWeight);
    let detailElevation = clamp(
      detailElevationBase + ridgeCentered * ridgeStrength * mix(0.72, 1.18, midFreqWeight / Math.max(0.0001, midFreqWeight + highFreqWeight)),
      -1,
      1
    );
    let elevation =
      (macroElevation * macroWeight + detailElevation * detailWeight)
      / Math.max(0.0001, macroWeight * lowFreqWeight + detailWeight);
    elevation = elevation * 0.5 + 0.5;
    const u = sampleX / Math.max(1, cols - 1);
    const v = sampleY / Math.max(1, rows - 1);
    const radial = Math.hypot(u * 2 - 1, v * 2 - 1);
    const islandShape = clamp(sampleIslandShapeAt(sampleX, sampleY), 0, 1);
    const nx = u * 2 - 1;
    const ny = v * 2 - 1;
    const shiftedNX = nx + shapeDriftX;
    const shiftedNY = ny + shapeDriftY;
    const rotatedNX = shiftedNX * shapeRotationCos - shiftedNY * shapeRotationSin;
    const rotatedNY = shiftedNX * shapeRotationSin + shiftedNY * shapeRotationCos;
    const interiorField = Math.pow(clamp(1 - radial / mix(1.08, 0.74, islandCompactness), 0, 1), mix(1.8, 0.95, interiorRise));
    const upliftNoise = fractalNoise(worldNX / Math.max(260, macroScaleM * 0.42), worldNY / Math.max(260, macroScaleM * 0.42), state.seed + 1187);
    const peakNoise = fractalNoise(worldNX / Math.max(140, detailScaleM * 0.72), worldNY / Math.max(140, detailScaleM * 0.72), state.seed + 1229);
    elevation += edgeFactor * 0.03;
    elevation = elevation * (0.7 + band * 0.38) + bandBoost * 0.45;
    let landBoost = 0;
    for (const land of landCenters) {
      const dx = (worldX - land.x) / land.radius;
      const dy = (worldY - land.y) / land.radius;
      const d = Math.hypot(dx, dy);
      if (d < 1) {
        landBoost = Math.max(landBoost, Math.pow(1 - d, landPeakSharpness) * land.height);
      }
    }
    const landEdgeFactor = edgeFactor * edgeFactor * edgeFactor;
    const islandUpliftScale =
      archetypeDefinition.upliftProfile === "central_peak"
        ? 1.08
        : archetypeDefinition.upliftProfile === "spine_ridge"
          ? 0.92
          : archetypeDefinition.upliftProfile === "bay_shield"
            ? 0.88
            : 0.72;
    const interiorUpliftScale =
      archetypeDefinition.upliftProfile === "shelf_plateau"
        ? 1.12
        : archetypeDefinition.upliftProfile === "bay_shield"
          ? 0.92
          : 0.86;
    const peakFieldScale =
      archetypeDefinition.upliftProfile === "central_peak"
        ? 1.18
        : archetypeDefinition.upliftProfile === "spine_ridge"
          ? 0.94
          : archetypeDefinition.upliftProfile === "bay_shield"
            ? 0.82
            : 0.56;
    const islandUplift = islandShape * mix(0.15, 0.46, reliefCurve) * mix(0.68, 1.16, upliftNoise) * islandUpliftScale;
    const interiorUplift =
      interiorField
      * mix(0.06, 0.2, interiorRise)
      * mix(0.86, 1.12, upliftNoise)
      * mix(0.82, 1.04, reliefCurve)
      * interiorUpliftScale;
    const peakField =
      landBoost * landEdgeFactor * mix(0.06, 0.64, reliefPeakCurve) * mix(0.84, 1.18, peakNoise) * peakFieldScale;
    const ridgeSpineProfile = terrainArchetype === "LONG_SPINE" ? sampleRidgeSpineProfile(rotatedNX, rotatedNY) : null;
    const splitStraitProfile = terrainArchetype === "TWIN_BAY" ? sampleSplitStraitProfile(rotatedNX, rotatedNY) : null;
    const ridgeSpineUplift =
      ridgeSpineProfile
        ? ridgeSpineProfile.footprint * mix(0.06, 0.24, reliefCurve) * mix(0.92, 1.1, upliftNoise)
          + ridgeSpineProfile.crest * mix(0.08, 0.34, reliefPeakCurve) * mix(0.88, 1.2, peakNoise)
        : 0;
    const splitStraitUplift =
      splitStraitProfile
        ? splitStraitProfile.footprint * mix(0.04, 0.18, reliefCurve) * mix(0.9, 1.08, upliftNoise)
          + splitStraitProfile.crest * mix(0.08, 0.28, reliefPeakCurve) * mix(0.86, 1.16, peakNoise)
        : 0;
    const ridgeUplift =
      ridge * ridge * mix(0.03, 0.2, ruggedness01) * clamp(islandShape * 0.5 + upliftNoise * 0.52, 0, 1.1) * mix(0.76, 1.04, reliefCurve);
    const rawElevation =
      elevation * mix(0.4, 0.58, ruggedness01)
      + islandUplift
      + interiorUplift
      + peakField
      + ridgeSpineUplift
      + splitStraitUplift
      + ridgeUplift;
    elevation = clamp(
      softenPeaks(
        rawElevation,
        mix(0.78, 0.97, clamp(reliefCurve * 0.38 + maxHeight01 * 0.32, 0, 1)),
        mix(3.4, 0.6, clamp(reliefCurve * 0.22 + maxHeight01 * 0.5, 0, 1))
      ),
      0,
      1
    );
    let basinDrop = 0;
    for (const basin of basinCenters) {
      const dx = (worldX - basin.x) / basin.radius;
      const dy = (worldY - basin.y) / basin.radius;
      const d = Math.hypot(dx, dy);
      if (d < 1) {
        basinDrop = Math.max(basinDrop, (1 - d) * basin.depth);
      }
    }
    elevation = clamp(elevation - basinDrop, 0, 1);
    const edgeWeight = Math.pow(clamp(edgeFactor, 0, 1), EDGE_LAND_EXPONENT);
    const edgeScale = 1 - mix(0.16, 0.42, 1 - coastalShelfWidth) * (1 - edgeWeight);
    const seaLevel = clampSeaLevel(
      settings.baseWaterThreshold + (1 - edgeFactor) * settings.edgeWaterBias,
      settings
    );
    const baseline = Math.max(WATER_BASELINE_ELEV, seaLevel - EDGE_WATER_BASE_OFFSET * mix(0.6, 1.8, coastalShelfWidth));
    elevation = baseline + (elevation - baseline) * edgeScale;
    elevation = clamp((elevation - 0.5) * ELEVATION_CONTRAST + 0.5, 0, 1);
    return elevation;
  };
  const totalTiles = state.grid.totalTiles;
  const riverMask = new Uint8Array(totalTiles);
  const sampleCoarse = (arr: ArrayLike<number>, gx: number, gy: number): number => {
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const x1 = Math.min(coarseCols - 1, x0 + 1);
    const y1 = Math.min(coarseRows - 1, y0 + 1);
    const tx = clamp(gx - x0, 0, 1);
    const ty = clamp(gy - y0, 0, 1);
    const i00 = y0 * coarseCols + x0;
    const i10 = y0 * coarseCols + x1;
    const i01 = y1 * coarseCols + x0;
    const i11 = y1 * coarseCols + x1;
    const v00 = arr[i00] ?? 0;
    const v10 = arr[i10] ?? 0;
    const v01 = arr[i01] ?? 0;
    const v11 = arr[i11] ?? 0;
    const v0 = v00 + (v10 - v00) * tx;
    const v1 = v01 + (v11 - v01) * tx;
    return v0 + (v1 - v0) * ty;
  };
  const edgeWidth = Math.max(8, Math.floor(getEdgeWidth(cols, rows) * mix(0.72, 1.6, coastalShelfWidth)));
  const edgeDenomM = (Math.min(cols, rows) * cellSizeM) / 2;
  const shouldStopAfter = (phase: MapGenDebugPhase): boolean => debug?.stopAfterPhase === phase;
  const buildPreviewElevationFromCoarse = (source: ArrayLike<number>): number[] => {
    const elevationMap = Array.from({ length: totalTiles }, () => 0);
    state.valleyMap = Array.from({ length: totalTiles }, () => 0);
    for (let y = 0; y < rows; y += 1) {
      const rowBase = y * cols;
      const gy = y / blockSize;
      for (let x = 0; x < cols; x += 1) {
        const gx = x / blockSize;
        const idx = rowBase + x;
        const falloff = getEdgeFalloff(x, y, cols, rows, edgeWidth, state.seed);
        const softened = sampleCoarse(source, gx, gy);
        const edgeDistM = Math.min(x, y, cols - 1 - x, rows - 1 - y) * cellSizeM;
        const edgeFactor = clamp(edgeDistM / edgeDenomM, 0, 1);
        const seaLevel = clampSeaLevel(
          settings.baseWaterThreshold + (1 - edgeFactor) * settings.edgeWaterBias,
          settings
        );
        const baseline = Math.max(WATER_BASELINE_ELEV, seaLevel - EDGE_WATER_BASE_OFFSET);
        elevationMap[idx] = clamp(baseline + (softened - baseline) * falloff, 0, 1);
        state.valleyMap[idx] = sampleCoarse(coarseValleyMap, gx, gy);
      }
    }
    return elevationMap;
  };

  for (let cy = 0; cy < coarseRows; cy += 1) {
    const startY = cy * blockSize;
    const height = Math.min(blockSize, rows - startY);
    for (let cx = 0; cx < coarseCols; cx += 1) {
      const startX = cx * blockSize;
      const width = Math.min(blockSize, cols - startX);
      let sum = 0;
      let count = 0;
      let maxValue = 0;
      for (const offset of sampleOffsets) {
        const sampleX = Math.min(cols - 1, startX + width * offset.x);
        const sampleY = Math.min(rows - 1, startY + height * offset.y);
        const elevation = sampleElevationAt(sampleX, sampleY);
        sum += elevation;
        count += 1;
        if (elevation > maxValue) {
          maxValue = elevation;
        }
      }
      const avg = count > 0 ? sum / count : 0;
      const blended = avg * (1 - peakWeight) + maxValue * peakWeight;
      const coarseIndex = cy * coarseCols + cx;
      const centerX = Math.min(cols - 1, startX + width * 0.5);
      const centerY = Math.min(rows - 1, startY + height * 0.5);
      const carvingSample = sampleCarvingAt(centerX, centerY);
      coarseElevation[coarseIndex] = clamp(blended, 0, 1);
      coarseValleyMap[coarseIndex] = carvingSample.carve;
      coarseShapeMap[coarseIndex] = carvingSample.landShape;
      coarseSampleXMap[coarseIndex] = centerX;
      coarseSampleYMap[coarseIndex] = centerY;
    }
    if (yieldIfNeeded && report) {
      if (await yieldIfNeeded()) {
        await report("Reticulating splines...", (cy + 1) / coarseRows * 0.55);
      }
    }
  }

  const smoothPasses = blockSize >= 4 ? 2 : 3;
  for (let pass = 0; pass < smoothPasses; pass += 1) {
    for (let cy = 0; cy < coarseRows; cy += 1) {
      for (let cx = 0; cx < coarseCols; cx += 1) {
        const idx = cy * coarseCols + cx;
        let neighborSum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) {
              continue;
            }
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= coarseCols || ny >= coarseRows) {
              continue;
            }
            neighborSum += coarseElevation[ny * coarseCols + nx];
            count += 1;
          }
        }
        const avg = count > 0 ? neighborSum / count : coarseElevation[idx];
        coarseTemp[idx] = clamp(coarseElevation[idx] * 0.42 + avg * 0.58, 0, 1);
      }
      if (yieldIfNeeded && report) {
        if (await yieldIfNeeded()) {
          const passProgress = (pass + (cy + 1) / coarseRows) / smoothPasses;
          await report("Smoothing terrain...", 0.55 + passProgress * 0.25);
        }
      }
    }
    for (let i = 0; i < coarseElevation.length; i += 1) {
      coarseElevation[i] = coarseTemp[i];
    }
  }

  for (let i = 0; i < coarseElevation.length; i += 1) {
    const value = coarseElevation[i];
    const shaped =
      Math.pow(value, mix(0.98, elevationExponent, reliefCurve * 0.75))
      * mix(0.82, 1.04, reliefCurve)
      * normalizedHeightPressure;
    const scaled = shaped * elevationScale;
    const softened = softenPeaks(
      scaled,
      mix(0.84, 0.992, clamp(reliefCurve * 0.22 + ruggedness01 * 0.12 + maxHeight01 * 0.36, 0, 1)),
      mix(2.8, 0.34, clamp(reliefCurve * 0.14 + maxHeight01 * 0.62, 0, 1))
    );
    coarseElevation[i] = clamp(softened, 0, 1);
    if (yieldIfNeeded && report && i % coarseCols === coarseCols - 1) {
      if (await yieldIfNeeded()) {
        const row = Math.floor(i / coarseCols);
        await report("Softening peaks...", 0.9 + (row + 1) / coarseRows * 0.1);
      }
    }
  }

  const reliefElevationMap = buildPreviewElevationFromCoarse(coarseElevation);
  const reliefSeaLevelBase = resolveSeaLevelBase(state, settings, reliefElevationMap, cellSizeM);
  if (debug) {
    await emitDebugPhase(
      debug,
      "terrain:relief",
      state,
      settings,
      reliefElevationMap,
      undefined,
      buildSolidLandTypeIds(state),
      reliefSeaLevelBase
    );
    if (shouldStopAfter("terrain:relief")) {
      return { elevationMap: reliefElevationMap, riverMask, seaLevelBase: reliefSeaLevelBase };
    }
  }

  if (!settings.skipCarving) {
    const carvingStrength =
      mix(0.02, 0.11, clamp(riverIntensity * 0.55 + basinStrength * 0.45, 0, 1))
      * mix(0.42, 1, reliefCurve);
    for (let i = 0; i < coarseElevation.length; i += 1) {
      const sampleX = coarseSampleXMap[i];
      const sampleY = coarseSampleYMap[i];
      const edgeDistM = Math.min(sampleX, sampleY, cols - 1 - sampleX, rows - 1 - sampleY) * cellSizeM;
      const edgeFactor = clamp(edgeDistM / edgeDenomM, 0, 1);
      const localSeaLevel = clampSeaLevel(
        reliefSeaLevelBase + (1 - edgeFactor) * settings.edgeWaterBias,
        settings
      );
      const landShape = smoothstep(0.14, 0.7, coarseShapeMap[i]);
      const carveSignal = smoothstep(0.16, 0.74, coarseValleyMap[i]) * landShape;
      const headroom = Math.max(0, coarseElevation[i] - localSeaLevel);
      const coastGuard = smoothstep(0.025, 0.14, headroom);
      const maxCut = Math.max(0, headroom - mix(0.02, 0.05, coastalShelfWidth));
      const requestedCut = carveSignal * coastGuard * carvingStrength * valleyDepth;
      const carved = coarseElevation[i] - Math.min(requestedCut, maxCut);
      coarseElevation[i] = clamp(carved, 0, 1);
    }
  }

  const elevationMap = Array.from({ length: totalTiles }, () => 0);
  state.valleyMap = Array.from({ length: totalTiles }, () => 0);
  for (let y = 0; y < rows; y += 1) {
    const rowBase = y * cols;
    const gy = y / blockSize;
    for (let x = 0; x < cols; x += 1) {
      const gx = x / blockSize;
      const idx = rowBase + x;
      const falloff = getEdgeFalloff(x, y, cols, rows, edgeWidth, state.seed);
      const softened = sampleCoarse(coarseElevation, gx, gy);
      const edgeDistM = Math.min(x, y, cols - 1 - x, rows - 1 - y) * cellSizeM;
      const edgeFactor = clamp(edgeDistM / edgeDenomM, 0, 1);
      const seaLevel = clampSeaLevel(
        settings.baseWaterThreshold + (1 - edgeFactor) * settings.edgeWaterBias,
        settings
      );
      const baseline = Math.max(WATER_BASELINE_ELEV, seaLevel - EDGE_WATER_BASE_OFFSET);
      elevationMap[idx] = clamp(baseline + (softened - baseline) * falloff, 0, 1);
      state.valleyMap[idx] = sampleCoarse(coarseValleyMap, gx, gy);
    }
    if (yieldIfNeeded && report) {
      if (await yieldIfNeeded()) {
        await report("Reticulating splines...", 0.55 + (y + 1) / rows * 0.05);
      }
    }
  }
  const seaLevelBase = resolveSeaLevelBase(state, settings, elevationMap, cellSizeM);
  await emitDebugPhase(
    debug,
    "terrain:carving",
    state,
    settings,
    elevationMap,
    undefined,
    buildSolidLandTypeIds(state),
    seaLevelBase
  );
  if (shouldStopAfter("terrain:carving")) {
    return { elevationMap, riverMask, seaLevelBase };
  }
  await emitDebugPhase(debug, "terrain:flooding", state, settings, elevationMap, undefined, undefined, seaLevelBase);
  if (shouldStopAfter("terrain:flooding")) {
    return { elevationMap, riverMask, seaLevelBase };
  }
  await emitDebugPhase(debug, "terrain:elevation", state, settings, elevationMap, undefined, undefined, seaLevelBase);
  if (shouldStopAfter("terrain:elevation")) {
    return { elevationMap, riverMask, seaLevelBase };
  }

  const edgeSmoothRadius = edgeWidth * 3;
  const temp = new Float32Array(elevationMap.length);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const idx = y * cols + x;
      const edgeDist = Math.min(x, y, cols - 1 - x, rows - 1 - y);
      if (edgeDist >= edgeSmoothRadius) {
        temp[idx] = elevationMap[idx];
        continue;
      }
      let sum = elevationMap[idx];
      let count = 1;
      if (x > 0) {
        sum += elevationMap[idx - 1];
        count += 1;
      }
      if (x < cols - 1) {
        sum += elevationMap[idx + 1];
        count += 1;
      }
      if (y > 0) {
        sum += elevationMap[idx - cols];
        count += 1;
      }
      if (y < rows - 1) {
        sum += elevationMap[idx + cols];
        count += 1;
      }
      const avg = sum / count;
      const t = 1 - clamp(edgeDist / edgeSmoothRadius, 0, 1);
      const blend = 0.6 * t;
      temp[idx] = elevationMap[idx] * (1 - blend) + avg * blend;
    }
  }
  for (let i = 0; i < elevationMap.length; i += 1) {
    elevationMap[i] = temp[i];
  }

  return { elevationMap, riverMask, seaLevelBase };
}

async function buildMoistureMap(
  state: WorldState,
  distToWater: Uint16Array,
  maxWaterDistance: number,
  report?: MapGenReporter,
  yieldIfNeeded?: () => Promise<boolean>
): Promise<Float32Array> {
  const total = state.grid.totalTiles;
  const moisture = new Float32Array(total);
  const maxDistance = Math.max(1, Math.min(0xffff - 1, Math.floor(maxWaterDistance)));
  const dryRange = Math.max(0.0001, MOISTURE_ELEV_DRY_RANGE);
  const gamma = Math.max(0.01, MOISTURE_GAMMA);

  for (let y = 0; y < state.grid.rows; y += 1) {
    const rowBase = y * state.grid.cols;
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = rowBase + x;
      const tile = state.tiles[idx];
      if (tile.type === "water") {
        moisture[idx] = 1;
        continue;
      }
      const dNorm = clamp(distToWater[idx] / maxDistance, 0, 1);
      let m = 1 - dNorm;
      const eNorm = clamp((tile.elevation - MOISTURE_ELEV_WET_REF) / dryRange, 0, 1);
      m = clamp(m - eNorm * MOISTURE_ELEV_DRYNESS_WEIGHT, 0, 1);
      moisture[idx] = clamp(Math.pow(m, gamma), 0, 1);
    }
    if (yieldIfNeeded && report) {
      if (await yieldIfNeeded()) {
        await report("Mapping moisture...", (y + 1) / state.grid.rows);
      }
    }
  }
  return moisture;
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

async function computeWaterDistances(
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

function isBaseCandidate(state: WorldState, x: number, y: number, buffer: number): boolean {
  if (!inBounds(state.grid, x, y)) {
    return false;
  }
  if (state.tiles[indexFor(state.grid, x, y)].type === "water") {
    return false;
  }
  for (let dy = -buffer; dy <= buffer; dy += 1) {
    for (let dx = -buffer; dx <= buffer; dx += 1) {
      if (Math.hypot(dx, dy) > buffer) {
        continue;
      }
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(state.grid, nx, ny)) {
        return false;
      }
      if (state.tiles[indexFor(state.grid, nx, ny)].type === "water") {
        return false;
      }
    }
  }
  return true;
}

function findBasePoint(state: WorldState): Point {
  const center = { x: Math.floor(state.grid.cols / 2), y: Math.floor(state.grid.rows / 2) };
  const buffer = 4;
  if (isBaseCandidate(state, center.x, center.y, buffer)) {
    return center;
  }
  const maxRadius = Math.max(state.grid.cols, state.grid.rows);
  for (let radius = 1; radius < maxRadius; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) {
          continue;
        }
        const x = center.x + dx;
        const y = center.y + dy;
        if (isBaseCandidate(state, x, y, buffer)) {
          return { x, y };
        }
      }
    }
  }
  return center;
}

function buildOceanMask(state: WorldState): Uint8Array {
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

function buildEdgeConnectedMask(mask: Uint8Array, cols: number, rows: number): Uint8Array {
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

function buildDistanceFromMask(mask: Uint8Array, cols: number, rows: number): Uint16Array {
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

function expandOceanMaskByLocalSeaLevel(
  elevationMap: ArrayLike<number>,
  seaLevelMap: ArrayLike<number>,
  oceanMask: Uint8Array,
  riverMask: Uint8Array,
  cols: number,
  rows: number,
  seaMargin: number
): Uint8Array {
  const expanded = Uint8Array.from(oceanMask);
  const total = cols * rows;
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < total; i += 1) {
    if (expanded[i]) {
      queue[tail] = i;
      tail += 1;
    }
  }
  while (head < tail) {
    const idx = queue[head];
    head += 1;
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    const tryPush = (nIdx: number): void => {
      if (expanded[nIdx] || riverMask[nIdx] > 0) {
        return;
      }
      const sea = seaLevelMap[nIdx] ?? 0;
      const elev = elevationMap[nIdx] ?? 0;
      if (elev <= sea + seaMargin) {
        expanded[nIdx] = 1;
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
  return expanded;
}

function clampRiverMouthDepthsToSeaLevel(
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

function seedInitialVegetationState(
  state: WorldState,
  biomeSuitabilityMap?: ArrayLike<number> | null,
  microMap?: ArrayLike<number> | null,
  meadowMaskMap?: ArrayLike<number> | null
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
      const micro = clamp(microMap?.[idx] ?? 0.5, 0, 1);
      const edgeDepth = Math.max(0, edgeDistance[idx]);
      const edgeDepth01 = clamp(edgeDepth / 3.5, 0, 1);
      const interiorBias = clamp((forestNeighbors - 1) / 3, 0, 1);
      const maturityBias = clamp(edgeDepth01 * 0.68 + interiorBias * 0.12 + suitability * 0.14 + micro * 0.06, 0, 1);
      const edgeAge = 8 + hash2D(x, y, state.seed + 12031) * 8;
      const upperAge = 22 + hash2D(x, y, state.seed + 12067) * 12;
      tile.vegetationAgeYears = clamp(edgeAge * (1 - maturityBias) + upperAge * maturityBias, 8, 34);
      syncDerivedVegetationState(tile, state.seed, x, y);
    }
  }
}

function countMaskTiles(mask: Uint8Array): number {
  let total = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i]) {
      total += 1;
    }
  }
  return total;
}

function countEdgeMaskTiles(mask: Uint8Array, cols: number, rows: number): number {
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

function enforceEdgeOceanMask(
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

function buildLargestWaterMask(state: WorldState): Uint8Array {
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
  const seaLevelMap = new Float32Array(state.grid.totalTiles);
  const edgeDenomM = (Math.min(state.grid.cols, state.grid.rows) * cellSizeM) / 2;
  for (let y = 0; y < state.grid.rows; y += 1) {
    const rowBase = y * state.grid.cols;
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = rowBase + x;
      const edgeDistM = Math.min(x, y, state.grid.cols - 1 - x, state.grid.rows - 1 - y) * cellSizeM;
      const edgeFactor = clamp(edgeDistM / edgeDenomM, 0, 1);
      seaLevelMap[idx] = clampSeaLevel(seaLevelBase + (1 - edgeFactor) * settings.edgeWaterBias, settings);
    }
  }
  return seaLevelMap;
}

function buildOceanMaskFromElevation(
  state: WorldState,
  elevationMap: ArrayLike<number>,
  seaLevelMap: ArrayLike<number>
): Uint8Array {
  const { cols, rows, totalTiles } = state.grid;
  const edgeWidth = getEdgeWidth(cols, rows);
  const waterMask = new Uint8Array(totalTiles);
  for (let y = 0; y < rows; y += 1) {
    const rowBase = y * cols;
    for (let x = 0; x < cols; x += 1) {
      const idx = rowBase + x;
      const localSea = seaLevelMap[idx] ?? 0;
      const baseline = Math.max(WATER_BASELINE_ELEV, localSea - EDGE_WATER_BASE_OFFSET);
      const falloff = getEdgeFalloff(x, y, cols, rows, edgeWidth, state.seed);
      const elev = elevationMap[idx] ?? 0;
      const coastElev = baseline + (elev - baseline) * falloff;
      if (coastElev <= localSea) {
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

function computeOceanLevel(
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

function expandOceanMaskByElevation(
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
  const edgeWidth = getEdgeWidth(cols, rows);
  const coastMarginBase = 0.012;
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
    const tryPush = (nIdx: number, nx: number, ny: number) => {
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
      const edgeDist = Math.min(nx, ny, cols - 1 - nx, rows - 1 - ny);
      const edgeT = clamp(1 - edgeDist / Math.max(1, edgeWidth), 0, 1);
      const seaMargin = edgeT * coastMarginBase;
      const localSea = seaLevelMap[nIdx] ?? seaLevel;
      const baseline = Math.max(WATER_BASELINE_ELEV, localSea - EDGE_WATER_BASE_OFFSET);
      const falloff = getEdgeFalloff(nx, ny, cols, rows, edgeWidth, state.seed);
      const elev = elevationMap[nIdx] ?? 0;
      const coastElev = baseline + (elev - baseline) * falloff;
      const threshold = Math.max(seaLevel, localSea) + seaMargin;
      if (coastElev <= threshold) {
        mask[nIdx] = 1;
        queue[tail] = nIdx;
        tail += 1;
      }
    };
    if (x > 0) {
      tryPush(idx - 1, x - 1, y);
    }
    if (x < cols - 1) {
      tryPush(idx + 1, x + 1, y);
    }
    if (y > 0) {
      tryPush(idx - cols, x, y - 1);
    }
    if (y < rows - 1) {
      tryPush(idx + cols, x, y + 1);
    }
  }
  return mask;
}

type RoadSegmentTrace = {
  indices: number[];
  loop: boolean;
};

const ROAD_GRADE_TARGET_LIMIT = 0.085;
const ROAD_GRADE_CHANGE_TARGET_LIMIT = 0.055;
const ROAD_SHOULDER_BLEND_RADIUS = 2;
const ROAD_WALL_DROP_THRESHOLD = 0.09;
const ROAD_WALL_OUTER_DROP_THRESHOLD = 0.11;
const ROAD_PROFILE_MAX_FILL = 0.022;
const ROAD_PROFILE_MAX_CUT = 0.14;
const ROAD_SHOULDER_MAX_FILL_NEAR = 0.028;
const ROAD_SHOULDER_MAX_FILL_FAR = 0.014;
const ROAD_SHOULDER_MAX_CUT_NEAR = 0.1;
const ROAD_SHOULDER_MAX_CUT_FAR = 0.05;

const isRoadLikeIndex = (state: WorldState, idx: number): boolean => {
  const type = state.tiles[idx]?.type;
  return type === "road" || type === "base" || state.tileRoadBridge[idx] > 0;
};

const isLandRoadLikeIndex = (state: WorldState, idx: number): boolean =>
  isRoadLikeIndex(state, idx) && state.tiles[idx]?.type !== "water";

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
  for (let i = 1; i < indices.length; i += 1) {
    const prevIdx = indices[i - 1];
    const idx = indices[i];
    const prevX = prevIdx % state.grid.cols;
    const prevY = Math.floor(prevIdx / state.grid.cols);
    const x = idx % state.grid.cols;
    const y = Math.floor(idx / state.grid.cols);
    const run = Math.hypot(x - prevX, y - prevY);
    runs[i - 1] = Math.max(1, run);
    totalRun += runs[i - 1];
    cumulative[i] = totalRun;
  }

  let target = original.slice();
  if (!loop) {
    const start = original[0];
    const end = original[original.length - 1];
    for (let i = 1; i < target.length - 1; i += 1) {
      const t = totalRun > 1e-6 ? cumulative[i] / totalRun : i / Math.max(1, target.length - 1);
      const linear = start * (1 - t) + end * t;
      target[i] = clamp(original[i] * 0.35 + linear * 0.65, 0, 1);
    }
  } else {
    const mean = original.reduce((sum, value) => sum + value, 0) / Math.max(1, original.length);
    for (let i = 0; i < target.length; i += 1) {
      target[i] = clamp(original[i] * 0.45 + mean * 0.55, 0, 1);
    }
  }

  const smoothPasses = loop ? 4 : 3;
  for (let pass = 0; pass < smoothPasses; pass += 1) {
    const next = target.slice();
    const startIndex = loop ? 0 : 1;
    const endIndex = loop ? target.length : target.length - 1;
    for (let i = startIndex; i < endIndex; i += 1) {
      const prevIndex = loop ? (i + target.length - 1) % target.length : i - 1;
      const nextIndex = loop ? (i + 1) % target.length : i + 1;
      const prevValue = target[prevIndex] ?? target[i];
      const nextValue = target[nextIndex] ?? target[i];
      next[i] = clamp(target[i] * 0.48 + (prevValue + nextValue) * 0.26, 0, 1);
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
    const minElevation = Math.max(0, originalElevation - ROAD_PROFILE_MAX_CUT);
    const maxElevation = Math.min(1, originalElevation + ROAD_PROFILE_MAX_FILL);
    target[i] = clamp(target[i], minElevation, maxElevation);
  }

  return target;
};

function gradeRoadNetworkTerrain(state: WorldState, heightScaleMultiplier = 1): RoadSurfaceMetrics {
  const total = state.grid.totalTiles;
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
        if (!neighbor || neighbor.type === "water" || neighbor.type === "house" || neighbor.type === "base") {
          continue;
        }
        if (isRoadLikeIndex(state, nIdx)) {
          continue;
        }
        const dist = Math.hypot(dx, dy);
        if (dist > ROAD_SHOULDER_BLEND_RADIUS + 0.01) {
          continue;
        }
        const weight = dist <= 1.05 ? 0.34 : 0.16;
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
    if (!tile || tile.type === "water" || tile.type === "house" || tile.type === "base" || isRoadLikeIndex(state, idx)) {
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

  return analyzeRoadSurfaceMetrics(state, heightScaleMultiplier);
}

function flattenSettlementGround(state: WorldState): void {
  const tiles = state.tiles;
  const cols = state.grid.cols;
  const rows = state.grid.rows;
  const total = state.grid.totalTiles;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const component: number[] = [];
  const ringInfluence = new Float32Array(total);
  const ringTarget = new Float32Array(total);
  const roadAdjustSum = new Float32Array(total);
  const roadAdjustCount = new Uint8Array(total);
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
    component.length = 0;
    const samples: number[] = [];
    let componentHasHouse = false;

    while (head < tail) {
      const idx = queue[head];
      head += 1;
      component.push(idx);
      samples.push(tiles[idx].elevation);
      if (tiles[idx].type === "house") {
        componentHasHouse = true;
      }
      const x = idx % cols;
      const y = Math.floor(idx / cols);
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

    if (component.length === 0) {
      continue;
    }
    samples.sort((a, b) => a - b);
    const middle = Math.floor(samples.length / 2);
    const target =
      samples.length % 2 === 0
        ? clamp((samples[middle - 1] + samples[middle]) * 0.5, 0, 1)
        : clamp(samples[middle] ?? 0, 0, 1);
    component.forEach((idx) => {
      tiles[idx].elevation = target;
    });

    component.forEach((idx) => {
      const cx = idx % cols;
      const cy = Math.floor(idx / cols);
      if (cx > 0) {
        const nIdx = idx - 1;
        if (tiles[nIdx].type === "road") {
          roadAdjustSum[nIdx] += clamp(target - tiles[nIdx].elevation, -0.02, 0.02);
          roadAdjustCount[nIdx] += 1;
        }
      }
      if (cx < cols - 1) {
        const nIdx = idx + 1;
        if (tiles[nIdx].type === "road") {
          roadAdjustSum[nIdx] += clamp(target - tiles[nIdx].elevation, -0.02, 0.02);
          roadAdjustCount[nIdx] += 1;
        }
      }
      if (cy > 0) {
        const nIdx = idx - cols;
        if (tiles[nIdx].type === "road") {
          roadAdjustSum[nIdx] += clamp(target - tiles[nIdx].elevation, -0.02, 0.02);
          roadAdjustCount[nIdx] += 1;
        }
      }
      if (cy < rows - 1) {
        const nIdx = idx + cols;
        if (tiles[nIdx].type === "road") {
          roadAdjustSum[nIdx] += clamp(target - tiles[nIdx].elevation, -0.02, 0.02);
          roadAdjustCount[nIdx] += 1;
        }
      }
    });

    component.forEach((idx) => {
      const cx = idx % cols;
      const cy = Math.floor(idx / cols);
      for (let dy = -2; dy <= 2; dy += 1) {
        const ny = cy + dy;
        if (ny < 0 || ny >= rows) {
          continue;
        }
        for (let dx = -2; dx <= 2; dx += 1) {
          const nx = cx + dx;
          if (nx < 0 || nx >= cols) {
            continue;
          }
          const chebyshev = Math.max(Math.abs(dx), Math.abs(dy));
          if (chebyshev === 0 || chebyshev > 2) {
            continue;
          }
          const nIdx = ny * cols + nx;
          recordRingInfluence(nIdx, chebyshev === 1 ? 0.75 : 0.35, target);
        }
      }
    });

    if (componentHasHouse) {
      let minElevation = Number.POSITIVE_INFINITY;
      let maxElevation = Number.NEGATIVE_INFINITY;
      component.forEach((idx) => {
        minElevation = Math.min(minElevation, tiles[idx].elevation);
        maxElevation = Math.max(maxElevation, tiles[idx].elevation);
      });
      const relief = Number.isFinite(minElevation) && Number.isFinite(maxElevation) ? maxElevation - minElevation : 0;
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
    tiles[i].elevation = clamp(tiles[i].elevation * (1 - t) + target * t, 0, 1);
  }

  for (let i = 0; i < total; i += 1) {
    const count = roadAdjustCount[i];
    if (count === 0 || tiles[i].type !== "road") {
      continue;
    }
    const delta = clamp(roadAdjustSum[i] / count, -0.02, 0.02);
    tiles[i].elevation = clamp(tiles[i].elevation + delta, 0, 1);
  }
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
  const minDimM = Math.min(state.grid.cols, state.grid.rows) * cellSizeM;
  const edgeDenomM = minDimM / 2;
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

  const { elevationMap, riverMask, seaLevelBase } = await buildElevationMap(
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
      const edgeDistM =
        Math.min(x, y, state.grid.cols - 1 - x, state.grid.rows - 1 - y) * cellSizeM;
      const edgeFactor = clamp(edgeDistM / edgeDenomM, 0, 1);
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

      const riverBias = 0;
      const seaLevel = clampSeaLevel(
        seaLevelBase + (1 - edgeFactor) * mapSettings.edgeWaterBias + riverBias,
        mapSettings
      );
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
  if (DISABLE_INLAND_LAKES && oceanMaskCount > 0) {
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
    console.log(
      `MapGen elevation: min=${elevMin.toFixed(3)} max=${elevMax.toFixed(3)} mean=${mean.toFixed(3)} water=${waterShare.toFixed(1)}%`
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
      highlandForestElevation: mapSettings.highlandForestElevation
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
    if (tile.type === "water" && oceanMask[i] && riverMask[i] === 0) {
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
    bridgeTransitions: mapSettings.road.bridgeTransitions
  });
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
    riverMask: ctx.riverMask ? Uint8Array.from(ctx.riverMask) : undefined
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

const buildSlopeMap = (state: WorldState, elevationMap: number[]): Float32Array => {
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

const computeStemDensityForTile = (state: WorldState, type: TileType, canopyCover: number, x: number, y: number): number => {
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

export async function runElevationStage(ctx: MapGenContext): Promise<void> {
  ctx.state.tiles = new Array(ctx.state.grid.totalTiles);
  await ctx.reportStage("Reticulating splines...", 0);
  const { elevationMap, riverMask, seaLevelBase } = await buildElevationMap(
    ctx.state,
    ctx.rng,
    ctx.settings,
    async (message, progress) => ctx.reportStage(message, progress),
    ctx.yieldIfNeeded,
    ctx.debug
  );
  ctx.elevationMap = elevationMap;
  ctx.riverMask = riverMask;
  ctx.seaLevelBase = seaLevelBase;
  await emitStageSnapshot(ctx, "terrain:elevation");
}

export async function runErosionStage(ctx: MapGenContext): Promise<void> {
  const { state } = ctx;
  if (!ctx.elevationMap) {
    throw new Error("Erosion stage missing elevation map.");
  }
  const input = ctx.elevationMap;
  const temp = new Float32Array(input.length);
  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = indexFor(state.grid, x, y);
      let sum = input[idx] ?? 0;
      let count = 1;
      if (x > 0) {
        sum += input[idx - 1] ?? 0;
        count += 1;
      }
      if (x < state.grid.cols - 1) {
        sum += input[idx + 1] ?? 0;
        count += 1;
      }
      if (y > 0) {
        sum += input[idx - state.grid.cols] ?? 0;
        count += 1;
      }
      if (y < state.grid.rows - 1) {
        sum += input[idx + state.grid.cols] ?? 0;
        count += 1;
      }
      const avg = sum / count;
      temp[idx] = clamp((input[idx] ?? avg) * 0.88 + avg * 0.12, 0, 1);
    }
    if (await ctx.yieldIfNeeded()) {
      await ctx.reportStage("Applying erosion...", (y + 1) / state.grid.rows);
    }
  }
  for (let i = 0; i < input.length; i += 1) {
    input[i] = temp[i] ?? input[i];
  }
  await emitStageSnapshot(ctx, "terrain:erosion");
}

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

export async function runHydrologyStage(ctx: MapGenContext): Promise<void> {
  const { state, settings, cellSizeM, edgeDenomM } = ctx;
  const elevationMap = ctx.elevationMap;
  const riverMask = ctx.riverMask;
  if (!elevationMap || !riverMask) {
    throw new Error("Hydrology stage missing elevation/river inputs.");
  }

  const totalTiles = state.grid.totalTiles;
  const seaLevelMap = new Float32Array(totalTiles);
  ctx.seaLevelMap = seaLevelMap;

  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = indexFor(state.grid, x, y);
      const edgeDistM = Math.min(x, y, state.grid.cols - 1 - x, state.grid.rows - 1 - y) * cellSizeM;
      const edgeFactor = clamp(edgeDistM / edgeDenomM, 0, 1);
      const seaLevel = clampSeaLevel(ctx.seaLevelBase + (1 - edgeFactor) * settings.edgeWaterBias, settings);
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

  if (DISABLE_INLAND_LAKES && oceanMaskCount > 0) {
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
  state.tileRiverMask = riverMask;
  await ctx.reportStage("Hydrology solved.", 1);
  await emitStageSnapshot(ctx, "hydro:solve");
}

export async function runShorelinePolishStage(ctx: MapGenContext): Promise<void> {
  const { state, settings, elevationMap, seaLevelMap, oceanMask, riverMask } = ctx;
  if (!elevationMap || !seaLevelMap || !oceanMask || !riverMask) {
    throw new Error("Shoreline stage missing hydrology fields.");
  }

  const { cols, rows, totalTiles } = state.grid;
  const baseOceanMask = Uint8Array.from(oceanMask);
  const coastalBand = new Uint8Array(totalTiles);

  for (let y = 0; y < rows; y += 1) {
    const rowBase = y * cols;
    for (let x = 0; x < cols; x += 1) {
      const idx = rowBase + x;
      if (riverMask[idx] > 0) {
        continue;
      }
      const elevation = elevationMap[idx] ?? 0;
      const seaLevel = seaLevelMap[idx] ?? 0;
      if (Math.abs(elevation - seaLevel) > SHORELINE_SEA_BAND) {
        continue;
      }
      const isOcean = baseOceanMask[idx] > 0;
      let touchesTransition = false;
      for (let dy = -2; dy <= 2 && !touchesTransition; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          if (Math.abs(dx) + Math.abs(dy) > 2) {
            continue;
          }
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
            continue;
          }
          const nIdx = ny * cols + nx;
          if (riverMask[nIdx] > 0) {
            continue;
          }
          if ((baseOceanMask[nIdx] > 0) !== isOcean) {
            touchesTransition = true;
            break;
          }
        }
      }
      if (touchesTransition) {
        coastalBand[idx] = 1;
      }
    }
    if (await ctx.yieldIfNeeded()) {
      await ctx.reportStage("Polishing shoreline...", ((y + 1) / rows) * 0.25);
    }
  }

  const oceanCandidate = Uint8Array.from(baseOceanMask);
  for (let y = 0; y < rows; y += 1) {
    const rowBase = y * cols;
    for (let x = 0; x < cols; x += 1) {
      const idx = rowBase + x;
      if (coastalBand[idx] === 0 || riverMask[idx] > 0) {
        continue;
      }
      const worldX = getWorldX(settings, x);
      const worldY = getWorldY(settings, y);
      const fine = fractalNoise(
        worldX / SHORELINE_NOISE_SCALE_FINE_M,
        worldY / SHORELINE_NOISE_SCALE_FINE_M,
        state.seed + 13031
      );
      const broad = fractalNoise(
        worldX / SHORELINE_NOISE_SCALE_BROAD_M,
        worldY / SHORELINE_NOISE_SCALE_BROAD_M,
        state.seed + 13079
      );
      const offset = ((fine * 2 - 1) * 0.65 + (broad * 2 - 1) * 0.35) * SHORELINE_NOISE_AMPLITUDE;
      const seaLevel = seaLevelMap[idx] ?? 0;
      const elevation = elevationMap[idx] ?? 0;
      oceanCandidate[idx] = elevation <= seaLevel + offset ? 1 : 0;
    }
    if (await ctx.yieldIfNeeded()) {
      await ctx.reportStage("Polishing shoreline...", 0.25 + ((y + 1) / rows) * 0.2);
    }
  }

  let source = Uint8Array.from(oceanCandidate);
  let scratch = Uint8Array.from(oceanCandidate);
  for (let pass = 0; pass < SHORELINE_SMOOTH_PASSES; pass += 1) {
    for (let y = 0; y < rows; y += 1) {
      const rowBase = y * cols;
      for (let x = 0; x < cols; x += 1) {
        const idx = rowBase + x;
        if (coastalBand[idx] === 0 || riverMask[idx] > 0) {
          scratch[idx] = source[idx];
          continue;
        }
        let waterNeighbors = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) {
              continue;
            }
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
              continue;
            }
            if (source[ny * cols + nx] > 0) {
              waterNeighbors += 1;
            }
          }
        }
        if (waterNeighbors >= 5) {
          scratch[idx] = 1;
        } else if (waterNeighbors <= 3) {
          scratch[idx] = 0;
        } else {
          scratch[idx] = source[idx];
        }
      }
      if (await ctx.yieldIfNeeded()) {
        const passProgress = (pass + (y + 1) / rows) / SHORELINE_SMOOTH_PASSES;
        await ctx.reportStage("Polishing shoreline...", 0.45 + passProgress * 0.2);
      }
    }
    const temp = source;
    source = scratch;
    scratch = temp;
  }

  for (let i = 0; i < totalTiles; i += 1) {
    if (riverMask[i] > 0) {
      source[i] = 0;
    }
  }
  let polishedOceanMask = buildEdgeConnectedMask(source, cols, rows);
  if (countEdgeMaskTiles(polishedOceanMask, cols, rows) === 0 || countMaskTiles(polishedOceanMask) === 0) {
    polishedOceanMask = baseOceanMask;
  }

  const slopeMap = buildSlopeMap(state, elevationMap);
  const landMask = new Uint8Array(totalTiles);
  for (let i = 0; i < totalTiles; i += 1) {
    if (!polishedOceanMask[i] && riverMask[i] === 0) {
      landMask[i] = 1;
    }
  }
  const distToOcean = buildDistanceFromMask(polishedOceanMask, cols, rows);
  const distToLand = buildDistanceFromMask(landMask, cols, rows);
  const reliefAt = (x: number, y: number): number => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let dy = -1; dy <= 1; dy += 1) {
      const ny = y + dy;
      if (ny < 0 || ny >= rows) {
        continue;
      }
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        if (nx < 0 || nx >= cols) {
          continue;
        }
        const value = elevationMap[ny * cols + nx] ?? 0;
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return 0;
    }
    return max - min;
  };

  for (let y = 0; y < rows; y += 1) {
    const rowBase = y * cols;
    for (let x = 0; x < cols; x += 1) {
      const idx = rowBase + x;
      const seaLevel = seaLevelMap[idx] ?? 0;
      const current = elevationMap[idx] ?? 0;
      if (riverMask[idx] > 0) {
        continue;
      }
      if (polishedOceanMask[idx] > 0) {
        if (distToLand[idx] === 1) {
          const deepened = Math.min(current - COAST_OCEAN_SHELF_DEEPEN, seaLevel - 0.002);
          const nextElevation = clamp(deepened, 0, 1);
          elevationMap[idx] = nextElevation;
          state.tiles[idx].elevation = nextElevation;
        }
        continue;
      }
      const dist = distToOcean[idx];
      if (dist !== 1 && dist !== 2) {
        continue;
      }
      const slope = slopeMap[idx] ?? 0;
      const relief = reliefAt(x, y);
      const beachCandidate =
        slope <= COAST_BEACH_MAX_SLOPE &&
        relief <= COAST_BEACH_MAX_RELIEF &&
        current - seaLevel <= COAST_BEACH_SCULPT_MAX_HEIGHT_ABOVE_SEA;
      let nextElevation = current;
      if (beachCandidate) {
        const target = seaLevel + (dist === 1 ? COAST_BEACH_NEAR_TARGET : COAST_BEACH_FAR_TARGET);
        const blend = dist === 1 ? COAST_BEACH_NEAR_BLEND : COAST_BEACH_FAR_BLEND;
        const maxDrop = dist === 1 ? COAST_BEACH_NEAR_MAX_DROP : COAST_BEACH_FAR_MAX_DROP;
        const blended = current * (1 - blend) + target * blend;
        nextElevation = clamp(Math.max(current - maxDrop, blended), 0, 1);
      } else {
        const minTarget = seaLevel + (dist === 1 ? COAST_CLIFF_NEAR_MIN : COAST_CLIFF_FAR_MIN);
        const blend = dist === 1 ? COAST_CLIFF_NEAR_BLEND : COAST_CLIFF_FAR_BLEND;
        const blended = current * (1 - blend) + minTarget * blend;
        nextElevation = clamp(Math.max(current, blended, seaLevel + 0.02), 0, 1);
      }
      elevationMap[idx] = nextElevation;
      state.tiles[idx].elevation = nextElevation;
    }
    if (await ctx.yieldIfNeeded()) {
      await ctx.reportStage("Polishing shoreline...", 0.65 + ((y + 1) / rows) * 0.3);
    }
  }

  polishedOceanMask = expandOceanMaskByLocalSeaLevel(
    elevationMap,
    seaLevelMap,
    polishedOceanMask,
    riverMask,
    cols,
    rows,
    COAST_LOCAL_SEA_MARGIN
  );

  for (let i = 0; i < totalTiles; i += 1) {
    if (riverMask[i] > 0 || polishedOceanMask[i] > 0) {
      continue;
    }
    const sea = seaLevelMap[i] ?? 0;
    if ((elevationMap[i] ?? 0) <= sea + COAST_LOCAL_SEA_MARGIN) {
      const lifted = sea + COAST_MIN_LAND_ABOVE_SEA;
      elevationMap[i] = lifted;
      state.tiles[i].elevation = lifted;
    }
  }

  for (let i = 0; i < totalTiles; i += 1) {
    if (riverMask[i] > 0 || polishedOceanMask[i] > 0) {
      state.tiles[i].type = "water";
    } else {
      state.tiles[i].type = "grass";
    }
  }
  clampRiverMouthDepthsToSeaLevel(state, polishedOceanMask, riverMask, seaLevelMap);
  ctx.oceanMask = polishedOceanMask;
  await ctx.reportStage("Shoreline polished.", 1);
  await emitStageSnapshot(ctx, "terrain:shoreline");
}

export async function runRiverStage(ctx: MapGenContext): Promise<void> {
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
  state.tileRiverMask = riverMask;
  clampRiverMouthDepthsToSeaLevel(state, oceanMask, riverMask, seaLevelMap);
  await ctx.reportStage("Rivers carved.", 1);
  await emitStageSnapshot(ctx, "hydro:rivers");
}

export async function runBiomeFieldsStage(ctx: MapGenContext): Promise<void> {
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

export async function runBiomeSpreadStage(ctx: MapGenContext): Promise<void> {
  if (ctx.settings.biomeClassifierMode === "legacy") {
    ctx.biomeSuitabilityMap = null;
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

export async function runBiomeClassificationStage(ctx: MapGenContext): Promise<void> {
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
              forestCandidate: (forestMask?.[idx] ?? 0) > 0
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
              highlandForestElevation: settings.highlandForestElevation
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
      if (tile.type === "water" && oceanMask[idx] && riverMask[idx] === 0) {
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

export async function runSettlementPlacementStage(ctx: MapGenContext): Promise<void> {
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
    layout: ctx.settings.townLayout,
    townDensity: ctx.settings.townDensity,
    bridgeAllowance: ctx.settings.bridgeAllowance,
    settlementSpacing: ctx.settings.settlementSpacing,
    roadStrictness: ctx.settings.roadStrictness
  });

  await ctx.reportStage("Settlement plan ready.", 1);
  await emitStageSnapshot(ctx, "settlement:place");
}

export async function runRoadNetworkStage(ctx: MapGenContext): Promise<void> {
  connectSettlementsByRoad(ctx.state, ctx.rng, ctx.settlementPlan ?? null);
  flattenSettlementGround(ctx.state);
  const roadSurfaceMetrics = gradeRoadNetworkTerrain(ctx.state, ctx.settings.heightScaleMultiplier);
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
      `[roadsurface] maxGrade=${finalMetrics.maxRoadGrade.toFixed(3)} maxCrossfall=${finalMetrics.maxRoadCrossfall.toFixed(3)} maxGradeChange=${finalMetrics.maxRoadGradeChange.toFixed(3)} wallEdges=${finalMetrics.wallEdgeCount} routedMaxGrade=${stats.maxRealizedGrade.toFixed(3)} routedMaxCrossfall=${stats.maxRealizedCrossfall.toFixed(3)} routedMaxGradeChange=${stats.maxRealizedGradeChange.toFixed(3)}`
    );
  }
  await ctx.reportStage("Connecting roads...", 1);
  await emitStageSnapshot(ctx, "roads:connect");
}

export async function runPostSettlementReconcileStage(ctx: MapGenContext): Promise<void> {
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
            highlandForestElevation: ctx.settings.highlandForestElevation
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
            forestCandidate
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
            highlandForestElevation: ctx.settings.highlandForestElevation
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

export async function runFinalizeStage(ctx: MapGenContext): Promise<void> {
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

