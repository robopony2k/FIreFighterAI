import { getEligibleTechNodeDefinitions } from "./sim/techTree.js";
import { getTechNodeDefinition } from "../../config/progression/techTreeCatalog.js";
import { RNG } from "../../core/rng.js";
import type { TechTreeBranch } from "./types/techTree.js";

const mixDraftSeed = (worldSeed: number, draftOrdinal: number): number => {
  let hash = (worldSeed ^ Math.imul((draftOrdinal + 1) | 0, 0x9e3779b9)) >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b) >>> 0;
  hash ^= hash >>> 16;
  return hash >>> 0;
};

const sumBranchRanks = (nodeRanks: Record<string, number>): Map<TechTreeBranch, number> => {
  const counts = new Map<TechTreeBranch, number>();
  Object.entries(nodeRanks).forEach(([nodeId, rank]) => {
    const resolvedRank = Math.max(0, Math.floor(rank));
    if (resolvedRank <= 0) {
      return;
    }
    const definition = getTechNodeDefinition(nodeId);
    counts.set(definition.branch, (counts.get(definition.branch) ?? 0) + resolvedRank);
  });
  return counts;
};

const pickWeightedRewardIndex = (weights: number[], rng: RNG): number => {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (!(totalWeight > 0)) {
    return 0;
  }
  let target = rng.next() * totalWeight;
  for (let index = 0; index < weights.length; index += 1) {
    target -= weights[index] ?? 0;
    if (target <= 0) {
      return index;
    }
  }
  return Math.max(0, weights.length - 1);
};

export const buildProgressionDraftOptions = (
  worldSeed: number,
  draftOrdinal: number,
  nodeRanks: Record<string, number>,
  count = 3
): string[] => {
  const rng = new RNG(mixDraftSeed(worldSeed, draftOrdinal));
  const ownedBranchRanks = sumBranchRanks(nodeRanks);
  const selectedBranchCounts = new Map<TechTreeBranch, number>();
  const pool = getEligibleTechNodeDefinitions(nodeRanks);
  const options: string[] = [];

  while (pool.length > 0 && options.length < count) {
    const weights = pool.map((definition) => {
      const rank = Math.max(0, Math.floor(nodeRanks[definition.id] ?? 0));
      const ownedBranchRank = ownedBranchRanks.get(definition.branch) ?? 0;
      const selectedBranchCount = selectedBranchCounts.get(definition.branch) ?? 0;
      const rankPenalty = 1 / (1 + rank * 0.45);
      const ownedBranchPenalty = 1 / (1 + ownedBranchRank * 0.18);
      const selectedBranchPenalty = 1 / (1 + selectedBranchCount * 1.75);
      return Math.max(0.0001, definition.draftWeight * rankPenalty * ownedBranchPenalty * selectedBranchPenalty);
    });
    const pickedIndex = pickWeightedRewardIndex(weights, rng);
    const [picked] = pool.splice(pickedIndex, 1);
    if (!picked) {
      break;
    }
    options.push(picked.id);
    selectedBranchCounts.set(picked.branch, (selectedBranchCounts.get(picked.branch) ?? 0) + 1);
  }

  return options;
};
