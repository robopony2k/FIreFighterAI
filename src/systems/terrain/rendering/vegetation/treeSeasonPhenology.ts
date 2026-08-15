import { TreeType } from "../../../../core/types.js";

export const TREE_LEAF_PRESENCE_MIN = 0.06;
export const TREE_SCRUB_DECIDUOUS_STRENGTH = 0.45;
export const TREE_LEAF_OUT_START = 0.25;
export const TREE_LEAF_OUT_END = 0.4;
export const TREE_LEAF_DROP_START = 0.72;
export const TREE_LEAF_DROP_END = 0.94;
export const TREE_LEAF_OUT_BIAS_SCALE = 0.08;
export const TREE_LEAF_DROP_BIAS_SCALE = 0.12;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const wrap01 = (value: number): number => ((value % 1) + 1) % 1;

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp01((value - edge0) / Math.max(0.0001, edge1 - edge0));
  return t * t * (3 - 2 * t);
};

export const getTreeDeciduousStrength = (treeType: TreeType): number => {
  if (treeType === TreeType.Pine) return 0;
  if (treeType === TreeType.Scrub) return TREE_SCRUB_DECIDUOUS_STRENGTH;
  return 1;
};

export const resolveTreeLeafPresence = (
  seasonT01: number,
  treeType: TreeType,
  leafDropBias = 0
): number => {
  const seasonT = wrap01(Number.isFinite(seasonT01) ? seasonT01 : 0);
  const safeBias = Number.isFinite(leafDropBias) ? leafDropBias : 0;
  const leafCycle =
    seasonT < 0.5
      ? smoothstep(
          TREE_LEAF_OUT_START + safeBias * TREE_LEAF_OUT_BIAS_SCALE,
          TREE_LEAF_OUT_END + safeBias * TREE_LEAF_OUT_BIAS_SCALE,
          seasonT
        )
      : 1 -
        smoothstep(
          TREE_LEAF_DROP_START + safeBias * TREE_LEAF_DROP_BIAS_SCALE,
          TREE_LEAF_DROP_END + safeBias * TREE_LEAF_DROP_BIAS_SCALE,
          seasonT
        );
  const deciduousStrength = getTreeDeciduousStrength(treeType);
  return Math.max(
    TREE_LEAF_PRESENCE_MIN,
    Math.min(1, 1 - deciduousStrength + leafCycle * deciduousStrength)
  );
};

export const treeSeasonPhenologyShader = /* glsl */ `
  float treeSeasonLeafCycle(float seasonT, float leafDropBias) {
    float wrappedSeasonT = fract(seasonT);
    if (wrappedSeasonT < 0.5) {
      float leafOutShift = leafDropBias * ${TREE_LEAF_OUT_BIAS_SCALE.toFixed(2)};
      return smoothstep(
        ${TREE_LEAF_OUT_START.toFixed(2)} + leafOutShift,
        ${TREE_LEAF_OUT_END.toFixed(2)} + leafOutShift,
        wrappedSeasonT
      );
    }
    float leafDropShift = leafDropBias * ${TREE_LEAF_DROP_BIAS_SCALE.toFixed(2)};
    return 1.0 - smoothstep(
      ${TREE_LEAF_DROP_START.toFixed(2)} + leafDropShift,
      ${TREE_LEAF_DROP_END.toFixed(2)} + leafDropShift,
      wrappedSeasonT
    );
  }

  float treeSeasonLeafPresence(float seasonT, float leafDropBias, float deciduousStrength) {
    float leafCycle = treeSeasonLeafCycle(seasonT, leafDropBias);
    return clamp(
      mix(1.0, leafCycle, clamp(deciduousStrength, 0.0, 1.0)),
      ${TREE_LEAF_PRESENCE_MIN.toFixed(2)},
      1.0
    );
  }
`;
