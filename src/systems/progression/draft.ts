import { getCommandRewardDefinition, getCommandRewardDefinitions } from "../../config/progression/rewardCatalog.js";
import { RNG } from "../../core/rng.js";
import type { RewardCategory } from "./types.js";

const mixDraftSeed = (worldSeed: number, draftOrdinal: number): number => {
  let hash = (worldSeed ^ Math.imul((draftOrdinal + 1) | 0, 0x9e3779b9)) >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b) >>> 0;
  hash ^= hash >>> 16;
  return hash >>> 0;
};

const sumCategoryStacks = (rewardStacks: Record<string, number>): Map<RewardCategory, number> => {
  const counts = new Map<RewardCategory, number>();
  Object.entries(rewardStacks).forEach(([rewardId, stackCount]) => {
    const resolvedStackCount = Math.max(0, Math.floor(stackCount));
    if (resolvedStackCount <= 0) {
      return;
    }
    const category = getCommandRewardDefinition(rewardId).category;
    counts.set(category, (counts.get(category) ?? 0) + resolvedStackCount);
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
  rewardStacks: Record<string, number>,
  count = 3
): string[] => {
  const rng = new RNG(mixDraftSeed(worldSeed, draftOrdinal));
  const ownedCategoryStacks = sumCategoryStacks(rewardStacks);
  const selectedCategoryCounts = new Map<RewardCategory, number>();
  const pool = getCommandRewardDefinitions().filter((definition) => {
    const stackCount = Math.max(0, Math.floor(rewardStacks[definition.id] ?? 0));
    return stackCount < definition.maxStacks;
  });
  const options: string[] = [];

  while (pool.length > 0 && options.length < count) {
    const weights = pool.map((definition) => {
      const stackCount = Math.max(0, Math.floor(rewardStacks[definition.id] ?? 0));
      const ownedCategoryCount = ownedCategoryStacks.get(definition.category) ?? 0;
      const selectedCategoryCount = selectedCategoryCounts.get(definition.category) ?? 0;
      const stackPenalty = 1 / (1 + stackCount * 0.45);
      const ownedCategoryPenalty = 1 / (1 + ownedCategoryCount * 0.18);
      const selectedCategoryPenalty = 1 / (1 + selectedCategoryCount * 1.75);
      return Math.max(0.0001, definition.draftWeight * stackPenalty * ownedCategoryPenalty * selectedCategoryPenalty);
    });
    const pickedIndex = pickWeightedRewardIndex(weights, rng);
    const [picked] = pool.splice(pickedIndex, 1);
    if (!picked) {
      break;
    }
    options.push(picked.id);
    selectedCategoryCounts.set(picked.category, (selectedCategoryCounts.get(picked.category) ?? 0) + 1);
  }

  return options;
};

