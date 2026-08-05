import { clamp } from "../../../../core/utils.js";
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
