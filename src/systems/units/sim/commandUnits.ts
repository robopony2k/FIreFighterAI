import type { CommandIntent, CommandUnit, CommandUnitStatus, Unit } from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";
import { COMMAND_UNIT_NAMES } from "../constants/runtimeConstants.js";
import { getCommandUnitById, getTruckSortKey, getUnitById } from "../utils/unitLookup.js";
import { ensureDefaultSquads, getSquadById } from "../controllers/squadController.js";

const FALLBACK_TRUCKS_PER_COMMAND_UNIT = 5;

const getCommandUnitName = (index: number): string => {
  if (index < COMMAND_UNIT_NAMES.length) {
    return COMMAND_UNIT_NAMES[index]!;
  }
  return `Unit ${index + 1}`;
};

const getFallbackCommandUnitName = (index: number): string => getCommandUnitName(index);

const normalizeCommandUnitSelection = (state: WorldState): void => {
  const validCommandUnitIds = new Set(state.commandUnits.map((entry) => entry.id));
  state.selectedCommandUnitIds = state.selectedCommandUnitIds.filter((id) => validCommandUnitIds.has(id));
  const validTruckIds = new Set(state.units.filter((unit) => unit.kind === "truck").map((unit) => unit.id));
  state.selectedTruckIds = state.selectedTruckIds.filter((id) => validTruckIds.has(id));
  if (state.focusedCommandUnitId !== null && !validCommandUnitIds.has(state.focusedCommandUnitId)) {
    state.focusedCommandUnitId = null;
  }
  if (state.focusedCommandUnitId === null) {
    if (state.selectedTruckIds.length > 0) {
      const focusedTruck = getUnitById(state, state.selectedTruckIds[0]!) ?? null;
      state.focusedCommandUnitId = focusedTruck?.commandUnitId ?? null;
    } else if (state.selectedCommandUnitIds.length > 0) {
      state.focusedCommandUnitId = state.selectedCommandUnitIds[0]!;
    }
  }
};

export const syncMirroredTruckSelection = (state: WorldState): void => {
  let selectedTruckIds: number[] = [];
  if (state.selectionScope === "truck") {
    selectedTruckIds = [...state.selectedTruckIds];
  } else {
    const truckIds = new Set<number>();
    state.selectedCommandUnitIds.forEach((commandUnitId) => {
      getCommandUnitTruckIds(state, commandUnitId).forEach((truckId) => truckIds.add(truckId));
    });
    selectedTruckIds = [...truckIds];
  }
  state.selectedUnitIds = selectedTruckIds;
  state.units.forEach((unit) => {
    unit.selected = unit.kind === "truck" && selectedTruckIds.includes(unit.id);
  });
};

export const syncCommandUnits = (state: WorldState): void => {
  ensureDefaultSquads(state);
  const deployedTrucks = state.units
    .filter((unit) => unit.kind === "truck")
    .sort((left, right) => getTruckSortKey(left) - getTruckSortKey(right));
  const previousBySquadId = new Map(
    state.commandUnits
      .filter((entry) => entry.squadId !== null)
      .map((entry) => [entry.squadId as number, entry] as const)
  );
  const previousFallback = state.commandUnits.filter((entry) => entry.squadId === null);
  if (deployedTrucks.length === 0) {
    state.commandUnits = [];
    state.selectedCommandUnitIds = [];
    state.selectedTruckIds = [];
    state.focusedCommandUnitId = null;
    state.commandUnitsRevision += 1;
    syncMirroredTruckSelection(state);
    return;
  }

  const nextCommandUnits: CommandUnit[] = [];
  const trucksBySquadId = new Map<number, Unit[]>();
  const fallbackTrucks: Unit[] = [];
  deployedTrucks.forEach((truck) => {
    const rosterTruck = truck.rosterId !== null ? state.roster.find((entry) => entry.id === truck.rosterId) ?? null : null;
    const squad = getSquadById(state, rosterTruck?.squadId ?? null);
    if (!squad) {
      fallbackTrucks.push(truck);
      return;
    }
    const bucket = trucksBySquadId.get(squad.id) ?? [];
    bucket.push(truck);
    trucksBySquadId.set(squad.id, bucket);
  });

  state.squads.forEach((squad) => {
    const chunk = trucksBySquadId.get(squad.id) ?? [];
    if (chunk.length === 0) {
      return;
    }
    const previous = previousBySquadId.get(squad.id) ?? null;
    nextCommandUnits.push({
      id: previous?.id ?? state.nextCommandUnitId++,
      squadId: squad.id,
      homeTownId: squad.homeTownId,
      name: squad.name,
      truckIds: chunk.map((unit) => unit.id),
      currentIntent: previous?.currentIntent ?? squad.currentIntent ?? null,
      status: previous?.status ?? squad.status ?? "holding",
      revision: (previous?.revision ?? 0) + 1
    });
  });

  for (let index = 0; index < fallbackTrucks.length; index += FALLBACK_TRUCKS_PER_COMMAND_UNIT) {
    const chunk = fallbackTrucks.slice(index, index + FALLBACK_TRUCKS_PER_COMMAND_UNIT);
    const fallbackIndex = Math.floor(index / FALLBACK_TRUCKS_PER_COMMAND_UNIT);
    const previous = previousFallback[fallbackIndex] ?? null;
    const commandUnitIndex = nextCommandUnits.length;
    if (chunk.length === 0) {
      continue;
    }
    nextCommandUnits.push({
      id: previous?.id ?? state.nextCommandUnitId++,
      squadId: null,
      homeTownId: state.headquartersTownId,
      name: previous?.name ?? getFallbackCommandUnitName(commandUnitIndex),
      truckIds: chunk.map((truck) => truck.id),
      currentIntent: previous?.currentIntent ?? null,
      status: previous?.status ?? "holding",
      revision: (previous?.revision ?? 0) + 1
    });
  }

  state.units.forEach((unit) => {
    unit.commandUnitId = null;
  });
  nextCommandUnits.forEach((commandUnit) => {
    commandUnit.truckIds.forEach((truckId) => {
      const truck = getUnitById(state, truckId);
      if (!truck) {
        return;
      }
      truck.commandUnitId = commandUnit.id;
      truck.crewIds.forEach((crewId) => {
        const crew = getUnitById(state, crewId);
        if (crew) {
          crew.commandUnitId = commandUnit.id;
        }
      });
    });
  });
  state.commandUnits = nextCommandUnits;
  state.squads.forEach((squad) => {
    const active = nextCommandUnits.find((entry) => entry.squadId === squad.id) ?? null;
    if (active) {
      squad.currentIntent = active.currentIntent;
      squad.status = active.status;
    }
  });
  state.commandUnitsRevision += 1;
  normalizeCommandUnitSelection(state);
  syncMirroredTruckSelection(state);
};

export const getCommandUnitTruckIds = (state: WorldState, commandUnitId: number): number[] => {
  const commandUnit = getCommandUnitById(state, commandUnitId);
  if (!commandUnit) {
    return [];
  }
  return commandUnit.truckIds.filter((truckId) => getUnitById(state, truckId)?.kind === "truck");
};

export const getEffectiveTruckIntent = (state: WorldState, truck: Unit): CommandIntent | null => {
  if (truck.kind !== "truck") {
    return null;
  }
  if (truck.truckOverrideIntent) {
    return truck.truckOverrideIntent;
  }
  return getCommandUnitById(state, truck.commandUnitId)?.currentIntent ?? null;
};

export const updateCommandUnitStatuses = (state: WorldState): void => {
  state.commandUnits.forEach((commandUnit) => {
    const trucks = commandUnit.truckIds
      .map((truckId) => getUnitById(state, truckId))
      .filter((truck): truck is Unit => !!truck && truck.kind === "truck");
    const priority: CommandUnitStatus[] = ["retreating", "suppressing", "moving", "holding"];
    commandUnit.status = priority.find((status) => trucks.some((truck) => truck.currentStatus === status)) ?? "holding";
  });
};
