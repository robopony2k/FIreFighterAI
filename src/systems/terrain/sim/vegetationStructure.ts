import type { TileType } from "../../../core/types.js";
import { clamp } from "../../../core/utils.js";
import {
  getCanopyCoverForVegetationAge,
  getStemDensityForVegetation
} from "../../../core/vegetation.js";
import { VEGETATION_DISTRIBUTION_TUNING } from "../constants/vegetationDistributionTuning.js";

export const getVegetationSiteMultiplier = (siteQuality: number): number =>
  VEGETATION_DISTRIBUTION_TUNING.siteQualityMinMultiplier +
  clamp(siteQuality, 0, 1) *
    (VEGETATION_DISTRIBUTION_TUNING.siteQualityMaxMultiplier -
      VEGETATION_DISTRIBUTION_TUNING.siteQualityMinMultiplier);

export const getTerrainResponsiveVegetationStructure = (input: {
  worldSeed: number;
  type: TileType;
  ageYears: number;
  x: number;
  y: number;
  siteQuality: number;
}): { canopyCover: number; stemDensity: number } => {
  const baseCanopy = getCanopyCoverForVegetationAge(input.type, input.ageYears);
  const multiplier = getVegetationSiteMultiplier(input.siteQuality);
  const canopyCover = clamp(baseCanopy * multiplier, 0, input.type === "forest" ? 0.96 : 0.56);
  const baseStemDensity = getStemDensityForVegetation(
    input.worldSeed,
    input.type,
    input.ageYears,
    input.x,
    input.y
  );
  const stemCap = input.type === "forest" ? 12 : 3;
  return {
    canopyCover,
    stemDensity: Math.round(clamp(baseStemDensity * multiplier, 0, stemCap))
  };
};
