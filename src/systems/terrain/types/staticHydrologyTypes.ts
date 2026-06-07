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
  spillElevation?: number;
  basinAreaTiles?: number;
  catchmentRunoff?: number;
  overflowTargetIndex?: number;
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

export type StaticHydrologyDebugCandidateEvent = {
  kind: "hydrology:candidate";
  basinSeedIndex: number;
  area: number;
  footprintTiles: number;
  maxDepth: number;
  spillElevation: number;
  rainfallScore: number;
  runoffScore: number;
  score: number;
  outletIndex: number;
  outletTargetIndex: number;
};

export type StaticHydrologyDebugRejectEvent = {
  kind: "hydrology:reject";
  basinSeedIndex: number;
  reason: StaticHydrologyRejectReason;
  score: number;
  footprintTiles: number;
};

export type StaticHydrologyDebugLakeEvent = {
  kind: "hydrology:lake";
  lake: StaticHydrologyLake;
};

export type StaticHydrologyDebugOverflowEvent = {
  kind: "hydrology:overflow";
  lakeId: number;
  outletTargetIndex: number;
  tiles: number[];
  reachedLakeId: number;
  reachedOcean: boolean;
  reachedExistingRiver: boolean;
};

export type StaticHydrologyDebugWaterfallEvent = {
  kind: "hydrology:waterfall";
  accepted: boolean;
  waterfall: StaticHydrologyWaterfall;
};

export type StaticHydrologyDebugEvent =
  | StaticHydrologyDebugCandidateEvent
  | StaticHydrologyDebugRejectEvent
  | StaticHydrologyDebugLakeEvent
  | StaticHydrologyDebugOverflowEvent
  | StaticHydrologyDebugWaterfallEvent;

export type StaticHydrologyDebugHooks = {
  emit?: (event: StaticHydrologyDebugEvent) => void | Promise<void>;
  yieldIfNeeded?: () => Promise<boolean>;
  checkCancelled?: () => void;
};

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
