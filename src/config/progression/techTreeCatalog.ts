import type { TechNodeDefinition } from "../../systems/progression/types/techTree.js";

export const TECH_TREE_NODE_DEFINITIONS: readonly TechNodeDefinition[] = [
  {
    id: "field-mapping",
    name: "Field Mapping",
    description: "Deploy a terrain minimap with camera panning support.",
    icon: "map",
    branch: "awareness",
    rarity: "standard",
    draftWeight: 1.15,
    maxRanks: 1,
    prerequisites: [],
    capabilities: ["runtime.minimap", "minimap.mode.terrain"],
    effects: [],
    layout: { branch: "awareness", tier: 0, order: 0 }
  },
  {
    id: "weather-instruments",
    name: "Weather Instruments",
    description: "Reveal wind direction, speed, and local wind-map detail.",
    icon: "wind",
    branch: "awareness",
    rarity: "standard",
    draftWeight: 1.1,
    maxRanks: 1,
    prerequisites: [],
    capabilities: ["climate.wind", "minimap.overlay.wind"],
    effects: [],
    layout: { branch: "awareness", tier: 0, order: 1 }
  },
  {
    id: "topographic-survey",
    name: "Topographic Survey",
    description: "Add a contour-focused topographic minimap mode.",
    icon: "topo",
    branch: "awareness",
    rarity: "standard",
    draftWeight: 1,
    maxRanks: 1,
    prerequisites: [{ nodeId: "field-mapping", minRank: 1 }],
    capabilities: ["minimap.mode.topographic"],
    effects: [],
    layout: { branch: "awareness", tier: 1, order: 0 }
  },
  {
    id: "moisture-analysis",
    name: "Moisture Analysis",
    description: "Add a live terrain-moisture minimap mode.",
    icon: "moisture",
    branch: "awareness",
    rarity: "rare",
    draftWeight: 0.95,
    maxRanks: 1,
    prerequisites: [{ nodeId: "topographic-survey", minRank: 1 }],
    capabilities: ["minimap.mode.moisture"],
    effects: [],
    layout: { branch: "awareness", tier: 2, order: 0 }
  },
  {
    id: "thermal-imaging",
    name: "Thermal Imaging",
    description: "Add a live heat minimap mode for active fire intelligence.",
    icon: "heat",
    branch: "awareness",
    rarity: "elite",
    draftWeight: 0.85,
    maxRanks: 1,
    prerequisites: [{ nodeId: "moisture-analysis", minRank: 1 }],
    capabilities: ["minimap.mode.thermal"],
    effects: [],
    layout: { branch: "awareness", tier: 3, order: 0 }
  },
  {
    id: "dispatch-tracking",
    name: "Dispatch Tracking",
    description: "Show response-unit markers on analytical minimaps.",
    icon: "dispatch",
    branch: "awareness",
    rarity: "rare",
    draftWeight: 0.95,
    maxRanks: 1,
    prerequisites: [
      { nodeId: "field-mapping", minRank: 1 },
      { nodeId: "rapid-response", minRank: 1 }
    ],
    capabilities: ["minimap.overlay.units"],
    effects: [],
    layout: { branch: "awareness", tier: 2, order: 1 }
  },
  {
    id: "aerial-reconnaissance",
    name: "Aerial Reconnaissance",
    description: "Unlock the cached 3D Satellite reconnaissance view.",
    icon: "recon",
    branch: "awareness",
    rarity: "elite",
    draftWeight: 0.8,
    maxRanks: 1,
    prerequisites: [
      { nodeId: "field-mapping", minRank: 1 },
      { nodeId: "air-support", minRank: 1 }
    ],
    capabilities: ["minimap.mode.satellite"],
    effects: [],
    layout: { branch: "awareness", tier: 3, order: 1 }
  },
  {
    id: "rapid-response",
    name: "Rapid Response",
    description: "Command units mobilize faster across the map.",
    icon: "speed",
    branch: "operations",
    rarity: "standard",
    draftWeight: 1,
    maxRanks: 5,
    prerequisites: [],
    capabilities: [],
    effects: [
      { targetId: "unit.speedMultiplier", operation: "add", baseValue: 0.12, diminishingFactor: 0.7, cap: 0.45 }
    ],
    layout: { branch: "operations", tier: 0, order: 0 }
  },
  {
    id: "fireline-training",
    name: "Fireline Training",
    description: "Crew suppression output improves without changing core tactics.",
    icon: "foam",
    branch: "operations",
    rarity: "standard",
    draftWeight: 1,
    maxRanks: 5,
    prerequisites: [],
    capabilities: [],
    effects: [
      { targetId: "unit.powerMultiplier", operation: "add", baseValue: 0.14, diminishingFactor: 0.7, cap: 0.5 }
    ],
    layout: { branch: "operations", tier: 0, order: 1 }
  },
  {
    id: "extended-lines",
    name: "Extended Lines",
    description: "Improved hose reach lets crews work farther from the road edge.",
    icon: "range",
    branch: "operations",
    rarity: "rare",
    draftWeight: 0.95,
    maxRanks: 5,
    prerequisites: [{ nodeId: "fireline-training", minRank: 1 }],
    capabilities: [],
    effects: [
      { targetId: "unit.hoseRangeMultiplier", operation: "add", baseValue: 0.11, diminishingFactor: 0.7, cap: 0.38 }
    ],
    layout: { branch: "operations", tier: 1, order: 1 }
  },
  {
    id: "air-support",
    name: "Air Support",
    description: "Better spot guidance sharpens suppression and extends working angles.",
    icon: "wing",
    branch: "operations",
    rarity: "elite",
    draftWeight: 0.85,
    maxRanks: 4,
    prerequisites: [
      { nodeId: "fireline-training", minRank: 2 },
      { nodeId: "extended-lines", minRank: 1 }
    ],
    capabilities: [],
    effects: [
      { targetId: "unit.powerMultiplier", operation: "add", baseValue: 0.08, diminishingFactor: 0.7, cap: 0.24 },
      { targetId: "unit.hoseRangeMultiplier", operation: "add", baseValue: 0.06, diminishingFactor: 0.7, cap: 0.18 }
    ],
    layout: { branch: "operations", tier: 2, order: 1 }
  },
  {
    id: "quick-connects",
    name: "Quick Connects",
    description: "Refill hookups and pump handling reduce downtime at water sources.",
    icon: "refill",
    branch: "logistics",
    rarity: "standard",
    draftWeight: 0.95,
    maxRanks: 5,
    prerequisites: [],
    capabilities: [],
    effects: [
      { targetId: "truck.waterRefillRateMultiplier", operation: "add", baseValue: 0.12, diminishingFactor: 0.7, cap: 0.42 }
    ],
    layout: { branch: "logistics", tier: 0, order: 0 }
  },
  {
    id: "tender-upfit",
    name: "Tender Upfit",
    description: "Truck reservoirs are expanded for longer suppression runs.",
    icon: "tank",
    branch: "logistics",
    rarity: "rare",
    draftWeight: 0.95,
    maxRanks: 4,
    prerequisites: [{ nodeId: "quick-connects", minRank: 1 }],
    capabilities: [],
    effects: [
      { targetId: "truck.waterCapacityMultiplier", operation: "add", baseValue: 0.18, diminishingFactor: 0.7, cap: 0.6 }
    ],
    layout: { branch: "logistics", tier: 1, order: 0 }
  },
  {
    id: "academy-subsidy",
    name: "Academy Subsidy",
    description: "Training contracts lower the cost of improving crews.",
    icon: "academy",
    branch: "policy",
    rarity: "rare",
    draftWeight: 0.9,
    maxRanks: 4,
    prerequisites: [],
    capabilities: [],
    effects: [
      { targetId: "economy.trainingCostMultiplier", operation: "add", baseValue: -0.08, diminishingFactor: 0.7, cap: 0.28 }
    ],
    layout: { branch: "policy", tier: 0, order: 0 }
  },
  {
    id: "fuel-break-grants",
    name: "Fuel Break Grants",
    description: "Outside funding reduces the budget burden of cutting breaks.",
    icon: "break",
    branch: "policy",
    rarity: "rare",
    draftWeight: 0.9,
    maxRanks: 4,
    prerequisites: [],
    capabilities: [],
    effects: [
      { targetId: "economy.firebreakCostMultiplier", operation: "add", baseValue: -0.08, diminishingFactor: 0.7, cap: 0.28 }
    ],
    layout: { branch: "policy", tier: 0, order: 1 }
  }
];

const techNodeDefinitionMap = new Map(TECH_TREE_NODE_DEFINITIONS.map((definition) => [definition.id, definition] as const));

export const getTechNodeDefinitions = (): readonly TechNodeDefinition[] => TECH_TREE_NODE_DEFINITIONS;

export const getTechNodeDefinition = (id: string): TechNodeDefinition => {
  const definition = techNodeDefinitionMap.get(id);
  if (!definition) {
    throw new Error(`Unknown tech tree node: ${id}`);
  }
  return definition;
};
