import type { Tile, TileType, TreeType } from "./types.js";
import { TreeType as TreeTypeEnum } from "./types.js";
import { clamp } from "./utils.js";

export const FOREST_AGE_CAP_YEARS = 40;
export const SCRUB_AGE_CAP_YEARS = 12;
export const OPEN_WOODY_AGE_CAP_YEARS = 6;
export const FOREST_RECRUIT_AGE_YEARS = 6;
export const CANOPY_FOREST_THRESHOLD = 0.35;

const MAX_FOREST_STEM_DENSITY = 12;
const MAX_OPEN_STEM_DENSITY = 3;

const vegetationNoise = (x: number, y: number, seed: number): number => {
  let h = Math.imul(x ^ 0x27d4eb2d, 0x85ebca6b);
  h = Math.imul(h ^ (y + 0x165667b1), 0xc2b2ae35);
  h ^= Math.imul(seed ^ 0x9e3779b9, 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967295;
};

export const DOMINANT_FOREST_TYPES: TreeType[] = [
  TreeTypeEnum.Pine,
  TreeTypeEnum.Oak,
  TreeTypeEnum.Maple,
  TreeTypeEnum.Birch,
  TreeTypeEnum.Elm
];

export const isVegetationType = (type: TileType): boolean =>
  type === "grass" || type === "scrub" || type === "floodplain" || type === "forest";

export const isForestType = (type: TileType): boolean => type === "forest";

export const getVegetationAgeCapYears = (type: TileType): number => {
  switch (type) {
    case "forest":
      return FOREST_AGE_CAP_YEARS;
    case "scrub":
      return SCRUB_AGE_CAP_YEARS;
    case "grass":
    case "floodplain":
      return OPEN_WOODY_AGE_CAP_YEARS;
    default:
      return 0;
  }
};

export const clampVegetationAgeYears = (type: TileType, ageYears: number): number => {
  const cap = getVegetationAgeCapYears(type);
  if (cap <= 0) {
    return 0;
  }
  return clamp(ageYears, 0, cap);
};

export const getVegetationMaturity01 = (type: TileType, ageYears: number): number => {
  const cap = getVegetationAgeCapYears(type);
  if (cap <= 0) {
    return 0;
  }
  return clamp(ageYears / cap, 0, 1);
};

export const getVegetationFuelCapMultiplier = (type: TileType, ageYears: number): number => {
  const maturity01 = getVegetationMaturity01(type, ageYears);
  if (type === "forest") {
    return 0.55 + 0.6 * maturity01;
  }
  if (type === "grass" || type === "scrub" || type === "floodplain") {
    return 0.7 + 0.3 * maturity01;
  }
  return 1;
};

export const getForestRenderHeightMultiplier = (ageYears: number): number =>
  0.35 + 0.65 * Math.sqrt(getVegetationMaturity01("forest", ageYears));

export const getVegetationRenderHeightMultiplier = (type: TileType, ageYears: number): number => {
  if (type === "forest") {
    return getForestRenderHeightMultiplier(ageYears);
  }
  const maturity01 = getVegetationMaturity01(type, ageYears);
  if (type === "scrub") {
    return 0.35 + 0.45 * maturity01;
  }
  if (type === "grass" || type === "floodplain") {
    return 0.3 + 0.4 * maturity01;
  }
  return 0;
};

export const getCanopyCoverForVegetationAge = (type: TileType, ageYears: number): number => {
  const maturity01 = getVegetationMaturity01(type, ageYears);
  switch (type) {
    case "forest":
      return clamp(0.18 + 0.74 * maturity01, 0, 0.92);
    case "scrub":
      return clamp(0.08 + 0.38 * maturity01, 0, 0.46);
    case "grass":
      return clamp(0.02 + 0.4 * maturity01, 0, 0.42);
    case "floodplain":
      return clamp(0.03 + 0.37 * maturity01, 0, 0.4);
    default:
      return 0;
  }
};

export const getStemDensityForVegetation = (
  worldSeed: number,
  type: TileType,
  ageYears: number,
  x: number,
  y: number
): number => {
  const canopyCover = getCanopyCoverForVegetationAge(type, ageYears);
  if (canopyCover <= 0) {
    return 0;
  }
  const jitter = (vegetationNoise(x, y, worldSeed + 1729) - 0.5) * 2;
  if (type === "forest") {
    const base = 2 + canopyCover * 9;
    return Math.round(clamp(base + jitter * 2, 0, MAX_FOREST_STEM_DENSITY));
  }
  if (type === "grass" || type === "scrub" || type === "floodplain") {
    const base = canopyCover * 3;
    return Math.round(clamp(base + jitter, 0, MAX_OPEN_STEM_DENSITY));
  }
  return 0;
};

export const clearVegetationState = (tile: Tile): void => {
  tile.vegetationAgeYears = 0;
  tile.canopy = 0;
  tile.canopyCover = 0;
  tile.stemDensity = 0;
};

export const syncDerivedVegetationState = (tile: Tile, worldSeed: number, x: number, y: number): void => {
  if (!isVegetationType(tile.type)) {
    clearVegetationState(tile);
    return;
  }
  tile.vegetationAgeYears = clampVegetationAgeYears(tile.type, tile.vegetationAgeYears);
  const canopy = getCanopyCoverForVegetationAge(tile.type, tile.vegetationAgeYears);
  tile.canopy = canopy;
  tile.canopyCover = canopy;
  tile.stemDensity = getStemDensityForVegetation(worldSeed, tile.type, tile.vegetationAgeYears, x, y);
};

export function pickWeightedTreeType(seed: number, candidates: TreeType[], weights: Record<TreeType, number>): TreeType {
  let total = 0;
  candidates.forEach((type) => {
    total += Math.max(0.0001, weights[type] ?? 0.0001);
  });
  const target = seed * total;
  let running = 0;
  for (const type of candidates) {
    running += Math.max(0.0001, weights[type] ?? 0.0001);
    if (target <= running) {
      return type;
    }
  }
  return candidates[candidates.length - 1] ?? TreeTypeEnum.Pine;
}

export function computeForestTreeWeights(
  moisture: number,
  elevation: number,
  seedX: number,
  seedY: number,
  seedBase: number
): Record<TreeType, number> {
  const dry = clamp(1 - moisture, 0, 1);
  const wet = clamp(moisture, 0, 1);
  const high = clamp(elevation, 0, 1);
  const low = 1 - high;
  const jitter = (offset: number) => 0.85 + vegetationNoise(seedX, seedY, seedBase + offset) * 0.3;
  return {
    [TreeTypeEnum.Pine]: (1 + dry * 0.8 + high * 0.5) * jitter(11),
    [TreeTypeEnum.Oak]: (1 + (0.5 - Math.abs(wet - 0.5)) * 0.4) * jitter(23),
    [TreeTypeEnum.Maple]: (1 + wet * 0.35 + low * 0.2) * jitter(37),
    [TreeTypeEnum.Birch]: (1 + dry * 0.25 + low * 0.2) * jitter(41),
    [TreeTypeEnum.Elm]: (1 + wet * 0.8 + low * 0.6) * jitter(59),
    [TreeTypeEnum.Scrub]: 0.4 * jitter(71)
  };
}
