import type { RNG } from "../core/types.js";
import type { WorldState } from "../core/state.js";
import { DEBUG_GROWTH_METRICS } from "../core/config.js";
import { clamp } from "../core/utils.js";
import { applyFuel, getFuelProfiles } from "../core/tiles.js";
import { syncTileSoAIndex } from "../core/tileCache.js";
import { indexFor } from "../core/grid.js";
import { hash2D } from "../mapgen/noise.js";
import { profEnd, profStart } from "./prof.js";

const WATER_INFLUENCE_DIST = 18;
const MAX_WATER_DIST = 30;
const ASH_RECOVERY_RAMP_DAYS = 80;
const ASH_RECOVERY_RATE = 0.045;
const FIREBREAK_RECOVERY_RATE = 0.008;
const FUEL_GROWTH_RATE = 0.04;
const CANOPY_GROWTH_RATE_GRASS = 0.008;
const CANOPY_GROWTH_RATE_FOREST = 0.009;
const FOREST_RECRUIT_RATE = 0.03;
const CANOPY_FOREST_THRESHOLD = 0.35;
const LONG_DISTANCE_RECRUIT_FACTOR = 0.25;
const SEED_NORMALIZE = 3.4;
const CANOPY_DIRTY_THRESHOLD = 0.02;

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
let lastLoggedYear = 0;

function ensureSeedSnapshots(state: WorldState): { canopy: Float32Array; forest: Uint8Array } {
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
}

function updateSeedSnapshotsInBounds(
  state: WorldState,
  canopy: Float32Array,
  forest: Uint8Array,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): void {
  const cols = state.grid.cols;
  for (let y = minY; y <= maxY; y += 1) {
    let idx = y * cols + minX;
    for (let x = minX; x <= maxX; x += 1, idx += 1) {
      const tile = state.tiles[idx];
      const vegetation =
        tile.type === "grass" || tile.type === "scrub" || tile.type === "floodplain" || tile.type === "forest";
      canopy[idx] = vegetation ? tile.canopy : 0;
      forest[idx] = tile.type === "forest" ? 1 : 0;
    }
  }
}

function getSeedPressure(state: WorldState, x: number, y: number, canopyValues: Float32Array, forestValues: Uint8Array): number {
  let seedSum = 0;
  for (const neighbor of SEED_NEIGHBORS) {
    const nx = x + neighbor.x;
    const ny = y + neighbor.y;
    if (nx < 0 || ny < 0 || nx >= state.grid.cols || ny >= state.grid.rows) {
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
}

function getWaterFactor(waterDist: number): number {
  const capped = Math.min(waterDist, MAX_WATER_DIST);
  return clamp(1 - capped / WATER_INFLUENCE_DIST, 0, 1);
}

function getElevationFactor(elevation: number): number {
  return clamp(0.35 + (1 - elevation) * 0.65, 0.35, 1);
}

const computeStemDensity = (
  state: WorldState,
  type: WorldState["tiles"][number]["type"],
  canopyCover: number,
  x: number,
  y: number
): number => {
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

const syncCanopyMetrics = (
  state: WorldState,
  tile: WorldState["tiles"][number],
  x: number,
  y: number
): void => {
  tile.canopyCover = tile.canopy;
  tile.stemDensity = computeStemDensity(state, tile.type, tile.canopyCover, x, y);
};

const isVegetationType = (type: WorldState["tiles"][number]["type"]): boolean =>
  type === "grass" || type === "scrub" || type === "floodplain" || type === "forest";

const isForestType = (type: WorldState["tiles"][number]["type"]): boolean => type === "forest";

function logGrowthMetrics(state: WorldState): void {
  let ashCount = 0;
  let grassCount = 0;
  let forestCount = 0;
  const bandCounts = [0, 0, 0, 0, 0];
  const bandCanopy = [0, 0, 0, 0, 0];

  for (const tile of state.tiles) {
    if (tile.type === "ash") {
      ashCount += 1;
    }
    if (tile.type === "grass" || tile.type === "scrub" || tile.type === "floodplain") {
      grassCount += 1;
    }
    if (tile.type === "forest" || tile.canopy >= CANOPY_FOREST_THRESHOLD) {
      forestCount += 1;
    }
    if (tile.type !== "water") {
      const band = Math.min(Math.floor(tile.waterDist / 5), 4);
      bandCounts[band] += 1;
      bandCanopy[band] += tile.canopy;
    }
  }

  const bandAverages = bandCounts.map((count, index) => (count > 0 ? (bandCanopy[index] / count).toFixed(2) : "0.00"));
  console.log(
    `Year ${state.year} growth: ash ${ashCount} grass ${grassCount} forest ${forestCount} canopyByWaterDist [0-4:${bandAverages[0]} 5-9:${bandAverages[1]} 10-14:${bandAverages[2]} 15-19:${bandAverages[3]} 20+:${bandAverages[4]}]`
  );
}

export function stepGrowth(state: WorldState, dayDelta: number, rng: RNG): void {
  const profStartAt = profStart();
  if (dayDelta <= 0) {
    profEnd("growth", profStartAt);
    return;
  }

  const fuelProfiles = getFuelProfiles();

  if (DEBUG_GROWTH_METRICS && state.year !== lastLoggedYear) {
    logGrowthMetrics(state);
    lastLoggedYear = state.year;
  }

  const { canopy: canopyValues, forest: forestValues } = ensureSeedSnapshots(state);
  let terrainDirty = false;
  const blockCount = Math.max(1, state.fireBlockCount);
  const blocksPerTick = Math.max(1, Math.floor(state.simPerf.growthBlocksPerTick || 1));
  const blockSize = Math.max(4, state.fireBlockSize || 16);
  let processed = 0;
  let cursor = state.growthBlockCursor % blockCount;
  for (; processed < blocksPerTick; processed += 1) {
    const blockIndex = cursor;
    cursor = (cursor + 1) % blockCount;
    const blockX = blockIndex % state.fireBlockCols;
    const blockY = Math.floor(blockIndex / state.fireBlockCols);
    const minX = blockX * blockSize;
    const minY = blockY * blockSize;
    const maxX = Math.min(state.grid.cols - 1, minX + blockSize - 1);
    const maxY = Math.min(state.grid.rows - 1, minY + blockSize - 1);
    updateSeedSnapshotsInBounds(state, canopyValues, forestValues, minX, maxX, minY, maxY);
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const idx = indexFor(state.grid, x, y);
        const tile = state.tiles[idx];

        if (tile.fire > 0) {
          continue;
        }
        if (
          tile.type === "water" ||
          tile.type === "beach" ||
          tile.type === "rocky" ||
          tile.type === "bare" ||
          tile.type === "road" ||
          tile.type === "base" ||
          tile.type === "house"
        ) {
          continue;
        }

        const prevType = tile.type;
        const prevCanopy = tile.canopy;
        let soaChanged = false;

        const waterFactor = getWaterFactor(tile.waterDist);
        const elevFactor = getElevationFactor(tile.elevation);
        const env =
          (0.35 + 0.65 * tile.moisture) * (0.6 + 0.8 * waterFactor) * (0.4 + 0.6 * elevFactor);

        if (tile.type === "ash") {
          tile.canopy = 0;
        if (tile.houseDestroyed) {
          syncCanopyMetrics(state, tile, x, y);
          if (tile.type !== prevType || Math.abs(tile.canopy - prevCanopy) >= CANOPY_DIRTY_THRESHOLD) {
            terrainDirty = true;
          }
          canopyValues[idx] = 0;
          forestValues[idx] = 0;
          continue;
        }
          tile.ashAge += dayDelta;
          const ageFactor = clamp(tile.ashAge / ASH_RECOVERY_RAMP_DAYS, 0, 1);
          const recoverChance = dayDelta * ASH_RECOVERY_RATE * env * (0.25 + 0.75 * ageFactor);
          if (rng.next() < recoverChance) {
            tile.type = "grass";
            tile.canopy = clamp(0.05 + tile.moisture * 0.2 + waterFactor * 0.15, 0.05, 0.35);
            tile.ashAge = 0;
            applyFuel(tile, tile.moisture, rng);
            state.burnedTiles = Math.max(0, state.burnedTiles - 1);
            soaChanged = true;
          }
          syncCanopyMetrics(state, tile, x, y);
          if (tile.type !== prevType || Math.abs(tile.canopy - prevCanopy) >= CANOPY_DIRTY_THRESHOLD) {
            terrainDirty = true;
          }
          if (tile.type !== prevType) {
            state.terrainTypeRevision += 1;
          }
          if (soaChanged || tile.type !== prevType) {
            syncTileSoAIndex(state, idx);
          }
          canopyValues[idx] = isVegetationType(tile.type) ? tile.canopy : 0;
          forestValues[idx] = isForestType(tile.type) ? 1 : 0;
          continue;
        }

        if (tile.type === "firebreak") {
          if (!tile.houseDestroyed && rng.next() < dayDelta * FIREBREAK_RECOVERY_RATE * env) {
            tile.type = "grass";
            tile.canopy = clamp(0.1 + tile.moisture * 0.2 + waterFactor * 0.1, 0.1, 0.35);
            applyFuel(tile, tile.moisture, rng);
            soaChanged = true;
          }
          syncCanopyMetrics(state, tile, x, y);
          if (tile.type !== prevType || Math.abs(tile.canopy - prevCanopy) >= CANOPY_DIRTY_THRESHOLD) {
            terrainDirty = true;
          }
          if (tile.type !== prevType) {
            state.terrainTypeRevision += 1;
          }
          if (soaChanged || tile.type !== prevType) {
            syncTileSoAIndex(state, idx);
          }
          canopyValues[idx] = isVegetationType(tile.type) ? tile.canopy : 0;
          forestValues[idx] = isForestType(tile.type) ? 1 : 0;
          continue;
        }

        if (tile.type === "grass" || tile.type === "scrub" || tile.type === "floodplain" || tile.type === "forest") {
          const seedPressure = getSeedPressure(state, x, y, canopyValues, forestValues);
          const profile = fuelProfiles[tile.type];
          const maxFuel = profile.baseFuel * (1.1 + waterFactor * 0.2);
          const fuelGrowth = dayDelta * FUEL_GROWTH_RATE * (0.4 + 0.6 * env);
          tile.fuel = clamp(tile.fuel + fuelGrowth, 0, maxFuel);
          state.tileFuel[idx] = tile.fuel;

          const canopyRate = tile.type === "forest" ? CANOPY_GROWTH_RATE_FOREST : CANOPY_GROWTH_RATE_GRASS;
          const seedBoost = 0.5 + seedPressure * 0.9;
          tile.canopy = clamp(tile.canopy + dayDelta * canopyRate * env * seedBoost, 0, 1);

          if (
            (tile.type === "grass" || tile.type === "scrub" || tile.type === "floodplain") &&
            tile.canopy >= CANOPY_FOREST_THRESHOLD
          ) {
            const recruitChance = dayDelta * FOREST_RECRUIT_RATE * env * (LONG_DISTANCE_RECRUIT_FACTOR + seedPressure);
            if (rng.next() < recruitChance) {
              tile.type = "forest";
              tile.canopy = Math.max(tile.canopy, CANOPY_FOREST_THRESHOLD + 0.02);
              applyFuel(tile, tile.moisture, rng);
              soaChanged = true;
            }
          }
          syncCanopyMetrics(state, tile, x, y);
          if (tile.type !== prevType || Math.abs(tile.canopy - prevCanopy) >= CANOPY_DIRTY_THRESHOLD) {
            terrainDirty = true;
          }
          if (tile.type !== prevType) {
            state.terrainTypeRevision += 1;
          }
          if (soaChanged || tile.type !== prevType) {
            syncTileSoAIndex(state, idx);
          }
          canopyValues[idx] = isVegetationType(tile.type) ? tile.canopy : 0;
          forestValues[idx] = isForestType(tile.type) ? 1 : 0;
        }
      }
    }
  }
  state.growthBlockCursor = cursor;

  if (terrainDirty) {
    state.terrainDirty = true;
  }
  profEnd("growth", profStartAt);
}

