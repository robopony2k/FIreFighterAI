import { MAP_SIZE_PRESETS, type MapSizeId } from "../core/config.js";
import {
  DEFAULT_MAP_GEN_SETTINGS,
  DEFAULT_ROAD_GEN_SETTINGS,
  type MapGenSettings
} from "./settings.js";
import {
  ISLAND_ARCHETYPE_DEFINITIONS,
  ISLAND_ARCHETYPE_IDS,
  type IslandArchetypeId
} from "./islandArchetypes.js";

export type TerrainArchetypeId = IslandArchetypeId;

export type TerrainAdvancedOverrides = {
  interiorRise?: number;
  maxHeight?: number;
  embayment?: number;
  anisotropy?: number;
  asymmetry?: number;
  ridgeAlignment?: number;
  uplandDistribution?: number;
  islandCompactness?: number;
  ridgeFrequency?: number;
  basinStrength?: number;
  coastalShelfWidth?: number;
  skipCarving?: boolean;
  riverBudget?: number;
  settlementSpacing?: number;
  roadStrictness?: number;
  forestPatchiness?: number;
};

export type TerrainRecipe = {
  archetype: TerrainArchetypeId;
  mapSize: MapSizeId;
  relief: number;
  ruggedness: number;
  coastComplexity: number;
  waterLevel: number;
  riverIntensity: number;
  vegetationDensity: number;
  townDensity: number;
  bridgeAllowance: number;
  advancedOverrides?: TerrainAdvancedOverrides;
};

export type ResolvedTerrainProfile = {
  recipe: TerrainRecipe;
  settings: MapGenSettings;
};

export type TerrainSource = TerrainRecipe | ResolvedTerrainProfile | MapGenSettings | undefined;

const MAP_SIZE_IDS = new Set<MapSizeId>(Object.keys(MAP_SIZE_PRESETS) as MapSizeId[]);
const TERRAIN_ARCHETYPE_IDS = new Set<TerrainArchetypeId>(ISLAND_ARCHETYPE_IDS);

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const mix = (a: number, b: number, t: number): number => a + (b - a) * clamp01(t);
const MAX_HEIGHT_REFERENCE = 0.62;

const computeTerrainHeightScaleMultiplier = (maxHeight: number): number =>
  clamp(1 + (clamp01(maxHeight) - MAX_HEIGHT_REFERENCE) * 1.75, 0.65, 1.7);

const computeNormalizedHeightPressure = (maxHeight: number): number =>
  clamp(1 - (clamp01(maxHeight) - MAX_HEIGHT_REFERENCE) * 0.45, 0.82, 1.16);

const inferMaxHeightFromScaleMultiplier = (multiplier: number | undefined): number => {
  if (!Number.isFinite(multiplier)) {
    return MAX_HEIGHT_REFERENCE;
  }
  return clamp01(MAX_HEIGHT_REFERENCE + ((multiplier as number) - 1) / 1.75);
};

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const clampOverride = (value: unknown, fallback: number): number => {
  const parsed = toFiniteNumber(value);
  return parsed === null ? fallback : clamp01(parsed);
};

const parseBooleanOverride = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
      return false;
    }
  }
  return fallback;
};

const DEFAULT_ADVANCED_OVERRIDES: Required<TerrainAdvancedOverrides> = {
  interiorRise: 0.62,
  maxHeight: 0.58,
  embayment: 0.32,
  anisotropy: 0.4,
  asymmetry: 0.46,
  ridgeAlignment: 0.42,
  uplandDistribution: 0.42,
  islandCompactness: 0.6,
  ridgeFrequency: 0.48,
  basinStrength: 0.42,
  coastalShelfWidth: 0.48,
  skipCarving: false,
  riverBudget: 0.42,
  settlementSpacing: 0.58,
  roadStrictness: 0.5,
  forestPatchiness: 0.46
};

const ARCHETYPE_PRESETS: Record<
  TerrainArchetypeId,
  {
    relief: number;
    ruggedness: number;
    coastComplexity: number;
    waterLevel: number;
    riverIntensity: number;
    vegetationDensity: number;
    townDensity: number;
    bridgeAllowance: number;
    advanced: Required<TerrainAdvancedOverrides>;
  }
> = {
  MASSIF: {
    relief: 0.7,
    ruggedness: 0.55,
    coastComplexity: 0.34,
    waterLevel: 0.34,
    riverIntensity: 0.45,
    vegetationDensity: 0.56,
    townDensity: 0.48,
    bridgeAllowance: 0.18,
    advanced: {
      interiorRise: ISLAND_ARCHETYPE_DEFINITIONS.MASSIF.interiorRise,
      maxHeight: ISLAND_ARCHETYPE_DEFINITIONS.MASSIF.maxHeight,
      embayment: ISLAND_ARCHETYPE_DEFINITIONS.MASSIF.embayment,
      anisotropy: ISLAND_ARCHETYPE_DEFINITIONS.MASSIF.anisotropy,
      asymmetry: ISLAND_ARCHETYPE_DEFINITIONS.MASSIF.asymmetry,
      ridgeAlignment: ISLAND_ARCHETYPE_DEFINITIONS.MASSIF.ridgeAlignment,
      uplandDistribution: ISLAND_ARCHETYPE_DEFINITIONS.MASSIF.uplandDistribution,
      islandCompactness: 0.72,
      ridgeFrequency: ISLAND_ARCHETYPE_DEFINITIONS.MASSIF.ridgeFrequency,
      basinStrength: ISLAND_ARCHETYPE_DEFINITIONS.MASSIF.basinStrength,
      coastalShelfWidth: ISLAND_ARCHETYPE_DEFINITIONS.MASSIF.coastalShelfWidth,
      skipCarving: false,
      riverBudget: 0.44,
      settlementSpacing: 0.62,
      roadStrictness: 0.56,
      forestPatchiness: 0.42
    }
  },
  LONG_SPINE: {
    relief: 0.72,
    ruggedness: 0.68,
    coastComplexity: 0.42,
    waterLevel: 0.36,
    riverIntensity: 0.56,
    vegetationDensity: 0.52,
    townDensity: 0.5,
    bridgeAllowance: 0.3,
    advanced: {
      interiorRise: ISLAND_ARCHETYPE_DEFINITIONS.LONG_SPINE.interiorRise,
      maxHeight: ISLAND_ARCHETYPE_DEFINITIONS.LONG_SPINE.maxHeight,
      embayment: ISLAND_ARCHETYPE_DEFINITIONS.LONG_SPINE.embayment,
      anisotropy: ISLAND_ARCHETYPE_DEFINITIONS.LONG_SPINE.anisotropy,
      asymmetry: ISLAND_ARCHETYPE_DEFINITIONS.LONG_SPINE.asymmetry,
      ridgeAlignment: ISLAND_ARCHETYPE_DEFINITIONS.LONG_SPINE.ridgeAlignment,
      uplandDistribution: ISLAND_ARCHETYPE_DEFINITIONS.LONG_SPINE.uplandDistribution,
      islandCompactness: 0.6,
      ridgeFrequency: ISLAND_ARCHETYPE_DEFINITIONS.LONG_SPINE.ridgeFrequency,
      basinStrength: ISLAND_ARCHETYPE_DEFINITIONS.LONG_SPINE.basinStrength,
      coastalShelfWidth: ISLAND_ARCHETYPE_DEFINITIONS.LONG_SPINE.coastalShelfWidth,
      skipCarving: false,
      riverBudget: 0.58,
      settlementSpacing: 0.6,
      roadStrictness: 0.56,
      forestPatchiness: 0.5
    }
  },
  TWIN_BAY: {
    relief: 0.62,
    ruggedness: 0.5,
    coastComplexity: 0.58,
    waterLevel: 0.42,
    riverIntensity: 0.48,
    vegetationDensity: 0.5,
    townDensity: 0.52,
    bridgeAllowance: 0.24,
    advanced: {
      interiorRise: ISLAND_ARCHETYPE_DEFINITIONS.TWIN_BAY.interiorRise,
      maxHeight: ISLAND_ARCHETYPE_DEFINITIONS.TWIN_BAY.maxHeight,
      embayment: ISLAND_ARCHETYPE_DEFINITIONS.TWIN_BAY.embayment,
      anisotropy: ISLAND_ARCHETYPE_DEFINITIONS.TWIN_BAY.anisotropy,
      asymmetry: ISLAND_ARCHETYPE_DEFINITIONS.TWIN_BAY.asymmetry,
      ridgeAlignment: ISLAND_ARCHETYPE_DEFINITIONS.TWIN_BAY.ridgeAlignment,
      uplandDistribution: ISLAND_ARCHETYPE_DEFINITIONS.TWIN_BAY.uplandDistribution,
      islandCompactness: 0.62,
      ridgeFrequency: ISLAND_ARCHETYPE_DEFINITIONS.TWIN_BAY.ridgeFrequency,
      basinStrength: ISLAND_ARCHETYPE_DEFINITIONS.TWIN_BAY.basinStrength,
      coastalShelfWidth: ISLAND_ARCHETYPE_DEFINITIONS.TWIN_BAY.coastalShelfWidth,
      skipCarving: false,
      riverBudget: 0.52,
      settlementSpacing: 0.58,
      roadStrictness: 0.52,
      forestPatchiness: 0.48
    }
  },
  SHELF: {
    relief: 0.44,
    ruggedness: 0.24,
    coastComplexity: 0.24,
    waterLevel: 0.3,
    riverIntensity: 0.3,
    vegetationDensity: 0.48,
    townDensity: 0.54,
    bridgeAllowance: 0.12,
    advanced: {
      interiorRise: ISLAND_ARCHETYPE_DEFINITIONS.SHELF.interiorRise,
      maxHeight: ISLAND_ARCHETYPE_DEFINITIONS.SHELF.maxHeight,
      embayment: ISLAND_ARCHETYPE_DEFINITIONS.SHELF.embayment,
      anisotropy: ISLAND_ARCHETYPE_DEFINITIONS.SHELF.anisotropy,
      asymmetry: ISLAND_ARCHETYPE_DEFINITIONS.SHELF.asymmetry,
      ridgeAlignment: ISLAND_ARCHETYPE_DEFINITIONS.SHELF.ridgeAlignment,
      uplandDistribution: ISLAND_ARCHETYPE_DEFINITIONS.SHELF.uplandDistribution,
      islandCompactness: 0.78,
      ridgeFrequency: ISLAND_ARCHETYPE_DEFINITIONS.SHELF.ridgeFrequency,
      basinStrength: ISLAND_ARCHETYPE_DEFINITIONS.SHELF.basinStrength,
      coastalShelfWidth: ISLAND_ARCHETYPE_DEFINITIONS.SHELF.coastalShelfWidth,
      skipCarving: false,
      riverBudget: 0.28,
      settlementSpacing: 0.56,
      roadStrictness: 0.54,
      forestPatchiness: 0.54
    }
  }
};

export const createDefaultTerrainRecipe = (
  mapSize: MapSizeId = "colossal",
  archetype: TerrainArchetypeId = "MASSIF"
): TerrainRecipe => {
  const preset = ARCHETYPE_PRESETS[archetype];
  return {
    archetype,
    mapSize,
    relief: preset.relief,
    ruggedness: preset.ruggedness,
    coastComplexity: preset.coastComplexity,
    waterLevel: preset.waterLevel,
    riverIntensity: preset.riverIntensity,
    vegetationDensity: preset.vegetationDensity,
    townDensity: preset.townDensity,
    bridgeAllowance: preset.bridgeAllowance,
    advancedOverrides: { ...preset.advanced }
  };
};

export const cloneTerrainRecipe = (recipe?: Partial<TerrainRecipe>): TerrainRecipe => {
  const archetype = TERRAIN_ARCHETYPE_IDS.has(recipe?.archetype as TerrainArchetypeId)
    ? (recipe?.archetype as TerrainArchetypeId)
    : "MASSIF";
  const defaults = createDefaultTerrainRecipe(
    MAP_SIZE_IDS.has(recipe?.mapSize as MapSizeId) ? (recipe?.mapSize as MapSizeId) : "colossal",
    archetype
  );
  const sourceAdvanced = isRecord(recipe?.advancedOverrides) ? recipe.advancedOverrides : {};
  return {
    archetype,
    mapSize: defaults.mapSize,
    relief: clampOverride(recipe?.relief, defaults.relief),
    ruggedness: clampOverride(recipe?.ruggedness, defaults.ruggedness),
    coastComplexity: clampOverride(recipe?.coastComplexity, defaults.coastComplexity),
    waterLevel: clampOverride(recipe?.waterLevel, defaults.waterLevel),
    riverIntensity: clampOverride(recipe?.riverIntensity, defaults.riverIntensity),
    vegetationDensity: clampOverride(recipe?.vegetationDensity, defaults.vegetationDensity),
    townDensity: clampOverride(recipe?.townDensity, defaults.townDensity),
    bridgeAllowance: clampOverride(recipe?.bridgeAllowance, defaults.bridgeAllowance),
    advancedOverrides: {
      interiorRise: clampOverride(sourceAdvanced.interiorRise, defaults.advancedOverrides?.interiorRise ?? DEFAULT_ADVANCED_OVERRIDES.interiorRise),
      maxHeight: clampOverride(sourceAdvanced.maxHeight, defaults.advancedOverrides?.maxHeight ?? DEFAULT_ADVANCED_OVERRIDES.maxHeight),
      embayment: clampOverride(sourceAdvanced.embayment, defaults.advancedOverrides?.embayment ?? DEFAULT_ADVANCED_OVERRIDES.embayment),
      anisotropy: clampOverride(sourceAdvanced.anisotropy, defaults.advancedOverrides?.anisotropy ?? DEFAULT_ADVANCED_OVERRIDES.anisotropy),
      asymmetry: clampOverride(sourceAdvanced.asymmetry, defaults.advancedOverrides?.asymmetry ?? DEFAULT_ADVANCED_OVERRIDES.asymmetry),
      ridgeAlignment: clampOverride(
        sourceAdvanced.ridgeAlignment,
        defaults.advancedOverrides?.ridgeAlignment ?? DEFAULT_ADVANCED_OVERRIDES.ridgeAlignment
      ),
      uplandDistribution: clampOverride(
        sourceAdvanced.uplandDistribution,
        defaults.advancedOverrides?.uplandDistribution ?? DEFAULT_ADVANCED_OVERRIDES.uplandDistribution
      ),
      islandCompactness: clampOverride(
        sourceAdvanced.islandCompactness,
        defaults.advancedOverrides?.islandCompactness ?? DEFAULT_ADVANCED_OVERRIDES.islandCompactness
      ),
      ridgeFrequency: clampOverride(
        sourceAdvanced.ridgeFrequency,
        defaults.advancedOverrides?.ridgeFrequency ?? DEFAULT_ADVANCED_OVERRIDES.ridgeFrequency
      ),
      basinStrength: clampOverride(
        sourceAdvanced.basinStrength,
        defaults.advancedOverrides?.basinStrength ?? DEFAULT_ADVANCED_OVERRIDES.basinStrength
      ),
      coastalShelfWidth: clampOverride(
        sourceAdvanced.coastalShelfWidth,
        defaults.advancedOverrides?.coastalShelfWidth ?? DEFAULT_ADVANCED_OVERRIDES.coastalShelfWidth
      ),
      skipCarving: parseBooleanOverride(
        sourceAdvanced.skipCarving,
        defaults.advancedOverrides?.skipCarving ?? DEFAULT_ADVANCED_OVERRIDES.skipCarving
      ),
      riverBudget: clampOverride(
        sourceAdvanced.riverBudget,
        defaults.advancedOverrides?.riverBudget ?? DEFAULT_ADVANCED_OVERRIDES.riverBudget
      ),
      settlementSpacing: clampOverride(
        sourceAdvanced.settlementSpacing,
        defaults.advancedOverrides?.settlementSpacing ?? DEFAULT_ADVANCED_OVERRIDES.settlementSpacing
      ),
      roadStrictness: clampOverride(
        sourceAdvanced.roadStrictness,
        defaults.advancedOverrides?.roadStrictness ?? DEFAULT_ADVANCED_OVERRIDES.roadStrictness
      ),
      forestPatchiness: clampOverride(
        sourceAdvanced.forestPatchiness,
        defaults.advancedOverrides?.forestPatchiness ?? DEFAULT_ADVANCED_OVERRIDES.forestPatchiness
      )
    }
  };
};

export const sanitizeTerrainRecipe = (value: unknown): TerrainRecipe => {
  if (!isRecord(value)) {
    return createDefaultTerrainRecipe();
  }
  return cloneTerrainRecipe(value as Partial<TerrainRecipe>);
};

export const terrainRecipeEqual = (a: TerrainRecipe, b: TerrainRecipe): boolean => {
  if (
    a.archetype !== b.archetype ||
    a.mapSize !== b.mapSize ||
    Math.abs(a.relief - b.relief) > 1e-6 ||
    Math.abs(a.ruggedness - b.ruggedness) > 1e-6 ||
    Math.abs(a.coastComplexity - b.coastComplexity) > 1e-6 ||
    Math.abs(a.waterLevel - b.waterLevel) > 1e-6 ||
    Math.abs(a.riverIntensity - b.riverIntensity) > 1e-6 ||
    Math.abs(a.vegetationDensity - b.vegetationDensity) > 1e-6 ||
    Math.abs(a.townDensity - b.townDensity) > 1e-6 ||
    Math.abs(a.bridgeAllowance - b.bridgeAllowance) > 1e-6
  ) {
    return false;
  }
  const aAdvanced = cloneTerrainRecipe(a).advancedOverrides ?? DEFAULT_ADVANCED_OVERRIDES;
  const bAdvanced = cloneTerrainRecipe(b).advancedOverrides ?? DEFAULT_ADVANCED_OVERRIDES;
  return (
    Math.abs((aAdvanced.interiorRise ?? 0) - (bAdvanced.interiorRise ?? 0)) <= 1e-6 &&
    Math.abs((aAdvanced.maxHeight ?? 0) - (bAdvanced.maxHeight ?? 0)) <= 1e-6 &&
    Math.abs((aAdvanced.embayment ?? 0) - (bAdvanced.embayment ?? 0)) <= 1e-6 &&
    Math.abs((aAdvanced.anisotropy ?? 0) - (bAdvanced.anisotropy ?? 0)) <= 1e-6 &&
    Math.abs((aAdvanced.asymmetry ?? 0) - (bAdvanced.asymmetry ?? 0)) <= 1e-6 &&
    Math.abs((aAdvanced.ridgeAlignment ?? 0) - (bAdvanced.ridgeAlignment ?? 0)) <= 1e-6 &&
    Math.abs((aAdvanced.uplandDistribution ?? 0) - (bAdvanced.uplandDistribution ?? 0)) <= 1e-6 &&
    Math.abs((aAdvanced.islandCompactness ?? 0) - (bAdvanced.islandCompactness ?? 0)) <= 1e-6 &&
    Math.abs((aAdvanced.ridgeFrequency ?? 0) - (bAdvanced.ridgeFrequency ?? 0)) <= 1e-6 &&
    Math.abs((aAdvanced.basinStrength ?? 0) - (bAdvanced.basinStrength ?? 0)) <= 1e-6 &&
    Math.abs((aAdvanced.coastalShelfWidth ?? 0) - (bAdvanced.coastalShelfWidth ?? 0)) <= 1e-6 &&
    Boolean(aAdvanced.skipCarving) === Boolean(bAdvanced.skipCarving) &&
    Math.abs((aAdvanced.riverBudget ?? 0) - (bAdvanced.riverBudget ?? 0)) <= 1e-6 &&
    Math.abs((aAdvanced.settlementSpacing ?? 0) - (bAdvanced.settlementSpacing ?? 0)) <= 1e-6 &&
    Math.abs((aAdvanced.roadStrictness ?? 0) - (bAdvanced.roadStrictness ?? 0)) <= 1e-6 &&
    Math.abs((aAdvanced.forestPatchiness ?? 0) - (bAdvanced.forestPatchiness ?? 0)) <= 1e-6
  );
};

export const mapSizeIdFromDimensions = (size: number): MapSizeId => {
  const exact = (Object.entries(MAP_SIZE_PRESETS) as Array<[MapSizeId, number]>).find(([, value]) => value === size);
  return exact?.[0] ?? "colossal";
};

const resolveAdvancedOverrides = (recipe: TerrainRecipe): Required<TerrainAdvancedOverrides> => {
  const preset = ARCHETYPE_PRESETS[recipe.archetype].advanced;
  const advanced = recipe.advancedOverrides ?? {};
  return {
    interiorRise: clampOverride(advanced.interiorRise, preset.interiorRise),
    maxHeight: clampOverride(advanced.maxHeight, preset.maxHeight),
    embayment: clampOverride(advanced.embayment, preset.embayment),
    anisotropy: clampOverride(advanced.anisotropy, preset.anisotropy),
    asymmetry: clampOverride(advanced.asymmetry, preset.asymmetry),
    ridgeAlignment: clampOverride(advanced.ridgeAlignment, preset.ridgeAlignment),
    uplandDistribution: clampOverride(advanced.uplandDistribution, preset.uplandDistribution),
    islandCompactness: clampOverride(advanced.islandCompactness, preset.islandCompactness),
    ridgeFrequency: clampOverride(advanced.ridgeFrequency, preset.ridgeFrequency),
    basinStrength: clampOverride(advanced.basinStrength, preset.basinStrength),
    coastalShelfWidth: clampOverride(advanced.coastalShelfWidth, preset.coastalShelfWidth),
    skipCarving: parseBooleanOverride(advanced.skipCarving, preset.skipCarving),
    riverBudget: clampOverride(advanced.riverBudget, preset.riverBudget),
    settlementSpacing: clampOverride(advanced.settlementSpacing, preset.settlementSpacing),
    roadStrictness: clampOverride(advanced.roadStrictness, preset.roadStrictness),
    forestPatchiness: clampOverride(advanced.forestPatchiness, preset.forestPatchiness)
  };
};

export const compileTerrainRecipe = (recipeInput: TerrainRecipe): ResolvedTerrainProfile => {
  const recipe = cloneTerrainRecipe(recipeInput);
  const advanced = resolveAdvancedOverrides(recipe);
  const mapSizeTiles = MAP_SIZE_PRESETS[recipe.mapSize];
  const sizeScale = Math.sqrt(mapSizeTiles / MAP_SIZE_PRESETS.colossal);
  const relief = clamp01(recipe.relief);
  const ruggedness = clamp01(recipe.ruggedness);
  const coastComplexity = clamp01(recipe.coastComplexity);
  const waterLevel = clamp01(recipe.waterLevel);
  const riverIntensity = clamp01(recipe.riverIntensity);
  const vegetationDensity = clamp01(recipe.vegetationDensity);
  const townDensity = clamp01(recipe.townDensity);
  const bridgeAllowance = clamp01(recipe.bridgeAllowance);
  const reliefCurve = Math.pow(relief, 1.35);
  const maxHeight = clamp01(advanced.maxHeight);
  const embayment = clamp01(advanced.embayment);
  const anisotropy = clamp01(advanced.anisotropy);
  const asymmetry = clamp01(advanced.asymmetry);
  const ridgeAlignment = clamp01(advanced.ridgeAlignment);
  const uplandDistribution = clamp01(advanced.uplandDistribution);
  const heightScaleMultiplier = computeTerrainHeightScaleMultiplier(maxHeight);
  const normalizedHeightPressure = computeNormalizedHeightPressure(maxHeight);
  const valleyDepthScale = mix(0.74, 1, reliefCurve);

  const mountainScale =
    recipe.archetype === "SHELF"
      ? mix(0.72, 0.96, 1 - advanced.islandCompactness)
      : recipe.archetype === "LONG_SPINE"
        ? mix(0.92, 1.12, mix(1 - advanced.islandCompactness, anisotropy, 0.55))
        : mix(0.84, 1.18, mix(1 - advanced.islandCompactness, uplandDistribution, 0.35));

  const riverBudget = clamp01(mix(advanced.riverBudget, riverIntensity, 0.35));
  const nominalRiverCount = Math.round(mix(1, 7, riverBudget) * Math.max(0.75, sizeScale));
  const riverCount =
    recipe.archetype === "SHELF" ? Math.max(1, nominalRiverCount - 1) : Math.max(1, nominalRiverCount);

  const forestPatchiness = advanced.forestPatchiness;
  const forestPatchScale = Math.round(mix(32, 16, forestPatchiness));
  const meadowPatchScale = Math.round(mix(28, 12, forestPatchiness));
  const roadStrictness = advanced.roadStrictness;
  const erosionTightness = clamp01(ruggedness * 0.65 + riverIntensity * 0.35);
  const erosionArchetypeScale =
    recipe.archetype === "SHELF"
      ? 0.62
      : recipe.archetype === "LONG_SPINE"
        ? 1.08
        : recipe.archetype === "TWIN_BAY"
          ? 0.92
          : 1;

  const settings: MapGenSettings = {
    ...DEFAULT_MAP_GEN_SETTINGS,
    cellSizeM: DEFAULT_MAP_GEN_SETTINGS.cellSizeM,
    worldOffsetXM: DEFAULT_MAP_GEN_SETTINGS.worldOffsetXM,
    worldOffsetYM: DEFAULT_MAP_GEN_SETTINGS.worldOffsetYM,
    microScaleM: mix(32, 58, ruggedness),
    heightScaleMultiplier,
    elevationScale:
      mix(0.84, 1.18, reliefCurve)
      * normalizedHeightPressure
      * mix(0.9, 1.14, advanced.interiorRise)
      * mix(0.94, 1.06, uplandDistribution),
    elevationExponent: mix(0.9, 1.06, Math.pow(relief, 1.04)),
    mountainScale,
    ridgeStrength: mix(
      0.03,
      0.22,
      clamp01(ruggedness * 0.42 + advanced.ridgeFrequency * 0.22 + ridgeAlignment * 0.36)
    ),
    valleyDepth:
      mix(0.7, 2.15, clamp01(riverIntensity * 0.45 + ruggedness * 0.2 + advanced.basinStrength * 0.35))
      * valleyDepthScale,
    forestMacroScale: forestPatchScale,
    forestDetailScale: Math.round(mix(7, 15, forestPatchiness)),
    forestThreshold: mix(0.76, 0.48, vegetationDensity),
    highlandForestElevation: mix(0.58, 0.84, clamp01(vegetationDensity * 0.75 + relief * 0.25)),
    meadowScale: meadowPatchScale,
    meadowThreshold: mix(0.68, 0.48, vegetationDensity),
    meadowStrength: mix(0.45, 0.88, clamp01(1 - vegetationDensity * 0.65 + forestPatchiness * 0.35)),
    grassCanopyBase: mix(0.03, 0.14, vegetationDensity),
    grassCanopyRange: mix(0.08, 0.34, forestPatchiness),
    waterCoverage: mix(0.22, 0.68, waterLevel),
    baseWaterThreshold: mix(0.08, 0.2, waterLevel),
    edgeWaterBias: mix(0.06, 0.28, clamp01(waterLevel * 0.4 + coastComplexity * 0.6)),
    riverCount,
    riverWaterBias: mix(0.08, 0.32, riverIntensity),
    biomeClassifierMode: "seedSpread",
    road: {
      ...DEFAULT_ROAD_GEN_SETTINGS,
      topology: "eight_dir",
      diagonalPenalty: mix(0.12, 0.36, roadStrictness),
      pruneRedundantDiagonals: roadStrictness >= 0.18,
      bridgeTransitions: bridgeAllowance >= 0.14
    },
    terrainArchetype: recipe.archetype,
    relief,
    ruggedness,
    coastComplexity,
    waterLevel,
    riverIntensity,
    vegetationDensity,
    townDensity,
    bridgeAllowance,
    interiorRise: advanced.interiorRise,
    maxHeight,
    embayment,
    anisotropy,
    asymmetry,
    ridgeAlignment,
    uplandDistribution,
    islandCompactness: advanced.islandCompactness,
    ridgeFrequency: advanced.ridgeFrequency,
    basinStrength: advanced.basinStrength,
    coastalShelfWidth: advanced.coastalShelfWidth,
    erosionDetailStrength:
      mix(0.012, 0.0295, erosionTightness)
      * mix(0.98, 1.2, relief)
      * erosionArchetypeScale,
    erosionDetailScaleM:
      mix(340, 140, erosionTightness)
      * mix(1.08, 0.9, clamp01(mountainScale - 0.68))
      * mix(1.02, 0.9, advanced.islandCompactness),
    erosionDetailOctaves: 4,
    erosionSlopeStrength: mix(1.1, 2.5, clamp01(ruggedness * 0.75 + relief * 0.25)),
    erosionBranchStrength: mix(0.8, 2.25, clamp01(ruggedness * 0.55 + riverIntensity * 0.45)),
    erosionCoastFade: mix(0.012, 0.064, clamp01(waterLevel * 0.7 + advanced.coastalShelfWidth * 0.3)),
    erosionSlopeMaskMin: mix(0.007, 0.0025, ruggedness),
    erosionSlopeMaskMax: mix(0.026, 0.076, clamp01(ruggedness * 0.65 + relief * 0.35)),
    skipCarving: advanced.skipCarving,
    riverBudget,
    settlementSpacing: advanced.settlementSpacing,
    roadStrictness,
    forestPatchiness
  };

  return {
    recipe,
    settings
  };
};

export const isResolvedTerrainProfile = (value: unknown): value is ResolvedTerrainProfile =>
  isRecord(value)
  && isRecord(value.settings)
  && isRecord(value.recipe);

const inferRecipeFromSettings = (settingsInput: Partial<MapGenSettings>, mapSize: MapSizeId): TerrainRecipe => {
  const settings = {
    ...DEFAULT_MAP_GEN_SETTINGS,
    ...settingsInput,
    road: {
      ...DEFAULT_ROAD_GEN_SETTINGS,
      ...(settingsInput.road ?? {})
    }
  };
  const archetype = TERRAIN_ARCHETYPE_IDS.has(settings.terrainArchetype)
    ? settings.terrainArchetype
    : "MASSIF";
  return cloneTerrainRecipe({
    archetype,
    mapSize,
    relief: clamp01((settings.relief ?? ((settings.elevationScale - 0.88) / Math.max(0.0001, 1.58 - 0.88)))),
    ruggedness: clamp01(settings.ruggedness ?? (settings.ridgeStrength / 0.24)),
    coastComplexity: clamp01(settings.coastComplexity ?? ((settings.edgeWaterBias - 0.06) / Math.max(0.0001, 0.28 - 0.06))),
    waterLevel: clamp01(settings.waterLevel ?? ((settings.waterCoverage - 0.22) / Math.max(0.0001, 0.68 - 0.22))),
    riverIntensity: clamp01(settings.riverIntensity ?? ((settings.riverWaterBias - 0.08) / Math.max(0.0001, 0.32 - 0.08))),
    vegetationDensity: clamp01(
      settings.vegetationDensity ?? ((0.76 - settings.forestThreshold) / Math.max(0.0001, 0.76 - 0.48))
    ),
    townDensity: clamp01(settings.townDensity ?? 0.5),
    bridgeAllowance: clamp01(settings.bridgeAllowance ?? (settings.road.bridgeTransitions ? 0.7 : 0.2)),
    advancedOverrides: {
      interiorRise: clamp01(settings.interiorRise ?? DEFAULT_ADVANCED_OVERRIDES.interiorRise),
      maxHeight: clamp01(settings.maxHeight ?? inferMaxHeightFromScaleMultiplier(settings.heightScaleMultiplier)),
      embayment: clamp01(settings.embayment ?? DEFAULT_ADVANCED_OVERRIDES.embayment),
      anisotropy: clamp01(settings.anisotropy ?? DEFAULT_ADVANCED_OVERRIDES.anisotropy),
      asymmetry: clamp01(settings.asymmetry ?? DEFAULT_ADVANCED_OVERRIDES.asymmetry),
      ridgeAlignment: clamp01(settings.ridgeAlignment ?? DEFAULT_ADVANCED_OVERRIDES.ridgeAlignment),
      uplandDistribution: clamp01(settings.uplandDistribution ?? DEFAULT_ADVANCED_OVERRIDES.uplandDistribution),
      islandCompactness: clamp01(settings.islandCompactness ?? DEFAULT_ADVANCED_OVERRIDES.islandCompactness),
      ridgeFrequency: clamp01(settings.ridgeFrequency ?? DEFAULT_ADVANCED_OVERRIDES.ridgeFrequency),
      basinStrength: clamp01(settings.basinStrength ?? DEFAULT_ADVANCED_OVERRIDES.basinStrength),
      coastalShelfWidth: clamp01(settings.coastalShelfWidth ?? DEFAULT_ADVANCED_OVERRIDES.coastalShelfWidth),
      skipCarving: Boolean(settings.skipCarving ?? DEFAULT_ADVANCED_OVERRIDES.skipCarving),
      riverBudget: clamp01(settings.riverBudget ?? DEFAULT_ADVANCED_OVERRIDES.riverBudget),
      settlementSpacing: clamp01(settings.settlementSpacing ?? DEFAULT_ADVANCED_OVERRIDES.settlementSpacing),
      roadStrictness: clamp01(settings.roadStrictness ?? DEFAULT_ADVANCED_OVERRIDES.roadStrictness),
      forestPatchiness: clamp01(settings.forestPatchiness ?? DEFAULT_ADVANCED_OVERRIDES.forestPatchiness)
    }
  });
};

export const resolveTerrainProfile = (
  source: unknown,
  fallbackMapSize: MapSizeId = "colossal"
): ResolvedTerrainProfile => {
  if (isResolvedTerrainProfile(source)) {
    return {
      recipe: cloneTerrainRecipe(source.recipe),
      settings: {
        ...DEFAULT_MAP_GEN_SETTINGS,
        ...source.settings,
        road: {
          ...DEFAULT_ROAD_GEN_SETTINGS,
          ...(source.settings.road ?? {})
        }
      }
    };
  }
  if (!source) {
    return compileTerrainRecipe(createDefaultTerrainRecipe(fallbackMapSize));
  }
  if (isRecord(source)) {
    const sourceRecord = source as Record<string, unknown>;
    if (typeof sourceRecord.archetype === "string") {
      return compileTerrainRecipe(sanitizeTerrainRecipe(sourceRecord));
    }
  }
  return compileTerrainRecipe(inferRecipeFromSettings(source as Partial<MapGenSettings>, fallbackMapSize));
};

export const getTerrainHeightScaleMultiplier = (
  source: TerrainSource,
  fallbackMapSize: MapSizeId = "colossal"
): number => resolveTerrainProfile(source, fallbackMapSize).settings.heightScaleMultiplier;
