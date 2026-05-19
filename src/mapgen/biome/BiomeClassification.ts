import type { TileType } from "../../core/types.js";
import { clamp } from "../../core/utils.js";
import {
  computeShrubSlopeSuitability,
  computeTreeSlopeSuitability
} from "../../systems/terrain/sim/treeSuitability.js";
import { isFloodplainCandidate } from "./BiomeSuitability.js";

export type BiomeLocalContext = {
  relativeHeight: number;
  localRelief: number;
  ridgeScore: number;
  gullyScore: number;
  waterfallDrop: number;
  waterfallExposureScore: number;
};

export type BiomeLocalContextInput = {
  elevationMap: ArrayLike<number>;
  cols: number;
  rows: number;
  x: number;
  y: number;
  oceanMask?: ArrayLike<number> | null;
  riverMask?: ArrayLike<number> | null;
  lakeMask?: ArrayLike<number> | null;
  waterfallDropMap?: ArrayLike<number> | null;
  waterfallTargetMap?: ArrayLike<number> | null;
};

export type TileClassificationInput = {
  elevation: number;
  slope: number;
  waterDistM: number;
  valley: number;
  moisture: number;
  forestNoise: number;
  seaLevel: number;
  forestThreshold: number;
  highlandForestElevation: number;
  localContext?: BiomeLocalContext;
  seededNoiseOffset?: number;
  slopeAngleDeg?: number;
};

export type SeedSpreadClassificationInput = {
  elevation: number;
  slope: number;
  waterDistM: number;
  valley: number;
  moisture: number;
  seaLevel: number;
  highlandForestElevation: number;
  forestCandidate: boolean;
  localContext?: BiomeLocalContext;
  seededNoiseOffset?: number;
  slopeAngleDeg?: number;
};

type BiomeScores = {
  elevationScore: number;
  moistureScore: number;
  slopeScore: number;
  steepScore: number;
  drynessScore: number;
  exposureScore: number;
  cliffScore: number;
  hardSteepScore: number;
  localReliefScore: number;
  slopeAngleDeg: number;
  treeSlopeSuitability: number;
  shrubSlopeSuitability: number;
};

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  if (Math.abs(edge1 - edge0) < 1e-6) {
    return value < edge0 ? 0 : 1;
  }
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

const defaultLocalContext: BiomeLocalContext = {
  relativeHeight: 0,
  localRelief: 0,
  ridgeScore: 0,
  gullyScore: 0,
  waterfallDrop: 0,
  waterfallExposureScore: 0
};

export const buildLocalBiomeContext = (input: BiomeLocalContextInput): BiomeLocalContext => {
  const { elevationMap, cols, rows, x, y, oceanMask, riverMask, lakeMask, waterfallDropMap, waterfallTargetMap } = input;
  const idx = y * cols + x;
  const center = elevationMap[idx] ?? 0;
  let neighborCount = 0;
  let neighborSum = 0;
  let minElevation = center;
  let maxElevation = center;
  let waterfallDrop = Math.max(0, waterfallDropMap?.[idx] ?? 0);

  for (let dy = -1; dy <= 1; dy += 1) {
    const ny = y + dy;
    if (ny < 0 || ny >= rows) {
      continue;
    }
    for (let dx = -1; dx <= 1; dx += 1) {
      const nx = x + dx;
      if (nx < 0 || nx >= cols || (dx === 0 && dy === 0)) {
        continue;
      }
      const nIdx = ny * cols + nx;
      if ((oceanMask?.[nIdx] ?? 0) > 0 || (riverMask?.[nIdx] ?? 0) > 0 || (lakeMask?.[nIdx] ?? 0) > 0) {
        continue;
      }
      const neighbor = elevationMap[nIdx] ?? center;
      neighborSum += neighbor;
      neighborCount += 1;
      minElevation = Math.min(minElevation, neighbor);
      maxElevation = Math.max(maxElevation, neighbor);
      const neighborDrop = Math.max(0, waterfallDropMap?.[nIdx] ?? 0);
      if (neighborDrop > 0 && ((waterfallTargetMap?.[nIdx] ?? -1) === idx || Math.abs(dx) + Math.abs(dy) <= 1)) {
        waterfallDrop = Math.max(waterfallDrop, neighborDrop * 0.84);
      }
    }
  }

  if (neighborCount === 0) {
    return defaultLocalContext;
  }

  const neighborAverage = neighborSum / neighborCount;
  const relativeHeight = center - neighborAverage;
  const localRelief = Math.max(maxElevation, center) - Math.min(minElevation, center);
  return {
    relativeHeight,
    localRelief,
    ridgeScore: smoothstep(0.006, 0.045, relativeHeight),
    gullyScore: smoothstep(0.006, 0.045, -relativeHeight),
    waterfallDrop,
    waterfallExposureScore: smoothstep(0.012, 0.04, waterfallDrop)
  };
};

const computeBiomeScores = (input: {
  elevation: number;
  slope: number;
  waterDistM: number;
  valley: number;
  moisture: number;
  seaLevel: number;
  localContext?: BiomeLocalContext;
  seededNoiseOffset?: number;
  slopeAngleDeg?: number;
}): BiomeScores => {
  const context = input.localContext ?? defaultLocalContext;
  const slopeAngleDeg = Math.max(0, input.slopeAngleDeg ?? (Math.atan(Math.max(0, input.slope)) * 180) / Math.PI);
  const treeSlopeSuitability = computeTreeSlopeSuitability(slopeAngleDeg);
  const shrubSlopeSuitability = computeShrubSlopeSuitability(slopeAngleDeg);
  const headroom = Math.max(0, input.elevation - input.seaLevel);
  const elevationScore = smoothstep(0.12, 0.58, headroom);
  const slopeScore = smoothstep(0.055, 0.22, input.slope);
  const steepScore = smoothstep(0.11, 0.24, input.slope);
  const cliffScore = smoothstep(0.16, 0.3, input.slope);
  const hardSteepScore = smoothstep(0.18, 0.32, input.slope);
  const runoffDryingScore = smoothstep(0.08, 0.26, input.slope);
  const localReliefScore = smoothstep(0.018, 0.09, context.localRelief);
  const nearWaterScore = smoothstep(260, 20, input.waterDistM);
  const valleyWetScore = smoothstep(0.04, 0.24, input.valley);
  const seededNoise = clamp(input.seededNoiseOffset ?? 0, -0.5, 0.5);

  const effectiveMoisture = clamp(
    input.moisture +
      nearWaterScore * 0.18 +
      valleyWetScore * 0.12 +
      context.gullyScore * 0.1 -
      context.ridgeScore * 0.08 -
      runoffDryingScore * 0.22 -
      cliffScore * 0.12 +
      seededNoise * 0.07,
    0,
    1
  );
  const moistureScore = smoothstep(0.18, 0.68, effectiveMoisture);
  const drynessScore = clamp(
    1 - effectiveMoisture + elevationScore * 0.06 + context.ridgeScore * 0.08 + slopeScore * 0.04,
    0,
    1
  );
  const exposureScore = clamp(
    steepScore * 0.42 +
      cliffScore * 0.3 +
      hardSteepScore * 0.18 +
      drynessScore * 0.18 +
      context.ridgeScore * 0.14 +
      localReliefScore * 0.16 +
      elevationScore * 0.08 -
      nearWaterScore * 0.08 -
      context.gullyScore * 0.1 +
      context.waterfallExposureScore * 0.05,
    0,
    1
  );

  return {
    elevationScore,
    moistureScore,
    slopeScore,
    steepScore,
    drynessScore,
    exposureScore,
    cliffScore,
    hardSteepScore,
    localReliefScore,
    slopeAngleDeg,
    treeSlopeSuitability,
    shrubSlopeSuitability
  };
};

const isWetShelteredSlope = (scores: BiomeScores, context: BiomeLocalContext): boolean =>
  scores.moistureScore > 0.78 &&
  context.gullyScore > 0.55 &&
  scores.cliffScore < 0.84 &&
  context.localRelief < 0.13;

const isForestBlockedBySlope = (
  scores: BiomeScores,
  context: BiomeLocalContext,
  elevation: number,
  seaLevel: number
): boolean => {
  const headroom = Math.max(0, elevation - seaLevel);
  if (headroom <= 0.06) {
    return false;
  }
  if (scores.hardSteepScore > 0.82) {
    return true;
  }
  if (scores.slopeAngleDeg >= 45) {
    return true;
  }
  if (isWetShelteredSlope(scores, context)) {
    return false;
  }
  return (
    scores.treeSlopeSuitability < 0.3 ||
    scores.hardSteepScore > 0.38 ||
    (scores.localReliefScore > 0.82 && (scores.exposureScore > 0.34 || scores.drynessScore > 0.28)) ||
    (scores.steepScore > 0.58 && (scores.localReliefScore > 0.32 || scores.exposureScore > 0.52))
  );
};

const classifyOpenTerrain = (
  scores: BiomeScores,
  context: BiomeLocalContext,
  elevation: number,
  seaLevel: number
): TileType => {
  const headroom = Math.max(0, elevation - seaLevel);
  const dryThresholdOffset = (0.5 - scores.drynessScore) * 0.08;
  const wetShelteredSlope = isWetShelteredSlope(scores, context);
  if (!wetShelteredSlope && scores.hardSteepScore > 0.58 && headroom > 0.08) {
    return "rocky";
  }
  if (!wetShelteredSlope && scores.slopeAngleDeg >= 55 && headroom > 0.08) {
    return "rocky";
  }
  if (
    !wetShelteredSlope &&
    scores.localReliefScore > 0.78 &&
    (scores.drynessScore > 0.26 || scores.elevationScore > 0.5 || context.ridgeScore > 0.34) &&
    headroom > 0.08
  ) {
    return "rocky";
  }
  if (
    !wetShelteredSlope &&
    scores.steepScore > 0.62 &&
    (scores.localReliefScore > 0.32 || scores.exposureScore > 0.5 || scores.drynessScore > 0.34) &&
    headroom > 0.09
  ) {
    return "rocky";
  }
  if (
    !wetShelteredSlope &&
    scores.cliffScore > 0.5 &&
    scores.slopeScore > 0.46 &&
    headroom > 0.08
  ) {
    return "rocky";
  }
  if (
    !wetShelteredSlope &&
    scores.slopeScore > 0.56 &&
    scores.drynessScore > 0.46 &&
    headroom > 0.1
  ) {
    return scores.cliffScore > 0.32 || context.localRelief > 0.035 ? "rocky" : "bare";
  }
  if (
    scores.exposureScore > 0.62 + dryThresholdOffset &&
    scores.slopeScore > 0.52 &&
    scores.drynessScore > 0.42 &&
    headroom > 0.12
  ) {
    return "rocky";
  }
  if (
    scores.exposureScore > 0.56 &&
    scores.drynessScore > 0.72 &&
    scores.slopeScore > 0.26 &&
    headroom > 0.16
  ) {
    return "bare";
  }
  if (scores.shrubSlopeSuitability < 0.18 && headroom > 0.08) {
    return scores.drynessScore > 0.48 || scores.localReliefScore > 0.55 ? "rocky" : "bare";
  }
  if (
    scores.shrubSlopeSuitability < 0.46 &&
    !(scores.moistureScore > 0.72 && context.gullyScore > 0.45 && scores.exposureScore < 0.58)
  ) {
    return scores.drynessScore > 0.46 || scores.exposureScore > 0.5 ? "rocky" : "bare";
  }
  if (
    scores.moistureScore > 0.34 ||
    scores.elevationScore > 0.56 ||
    scores.slopeScore > 0.42 ||
    context.ridgeScore > 0.45
  ) {
    return "scrub";
  }
  return "grass";
};

export function classifyTile(input: TileClassificationInput): TileType {
  const {
    elevation,
    slope,
    waterDistM,
    valley,
    moisture,
    forestNoise,
    seaLevel,
    forestThreshold,
    highlandForestElevation
  } = input;
  if (elevation < seaLevel) {
    return "water";
  }
  if (waterDistM <= 15 && slope < 0.15) {
    return "beach";
  }
  if (isFloodplainCandidate(elevation, slope, valley, seaLevel)) {
    return "floodplain";
  }

  const context = input.localContext ?? defaultLocalContext;
  const scores = computeBiomeScores(input);
  const slopeBlocksForest = isForestBlockedBySlope(scores, context, elevation, seaLevel);
  const forestElevationLimit =
    highlandForestElevation +
    Math.max(0, scores.moistureScore - 0.5) * 0.18 +
    context.gullyScore * 0.1 -
    context.ridgeScore * 0.06;
  if (
    !slopeBlocksForest &&
    elevation <= forestElevationLimit &&
    scores.moistureScore > 0.48 &&
    scores.exposureScore < 0.68 &&
    scores.treeSlopeSuitability > 0.34 &&
    scores.slopeScore < 0.58 &&
    forestNoise > forestThreshold
  ) {
    return "forest";
  }

  return classifyOpenTerrain(scores, context, elevation, seaLevel);
}

export const classifySeedSpreadTile = (input: SeedSpreadClassificationInput): TileType => {
  const { elevation, slope, waterDistM, valley, moisture, seaLevel, forestCandidate } = input;
  if (elevation < seaLevel) {
    return "water";
  }
  if (waterDistM <= 15 && slope < 0.15) {
    return "beach";
  }
  if (isFloodplainCandidate(elevation, slope, valley, seaLevel)) {
    return "floodplain";
  }

  const context = input.localContext ?? defaultLocalContext;
  const scores = computeBiomeScores(input);
  const slopeBlocksForest = isForestBlockedBySlope(scores, context, elevation, seaLevel);
  if (
    forestCandidate &&
    !slopeBlocksForest &&
    scores.moistureScore > 0.4 &&
    scores.exposureScore < 0.7 &&
    scores.treeSlopeSuitability > 0.22 &&
    scores.slopeScore < 0.62
  ) {
    return "forest";
  }

  return classifyOpenTerrain(scores, context, elevation, seaLevel);
};
