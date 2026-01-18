export type MapGenSettings = {
  forestMacroScale: number;
  forestDetailScale: number;
  forestThreshold: number;
  highlandForestElevation: number;
  meadowScale: number;
  meadowThreshold: number;
  meadowStrength: number;
  grassCanopyBase: number;
  grassCanopyRange: number;
  baseWaterThreshold: number;
  edgeWaterBias: number;
  riverWaterBias: number;
};

export const DEFAULT_MAP_GEN_SETTINGS: MapGenSettings = {
  forestMacroScale: 18,
  forestDetailScale: 8,
  forestThreshold: 0.66,
  highlandForestElevation: 0.74,
  meadowScale: 22,
  meadowThreshold: 0.58,
  meadowStrength: 0.75,
  grassCanopyBase: 0.05,
  grassCanopyRange: 0.22,
  baseWaterThreshold: 0.14,
  edgeWaterBias: 0.14,
  riverWaterBias: 0.18
};
