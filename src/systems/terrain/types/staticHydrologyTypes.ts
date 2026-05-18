export type StaticHydrologyLake = {
  id: number;
  tiles: number[];
  surfaceLevel: number;
  outletIndex: number;
  outletTargetIndex: number;
  inflowRiverTiles: number[];
  outflowRiverTile: number;
  basinSeedIndex: number;
  rainfallScore: number;
  runoffScore: number;
  maxDepth: number;
};

export type StaticHydrologyWaterfall = {
  sourceIndex: number;
  targetIndex: number;
  drop: number;
  flowScore: number;
  lakeId: number;
};

export type StaticHydrologyRejectReason =
  | "ocean-proximity"
  | "elevation-range"
  | "weak-rainfall"
  | "weak-runoff"
  | "area-small"
  | "area-large"
  | "ocean-connected"
  | "weak-basin"
  | "depth-small"
  | "no-outlet"
  | "overlap";

export type StaticHydrologyRejectSummary = Partial<Record<StaticHydrologyRejectReason, number>>;

export type StaticHydrologyFields = {
  rainfall: Float32Array;
  runoff: Float32Array;
  flow: Float32Array;
};

export type StaticHydrologyResult = StaticHydrologyFields & {
  lakeMask: Uint16Array;
  lakeSurface: Float32Array;
  lakeOutletMask: Uint8Array;
  riverLakeEntryMask: Uint8Array;
  riverLakeExitMask: Uint8Array;
  waterfallSourceMask: Uint8Array;
  waterfallTarget: Int32Array;
  waterfallDrop: Float32Array;
  lakes: StaticHydrologyLake[];
  waterfalls: StaticHydrologyWaterfall[];
  rejectedLakeCandidates: StaticHydrologyRejectSummary;
  rejectedWaterfallCandidates: number;
};
