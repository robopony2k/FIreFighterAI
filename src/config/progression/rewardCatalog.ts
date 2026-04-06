import type { RewardDefinition } from "../../systems/progression/types.js";

export const COMMAND_REWARD_DEFINITIONS: RewardDefinition[] = [
  {
    id: "rapid-response",
    name: "Rapid Response",
    description: "Command units mobilize faster across the map.",
    category: "mobility",
    rarity: "standard",
    icon: "speed",
    draftWeight: 1,
    maxStacks: 5,
    effects: [
      {
        targetId: "unit.speedMultiplier",
        operation: "add",
        baseValue: 0.12,
        diminishingFactor: 0.7,
        cap: 0.45
      }
    ]
  },
  {
    id: "fireline-training",
    name: "Fireline Training",
    description: "Crew suppression output improves without changing core tactics.",
    category: "suppression",
    rarity: "standard",
    icon: "foam",
    draftWeight: 1,
    maxStacks: 5,
    effects: [
      {
        targetId: "unit.powerMultiplier",
        operation: "add",
        baseValue: 0.14,
        diminishingFactor: 0.7,
        cap: 0.5
      }
    ]
  },
  {
    id: "extended-lines",
    name: "Extended Lines",
    description: "Improved hose reach lets crews work a little farther off the edge.",
    category: "range",
    rarity: "rare",
    icon: "range",
    draftWeight: 0.95,
    maxStacks: 5,
    effects: [
      {
        targetId: "unit.hoseRangeMultiplier",
        operation: "add",
        baseValue: 0.11,
        diminishingFactor: 0.7,
        cap: 0.38
      }
    ]
  },
  {
    id: "tender-upfit",
    name: "Tender Upfit",
    description: "Truck reservoirs are expanded for longer suppression runs.",
    category: "logistics",
    rarity: "rare",
    icon: "tank",
    draftWeight: 0.95,
    maxStacks: 4,
    effects: [
      {
        targetId: "truck.waterCapacityMultiplier",
        operation: "add",
        baseValue: 0.18,
        diminishingFactor: 0.7,
        cap: 0.6
      }
    ]
  },
  {
    id: "quick-connects",
    name: "Quick Connects",
    description: "Refill hookups and pump handling reduce downtime at water sources.",
    category: "logistics",
    rarity: "standard",
    icon: "refill",
    draftWeight: 0.95,
    maxStacks: 5,
    effects: [
      {
        targetId: "truck.waterRefillRateMultiplier",
        operation: "add",
        baseValue: 0.12,
        diminishingFactor: 0.7,
        cap: 0.42
      }
    ]
  },
  {
    id: "fuel-break-grants",
    name: "Fuel Break Grants",
    description: "Outside funding reduces the budget burden of cutting breaks.",
    category: "economy",
    rarity: "rare",
    icon: "break",
    draftWeight: 0.9,
    maxStacks: 4,
    effects: [
      {
        targetId: "economy.firebreakCostMultiplier",
        operation: "add",
        baseValue: -0.08,
        diminishingFactor: 0.7,
        cap: 0.28
      }
    ]
  },
  {
    id: "academy-subsidy",
    name: "Academy Subsidy",
    description: "Training contracts lower the cost of improving crews.",
    category: "economy",
    rarity: "rare",
    icon: "academy",
    draftWeight: 0.9,
    maxStacks: 4,
    effects: [
      {
        targetId: "economy.trainingCostMultiplier",
        operation: "add",
        baseValue: -0.08,
        diminishingFactor: 0.7,
        cap: 0.28
      }
    ]
  },
  {
    id: "air-support",
    name: "Air Support",
    description: "Better spot guidance sharpens suppression and extends working angles.",
    category: "suppression",
    rarity: "elite",
    icon: "wing",
    draftWeight: 0.85,
    maxStacks: 4,
    effects: [
      {
        targetId: "unit.powerMultiplier",
        operation: "add",
        baseValue: 0.08,
        diminishingFactor: 0.7,
        cap: 0.24
      },
      {
        targetId: "unit.hoseRangeMultiplier",
        operation: "add",
        baseValue: 0.06,
        diminishingFactor: 0.7,
        cap: 0.18
      }
    ]
  }
];

const rewardDefinitionMap = new Map(COMMAND_REWARD_DEFINITIONS.map((definition) => [definition.id, definition] as const));

export const getCommandRewardDefinitions = (): readonly RewardDefinition[] => COMMAND_REWARD_DEFINITIONS;

export const getCommandRewardDefinition = (id: string): RewardDefinition => {
  const definition = rewardDefinitionMap.get(id);
  if (!definition) {
    throw new Error(`Unknown command reward definition: ${id}`);
  }
  return definition;
};
