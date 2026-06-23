export type TechTreeBranch = "awareness" | "operations" | "logistics" | "policy";
export type TechNodeRarity = "standard" | "rare" | "elite";

export type ProgressionCapabilityId =
  | "runtime.minimap"
  | "minimap.mode.terrain"
  | "minimap.mode.topographic"
  | "minimap.mode.moisture"
  | "minimap.mode.thermal"
  | "minimap.mode.satellite"
  | "minimap.overlay.wind"
  | "minimap.overlay.units"
  | "climate.wind";

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

export interface TechNodePrerequisite {
  nodeId: string;
  minRank: number;
}

export interface TechNodeLayout {
  branch: TechTreeBranch;
  tier: number;
  order: number;
}

export interface TechNodeDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  branch: TechTreeBranch;
  rarity: TechNodeRarity;
  draftWeight: number;
  maxRanks: number;
  prerequisites: readonly TechNodePrerequisite[];
  capabilities: readonly ProgressionCapabilityId[];
  effects: readonly RewardEffectSpec[];
  layout: TechNodeLayout;
}

export type TechTreeNodeStatus = "locked" | "eligible" | "drafted" | "owned" | "maxed";

export interface TechTreeNodeSnapshot {
  definition: TechNodeDefinition;
  rank: number;
  prerequisitesMet: boolean;
  status: TechTreeNodeStatus;
}

export interface TechTreeSnapshot {
  nodes: TechTreeNodeSnapshot[];
  activeDraftNodeIds: string[];
  complete: boolean;
}
