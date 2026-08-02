const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const TERRAIN_GENERATION_LIMITS = Object.freeze({
  landCoverageTarget: Object.freeze({
    min: 0.5,
    max: 0.7
  }),
  effectiveLandCoverage: Object.freeze({
    min: 0.48,
    max: 0.72
  }),
  maxHeight: Object.freeze({
    min: 0.4,
    max: 1
  }),
  islandCompactness: Object.freeze({
    min: 0.4,
    max: 1
  }),
  sliders: Object.freeze({
    relief: Object.freeze({
      min: 0.75,
      max: 1
    }),
    maxHeight: Object.freeze({
      min: 0.5,
      max: 1
    }),
    ruggedness: Object.freeze({
      min: 0.75,
      max: 1
    })
  }),
  seaLevelBiasLandDelta: 0.02
} as const);

export const getEffectiveLandCoverageTarget = (
  landCoverageTarget: number,
  seaLevelBias: number
): number => {
  const configuredTarget = clamp(
    landCoverageTarget,
    TERRAIN_GENERATION_LIMITS.landCoverageTarget.min,
    TERRAIN_GENERATION_LIMITS.landCoverageTarget.max
  );
  const normalizedBias = clamp(seaLevelBias, 0, 1);
  const landBias =
    (0.5 - normalizedBias)
    * 2
    * TERRAIN_GENERATION_LIMITS.seaLevelBiasLandDelta;
  return clamp(
    configuredTarget + landBias,
    TERRAIN_GENERATION_LIMITS.effectiveLandCoverage.min,
    TERRAIN_GENERATION_LIMITS.effectiveLandCoverage.max
  );
};
