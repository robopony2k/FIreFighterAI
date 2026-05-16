import type { RNG, TileType } from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";
import { TILE_TYPE_IDS, syncTileSoAIndex } from "../../../core/state.js";
import {
  CANOPY_FOREST_THRESHOLD,
  DOMINANT_FOREST_TYPES,
  FOREST_RECRUIT_AGE_YEARS,
  clearVegetationState,
  computeForestTreeWeights,
  getVegetationAgeCapYears,
  getVegetationFuelCapMultiplier,
  isForestType,
  isVegetationType,
  pickWeightedTreeType,
  syncDerivedVegetationState
} from "../../../core/vegetation.js";
import { clamp } from "../../../core/utils.js";
import { applyFuel, getFuelProfiles } from "../../../core/tiles.js";
import { indexFor, inBounds } from "../../../core/grid.js";
import { hash2D } from "../../../mapgen/noise.js";
import { computeTreeSuitability } from "./treeSuitability.js";

export type VegetationBlockResult = {
  terrainTypeChanged: boolean;
  vegetationChanged: boolean;
  visualChanged: boolean;
};

export type VegetationBlockBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

const WATER_INFLUENCE_DIST = 18;
const MAX_WATER_DIST = 30;
const ASH_RECOVERY_RAMP_DAYS = 80;
const ASH_RECOVERY_RATE = 0.045;
const FIREBREAK_RECOVERY_RATE = 0.008;
const BARE_COLONIZE_RATE = 0.026;
const FUEL_GROWTH_RATE = 0.075;
const OPEN_VEGETATION_AGE_RATE = 0.09;
const FOREST_AGE_RATE = 0.12;
const FOREST_RECRUIT_RATE = 0.035;
const LONG_DISTANCE_RECRUIT_FACTOR = 0.38;
const SEED_NORMALIZE = 2.6;
const CANOPY_VISUAL_DIRTY_THRESHOLD = 0.06;
const AGE_VISUAL_DIRTY_THRESHOLD = 0.5;
const MAX_SUITABILITY_SLOPE = 0.5;

const SEED_NEIGHBORS = [
  { x: 1, y: 0, weight: 1 },
  { x: -1, y: 0, weight: 1 },
  { x: 0, y: 1, weight: 1 },
  { x: 0, y: -1, weight: 1 },
  { x: 1, y: 1, weight: 0.7 },
  { x: -1, y: -1, weight: 0.7 },
  { x: 1, y: -1, weight: 0.7 },
  { x: -1, y: 1, weight: 0.7 }
];

let canopySnapshot: Float32Array | null = null;
let forestSnapshot: Uint8Array | null = null;
let snapshotSize = 0;

export const ensureVegetationSeedSnapshots = (state: WorldState): { canopy: Float32Array; forest: Uint8Array } => {
  const total = state.grid.totalTiles;
  if (!canopySnapshot || !forestSnapshot || snapshotSize !== total) {
    canopySnapshot = new Float32Array(total);
    forestSnapshot = new Uint8Array(total);
    snapshotSize = total;
  }
  return {
    canopy: canopySnapshot,
    forest: forestSnapshot
  };
};

const isProtectedSuccessionType = (type: TileType): boolean =>
  type === "water" || type === "beach" || type === "rocky" || type === "road" || type === "base" || type === "house";

const updateSeedSnapshotsInBounds = (
  state: WorldState,
  canopy: Float32Array,
  forest: Uint8Array,
  bounds: VegetationBlockBounds
): void => {
  const cols = state.grid.cols;
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    let idx = y * cols + bounds.minX;
    for (let x = bounds.minX; x <= bounds.maxX; x += 1, idx += 1) {
      const tile = state.tiles[idx];
      canopy[idx] = tile && isVegetationType(tile.type) ? tile.canopy : 0;
      forest[idx] = tile?.type === "forest" ? 1 : 0;
    }
  }
};

const getSeedPressure = (
  state: WorldState,
  x: number,
  y: number,
  canopyValues: Float32Array,
  forestValues: Uint8Array
): number => {
  let seedSum = 0;
  for (const neighbor of SEED_NEIGHBORS) {
    const nx = x + neighbor.x;
    const ny = y + neighbor.y;
    if (!inBounds(state.grid, nx, ny)) {
      continue;
    }
    const nIdx = indexFor(state.grid, nx, ny);
    const canopy = canopyValues[nIdx];
    if (canopy <= 0) {
      continue;
    }
    const forestBoost = forestValues[nIdx] ? 1.15 : 0.45;
    seedSum += neighbor.weight * canopy * forestBoost;
  }
  return clamp(seedSum / SEED_NORMALIZE, 0, 1);
};

const getWaterFactor = (waterDist: number): number => {
  const capped = Math.min(waterDist, MAX_WATER_DIST);
  return clamp(1 - capped / WATER_INFLUENCE_DIST, 0, 1);
};

const getElevationFactor = (elevation: number): number => clamp(0.35 + (1 - elevation) * 0.65, 0.35, 1);

const eventProbability = (ratePerDay: number, elapsedDays: number): number =>
  clamp(1 - Math.exp(-Math.max(0, ratePerDay) * Math.max(0, elapsedDays)), 0, 1);

const sampleGrowthEvent = (state: WorldState, x: number, y: number, elapsedDays: number, salt: number): number => {
  const visualClock = Number.isFinite(state.growthVisualDayAccumulator) ? state.growthVisualDayAccumulator : 0;
  const seasonBucket = Math.floor(Math.max(0, Math.max(state.careerDay, visualClock) - elapsedDays * 0.5) / 30);
  return hash2D(x + seasonBucket * 17, y + salt * 31, state.seed + salt * 9973);
};

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

const computeRuntimeTreeSuitability = (state: WorldState, x: number, y: number): number => {
  const idx = indexFor(state.grid, x, y);
  const tile = state.tiles[idx];
  const seaLevel = state.tileSeaLevel?.[idx] ?? 0.08;
  const details = computeTreeSuitability({
    seed: state.seed,
    x,
    y,
    worldX: x * 10,
    worldY: y * 10,
    cellSizeM: 10,
    elevation: tile?.elevation ?? 0,
    slope: computeLocalSlope(state, x, y),
    moisture: tile?.moisture ?? 0,
    valley: state.valleyMap?.[idx] ?? 0,
    seaLevel,
    waterDist: tile?.waterDist ?? 24,
    highlandForestElevation: 0.72,
    vegetationDensity: 0.62,
    forestPatchiness: 0.48,
    isWater: tile?.type === "water"
  });
  return details.treeSuitability;
};

const pickOpenColonizedType = (
  moisture: number,
  elevation: number,
  suitability: number
): TileType => {
  if (moisture >= 0.72 && elevation < 0.52) {
    return "floodplain";
  }
  if (suitability >= 0.72 && moisture >= 0.42) {
    return "grass";
  }
  return moisture < 0.32 ? "scrub" : "grass";
};

const getForestSeedType = (state: WorldState, x: number, y: number): WorldState["tiles"][number]["treeType"] => {
  let bestType: WorldState["tiles"][number]["treeType"] = null;
  let bestWeight = 0;
  for (const neighbor of SEED_NEIGHBORS) {
    const nx = x + neighbor.x;
    const ny = y + neighbor.y;
    if (!inBounds(state.grid, nx, ny)) {
      continue;
    }
    const nIdx = indexFor(state.grid, nx, ny);
    const neighborTile = state.tiles[nIdx];
    if (neighborTile.type !== "forest") {
      continue;
    }
    const candidate = neighborTile.treeType ?? neighborTile.dominantTreeType;
    if (!candidate) {
      continue;
    }
    const weight = neighbor.weight * (0.6 + neighborTile.canopyCover * 0.6);
    if (weight > bestWeight) {
      bestWeight = weight;
      bestType = candidate;
    }
  }
  return bestType;
};

const setForestIdentity = (state: WorldState, x: number, y: number): void => {
  const tile = state.tiles[indexFor(state.grid, x, y)];
  const neighborForestType = getForestSeedType(state, x, y);
  if (neighborForestType) {
    tile.dominantTreeType = neighborForestType;
    tile.treeType = neighborForestType;
    return;
  }
  const weights = computeForestTreeWeights(tile.moisture, tile.elevation, x, y, state.seed + 9001);
  const dominant = pickWeightedTreeType(hash2D(x, y, state.seed + 9011), DOMINANT_FOREST_TYPES, weights);
  tile.dominantTreeType = dominant;
  tile.treeType = dominant;
};

const syncVegetationTileState = (state: WorldState, idx: number, typeChanged: boolean): void => {
  if (typeChanged) {
    syncTileSoAIndex(state, idx);
    return;
  }
  const tile = state.tiles[idx];
  state.tileVegetationAge[idx] = tile.vegetationAgeYears;
  state.tileCanopyCover[idx] = tile.canopyCover;
  state.tileStemDensity[idx] = tile.stemDensity;
  state.tileFuel[idx] = tile.fuel;
  state.tileTypeId[idx] = TILE_TYPE_IDS[tile.type];
};

export const processVegetationSuccessionBlock = (
  state: WorldState,
  bounds: VegetationBlockBounds,
  elapsedDays: number,
  rng: RNG
): VegetationBlockResult => {
  const snapshots = ensureVegetationSeedSnapshots(state);
  updateSeedSnapshotsInBounds(state, snapshots.canopy, snapshots.forest, bounds);

  const fuelProfiles = getFuelProfiles();
  const result: VegetationBlockResult = {
    terrainTypeChanged: false,
    vegetationChanged: false,
    visualChanged: false
  };

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const idx = indexFor(state.grid, x, y);
      const tile = state.tiles[idx];
      if (!tile || tile.fire > 0 || isProtectedSuccessionType(tile.type)) {
        continue;
      }

      const prevType = tile.type;
      const prevCanopy = tile.canopy;
      const prevAge = tile.vegetationAgeYears;
      const prevStemDensity = tile.stemDensity;
      let typeChanged = false;
      let tileStateChanged = false;

      const waterFactor = getWaterFactor(tile.waterDist);
      const elevFactor = getElevationFactor(tile.elevation);
      const suitability = computeRuntimeTreeSuitability(state, x, y);
      const env = (0.35 + 0.65 * tile.moisture) * (0.6 + 0.8 * waterFactor) * (0.4 + 0.6 * elevFactor);
      const successionEnv = clamp(env * (0.42 + suitability * 0.9), 0, 1.4);

      if (tile.type === "ash") {
        clearVegetationState(tile);
        if (tile.houseDestroyed) {
          syncVegetationTileState(state, idx, false);
          snapshots.canopy[idx] = 0;
          snapshots.forest[idx] = 0;
          continue;
        }
        tile.ashAge += elapsedDays;
        const ageFactor = clamp(tile.ashAge / ASH_RECOVERY_RAMP_DAYS, 0, 1);
        const recoverChance = eventProbability(ASH_RECOVERY_RATE * successionEnv * (0.25 + 0.75 * ageFactor), elapsedDays);
        if (sampleGrowthEvent(state, x, y, elapsedDays, 101) < recoverChance) {
          tile.type = "grass";
          tile.vegetationAgeYears = 0.25;
          tile.ashAge = 0;
          tile.dominantTreeType = null;
          tile.treeType = null;
          syncDerivedVegetationState(tile, state.seed, x, y);
          applyFuel(tile, tile.moisture, rng);
          state.burnedTiles = Math.max(0, state.burnedTiles - 1);
          typeChanged = true;
          tileStateChanged = true;
        }
      } else if (tile.type === "firebreak") {
        clearVegetationState(tile);
        const recoverChance = eventProbability(FIREBREAK_RECOVERY_RATE * successionEnv, elapsedDays);
        if (!tile.houseDestroyed && sampleGrowthEvent(state, x, y, elapsedDays, 211) < recoverChance) {
          tile.type = "grass";
          tile.vegetationAgeYears = 0.2;
          tile.dominantTreeType = null;
          tile.treeType = null;
          syncDerivedVegetationState(tile, state.seed, x, y);
          applyFuel(tile, tile.moisture, rng);
          typeChanged = true;
          tileStateChanged = true;
        }
      } else if (tile.type === "bare") {
        clearVegetationState(tile);
        const colonizeChance = eventProbability(BARE_COLONIZE_RATE * successionEnv * suitability, elapsedDays);
        if (suitability >= 0.32 && sampleGrowthEvent(state, x, y, elapsedDays, 307) < colonizeChance) {
          tile.type = pickOpenColonizedType(tile.moisture, tile.elevation, suitability);
          tile.vegetationAgeYears = 0.15;
          tile.dominantTreeType = null;
          tile.treeType = null;
          syncDerivedVegetationState(tile, state.seed, x, y);
          applyFuel(tile, tile.moisture, rng);
          typeChanged = true;
          tileStateChanged = true;
        }
      } else if (tile.type === "grass" || tile.type === "scrub" || tile.type === "floodplain" || tile.type === "forest") {
        const seedPressure = getSeedPressure(state, x, y, snapshots.canopy, snapshots.forest);
        const profile = fuelProfiles[tile.type];
        const ageCap = getVegetationAgeCapYears(tile.type);
        const maturity01 = ageCap > 0 ? clamp(tile.vegetationAgeYears / ageCap, 0, 1) : 0;
        const ageRate = tile.type === "forest" ? FOREST_AGE_RATE : OPEN_VEGETATION_AGE_RATE;
        const seedBoost = tile.type === "forest" ? 0.7 + seedPressure * 1.0 : 0.85 + seedPressure * 0.65 + suitability * 0.28;
        const maturityDrag = 0.35 + 0.65 * (1 - maturity01);
        tile.vegetationAgeYears += elapsedDays * ageRate * successionEnv * seedBoost * maturityDrag;
        syncDerivedVegetationState(tile, state.seed, x, y);
        const maxFuel = profile.baseFuel * getVegetationFuelCapMultiplier(tile.type, tile.vegetationAgeYears);
        const fuelGrowth = elapsedDays * FUEL_GROWTH_RATE * (0.4 + 0.6 * successionEnv);
        tile.fuel = clamp(tile.fuel + fuelGrowth, 0, maxFuel);

        if (!isForestType(tile.type) && tile.canopy >= CANOPY_FOREST_THRESHOLD && suitability >= 0.28) {
          const recruitPressure = Math.max(seedPressure, suitability * LONG_DISTANCE_RECRUIT_FACTOR);
          const recruitChance = eventProbability(FOREST_RECRUIT_RATE * successionEnv * (0.25 + recruitPressure), elapsedDays);
          if (sampleGrowthEvent(state, x, y, elapsedDays, 419) < recruitChance) {
            tile.type = "forest";
            tile.vegetationAgeYears = FOREST_RECRUIT_AGE_YEARS;
            setForestIdentity(state, x, y);
            syncDerivedVegetationState(tile, state.seed, x, y);
            applyFuel(tile, tile.moisture, rng);
            typeChanged = true;
            tileStateChanged = true;
          }
        } else if (!isForestType(tile.type)) {
          tile.dominantTreeType = null;
          tile.treeType = null;
        }
      }

      const canopyDelta = Math.abs(tile.canopy - prevCanopy);
      const ageDelta = Math.abs(tile.vegetationAgeYears - prevAge);
      const stemDelta = Math.abs(tile.stemDensity - prevStemDensity);
      const changed =
        typeChanged ||
        tileStateChanged ||
        canopyDelta >= 0.01 ||
        ageDelta >= 0.05 ||
        stemDelta > 0 ||
        tile.type !== prevType;
      if (changed) {
        result.vegetationChanged = true;
        syncVegetationTileState(state, idx, typeChanged || tile.type !== prevType);
      }
      if (typeChanged || tile.type !== prevType) {
        result.terrainTypeChanged = true;
      }
      if (
        typeChanged ||
        tile.type !== prevType ||
        canopyDelta >= CANOPY_VISUAL_DIRTY_THRESHOLD ||
        ageDelta >= AGE_VISUAL_DIRTY_THRESHOLD ||
        stemDelta >= 2
      ) {
        result.visualChanged = true;
      }
      snapshots.canopy[idx] = isVegetationType(tile.type) ? tile.canopy : 0;
      snapshots.forest[idx] = isForestType(tile.type) ? 1 : 0;
    }
  }

  return result;
};
