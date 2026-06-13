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

export type StaticHydrologyOverflowFailureReason =
  | "invalid-start"
  | "cycle"
  | "dead-end"
  | "max-steps"
  | "source-lake-lap";

export type StaticHydrologyWaterfallRejectReason =
  | "coast-proximity"
  | "drop-small"
  | "flow-small"
  | "spacing"
  | "max-count";

export type StaticHydrologyFeatureClass =
  | "none"
  | "sheet-flow"
  | "channel"
  | "river"
  | "lake"
  | "lake-outlet"
  | "waterfall-lip"
  | "waterfall-runout"
  | "river-mouth"
  | "failed-overflow";

export type StaticHydrologyFeatureCounts = Record<StaticHydrologyFeatureClass, number>;

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
  terminalReached: boolean;
  failureReason?: StaticHydrologyOverflowFailureReason;
};

export type StaticHydrologyDebugWaterfallEvent = {
  kind: "hydrology:waterfall";
  accepted: boolean;
  waterfall: StaticHydrologyWaterfall;
  reason?: StaticHydrologyWaterfallRejectReason;
};

export type StaticHydrologyDebugClassificationEvent = {
  kind: "hydrology:classification";
  counts: StaticHydrologyFeatureCounts;
  terminalRoutes: number;
  failedRoutes: number;
  waterfallCandidates: number;
};

export type StaticHydrologyDebugEvent =
  | StaticHydrologyDebugCandidateEvent
  | StaticHydrologyDebugRejectEvent
  | StaticHydrologyDebugLakeEvent
  | StaticHydrologyDebugOverflowEvent
  | StaticHydrologyDebugWaterfallEvent
  | StaticHydrologyDebugClassificationEvent;

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
  hydrologyFeatureClass: Uint8Array;
  hydrologyFeatureCounts: StaticHydrologyFeatureCounts;
  lakes: StaticHydrologyLake[];
  waterfalls: StaticHydrologyWaterfall[];
  rejectedLakeCandidates: StaticHydrologyRejectSummary;
  rejectedWaterfallCandidates: number;
};
