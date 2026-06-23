import { getTechNodeDefinitions } from "../../../config/progression/techTreeCatalog.js";
import type { ProgressionState } from "../types.js";
import type {
  ProgressionCapabilityId,
  TechNodeDefinition,
  TechTreeSnapshot
} from "../types/techTree.js";

export const PROGRESSION_CAPABILITIES: readonly ProgressionCapabilityId[] = [
  "runtime.minimap",
  "minimap.mode.terrain",
  "minimap.mode.topographic",
  "minimap.mode.moisture",
  "minimap.mode.thermal",
  "minimap.mode.satellite",
  "minimap.overlay.wind",
  "minimap.overlay.units",
  "climate.wind"
];

const normalizeRank = (rank: number | undefined): number =>
  Number.isFinite(rank) ? Math.max(0, Math.floor(rank ?? 0)) : 0;

export const getTechNodeRank = (nodeRanks: Readonly<Record<string, number>>, nodeId: string): number =>
  normalizeRank(nodeRanks[nodeId]);

export const areTechNodePrerequisitesMet = (
  definition: TechNodeDefinition,
  nodeRanks: Readonly<Record<string, number>>
): boolean =>
  definition.prerequisites.every(
    (prerequisite) => getTechNodeRank(nodeRanks, prerequisite.nodeId) >= prerequisite.minRank
  );

export const getEligibleTechNodeDefinitions = (
  nodeRanks: Readonly<Record<string, number>>,
  definitions: readonly TechNodeDefinition[] = getTechNodeDefinitions()
): TechNodeDefinition[] =>
  definitions.filter(
    (definition) =>
      getTechNodeRank(nodeRanks, definition.id) < definition.maxRanks &&
      areTechNodePrerequisitesMet(definition, nodeRanks)
  );

export const isTechTreeComplete = (
  nodeRanks: Readonly<Record<string, number>>,
  definitions: readonly TechNodeDefinition[] = getTechNodeDefinitions()
): boolean => definitions.every((definition) => getTechNodeRank(nodeRanks, definition.id) >= definition.maxRanks);

export const hasProgressionCapability = (
  progression: Pick<ProgressionState, "nodeRanks">,
  capability: ProgressionCapabilityId,
  definitions: readonly TechNodeDefinition[] = getTechNodeDefinitions()
): boolean =>
  definitions.some(
    (definition) =>
      definition.capabilities.includes(capability) && getTechNodeRank(progression.nodeRanks, definition.id) > 0
  );

export const buildTechTreeSnapshot = (
  progression: Pick<ProgressionState, "nodeRanks" | "activeDraft">,
  definitions: readonly TechNodeDefinition[] = getTechNodeDefinitions()
): TechTreeSnapshot => {
  const activeDraftNodeIds = progression.activeDraft?.options ?? [];
  const drafted = new Set(activeDraftNodeIds);
  return {
    nodes: definitions.map((definition) => {
      const rank = getTechNodeRank(progression.nodeRanks, definition.id);
      const prerequisitesMet = areTechNodePrerequisitesMet(definition, progression.nodeRanks);
      const status =
        rank >= definition.maxRanks
          ? "maxed"
          : drafted.has(definition.id)
            ? "drafted"
            : rank > 0
              ? "owned"
              : prerequisitesMet
                ? "eligible"
                : "locked";
      return { definition, rank, prerequisitesMet, status };
    }),
    activeDraftNodeIds: [...activeDraftNodeIds],
    complete: isTechTreeComplete(progression.nodeRanks, definitions)
  };
};

export const validateTechTreeDefinitions = (definitions: readonly TechNodeDefinition[]): void => {
  const definitionMap = new Map<string, TechNodeDefinition>();
  const knownCapabilities = new Set<ProgressionCapabilityId>(PROGRESSION_CAPABILITIES);
  const layoutPositions = new Set<string>();

  definitions.forEach((definition) => {
    if (!definition.id.trim()) {
      throw new Error("Tech tree node IDs must not be empty.");
    }
    if (definitionMap.has(definition.id)) {
      throw new Error(`Duplicate tech tree node ID: ${definition.id}`);
    }
    if (!Number.isInteger(definition.maxRanks) || definition.maxRanks < 1) {
      throw new Error(`Invalid maxRanks for tech tree node: ${definition.id}`);
    }
    if (!(definition.draftWeight > 0)) {
      throw new Error(`Invalid draftWeight for tech tree node: ${definition.id}`);
    }
    if (definition.layout.branch !== definition.branch) {
      throw new Error(`Layout branch does not match node branch: ${definition.id}`);
    }
    if (!Number.isInteger(definition.layout.tier) || definition.layout.tier < 0 || !Number.isInteger(definition.layout.order) || definition.layout.order < 0) {
      throw new Error(`Invalid layout position for tech tree node: ${definition.id}`);
    }
    const layoutPosition = `${definition.branch}:${definition.layout.tier}:${definition.layout.order}`;
    if (layoutPositions.has(layoutPosition)) {
      throw new Error(`Duplicate tech tree layout position: ${layoutPosition}`);
    }
    layoutPositions.add(layoutPosition);
    definition.capabilities.forEach((capability) => {
      if (!knownCapabilities.has(capability)) {
        throw new Error(`Unknown progression capability on ${definition.id}: ${capability}`);
      }
    });
    definitionMap.set(definition.id, definition);
  });

  definitions.forEach((definition) => {
    definition.prerequisites.forEach((prerequisite) => {
      const prerequisiteDefinition = definitionMap.get(prerequisite.nodeId);
      if (!prerequisiteDefinition) {
        throw new Error(`Unknown prerequisite ${prerequisite.nodeId} on ${definition.id}`);
      }
      if (!Number.isInteger(prerequisite.minRank) || prerequisite.minRank < 1 || prerequisite.minRank > prerequisiteDefinition.maxRanks) {
        throw new Error(`Invalid prerequisite rank for ${prerequisite.nodeId} on ${definition.id}`);
      }
    });
  });

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): void => {
    if (visiting.has(nodeId)) {
      throw new Error(`Tech tree prerequisite cycle detected at: ${nodeId}`);
    }
    if (visited.has(nodeId)) {
      return;
    }
    visiting.add(nodeId);
    const definition = definitionMap.get(nodeId);
    definition?.prerequisites.forEach((prerequisite) => visit(prerequisite.nodeId));
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  definitions.forEach((definition) => visit(definition.id));
};

validateTechTreeDefinitions(getTechNodeDefinitions());
