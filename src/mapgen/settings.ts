export type BiomeClassifierMode = "legacy" | "seedSpread";

export type RoadTopologyMode = "eight_dir";

export type TerrainArchetypeMode = "MASSIF" | "LONG_SPINE" | "TWIN_BAY" | "SHELF";

export type RoadGenSettings = {
  topology: RoadTopologyMode;
  diagonalPenalty: number;
  pruneRedundantDiagonals: boolean;
  bridgeTransitions: boolean;
};

export type MapGenSettings = {
  cellSizeM: number;
  worldOffsetXM: number;
  worldOffsetYM: number;
  microScaleM: number;
  elevationScale: number;
  elevationExponent: number;
  heightScaleMultiplier: number;
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
  biomeClassifierMode: BiomeClassifierMode;
  road: RoadGenSettings;
  terrainArchetype: TerrainArchetypeMode;
  relief: number;
  ruggedness: number;
  coastComplexity: number;
  waterLevel: number;
  landCoverageTarget: number;
  seaLevelBias: number;
  riverIntensity: number;
  vegetationDensity: number;
  townDensity: number;
  bridgeAllowance: number;
  interiorRise: number;
  maxHeight: number;
  embayment: number;
  anisotropy: number;
  asymmetry: number;
  ridgeAlignment: number;
  uplandDistribution: number;
  islandCompactness: number;
  ridgeFrequency: number;
  basinStrength: number;
  coastalShelfWidth: number;
  erosionDetailStrength: number;
  erosionDetailScaleM: number;
  erosionDetailOctaves: number;
  erosionSlopeStrength: number;
  erosionBranchStrength: number;
  erosionCoastFade: number;
  erosionSlopeMaskMin: number;
  erosionSlopeMaskMax: number;
  skipCarving: boolean;
  riverBudget: number;
  settlementSpacing: number;
  settlementPreGrowthYears: number;
  roadStrictness: number;
  forestPatchiness: number;
};

export const DEFAULT_ROAD_GEN_SETTINGS: RoadGenSettings = {
  topology: "eight_dir",
  diagonalPenalty: 0.18,
  pruneRedundantDiagonals: true,
  bridgeTransitions: true
};

export const DEFAULT_MAP_GEN_SETTINGS: MapGenSettings = {
  cellSizeM: 10,
  worldOffsetXM: 0,
  worldOffsetYM: 0,
  microScaleM: 40,
  elevationScale: 0.7,
  elevationExponent: 1.3,
  heightScaleMultiplier: 1,
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
  riverWaterBias: 0.18,
  biomeClassifierMode: "seedSpread",
  road: { ...DEFAULT_ROAD_GEN_SETTINGS },
  terrainArchetype: "MASSIF",
  relief: 0.7,
  ruggedness: 0.55,
  coastComplexity: 0.42,
  waterLevel: 0.34,
  landCoverageTarget: 0.64,
  seaLevelBias: 0.5,
  riverIntensity: 0.45,
  vegetationDensity: 0.56,
  townDensity: 0.48,
  bridgeAllowance: 0.18,
  interiorRise: 0.78,
  maxHeight: 0.6,
  embayment: 0.28,
  anisotropy: 0.32,
  asymmetry: 0.46,
  ridgeAlignment: 0.34,
  uplandDistribution: 0.42,
  islandCompactness: 0.72,
  ridgeFrequency: 0.34,
  basinStrength: 0.3,
  coastalShelfWidth: 0.46,
  erosionDetailStrength: 0.014,
  erosionDetailScaleM: 220,
  erosionDetailOctaves: 4,
  erosionSlopeStrength: 1.5,
  erosionBranchStrength: 1.25,
  erosionCoastFade: 0.035,
  erosionSlopeMaskMin: 0.005,
  erosionSlopeMaskMax: 0.05,
  skipCarving: false,
  riverBudget: 0.44,
  settlementSpacing: 0.62,
  settlementPreGrowthYears: 20,
  roadStrictness: 0.56,
  forestPatchiness: 0.42
};
