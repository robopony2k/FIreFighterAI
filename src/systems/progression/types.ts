export type {
  ProgressionCapabilityId,
  RewardEffectOperation,
  RewardEffectSpec,
  RewardEffectTargetId,
  TechNodeDefinition,
  TechNodeLayout,
  TechNodePrerequisite,
  TechNodeRarity,
  TechTreeBranch,
  TechTreeNodeSnapshot,
  TechTreeNodeStatus,
  TechTreeSnapshot
} from "./types/techTree.js";

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
  truckHoseSlotBonus: number;
  firebreakCostMultiplier: number;
  trainingCostMultiplier: number;
}

export interface ProgressionState {
  totalAssistedExtinguishes: number;
  level: number;
  nextDraftOrdinal: number;
  activeDraft: ProgressionDraft | null;
  queuedDraftOrdinals: number[];
  nodeRanks: Record<string, number>;
  resolved: ResolvedProgressionModifiers;
  revision: number;
}
