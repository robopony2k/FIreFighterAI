import type { WorldState } from "../core/state.js";
import { selectUnit } from "./units.js";

export const updatePhaseControls = (state: WorldState): void => {
  const fireActive = state.phase === "fire";
  const maintenanceActive = state.phase === "maintenance";
  if (!fireActive && (state.deployMode === "firefighter" || state.deployMode === "truck")) {
    state.deployMode = null;
  }
  if (!maintenanceActive && state.deployMode === "clear") {
    state.deployMode = null;
  }
  if (!fireActive) {
    selectUnit(state, null);
  }
};
