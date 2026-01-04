import type { RNG } from "../core/types.js";
import type { WorldState } from "../core/state.js";
import { DEBUG_GROWTH_METRICS, FUEL_PROFILES } from "../core/config.js";
import { clamp } from "../core/utils.js";
import { applyFuel } from "../core/tiles.js";
import { indexFor } from "../core/grid.js";

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
  const canopy = canopySnapshot;
  const forest = forestSnapshot;
  for (let i = 0; i < total; i += 1) {
    const tile = state.tiles[i];
    const vegetation = tile.type === "grass" || tile.type === "forest";
    canopy[i] = vegetation ? tile.canopy : 0;
    forest[i] = tile.type === "forest" ? 1 : 0;
  }
  return {
    canopy,
    forest
  };
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
    if (tile.type === "grass") {
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
  if (dayDelta <= 0) {
    return;
  }

  if (DEBUG_GROWTH_METRICS && state.year !== lastLoggedYear) {
    logGrowthMetrics(state);
    lastLoggedYear = state.year;
  }

  const { canopy: canopyValues, forest: forestValues } = ensureSeedSnapshots(state);
  let terrainDirty = false;

  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = indexFor(state.grid, x, y);
      const tile = state.tiles[idx];

      if (tile.fire > 0) {
        continue;
      }
      if (tile.type === "water" || tile.type === "road" || tile.type === "base" || tile.type === "house") {
        continue;
      }

      const prevType = tile.type;
      const prevCanopy = tile.canopy;

      const waterFactor = getWaterFactor(tile.waterDist);
      const elevFactor = getElevationFactor(tile.elevation);
      const env =
        (0.35 + 0.65 * tile.moisture) * (0.6 + 0.8 * waterFactor) * (0.4 + 0.6 * elevFactor);

      if (tile.type === "ash") {
        tile.canopy = 0;
        if (tile.houseDestroyed) {
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
        }
        if (tile.type !== prevType || Math.abs(tile.canopy - prevCanopy) >= CANOPY_DIRTY_THRESHOLD) {
          terrainDirty = true;
        }
        continue;
      }

      if (tile.type === "firebreak") {
        if (!tile.houseDestroyed && rng.next() < dayDelta * FIREBREAK_RECOVERY_RATE * env) {
          tile.type = "grass";
          tile.canopy = clamp(0.1 + tile.moisture * 0.2 + waterFactor * 0.1, 0.1, 0.35);
          applyFuel(tile, tile.moisture, rng);
        }
        if (tile.type !== prevType || Math.abs(tile.canopy - prevCanopy) >= CANOPY_DIRTY_THRESHOLD) {
          terrainDirty = true;
        }
        continue;
      }

      if (tile.type === "grass" || tile.type === "forest") {
        const seedPressure = getSeedPressure(state, x, y, canopyValues, forestValues);
        const profile = FUEL_PROFILES[tile.type];
        const maxFuel = profile.baseFuel * (1.1 + waterFactor * 0.2);
        const fuelGrowth = dayDelta * FUEL_GROWTH_RATE * (0.4 + 0.6 * env);
        tile.fuel = clamp(tile.fuel + fuelGrowth, 0, maxFuel);

        const canopyRate = tile.type === "forest" ? CANOPY_GROWTH_RATE_FOREST : CANOPY_GROWTH_RATE_GRASS;
        const seedBoost = 0.5 + seedPressure * 0.9;
        tile.canopy = clamp(tile.canopy + dayDelta * canopyRate * env * seedBoost, 0, 1);

        if (tile.type === "grass" && tile.canopy >= CANOPY_FOREST_THRESHOLD) {
          const recruitChance = dayDelta * FOREST_RECRUIT_RATE * env * (LONG_DISTANCE_RECRUIT_FACTOR + seedPressure);
          if (rng.next() < recruitChance) {
            tile.type = "forest";
            tile.canopy = Math.max(tile.canopy, CANOPY_FOREST_THRESHOLD + 0.02);
            applyFuel(tile, tile.moisture, rng);
          }
        }
        if (tile.type !== prevType || Math.abs(tile.canopy - prevCanopy) >= CANOPY_DIRTY_THRESHOLD) {
          terrainDirty = true;
        }
      }
    }
  }

  if (terrainDirty) {
    state.terrainDirty = true;
  }
}

