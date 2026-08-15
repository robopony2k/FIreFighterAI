import type { Unit } from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";
import { indexFor } from "../../../core/grid.js";
import { isVehicleRoadTile } from "./unitTraversalRules.js";

export type RoadTruckOccupancy = Map<number, Set<number>>;

const addOccupant = (occupancy: RoadTruckOccupancy, tileIndex: number, truckId: number): void => {
  const occupants = occupancy.get(tileIndex);
  if (occupants) {
    occupants.add(truckId);
    return;
  }
  occupancy.set(tileIndex, new Set([truckId]));
};

const removeTruck = (occupancy: RoadTruckOccupancy, truckId: number): void => {
  occupancy.forEach((occupants, tileIndex) => {
    occupants.delete(truckId);
    if (occupants.size === 0) {
      occupancy.delete(tileIndex);
    }
  });
};

const addTruckAtPosition = (state: WorldState, occupancy: RoadTruckOccupancy, truck: Unit): void => {
  const tileX = Math.floor(truck.x);
  const tileY = Math.floor(truck.y);
  if (!isVehicleRoadTile(state, tileX, tileY)) {
    return;
  }
  addOccupant(occupancy, indexFor(state.grid, tileX, tileY), truck.id);
};

export const createRoadTruckOccupancy = (state: WorldState): RoadTruckOccupancy => {
  const occupancy: RoadTruckOccupancy = new Map();
  state.units.forEach((unit) => {
    if (unit.kind === "truck") {
      addTruckAtPosition(state, occupancy, unit);
    }
  });
  return occupancy;
};

export const tryReserveRoadTruckTile = (
  state: WorldState,
  occupancy: RoadTruckOccupancy,
  truckId: number,
  tileX: number,
  tileY: number
): boolean => {
  if (!isVehicleRoadTile(state, tileX, tileY)) {
    return true;
  }
  const tileIndex = indexFor(state.grid, tileX, tileY);
  const occupants = occupancy.get(tileIndex);
  if (occupants && [...occupants].some((occupantId) => occupantId !== truckId)) {
    return false;
  }
  addOccupant(occupancy, tileIndex, truckId);
  return true;
};

export const syncRoadTruckOccupancy = (
  state: WorldState,
  occupancy: RoadTruckOccupancy,
  truck: Unit
): void => {
  removeTruck(occupancy, truck.id);
  addTruckAtPosition(state, occupancy, truck);
};
