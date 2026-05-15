import {
  computeTreeSuitability,
  type TreeSuitabilityResult
} from "../../systems/terrain/sim/treeSuitability.js";
import type { MapGenContext } from "../pipeline/MapGenContext.js";

export const isFloodplainCandidate = (
  elevation: number,
  slope: number,
  valley: number,
  seaLevel: number
): boolean => valley > 0.08 && slope < 0.12 && elevation < seaLevel + 0.15;

export const computeBiomeSuitabilityValue = (input: {
  elevation: number;
  slope: number;
  moisture: number;
  valley: number;
  seaLevel: number;
  highlandForestElevation: number;
  seed?: number;
  x?: number;
  y?: number;
  worldX?: number;
  worldY?: number;
  cellSizeM?: number;
  waterDist?: number;
  vegetationDensity?: number;
  forestPatchiness?: number;
  isWater?: boolean;
}): number => computeBiomeSuitabilityDetails(input).treeSuitability;

export const computeBiomeSuitabilityDetails = (input: {
  elevation: number;
  slope: number;
  moisture: number;
  valley: number;
  seaLevel: number;
  highlandForestElevation: number;
  seed?: number;
  x?: number;
  y?: number;
  worldX?: number;
  worldY?: number;
  cellSizeM?: number;
  waterDist?: number;
  vegetationDensity?: number;
  forestPatchiness?: number;
  isWater?: boolean;
}): TreeSuitabilityResult =>
  computeTreeSuitability({
    seed: input.seed ?? 0,
    x: input.x ?? 0,
    y: input.y ?? 0,
    worldX: input.worldX ?? input.x ?? 0,
    worldY: input.worldY ?? input.y ?? 0,
    cellSizeM: input.cellSizeM ?? 10,
    elevation: input.elevation,
    slope: input.slope,
    moisture: input.moisture,
    valley: input.valley,
    seaLevel: input.seaLevel,
    waterDist: input.waterDist ?? 24,
    highlandForestElevation: input.highlandForestElevation,
    vegetationDensity: input.vegetationDensity ?? 0.56,
    forestPatchiness: input.forestPatchiness ?? 0.42,
    isWater: input.isWater
  });

export const computeTreePlacementHash = (seed: number, x: number, y: number): number => {
  let h = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (y + 0x7f4a7c15), 0xc2b2ae35);
  h ^= Math.imul(seed + 0x165667b1, 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967295;
};

export const buildBiomeSuitability = (ctx: MapGenContext): Float32Array => {
  const { state, settings, oceanMask, riverMask, slopeMap, moistureMap, seaLevelMap } = ctx;
  if (!oceanMask || !riverMask || !slopeMap || !moistureMap || !seaLevelMap) {
    throw new Error("Biome suitability requires ocean/rivers/slope/moisture/sea-level maps.");
  }

  const suitability = new Float32Array(state.grid.totalTiles);
  const elevationStress = new Float32Array(state.grid.totalTiles);
  const slopeStress = new Float32Array(state.grid.totalTiles);
  const treeSuitability = new Float32Array(state.grid.totalTiles);
  const treeProbability = new Float32Array(state.grid.totalTiles);
  const treeDensity = new Float32Array(state.grid.totalTiles);
  for (let i = 0; i < state.grid.totalTiles; i += 1) {
    if (oceanMask[i] || riverMask[i] > 0) {
      suitability[i] = 0;
      elevationStress[i] = 1;
      slopeStress[i] = 1;
      continue;
    }
    const tile = state.tiles[i];
    const x = i % state.grid.cols;
    const y = Math.floor(i / state.grid.cols);
    const elevation = tile?.elevation ?? 0;
    const slope = slopeMap[i] ?? 0;
    const moisture = moistureMap[i] ?? 0;
    const valley = state.valleyMap[i] ?? 0;
    const seaLevel = seaLevelMap[i] ?? 0;
    const details = computeBiomeSuitabilityDetails({
      elevation,
      slope,
      moisture,
      valley,
      seaLevel,
      highlandForestElevation: settings.highlandForestElevation,
      seed: state.seed,
      x,
      y,
      worldX: ctx.worldOffsetXM + x * ctx.cellSizeM,
      worldY: ctx.worldOffsetYM + y * ctx.cellSizeM,
      cellSizeM: ctx.cellSizeM,
      waterDist: tile?.waterDist ?? ctx.waterDistMap?.[i] ?? 24,
      vegetationDensity: settings.vegetationDensity,
      forestPatchiness: settings.forestPatchiness
    });
    suitability[i] = details.treeSuitability;
    elevationStress[i] = details.elevationStress;
    slopeStress[i] = details.slopeStress;
    treeSuitability[i] = details.treeSuitability;
    treeProbability[i] = details.treeProbability;
    treeDensity[i] = details.treeDensity;
  }
  ctx.elevationStressMap = elevationStress;
  ctx.slopeStressMap = slopeStress;
  ctx.treeSuitabilityMap = treeSuitability;
  ctx.treeProbabilityMap = treeProbability;
  ctx.treeDensityMap = treeDensity;
  return suitability;
};
