import { inBounds, indexFor } from "../../../core/grid.js";
import { TILE_TYPE_IDS, type WorldState } from "../../../core/state.js";
import type { Point, Town } from "../../../core/types.js";
import { hash2D } from "../../../mapgen/noise.js";
import {
  WATER_TOWER_CAPACITY,
  WATER_TOWER_DRY_REFILL_RATE,
  WATER_TOWER_PLACEMENT_RING_MAX,
  WATER_TOWER_PLACEMENT_RING_MIN,
  WATER_TOWER_RAIN_REFILL_RATE,
  WATER_TOWER_RESERVOIR_EPS,
  WATER_TOWER_SERVICE_RADIUS,
  WATER_TOWER_TYPE_ID
} from "../constants/waterTowerConstants.js";
import type { WaterTower } from "../types/waterTowerTypes.js";

export type WaterTowerSource = {
  tower: WaterTower;
  distance: number;
};

const getTownCenter = (town: Town): Point => ({
  x: Number.isFinite(town.cx) ? town.cx : town.x,
  y: Number.isFinite(town.cy) ? town.cy : town.y
});

const isBuildableWaterTowerTile = (state: WorldState, x: number, y: number): boolean => {
  if (!inBounds(state.grid, x, y)) {
    return false;
  }
  const idx = indexFor(state.grid, x, y);
  const tile = state.tiles[idx];
  if (!tile) {
    return false;
  }
  return (
    tile.type !== "water" &&
    tile.type !== "house" &&
    tile.type !== "base" &&
    (state.tileTypeId[idx] ?? -1) !== TILE_TYPE_IDS.water &&
    (state.tileOceanMask[idx] ?? 0) <= 0 &&
    (state.tileLakeMask[idx] ?? 0) <= 0 &&
    (state.structureMask[idx] ?? 0) <= 0 &&
    (state.tileStructure[idx] ?? 0) <= 0
  );
};

const scoreWaterTowerSite = (state: WorldState, town: Town, x: number, y: number): number => {
  const center = getTownCenter(town);
  const dist = Math.hypot(x - center.x, y - center.y);
  const idealDistance = Math.max(WATER_TOWER_PLACEMENT_RING_MIN, Math.min(WATER_TOWER_PLACEMENT_RING_MAX, town.radius * 0.55));
  const distanceScore = Math.abs(dist - idealDistance);
  const roadNeighborPenalty = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 }
  ].some((offset) => {
    const nx = x + offset.dx;
    const ny = y + offset.dy;
    return inBounds(state.grid, nx, ny) && state.tiles[indexFor(state.grid, nx, ny)]?.type === "road";
  })
    ? -0.35
    : 0;
  const seedBias = hash2D(x + town.id * 17, y + town.id * 31, state.seed ^ 0x72a17e4d) * 0.08;
  return distanceScore + roadNeighborPenalty + seedBias;
};

const resolveWaterTowerSite = (state: WorldState, town: Town): Point => {
  const center = getTownCenter(town);
  const cx = Math.round(center.x);
  const cy = Math.round(center.y);
  let bestX = -1;
  let bestY = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let radius = WATER_TOWER_PLACEMENT_RING_MIN; radius <= WATER_TOWER_PLACEMENT_RING_MAX; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) {
          continue;
        }
        const x = cx + dx;
        const y = cy + dy;
        if (!isBuildableWaterTowerTile(state, x, y)) {
          continue;
        }
        const score = scoreWaterTowerSite(state, town, x, y);
        if (
          score < bestScore ||
          (score === bestScore && (bestX < 0 || y * state.grid.cols + x < bestY * state.grid.cols + bestX))
        ) {
          bestX = x;
          bestY = y;
          bestScore = score;
        }
      }
    }
    if (bestX >= 0 && bestY >= 0) {
      return { x: bestX, y: bestY };
    }
  }
  return {
    x: Math.max(0, Math.min(state.grid.cols - 1, cx)),
    y: Math.max(0, Math.min(state.grid.rows - 1, cy))
  };
};

export const getWaterTowerForTown = (state: WorldState, townId: number): WaterTower | null =>
  (state.waterTowers ?? []).find((tower) => tower.townId === townId && tower.typeId === WATER_TOWER_TYPE_ID) ?? null;

export const ensureWaterTowerState = (state: WorldState): void => {
  if (!state.waterTowers) {
    state.waterTowers = [];
  }
  if (!Number.isFinite(state.nextWaterTowerId)) {
    state.nextWaterTowerId = 1;
  }
};

export const ensureDefaultWaterTowers = (state: WorldState): void => {
  ensureWaterTowerState(state);
  let created = false;
  for (const town of state.towns) {
    if (getWaterTowerForTown(state, town.id)) {
      continue;
    }
    const site = resolveWaterTowerSite(state, town);
    const idx = indexFor(state.grid, site.x, site.y);
    const tower: WaterTower = {
      id: state.nextWaterTowerId++,
      typeId: WATER_TOWER_TYPE_ID,
      townId: town.id,
      x: site.x,
      y: site.y,
      capacity: WATER_TOWER_CAPACITY,
      water: WATER_TOWER_CAPACITY,
      serviceRadius: WATER_TOWER_SERVICE_RADIUS,
      active: true,
      builtCareerDay: state.careerDay
    };
    state.waterTowers.push(tower);
    if (idx >= 0 && idx < state.grid.totalTiles) {
      state.structureMask[idx] = 1;
      state.tileTownId[idx] = town.id;
    }
    created = true;
  }
  if (created) {
    state.structureRevision += 1;
  }
};

export const findWaterTowerSourceForPoint = (state: WorldState, point: Point): WaterTowerSource | null => {
  ensureWaterTowerState(state);
  let best: WaterTowerSource | null = null;
  for (const tower of state.waterTowers) {
    if (!tower.active || tower.water <= WATER_TOWER_RESERVOIR_EPS) {
      continue;
    }
    const centerX = tower.x + 0.5;
    const centerY = tower.y + 0.5;
    const distance = Math.hypot(point.x - centerX, point.y - centerY);
    if (distance > tower.serviceRadius) {
      continue;
    }
    if (!best || distance < best.distance || (distance === best.distance && tower.id < best.tower.id)) {
      best = { tower, distance };
    }
  }
  return best;
};

export const drainWaterTower = (tower: WaterTower, requested: number): number => {
  const amount = Math.max(0, Math.min(requested, tower.water));
  tower.water = Math.max(0, Math.min(tower.capacity, tower.water - amount));
  return amount;
};

export const stepWaterTowers = (state: WorldState, dayDelta: number): void => {
  ensureWaterTowerState(state);
  if (dayDelta <= 0 || state.waterTowers.length === 0) {
    return;
  }
  const rainIntensity = state.seasonalRain?.active ? Math.max(0, Math.min(1, state.seasonalRain.intensity01)) : 0;
  const refillRate = WATER_TOWER_DRY_REFILL_RATE + WATER_TOWER_RAIN_REFILL_RATE * rainIntensity;
  if (refillRate <= 0) {
    return;
  }
  for (const tower of state.waterTowers) {
    if (!tower.active || tower.water >= tower.capacity) {
      continue;
    }
    tower.water = Math.max(0, Math.min(tower.capacity, tower.water + refillRate * dayDelta));
  }
};
