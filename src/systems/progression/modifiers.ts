import { getCommandRewardDefinitions } from "../../config/progression/rewardCatalog.js";
import { clamp } from "../../core/utils.js";
import { createResolvedProgressionModifiers } from "./state.js";
import type { ResolvedProgressionModifiers, RewardEffectSpec, RewardEffectTargetId } from "./types.js";

type RewardDeltaAccumulator = Record<RewardEffectTargetId, number>;

const createRewardDeltaAccumulator = (): RewardDeltaAccumulator => ({
  "unit.speedMultiplier": 0,
  "unit.powerMultiplier": 0,
  "unit.hoseRangeMultiplier": 0,
  "truck.waterCapacityMultiplier": 0,
  "truck.waterRefillRateMultiplier": 0,
  "economy.firebreakCostMultiplier": 0,
  "economy.trainingCostMultiplier": 0
});

const applyEffectStack = (accumulator: RewardDeltaAccumulator, effect: RewardEffectSpec, stackIndex: number): void => {
  if (effect.operation !== "add") {
    throw new Error(`Unsupported progression effect operation: ${effect.operation}`);
  }
  const currentValue = accumulator[effect.targetId];
  if (currentValue === undefined) {
    throw new Error(`Unknown progression effect target: ${effect.targetId}`);
  }
  const appliedValue = effect.baseValue * Math.pow(effect.diminishingFactor, stackIndex);
  const nextValue = currentValue + appliedValue;
  accumulator[effect.targetId] =
    effect.baseValue >= 0 ? clamp(nextValue, 0, effect.cap) : clamp(nextValue, -effect.cap, 0);
};

export const resolveProgressionModifiers = (rewardStacks: Record<string, number>): ResolvedProgressionModifiers => {
  const deltas = createRewardDeltaAccumulator();
  for (const definition of getCommandRewardDefinitions()) {
    const stackCount = Math.max(0, Math.floor(rewardStacks[definition.id] ?? 0));
    if (stackCount <= 0) {
      continue;
    }
    for (let stackIndex = 0; stackIndex < stackCount; stackIndex += 1) {
      definition.effects.forEach((effect) => applyEffectStack(deltas, effect, stackIndex));
    }
  }

  const resolved = createResolvedProgressionModifiers();
  resolved.unitSpeedMultiplier = clamp(1 + deltas["unit.speedMultiplier"], 0.1, 10);
  resolved.unitPowerMultiplier = clamp(1 + deltas["unit.powerMultiplier"], 0.1, 10);
  resolved.unitHoseRangeMultiplier = clamp(1 + deltas["unit.hoseRangeMultiplier"], 0.1, 10);
  resolved.truckWaterCapacityMultiplier = clamp(1 + deltas["truck.waterCapacityMultiplier"], 0.1, 10);
  resolved.truckWaterRefillRateMultiplier = clamp(1 + deltas["truck.waterRefillRateMultiplier"], 0.1, 10);
  resolved.firebreakCostMultiplier = clamp(1 + deltas["economy.firebreakCostMultiplier"], 0.1, 10);
  resolved.trainingCostMultiplier = clamp(1 + deltas["economy.trainingCostMultiplier"], 0.1, 10);
  return resolved;
};
