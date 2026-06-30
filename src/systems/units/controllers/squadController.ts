import type { CommandFormation, CommandIntent, Point, RNG, RosterUnit, Squad } from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";
import { setStatus } from "../../../core/state.js";
import { resolveNearestTownId } from "../../../core/towns.js";
import { COMMAND_UNIT_NAMES } from "../constants/runtimeConstants.js";
import { applyCommandIntentToSelection, selectCommandUnit } from "./commandSelectionController.js";
import { syncCommandUnits } from "../sim/commandUnits.js";
import { deployUnit, setUnitTarget } from "../sim/unitDeployment.js";
import { getRosterTruck, getUnitById } from "../utils/unitLookup.js";

const DEFAULT_SQUAD_NAME = "Squad";

export const resolveHeadquartersTownId = (state: WorldState): number | null => {
  if (state.headquartersTownId !== null && state.towns.some((town) => town.id === state.headquartersTownId)) {
    return state.headquartersTownId;
  }
  const nearestTownId = resolveNearestTownId(state, state.basePoint.x, state.basePoint.y);
  if (nearestTownId < 0) {
    state.headquartersTownId = null;
    return null;
  }
  state.headquartersTownId = nearestTownId;
  return nearestTownId;
};

export const isHeadquartersTown = (state: WorldState, townId: number): boolean =>
  resolveHeadquartersTownId(state) === townId;

const getNextSquadName = (state: WorldState): string => {
  const index = state.squads.length;
  return COMMAND_UNIT_NAMES[index] ?? `${DEFAULT_SQUAD_NAME} ${index + 1}`;
};

const normalizeSquad = (squad: Squad, state: WorldState): void => {
  const truckRosterIds = new Set(
    state.roster.filter((entry) => entry.kind === "truck" && entry.status !== "lost").map((entry) => entry.id)
  );
  squad.truckRosterIds = squad.truckRosterIds.filter((id, index, ids) => truckRosterIds.has(id) && ids.indexOf(id) === index);
};

export const getSquadById = (state: WorldState, squadId: number | null): Squad | null => {
  if (squadId === null) {
    return null;
  }
  return state.squads.find((squad) => squad.id === squadId) ?? null;
};

export const ensureDefaultSquads = (state: WorldState): void => {
  const homeTownId = resolveHeadquartersTownId(state);
  state.squads.forEach((squad) => normalizeSquad(squad, state));
  if (state.squads.length === 0) {
    const squad: Squad = {
      id: state.nextSquadId++,
      homeTownId,
      name: COMMAND_UNIT_NAMES[0] ?? DEFAULT_SQUAD_NAME,
      truckRosterIds: [],
      currentIntent: null,
      status: "holding",
      revision: 0
    };
    state.squads.push(squad);
    state.selectedSquadId = squad.id;
  }
  const assignedTruckIds = new Set(state.squads.flatMap((squad) => squad.truckRosterIds));
  const unassignedTrucks = state.roster.filter(
    (entry) => entry.kind === "truck" && entry.status !== "lost" && !assignedTruckIds.has(entry.id)
  );
  const primarySquad = state.squads[0] ?? null;
  unassignedTrucks.forEach((truck) => {
    truck.squadId = primarySquad?.id ?? null;
    primarySquad?.truckRosterIds.push(truck.id);
  });
  state.roster.forEach((entry) => {
    if (entry.kind !== "truck") {
      return;
    }
    const squad = getSquadById(state, entry.squadId);
    if (!squad || !squad.truckRosterIds.includes(entry.id)) {
      const owner = state.squads.find((candidate) => candidate.truckRosterIds.includes(entry.id)) ?? null;
      entry.squadId = owner?.id ?? null;
    }
  });
  if (state.selectedSquadId === null || !getSquadById(state, state.selectedSquadId)) {
    state.selectedSquadId = state.squads[0]?.id ?? null;
  }
};

export const createSquad = (state: WorldState, name = getNextSquadName(state)): Squad => {
  const squad: Squad = {
    id: state.nextSquadId++,
    homeTownId: resolveHeadquartersTownId(state),
    name,
    truckRosterIds: [],
    currentIntent: null,
    status: "holding",
    revision: 0
  };
  state.squads.push(squad);
  state.selectedSquadId = squad.id;
  setStatus(state, `${squad.name} created at HQ.`);
  return squad;
};

export const selectSquad = (state: WorldState, squadId: number | null): void => {
  ensureDefaultSquads(state);
  const squad = getSquadById(state, squadId);
  if (!squad) {
    return;
  }
  state.selectedSquadId = squad.id;
  const active = state.commandUnits.find((commandUnit) => commandUnit.squadId === squad.id) ?? null;
  if (active) {
    selectCommandUnit(state, active.id);
  } else {
    setStatus(state, `${squad.name} selected.`);
  }
};

export const renameSelectedSquad = (state: WorldState): void => {
  ensureDefaultSquads(state);
  const squad = getSquadById(state, state.selectedSquadId);
  if (!squad) {
    return;
  }
  const index = state.squads.findIndex((entry) => entry.id === squad.id);
  squad.name = COMMAND_UNIT_NAMES[(index + 1) % COMMAND_UNIT_NAMES.length] ?? `${DEFAULT_SQUAD_NAME} ${index + 2}`;
  squad.revision += 1;
  syncCommandUnits(state);
  setStatus(state, `Squad renamed to ${squad.name}.`);
};

const removeTruckFromCurrentSquad = (state: WorldState, truck: RosterUnit): void => {
  if (truck.squadId === null) {
    return;
  }
  const previous = getSquadById(state, truck.squadId);
  if (previous) {
    previous.truckRosterIds = previous.truckRosterIds.filter((id) => id !== truck.id);
    previous.revision += 1;
  }
  truck.squadId = null;
};

export const assignRosterTruckToSelectedSquad = (state: WorldState, rosterTruckId: number): boolean => {
  ensureDefaultSquads(state);
  const squad = getSquadById(state, state.selectedSquadId);
  const truck = getRosterTruck(state, rosterTruckId);
  if (!squad || !truck || truck.status === "lost") {
    return false;
  }
  if (truck.status !== "available") {
    setStatus(state, "Truck squad assignment can only change while it is parked at HQ.");
    return false;
  }
  removeTruckFromCurrentSquad(state, truck);
  truck.squadId = squad.id;
  squad.truckRosterIds.push(truck.id);
  normalizeSquad(squad, state);
  squad.revision += 1;
  syncCommandUnits(state);
  setStatus(state, `${truck.name} assigned to ${squad.name}.`);
  return true;
};

export const removeRosterTruckFromSquad = (state: WorldState, rosterTruckId: number): boolean => {
  const truck = getRosterTruck(state, rosterTruckId);
  if (!truck || truck.status !== "available") {
    setStatus(state, "Truck squad assignment can only change while it is parked at HQ.");
    return false;
  }
  const previous = getSquadById(state, truck.squadId);
  removeTruckFromCurrentSquad(state, truck);
  syncCommandUnits(state);
  setStatus(state, `${truck.name} removed from ${previous?.name ?? "squad"}.`);
  return true;
};

const makeDispatchIntent = (
  tile: Point,
  formation: CommandFormation,
  orientationEnd?: Point | null
): CommandIntent => {
  if (orientationEnd && (formation === "line" || formation === "wedge" || formation === "arc")) {
    return {
      type: "move",
      target: {
        kind: "line",
        start: { x: tile.x, y: tile.y },
        end: { x: orientationEnd.x, y: orientationEnd.y }
      },
      formation,
      behaviourMode: "balanced"
    };
  }
  return {
    type: "move",
    target: {
      kind: "point",
      point: { x: tile.x, y: tile.y }
    },
    formation,
    behaviourMode: "balanced"
  };
};

export const dispatchSquadToTile = (
  state: WorldState,
  rng: RNG,
  squadId: number,
  tile: Point,
  formation: CommandFormation,
  orientationEnd?: Point | null
): boolean => {
  ensureDefaultSquads(state);
  const squad = getSquadById(state, squadId);
  if (!squad) {
    setStatus(state, "Select an HQ squad first.");
    return false;
  }
  const availableTrucks = squad.truckRosterIds
    .map((id) => getRosterTruck(state, id))
    .filter((truck): truck is RosterUnit => !!truck && truck.status === "available");
  if (availableTrucks.length > 0) {
    const previousRosterId = state.selectedRosterId;
    availableTrucks.forEach((truck) => {
      state.selectedRosterId = truck.id;
      deployUnit(state, rng, "truck", tile.x, tile.y);
    });
    state.selectedRosterId = previousRosterId;
  }
  syncCommandUnits(state);
  const commandUnit = state.commandUnits.find((entry) => entry.squadId === squad.id) ?? null;
  if (!commandUnit) {
    setStatus(state, `${squad.name} has no available trucks to dispatch.`);
    return false;
  }
  const previousSelection = [...state.selectedCommandUnitIds];
  selectCommandUnit(state, commandUnit.id);
  const intent = makeDispatchIntent(tile, formation, orientationEnd);
  applyCommandIntentToSelection(state, intent);
  state.selectedCommandUnitIds = previousSelection.length > 0 ? previousSelection : [commandUnit.id];
  state.focusedCommandUnitId = commandUnit.id;
  squad.currentIntent = intent;
  squad.revision += 1;
  setStatus(state, `${squad.name} dispatched to ${tile.x}, ${tile.y}.`);
  return true;
};

export const issueSquadReturnOrders = (state: WorldState): number => {
  const home = state.basePoint;
  let ordered = 0;
  state.commandUnits.forEach((commandUnit) => {
    commandUnit.currentIntent = makeDispatchIntent(home, "line");
    commandUnit.revision += 1;
    if (commandUnit.squadId !== null) {
      const squad = getSquadById(state, commandUnit.squadId);
      if (squad) {
        squad.currentIntent = commandUnit.currentIntent;
        squad.revision += 1;
      }
    }
    commandUnit.truckIds.forEach((truckId) => {
      const truck = getUnitById(state, truckId);
      if (!truck || truck.kind !== "truck") {
        return;
      }
      setUnitTarget(state, truck, home.x, home.y, true, { silent: true });
      ordered += 1;
    });
  });
  if (ordered > 0) {
    setStatus(state, `Rain recall issued. ${ordered} truck(s) returning to HQ.`);
  }
  return ordered;
};
