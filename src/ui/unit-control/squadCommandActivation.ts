import type { InputState } from "../../core/inputState.js";
import type { WorldState } from "../../core/state.js";
import { setStatus } from "../../core/state.js";
import {
  clearCommandSelection,
  ensureDefaultSquads,
  selectSquad
} from "../../systems/units/index.js";

export type SquadCommandActivation = "fielded" | "dispatch-ready" | "unavailable";

const hasAvailableSquadTruck = (state: WorldState, squadId: number): boolean => {
  const squad = state.squads.find((entry) => entry.id === squadId);
  if (!squad) {
    return false;
  }
  const rosterTruckIds = new Set(squad.truckRosterIds);
  return state.roster.some(
    (entry) => entry.kind === "truck" && entry.status === "available" && rosterTruckIds.has(entry.id)
  );
};

export const activateSquadForWorldCommand = (
  state: WorldState,
  inputState: InputState,
  squadId: number
): SquadCommandActivation => {
  ensureDefaultSquads(state);
  const squad = state.squads.find((entry) => entry.id === squadId) ?? null;
  if (!squad) {
    setStatus(state, "That squad slot is unavailable.");
    return "unavailable";
  }

  const commandUnit =
    state.commandUnits.find((entry) => entry.squadId === squad.id && entry.truckIds.length > 0) ?? null;
  if (commandUnit) {
    selectSquad(state, squad.id);
    inputState.pendingSquadDispatchId = null;
    state.deployMode = null;
    return "fielded";
  }

  if (!hasAvailableSquadTruck(state, squad.id)) {
    setStatus(state, `${squad.name} has no active trucks.`);
    return "unavailable";
  }

  clearCommandSelection(state);
  selectSquad(state, squad.id);
  inputState.pendingSquadDispatchId = squad.id;
  state.deployMode = null;
  setStatus(state, `${squad.name} ready at HQ. Right-click terrain to dispatch.`);
  return "dispatch-ready";
};

export const activateSquadCommandSlot = (
  state: WorldState,
  inputState: InputState,
  slotIndex: number
): SquadCommandActivation => {
  ensureDefaultSquads(state);
  const squad = state.squads[slotIndex] ?? null;
  if (!squad) {
    setStatus(state, `Squad slot ${slotIndex + 1} is unavailable.`);
    return "unavailable";
  }
  return activateSquadForWorldCommand(state, inputState, squad.id);
};
