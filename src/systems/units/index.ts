export {
  assignRosterCrew,
  unassignRosterCrew,
  seedStartingRoster,
  recruitUnit,
  trainSelectedUnit,
  getTrainingCostForState,
  syncProgressionUnitStats
} from "./controllers/rosterController.js";

export {
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
  clearUnitSelection,
  selectUnit,
  toggleUnitSelection,
  getSelectedUnits
} from "./controllers/commandSelectionController.js";

export { setUnitDeployMode, createUnit, setUnitTarget, deployUnit, getUnitAt } from "./sim/unitDeployment.js";
export { setTruckCrewMode, setCrewFormation } from "./sim/crewRuntime.js";
export { autoAssignTargets } from "./sim/commandRuntime.js";
export { stepUnits, assignFormationTargets } from "./sim/unitMovement.js";
export { applyUnitHazards, recallUnits } from "./sim/unitHazards.js";
export { prepareExtinguish, applyExtinguishStep, applyExtinguish } from "./sim/unitSuppression.js";
