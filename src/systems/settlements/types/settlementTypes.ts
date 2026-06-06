import type { Point } from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";

export type SettlementRoadBridgePolicy = "allow" | "never";
export type SettlementRoadPathMode = "normal" | "switchback" | "mountainPass";

export type SettlementRoadOptions = {
  bridgePolicy?: SettlementRoadBridgePolicy;
  heightScaleMultiplier?: number;
  diagonalPenalty?: number;
  gradeLimitStart?: number;
  gradeLimitRelaxStep?: number;
  gradeLimitMax?: number;
  slopePenaltyWeight?: number;
  crossfallLimitStart?: number;
  crossfallLimitRelaxStep?: number;
  crossfallLimitMax?: number;
  crossfallPenaltyWeight?: number;
  gradeChangeLimitStart?: number;
  gradeChangeLimitRelaxStep?: number;
  gradeChangeLimitMax?: number;
  gradeChangePenaltyWeight?: number;
  riverBlockDistance?: number;
  riverPenaltyDistance?: number;
  riverPenaltyWeight?: number;
  turnPenalty?: number;
  bridgeStepCost?: number;
  bridgeMaxConsecutiveWater?: number;
  bridgeMaxWaterTilesPerPath?: number;
  preferredAngleDeg?: number;
  softAngleDeg?: number;
  avoidAngleDeg?: number;
  fallbackAngleDeg?: number;
  anglePenaltyWeight?: number;
  straightClimbPenaltyWeight?: number;
  contourTurnReliefWeight?: number;
  allowMountainPassFallback?: boolean;
  pathMode?: SettlementRoadPathMode;
  maxSearchNodeVisits?: number;
  searchBounds?: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
};

export type SettlementRoadAdapter = {
  carveRoad: (state: WorldState, start: Point, end: Point, options?: SettlementRoadOptions) => boolean;
  carveRoadDetailed?: (
    state: WorldState,
    start: Point,
    end: Point,
    options?: SettlementRoadOptions
  ) => {
    carved: boolean;
    path: Point[];
    bridgeTileIndices: number[];
  };
  carveRoadPath?: (state: WorldState, path: Point[], bridgeTileIndices?: number[]) => boolean;
  carveRoadSequence?: (
    state: WorldState,
    segments: Array<{ start: Point; end: Point; options?: SettlementRoadOptions }>
  ) => boolean;
  collectRoadTiles: (state: WorldState) => Point[];
  collectConnectedRoadNeighbors: (state: WorldState, x: number, y: number) => Point[];
  findNearestRoadTile: (state: WorldState, origin: Point) => Point;
  clearRoadEdges: (state: WorldState) => void;
  backfillRoadEdgesFromAdjacency: (state: WorldState) => void;
  pruneRoadDiagonalStubs: (state: WorldState) => void;
  recordGeneratedJunctions?: (count: number) => void;
  recordConnectorCacheSkip?: (count?: number) => void;
};

export type SettlementGrowthPlanEntryStatus = "pending" | "consumed" | "skipped";

export type SettlementGrowthRoadSegment = {
  start: Point;
  end: Point;
  options?: SettlementRoadOptions;
  path?: Point[];
  bridgeTileIndices?: number[];
};

export type SettlementGrowthTerrainEdit = {
  index: number;
  elevation: number;
};

export type SettlementGrowthPlanEntry = {
  townId: number;
  anchorIndex: number;
  styleSeed: number;
  houseValue: number;
  houseResidents: number;
  roadSegments: SettlementGrowthRoadSegment[];
  terrainEdits: SettlementGrowthTerrainEdit[];
  plannedYear: number;
  sequence: number;
  status: SettlementGrowthPlanEntryStatus;
};

export type SettlementGrowthPlan = {
  entries: SettlementGrowthPlanEntry[];
  nextExpansionIndexByTown: number[];
  plannedYears: number;
  consumedEntries: number;
  skippedEntries: number;
  runtimeFallbackReservations: number;
};

export type SettlementPlacementResult = {
  generatedRoads: boolean;
  diagonalPenalty?: number;
  pruneRedundantDiagonals?: boolean;
  bridgeTransitions?: boolean;
  heightScaleMultiplier?: number;
  townDensity?: number;
  bridgeAllowance?: number;
  settlementSpacing?: number;
  roadStrictness?: number;
  settlementPreGrowthYears?: number;
};
