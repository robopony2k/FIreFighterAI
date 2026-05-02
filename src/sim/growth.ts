import type { RNG } from "../core/types.js";
import type { WorldState } from "../core/state.js";
import { DEBUG_GROWTH_METRICS } from "../core/config.js";
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
} from "../core/vegetation.js";
import { clamp } from "../core/utils.js";
import { applyFuel, getFuelProfiles } from "../core/tiles.js";
import { syncTileSoAIndex } from "../core/tileCache.js";
import { indexFor } from "../core/grid.js";
import { RNG as RuntimeRng } from "../core/rng.js";
import {
  placeHouse,
  removeHouse,
  recountTownHouses,
  validateTownInvariants,
  STRUCTURE_HOUSE,
  STRUCTURE_NONE
} from "../core/towns.js";
import { hash2D } from "../mapgen/noise.js";
import {
  backfillRoadEdgesFromAdjacency,
  carveRoad,
  clearRoadEdges,
  collectRoadTiles,
  findNearestRoadTile,
  pruneRoadDiagonalStubs
} from "../mapgen/roads.js";
import { stepRuntimeTownGrowth } from "../systems/settlements/sim/townGrowth.js";
import type { SettlementRoadAdapter } from "../systems/settlements/types/settlementTypes.js";
import { profEnd, profStart } from "./prof.js";

const WATER_INFLUENCE_DIST = 18;
const MAX_WATER_DIST = 30;
const ASH_RECOVERY_RAMP_DAYS = 80;
const ASH_RECOVERY_RATE = 0.045;
const FIREBREAK_RECOVERY_RATE = 0.008;
const FUEL_GROWTH_RATE = 0.04;
const OPEN_VEGETATION_AGE_RATE = 0.025;
const FOREST_AGE_RATE = 0.075;
const FOREST_RECRUIT_RATE = 0.03;
const LONG_DISTANCE_RECRUIT_FACTOR = 0.25;
const SEED_NORMALIZE = 3.4;
const CANOPY_DIRTY_THRESHOLD = 0.02;
const TOWN_RADIUS_MIN = 4;
const TOWN_CAP_DENSITY = 0.55;
const TOWN_SEASON_DELTA_MAX = 3;
const TOWN_STEEP_ELEVATION_DIFF = 0.12;
const TOWN_ROAD_PROXIMITY = 2;

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

const getForestSeedType = (state: WorldState, x: number, y: number) => {
  let bestType: WorldState["tiles"][number]["treeType"] = null;
  let bestWeight = 0;
  for (const neighbor of SEED_NEIGHBORS) {
    const nx = x + neighbor.x;
    const ny = y + neighbor.y;
    if (nx < 0 || ny < 0 || nx >= state.grid.cols || ny >= state.grid.rows) {
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

const getTownCenterX = (town: WorldState["towns"][number]): number => {
  return Number.isFinite(town.cx) ? town.cx : town.x;
};

const getTownCenterY = (town: WorldState["towns"][number]): number => {
  return Number.isFinite(town.cy) ? town.cy : town.y;
};

const isTownBuildableType = (type: WorldState["tiles"][number]["type"]): boolean =>
  type === "grass" || type === "scrub" || type === "floodplain" || type === "forest" || type === "bare";

const hasRoadNetwork = (state: WorldState): boolean => {
  for (let i = 0; i < state.tiles.length; i += 1) {
    if (state.tiles[i].type === "road") {
      return true;
    }
  }
  return false;
};

const hasNearbyRoad = (state: WorldState, x: number, y: number, radius: number): boolean => {
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const manhattan = Math.abs(dx) + Math.abs(dy);
      if (manhattan > radius) {
        continue;
      }
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= state.grid.cols || ny >= state.grid.rows) {
        continue;
      }
      const neighborType = state.tiles[indexFor(state.grid, nx, ny)].type;
      if (neighborType === "road" || neighborType === "base") {
        return true;
      }
    }
  }
  return false;
};

const isSteepCandidate = (state: WorldState, x: number, y: number): boolean => {
  const idx = indexFor(state.grid, x, y);
  const baseElevation = state.tiles[idx].elevation;
  const neighbors = [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 }
  ];
  let maxDiff = 0;
  for (const neighbor of neighbors) {
    if (neighbor.x < 0 || neighbor.y < 0 || neighbor.x >= state.grid.cols || neighbor.y >= state.grid.rows) {
      continue;
    }
    const nIdx = indexFor(state.grid, neighbor.x, neighbor.y);
    maxDiff = Math.max(maxDiff, Math.abs(baseElevation - state.tiles[nIdx].elevation));
    if (maxDiff > TOWN_STEEP_ELEVATION_DIFF) {
      return true;
    }
  }
  return false;
};

const collectGrowthCandidates = (
  state: WorldState,
  town: WorldState["towns"][number],
  roadPreferred: boolean
): number[] => {
  const cx = getTownCenterX(town);
  const cy = getTownCenterY(town);
  const radius = Math.max(TOWN_RADIUS_MIN, town.radius);
  const radiusSq = radius * radius;
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(state.grid.cols - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(state.grid.rows - 1, Math.ceil(cy + radius));
  const candidates: number[] = [];
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const distSq = dx * dx + dy * dy;
      if (distSq > radiusSq) {
        continue;
      }
      const idx = indexFor(state.grid, x, y);
      if (state.tileStructure[idx] !== STRUCTURE_NONE || state.structureMask[idx] !== 0) {
        continue;
      }
      const tile = state.tiles[idx];
      if (!isTownBuildableType(tile.type)) {
        continue;
      }
      if (tile.type === "water" || tile.type === "road" || tile.type === "base" || tile.type === "house") {
        continue;
      }
      if (isSteepCandidate(state, x, y)) {
        continue;
      }
      if (roadPreferred && !hasNearbyRoad(state, x, y, TOWN_ROAD_PROXIMITY)) {
        continue;
      }
      candidates.push(idx);
    }
  }

  candidates.sort((a, b) => {
    const ax = a % state.grid.cols;
    const ay = Math.floor(a / state.grid.cols);
    const bx = b % state.grid.cols;
    const by = Math.floor(b / state.grid.cols);
    const adx = ax - cx;
    const ady = ay - cy;
    const bdx = bx - cx;
    const bdy = by - cy;
    const aDist = adx * adx + ady * ady;
    const bDist = bdx * bdx + bdy * bdy;
    if (aDist !== bDist) {
      return aDist - bDist;
    }
    return a - b;
  });
  return candidates;
};

const collectShrinkCandidates = (state: WorldState, town: WorldState["towns"][number]): number[] => {
  const cx = getTownCenterX(town);
  const cy = getTownCenterY(town);
  const candidates: number[] = [];
  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    if (state.tileStructure[idx] !== STRUCTURE_HOUSE || state.tileTownId[idx] !== town.id) {
      continue;
    }
    const tile = state.tiles[idx];
    if (!tile || tile.type !== "house" || tile.houseDestroyed) {
      continue;
    }
    candidates.push(idx);
  }
  candidates.sort((a, b) => {
    const ax = a % state.grid.cols;
    const ay = Math.floor(a / state.grid.cols);
    const bx = b % state.grid.cols;
    const by = Math.floor(b / state.grid.cols);
    const adx = ax - cx;
    const ady = ay - cy;
    const bdx = bx - cx;
    const bdy = by - cy;
    const aDist = adx * adx + ady * ady;
    const bDist = bdx * bdx + bdy * bdy;
    if (aDist !== bDist) {
      return bDist - aDist;
    }
    return a - b;
  });
  return candidates;
};

const computeTownCap = (town: WorldState["towns"][number]): number => {
  const radius = Math.max(TOWN_RADIUS_MIN, town.radius);
  return Math.max(1, Math.floor(radius * radius * TOWN_CAP_DENSITY));
};

const computeDesiredSeasonDelta = (state: WorldState, town: WorldState["towns"][number]): number => {
  const cap = computeTownCap(town);
  const occupancy = town.houseCount / Math.max(1, cap);
  let delta = 0;
  if (occupancy < 0.55) {
    delta += 1;
  }
  if (occupancy < 0.35) {
    delta += 1;
  }
  if (occupancy > 0.95) {
    delta -= 1;
  }
  if (occupancy > 1.2) {
    delta -= 1;
  }

  const jitter = hash2D(state.seed + town.id * 13 + state.year * 17, town.id * 101 + state.year, 9083);
  if (jitter > 0.82) {
    delta += 1;
  } else if (jitter < 0.18) {
    delta -= 1;
  }

  if (town.houseCount === 0) {
    delta = Math.max(delta, 1);
  }
  return Math.max(-TOWN_SEASON_DELTA_MAX, Math.min(TOWN_SEASON_DELTA_MAX, delta));
};

const computeDeterministicHouseValue = (state: WorldState, idx: number, townId: number): number => {
  const sample = hash2D(idx + townId * 29, state.year * 13 + townId * 7, state.seed + 1307);
  return 120 + Math.floor(sample * 220);
};

const computeDeterministicHouseResidents = (state: WorldState, idx: number, townId: number): number => {
  const sample = hash2D(idx + townId * 31, state.year * 19 + townId * 11, state.seed + 1709);
  return 1 + Math.floor(sample * 4);
};

const updateTownRadius = (state: WorldState, town: WorldState["towns"][number]): void => {
  const maxRadius = Math.max(TOWN_RADIUS_MIN + 1, Math.min(Math.max(state.grid.cols, state.grid.rows) * 0.25, 24));
  const target = clamp(3.6 + 0.75 * Math.sqrt(Math.max(1, town.houseCount)), TOWN_RADIUS_MIN, maxRadius);
  town.radius = clamp(town.radius * 0.72 + target * 0.28, TOWN_RADIUS_MIN, maxRadius);
};

export function stepTownSeasonScaling(state: WorldState): void {
  stepRuntimeTownGrowth(state);
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
  let vegetationDirty = false;
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
        const prevAge = tile.vegetationAgeYears;
        let typeChanged = false;
        let tileStateChanged = false;

        const waterFactor = getWaterFactor(tile.waterDist);
        const elevFactor = getElevationFactor(tile.elevation);
        const env =
          (0.35 + 0.65 * tile.moisture) * (0.6 + 0.8 * waterFactor) * (0.4 + 0.6 * elevFactor);

        if (tile.type === "ash") {
          clearVegetationState(tile);
          if (tile.houseDestroyed) {
            state.tileVegetationAge[idx] = 0;
            state.tileCanopyCover[idx] = 0;
            state.tileStemDensity[idx] = 0;
            canopyValues[idx] = 0;
            forestValues[idx] = 0;
            state.tileFuel[idx] = tile.fuel;
            if (Math.abs(prevCanopy) >= CANOPY_DIRTY_THRESHOLD || prevAge > 0) {
              terrainDirty = true;
              vegetationDirty = true;
            }
            continue;
          }
          tile.ashAge += dayDelta;
          const ageFactor = clamp(tile.ashAge / ASH_RECOVERY_RAMP_DAYS, 0, 1);
          const recoverChance = dayDelta * ASH_RECOVERY_RATE * env * (0.25 + 0.75 * ageFactor);
          if (rng.next() < recoverChance) {
            tile.type = "grass";
            tile.vegetationAgeYears = 0.25 + rng.next() * 0.35;
            tile.ashAge = 0;
            tile.dominantTreeType = null;
            tile.treeType = null;
            syncDerivedVegetationState(tile, state.seed, x, y);
            applyFuel(tile, tile.moisture, rng);
            state.burnedTiles = Math.max(0, state.burnedTiles - 1);
            typeChanged = true;
            tileStateChanged = true;
          }
          if (typeChanged) {
            state.terrainTypeRevision += 1;
          }
          if (
            typeChanged ||
            Math.abs(tile.canopy - prevCanopy) >= CANOPY_DIRTY_THRESHOLD ||
            Math.abs(tile.vegetationAgeYears - prevAge) >= 0.2
          ) {
            terrainDirty = true;
            vegetationDirty = true;
          }
          if (typeChanged) {
            syncTileSoAIndex(state, idx);
          } else {
            state.tileVegetationAge[idx] = tile.vegetationAgeYears;
            state.tileCanopyCover[idx] = tile.canopyCover;
            state.tileStemDensity[idx] = tile.stemDensity;
            state.tileFuel[idx] = tile.fuel;
          }
          canopyValues[idx] = isVegetationType(tile.type) ? tile.canopy : 0;
          forestValues[idx] = isForestType(tile.type) ? 1 : 0;
          continue;
        }

        if (tile.type === "firebreak") {
          clearVegetationState(tile);
          if (!tile.houseDestroyed && rng.next() < dayDelta * FIREBREAK_RECOVERY_RATE * env) {
            tile.type = "grass";
            tile.vegetationAgeYears = 0.2 + rng.next() * 0.3;
            tile.dominantTreeType = null;
            tile.treeType = null;
            syncDerivedVegetationState(tile, state.seed, x, y);
            applyFuel(tile, tile.moisture, rng);
            typeChanged = true;
            tileStateChanged = true;
          }
          if (typeChanged) {
            state.terrainTypeRevision += 1;
          }
          if (
            typeChanged ||
            Math.abs(tile.canopy - prevCanopy) >= CANOPY_DIRTY_THRESHOLD ||
            Math.abs(tile.vegetationAgeYears - prevAge) >= 0.2
          ) {
            terrainDirty = true;
            vegetationDirty = true;
          }
          if (typeChanged) {
            syncTileSoAIndex(state, idx);
          } else {
            state.tileVegetationAge[idx] = tile.vegetationAgeYears;
            state.tileCanopyCover[idx] = tile.canopyCover;
            state.tileStemDensity[idx] = tile.stemDensity;
            state.tileFuel[idx] = tile.fuel;
          }
          canopyValues[idx] = isVegetationType(tile.type) ? tile.canopy : 0;
          forestValues[idx] = isForestType(tile.type) ? 1 : 0;
          continue;
        }

        if (tile.type === "grass" || tile.type === "scrub" || tile.type === "floodplain" || tile.type === "forest") {
          const seedPressure = getSeedPressure(state, x, y, canopyValues, forestValues);
          const profile = fuelProfiles[tile.type];
          const ageCap = getVegetationAgeCapYears(tile.type);
          const maturity01 = ageCap > 0 ? clamp(tile.vegetationAgeYears / ageCap, 0, 1) : 0;
          const ageRate = tile.type === "forest" ? FOREST_AGE_RATE : OPEN_VEGETATION_AGE_RATE;
          const seedBoost = tile.type === "forest" ? 0.45 + seedPressure * 0.85 : 0.6 + seedPressure * 0.45;
          const maturityDrag = 0.2 + 0.8 * (1 - maturity01);
          tile.vegetationAgeYears += dayDelta * ageRate * env * seedBoost * maturityDrag;
          syncDerivedVegetationState(tile, state.seed, x, y);
          const maxFuel = profile.baseFuel * getVegetationFuelCapMultiplier(tile.type, tile.vegetationAgeYears);
          const fuelGrowth = dayDelta * FUEL_GROWTH_RATE * (0.4 + 0.6 * env);
          tile.fuel = clamp(tile.fuel + fuelGrowth, 0, maxFuel);

          if (
            (tile.type === "grass" || tile.type === "scrub" || tile.type === "floodplain") &&
            tile.canopy >= CANOPY_FOREST_THRESHOLD
          ) {
            const recruitChance = dayDelta * FOREST_RECRUIT_RATE * env * (LONG_DISTANCE_RECRUIT_FACTOR + seedPressure);
            if (rng.next() < recruitChance) {
              tile.type = "forest";
              tile.vegetationAgeYears = FOREST_RECRUIT_AGE_YEARS;
              const neighborForestType = getForestSeedType(state, x, y);
              if (neighborForestType) {
                tile.dominantTreeType = neighborForestType;
                tile.treeType = neighborForestType;
              } else {
                const weights = computeForestTreeWeights(tile.moisture, tile.elevation, x, y, state.seed + 9001);
                const dominant = pickWeightedTreeType(
                  hash2D(x, y, state.seed + 9011),
                  DOMINANT_FOREST_TYPES,
                  weights
                );
                tile.dominantTreeType = dominant;
                tile.treeType = dominant;
              }
              syncDerivedVegetationState(tile, state.seed, x, y);
              applyFuel(tile, tile.moisture, rng);
              typeChanged = true;
              tileStateChanged = true;
            }
          } else if (!isForestType(tile.type)) {
            tile.dominantTreeType = null;
            tile.treeType = null;
          }
          if (
            typeChanged ||
            tileStateChanged ||
            Math.abs(tile.canopy - prevCanopy) >= CANOPY_DIRTY_THRESHOLD ||
            Math.abs(tile.vegetationAgeYears - prevAge) >= 0.2
          ) {
            terrainDirty = true;
            vegetationDirty = true;
          }
          if (typeChanged) {
            state.terrainTypeRevision += 1;
          }
          if (typeChanged) {
            syncTileSoAIndex(state, idx);
          } else {
            state.tileVegetationAge[idx] = tile.vegetationAgeYears;
            state.tileCanopyCover[idx] = tile.canopyCover;
            state.tileStemDensity[idx] = tile.stemDensity;
            state.tileFuel[idx] = tile.fuel;
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
  if (vegetationDirty) {
    state.vegetationRevision += 1;
  }
  profEnd("growth", profStartAt);
}

