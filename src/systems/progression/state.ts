import type { ProgressionState, ResolvedProgressionModifiers } from "./types.js";

export const createResolvedProgressionModifiers = (): ResolvedProgressionModifiers => ({
  unitSpeedMultiplier: 1,
  unitPowerMultiplier: 1,
  unitHoseRangeMultiplier: 1,
  truckWaterCapacityMultiplier: 1,
  truckWaterRefillRateMultiplier: 1,
  firebreakCostMultiplier: 1,
  trainingCostMultiplier: 1
});

export const createProgressionState = (): ProgressionState => ({
  totalAssistedExtinguishes: 0,
  level: 0,
  nextDraftOrdinal: 1,
  activeDraft: null,
  queuedDraftOrdinals: [],
  rewardStacks: {},
  resolved: createResolvedProgressionModifiers(),
  revision: 0
});

