import type { CommandIntent, CommandUnit, Unit } from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";
import { resetStatus, setStatus } from "../../../core/state.js";
import { cloneCommandIntent } from "../utils/commandIntent.js";
import { syncMirroredTruckSelection } from "../sim/commandUnits.js";
import { getCommandUnitById, getUnitById } from "../utils/unitLookup.js";

const setSelectionStatus = (state: WorldState): void => {
  if (state.selectionScope === "truck") {
    if (state.selectedTruckIds.length > 0) {
      setStatus(state, `${state.selectedTruckIds.length} truck(s) selected. Right-click to issue orders.`);
    } else {
      resetStatus(state);
    }
    return;
  }
  if (state.selectedCommandUnitIds.length > 0) {
    const label =
      state.selectedCommandUnitIds.length === 1
        ? getCommandUnitById(state, state.selectedCommandUnitIds[0]!)?.name ?? "Command unit"
        : `${state.selectedCommandUnitIds.length} command units`;
    setStatus(state, `${label} selected. Right-click to issue orders.`);
  } else {
    resetStatus(state);
  }
};

export const clearCommandSelection = (state: WorldState): void => {
  state.selectedCommandUnitIds = [];
  state.selectedTruckIds = [];
  state.focusedCommandUnitId = null;
  state.selectionScope = "commandUnit";
  syncMirroredTruckSelection(state);
  resetStatus(state);
};

export const selectCommandUnit = (
  state: WorldState,
  commandUnitId: number | null,
  options?: { append?: boolean; toggle?: boolean }
): void => {
  if (commandUnitId === null) {
    clearCommandSelection(state);
    return;
  }
  const commandUnit = getCommandUnitById(state, commandUnitId);
  if (!commandUnit) {
    return;
  }
  state.selectionScope = "commandUnit";
  if (options?.toggle) {
    if (state.selectedCommandUnitIds.includes(commandUnitId)) {
      state.selectedCommandUnitIds = state.selectedCommandUnitIds.filter((id) => id !== commandUnitId);
    } else {
      state.selectedCommandUnitIds = [...state.selectedCommandUnitIds, commandUnitId];
    }
  } else if (options?.append) {
    if (!state.selectedCommandUnitIds.includes(commandUnitId)) {
      state.selectedCommandUnitIds = [...state.selectedCommandUnitIds, commandUnitId];
    }
  } else {
    state.selectedCommandUnitIds = [commandUnitId];
  }
  state.selectedTruckIds = [];
  state.focusedCommandUnitId = commandUnitId;
  syncMirroredTruckSelection(state);
  setSelectionStatus(state);
};

export const selectTruck = (
  state: WorldState,
  truck: Unit | null,
  options?: { append?: boolean; toggle?: boolean }
): void => {
  if (!truck || truck.kind !== "truck") {
    clearCommandSelection(state);
    return;
  }
  state.selectionScope = "truck";
  if (options?.toggle) {
    if (state.selectedTruckIds.includes(truck.id)) {
      state.selectedTruckIds = state.selectedTruckIds.filter((id) => id !== truck.id);
    } else {
      state.selectedTruckIds = [...state.selectedTruckIds, truck.id];
    }
  } else if (options?.append) {
    if (!state.selectedTruckIds.includes(truck.id)) {
      state.selectedTruckIds = [...state.selectedTruckIds, truck.id];
    }
  } else {
    state.selectedTruckIds = [truck.id];
  }
  state.selectedCommandUnitIds = [];
  state.focusedCommandUnitId = truck.commandUnitId;
  syncMirroredTruckSelection(state);
  setSelectionStatus(state);
};

export const returnToFocusedCommandUnitSelection = (state: WorldState): void => {
  if (state.selectionScope !== "truck") {
    return;
  }
  const focusedCommandUnitId =
    state.focusedCommandUnitId ??
    (state.selectedTruckIds.length > 0 ? getUnitById(state, state.selectedTruckIds[0]!)?.commandUnitId ?? null : null);
  state.selectionScope = "commandUnit";
  state.selectedTruckIds = [];
  state.selectedCommandUnitIds = focusedCommandUnitId !== null ? [focusedCommandUnitId] : [];
  state.focusedCommandUnitId = focusedCommandUnitId;
  syncMirroredTruckSelection(state);
  setSelectionStatus(state);
};

export const getSelectedTrucks = (state: WorldState): Unit[] =>
  state.units.filter((unit) => unit.kind === "truck" && state.selectedUnitIds.includes(unit.id));

export const getSelectedCommandUnits = (state: WorldState): CommandUnit[] =>
  state.commandUnits.filter((entry) => state.selectedCommandUnitIds.includes(entry.id));

export const clearTruckOverrideIntents = (state: WorldState, truckIds?: number[]): void => {
  const clearSet = truckIds ? new Set(truckIds) : null;
  state.units.forEach((unit) => {
    if (unit.kind !== "truck") {
      return;
    }
    if (clearSet && !clearSet.has(unit.id)) {
      return;
    }
    unit.truckOverrideIntent = null;
  });
};

export const clearSelectedTruckOverrides = (state: WorldState): void => {
  if (state.selectedTruckIds.length === 0) {
    return;
  }
  clearTruckOverrideIntents(state, state.selectedTruckIds);
  setStatus(state, "Selected trucks rejoined their command unit.");
};

export const applyCommandIntentToSelection = (state: WorldState, intent: CommandIntent): void => {
  if (state.selectionScope === "truck") {
    const selectedTrucks = getSelectedTrucks(state);
    selectedTrucks.forEach((truck) => {
      truck.truckOverrideIntent = cloneCommandIntent(intent);
    });
    if (selectedTrucks.length > 0) {
      setStatus(state, `${selectedTrucks.length} truck(s) assigned ${intent.type} orders.`);
    }
    return;
  }
  const selectedCommandUnits = getSelectedCommandUnits(state);
  selectedCommandUnits.forEach((commandUnit) => {
    commandUnit.currentIntent = cloneCommandIntent(intent);
    commandUnit.revision += 1;
  });
  clearTruckOverrideIntents(
    state,
    selectedCommandUnits.flatMap((commandUnit) => commandUnit.truckIds)
  );
  if (selectedCommandUnits.length > 0) {
    const label = selectedCommandUnits.length === 1 ? selectedCommandUnits[0]!.name : `${selectedCommandUnits.length} command units`;
    setStatus(state, `${label} assigned ${intent.type} orders.`);
  }
};

export function clearUnitSelection(state: WorldState): void {
  clearCommandSelection(state);
}

export function selectUnit(state: WorldState, unit: Unit | null): void {
  if (!unit) {
    clearCommandSelection(state);
    return;
  }
  if (unit.kind === "firefighter" && unit.assignedTruckId !== null) {
    const assignedTruck = getUnitById(state, unit.assignedTruckId);
    if (assignedTruck) {
      selectCommandUnit(state, assignedTruck.commandUnitId);
      return;
    }
  }
  if (unit.kind === "truck") {
    selectCommandUnit(state, unit.commandUnitId);
    return;
  }
  clearCommandSelection(state);
}

export function toggleUnitSelection(state: WorldState, unit: Unit): void {
  if (unit.kind === "firefighter" && unit.assignedTruckId !== null) {
    const assignedTruck = getUnitById(state, unit.assignedTruckId);
    if (assignedTruck) {
      selectCommandUnit(state, assignedTruck.commandUnitId, { toggle: true });
    }
    return;
  }
  if (unit.kind === "truck") {
    selectCommandUnit(state, unit.commandUnitId, { toggle: true });
  }
}

export function getSelectedUnits(state: WorldState): Unit[] {
  return getSelectedTrucks(state);
}
