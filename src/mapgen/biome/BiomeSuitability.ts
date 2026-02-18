import { clamp } from "../../core/utils.js";
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
}): number => {
  const { elevation, slope, moisture, valley, seaLevel, highlandForestElevation } = input;
  const slopeTerm = 1 - clamp(slope / 0.45, 0, 1);
  const elevCenter = clamp(highlandForestElevation - 0.16, 0.38, 0.62);
  const elevTerm = 1 - clamp(Math.abs(elevation - elevCenter) / 0.36, 0, 1);
  let suitability = clamp(0.66 * moisture + 0.22 * slopeTerm + 0.12 * elevTerm, 0, 1);

  if (slope > 0.45) {
    suitability = 0;
  }
  if (elevation > seaLevel + 0.35 && moisture < 0.25) {
    suitability = 0;
  }
  if (isFloodplainCandidate(elevation, slope, valley, seaLevel)) {
    suitability *= 0.55;
  }
  return clamp(suitability, 0, 1);
};

export const buildBiomeSuitability = (ctx: MapGenContext): Float32Array => {
  const { state, settings, oceanMask, riverMask, slopeMap, moistureMap, seaLevelMap } = ctx;
  if (!oceanMask || !riverMask || !slopeMap || !moistureMap || !seaLevelMap) {
    throw new Error("Biome suitability requires ocean/rivers/slope/moisture/sea-level maps.");
  }

  const suitability = new Float32Array(state.grid.totalTiles);
  for (let i = 0; i < state.grid.totalTiles; i += 1) {
    if (oceanMask[i] || riverMask[i] > 0) {
      suitability[i] = 0;
      continue;
    }
    const tile = state.tiles[i];
    const elevation = tile?.elevation ?? 0;
    const slope = slopeMap[i] ?? 0;
    const moisture = moistureMap[i] ?? 0;
    const valley = state.valleyMap[i] ?? 0;
    const seaLevel = seaLevelMap[i] ?? 0;
    suitability[i] = computeBiomeSuitabilityValue({
      elevation,
      slope,
      moisture,
      valley,
      seaLevel,
      highlandForestElevation: settings.highlandForestElevation
    });
  }
  return suitability;
};

