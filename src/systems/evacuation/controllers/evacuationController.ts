import type { WorldState } from "../../../core/state.js";
import type { Point } from "../../../core/types.js";
import { setStatus } from "../../../core/state.js";
import { createEvacuationRoute } from "../sim/roadRoute.js";
import { createActiveEvacuation, orderEvacuationReturnHome } from "../sim/evacuationRuntime.js";

const getTownById = (state: WorldState, townId: number): WorldState["towns"][number] | null =>
  state.towns.find((town) => town.id === townId) ?? null;

const hasLockedEvacuation = (town: WorldState["towns"][number]): boolean =>
  town.evacuationStatus === "EvacuationOrdered" ||
  town.evacuationStatus === "Evacuating" ||
  town.evacuationStatus === "Returning" ||
  town.evacuationStatus === "Completed" ||
  town.evacuationStatus === "Returned" ||
  town.evacuationStatus === "Failed";

export const beginTownEvacuationDestinationSelection = (state: WorldState, townId: number): boolean => {
  const town = getTownById(state, townId);
  if (!town || hasLockedEvacuation(town)) {
    return false;
  }
  state.evacuationSelectionTownId = townId;
  setStatus(state, `Select an evacuation destination for ${town.name}.`);
  return true;
};

export const cancelTownEvacuationSelection = (state: WorldState, townId: number): boolean => {
  const town = getTownById(state, townId);
  if (!town) {
    return false;
  }
  if (state.evacuationSelectionTownId === townId) {
    state.evacuationSelectionTownId = null;
  }
  if (town.evacuationStatus === "PointSelected") {
    town.evacuationStatus = "Cancelled";
    town.selectedEvacuationPoint = undefined;
    setStatus(state, `${town.name} evacuation selection cancelled.`);
    return true;
  }
  return false;
};

export const selectTownEvacuationDestination = (state: WorldState, townId: number, destination: Point): boolean => {
  const town = getTownById(state, townId);
  if (!town || hasLockedEvacuation(town)) {
    return false;
  }
  const result = createEvacuationRoute(state, townId, destination);
  if (!result.ok) {
    setStatus(state, "Evacuation destination must be connected to the road network.");
    return false;
  }
  town.selectedEvacuationPoint = { x: result.route.destination.x, y: result.route.destination.y };
  town.evacuationStatus = "PointSelected";
  state.evacuationSelectionTownId = null;
  setStatus(state, `${town.name} evacuation route selected.`);
  return true;
};

export const issueTownEvacuation = (state: WorldState, townId: number): boolean => {
  const town = getTownById(state, townId);
  if (!town || !town.selectedEvacuationPoint) {
    return false;
  }
  const result = createEvacuationRoute(state, townId, town.selectedEvacuationPoint);
  if (!result.ok) {
    setStatus(state, "Evacuation route is no longer connected.");
    return false;
  }
  const evacuationId = `evac-${state.nextEvacuationId++}`;
  town.activeEvacuationId = evacuationId;
  town.evacuationStatus = "EvacuationOrdered";
  const active = createActiveEvacuation(state, evacuationId, town, result.route);
  state.activeEvacuations.push(active);
  state.evacuationSelectionTownId = null;
  setStatus(state, `${town.name} evacuation ordered.`);
  return true;
};

export const returnTownEvacuationHome = (state: WorldState, townId: number): boolean => {
  const town = getTownById(state, townId);
  if (!town) {
    return false;
  }
  if (!orderEvacuationReturnHome(state, townId)) {
    return false;
  }
  setStatus(state, `${town.name} evacuees returning home.`);
  return true;
};
