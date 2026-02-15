export type MapGenSettings = {
  cellSizeM: number;
  worldOffsetXM: number;
  worldOffsetYM: number;
  microScaleM: number;
  elevationScale: number;
  elevationExponent: number;
  mountainScale: number;
  ridgeStrength: number;
  valleyDepth: number;
  forestMacroScale: number;
  forestDetailScale: number;
  forestThreshold: number;
  highlandForestElevation: number;
  meadowScale: number;
  meadowThreshold: number;
  meadowStrength: number;
  grassCanopyBase: number;
  grassCanopyRange: number;
  waterCoverage: number;
  baseWaterThreshold: number;
  edgeWaterBias: number;
  riverCount: number;
  riverWaterBias: number;
};

export const DEFAULT_MAP_GEN_SETTINGS: MapGenSettings = {
  cellSizeM: 10,
  worldOffsetXM: 0,
  worldOffsetYM: 0,
  microScaleM: 40,
  elevationScale: 0.7,
  elevationExponent: 1.3,
  mountainScale: 1.0,
  ridgeStrength: 0.08,
  valleyDepth: 1.1,
  forestMacroScale: 26,
  forestDetailScale: 12,
  forestThreshold: 0.62,
  highlandForestElevation: 0.74,
  meadowScale: 22,
  meadowThreshold: 0.58,
  meadowStrength: 0.75,
  grassCanopyBase: 0.05,
  grassCanopyRange: 0.22,
  waterCoverage: 0.32,
  baseWaterThreshold: 0.14,
  edgeWaterBias: 0.14,
  riverCount: 0,
  riverWaterBias: 0.18
};
