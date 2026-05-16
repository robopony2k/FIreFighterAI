import type { UnitKind } from "../core/types.js";
import type { WorldState } from "../core/state.js";
import { formatCurrency } from "../core/utils.js";
import { setStatus } from "../core/state.js";
import { setUnitDeployMode } from "../systems/units/index.js";
import { getFirebreakCostForState } from "../systems/firebreaks/index.js";

export {
  assignRosterCrew,
  unassignRosterCrew,
  syncCommandUnits,
  clearCommandSelection,
  selectCommandUnit,
  selectTruck,
  returnToFocusedCommandUnitSelection,
  getSelectedTrucks,
  getSelectedCommandUnits,
  clearTruckOverrideIntents,
  clearSelectedTruckOverrides,
  applyCommandIntentToSelection,
  getEffectiveTruckIntent,
  seedStartingRoster,
  recruitUnit,
  trainSelectedUnit,
  getTrainingCostForState,
  syncProgressionUnitStats,
  clearUnitSelection,
  selectUnit,
  toggleUnitSelection,
  getSelectedUnits,
  createUnit,
  setUnitTarget,
  deployUnit,
  getUnitAt,
  stepUnits,
  setTruckCrewMode,
  setCrewFormation,
  autoAssignTargets,
  assignFormationTargets,
  applyUnitHazards,
  recallUnits,
  prepareExtinguish,
  applyExtinguishStep,
  applyExtinguish
} from "../systems/units/index.js";

export { clearFuelAt, clearFuelLine, getFirebreakCostForState } from "../systems/firebreaks/index.js";

export function setDeployMode(state: WorldState, mode: UnitKind | "clear" | null, options?: { silent?: boolean }): void {
  state.deployMode = mode;
  if (options?.silent) {
    return;
  }
  if (mode === "clear") {
    setStatus(state, `Clear fuel breaks for ${formatCurrency(getFirebreakCostForState(state))} per tile.`);
    return;
  }
  setUnitDeployMode(state, mode, options);
}
