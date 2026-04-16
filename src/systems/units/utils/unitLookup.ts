import type { CommandUnit, Point, RosterUnit, Unit } from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";

export const getRosterUnit = (state: WorldState, rosterId: number | null): RosterUnit | null => {
  if (rosterId === null) {
    return null;
  }
  return state.roster.find((unit) => unit.id === rosterId) ?? null;
};

export const getRosterTruck = (state: WorldState, rosterId: number | null): RosterUnit | null => {
  const unit = getRosterUnit(state, rosterId);
  if (!unit || unit.kind !== "truck") {
    return null;
  }
  return unit;
};

export const getRosterFirefighter = (state: WorldState, rosterId: number | null): RosterUnit | null => {
  const unit = getRosterUnit(state, rosterId);
  if (!unit || unit.kind !== "firefighter") {
    return null;
  }
  return unit;
};

export const getUnitById = (state: WorldState, id: number): Unit | null =>
  state.units.find((unit) => unit.id === id) ?? null;

export const getCommandUnitById = (state: WorldState, commandUnitId: number | null): CommandUnit | null => {
  if (commandUnitId === null) {
    return null;
  }
  return state.commandUnits.find((entry) => entry.id === commandUnitId) ?? null;
};

export const getUnitTile = (unit: Unit): Point => ({
  x: Math.floor(unit.x),
  y: Math.floor(unit.y)
});

export const getTruckSortKey = (unit: Unit): number => unit.rosterId ?? unit.id;

export const getCommandUnitTruckIds = (state: WorldState, commandUnitId: number): number[] => {
  const commandUnit = getCommandUnitById(state, commandUnitId);
  if (!commandUnit) {
    return [];
  }
  return commandUnit.truckIds.filter((truckId) => getUnitById(state, truckId)?.kind === "truck");
};
