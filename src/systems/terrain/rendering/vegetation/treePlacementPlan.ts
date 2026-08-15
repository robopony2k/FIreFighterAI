import { clamp } from "../../../../core/utils.js";
import { getVegetationMaturity01 } from "../../../../core/vegetation.js";
import { vegetationHash2D } from "../../utils/vegetationSeedHash.js";

const BLUE_NOISE_TEMPLATE = [
  { x: -0.31, y: -0.18 },
  { x: 0.27, y: -0.29 },
  { x: 0.08, y: 0.32 },
  { x: -0.35, y: 0.27 },
  { x: 0.36, y: 0.12 },
  { x: -0.05, y: -0.02 },
  { x: 0.2, y: 0.36 }
] as const;

export type TreeDensityGradient = { x: number; y: number };
export type TreePlacementVegetationType = "forest" | "scrub" | "floodplain" | "grass";
export type ForestTreeCohort = "sapling" | "mid" | "mature";

export const resolveForestTreeCohort = (seed01: number): { cohort: ForestTreeCohort; scale: number } => {
  const seed = clamp(seed01, 0, 1);
  if (seed < 0.2) {
    return { cohort: "sapling", scale: 0.35 + (seed / 0.2) * 0.2 };
  }
  if (seed < 0.55) {
    return { cohort: "mid", scale: 0.65 + ((seed - 0.2) / 0.35) * 0.2 };
  }
  return { cohort: "mature", scale: 0.9 + ((seed - 0.55) / 0.45) * 0.2 };
};

export const resolveTreeBudgetPriority = (
  basePriority: number,
  type: TreePlacementVegetationType,
  maturity01: number,
  canopyCover: number
): number => {
  const maturityPenalty = (1 - clamp(maturity01, 0, 1)) * 0.22;
  const canopyPenalty = (1 - clamp(canopyCover, 0, 1)) * 0.12;
  const typePenalty = type === "forest" ? 0 : type === "floodplain" ? 0.12 : type === "scrub" ? 0.2 : 0.3;
  return clamp(basePriority + maturityPenalty + canopyPenalty + typePenalty, 0, 1);
};

export const getTallTreeAttemptWeight = (type: TreePlacementVegetationType): number => {
  switch (type) {
    case "forest":
      return 0.68;
    case "scrub":
      return 0.1;
    case "floodplain":
      return 0.18;
    case "grass":
      return 0;
  }
};

export const computeTreeDensityGradient = (
  density: ArrayLike<number> | undefined,
  cols: number,
  rows: number,
  x: number,
  y: number
): TreeDensityGradient => {
  if (!density) return { x: 0, y: 0 };
  const at = (sx: number, sy: number): number =>
    density[Math.max(0, Math.min(rows - 1, sy)) * cols + Math.max(0, Math.min(cols - 1, sx))] ?? 0;
  const dx = at(x + 1, y) - at(x - 1, y);
  const dy = at(x, y + 1) - at(x, y - 1);
  const length = Math.hypot(dx, dy);
  return length > 1e-6 ? { x: dx / length, y: dy / length } : { x: 0, y: 0 };
};

export const resolveTreeCandidateOffset = (input: {
  worldSeed: number;
  tileX: number;
  tileY: number;
  attempt: number;
  jitterRange: number;
  densityGradient: TreeDensityGradient;
}): { x: number; y: number; priority: number } => {
  const rotation = vegetationHash2D(input.tileX, input.tileY, input.worldSeed + 41_711) * Math.PI * 2;
  const templateOffset = Math.floor(
    vegetationHash2D(input.tileX, input.tileY, input.worldSeed + 41_723) * BLUE_NOISE_TEMPLATE.length
  );
  const point = BLUE_NOISE_TEMPLATE[(templateOffset + input.attempt) % BLUE_NOISE_TEMPLATE.length] ?? BLUE_NOISE_TEMPLATE[0];
  const reflected = vegetationHash2D(input.tileX, input.tileY, input.worldSeed + 41_737) < 0.5 ? -1 : 1;
  const px = point.x * reflected;
  const py = point.y;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const inwardPull = Math.min(0.14, input.jitterRange * 0.22);
  return {
    x: clamp((px * cos - py * sin) * input.jitterRange + input.densityGradient.x * inwardPull, -input.jitterRange, input.jitterRange),
    y: clamp((px * sin + py * cos) * input.jitterRange + input.densityGradient.y * inwardPull, -input.jitterRange, input.jitterRange),
    priority: vegetationHash2D(
      input.tileX + input.attempt * 17,
      input.tileY - input.attempt * 13,
      input.worldSeed + 41_759
    )
  };
};

export const computeTreeBudgetScale = (estimatedCandidates: number, instanceBudget: number): number =>
  Number.isFinite(instanceBudget) && estimatedCandidates > instanceBudget
    ? clamp((instanceBudget * 0.96) / Math.max(1, estimatedCandidates), 0, 1)
    : 1;

export type TreeCoverageCandidate = {
  tileIndex: number;
  tileX: number;
  tileY: number;
  attempt: number;
  vegetationType: TreePlacementVegetationType;
  maturity01: number;
  canopyCover: number;
  offsetX: number;
  offsetY: number;
  priority: number;
  requiredForestCoverage: boolean;
};

export type FullResolutionTreeCoveragePlan = {
  modelCandidates: TreeCoverageCandidate[];
  fallbackCandidates: TreeCoverageCandidate[];
  eligibleForestTiles: number;
  modelCoveredForestTiles: number;
  modelCoveredScrubTiles: number;
  fallbackCoveredForestTiles: number;
  uncoveredForestTiles: number;
};

export type FullResolutionTreeCoverageInput = {
  cols: number;
  rows: number;
  worldSeed: number;
  tileTypes: ArrayLike<number>;
  tileVegetationAge?: ArrayLike<number>;
  tileCanopyCover?: ArrayLike<number>;
  tileStemDensity?: ArrayLike<number>;
  occludedMask?: ArrayLike<number>;
  forestId: number;
  scrubId: number;
  floodplainId: number;
  grassId: number;
  densityScale: number;
  attemptCap: number;
  modelInstanceBudget: number;
  nativeScrubModelReserve?: number;
};

const visualNoiseAt = (value: number): number => {
  const sample = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
  return sample - Math.floor(sample);
};

export const shouldPlaceScrubCoverage = (
  tileIndex: number,
  densityScale: number,
  canopyCover: number
): boolean => {
  const coverageChance = Math.min(
    0.68,
    0.42 * densityScale * (0.45 + clamp(canopyCover, 0, 1) * 0.9)
  );
  return visualNoiseAt(tileIndex + 14.39) < coverageChance;
};

const compareCoverageCandidates = (left: TreeCoverageCandidate, right: TreeCoverageCandidate): number =>
  left.priority - right.priority || left.tileIndex - right.tileIndex || left.attempt - right.attempt;

const resolveVegetationType = (
  typeId: number,
  input: Pick<FullResolutionTreeCoverageInput, "forestId" | "scrubId" | "floodplainId" | "grassId">
): TreePlacementVegetationType | null => {
  if (typeId === input.forestId) return "forest";
  if (typeId === input.scrubId) return "scrub";
  if (typeId === input.floodplainId) return "floodplain";
  if (typeId === input.grassId) return "grass";
  return null;
};

export const buildFullResolutionTreeCoveragePlan = (
  input: FullResolutionTreeCoverageInput
): FullResolutionTreeCoveragePlan => {
  const cols = Math.max(0, Math.floor(input.cols));
  const rows = Math.max(0, Math.floor(input.rows));
  const totalTiles = Math.min(input.tileTypes.length, cols * rows);
  const modelBudget = Number.isFinite(input.modelInstanceBudget)
    ? Math.max(0, Math.floor(input.modelInstanceBudget))
    : Number.MAX_SAFE_INTEGER;
  const nativeScrubModelReserve = Number.isFinite(input.nativeScrubModelReserve)
    ? Math.min(modelBudget, Math.max(0, Math.floor(input.nativeScrubModelReserve ?? 0)))
    : 0;
  const attemptLimit = Math.max(1, Math.floor(input.attemptCap) * 2 + 1);
  const requiredForest: TreeCoverageCandidate[] = [];
  const scrubCoverage: TreeCoverageCandidate[] = [];
  const optional: TreeCoverageCandidate[] = [];

  for (let tileIndex = 0; tileIndex < totalTiles; tileIndex += 1) {
    const vegetationType = resolveVegetationType(input.tileTypes[tileIndex] ?? -1, input);
    if (!vegetationType || input.occludedMask?.[tileIndex]) continue;
    const tileX = tileIndex % cols;
    const tileY = Math.floor(tileIndex / cols);
    const canopyCover = clamp(input.tileCanopyCover?.[tileIndex] ?? 0, 0, 1);
    const stemDensity = Math.max(0, input.tileStemDensity?.[tileIndex] ?? 0);
    const ageYears = Math.max(0, input.tileVegetationAge?.[tileIndex] ?? 0);
    const maturity01 = getVegetationMaturity01(vegetationType, ageYears);
    const attemptWeight = getTallTreeAttemptWeight(vegetationType);
    const rawCount = stemDensity * attemptWeight * input.densityScale * (0.4 + canopyCover * 0.8);
    let attempts = Math.min(attemptLimit, Math.floor(rawCount));
    const fractionalCount = rawCount - Math.floor(rawCount);
    if (
      attempts < attemptLimit &&
      vegetationHash2D(tileX, tileY, input.worldSeed + 41_791) < fractionalCount
    ) {
      attempts += 1;
    }
    if (vegetationType === "forest") {
      attempts = Math.max(1, attempts);
    }
    const requiresScrubCoverage =
      vegetationType === "scrub" &&
      shouldPlaceScrubCoverage(tileIndex, input.densityScale, canopyCover);
    if (requiresScrubCoverage) {
      attempts = Math.max(1, attempts);
    }
    if (attempts <= 0) continue;

    const densityGradient = computeTreeDensityGradient(
      input.tileStemDensity,
      cols,
      rows,
      tileX,
      tileY
    );
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const offset = resolveTreeCandidateOffset({
        worldSeed: input.worldSeed,
        tileX,
        tileY,
        attempt,
        jitterRange: 0.42,
        densityGradient
      });
      const candidate: TreeCoverageCandidate = {
        tileIndex,
        tileX,
        tileY,
        attempt,
        vegetationType,
        maturity01,
        canopyCover,
        offsetX: offset.x,
        offsetY: offset.y,
        priority: resolveTreeBudgetPriority(offset.priority, vegetationType, maturity01, canopyCover),
        requiredForestCoverage: vegetationType === "forest" && attempt === 0
      };
      if (candidate.requiredForestCoverage) requiredForest.push(candidate);
      else if (requiresScrubCoverage && attempt === 0) scrubCoverage.push(candidate);
      else optional.push(candidate);
    }
  }

  requiredForest.sort(compareCoverageCandidates);
  scrubCoverage.sort(compareCoverageCandidates);
  optional.sort(compareCoverageCandidates);
  const reservedScrubCandidates = scrubCoverage.slice(0, nativeScrubModelReserve);
  const forestModelCapacity = Math.max(0, modelBudget - reservedScrubCandidates.length);
  const modelCandidates = [
    ...reservedScrubCandidates,
    ...requiredForest.slice(0, forestModelCapacity)
  ];
  const fallbackCandidates = requiredForest.slice(forestModelCapacity);
  const optionalCapacity = Math.max(0, modelBudget - modelCandidates.length);
  modelCandidates.push(...optional.slice(0, optionalCapacity));
  modelCandidates.sort((left, right) => left.tileIndex - right.tileIndex || left.attempt - right.attempt);
  fallbackCandidates.sort((left, right) => left.tileIndex - right.tileIndex);

  const eligibleForestTiles = requiredForest.length;
  const modelCoveredForestTiles = Math.min(requiredForest.length, forestModelCapacity);
  const fallbackCoveredForestTiles = fallbackCandidates.length;
  return {
    modelCandidates,
    fallbackCandidates,
    eligibleForestTiles,
    modelCoveredForestTiles,
    modelCoveredScrubTiles: reservedScrubCandidates.length,
    fallbackCoveredForestTiles,
    uncoveredForestTiles: Math.max(
      0,
      eligibleForestTiles - modelCoveredForestTiles - fallbackCoveredForestTiles
    )
  };
};
