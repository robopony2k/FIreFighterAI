import type { CommandIntent, CommandUnit, CommandUnitStatus, Unit } from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";
import { COMMAND_UNIT_NAMES } from "../constants/runtimeConstants.js";
import { getCommandUnitById, getTruckSortKey, getUnitById } from "../utils/unitLookup.js";

const getCommandUnitName = (index: number): string => {
  if (index < COMMAND_UNIT_NAMES.length) {
    return COMMAND_UNIT_NAMES[index]!;
  }
  return `Unit ${index + 1}`;
};

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
  const deployedTrucks = state.units
    .filter((unit) => unit.kind === "truck")
    .sort((left, right) => getTruckSortKey(left) - getTruckSortKey(right));
  const previousByName = new Map(state.commandUnits.map((entry, index) => [entry.name, { entry, index }] as const));
  if (deployedTrucks.length === 0) {
    state.commandUnits = [];
    state.selectedCommandUnitIds = [];
    state.selectedTruckIds = [];
    state.focusedCommandUnitId = null;
    state.commandUnitsRevision += 1;
    syncMirroredTruckSelection(state);
    return;
  }

  const nextGroupCount =
    deployedTrucks.length <= 1
      ? 1
      : Math.min(deployedTrucks.length, Math.max(2, Math.min(4, Math.ceil(deployedTrucks.length / 5))));
  const nextCommandUnits: CommandUnit[] = [];
  let cursor = 0;
  for (let groupIndex = 0; groupIndex < nextGroupCount; groupIndex += 1) {
    const remainingGroups = nextGroupCount - groupIndex;
    const remainingTrucks = deployedTrucks.length - cursor;
    const chunkSize = Math.max(1, Math.ceil(remainingTrucks / remainingGroups));
    const chunk = deployedTrucks.slice(cursor, cursor + chunkSize);
    cursor += chunkSize;
    const name = getCommandUnitName(groupIndex);
    const previous = previousByName.get(name)?.entry ?? null;
    nextCommandUnits.push({
      id: previous?.id ?? state.nextCommandUnitId++,
      name,
      truckIds: chunk.map((unit) => unit.id),
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
