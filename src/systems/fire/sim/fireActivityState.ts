import type { FireActivityState, WorldState } from "../../../core/state.js";

export type FireActivityMetrics = {
  fireActivityState: FireActivityState;
  fireActivityCount: number;
};

export const resolveFireActivityState = (lastActiveFires: number): FireActivityState =>
  lastActiveFires > 0 ? "burning" : "idle";

export const applyFireActivityMetrics = (
  state: Pick<WorldState, "fireActivityState" | "fireActivityCount">,
  lastActiveFires: number
): FireActivityMetrics => {
  const clampedActive = Math.max(0, Math.floor(lastActiveFires));
  const metrics = {
    fireActivityState: resolveFireActivityState(clampedActive),
    fireActivityCount: clampedActive
  };
  state.fireActivityState = metrics.fireActivityState;
  state.fireActivityCount = metrics.fireActivityCount;
  return metrics;
};
