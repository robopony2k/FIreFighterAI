export type RewardCategory = "mobility" | "suppression" | "range" | "logistics" | "economy";
export type RewardRarity = "standard" | "rare" | "elite";

export type RewardEffectTargetId =
  | "unit.speedMultiplier"
  | "unit.powerMultiplier"
  | "unit.hoseRangeMultiplier"
  | "truck.waterCapacityMultiplier"
  | "truck.waterRefillRateMultiplier"
  | "economy.firebreakCostMultiplier"
  | "economy.trainingCostMultiplier";

export type RewardEffectOperation = "add";

export interface RewardEffectSpec {
  targetId: RewardEffectTargetId;
  operation: RewardEffectOperation;
  baseValue: number;
  diminishingFactor: number;
  cap: number;
}

export interface RewardDefinition {
  id: string;
  name: string;
  description: string;
  category: RewardCategory;
  rarity: RewardRarity;
  icon: string;
  draftWeight: number;
  maxStacks: number;
  effects: RewardEffectSpec[];
}

export interface ProgressionDraft {
  ordinal: number;
  level: number;
  options: string[];
  openedAtExtinguishTotal: number;
}

export interface ResolvedProgressionModifiers {
  unitSpeedMultiplier: number;
  unitPowerMultiplier: number;
  unitHoseRangeMultiplier: number;
  truckWaterCapacityMultiplier: number;
  truckWaterRefillRateMultiplier: number;
  firebreakCostMultiplier: number;
  trainingCostMultiplier: number;
}

export interface ProgressionState {
  totalAssistedExtinguishes: number;
  level: number;
  nextDraftOrdinal: number;
  activeDraft: ProgressionDraft | null;
  queuedDraftOrdinals: number[];
  rewardStacks: Record<string, number>;
  resolved: ResolvedProgressionModifiers;
  revision: number;
}
