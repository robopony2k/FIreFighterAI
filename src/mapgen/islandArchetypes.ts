export type IslandArchetypeId = "MASSIF" | "LONG_SPINE" | "TWIN_BAY" | "SHELF";

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
};

export const ISLAND_ARCHETYPE_IDS: readonly IslandArchetypeId[] = ["MASSIF", "LONG_SPINE", "TWIN_BAY", "SHELF"];

export const ISLAND_ARCHETYPE_DEFINITIONS: Record<IslandArchetypeId, IslandArchetypeDefinition> = {
  MASSIF: {
    lowFreqAmplitude: 0.24,
    midFreqAmplitude: 0.14,
    highFreqAmplitude: 0.06,
    embayment: 0.18,
    anisotropy: 0.24,
    asymmetry: 0.46,
    ridgeAlignment: 0.28,
    uplandDistribution: 0.3,
    coastalShelfWidth: 0.46,
    interiorRise: 0.76,
    ridgeFrequency: 0.34,
    basinStrength: 0.3,
    maxHeight: 0.62,
    coastlineDistortionCap: 0.36
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
    coastlineDistortionCap: 0.48
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
    coastlineDistortionCap: 0.44
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
    coastlineDistortionCap: 0.22
  }
};
