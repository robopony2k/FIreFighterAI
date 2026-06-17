import type { Point } from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";
import type {
  RoadDiagnosticRouteGroup,
  RoadDiagnosticTuning
} from "../../roads/types/roadDiagnosticTuning.js";
import type { RoadPathDebugEvent } from "../../roads/types/roadPathDebugTypes.js";
import type {
  RoadPathDiagnosticRouteReason,
  RoadPathDiagnosticRouteType
} from "../../roads/types/roadPathDebugTypes.js";

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
  maxGradeRelaxationPasses?: number | null;
  allowBridgeFirstRetry?: boolean;
  maxPathLengthMultiplier?: number | null;
  diagnosticRouteGroup?: RoadDiagnosticRouteGroup;
  diagnosticRouteId?: string;
  diagnosticRouteLabel?: string;
  diagnosticRouteType?: RoadPathDiagnosticRouteType;
  diagnosticRouteReason?: RoadPathDiagnosticRouteReason;
  searchBounds?: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
};

export type SettlementRoadDiagnosticRouteStats = {
  attempts: number;
  results: number;
  found: number;
  failed: number;
  budgetAborted: number;
  totalElapsedMs: number;
  maxVisitedNodes: number;
  maxSearchNodeVisits: number;
  lastPathLength: number;
  lastFailureReason: string | null;
};

export type SettlementRoadAdapter = {
  carveRoad: (state: WorldState, start: Point, end: Point, options?: SettlementRoadOptions) => boolean;
  carveRoadAsync?: (state: WorldState, start: Point, end: Point, options?: SettlementRoadOptions) => Promise<boolean>;
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
  carveRoadDetailedAsync?: (
    state: WorldState,
    start: Point,
    end: Point,
    options?: SettlementRoadOptions
  ) => Promise<{
    carved: boolean;
    path: Point[];
    bridgeTileIndices: number[];
  }>;
  carveRoadPath?: (
    state: WorldState,
    path: Point[],
    bridgeTileIndices?: number[],
    options?: Pick<SettlementRoadOptions, "diagnosticRouteGroup" | "diagnosticRouteId" | "diagnosticRouteLabel">
  ) => boolean;
  carveRoadSequence?: (
    state: WorldState,
    segments: Array<{ start: Point; end: Point; options?: SettlementRoadOptions }>
  ) => boolean;
  carveRoadSequenceAsync?: (
    state: WorldState,
    segments: Array<{ start: Point; end: Point; options?: SettlementRoadOptions }>
  ) => Promise<boolean>;
  collectRoadTiles: (state: WorldState) => Point[];
  collectConnectedRoadNeighbors: (state: WorldState, x: number, y: number) => Point[];
  findNearestRoadTile: (state: WorldState, origin: Point) => Point;
  clearRoadEdges: (state: WorldState) => void;
  backfillRoadEdgesFromAdjacency: (state: WorldState) => void;
  pruneRoadDiagonalStubs: (state: WorldState) => void;
  recordGeneratedJunctions?: (count: number) => void;
  recordConnectorCacheSkip?: (count?: number) => void;
  emitDiagnosticEvent?: (event: RoadPathDebugEvent) => void;
  getDiagnosticRouteStats?: (routeId: string) => SettlementRoadDiagnosticRouteStats;
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
  roadMaxGrade?: number;
  settlementPreGrowthYears?: number;
  futureGrowthPlanYears?: number;
  roadDiagnosticTuning?: RoadDiagnosticTuning;
};
