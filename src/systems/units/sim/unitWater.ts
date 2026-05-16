import type { Unit } from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";
import { inBounds, indexFor } from "../../../core/grid.js";
import {
  FIREFIGHTER_WATER_USE_RATE,
  TRUCK_RIVER_REFILL_RADIUS,
  TRUCK_WATER_USE_RATE
} from "../constants/runtimeConstants.js";
import { getUnitById, getUnitTile } from "../utils/unitLookup.js";

const isTruckNearRiverWaterSource = (state: WorldState, truck: Unit): boolean => {
  const tile = getUnitTile(truck);
  for (let dy = -TRUCK_RIVER_REFILL_RADIUS; dy <= TRUCK_RIVER_REFILL_RADIUS; dy += 1) {
    for (let dx = -TRUCK_RIVER_REFILL_RADIUS; dx <= TRUCK_RIVER_REFILL_RADIUS; dx += 1) {
      const nx = tile.x + dx;
      const ny = tile.y + dy;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const idx = indexFor(state.grid, nx, ny);
      if (state.tileRiverMask[idx] > 0) {
        return true;
      }
    }
  }
  return false;
};

const isTruckGroupActivelySpraying = (state: WorldState, truck: Unit): boolean => {
  if (truck.water <= 0.01) {
    return false;
  }
  if (truck.sprayTarget) {
    return true;
  }
  return state.units.some(
    (unit) =>
      unit.kind === "firefighter" &&
      unit.carrierId === null &&
      unit.assignedTruckId === truck.id &&
      unit.sprayTarget !== null
  );
};

export const updateTruckWater = (state: WorldState, truck: Unit, delta: number): void => {
  if (truck.kind !== "truck" || truck.waterCapacity <= 0) {
    return;
  }
  const tile = getUnitTile(truck);
  const idx = indexFor(state.grid, tile.x, tile.y);
  if (state.tiles[idx]?.type === "base") {
    truck.water = Math.max(0, Math.min(truck.waterCapacity, truck.water + truck.waterRefillRate * delta));
    return;
  }
  if (isTruckNearRiverWaterSource(state, truck) && !isTruckGroupActivelySpraying(state, truck)) {
    truck.water = Math.max(0, Math.min(truck.waterCapacity, truck.water + TRUCK_WATER_USE_RATE * delta));
  }
};

const getUnitWaterSourceTruck = (state: WorldState, unit: Unit): Unit | null => {
  if (unit.kind === "truck") {
    return unit;
  }
  if (unit.assignedTruckId === null) {
    return null;
  }
  const truck = getUnitById(state, unit.assignedTruckId);
  return truck && truck.kind === "truck" ? truck : null;
};

export const canUnitSpray = (state: WorldState, unit: Unit): boolean => {
  const truck = getUnitWaterSourceTruck(state, unit);
  if (!truck || truck.waterCapacity <= 0) {
    return true;
  }
  return truck.water > 0.01;
};

export const spendUnitWater = (state: WorldState, unit: Unit, delta: number): void => {
  const truck = getUnitWaterSourceTruck(state, unit);
  if (!truck || truck.waterCapacity <= 0) {
    return;
  }
  const useRate = unit.kind === "truck" ? TRUCK_WATER_USE_RATE : FIREFIGHTER_WATER_USE_RATE;
  const spend = delta * useRate;
  truck.water = Math.max(0, Math.min(truck.waterCapacity, truck.water - spend));
  const truckTile = getUnitTile(truck);
  const truckIdx = indexFor(state.grid, truckTile.x, truckTile.y);
  if (state.tiles[truckIdx]?.type !== "base" && isTruckNearRiverWaterSource(state, truck)) {
    truck.water = Math.max(0, Math.min(truck.waterCapacity, truck.water + spend));
  }
};
