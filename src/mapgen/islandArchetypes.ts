export type IslandArchetypeId = "MASSIF" | "LONG_SPINE" | "TWIN_BAY" | "SHELF" | "NONE";

export type IslandWatershedStructureDefinition = {
  primaryRidge: number;
  secondaryRidge: number;
  valleyCorridor: number;
  basinPocket: number;
  basinRim: number;
  spillNotch: number;
  riverSource: number;
  lakePocket: number;
};

export type IslandArchetypeDefinition = {
  lowFreqAmplitude: number;
  midFreqAmplitude: number;
  highFreqAmplitude: number;
  embayment: number;
  anisotropy: number;
  asymmetry: number;
  ridgeAlignment: number;
  uplandDistribution: number;
  coastalShelfWidth: number;
  interiorRise: number;
  ridgeFrequency: number;
  basinStrength: number;
  maxHeight: number;
  coastlineDistortionCap: number;
  watershedStructure: IslandWatershedStructureDefinition;
};

export const ISLAND_ARCHETYPE_IDS: readonly IslandArchetypeId[] = ["MASSIF", "LONG_SPINE", "TWIN_BAY", "SHELF", "NONE"];

export const ISLAND_ARCHETYPE_DEFINITIONS: Record<IslandArchetypeId, IslandArchetypeDefinition> = {
  MASSIF: {
    lowFreqAmplitude: 0.24,
    midFreqAmplitude: 0.14,
    highFreqAmplitude: 0.06,
    embayment: 0.24,
    anisotropy: 0.3,
    asymmetry: 0.46,
    ridgeAlignment: 0.28,
    uplandDistribution: 0.44,
    coastalShelfWidth: 0.46,
    interiorRise: 0.68,
    ridgeFrequency: 0.34,
    basinStrength: 0.42,
    maxHeight: 0.58,
    coastlineDistortionCap: 0.42,
    watershedStructure: {
      primaryRidge: 0.72,
      secondaryRidge: 0.58,
      valleyCorridor: 0.64,
      basinPocket: 0.76,
      basinRim: 0.7,
      spillNotch: 0.72,
      riverSource: 0.74,
      lakePocket: 0.8
    }
  },
  LONG_SPINE: {
    lowFreqAmplitude: 0.18,
    midFreqAmplitude: 0.22,
    highFreqAmplitude: 0.08,
    embayment: 0.4,
    anisotropy: 0.82,
    asymmetry: 0.56,
    ridgeAlignment: 0.88,
    uplandDistribution: 0.68,
    coastalShelfWidth: 0.38,
    interiorRise: 0.7,
    ridgeFrequency: 0.82,
    basinStrength: 0.4,
    maxHeight: 0.72,
    coastlineDistortionCap: 0.48,
    watershedStructure: {
      primaryRidge: 0.95,
      secondaryRidge: 0.66,
      valleyCorridor: 0.84,
      basinPocket: 0.7,
      basinRim: 0.68,
      spillNotch: 0.78,
      riverSource: 0.88,
      lakePocket: 0.72
    }
  },
  TWIN_BAY: {
    lowFreqAmplitude: 0.2,
    midFreqAmplitude: 0.16,
    highFreqAmplitude: 0.07,
    embayment: 0.78,
    anisotropy: 0.56,
    asymmetry: 0.7,
    ridgeAlignment: 0.52,
    uplandDistribution: 0.5,
    coastalShelfWidth: 0.4,
    interiorRise: 0.62,
    ridgeFrequency: 0.46,
    basinStrength: 0.34,
    maxHeight: 0.56,
    coastlineDistortionCap: 0.44,
    watershedStructure: {
      primaryRidge: 0.68,
      secondaryRidge: 0.78,
      valleyCorridor: 0.76,
      basinPocket: 0.72,
      basinRim: 0.74,
      spillNotch: 0.7,
      riverSource: 0.62,
      lakePocket: 0.76
    }
  },
  SHELF: {
    lowFreqAmplitude: 0.16,
    midFreqAmplitude: 0.08,
    highFreqAmplitude: 0.03,
    embayment: 0.22,
    anisotropy: 0.48,
    asymmetry: 0.3,
    ridgeAlignment: 0.22,
    uplandDistribution: 0.18,
    coastalShelfWidth: 0.72,
    interiorRise: 0.38,
    ridgeFrequency: 0.18,
    basinStrength: 0.24,
    maxHeight: 0.4,
    coastlineDistortionCap: 0.22,
    watershedStructure: {
      primaryRidge: 0.18,
      secondaryRidge: 0.16,
      valleyCorridor: 0.28,
      basinPocket: 0.34,
      basinRim: 0.24,
      spillNotch: 0.34,
      riverSource: 0.24,
      lakePocket: 0.28
    }
  },
  NONE: {
    lowFreqAmplitude: 0,
    midFreqAmplitude: 0,
    highFreqAmplitude: 0,
    embayment: 0.5,
    anisotropy: 0.5,
    asymmetry: 0.5,
    ridgeAlignment: 0.5,
    uplandDistribution: 0.5,
    coastalShelfWidth: 0.5,
    interiorRise: 0.5,
    ridgeFrequency: 0.5,
    basinStrength: 0.5,
    maxHeight: 0.5,
    coastlineDistortionCap: 0.34,
    watershedStructure: {
      primaryRidge: 0,
      secondaryRidge: 0,
      valleyCorridor: 0,
      basinPocket: 0,
      basinRim: 0,
      spillNotch: 0,
      riverSource: 0,
      lakePocket: 0
    }
  }
};
