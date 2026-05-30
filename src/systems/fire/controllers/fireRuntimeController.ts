import type { WorldState } from "../../../core/state.js";
import type { RuntimeWorkBudget } from "../types/fireRuntimeTypes.js";

const STRATEGIC_FIRE_SUBSTEP_BUDGET = 32;
const INCIDENT_FIRE_SUBSTEP_BUDGET = 12;
const IDLE_FIRE_SUBSTEP_BUDGET = 64;
const STRATEGIC_FIRE_DELTA_BUDGET_SECONDS = 4;
const INCIDENT_FIRE_DELTA_BUDGET_SECONDS = 1;

export const hasDeferredFireRuntimeWork = (state: Pick<WorldState, "fireSimAccumulator">): boolean =>
  state.fireSimAccumulator > 0.0001;

export const resolveRuntimeWorkBudget = (
  state: Pick<WorldState, "simTimeMode" | "fireActivityState" | "fireBoundsActive" | "fireSimAccumulator">,
  requestedFireDeltaSeconds: number
): RuntimeWorkBudget => {
  const pendingDelta = Math.max(0, requestedFireDeltaSeconds + Math.max(0, state.fireSimAccumulator));
  const hasActiveFireWork =
    state.fireActivityState !== "idle" || state.fireBoundsActive || hasDeferredFireRuntimeWork(state);
  const maxFireSubsteps =
    state.simTimeMode === "incident"
      ? INCIDENT_FIRE_SUBSTEP_BUDGET
      : hasActiveFireWork
        ? STRATEGIC_FIRE_SUBSTEP_BUDGET
        : IDLE_FIRE_SUBSTEP_BUDGET;
  const maxFireDeltaSeconds =
    state.simTimeMode === "incident"
      ? Math.min(pendingDelta, INCIDENT_FIRE_DELTA_BUDGET_SECONDS)
      : hasActiveFireWork
        ? Math.min(pendingDelta, STRATEGIC_FIRE_DELTA_BUDGET_SECONDS)
        : pendingDelta;

  return {
    maxFireSubsteps,
    maxFireDeltaSeconds,
    deferredFireDeltaSeconds: Math.max(0, pendingDelta - maxFireDeltaSeconds)
  };
};
