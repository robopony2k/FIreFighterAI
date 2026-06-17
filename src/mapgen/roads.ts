import type { Point, RNG } from "../core/types.js";
import type { WorldState } from "../core/state.js";
import { inBounds, indexFor } from "../core/grid.js";
import { getTerrainHeightScale } from "../core/terrainScale.js";
import { applyFuel } from "../core/tiles.js";
import { clearVegetationState } from "../core/vegetation.js";
import { computeLocalRenderedSlopeAngleDeg, computeRenderedSlopeAngleDeg } from "../shared/terrainSlope.js";
import { planRoadPathBidirectionalStreamer } from "../systems/roads/sim/roadBidirectionalStreamer.js";
import { planRoadPathDijkstra } from "../systems/roads/sim/roadDijkstraPlanner.js";
import {
  cloneRoadPathPlannerNodeState,
  createInitialRoadPathPlannerNodeState,
  getRoadStreamerJoinRadiusForMode
} from "../systems/roads/sim/roadTerrainCost.js";
import { scoreRoadPlannerStep, type RoadPathMode } from "../systems/roads/sim/roadPathPlanner.js";
import type {
  RoadPathPlannerDirection,
  RoadPathPlannerFront,
  RoadPathPlannerFailureReason,
  RoadPathPlannerJoinResult,
  RoadPathPlannerNodeState,
  RoadPathPlannerStepResult,
  RoadStreamerDestinationSeed
} from "../systems/roads/types/roadPathPlannerTypes.js";
import type { RoadPathDebugEvent, RoadPathDebugHooks } from "../systems/roads/types/roadPathDebugTypes.js";
import type { RoadDiagnosticRouteGroup } from "../systems/roads/types/roadDiagnosticTuning.js";
import { yieldToNextFrame } from "./pipeline/yieldController.js";

export const ROAD_GRADE_LIMIT_START = 0.09;
export const ROAD_GRADE_LIMIT_RELAX_STEP = 0.015;
export const ROAD_GRADE_LIMIT_MAX = 0.13;
const ROAD_SWITCHBACK_GRADE_LIMIT_START = 0.12;
const ROAD_SWITCHBACK_GRADE_LIMIT_RELAX_STEP = 0.02;
const ROAD_SWITCHBACK_GRADE_LIMIT_MAX = 0.22;
export const ROAD_SLOPE_PENALTY_WEIGHT = 22;
export const ROAD_CROSSFALL_LIMIT_START = 0.06;
export const ROAD_CROSSFALL_LIMIT_RELAX_STEP = 0.012;
export const ROAD_CROSSFALL_LIMIT_MAX = 0.1;
const ROAD_SWITCHBACK_CROSSFALL_LIMIT_START = 0.08;
const ROAD_SWITCHBACK_CROSSFALL_LIMIT_RELAX_STEP = 0.018;
const ROAD_SWITCHBACK_CROSSFALL_LIMIT_MAX = 0.16;
export const ROAD_CROSSFALL_PENALTY_WEIGHT = 18;
export const ROAD_GRADE_CHANGE_LIMIT_START = 0.06;
export const ROAD_GRADE_CHANGE_LIMIT_RELAX_STEP = 0.012;
export const ROAD_GRADE_CHANGE_LIMIT_MAX = 0.1;
const ROAD_SWITCHBACK_GRADE_CHANGE_LIMIT_START = 0.08;
const ROAD_SWITCHBACK_GRADE_CHANGE_LIMIT_RELAX_STEP = 0.018;
const ROAD_SWITCHBACK_GRADE_CHANGE_LIMIT_MAX = 0.16;
export const ROAD_GRADE_CHANGE_PENALTY_WEIGHT = 16;
export const ROAD_RIVER_BLOCK_DIST = 1;
export const ROAD_RIVER_PENALTY_DIST = 3;
export const ROAD_RIVER_PENALTY_WEIGHT = 8;
export const ROAD_TURN_PENALTY = 0.2;
export const ROAD_DIAGONAL_PENALTY = 0.18;
export const ROAD_EXISTING_SEGMENT_COST_MULTIPLIER = 0.3;
const ROAD_SWITCHBACK_TURN_PENALTY = 0.04;
const ROAD_SWITCHBACK_DIAGONAL_PENALTY = 0.04;
export const ROAD_BRIDGE_STEP_COST = 24;
export const ROAD_BRIDGE_MAX_CONSEC_WATER = 3;
export const ROAD_BRIDGE_MAX_WATER_TILES_PER_PATH = 6;
const ROAD_SWITCHBACK_RELIEF_WEIGHT = 3.25;
export const ROAD_PREFERRED_ANGLE_DEG = 12;
export const ROAD_SOFT_ANGLE_DEG = 18;
export const ROAD_AVOID_ANGLE_DEG = 28;
export const ROAD_FALLBACK_ANGLE_DEG = 38;
export const ROAD_ANGLE_PENALTY_WEIGHT = 0.34;
export const ROAD_STRAIGHT_CLIMB_PENALTY_WEIGHT = 0.42;
export const ROAD_CONTOUR_TURN_RELIEF_WEIGHT = 0.72;
const ROAD_DEBUG_PROGRESS_NODE_STRIDE = 2048;
const ROAD_DEBUG_PROGRESS_MIN_MS = 250;

let roadPathDebugHooks: RoadPathDebugHooks | null = null;
let nextRoadPathDebugAttemptId = 1;

export const setRoadPathDebugHooks = (hooks: RoadPathDebugHooks | null): void => {
  roadPathDebugHooks = hooks;
};

export type RoadDiagnosticRouteStats = {
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

const createEmptyRoadDiagnosticRouteStats = (): RoadDiagnosticRouteStats => ({
  attempts: 0,
  results: 0,
  found: 0,
  failed: 0,
  budgetAborted: 0,
  totalElapsedMs: 0,
  maxVisitedNodes: 0,
  maxSearchNodeVisits: 0,
  lastPathLength: 0,
  lastFailureReason: null
});

const roadDiagnosticRouteStats = new Map<string, RoadDiagnosticRouteStats>();

const getMutableRoadDiagnosticRouteStats = (routeId: string): RoadDiagnosticRouteStats => {
  const existing = roadDiagnosticRouteStats.get(routeId);
  if (existing) {
    return existing;
  }
  const created = createEmptyRoadDiagnosticRouteStats();
  roadDiagnosticRouteStats.set(routeId, created);
  return created;
};

export const getRoadDiagnosticRouteStats = (routeId: string): RoadDiagnosticRouteStats => ({
  ...(
    roadDiagnosticRouteStats.get(routeId) ??
    createEmptyRoadDiagnosticRouteStats()
  )
});

export const emitRoadPathDebugEvent = (event: RoadPathDebugEvent): void => {
  if (event.kind === "road:attempt" && event.diagnosticRouteId) {
    const stats = getMutableRoadDiagnosticRouteStats(event.diagnosticRouteId);
    stats.attempts += 1;
    stats.maxSearchNodeVisits = Math.max(stats.maxSearchNodeVisits, event.maxSearchNodeVisits);
  } else if (event.kind === "road:result" && event.diagnosticRouteId) {
    const stats = getMutableRoadDiagnosticRouteStats(event.diagnosticRouteId);
    stats.results += 1;
    if (event.found) {
      stats.found += 1;
    } else {
      stats.failed += 1;
    }
    if (event.budgetAborted) {
      stats.budgetAborted += 1;
    }
    stats.totalElapsedMs += event.elapsedMs;
    stats.maxVisitedNodes = Math.max(stats.maxVisitedNodes, event.visitedNodes);
    stats.lastPathLength = event.pathLength;
    stats.lastFailureReason = event.failureReason ?? (event.found ? null : "no-route");
  }
  roadPathDebugHooks?.emit?.(event);
};

type RoadBridgePolicy = "never" | "allow";

export type RoadTileBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export type RoadPathOptions = {
  allowWater?: boolean;
  bridgePolicy?: RoadBridgePolicy;
  searchBounds?: RoadTileBounds;
  heightScaleMultiplier?: number;
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
  diagonalPenalty?: number;
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
  pathMode?: RoadPathMode;
  maxSearchNodeVisits?: number;
  maxGradeRelaxationPasses?: number | null;
  allowBridgeFirstRetry?: boolean;
  maxPathLengthMultiplier?: number | null;
  useBidirectionalStreamer?: boolean;
  diagnosticRouteGroup?: RoadDiagnosticRouteGroup;
  diagnosticRouteId?: string;
  diagnosticRouteLabel?: string;
};

type RoadPathOptionsResolved = {
  bridgePolicy: RoadBridgePolicy;
  searchBounds: RoadTileBounds | null;
  heightScaleMultiplier: number;
  gradeLimitStart: number;
  gradeLimitRelaxStep: number;
  gradeLimitMax: number;
  slopePenaltyWeight: number;
  crossfallLimitStart: number;
  crossfallLimitRelaxStep: number;
  crossfallLimitMax: number;
  crossfallPenaltyWeight: number;
  gradeChangeLimitStart: number;
  gradeChangeLimitRelaxStep: number;
  gradeChangeLimitMax: number;
  gradeChangePenaltyWeight: number;
  riverBlockDistance: number;
  riverPenaltyDistance: number;
  riverPenaltyWeight: number;
  turnPenalty: number;
  diagonalPenalty: number;
  bridgeStepCost: number;
  bridgeMaxConsecutiveWater: number;
  bridgeMaxWaterTilesPerPath: number;
  preferredAngleDeg: number;
  softAngleDeg: number;
  avoidAngleDeg: number;
  fallbackAngleDeg: number;
  anglePenaltyWeight: number;
  straightClimbPenaltyWeight: number;
  contourTurnReliefWeight: number;
  allowMountainPassFallback: boolean;
  pathMode: RoadPathMode;
  maxSearchNodeVisits: number;
  maxGradeRelaxationPasses: number | null;
  allowBridgeFirstRetry: boolean;
  maxPathLengthMultiplier: number | null;
  useBidirectionalStreamer: boolean;
  diagnosticRouteGroup: RoadDiagnosticRouteGroup;
  diagnosticRouteId?: string;
  diagnosticRouteLabel?: string;
};

type RoadCarveOptions = RoadPathOptions & {
  allowBridge?: boolean;
};

export type RoadCarveSegment = {
  start: Point;
  end: Point;
  options?: RoadCarveOptions;
};

export type RoadCarveResult = {
  carved: boolean;
  bounds: RoadTileBounds | null;
  pathLength: number;
  path: Point[];
  bridgeTileIndices: number[];
};

type RoadPathResult = {
  path: Point[];
  bridgeTileIndices: number[];
  maxGrade: number;
  maxCrossfall: number;
  maxGradeChange: number;
  maxAngleDeg: number;
  meanAngleDeg: number;
  highAngleStepCount: number;
  minRiverClearance: number;
  bridgeSegments: number;
  mountainPassFallback: boolean;
  switchbackTurnCount: number;
  switchbackRoute: boolean;
  hairpinGradeDiscountCount: number;
  longStraightSteepSegmentCount: number;
};

type RiverDistanceCache = {
  maskRef: Uint8Array;
  distances: Int16Array;
};

type RoadPathFailureCache = {
  revision: number;
  failures: Set<string>;
};

export type RoadGenerationStats = {
  pathsAttempted: number;
  pathsFound: number;
  maxRealizedGrade: number;
  maxRealizedCrossfall: number;
  maxRealizedGradeChange: number;
  maxRealizedAngleDeg: number;
  meanRealizedAngleDeg: number;
  highAngleStepCount: number;
  minRiverClearance: number;
  bridgeSegments: number;
  mountainPassFallbackCount: number;
  switchbackTurnCount: number;
  switchbackRouteAttempts: number;
  switchbackRouteCount: number;
  hairpinGradeDiscountCount: number;
  connectorArtifactPrunedEdgeCount: number;
  longStraightSteepSegmentCount: number;
  generatedJunctionCount: number;
  searchBudgetAbortCount: number;
  connectorCacheSkipCount: number;
};

export type RoadSurfaceMetrics = {
  maxRoadGrade: number;
  maxRoadCrossfall: number;
  maxRoadGradeChange: number;
  maxRoadAngleDeg: number;
  meanRoadAngleDeg: number;
  highAngleRoadStepCount: number;
  wallEdgeCount: number;
  maxRoadGradingDelta: number;
  longStraightSteepSegmentCount: number;
};

const ROAD_DIRS: Array<{ x: number; y: number; cost: number }> = [
  { x: 1, y: 0, cost: 1 },
  { x: -1, y: 0, cost: 1 },
  { x: 0, y: 1, cost: 1 },
  { x: 0, y: -1, cost: 1 },
  { x: 1, y: 1, cost: Math.SQRT2 },
  { x: -1, y: 1, cost: Math.SQRT2 },
  { x: 1, y: -1, cost: Math.SQRT2 },
  { x: -1, y: -1, cost: Math.SQRT2 }
];

export const ROAD_EDGE_N = 1 << 0;
export const ROAD_EDGE_E = 1 << 1;
export const ROAD_EDGE_S = 1 << 2;
export const ROAD_EDGE_W = 1 << 3;
export const ROAD_EDGE_NE = 1 << 4;
export const ROAD_EDGE_NW = 1 << 5;
export const ROAD_EDGE_SE = 1 << 6;
export const ROAD_EDGE_SW = 1 << 7;
export const ROAD_EDGE_CARDINAL_MASK = ROAD_EDGE_N | ROAD_EDGE_E | ROAD_EDGE_S | ROAD_EDGE_W;
export const ROAD_EDGE_DIAGONAL_MASK = ROAD_EDGE_NE | ROAD_EDGE_NW | ROAD_EDGE_SE | ROAD_EDGE_SW;

type RoadEdgeDir = {
  dx: number;
  dy: number;
  bit: number;
  opposite: number;
  diagonal: boolean;
};

export const ROAD_EDGE_DIRS: RoadEdgeDir[] = [
  { dx: 0, dy: -1, bit: ROAD_EDGE_N, opposite: ROAD_EDGE_S, diagonal: false },
  { dx: 1, dy: 0, bit: ROAD_EDGE_E, opposite: ROAD_EDGE_W, diagonal: false },
  { dx: 0, dy: 1, bit: ROAD_EDGE_S, opposite: ROAD_EDGE_N, diagonal: false },
  { dx: -1, dy: 0, bit: ROAD_EDGE_W, opposite: ROAD_EDGE_E, diagonal: false },
  { dx: 1, dy: -1, bit: ROAD_EDGE_NE, opposite: ROAD_EDGE_SW, diagonal: true },
  { dx: -1, dy: -1, bit: ROAD_EDGE_NW, opposite: ROAD_EDGE_SE, diagonal: true },
  { dx: 1, dy: 1, bit: ROAD_EDGE_SE, opposite: ROAD_EDGE_NW, diagonal: true },
  { dx: -1, dy: 1, bit: ROAD_EDGE_SW, opposite: ROAD_EDGE_NE, diagonal: true }
];

const getRoadEdgeDir = (dx: number, dy: number): RoadEdgeDir | null => {
  for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
    const dir = ROAD_EDGE_DIRS[i];
    if (dir.dx === dx && dir.dy === dy) {
      return dir;
    }
  }
  return null;
};

const getPathBounds = (path: readonly Point[]): RoadTileBounds | null => {
  if (path.length === 0) {
    return null;
  }
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < path.length; i += 1) {
    const point = path[i]!;
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, maxX, minY, maxY };
};

export const expandRoadTileBounds = (
  state: WorldState,
  bounds: RoadTileBounds,
  padding: number
): RoadTileBounds => {
  const pad = Math.max(0, Math.floor(padding));
  return {
    minX: Math.max(0, bounds.minX - pad),
    maxX: Math.min(state.grid.cols - 1, bounds.maxX + pad),
    minY: Math.max(0, bounds.minY - pad),
    maxY: Math.min(state.grid.rows - 1, bounds.maxY + pad)
  };
};

export const mergeRoadTileBounds = (
  left: RoadTileBounds | null,
  right: RoadTileBounds | null
): RoadTileBounds | null => {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return {
    minX: Math.min(left.minX, right.minX),
    maxX: Math.max(left.maxX, right.maxX),
    minY: Math.min(left.minY, right.minY),
    maxY: Math.max(left.maxY, right.maxY)
  };
};

const isPointInRoadBounds = (point: Point, bounds: RoadTileBounds | null): boolean =>
  !bounds ||
  (point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY);

const riverDistanceCache = new WeakMap<WorldState, RiverDistanceCache>();
const roadNetworkRevisionByState = new WeakMap<WorldState, number>();
const roadPathFailureCacheByState = new WeakMap<WorldState, RoadPathFailureCache>();

const roadGenerationStats: RoadGenerationStats = {
  pathsAttempted: 0,
  pathsFound: 0,
  maxRealizedGrade: 0,
  maxRealizedCrossfall: 0,
  maxRealizedGradeChange: 0,
  maxRealizedAngleDeg: 0,
  meanRealizedAngleDeg: 0,
  highAngleStepCount: 0,
  minRiverClearance: Number.POSITIVE_INFINITY,
  bridgeSegments: 0,
  mountainPassFallbackCount: 0,
  switchbackTurnCount: 0,
  switchbackRouteAttempts: 0,
  switchbackRouteCount: 0,
  hairpinGradeDiscountCount: 0,
  connectorArtifactPrunedEdgeCount: 0,
  longStraightSteepSegmentCount: 0,
  generatedJunctionCount: 0,
  searchBudgetAbortCount: 0,
  connectorCacheSkipCount: 0
};

const resolveRoadPathOptions = (options: RoadPathOptions = {}): RoadPathOptionsResolved => {
  const bridgePolicy = options.bridgePolicy ?? (options.allowWater ? "allow" : "never");
  const gradeLimitStart = Math.max(0.01, options.gradeLimitStart ?? ROAD_GRADE_LIMIT_START);
  const gradeLimitRelaxStep = Math.max(0.001, options.gradeLimitRelaxStep ?? ROAD_GRADE_LIMIT_RELAX_STEP);
  const gradeLimitMax = Math.max(gradeLimitStart, options.gradeLimitMax ?? ROAD_GRADE_LIMIT_MAX);
  const crossfallLimitStart = Math.max(0.01, options.crossfallLimitStart ?? ROAD_CROSSFALL_LIMIT_START);
  const gradeChangeLimitStart = Math.max(0.01, options.gradeChangeLimitStart ?? ROAD_GRADE_CHANGE_LIMIT_START);
  const preferredAngleDeg = Math.max(0, options.preferredAngleDeg ?? ROAD_PREFERRED_ANGLE_DEG);
  const softAngleDeg = Math.max(preferredAngleDeg, options.softAngleDeg ?? ROAD_SOFT_ANGLE_DEG);
  const avoidAngleDeg = Math.max(softAngleDeg, options.avoidAngleDeg ?? ROAD_AVOID_ANGLE_DEG);
  const fallbackAngleDeg = Math.max(avoidAngleDeg, options.fallbackAngleDeg ?? ROAD_FALLBACK_ANGLE_DEG);
  return {
    bridgePolicy,
    searchBounds: options.searchBounds ?? null,
    heightScaleMultiplier: Math.max(0.1, options.heightScaleMultiplier ?? 1),
    gradeLimitStart,
    gradeLimitRelaxStep,
    gradeLimitMax,
    slopePenaltyWeight: Math.max(0, options.slopePenaltyWeight ?? ROAD_SLOPE_PENALTY_WEIGHT),
    crossfallLimitStart,
    crossfallLimitRelaxStep: Math.max(0.001, options.crossfallLimitRelaxStep ?? ROAD_CROSSFALL_LIMIT_RELAX_STEP),
    crossfallLimitMax: Math.max(crossfallLimitStart, options.crossfallLimitMax ?? ROAD_CROSSFALL_LIMIT_MAX),
    crossfallPenaltyWeight: Math.max(0, options.crossfallPenaltyWeight ?? ROAD_CROSSFALL_PENALTY_WEIGHT),
    gradeChangeLimitStart,
    gradeChangeLimitRelaxStep: Math.max(
      0.001,
      options.gradeChangeLimitRelaxStep ?? ROAD_GRADE_CHANGE_LIMIT_RELAX_STEP
    ),
    gradeChangeLimitMax: Math.max(gradeChangeLimitStart, options.gradeChangeLimitMax ?? ROAD_GRADE_CHANGE_LIMIT_MAX),
    gradeChangePenaltyWeight: Math.max(
      0,
      options.gradeChangePenaltyWeight ?? ROAD_GRADE_CHANGE_PENALTY_WEIGHT
    ),
    riverBlockDistance: Math.max(0, Math.round(options.riverBlockDistance ?? ROAD_RIVER_BLOCK_DIST)),
    riverPenaltyDistance: Math.max(0, Math.round(options.riverPenaltyDistance ?? ROAD_RIVER_PENALTY_DIST)),
    riverPenaltyWeight: Math.max(0, options.riverPenaltyWeight ?? ROAD_RIVER_PENALTY_WEIGHT),
    turnPenalty: Math.max(0, options.turnPenalty ?? ROAD_TURN_PENALTY),
    diagonalPenalty: Math.max(0, options.diagonalPenalty ?? ROAD_DIAGONAL_PENALTY),
    bridgeStepCost: Math.max(0, options.bridgeStepCost ?? ROAD_BRIDGE_STEP_COST),
    bridgeMaxConsecutiveWater: Math.max(1, Math.round(options.bridgeMaxConsecutiveWater ?? ROAD_BRIDGE_MAX_CONSEC_WATER)),
    bridgeMaxWaterTilesPerPath: Math.max(1, Math.round(options.bridgeMaxWaterTilesPerPath ?? ROAD_BRIDGE_MAX_WATER_TILES_PER_PATH)),
    preferredAngleDeg,
    softAngleDeg,
    avoidAngleDeg,
    fallbackAngleDeg,
    anglePenaltyWeight: Math.max(0, options.anglePenaltyWeight ?? ROAD_ANGLE_PENALTY_WEIGHT),
    straightClimbPenaltyWeight: Math.max(0, options.straightClimbPenaltyWeight ?? ROAD_STRAIGHT_CLIMB_PENALTY_WEIGHT),
    contourTurnReliefWeight: Math.max(0, options.contourTurnReliefWeight ?? ROAD_CONTOUR_TURN_RELIEF_WEIGHT),
    allowMountainPassFallback: options.allowMountainPassFallback ?? true,
    pathMode: options.pathMode ?? "normal",
    maxSearchNodeVisits: Math.max(0, Math.floor(options.maxSearchNodeVisits ?? 0)),
    maxGradeRelaxationPasses:
      typeof options.maxGradeRelaxationPasses === "number" && Number.isFinite(options.maxGradeRelaxationPasses)
        ? Math.max(1, Math.floor(options.maxGradeRelaxationPasses))
        : null,
    allowBridgeFirstRetry: options.allowBridgeFirstRetry ?? true,
    maxPathLengthMultiplier:
      typeof options.maxPathLengthMultiplier === "number" && Number.isFinite(options.maxPathLengthMultiplier)
        ? Math.max(1, options.maxPathLengthMultiplier)
        : null,
    useBidirectionalStreamer: options.useBidirectionalStreamer ?? false,
    diagnosticRouteGroup: options.diagnosticRouteGroup ?? "unknown",
    diagnosticRouteId: options.diagnosticRouteId,
    diagnosticRouteLabel: options.diagnosticRouteLabel
  };
};

const getRoadNetworkRevision = (state: WorldState): number => roadNetworkRevisionByState.get(state) ?? 0;

const bumpRoadNetworkRevision = (state: WorldState): void => {
  const nextRevision = getRoadNetworkRevision(state) + 1;
  roadNetworkRevisionByState.set(state, nextRevision);
  const cache = roadPathFailureCacheByState.get(state);
  if (cache) {
    cache.revision = nextRevision;
    cache.failures.clear();
  }
};

const getRoadPathFailureCache = (state: WorldState): RoadPathFailureCache => {
  const revision = getRoadNetworkRevision(state);
  const existing = roadPathFailureCacheByState.get(state);
  if (existing && existing.revision === revision) {
    return existing;
  }
  const cache = { revision, failures: new Set<string>() };
  roadPathFailureCacheByState.set(state, cache);
  return cache;
};

const roadBoundsKey = (bounds: RoadTileBounds | null): string =>
  bounds ? `${bounds.minX},${bounds.maxX},${bounds.minY},${bounds.maxY}` : "-";

const buildRoadPathFailureKey = (start: Point, end: Point, options: RoadPathOptionsResolved): string =>
  [
    start.x,
    start.y,
    end.x,
    end.y,
    options.bridgePolicy,
    options.pathMode,
    Number(options.allowMountainPassFallback),
    roadBoundsKey(options.searchBounds),
    options.maxSearchNodeVisits,
    options.gradeLimitStart,
    options.gradeLimitMax,
    options.crossfallLimitStart,
    options.crossfallLimitMax,
    options.gradeChangeLimitStart,
    options.gradeChangeLimitMax,
    options.avoidAngleDeg,
    options.fallbackAngleDeg,
    options.maxGradeRelaxationPasses ?? "default",
    options.maxPathLengthMultiplier?.toFixed(2) ?? "default",
    Number(options.allowBridgeFirstRetry)
  ].join(":");

const buildEmptyRoadPathResult = (): RoadPathResult => ({
  path: [],
  bridgeTileIndices: [],
  maxGrade: 0,
  maxCrossfall: 0,
  maxGradeChange: 0,
  maxAngleDeg: 0,
  meanAngleDeg: 0,
  highAngleStepCount: 0,
  minRiverClearance: Number.POSITIVE_INFINITY,
  bridgeSegments: 0,
  mountainPassFallback: false,
  switchbackTurnCount: 0,
  switchbackRoute: false,
  hairpinGradeDiscountCount: 0,
  longStraightSteepSegmentCount: 0
});

const rejectRoadPathForDetour = (
  result: RoadPathResult | null,
  start: Point,
  end: Point | null,
  options: RoadPathOptionsResolved
): RoadPathResult | null => {
  if (!result || !end || options.maxPathLengthMultiplier === null) {
    return result;
  }
  const straightDistance = Math.hypot(end.x - start.x, end.y - start.y);
  const maxPathLength = Math.max(8, Math.ceil(straightDistance * options.maxPathLengthMultiplier));
  return result.path.length > maxPathLength ? null : result;
};

const buildSwitchbackFallbackOptions = (options: RoadPathOptionsResolved): RoadPathOptionsResolved => ({
  ...options,
  gradeLimitStart: Math.max(options.gradeLimitStart, ROAD_SWITCHBACK_GRADE_LIMIT_START),
  gradeLimitRelaxStep: Math.max(options.gradeLimitRelaxStep, ROAD_SWITCHBACK_GRADE_LIMIT_RELAX_STEP),
  gradeLimitMax: Math.max(options.gradeLimitMax, ROAD_SWITCHBACK_GRADE_LIMIT_MAX),
  crossfallLimitStart: Math.max(options.crossfallLimitStart, ROAD_SWITCHBACK_CROSSFALL_LIMIT_START),
  crossfallLimitRelaxStep: Math.max(options.crossfallLimitRelaxStep, ROAD_SWITCHBACK_CROSSFALL_LIMIT_RELAX_STEP),
  crossfallLimitMax: Math.max(options.crossfallLimitMax, ROAD_SWITCHBACK_CROSSFALL_LIMIT_MAX),
  gradeChangeLimitStart: Math.max(options.gradeChangeLimitStart, ROAD_SWITCHBACK_GRADE_CHANGE_LIMIT_START),
  gradeChangeLimitRelaxStep: Math.max(options.gradeChangeLimitRelaxStep, ROAD_SWITCHBACK_GRADE_CHANGE_LIMIT_RELAX_STEP),
  gradeChangeLimitMax: Math.max(options.gradeChangeLimitMax, ROAD_SWITCHBACK_GRADE_CHANGE_LIMIT_MAX),
  turnPenalty: Math.min(options.turnPenalty, ROAD_SWITCHBACK_TURN_PENALTY),
  diagonalPenalty: Math.min(options.diagonalPenalty, ROAD_SWITCHBACK_DIAGONAL_PENALTY),
  anglePenaltyWeight: Math.max(options.anglePenaltyWeight, ROAD_ANGLE_PENALTY_WEIGHT * 1.4),
  straightClimbPenaltyWeight: Math.max(options.straightClimbPenaltyWeight, ROAD_STRAIGHT_CLIMB_PENALTY_WEIGHT * 1.35),
  contourTurnReliefWeight: Math.max(options.contourTurnReliefWeight, ROAD_CONTOUR_TURN_RELIEF_WEIGHT * 1.2),
  pathMode: "switchback"
});

const buildMountainPassFallbackOptions = (options: RoadPathOptionsResolved): RoadPathOptionsResolved => ({
  ...buildSwitchbackFallbackOptions(options),
  gradeLimitStart: Math.max(options.gradeLimitStart, Math.min(options.gradeLimitMax, ROAD_SWITCHBACK_GRADE_LIMIT_START)),
  gradeLimitRelaxStep: Math.max(options.gradeLimitRelaxStep, 0.015),
  gradeLimitMax: Math.max(options.gradeLimitMax, ROAD_SWITCHBACK_GRADE_LIMIT_MAX),
  crossfallLimitMax: Math.max(options.crossfallLimitMax, ROAD_SWITCHBACK_CROSSFALL_LIMIT_MAX),
  gradeChangeLimitMax: Math.max(options.gradeChangeLimitMax, ROAD_SWITCHBACK_GRADE_CHANGE_LIMIT_MAX),
  avoidAngleDeg: options.fallbackAngleDeg,
  anglePenaltyWeight: Math.max(options.anglePenaltyWeight, ROAD_ANGLE_PENALTY_WEIGHT * 2.8),
  straightClimbPenaltyWeight: Math.max(options.straightClimbPenaltyWeight, ROAD_STRAIGHT_CLIMB_PENALTY_WEIGHT * 2.2),
  contourTurnReliefWeight: Math.max(options.contourTurnReliefWeight, ROAD_CONTOUR_TURN_RELIEF_WEIGHT * 1.5),
  pathMode: "mountainPass"
});

const toPoint = (idx: number, cols: number): Point => ({ x: idx % cols, y: Math.floor(idx / cols) });

const getElevationAt = (state: WorldState, x: number, y: number, fallback: number): number => {
  if (!inBounds(state.grid, x, y)) {
    return fallback;
  }
  return state.tiles[indexFor(state.grid, x, y)]?.elevation ?? fallback;
};

const getRoadGradeScale = (state: WorldState, heightScaleMultiplier: number): number =>
  getTerrainHeightScale(state.grid.cols, state.grid.rows, heightScaleMultiplier);

const computeStepSignedGrade = (
  fromElevation: number,
  toElevation: number,
  runCost: number,
  elevationToGradeScale = 1
): number => ((toElevation - fromElevation) * elevationToGradeScale) / Math.max(1, runCost);

const computeCrossfallAtStep = (
  state: WorldState,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  fromElevation: number,
  toElevation: number,
  elevationToGradeScale = 1
): number => {
  const dx = Math.sign(toX - fromX);
  const dy = Math.sign(toY - fromY);
  if (dx === 0 && dy === 0) {
    return 0;
  }
  const perpX = -dy;
  const perpY = dx;
  const centerElevation = (fromElevation + toElevation) * 0.5;
  const leftA = getElevationAt(state, fromX + perpX, fromY + perpY, centerElevation);
  const leftB = getElevationAt(state, toX + perpX, toY + perpY, centerElevation);
  const rightA = getElevationAt(state, fromX - perpX, fromY - perpY, centerElevation);
  const rightB = getElevationAt(state, toX - perpX, toY - perpY, centerElevation);
  const leftElevation = (leftA + leftB) * 0.5;
  const rightElevation = (rightA + rightB) * 0.5;
  return Math.abs(leftElevation - rightElevation) * 0.5 * elevationToGradeScale;
};

const computeRoadStepAngleDeg = (
  state: WorldState,
  fromElevation: number,
  toElevation: number,
  runCost: number,
  heightScaleMultiplier: number
): number =>
  computeRenderedSlopeAngleDeg(
    Math.abs(toElevation - fromElevation) / Math.max(1, runCost),
    state.grid.cols,
    state.grid.rows,
    heightScaleMultiplier
  );

const computeRoadTileAngleDeg = (
  state: WorldState,
  idx: number,
  heightScaleMultiplier: number,
  cache: Float32Array
): number => {
  const cached = cache[idx];
  if (cached >= 0) {
    return cached;
  }
  const x = idx % state.grid.cols;
  const y = Math.floor(idx / state.grid.cols);
  const angle = computeLocalRenderedSlopeAngleDeg(
    {
      cols: state.grid.cols,
      rows: state.grid.rows,
      elevations: state.tileElevation.length === state.grid.totalTiles ? state.tileElevation : state.tiles.map((tile) => tile.elevation)
    },
    x,
    y,
    heightScaleMultiplier
  );
  cache[idx] = angle;
  return angle;
};

const scoreRoadAnglePenalty = (angleDeg: number, options: RoadPathOptionsResolved): number => {
  if (angleDeg <= options.preferredAngleDeg) {
    return 0;
  }
  if (angleDeg <= options.softAngleDeg) {
    const t = (angleDeg - options.preferredAngleDeg) / Math.max(1e-6, options.softAngleDeg - options.preferredAngleDeg);
    return t * options.anglePenaltyWeight;
  }
  if (angleDeg <= options.avoidAngleDeg) {
    const t = (angleDeg - options.softAngleDeg) / Math.max(1e-6, options.avoidAngleDeg - options.softAngleDeg);
    return options.anglePenaltyWeight + t * options.anglePenaltyWeight * 3;
  }
  const t = (angleDeg - options.avoidAngleDeg) / Math.max(1e-6, options.fallbackAngleDeg - options.avoidAngleDeg);
  return options.anglePenaltyWeight * (4 + Math.max(0, t) * 8);
};

const isStraightClimb = (
  previousDx: number,
  previousDy: number,
  nextDx: number,
  nextDy: number,
  previousSignedGrade: number,
  nextSignedGrade: number,
  angleDeg: number,
  options: RoadPathOptionsResolved
): boolean =>
  previousDx === nextDx &&
  previousDy === nextDy &&
  angleDeg > options.softAngleDeg &&
  Math.sign(previousSignedGrade) === Math.sign(nextSignedGrade) &&
  Math.abs(nextSignedGrade) > Math.abs(previousSignedGrade) * 0.75;

const getRoadEdgeMaskAtIndex = (state: WorldState, idx: number): number => {
  const cols = state.grid.cols;
  const x = idx % cols;
  const y = Math.floor(idx / cols);
  let mask = state.tileRoadEdges[idx] ?? 0;
  if (mask !== 0) {
    let sanitized = 0;
    for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
      const dir = ROAD_EDGE_DIRS[i];
      if ((mask & dir.bit) === 0) {
        continue;
      }
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const neighborIdx = indexFor(state.grid, nx, ny);
      if (isRoadLikeIndex(state, neighborIdx)) {
        sanitized |= dir.bit;
      }
    }
    if (sanitized !== 0) {
      return sanitized;
    }
  }
  mask = 0;
  for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
    const dir = ROAD_EDGE_DIRS[i];
    const nx = x + dir.dx;
    const ny = y + dir.dy;
    if (!inBounds(state.grid, nx, ny)) {
      continue;
    }
    const neighborIdx = indexFor(state.grid, nx, ny);
    if (isRoadLikeIndex(state, neighborIdx)) {
      mask |= dir.bit;
    }
  }
  return mask;
};

const getRiverDistanceField = (state: WorldState): Int16Array => {
  const cached = riverDistanceCache.get(state);
  if (cached && cached.maskRef === state.tileRiverMask && cached.distances.length === state.grid.totalTiles) {
    return cached.distances;
  }

  const total = state.grid.totalTiles;
  const cols = state.grid.cols;
  const rows = state.grid.rows;
  const dist = new Int16Array(total);
  dist.fill(32767);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  for (let i = 0; i < total; i += 1) {
    if (state.tileRiverMask[i] > 0) {
      dist[i] = 0;
      queue[tail] = i;
      tail += 1;
    }
  }

  while (head < tail) {
    const idx = queue[head];
    head += 1;
    const nextDist = dist[idx] + 1;
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    if (x > 0) {
      const nIdx = idx - 1;
      if (nextDist < dist[nIdx]) {
        dist[nIdx] = nextDist;
        queue[tail] = nIdx;
        tail += 1;
      }
    }
    if (x < cols - 1) {
      const nIdx = idx + 1;
      if (nextDist < dist[nIdx]) {
        dist[nIdx] = nextDist;
        queue[tail] = nIdx;
        tail += 1;
      }
    }
    if (y > 0) {
      const nIdx = idx - cols;
      if (nextDist < dist[nIdx]) {
        dist[nIdx] = nextDist;
        queue[tail] = nIdx;
        tail += 1;
      }
    }
    if (y < rows - 1) {
      const nIdx = idx + cols;
      if (nextDist < dist[nIdx]) {
        dist[nIdx] = nextDist;
        queue[tail] = nIdx;
        tail += 1;
      }
    }
  }

  riverDistanceCache.set(state, { maskRef: state.tileRiverMask, distances: dist });
  return dist;
};

const isRoadLikeIndex = (state: WorldState, idx: number): boolean => {
  const type = state.tiles[idx].type;
  return type === "road" || type === "base" || state.tileRoadBridge[idx] > 0;
};

const isRiverApproachTile = (state: WorldState, idx: number): boolean => {
  const cols = state.grid.cols;
  const rows = state.grid.rows;
  const x = idx % cols;
  const y = Math.floor(idx / cols);
  if (x > 0 && state.tileRiverMask[idx - 1] > 0) {
    return true;
  }
  if (x < cols - 1 && state.tileRiverMask[idx + 1] > 0) {
    return true;
  }
  if (y > 0 && state.tileRiverMask[idx - cols] > 0) {
    return true;
  }
  if (y < rows - 1 && state.tileRiverMask[idx + cols] > 0) {
    return true;
  }
  return false;
};

export const isRoadLikeTile = (state: WorldState, x: number, y: number): boolean => {
  if (!inBounds(state.grid, x, y)) {
    return false;
  }
  return isRoadLikeIndex(state, indexFor(state.grid, x, y));
};

const ensureRoadEdgeBuffer = (state: WorldState): void => {
  if (state.tileRoadEdges.length !== state.grid.totalTiles) {
    state.tileRoadEdges = new Uint8Array(state.grid.totalTiles);
  }
};

export const clearRoadEdges = (state: WorldState): void => {
  ensureRoadEdgeBuffer(state);
  state.tileRoadEdges.fill(0);
};

export const getRoadEdgeMaskAt = (state: WorldState, x: number, y: number): number => {
  if (!inBounds(state.grid, x, y)) {
    return 0;
  }
  ensureRoadEdgeBuffer(state);
  return state.tileRoadEdges[indexFor(state.grid, x, y)] ?? 0;
};

const setRoadEdgeMaskAtIndex = (state: WorldState, idx: number, mask: number): void => {
  ensureRoadEdgeBuffer(state);
  state.tileRoadEdges[idx] = mask & 0xff;
};

const setRoadEdgeBitAtIndex = (state: WorldState, idx: number, bit: number): void => {
  ensureRoadEdgeBuffer(state);
  state.tileRoadEdges[idx] |= bit;
};

const clearRoadEdgeBitAtIndex = (state: WorldState, idx: number, bit: number): void => {
  ensureRoadEdgeBuffer(state);
  state.tileRoadEdges[idx] &= ~bit;
};

export const clearRoadEdgesAt = (state: WorldState, x: number, y: number): void => {
  if (!inBounds(state.grid, x, y)) {
    return;
  }
  const idx = indexFor(state.grid, x, y);
  setRoadEdgeMaskAtIndex(state, idx, 0);
};

export const connectRoadPoints = (
  state: WorldState,
  ax: number,
  ay: number,
  bx: number,
  by: number
): boolean => {
  if (!inBounds(state.grid, ax, ay) || !inBounds(state.grid, bx, by)) {
    return false;
  }
  if (ax === bx && ay === by) {
    return false;
  }
  if (!isRoadLikeTile(state, ax, ay) || !isRoadLikeTile(state, bx, by)) {
    return false;
  }
  const dx = bx - ax;
  const dy = by - ay;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
    return false;
  }
  const dir = getRoadEdgeDir(dx, dy);
  if (!dir) {
    return false;
  }
  const aIdx = indexFor(state.grid, ax, ay);
  const bIdx = indexFor(state.grid, bx, by);
  setRoadEdgeBitAtIndex(state, aIdx, dir.bit);
  setRoadEdgeBitAtIndex(state, bIdx, dir.opposite);
  return true;
};

export const disconnectRoadPoints = (
  state: WorldState,
  ax: number,
  ay: number,
  bx: number,
  by: number
): boolean => {
  if (!inBounds(state.grid, ax, ay) || !inBounds(state.grid, bx, by)) {
    return false;
  }
  const dx = bx - ax;
  const dy = by - ay;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
    return false;
  }
  const dir = getRoadEdgeDir(dx, dy);
  if (!dir) {
    return false;
  }
  const aIdx = indexFor(state.grid, ax, ay);
  const bIdx = indexFor(state.grid, bx, by);
  clearRoadEdgeBitAtIndex(state, aIdx, dir.bit);
  clearRoadEdgeBitAtIndex(state, bIdx, dir.opposite);
  return true;
};

const hasCardinalLinkPair = (
  state: WorldState,
  x: number,
  y: number,
  dx: number,
  dy: number
): boolean => {
  const mx1 = x + dx;
  const my1 = y;
  const mx2 = x;
  const my2 = y + dy;
  const tx = x + dx;
  const ty = y + dy;
  const hasPathA =
    isRoadLikeTile(state, mx1, my1) &&
    isRoadLikeTile(state, tx, ty) &&
    (getRoadEdgeMaskAt(state, x, y) & (dx > 0 ? ROAD_EDGE_E : ROAD_EDGE_W)) > 0 &&
    (getRoadEdgeMaskAt(state, mx1, my1) & (dx > 0 ? ROAD_EDGE_W : ROAD_EDGE_E)) > 0 &&
    (getRoadEdgeMaskAt(state, mx1, my1) & (dy > 0 ? ROAD_EDGE_S : ROAD_EDGE_N)) > 0 &&
    (getRoadEdgeMaskAt(state, tx, ty) & (dy > 0 ? ROAD_EDGE_N : ROAD_EDGE_S)) > 0;
  const hasPathB =
    isRoadLikeTile(state, mx2, my2) &&
    isRoadLikeTile(state, tx, ty) &&
    (getRoadEdgeMaskAt(state, x, y) & (dy > 0 ? ROAD_EDGE_S : ROAD_EDGE_N)) > 0 &&
    (getRoadEdgeMaskAt(state, mx2, my2) & (dy > 0 ? ROAD_EDGE_N : ROAD_EDGE_S)) > 0 &&
    (getRoadEdgeMaskAt(state, mx2, my2) & (dx > 0 ? ROAD_EDGE_E : ROAD_EDGE_W)) > 0 &&
    (getRoadEdgeMaskAt(state, tx, ty) & (dx > 0 ? ROAD_EDGE_W : ROAD_EDGE_E)) > 0;
  return hasPathA || hasPathB;
};

export const pruneRoadDiagonalStubs = (state: WorldState): void => {
  ensureRoadEdgeBuffer(state);
  const removals: Array<{ ax: number; ay: number; bx: number; by: number }> = [];
  const { cols, rows } = state.grid;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (!isRoadLikeTile(state, x, y)) {
        continue;
      }
      const mask = getRoadEdgeMaskAt(state, x, y);
      for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
        const dir = ROAD_EDGE_DIRS[i];
        if (!dir.diagonal || (mask & dir.bit) === 0) {
          continue;
        }
        const nx = x + dir.dx;
        const ny = y + dir.dy;
        if (!inBounds(state.grid, nx, ny) || !isRoadLikeTile(state, nx, ny)) {
          removals.push({ ax: x, ay: y, bx: nx, by: ny });
          continue;
        }
        if (hasCardinalLinkPair(state, x, y, dir.dx, dir.dy)) {
          removals.push({ ax: x, ay: y, bx: nx, by: ny });
        }
      }
    }
  }
  for (let i = 0; i < removals.length; i += 1) {
    const edge = removals[i];
    disconnectRoadPoints(state, edge.ax, edge.ay, edge.bx, edge.by);
  }
};

const ROAD_ARTIFACT_ALT_PATH_MAX_STEPS = 8;
const ROAD_ARTIFACT_PROTECTED_RADIUS = 2;

const isRoadArtifactProtectedTile = (state: WorldState, x: number, y: number): boolean => {
  if (!inBounds(state.grid, x, y)) {
    return true;
  }
  const idx = indexFor(state.grid, x, y);
  const tile = state.tiles[idx];
  if (tile.type === "base" || tile.type === "house" || state.structureMask[idx] > 0 || state.tileTownId[idx] >= 0) {
    return true;
  }
  for (let oy = -ROAD_ARTIFACT_PROTECTED_RADIUS; oy <= ROAD_ARTIFACT_PROTECTED_RADIUS; oy += 1) {
    for (let ox = -ROAD_ARTIFACT_PROTECTED_RADIUS; ox <= ROAD_ARTIFACT_PROTECTED_RADIUS; ox += 1) {
      const nx = x + ox;
      const ny = y + oy;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const nIdx = indexFor(state.grid, nx, ny);
      const neighbor = state.tiles[nIdx];
      if (
        neighbor.type === "base" ||
        neighbor.type === "house" ||
        state.structureMask[nIdx] > 0 ||
        state.tileTownId[nIdx] >= 0
      ) {
        return true;
      }
    }
  }
  return false;
};

const roadDegreeAtIndex = (state: WorldState, idx: number): number => {
  let degree = 0;
  const mask = state.tileRoadEdges[idx] ?? 0;
  for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
    if ((mask & ROAD_EDGE_DIRS[i].bit) > 0) {
      degree += 1;
    }
  }
  return degree;
};

const hasShortAlternateRoadPath = (
  state: WorldState,
  startIdx: number,
  goalIdx: number,
  blockedA: number,
  blockedB: number,
  maxSteps: number
): boolean => {
  const total = state.grid.totalTiles;
  const cols = state.grid.cols;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const depth = new Int16Array(total);
  let head = 0;
  let tail = 0;
  queue[tail] = startIdx;
  tail += 1;
  visited[startIdx] = 1;

  while (head < tail) {
    const idx = queue[head];
    head += 1;
    const nextDepth = depth[idx] + 1;
    if (nextDepth > maxSteps) {
      continue;
    }
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    const mask = state.tileRoadEdges[idx] ?? 0;
    for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
      const dir = ROAD_EDGE_DIRS[i];
      if ((mask & dir.bit) === 0) {
        continue;
      }
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const nIdx = indexFor(state.grid, nx, ny);
      if ((idx === blockedA && nIdx === blockedB) || (idx === blockedB && nIdx === blockedA)) {
        continue;
      }
      if (!isRoadLikeIndex(state, nIdx) || visited[nIdx] > 0) {
        continue;
      }
      if (nIdx === goalIdx) {
        return true;
      }
      visited[nIdx] = 1;
      depth[nIdx] = nextDepth;
      queue[tail] = nIdx;
      tail += 1;
    }
  }
  return false;
};

export const pruneRoadConnectorArtifacts = (state: WorldState): number => {
  ensureRoadEdgeBuffer(state);
  const removals: Array<{ ax: number; ay: number; bx: number; by: number }> = [];
  const { cols } = state.grid;

  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    if (!isRoadLikeIndex(state, idx) || state.tiles[idx]?.type === "water" || state.tileRoadBridge[idx] > 0) {
      continue;
    }
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    if (isRoadArtifactProtectedTile(state, x, y)) {
      continue;
    }
    const degree = roadDegreeAtIndex(state, idx);
    const mask = state.tileRoadEdges[idx] ?? 0;
    for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
      const dir = ROAD_EDGE_DIRS[i];
      if ((mask & dir.bit) === 0) {
        continue;
      }
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const nIdx = indexFor(state.grid, nx, ny);
      if (nIdx <= idx || !isRoadLikeIndex(state, nIdx) || state.tiles[nIdx]?.type === "water" || state.tileRoadBridge[nIdx] > 0) {
        continue;
      }
      if (isRoadArtifactProtectedTile(state, nx, ny)) {
        continue;
      }
      const neighborDegree = roadDegreeAtIndex(state, nIdx);
      const redundantConnectorCandidate = dir.diagonal || degree >= 3 || neighborDegree >= 3;
      if (!redundantConnectorCandidate || degree <= 1 || neighborDegree <= 1) {
        continue;
      }
      if (hasShortAlternateRoadPath(state, idx, nIdx, idx, nIdx, ROAD_ARTIFACT_ALT_PATH_MAX_STEPS)) {
        removals.push({ ax: x, ay: y, bx: nx, by: ny });
      }
    }
  }

  let pruned = 0;
  for (let i = 0; i < removals.length; i += 1) {
    const edge = removals[i];
    const aIdx = indexFor(state.grid, edge.ax, edge.ay);
    const bIdx = indexFor(state.grid, edge.bx, edge.by);
    if (!hasShortAlternateRoadPath(state, aIdx, bIdx, aIdx, bIdx, ROAD_ARTIFACT_ALT_PATH_MAX_STEPS)) {
      continue;
    }
    disconnectRoadPoints(state, edge.ax, edge.ay, edge.bx, edge.by);
    pruned += 1;
  }
  roadGenerationStats.connectorArtifactPrunedEdgeCount += pruned;
  return pruned;
};

export const backfillRoadEdgesFromAdjacency = (state: WorldState): void => {
  ensureRoadEdgeBuffer(state);
  const { cols, rows } = state.grid;
  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    if (!isRoadLikeIndex(state, idx)) {
      setRoadEdgeMaskAtIndex(state, idx, 0);
      continue;
    }
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    let sanitized = 0;
    for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
      const dir = ROAD_EDGE_DIRS[i];
      if ((state.tileRoadEdges[idx] & dir.bit) === 0) {
        continue;
      }
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (isRoadLikeTile(state, nx, ny)) {
        sanitized |= dir.bit;
      }
    }
    setRoadEdgeMaskAtIndex(state, idx, sanitized);
  }
  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    if (!isRoadLikeIndex(state, idx) || state.tileRoadEdges[idx] === 0) {
      continue;
    }
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
      const dir = ROAD_EDGE_DIRS[i];
      if ((state.tileRoadEdges[idx] & dir.bit) === 0) {
        continue;
      }
      connectRoadPoints(state, x, y, x + dir.dx, y + dir.dy);
    }
  }
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (!isRoadLikeTile(state, x, y)) {
        continue;
      }
      const idx = indexFor(state.grid, x, y);
      if (state.tileRoadEdges[idx] !== 0) {
        continue;
      }
      for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
        const dir = ROAD_EDGE_DIRS[i];
        const nx = x + dir.dx;
        const ny = y + dir.dy;
        if (isRoadLikeTile(state, nx, ny)) {
          connectRoadPoints(state, x, y, nx, ny);
        }
      }
    }
  }
};

export const backfillRoadEdgesInBounds = (
  state: WorldState,
  bounds: RoadTileBounds,
  padding = 1
): void => {
  ensureRoadEdgeBuffer(state);
  const clipped = expandRoadTileBounds(state, bounds, padding);
  const { cols } = state.grid;
  for (let y = clipped.minY; y <= clipped.maxY; y += 1) {
    for (let x = clipped.minX; x <= clipped.maxX; x += 1) {
      const idx = y * cols + x;
      if (!isRoadLikeIndex(state, idx)) {
        setRoadEdgeMaskAtIndex(state, idx, 0);
        continue;
      }
      let sanitized = 0;
      for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
        const dir = ROAD_EDGE_DIRS[i]!;
        if ((state.tileRoadEdges[idx] & dir.bit) === 0) {
          continue;
        }
        const nx = x + dir.dx;
        const ny = y + dir.dy;
        if (isRoadLikeTile(state, nx, ny)) {
          sanitized |= dir.bit;
        }
      }
      setRoadEdgeMaskAtIndex(state, idx, sanitized);
    }
  }
  for (let y = clipped.minY; y <= clipped.maxY; y += 1) {
    for (let x = clipped.minX; x <= clipped.maxX; x += 1) {
      const idx = y * cols + x;
      if (!isRoadLikeIndex(state, idx) || state.tileRoadEdges[idx] === 0) {
        continue;
      }
      for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
        const dir = ROAD_EDGE_DIRS[i]!;
        if ((state.tileRoadEdges[idx] & dir.bit) === 0) {
          continue;
        }
        connectRoadPoints(state, x, y, x + dir.dx, y + dir.dy);
      }
    }
  }
  for (let y = clipped.minY; y <= clipped.maxY; y += 1) {
    for (let x = clipped.minX; x <= clipped.maxX; x += 1) {
      if (!isRoadLikeTile(state, x, y)) {
        continue;
      }
      const idx = indexFor(state.grid, x, y);
      if (state.tileRoadEdges[idx] !== 0) {
        continue;
      }
      for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
        const dir = ROAD_EDGE_DIRS[i]!;
        const nx = x + dir.dx;
        const ny = y + dir.dy;
        if (isRoadLikeTile(state, nx, ny)) {
          connectRoadPoints(state, x, y, nx, ny);
        }
      }
    }
  }
};

export const collectConnectedRoadNeighbors = (state: WorldState, x: number, y: number): Point[] => {
  if (!isRoadLikeTile(state, x, y)) {
    return [];
  }
  ensureRoadEdgeBuffer(state);
  const mask = state.tileRoadEdges[indexFor(state.grid, x, y)] ?? 0;
  const neighbors: Point[] = [];
  for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
    const dir = ROAD_EDGE_DIRS[i];
    if ((mask & dir.bit) === 0) {
      continue;
    }
    const nx = x + dir.dx;
    const ny = y + dir.dy;
    if (isRoadLikeTile(state, nx, ny)) {
      neighbors.push({ x: nx, y: ny });
    }
  }
  return neighbors;
};

export const analyzeRoadEdgeQuality = (
  state: WorldState
): {
  roadCount: number;
  ignoredDiagonalCount: number;
  unmatchedPatternCount: number;
  nodeDegreeHistogram: Record<string, number>;
} => {
  ensureRoadEdgeBuffer(state);
  const { cols, rows } = state.grid;
  let roadCount = 0;
  let ignoredDiagonalCount = 0;
  let unmatchedPatternCount = 0;
  const degreeHistogram = new Map<number, number>();
  const classifyPattern = (orth: number, diag: number, orthMask: number): string => {
    if (orth === 0 && diag === 0) {
      return "isolated";
    }
    if (orth === 0) {
      return diag === 1 ? "endcap_diagonal" : "diag_only";
    }
    if (diag === 0) {
      if (orth === 1) {
        return "endcap_cardinal";
      }
      if (orth === 2) {
        const oppositeNS = (orthMask & (ROAD_EDGE_N | ROAD_EDGE_S)) === (ROAD_EDGE_N | ROAD_EDGE_S);
        const oppositeEW = (orthMask & (ROAD_EDGE_E | ROAD_EDGE_W)) === (ROAD_EDGE_E | ROAD_EDGE_W);
        return oppositeNS || oppositeEW ? "straight" : "corner";
      }
      if (orth === 3) {
        return "tee";
      }
      return "cross";
    }
    if (orth === 1) {
      return "o1d";
    }
    if (orth === 2 && diag === 1) {
      return "o2d1";
    }
    if (orth === 2 && diag >= 2) {
      return "o2d2plus";
    }
    if (orth === 3 && diag === 1) {
      return "o3d1";
    }
    if (orth >= 3 && diag >= 2) {
      return "hub_dense";
    }
    return "mixed_dense";
  };
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (!isRoadLikeTile(state, x, y)) {
        continue;
      }
      roadCount += 1;
      const mask = getRoadEdgeMaskAt(state, x, y);
      const orth =
        Number((mask & ROAD_EDGE_N) > 0) +
        Number((mask & ROAD_EDGE_E) > 0) +
        Number((mask & ROAD_EDGE_S) > 0) +
        Number((mask & ROAD_EDGE_W) > 0);
      const diag =
        Number((mask & ROAD_EDGE_NE) > 0) +
        Number((mask & ROAD_EDGE_NW) > 0) +
        Number((mask & ROAD_EDGE_SE) > 0) +
        Number((mask & ROAD_EDGE_SW) > 0);
      const family = classifyPattern(orth, diag, mask & ROAD_EDGE_CARDINAL_MASK);
      const mixedHandled =
        family === "o1d" ||
        family === "o2d1" ||
        family === "o2d2plus" ||
        family === "o3d1" ||
        family === "hub_dense" ||
        family === "mixed_dense";
      if (orth >= 2 && diag > 0 && !mixedHandled) {
        ignoredDiagonalCount += 1;
      }
      if (family === "mixed_unknown") {
        unmatchedPatternCount += 1;
      }
      const degree = orth + diag;
      degreeHistogram.set(degree, (degreeHistogram.get(degree) ?? 0) + 1);
    }
  }
  const nodeDegreeHistogram: Record<string, number> = {};
  degreeHistogram.forEach((count, degree) => {
    nodeDegreeHistogram[String(degree)] = count;
  });
  return {
    roadCount,
    ignoredDiagonalCount,
    unmatchedPatternCount,
    nodeDegreeHistogram
  };
};

const canTraverseTileIndex = (
  state: WorldState,
  idx: number,
  isEndpoint: boolean,
  allowBridge: boolean,
  options: RoadPathOptionsResolved,
  riverDistance: Int16Array
): boolean => {
  if (state.structureMask[idx] && !isEndpoint) {
    return false;
  }
  const tile = state.tiles[idx];
  if (tile.type === "house" && !isEndpoint) {
    return false;
  }
  const existingBridge = state.tileRoadBridge[idx] > 0;
  if (tile.type === "water") {
    if (existingBridge) {
      return true;
    }
    if (!allowBridge) {
      return false;
    }
    return state.tileRiverMask[idx] > 0;
  }
  if (
    !isEndpoint &&
    options.riverBlockDistance > 0 &&
    riverDistance[idx] <= options.riverBlockDistance &&
    !isRoadLikeIndex(state, idx)
  ) {
    if (!(allowBridge && isRiverApproachTile(state, idx))) {
      return false;
    }
  }
  return true;
};

export function setRoadAt(state: WorldState, rng: RNG, x: number, y: number, options: RoadCarveOptions = {}): void {
  if (!inBounds(state.grid, x, y)) {
    return;
  }
  const idx = indexFor(state.grid, x, y);
  const tile = state.tiles[idx];
  if (state.structureMask[idx]) {
    return;
  }
  if (tile.type === "house" || tile.type === "base") {
    return;
  }
  if (tile.type === "water") {
    if (!options.allowBridge || state.tileRiverMask[idx] === 0) {
      return;
    }
    state.tileRoadBridge[idx] = 1;
    clearVegetationState(tile);
    tile.dominantTreeType = null;
    tile.treeType = null;
    tile.ashAge = 0;
    applyFuel(tile, tile.moisture, rng);
    return;
  }
  state.tileRoadBridge[idx] = 0;
  tile.type = "road";
  clearVegetationState(tile);
  tile.dominantTreeType = null;
  tile.treeType = null;
  tile.ashAge = 0;
  applyFuel(tile, tile.moisture, rng);
}

export function canRoadTraverse(
  state: WorldState,
  x: number,
  y: number,
  start: Point,
  end: Point,
  options: RoadPathOptions = {}
): boolean {
  if (!inBounds(state.grid, x, y)) {
    return false;
  }
  const idx = indexFor(state.grid, x, y);
  const resolved = resolveRoadPathOptions(options);
  const allowBridge = resolved.bridgePolicy === "allow";
  const riverDistance = getRiverDistanceField(state);
  return canTraverseTileIndex(
    state,
    idx,
    (x === start.x && y === start.y) || (x === end.x && y === end.y),
    allowBridge,
    resolved,
    riverDistance
  );
}

const heapPush = (openIdx: number[], openF: number[], idx: number, f: number): void => {
  let i = openIdx.length;
  openIdx.push(idx);
  openF.push(f);
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (openF[parent] <= f) {
      break;
    }
    openIdx[i] = openIdx[parent];
    openF[i] = openF[parent];
    i = parent;
  }
  openIdx[i] = idx;
  openF[i] = f;
};

const heapPop = (openIdx: number[], openF: number[]): number => {
  if (openIdx.length === 0) {
    return -1;
  }
  const result = openIdx[0];
  const lastIdx = openIdx.pop() as number;
  const lastF = openF.pop() as number;
  if (openIdx.length > 0) {
    let i = 0;
    while (true) {
      const left = i * 2 + 1;
      if (left >= openIdx.length) {
        break;
      }
      const right = left + 1;
      let child = left;
      if (right < openIdx.length && openF[right] < openF[left]) {
        child = right;
      }
      if (openF[child] >= lastF) {
        break;
      }
      openIdx[i] = openIdx[child];
      openF[i] = openF[child];
      i = child;
    }
    openIdx[i] = lastIdx;
    openF[i] = lastF;
  }
  return result;
};

const buildPathResult = (
  state: WorldState,
  pathIndices: number[],
  riverDistance: Int16Array,
  options: RoadPathOptionsResolved
): RoadPathResult => {
  const path = pathIndices.map((idx) => toPoint(idx, state.grid.cols));
  const elevationToGradeScale = getRoadGradeScale(state, options.heightScaleMultiplier);
  const bridgeTileIndices: number[] = [];
  let maxGrade = 0;
  let maxCrossfall = 0;
  let maxGradeChange = 0;
  let maxAngleDeg = 0;
  let angleSum = 0;
  let angleCount = 0;
  let highAngleStepCount = 0;
  let minRiverClearance = Number.POSITIVE_INFINITY;
  let bridgeSegments = 0;
  let inBridge = false;
  let prevSignedGrade: number | null = null;
  let prevDx = 0;
  let prevDy = 0;
  let switchbackTurnCount = 0;
  let longStraightSteepSegmentCount = 0;
  let straightDx = 0;
  let straightDy = 0;
  let straightSteepRun = 0;

  for (let i = 0; i < pathIndices.length; i += 1) {
    const idx = pathIndices[i];
    const tile = state.tiles[idx];
    const isBridge = tile.type === "water";
    if (isBridge) {
      bridgeTileIndices.push(idx);
      if (!inBridge) {
        bridgeSegments += 1;
        inBridge = true;
      }
    } else {
      inBridge = false;
      minRiverClearance = Math.min(minRiverClearance, riverDistance[idx]);
    }

    if (i <= 0) {
      continue;
    }
    const prevIdx = pathIndices[i - 1];
    const prevTile = state.tiles[prevIdx];
    if (tile.type === "water" || prevTile.type === "water") {
      prevSignedGrade = null;
      continue;
    }
    const point = path[i];
    const prevPoint = path[i - 1];
    const runCost = Math.hypot(point.x - prevPoint.x, point.y - prevPoint.y);
    const signedGrade = computeStepSignedGrade(prevTile.elevation, tile.elevation, runCost, elevationToGradeScale);
    const grade = Math.abs(signedGrade);
    const angleDeg = computeRoadStepAngleDeg(state, prevTile.elevation, tile.elevation, runCost, options.heightScaleMultiplier);
    maxAngleDeg = Math.max(maxAngleDeg, angleDeg);
    angleSum += angleDeg;
    angleCount += 1;
    if (angleDeg > options.avoidAngleDeg) {
      highAngleStepCount += 1;
    }
    if (grade > maxGrade) {
      maxGrade = grade;
    }
    const crossfall = computeCrossfallAtStep(
      state,
      prevPoint.x,
      prevPoint.y,
      point.x,
      point.y,
      prevTile.elevation,
      tile.elevation,
      elevationToGradeScale
    );
    if (crossfall > maxCrossfall) {
      maxCrossfall = crossfall;
    }
    if (prevSignedGrade !== null) {
      const gradeChange = Math.abs(signedGrade - prevSignedGrade);
      if (gradeChange > maxGradeChange) {
        maxGradeChange = gradeChange;
      }
      const dx = Math.sign(point.x - prevPoint.x);
      const dy = Math.sign(point.y - prevPoint.y);
      if ((dx !== prevDx || dy !== prevDy) && angleDeg > options.softAngleDeg) {
        switchbackTurnCount += 1;
      }
      if (angleDeg > options.softAngleDeg && dx === straightDx && dy === straightDy) {
        straightSteepRun += 1;
      } else {
        straightSteepRun = angleDeg > options.softAngleDeg ? 1 : 0;
      }
      if (straightSteepRun === 4) {
        longStraightSteepSegmentCount += 1;
      }
      straightDx = dx;
      straightDy = dy;
    }
    prevSignedGrade = signedGrade;
    prevDx = Math.sign(point.x - prevPoint.x);
    prevDy = Math.sign(point.y - prevPoint.y);
  }

  return {
    path,
    bridgeTileIndices,
    maxGrade,
    maxCrossfall,
    maxGradeChange,
    maxAngleDeg,
    meanAngleDeg: angleCount > 0 ? angleSum / angleCount : 0,
    highAngleStepCount,
    minRiverClearance,
    bridgeSegments,
    mountainPassFallback: options.pathMode === "mountainPass",
    switchbackTurnCount,
    switchbackRoute: options.pathMode === "switchback",
    hairpinGradeDiscountCount: 0,
    longStraightSteepSegmentCount
  };
};

const getRoadStreamerDirection = (
  fromIdx: number,
  toIdx: number,
  cols: number
): RoadPathPlannerDirection | null => {
  const fromX = fromIdx % cols;
  const fromY = Math.floor(fromIdx / cols);
  const toX = toIdx % cols;
  const toY = Math.floor(toIdx / cols);
  const dx = Math.sign(toX - fromX);
  const dy = Math.sign(toY - fromY);
  if (dx === 0 && dy === 0) {
    return null;
  }
  return { x: dx, y: dy, cost: Math.hypot(dx, dy) };
};

const buildRoadStreamerJoinPath = (fromIdx: number, toIdx: number, cols: number): number[] => {
  const path = [fromIdx];
  let x = fromIdx % cols;
  let y = Math.floor(fromIdx / cols);
  const toX = toIdx % cols;
  const toY = Math.floor(toIdx / cols);
  let guard = Math.abs(toX - x) + Math.abs(toY - y) + 4;
  while ((x !== toX || y !== toY) && guard > 0) {
    x += Math.sign(toX - x);
    y += Math.sign(toY - y);
    path.push(y * cols + x);
    guard -= 1;
  }
  return x === toX && y === toY ? path : [];
};

const collectPointRoadStreamerDestinationSeeds = (
  state: WorldState,
  end: Point,
  endIdx: number,
  options: RoadPathOptionsResolved,
  allowBridge: boolean,
  riverDistance: Int16Array,
  searchBounds: RoadTileBounds | null
): RoadStreamerDestinationSeed[] => {
  const seeds: RoadStreamerDestinationSeed[] = [];
  const seen = new Set<number>();
  const pushSeed = (idx: number, priority: number): void => {
    if (idx < 0 || idx >= state.grid.totalTiles || seen.has(idx)) {
      return;
    }
    const point = toPoint(idx, state.grid.cols);
    if (!isPointInRoadBounds(point, searchBounds)) {
      return;
    }
    if (!canTraverseTileIndex(state, idx, true, allowBridge, options, riverDistance)) {
      return;
    }
    seen.add(idx);
    seeds.push({ index: idx, point, priority });
  };
  pushSeed(endIdx, 0);
  if (!isRoadLikeIndex(state, endIdx)) {
    return seeds;
  }
  const mask = state.tileRoadEdges[endIdx] ?? 0;
  for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
    const dir = ROAD_EDGE_DIRS[i]!;
    if ((mask & dir.bit) === 0) {
      continue;
    }
    const nx = end.x + dir.dx;
    const ny = end.y + dir.dy;
    if (!inBounds(state.grid, nx, ny)) {
      continue;
    }
    const nIdx = indexFor(state.grid, nx, ny);
    if (isRoadLikeIndex(state, nIdx)) {
      pushSeed(nIdx, 0.15);
    }
  }
  const networkSeedRadius = options.pathMode === "mountainPass" ? 10 : options.pathMode === "switchback" ? 7 : 4;
  for (let oy = -networkSeedRadius; oy <= networkSeedRadius; oy += 1) {
    for (let ox = -networkSeedRadius; ox <= networkSeedRadius; ox += 1) {
      const distance = Math.hypot(ox, oy);
      if (distance <= 1 || distance > networkSeedRadius) {
        continue;
      }
      const nx = end.x + ox;
      const ny = end.y + oy;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const nIdx = indexFor(state.grid, nx, ny);
      if (isRoadLikeIndex(state, nIdx)) {
        pushSeed(nIdx, 0.2 + distance * 0.02);
      }
    }
  }
  return seeds;
};

const collectTargetRoadStreamerDestinationSeeds = (
  state: WorldState,
  start: Point,
  isTarget: (x: number, y: number) => boolean,
  options: RoadPathOptionsResolved,
  allowBridge: boolean,
  riverDistance: Int16Array,
  searchBounds: RoadTileBounds | null
): RoadStreamerDestinationSeed[] => {
  const candidates: RoadStreamerDestinationSeed[] = [];
  const minX = searchBounds?.minX ?? 0;
  const maxX = searchBounds?.maxX ?? state.grid.cols - 1;
  const minY = searchBounds?.minY ?? 0;
  const maxY = searchBounds?.maxY ?? state.grid.rows - 1;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (!isTarget(x, y)) {
        continue;
      }
      const idx = indexFor(state.grid, x, y);
      if (!canTraverseTileIndex(state, idx, true, allowBridge, options, riverDistance)) {
        continue;
      }
      candidates.push({
        index: idx,
        point: { x, y },
        priority: Math.hypot(start.x - x, start.y - y) * 0.001
      });
    }
  }
  candidates.sort((left, right) => {
    const distLeft = Math.hypot(start.x - left.point.x, start.y - left.point.y);
    const distRight = Math.hypot(start.x - right.point.x, start.y - right.point.y);
    return distLeft - distRight || left.point.y - right.point.y || left.point.x - right.point.x;
  });
  return candidates.slice(0, 96);
};

const evaluateRoadStreamerStep = (
  state: WorldState,
  startIdx: number,
  endpointIndices: Set<number>,
  searchBounds: RoadTileBounds | null,
  options: RoadPathOptionsResolved,
  allowBridge: boolean,
  gradeLimit: number,
  crossfallLimit: number,
  gradeChangeLimit: number,
  riverDistance: Int16Array,
  roadAngleCache: Float32Array,
  front: RoadPathPlannerFront,
  currentIdx: number,
  nIdx: number,
  dir: RoadPathPlannerDirection,
  currentState: RoadPathPlannerNodeState
): RoadPathPlannerStepResult | null => {
  const cols = state.grid.cols;
  const nx = nIdx % cols;
  const ny = Math.floor(nIdx / cols);
  if (
    searchBounds &&
    (nx < searchBounds.minX || nx > searchBounds.maxX || ny < searchBounds.minY || ny > searchBounds.maxY)
  ) {
    return null;
  }
  const cx = currentIdx % cols;
  const cy = Math.floor(currentIdx / cols);
  const isEndpoint = front === "origin" ? endpointIndices.has(nIdx) : nIdx === startIdx;
  if (!canTraverseTileIndex(state, nIdx, isEndpoint, allowBridge, options, riverDistance)) {
    return null;
  }
  if (dir.x !== 0 && dir.y !== 0) {
    const idxA = indexFor(state.grid, cx + dir.x, cy);
    const idxB = indexFor(state.grid, cx, cy + dir.y);
    if (
      !canTraverseTileIndex(state, idxA, false, allowBridge, options, riverDistance) &&
      !canTraverseTileIndex(state, idxB, false, allowBridge, options, riverDistance)
    ) {
      return null;
    }
  }

  const currentTile = state.tiles[currentIdx];
  const nextTile = state.tiles[nIdx];
  const currentIsWater = currentTile.type === "water" && state.tileRoadBridge[currentIdx] === 0;
  const nextIsWater = nextTile.type === "water" && state.tileRoadBridge[nIdx] === 0;
  let nextWaterUsed = currentState.waterTilesUsed;
  let nextConsecutiveWater = 0;
  if (nextIsWater) {
    if (!allowBridge || state.tileRiverMask[nIdx] === 0) {
      return null;
    }
    nextWaterUsed += 1;
    if (nextWaterUsed > options.bridgeMaxWaterTilesPerPath) {
      return null;
    }
    nextConsecutiveWater = currentState.consecutiveWater + 1;
    if (nextConsecutiveWater > options.bridgeMaxConsecutiveWater) {
      return null;
    }
  }

  const elevationToGradeScale = getRoadGradeScale(state, options.heightScaleMultiplier);
  let signedGrade = 0;
  let grade = 0;
  let crossfall = 0;
  let gradeChange = 0;
  let stepAngleDeg = 0;
  const tileAngleDeg = computeRoadTileAngleDeg(state, nIdx, options.heightScaleMultiplier, roadAngleCache);
  if (tileAngleDeg > options.avoidAngleDeg && !isRoadLikeIndex(state, nIdx) && !isEndpoint) {
    return null;
  }
  const hasPreviousLandStep = currentState.stepDx !== 0 || currentState.stepDy !== 0;
  if (!currentIsWater && !nextIsWater) {
    signedGrade = computeStepSignedGrade(currentTile.elevation, nextTile.elevation, dir.cost, elevationToGradeScale);
    grade = Math.abs(signedGrade);
    if (grade > gradeLimit) {
      return null;
    }
    stepAngleDeg = computeRoadStepAngleDeg(state, currentTile.elevation, nextTile.elevation, dir.cost, options.heightScaleMultiplier);
    if (stepAngleDeg > options.avoidAngleDeg && !isRoadLikeIndex(state, nIdx) && !isEndpoint) {
      return null;
    }
    crossfall = computeCrossfallAtStep(
      state,
      cx,
      cy,
      nx,
      ny,
      currentTile.elevation,
      nextTile.elevation,
      elevationToGradeScale
    );
    if (crossfall > crossfallLimit) {
      return null;
    }
    if (hasPreviousLandStep) {
      gradeChange = Math.abs(signedGrade - currentState.signedGrade);
      if (gradeChange > gradeChangeLimit) {
        return null;
      }
    }
  }

  let stepCost = dir.cost;
  if (dir.x !== 0 && dir.y !== 0) {
    stepCost += options.diagonalPenalty;
  }
  const nextState = cloneRoadPathPlannerNodeState(currentState);
  nextState.waterTilesUsed = nextWaterUsed;
  nextState.consecutiveWater = nextConsecutiveWater;
  if (!currentIsWater && !nextIsWater) {
    const plannerStepScore = scoreRoadPlannerStep({
      mode: options.pathMode,
      hasPreviousLandStep,
      previousDx: currentState.stepDx,
      previousDy: currentState.stepDy,
      nextDx: dir.x,
      nextDy: dir.y,
      previousSignedGrade: currentState.signedGrade,
      nextSignedGrade: signedGrade,
      previousCrossfall: currentState.crossfall,
      nextCrossfall: crossfall,
      stepAngleDeg,
      tileAngleDeg,
      softAngleDeg: options.softAngleDeg,
      avoidAngleDeg: options.avoidAngleDeg,
      straightClimbPenaltyWeight: options.straightClimbPenaltyWeight,
      contourTurnReliefWeight: options.contourTurnReliefWeight,
      previousSteepRun: currentState.steepRun,
      previousStepsSinceTurn: currentState.stepsSinceTurn,
      previousTurnDirection: currentState.turnDirection,
      previousStepsSinceTurnDirectionChange: currentState.stepsSinceTurnDirectionChange,
      previousLateralLegLength: currentState.lateralLegLength,
      previousStepsSinceHairpinDiscount: currentState.stepsSinceHairpinDiscount,
      previousHairpinSteepStepRun: currentState.hairpinSteepStepRun,
      previousCumulativeClimb: currentState.cumulativeClimb,
      previousCumulativeDescent: currentState.cumulativeDescent,
      localPlatformCrossfall: crossfall,
      localPlatformAngleDeg: tileAngleDeg,
      riverDistance: riverDistance[nIdx],
      riverBlockDistance: options.riverBlockDistance
    });
    stepCost += grade * options.slopePenaltyWeight * plannerStepScore.gradePenaltyMultiplier;
    stepCost += crossfall * options.crossfallPenaltyWeight;
    stepCost += gradeChange * options.gradeChangePenaltyWeight;
    stepCost += scoreRoadAnglePenalty(Math.max(stepAngleDeg, tileAngleDeg), options);
    stepCost += plannerStepScore.costAdjustment;
    if (hasPreviousLandStep && (currentState.stepDx !== dir.x || currentState.stepDy !== dir.y)) {
      let turnPenalty = options.turnPenalty;
      const previousSeverity = Math.max(Math.abs(currentState.signedGrade), currentState.crossfall);
      const nextSeverity = Math.max(grade, crossfall);
      if (nextSeverity < previousSeverity) {
        const relief = Math.min(
          0.9,
          (previousSeverity - nextSeverity) * ROAD_SWITCHBACK_RELIEF_WEIGHT +
            Math.max(0, stepAngleDeg - options.softAngleDeg) * 0.02 * options.contourTurnReliefWeight
        );
        turnPenalty *= 1 - relief;
      }
      stepCost += turnPenalty * plannerStepScore.turnPenaltyMultiplier;
    }
    nextState.stepDx = dir.x;
    nextState.stepDy = dir.y;
    nextState.signedGrade = signedGrade;
    nextState.crossfall = crossfall;
    nextState.steepRun = plannerStepScore.nextSteepRun;
    nextState.stepsSinceTurn = plannerStepScore.nextStepsSinceTurn;
    nextState.turnDirection = plannerStepScore.nextTurnDirection;
    nextState.stepsSinceTurnDirectionChange = plannerStepScore.nextStepsSinceTurnDirectionChange;
    nextState.lateralLegLength = plannerStepScore.nextLateralLegLength;
    nextState.stepsSinceHairpinDiscount = plannerStepScore.nextStepsSinceHairpinDiscount;
    nextState.hairpinSteepStepRun = plannerStepScore.nextHairpinSteepStepRun;
    nextState.cumulativeClimb = plannerStepScore.nextCumulativeClimb;
    nextState.cumulativeDescent = plannerStepScore.nextCumulativeDescent;
    nextState.switchbackTurns += plannerStepScore.switchbackTurn ? 1 : 0;
    nextState.hairpinGradeDiscounts += plannerStepScore.hairpinGradeDiscount ? 1 : 0;
    nextState.longStraightSteepSegments += plannerStepScore.longStraightSteep ? 1 : 0;
  } else {
    nextState.stepDx = 0;
    nextState.stepDy = 0;
    nextState.signedGrade = 0;
    nextState.crossfall = 0;
    if (nextIsWater) {
      stepCost += options.bridgeStepCost;
    }
  }
  if (!nextIsWater && !isRoadLikeIndex(state, nIdx) && options.riverPenaltyDistance > 0) {
    const riverDist = riverDistance[nIdx];
    if (riverDist <= options.riverPenaltyDistance) {
      const riverPenaltyRatio = (options.riverPenaltyDistance - riverDist + 1) / (options.riverPenaltyDistance + 1);
      stepCost += riverPenaltyRatio * options.riverPenaltyWeight;
    }
  }
  if (isRoadLikeIndex(state, nIdx)) {
    stepCost *= ROAD_EXISTING_SEGMENT_COST_MULTIPLIER;
  }
  return { cost: Math.max(0.0001, stepCost), state: nextState };
};

const runBidirectionalStreamer = (
  state: WorldState,
  start: Point,
  end: Point | null,
  isTarget: ((x: number, y: number) => boolean) | null,
  options: RoadPathOptionsResolved,
  allowBridge: boolean,
  gradeLimit: number,
  crossfallLimit: number,
  gradeChangeLimit: number,
  asyncMode = false
): RoadPathResult | null => {
  const debug = roadPathDebugHooks;
  debug?.checkCancelled?.();
  const attemptId = nextRoadPathDebugAttemptId++;
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const finish = (result: RoadPathResult | null, budgetAborted: boolean, visitedNodes: number): RoadPathResult | null => {
    const acceptedResult = rejectRoadPathForDetour(result, start, end, options);
    const endedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (budgetAborted) {
      roadGenerationStats.searchBudgetAbortCount += 1;
    }
    emitRoadPathDebugEvent({
      kind: "road:result",
      attemptId,
      diagnosticRouteId: options.diagnosticRouteId,
      diagnosticRouteLabel: options.diagnosticRouteLabel,
      found: !!acceptedResult,
      budgetAborted,
      visitedNodes,
      pathLength: acceptedResult?.path.length ?? 0,
      bridgeTileIndices: acceptedResult?.bridgeTileIndices ? [...acceptedResult.bridgeTileIndices] : undefined,
      elapsedMs: Math.max(0, endedAt - startedAt),
      mode: options.pathMode,
      routeGroup: options.diagnosticRouteGroup,
      allowBridge,
      planner: "streamer",
      joined: !!acceptedResult
    });
    return acceptedResult;
  };
  if (!inBounds(state.grid, start.x, start.y)) {
    return finish(null, false, 0);
  }
  if (end && !inBounds(state.grid, end.x, end.y)) {
    return finish(null, false, 0);
  }
  const searchBounds = options.searchBounds ? expandRoadTileBounds(state, options.searchBounds, 0) : null;
  if (!isPointInRoadBounds(start, searchBounds) || (end && !isPointInRoadBounds(end, searchBounds))) {
    return finish(null, false, 0);
  }
  const total = state.grid.totalTiles;
  const startIdx = indexFor(state.grid, start.x, start.y);
  const endIdx = end ? indexFor(state.grid, end.x, end.y) : -1;
  const riverDistance = getRiverDistanceField(state);
  const roadAngleCache = new Float32Array(total);
  roadAngleCache.fill(-1);
  if (!canTraverseTileIndex(state, startIdx, true, allowBridge, options, riverDistance)) {
    return finish(null, false, 0);
  }
  const destinationSeeds = end
    ? collectPointRoadStreamerDestinationSeeds(state, end, endIdx, options, allowBridge, riverDistance, searchBounds)
    : collectTargetRoadStreamerDestinationSeeds(state, start, isTarget ?? (() => false), options, allowBridge, riverDistance, searchBounds);
  if (destinationSeeds.length === 0) {
    return finish(null, false, 0);
  }
  const endpointIndices = new Set(destinationSeeds.map((seed) => seed.index));
  const joinRadius = getRoadStreamerJoinRadiusForMode(options.pathMode);
  emitRoadPathDebugEvent({
    kind: "road:attempt",
    attemptId,
    diagnosticRouteId: options.diagnosticRouteId,
    diagnosticRouteLabel: options.diagnosticRouteLabel,
    attemptKind: end ? "point" : "target",
    planner: "streamer",
    start: { ...start },
    end: end ? { ...end } : undefined,
    destinationSeedCount: destinationSeeds.length,
    joinRadius,
    mode: options.pathMode,
    routeGroup: options.diagnosticRouteGroup,
    allowBridge,
    gradeLimit,
    crossfallLimit,
    gradeChangeLimit,
    maxSearchNodeVisits: options.maxSearchNodeVisits
  });
  if (endIdx >= 0 && startIdx === endIdx) {
    return finish(buildPathResult(state, [startIdx], riverDistance, options), false, 0);
  }

  let lastDebugProgressMs = startedAt;
  void asyncMode;
  const plannerResult = planRoadPathBidirectionalStreamer({
    cols: state.grid.cols,
    rows: state.grid.rows,
    totalTiles: total,
    startIndex: startIdx,
    destinationSeeds,
    directions: ROAD_DIRS,
    joinRadius,
    maxSearchNodeVisits: options.maxSearchNodeVisits,
    initialState: createInitialRoadPathPlannerNodeState(),
    checkCancelled: () => debug?.checkCancelled?.(),
    onProgress: (progress) => {
      if (!debug || progress.visitedNodes % ROAD_DEBUG_PROGRESS_NODE_STRIDE !== 0) {
        return;
      }
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now - lastDebugProgressMs < ROAD_DEBUG_PROGRESS_MIN_MS) {
        return;
      }
      lastDebugProgressMs = now;
      const current = toPoint(progress.currentIndex, state.grid.cols);
      emitRoadPathDebugEvent({
        kind: "road:progress",
        attemptId,
        visitedNodes: progress.visitedNodes,
        openNodes: progress.openNodes,
        current,
        elapsedMs: Math.max(0, now - startedAt),
        planner: "streamer"
      });
    },
    evaluateStep: (front, currentIdx, nextIdx, direction, currentState) =>
      evaluateRoadStreamerStep(
        state,
        startIdx,
        endpointIndices,
        searchBounds,
        options,
        allowBridge,
        gradeLimit,
        crossfallLimit,
        gradeChangeLimit,
        riverDistance,
        roadAngleCache,
        front,
        currentIdx,
        nextIdx,
        direction,
        currentState
      ),
    validateJoin: (originIdx, destinationIdx, originState, _destinationState): RoadPathPlannerJoinResult | null => {
      if (originIdx === destinationIdx) {
        return { pathIndices: [originIdx], cost: 0 };
      }
      const joinPath = buildRoadStreamerJoinPath(originIdx, destinationIdx, state.grid.cols);
      if (joinPath.length <= 1 || joinPath.length > joinRadius + 1) {
        return null;
      }
      let totalCost = 0;
      let currentState = cloneRoadPathPlannerNodeState(originState);
      for (let i = 1; i < joinPath.length; i += 1) {
        const currentIdx = joinPath[i - 1]!;
        const nextIdx = joinPath[i]!;
        const direction = getRoadStreamerDirection(currentIdx, nextIdx, state.grid.cols);
        if (!direction) {
          return null;
        }
        const step = evaluateRoadStreamerStep(
          state,
          startIdx,
          new Set<number>([destinationIdx]),
          searchBounds,
          options,
          allowBridge,
          gradeLimit,
          crossfallLimit,
          gradeChangeLimit,
          riverDistance,
          roadAngleCache,
          "origin",
          currentIdx,
          nextIdx,
          direction,
          currentState
        );
        if (!step) {
          return null;
        }
        totalCost += step.cost;
        currentState = step.state;
      }
      return { pathIndices: joinPath, cost: totalCost };
    }
  });

  if (!plannerResult.found || plannerResult.pathIndices.length === 0) {
    return finish(null, plannerResult.budgetAborted, plannerResult.visitedNodes);
  }
  const result = buildPathResult(state, plannerResult.pathIndices, riverDistance, options);
  if (options.pathMode === "mountainPass") {
    result.mountainPassFallback = true;
  }
  result.switchbackRoute = options.pathMode === "switchback" && result.switchbackTurnCount > 0;
  return finish(result, plannerResult.budgetAborted, plannerResult.visitedNodes);
};

const runDijkstraRoadPlanner = (
  state: WorldState,
  start: Point,
  end: Point | null,
  isTarget: ((x: number, y: number) => boolean) | null,
  options: RoadPathOptionsResolved,
  allowBridge: boolean,
  gradeLimit: number,
  crossfallLimit: number,
  gradeChangeLimit: number
): RoadPathResult | null => {
  const debug = roadPathDebugHooks;
  debug?.checkCancelled?.();
  const attemptId = nextRoadPathDebugAttemptId++;
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const finish = (
    result: RoadPathResult | null,
    budgetAborted: boolean,
    visitedNodes: number,
    totalRouteCost?: number,
    selectedSeed?: RoadStreamerDestinationSeed | null,
    failureReason?: RoadPathPlannerFailureReason | null
  ): RoadPathResult | null => {
    const acceptedResult = rejectRoadPathForDetour(result, start, end, options);
    const endedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (budgetAborted) {
      roadGenerationStats.searchBudgetAbortCount += 1;
    }
    emitRoadPathDebugEvent({
      kind: "road:result",
      attemptId,
      diagnosticRouteId: options.diagnosticRouteId,
      diagnosticRouteLabel: options.diagnosticRouteLabel,
      found: !!acceptedResult,
      budgetAborted,
      visitedNodes,
      pathLength: acceptedResult?.path.length ?? 0,
      bridgeTileIndices: acceptedResult?.bridgeTileIndices ? [...acceptedResult.bridgeTileIndices] : undefined,
      selectedDestinationSeed: selectedSeed ? { ...selectedSeed.point } : undefined,
      selectedDestinationSeedKind: selectedSeed?.kind,
      selectedDestinationSeedLabel: selectedSeed?.label,
      totalRouteCost,
      failureReason: failureReason ?? undefined,
      elapsedMs: Math.max(0, endedAt - startedAt),
      mode: options.pathMode,
      routeGroup: options.diagnosticRouteGroup,
      allowBridge,
      planner: "dijkstra"
    });
    return acceptedResult;
  };
  if (!inBounds(state.grid, start.x, start.y)) {
    return finish(null, false, 0, undefined, null, "invalid-start");
  }
  if (end && !inBounds(state.grid, end.x, end.y)) {
    return finish(null, false, 0, undefined, null, "invalid-destination");
  }
  const searchBounds = options.searchBounds ? expandRoadTileBounds(state, options.searchBounds, 0) : null;
  if (!isPointInRoadBounds(start, searchBounds)) {
    return finish(null, false, 0, undefined, null, "invalid-start");
  }
  if (end && !isPointInRoadBounds(end, searchBounds)) {
    return finish(null, false, 0, undefined, null, "invalid-destination");
  }

  const total = state.grid.totalTiles;
  const startIdx = indexFor(state.grid, start.x, start.y);
  const endIdx = end ? indexFor(state.grid, end.x, end.y) : -1;
  const riverDistance = getRiverDistanceField(state);
  const roadAngleCache = new Float32Array(total);
  roadAngleCache.fill(-1);

  if (!canTraverseTileIndex(state, startIdx, true, allowBridge, options, riverDistance)) {
    return finish(null, false, 0, undefined, null, "invalid-start");
  }

  const destinationSeeds = end
    ? collectPointRoadStreamerDestinationSeeds(state, end, endIdx, options, allowBridge, riverDistance, searchBounds)
    : collectTargetRoadStreamerDestinationSeeds(
        state,
        start,
        isTarget ?? (() => false),
        options,
        allowBridge,
        riverDistance,
        searchBounds
      );
  for (let i = 0; i < destinationSeeds.length; i += 1) {
    const seed = destinationSeeds[i]!;
    if (!seed.kind) {
      seed.kind = end ? (isRoadLikeIndex(state, seed.index) ? "network" : "point") : "network";
    }
    if (!seed.label) {
      seed.label = end ? "point destination" : "target destination";
    }
  }
  if (destinationSeeds.length === 0) {
    return finish(null, false, 0, undefined, null, "no-destination-seeds");
  }

  emitRoadPathDebugEvent({
    kind: "road:attempt",
    attemptId,
    diagnosticRouteId: options.diagnosticRouteId,
    diagnosticRouteLabel: options.diagnosticRouteLabel,
    attemptKind: end ? "point" : "target",
    planner: "dijkstra",
    start: { ...start },
    end: end ? { ...end } : undefined,
    destinationSeedCount: destinationSeeds.length,
    mode: options.pathMode,
    routeGroup: options.diagnosticRouteGroup,
    allowBridge,
    gradeLimit,
    crossfallLimit,
    gradeChangeLimit,
    maxSearchNodeVisits: options.maxSearchNodeVisits
  });

  if (endIdx >= 0 && startIdx === endIdx) {
    return finish(buildPathResult(state, [startIdx], riverDistance, options), false, 0, 0, destinationSeeds[0] ?? null, null);
  }

  const endpointIndices = new Set(destinationSeeds.map((seed) => seed.index));
  let lastDebugProgressMs = startedAt;
  const plannerResult = planRoadPathDijkstra({
    cols: state.grid.cols,
    rows: state.grid.rows,
    totalTiles: total,
    startIndex: startIdx,
    destinationSeeds,
    directions: ROAD_DIRS,
    joinRadius: 0,
    maxSearchNodeVisits:
      options.maxSearchNodeVisits > 0 ? Math.min(total, Math.max(options.maxSearchNodeVisits, options.maxSearchNodeVisits * 4)) : 0,
    initialState: createInitialRoadPathPlannerNodeState(),
    checkCancelled: () => debug?.checkCancelled?.(),
    onProgress: (progress) => {
      if (!debug || progress.visitedNodes % ROAD_DEBUG_PROGRESS_NODE_STRIDE !== 0) {
        return;
      }
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now - lastDebugProgressMs < ROAD_DEBUG_PROGRESS_MIN_MS) {
        return;
      }
      lastDebugProgressMs = now;
      emitRoadPathDebugEvent({
        kind: "road:progress",
        attemptId,
        visitedNodes: progress.visitedNodes,
        openNodes: progress.openNodes,
        current: toPoint(progress.currentIndex, state.grid.cols),
        elapsedMs: Math.max(0, now - startedAt),
        planner: "dijkstra"
      });
    },
    evaluateStep: (front, currentIdx, nextIdx, direction, currentState) =>
      evaluateRoadStreamerStep(
        state,
        startIdx,
        endpointIndices,
        searchBounds,
        options,
        allowBridge,
        gradeLimit,
        crossfallLimit,
        gradeChangeLimit,
        riverDistance,
        roadAngleCache,
        front,
        currentIdx,
        nextIdx,
        direction,
        currentState
      ),
    validateJoin: () => null
  });

  if (!plannerResult.found || plannerResult.pathIndices.length === 0) {
    return finish(
      null,
      plannerResult.budgetAborted,
      plannerResult.visitedNodes,
      undefined,
      plannerResult.selectedDestinationSeed,
      plannerResult.failureReason
    );
  }
  const result = buildPathResult(state, plannerResult.pathIndices, riverDistance, options);
  if (options.pathMode === "mountainPass") {
    result.mountainPassFallback = true;
  }
  result.switchbackRoute = options.pathMode === "switchback" && result.switchbackTurnCount > 0;
  return finish(
    result,
    plannerResult.budgetAborted,
    plannerResult.visitedNodes,
    plannerResult.totalCost,
    plannerResult.selectedDestinationSeed,
    null
  );
};

const recordPathStats = (result: RoadPathResult): void => {
  roadGenerationStats.pathsFound += 1;
  roadGenerationStats.maxRealizedGrade = Math.max(roadGenerationStats.maxRealizedGrade, result.maxGrade);
  roadGenerationStats.maxRealizedCrossfall = Math.max(roadGenerationStats.maxRealizedCrossfall, result.maxCrossfall);
  roadGenerationStats.maxRealizedGradeChange = Math.max(
    roadGenerationStats.maxRealizedGradeChange,
    result.maxGradeChange
  );
  const previousCount = Math.max(0, roadGenerationStats.pathsFound - 1);
  roadGenerationStats.meanRealizedAngleDeg =
    (roadGenerationStats.meanRealizedAngleDeg * previousCount + result.meanAngleDeg) /
    Math.max(1, roadGenerationStats.pathsFound);
  roadGenerationStats.maxRealizedAngleDeg = Math.max(roadGenerationStats.maxRealizedAngleDeg, result.maxAngleDeg);
  roadGenerationStats.highAngleStepCount += result.highAngleStepCount;
  roadGenerationStats.minRiverClearance = Math.min(roadGenerationStats.minRiverClearance, result.minRiverClearance);
  roadGenerationStats.bridgeSegments += result.bridgeSegments;
  roadGenerationStats.mountainPassFallbackCount += result.mountainPassFallback ? 1 : 0;
  roadGenerationStats.switchbackTurnCount += result.switchbackTurnCount;
  roadGenerationStats.switchbackRouteCount += result.switchbackRoute ? 1 : 0;
  roadGenerationStats.hairpinGradeDiscountCount += result.hairpinGradeDiscountCount;
  roadGenerationStats.longStraightSteepSegmentCount += result.longStraightSteepSegmentCount;
};

const runAStar = (
  state: WorldState,
  start: Point,
  end: Point | null,
  isTarget: ((x: number, y: number) => boolean) | null,
  options: RoadPathOptionsResolved,
  allowBridge: boolean,
  gradeLimit: number,
  crossfallLimit: number,
  gradeChangeLimit: number
): RoadPathResult | null => {
  const debug = roadPathDebugHooks;
  debug?.checkCancelled?.();
  const attemptId = nextRoadPathDebugAttemptId++;
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const finish = (result: RoadPathResult | null, budgetAborted: boolean, visitedNodes: number): RoadPathResult | null => {
    const acceptedResult = rejectRoadPathForDetour(result, start, end, options);
    const endedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    emitRoadPathDebugEvent({
      kind: "road:result",
      attemptId,
      diagnosticRouteId: options.diagnosticRouteId,
      diagnosticRouteLabel: options.diagnosticRouteLabel,
      found: !!acceptedResult,
      budgetAborted,
      visitedNodes,
      pathLength: acceptedResult?.path.length ?? 0,
      bridgeTileIndices: acceptedResult?.bridgeTileIndices ? [...acceptedResult.bridgeTileIndices] : undefined,
      elapsedMs: Math.max(0, endedAt - startedAt),
      mode: options.pathMode,
      routeGroup: options.diagnosticRouteGroup,
      allowBridge,
      planner: "astar"
    });
    return acceptedResult;
  };
  emitRoadPathDebugEvent({
    kind: "road:attempt",
    attemptId,
    diagnosticRouteId: options.diagnosticRouteId,
    diagnosticRouteLabel: options.diagnosticRouteLabel,
    attemptKind: end ? "point" : "target",
    planner: "astar",
    start: { ...start },
    end: end ? { ...end } : undefined,
    mode: options.pathMode,
    routeGroup: options.diagnosticRouteGroup,
    allowBridge,
    gradeLimit,
    crossfallLimit,
    gradeChangeLimit,
    maxSearchNodeVisits: options.maxSearchNodeVisits
  });
  if (!inBounds(state.grid, start.x, start.y)) {
    return finish(null, false, 0);
  }
  if (end && !inBounds(state.grid, end.x, end.y)) {
    return finish(null, false, 0);
  }
  const searchBounds = options.searchBounds ? expandRoadTileBounds(state, options.searchBounds, 0) : null;
  if (!isPointInRoadBounds(start, searchBounds) || (end && !isPointInRoadBounds(end, searchBounds))) {
    return finish(null, false, 0);
  }
  const total = state.grid.totalTiles;
  const cols = state.grid.cols;
  const startIdx = indexFor(state.grid, start.x, start.y);
  const endIdx = end ? indexFor(state.grid, end.x, end.y) : -1;
  const riverDistance = getRiverDistanceField(state);
  const elevationToGradeScale = getRoadGradeScale(state, options.heightScaleMultiplier);
  const roadAngleCache = new Float32Array(total);
  roadAngleCache.fill(-1);

  if (
    !canTraverseTileIndex(state, startIdx, true, allowBridge, options, riverDistance) ||
    (endIdx >= 0 && !canTraverseTileIndex(state, endIdx, true, allowBridge, options, riverDistance))
  ) {
    return finish(null, false, 0);
  }
  if (endIdx >= 0 && startIdx === endIdx) {
    return finish({
      path: [start],
      bridgeTileIndices: [],
      maxGrade: 0,
      maxCrossfall: 0,
      maxGradeChange: 0,
      maxAngleDeg: 0,
      meanAngleDeg: 0,
      highAngleStepCount: 0,
      minRiverClearance: riverDistance[startIdx],
      bridgeSegments: 0,
      mountainPassFallback: false,
      switchbackTurnCount: 0,
      switchbackRoute: false,
      hairpinGradeDiscountCount: 0,
      longStraightSteepSegmentCount: 0
    }, false, 0);
  }

  const gScore = new Float64Array(total);
  gScore.fill(Number.POSITIVE_INFINITY);
  const prev = new Int32Array(total);
  prev.fill(-1);
  const closed = new Uint8Array(total);
  const waterTilesUsed = new Int16Array(total);
  waterTilesUsed.fill(32767);
  const consecutiveWater = new Int8Array(total);
  const stepDx = new Int8Array(total);
  const stepDy = new Int8Array(total);
  const signedGradeAt = new Float32Array(total);
  const crossfallAt = new Float32Array(total);
  const steepRunAt = new Int16Array(total);
  const stepsSinceTurnAt = new Int16Array(total);
  const turnDirectionAt = new Int8Array(total);
  const stepsSinceTurnDirectionChangeAt = new Int16Array(total);
  const lateralLegLengthAt = new Int16Array(total);
  const stepsSinceHairpinDiscountAt = new Int16Array(total);
  const hairpinSteepStepRunAt = new Int16Array(total);
  const cumulativeClimbAt = new Float32Array(total);
  const cumulativeDescentAt = new Float32Array(total);
  const switchbackTurnsAt = new Int16Array(total);
  const hairpinGradeDiscountsAt = new Int16Array(total);
  const longStraightSteepAt = new Int16Array(total);
  const openIdx: number[] = [];
  const openF: number[] = [];

  const estimate = (x: number, y: number): number => {
    if (!end) {
      return 0;
    }
    const dx = Math.abs(x - end.x);
    const dy = Math.abs(y - end.y);
    const diagonal = Math.min(dx, dy);
    const octile = dx + dy + (Math.SQRT2 - 2) * diagonal;
    return octile * Math.min(1, ROAD_EXISTING_SEGMENT_COST_MULTIPLIER);
  };

  const startWater = state.tiles[startIdx].type === "water" && state.tileRoadBridge[startIdx] === 0 ? 1 : 0;
  gScore[startIdx] = 0;
  prev[startIdx] = startIdx;
  waterTilesUsed[startIdx] = startWater;
  consecutiveWater[startIdx] = startWater;
  stepsSinceTurnAt[startIdx] = 32767;
  stepsSinceTurnDirectionChangeAt[startIdx] = 32767;
  lateralLegLengthAt[startIdx] = 0;
  stepsSinceHairpinDiscountAt[startIdx] = 32767;
  heapPush(openIdx, openF, startIdx, estimate(start.x, start.y));

  let goalIdx = -1;
  let visitedNodes = 0;
  let lastDebugProgressMs = startedAt;
  while (openIdx.length > 0) {
    debug?.checkCancelled?.();
    const currentIdx = heapPop(openIdx, openF);
    if (currentIdx < 0 || closed[currentIdx]) {
      continue;
    }
    closed[currentIdx] = 1;
    visitedNodes += 1;
    if (options.maxSearchNodeVisits > 0 && visitedNodes > options.maxSearchNodeVisits) {
      roadGenerationStats.searchBudgetAbortCount += 1;
      return finish(null, true, visitedNodes);
    }
    const cx = currentIdx % cols;
    const cy = Math.floor(currentIdx / cols);
    if (debug && visitedNodes % ROAD_DEBUG_PROGRESS_NODE_STRIDE === 0) {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now - lastDebugProgressMs >= ROAD_DEBUG_PROGRESS_MIN_MS) {
        lastDebugProgressMs = now;
        emitRoadPathDebugEvent({
          kind: "road:progress",
          attemptId,
          visitedNodes,
          openNodes: openIdx.length,
          current: { x: cx, y: cy },
          elapsedMs: Math.max(0, now - startedAt),
          planner: "astar"
        });
      }
    }
    const isGoal = end ? currentIdx === endIdx : !!isTarget?.(cx, cy);
    if (isGoal) {
      goalIdx = currentIdx;
      break;
    }
    const currentG = gScore[currentIdx];
    const currentTile = state.tiles[currentIdx];
    const currentIsWater = currentTile.type === "water" && state.tileRoadBridge[currentIdx] === 0;

    for (const dir of ROAD_DIRS) {
      const nx = cx + dir.x;
      const ny = cy + dir.y;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      if (
        searchBounds &&
        (nx < searchBounds.minX || nx > searchBounds.maxX || ny < searchBounds.minY || ny > searchBounds.maxY)
      ) {
        continue;
      }
      const nIdx = indexFor(state.grid, nx, ny);
      if (closed[nIdx]) {
        continue;
      }
      const neighborIsGoal = end ? nIdx === endIdx : false;
      if (!canTraverseTileIndex(state, nIdx, neighborIsGoal, allowBridge, options, riverDistance)) {
        continue;
      }
      if (dir.x !== 0 && dir.y !== 0) {
        const idxA = indexFor(state.grid, cx + dir.x, cy);
        const idxB = indexFor(state.grid, cx, cy + dir.y);
        if (
          !canTraverseTileIndex(state, idxA, false, allowBridge, options, riverDistance) &&
          !canTraverseTileIndex(state, idxB, false, allowBridge, options, riverDistance)
        ) {
          continue;
        }
      }

      const nextTile = state.tiles[nIdx];
      const nextIsWater = nextTile.type === "water" && state.tileRoadBridge[nIdx] === 0;
      let nextWaterUsed = waterTilesUsed[currentIdx];
      let nextConsecutiveWater = 0;
      if (nextIsWater) {
        if (!allowBridge || state.tileRiverMask[nIdx] === 0) {
          continue;
        }
        nextWaterUsed += 1;
        if (nextWaterUsed > options.bridgeMaxWaterTilesPerPath) {
          continue;
        }
        nextConsecutiveWater = consecutiveWater[currentIdx] + 1;
        if (nextConsecutiveWater > options.bridgeMaxConsecutiveWater) {
          continue;
        }
      }

      let signedGrade = 0;
      let grade = 0;
      let crossfall = 0;
      let gradeChange = 0;
      let stepAngleDeg = 0;
      const tileAngleDeg = computeRoadTileAngleDeg(state, nIdx, options.heightScaleMultiplier, roadAngleCache);
      if (tileAngleDeg > options.avoidAngleDeg && !isRoadLikeIndex(state, nIdx) && !neighborIsGoal) {
        continue;
      }
      const hasPreviousLandStep =
        prev[currentIdx] !== currentIdx &&
        currentIsWater === false &&
        state.tiles[prev[currentIdx]]?.type !== "water";
      if (!currentIsWater && !nextIsWater) {
        signedGrade = computeStepSignedGrade(currentTile.elevation, nextTile.elevation, dir.cost, elevationToGradeScale);
        grade = Math.abs(signedGrade);
        if (grade > gradeLimit) {
          continue;
        }
        stepAngleDeg = computeRoadStepAngleDeg(state, currentTile.elevation, nextTile.elevation, dir.cost, options.heightScaleMultiplier);
        if (stepAngleDeg > options.avoidAngleDeg && !isRoadLikeIndex(state, nIdx) && !neighborIsGoal) {
          continue;
        }
        crossfall = computeCrossfallAtStep(
          state,
          cx,
          cy,
          nx,
          ny,
          currentTile.elevation,
          nextTile.elevation,
          elevationToGradeScale
        );
        if (crossfall > crossfallLimit) {
          continue;
        }
        if (hasPreviousLandStep) {
          gradeChange = Math.abs(signedGrade - signedGradeAt[currentIdx]);
          if (gradeChange > gradeChangeLimit) {
            continue;
          }
        }
      }

      let stepCost = dir.cost;
      if (dir.x !== 0 && dir.y !== 0) {
        stepCost += options.diagonalPenalty;
      }
      let plannerStepScore: ReturnType<typeof scoreRoadPlannerStep> | null = null;
      if (!currentIsWater && !nextIsWater) {
        plannerStepScore = scoreRoadPlannerStep({
          mode: options.pathMode,
          hasPreviousLandStep,
          previousDx: stepDx[currentIdx],
          previousDy: stepDy[currentIdx],
          nextDx: dir.x,
          nextDy: dir.y,
          previousSignedGrade: signedGradeAt[currentIdx],
          nextSignedGrade: signedGrade,
          previousCrossfall: crossfallAt[currentIdx],
          nextCrossfall: crossfall,
          stepAngleDeg,
          tileAngleDeg,
          softAngleDeg: options.softAngleDeg,
          avoidAngleDeg: options.avoidAngleDeg,
          straightClimbPenaltyWeight: options.straightClimbPenaltyWeight,
          contourTurnReliefWeight: options.contourTurnReliefWeight,
          previousSteepRun: steepRunAt[currentIdx],
          previousStepsSinceTurn: stepsSinceTurnAt[currentIdx],
          previousTurnDirection: turnDirectionAt[currentIdx],
          previousStepsSinceTurnDirectionChange: stepsSinceTurnDirectionChangeAt[currentIdx],
          previousLateralLegLength: lateralLegLengthAt[currentIdx],
          previousStepsSinceHairpinDiscount: stepsSinceHairpinDiscountAt[currentIdx],
          previousHairpinSteepStepRun: hairpinSteepStepRunAt[currentIdx],
          previousCumulativeClimb: cumulativeClimbAt[currentIdx],
          previousCumulativeDescent: cumulativeDescentAt[currentIdx],
          localPlatformCrossfall: crossfall,
          localPlatformAngleDeg: tileAngleDeg,
          riverDistance: riverDistance[nIdx],
          riverBlockDistance: options.riverBlockDistance
        });
        stepCost += grade * options.slopePenaltyWeight * plannerStepScore.gradePenaltyMultiplier;
        stepCost += crossfall * options.crossfallPenaltyWeight;
        stepCost += gradeChange * options.gradeChangePenaltyWeight;
        stepCost += scoreRoadAnglePenalty(Math.max(stepAngleDeg, tileAngleDeg), options);
        stepCost += plannerStepScore.costAdjustment;
      }
      if (nextIsWater) {
        stepCost += options.bridgeStepCost;
      } else if (!isRoadLikeIndex(state, nIdx) && options.riverPenaltyDistance > 0) {
        const riverDist = riverDistance[nIdx];
        if (riverDist <= options.riverPenaltyDistance) {
          const riverPenaltyRatio = (options.riverPenaltyDistance - riverDist + 1) / (options.riverPenaltyDistance + 1);
          stepCost += riverPenaltyRatio * options.riverPenaltyWeight;
        }
      }
      if (isRoadLikeIndex(state, nIdx)) {
        stepCost *= ROAD_EXISTING_SEGMENT_COST_MULTIPLIER;
      }
      if (prev[currentIdx] !== currentIdx && (stepDx[currentIdx] !== dir.x || stepDy[currentIdx] !== dir.y)) {
        let turnPenalty = options.turnPenalty;
        if (!currentIsWater && !nextIsWater && hasPreviousLandStep) {
          const previousSeverity = Math.max(Math.abs(signedGradeAt[currentIdx]), crossfallAt[currentIdx]);
          const nextSeverity = Math.max(grade, crossfall);
          if (nextSeverity < previousSeverity) {
            const relief = Math.min(
              0.9,
              (previousSeverity - nextSeverity) * ROAD_SWITCHBACK_RELIEF_WEIGHT +
                Math.max(0, stepAngleDeg - options.softAngleDeg) * 0.02 * options.contourTurnReliefWeight
            );
            turnPenalty *= 1 - relief;
          }
        }
        if (plannerStepScore) {
          turnPenalty *= plannerStepScore.turnPenaltyMultiplier;
        }
        stepCost += turnPenalty;
      }

      const nextG = currentG + stepCost;
      const equalCost = Math.abs(nextG - gScore[nIdx]) <= 1e-7;
      const betterWaterUsage = nextWaterUsed < waterTilesUsed[nIdx];
      const nextSlopeState = grade + crossfall + gradeChange;
      const currentSlopeState = Math.abs(signedGradeAt[nIdx]) + crossfallAt[nIdx];
      if (nextG > gScore[nIdx] + 1e-7 && !betterWaterUsage) {
        continue;
      }
      if (equalCost && !betterWaterUsage && nextSlopeState >= currentSlopeState - 1e-6) {
        continue;
      }

      gScore[nIdx] = nextG;
      prev[nIdx] = currentIdx;
      waterTilesUsed[nIdx] = nextWaterUsed;
      consecutiveWater[nIdx] = nextConsecutiveWater;
      stepDx[nIdx] = dir.x;
      stepDy[nIdx] = dir.y;
      signedGradeAt[nIdx] = signedGrade;
      crossfallAt[nIdx] = crossfall;
      if (plannerStepScore) {
        steepRunAt[nIdx] = plannerStepScore.nextSteepRun;
        stepsSinceTurnAt[nIdx] = plannerStepScore.nextStepsSinceTurn;
        turnDirectionAt[nIdx] = plannerStepScore.nextTurnDirection;
        stepsSinceTurnDirectionChangeAt[nIdx] = plannerStepScore.nextStepsSinceTurnDirectionChange;
        lateralLegLengthAt[nIdx] = plannerStepScore.nextLateralLegLength;
        stepsSinceHairpinDiscountAt[nIdx] = plannerStepScore.nextStepsSinceHairpinDiscount;
        hairpinSteepStepRunAt[nIdx] = plannerStepScore.nextHairpinSteepStepRun;
        cumulativeClimbAt[nIdx] = plannerStepScore.nextCumulativeClimb;
        cumulativeDescentAt[nIdx] = plannerStepScore.nextCumulativeDescent;
        switchbackTurnsAt[nIdx] = switchbackTurnsAt[currentIdx] + (plannerStepScore.switchbackTurn ? 1 : 0);
        hairpinGradeDiscountsAt[nIdx] =
          hairpinGradeDiscountsAt[currentIdx] + (plannerStepScore.hairpinGradeDiscount ? 1 : 0);
        longStraightSteepAt[nIdx] = longStraightSteepAt[currentIdx] + (plannerStepScore.longStraightSteep ? 1 : 0);
      } else {
        steepRunAt[nIdx] = 0;
        stepsSinceTurnAt[nIdx] = Math.min(32767, stepsSinceTurnAt[currentIdx] + 1);
        turnDirectionAt[nIdx] = turnDirectionAt[currentIdx];
        stepsSinceTurnDirectionChangeAt[nIdx] = Math.min(32767, stepsSinceTurnDirectionChangeAt[currentIdx] + 1);
        lateralLegLengthAt[nIdx] = Math.min(32767, lateralLegLengthAt[currentIdx] + 1);
        stepsSinceHairpinDiscountAt[nIdx] = Math.min(32767, stepsSinceHairpinDiscountAt[currentIdx] + 1);
        hairpinSteepStepRunAt[nIdx] = 0;
        cumulativeClimbAt[nIdx] = cumulativeClimbAt[currentIdx];
        cumulativeDescentAt[nIdx] = cumulativeDescentAt[currentIdx];
        switchbackTurnsAt[nIdx] = switchbackTurnsAt[currentIdx];
        hairpinGradeDiscountsAt[nIdx] = hairpinGradeDiscountsAt[currentIdx];
        longStraightSteepAt[nIdx] = longStraightSteepAt[currentIdx];
      }
      heapPush(openIdx, openF, nIdx, nextG + estimate(nx, ny));
    }
  }

  if (goalIdx < 0) {
    return finish(null, false, visitedNodes);
  }

  const pathIndices: number[] = [];
  let current = goalIdx;
  const pathGuard = new Uint8Array(total);
  while (current !== startIdx) {
    if (pathGuard[current] > 0) {
      return finish(null, false, visitedNodes);
    }
    pathGuard[current] = 1;
    pathIndices.push(current);
    current = prev[current];
    if (current < 0) {
      return finish(null, false, visitedNodes);
    }
  }
  pathIndices.push(startIdx);
  pathIndices.reverse();
  const result = buildPathResult(state, pathIndices, riverDistance, options);
  result.switchbackTurnCount = Math.max(result.switchbackTurnCount, switchbackTurnsAt[goalIdx]);
  result.hairpinGradeDiscountCount = Math.max(result.hairpinGradeDiscountCount, hairpinGradeDiscountsAt[goalIdx]);
  result.longStraightSteepSegmentCount = Math.max(result.longStraightSteepSegmentCount, longStraightSteepAt[goalIdx]);
  result.switchbackRoute = options.pathMode === "switchback" && result.switchbackTurnCount > 0;
  return finish(result, false, visitedNodes);
};

const runAStarAsync = async (
  state: WorldState,
  start: Point,
  end: Point | null,
  isTarget: ((x: number, y: number) => boolean) | null,
  options: RoadPathOptionsResolved,
  allowBridge: boolean,
  gradeLimit: number,
  crossfallLimit: number,
  gradeChangeLimit: number
): Promise<RoadPathResult | null> => {
  const debug = roadPathDebugHooks;
  debug?.checkCancelled?.();
  const attemptId = nextRoadPathDebugAttemptId++;
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const finish = (result: RoadPathResult | null, budgetAborted: boolean, visitedNodes: number): RoadPathResult | null => {
    const acceptedResult = rejectRoadPathForDetour(result, start, end, options);
    const endedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    emitRoadPathDebugEvent({
      kind: "road:result",
      attemptId,
      diagnosticRouteId: options.diagnosticRouteId,
      diagnosticRouteLabel: options.diagnosticRouteLabel,
      found: !!acceptedResult,
      budgetAborted,
      visitedNodes,
      pathLength: acceptedResult?.path.length ?? 0,
      bridgeTileIndices: acceptedResult?.bridgeTileIndices ? [...acceptedResult.bridgeTileIndices] : undefined,
      elapsedMs: Math.max(0, endedAt - startedAt),
      mode: options.pathMode,
      routeGroup: options.diagnosticRouteGroup,
      allowBridge,
      planner: "astar"
    });
    return acceptedResult;
  };
  emitRoadPathDebugEvent({
    kind: "road:attempt",
    attemptId,
    diagnosticRouteId: options.diagnosticRouteId,
    diagnosticRouteLabel: options.diagnosticRouteLabel,
    attemptKind: end ? "point" : "target",
    planner: "astar",
    start: { ...start },
    end: end ? { ...end } : undefined,
    mode: options.pathMode,
    routeGroup: options.diagnosticRouteGroup,
    allowBridge,
    gradeLimit,
    crossfallLimit,
    gradeChangeLimit,
    maxSearchNodeVisits: options.maxSearchNodeVisits
  });
  if (!inBounds(state.grid, start.x, start.y)) {
    return finish(null, false, 0);
  }
  if (end && !inBounds(state.grid, end.x, end.y)) {
    return finish(null, false, 0);
  }
  const searchBounds = options.searchBounds ? expandRoadTileBounds(state, options.searchBounds, 0) : null;
  if (!isPointInRoadBounds(start, searchBounds) || (end && !isPointInRoadBounds(end, searchBounds))) {
    return finish(null, false, 0);
  }
  const total = state.grid.totalTiles;
  const cols = state.grid.cols;
  const startIdx = indexFor(state.grid, start.x, start.y);
  const endIdx = end ? indexFor(state.grid, end.x, end.y) : -1;
  const riverDistance = getRiverDistanceField(state);
  const elevationToGradeScale = getRoadGradeScale(state, options.heightScaleMultiplier);
  const roadAngleCache = new Float32Array(total);
  roadAngleCache.fill(-1);

  if (
    !canTraverseTileIndex(state, startIdx, true, allowBridge, options, riverDistance) ||
    (endIdx >= 0 && !canTraverseTileIndex(state, endIdx, true, allowBridge, options, riverDistance))
  ) {
    return finish(null, false, 0);
  }
  if (endIdx >= 0 && startIdx === endIdx) {
    return finish({
      path: [start],
      bridgeTileIndices: [],
      maxGrade: 0,
      maxCrossfall: 0,
      maxGradeChange: 0,
      maxAngleDeg: 0,
      meanAngleDeg: 0,
      highAngleStepCount: 0,
      minRiverClearance: riverDistance[startIdx],
      bridgeSegments: 0,
      mountainPassFallback: false,
      switchbackTurnCount: 0,
      switchbackRoute: false,
      hairpinGradeDiscountCount: 0,
      longStraightSteepSegmentCount: 0
    }, false, 0);
  }

  const gScore = new Float64Array(total);
  gScore.fill(Number.POSITIVE_INFINITY);
  const prev = new Int32Array(total);
  prev.fill(-1);
  const closed = new Uint8Array(total);
  const waterTilesUsed = new Int16Array(total);
  waterTilesUsed.fill(32767);
  const consecutiveWater = new Int8Array(total);
  const stepDx = new Int8Array(total);
  const stepDy = new Int8Array(total);
  const signedGradeAt = new Float32Array(total);
  const crossfallAt = new Float32Array(total);
  const steepRunAt = new Int16Array(total);
  const stepsSinceTurnAt = new Int16Array(total);
  const turnDirectionAt = new Int8Array(total);
  const stepsSinceTurnDirectionChangeAt = new Int16Array(total);
  const lateralLegLengthAt = new Int16Array(total);
  const stepsSinceHairpinDiscountAt = new Int16Array(total);
  const hairpinSteepStepRunAt = new Int16Array(total);
  const cumulativeClimbAt = new Float32Array(total);
  const cumulativeDescentAt = new Float32Array(total);
  const switchbackTurnsAt = new Int16Array(total);
  const hairpinGradeDiscountsAt = new Int16Array(total);
  const longStraightSteepAt = new Int16Array(total);
  const openIdx: number[] = [];
  const openF: number[] = [];

  const estimate = (x: number, y: number): number => {
    if (!end) {
      return 0;
    }
    const dx = Math.abs(x - end.x);
    const dy = Math.abs(y - end.y);
    const diagonal = Math.min(dx, dy);
    const octile = dx + dy + (Math.SQRT2 - 2) * diagonal;
    return octile * Math.min(1, ROAD_EXISTING_SEGMENT_COST_MULTIPLIER);
  };

  const startWater = state.tiles[startIdx].type === "water" && state.tileRoadBridge[startIdx] === 0 ? 1 : 0;
  gScore[startIdx] = 0;
  prev[startIdx] = startIdx;
  waterTilesUsed[startIdx] = startWater;
  consecutiveWater[startIdx] = startWater;
  stepsSinceTurnAt[startIdx] = 32767;
  stepsSinceTurnDirectionChangeAt[startIdx] = 32767;
  lateralLegLengthAt[startIdx] = 0;
  stepsSinceHairpinDiscountAt[startIdx] = 32767;
  heapPush(openIdx, openF, startIdx, estimate(start.x, start.y));

  let goalIdx = -1;
  let visitedNodes = 0;
  let lastDebugProgressMs = startedAt;
  while (openIdx.length > 0) {
    debug?.checkCancelled?.();
    const currentIdx = heapPop(openIdx, openF);
    if (currentIdx < 0 || closed[currentIdx]) {
      continue;
    }
    closed[currentIdx] = 1;
    visitedNodes += 1;
    if (options.maxSearchNodeVisits > 0 && visitedNodes > options.maxSearchNodeVisits) {
      roadGenerationStats.searchBudgetAbortCount += 1;
      return finish(null, true, visitedNodes);
    }
    const cx = currentIdx % cols;
    const cy = Math.floor(currentIdx / cols);
    if (debug && visitedNodes % ROAD_DEBUG_PROGRESS_NODE_STRIDE === 0) {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now - lastDebugProgressMs >= ROAD_DEBUG_PROGRESS_MIN_MS) {
        lastDebugProgressMs = now;
        emitRoadPathDebugEvent({
          kind: "road:progress",
          attemptId,
          visitedNodes,
          openNodes: openIdx.length,
          current: { x: cx, y: cy },
          elapsedMs: Math.max(0, now - startedAt),
          planner: "astar"
        });
        await (debug.yield?.() ?? yieldToNextFrame());
        debug.checkCancelled?.();
      }
    }
    const isGoal = end ? currentIdx === endIdx : !!isTarget?.(cx, cy);
    if (isGoal) {
      goalIdx = currentIdx;
      break;
    }
    const currentG = gScore[currentIdx];
    const currentTile = state.tiles[currentIdx];
    const currentIsWater = currentTile.type === "water" && state.tileRoadBridge[currentIdx] === 0;

    for (const dir of ROAD_DIRS) {
      const nx = cx + dir.x;
      const ny = cy + dir.y;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      if (
        searchBounds &&
        (nx < searchBounds.minX || nx > searchBounds.maxX || ny < searchBounds.minY || ny > searchBounds.maxY)
      ) {
        continue;
      }
      const nIdx = indexFor(state.grid, nx, ny);
      if (closed[nIdx]) {
        continue;
      }
      const neighborIsGoal = end ? nIdx === endIdx : false;
      if (!canTraverseTileIndex(state, nIdx, neighborIsGoal, allowBridge, options, riverDistance)) {
        continue;
      }
      if (dir.x !== 0 && dir.y !== 0) {
        const idxA = indexFor(state.grid, cx + dir.x, cy);
        const idxB = indexFor(state.grid, cx, cy + dir.y);
        if (
          !canTraverseTileIndex(state, idxA, false, allowBridge, options, riverDistance) &&
          !canTraverseTileIndex(state, idxB, false, allowBridge, options, riverDistance)
        ) {
          continue;
        }
      }

      const nextTile = state.tiles[nIdx];
      const nextIsWater = nextTile.type === "water" && state.tileRoadBridge[nIdx] === 0;
      let nextWaterUsed = waterTilesUsed[currentIdx];
      let nextConsecutiveWater = 0;
      if (nextIsWater) {
        if (!allowBridge || state.tileRiverMask[nIdx] === 0) {
          continue;
        }
        nextWaterUsed += 1;
        if (nextWaterUsed > options.bridgeMaxWaterTilesPerPath) {
          continue;
        }
        nextConsecutiveWater = consecutiveWater[currentIdx] + 1;
        if (nextConsecutiveWater > options.bridgeMaxConsecutiveWater) {
          continue;
        }
      }

      let signedGrade = 0;
      let grade = 0;
      let crossfall = 0;
      let gradeChange = 0;
      let stepAngleDeg = 0;
      const tileAngleDeg = computeRoadTileAngleDeg(state, nIdx, options.heightScaleMultiplier, roadAngleCache);
      if (tileAngleDeg > options.avoidAngleDeg && !isRoadLikeIndex(state, nIdx) && !neighborIsGoal) {
        continue;
      }
      const hasPreviousLandStep =
        prev[currentIdx] !== currentIdx &&
        currentIsWater === false &&
        state.tiles[prev[currentIdx]]?.type !== "water";
      if (!currentIsWater && !nextIsWater) {
        signedGrade = computeStepSignedGrade(currentTile.elevation, nextTile.elevation, dir.cost, elevationToGradeScale);
        grade = Math.abs(signedGrade);
        if (grade > gradeLimit) {
          continue;
        }
        stepAngleDeg = computeRoadStepAngleDeg(state, currentTile.elevation, nextTile.elevation, dir.cost, options.heightScaleMultiplier);
        if (stepAngleDeg > options.avoidAngleDeg && !isRoadLikeIndex(state, nIdx) && !neighborIsGoal) {
          continue;
        }
        crossfall = computeCrossfallAtStep(
          state,
          cx,
          cy,
          nx,
          ny,
          currentTile.elevation,
          nextTile.elevation,
          elevationToGradeScale
        );
        if (crossfall > crossfallLimit) {
          continue;
        }
        if (hasPreviousLandStep) {
          gradeChange = Math.abs(signedGrade - signedGradeAt[currentIdx]);
          if (gradeChange > gradeChangeLimit) {
            continue;
          }
        }
      }

      let stepCost = dir.cost;
      if (dir.x !== 0 && dir.y !== 0) {
        stepCost += options.diagonalPenalty;
      }
      let plannerStepScore: ReturnType<typeof scoreRoadPlannerStep> | null = null;
      if (!currentIsWater && !nextIsWater) {
        plannerStepScore = scoreRoadPlannerStep({
          mode: options.pathMode,
          hasPreviousLandStep,
          previousDx: stepDx[currentIdx],
          previousDy: stepDy[currentIdx],
          nextDx: dir.x,
          nextDy: dir.y,
          previousSignedGrade: signedGradeAt[currentIdx],
          nextSignedGrade: signedGrade,
          previousCrossfall: crossfallAt[currentIdx],
          nextCrossfall: crossfall,
          stepAngleDeg,
          tileAngleDeg,
          softAngleDeg: options.softAngleDeg,
          avoidAngleDeg: options.avoidAngleDeg,
          straightClimbPenaltyWeight: options.straightClimbPenaltyWeight,
          contourTurnReliefWeight: options.contourTurnReliefWeight,
          previousSteepRun: steepRunAt[currentIdx],
          previousStepsSinceTurn: stepsSinceTurnAt[currentIdx],
          previousTurnDirection: turnDirectionAt[currentIdx],
          previousStepsSinceTurnDirectionChange: stepsSinceTurnDirectionChangeAt[currentIdx],
          previousLateralLegLength: lateralLegLengthAt[currentIdx],
          previousStepsSinceHairpinDiscount: stepsSinceHairpinDiscountAt[currentIdx],
          previousHairpinSteepStepRun: hairpinSteepStepRunAt[currentIdx],
          previousCumulativeClimb: cumulativeClimbAt[currentIdx],
          previousCumulativeDescent: cumulativeDescentAt[currentIdx],
          localPlatformCrossfall: crossfall,
          localPlatformAngleDeg: tileAngleDeg,
          riverDistance: riverDistance[nIdx],
          riverBlockDistance: options.riverBlockDistance
        });
        stepCost += grade * options.slopePenaltyWeight * plannerStepScore.gradePenaltyMultiplier;
        stepCost += crossfall * options.crossfallPenaltyWeight;
        stepCost += gradeChange * options.gradeChangePenaltyWeight;
        stepCost += scoreRoadAnglePenalty(Math.max(stepAngleDeg, tileAngleDeg), options);
        stepCost += plannerStepScore.costAdjustment;
      }
      if (nextIsWater) {
        stepCost += options.bridgeStepCost;
      } else if (!isRoadLikeIndex(state, nIdx) && options.riverPenaltyDistance > 0) {
        const riverDist = riverDistance[nIdx];
        if (riverDist <= options.riverPenaltyDistance) {
          const riverPenaltyRatio = (options.riverPenaltyDistance - riverDist + 1) / (options.riverPenaltyDistance + 1);
          stepCost += riverPenaltyRatio * options.riverPenaltyWeight;
        }
      }
      if (isRoadLikeIndex(state, nIdx)) {
        stepCost *= ROAD_EXISTING_SEGMENT_COST_MULTIPLIER;
      }
      if (prev[currentIdx] !== currentIdx && (stepDx[currentIdx] !== dir.x || stepDy[currentIdx] !== dir.y)) {
        let turnPenalty = options.turnPenalty;
        if (!currentIsWater && !nextIsWater && hasPreviousLandStep) {
          const previousSeverity = Math.max(Math.abs(signedGradeAt[currentIdx]), crossfallAt[currentIdx]);
          const nextSeverity = Math.max(grade, crossfall);
          if (nextSeverity < previousSeverity) {
            const relief = Math.min(
              0.9,
              (previousSeverity - nextSeverity) * ROAD_SWITCHBACK_RELIEF_WEIGHT +
                Math.max(0, stepAngleDeg - options.softAngleDeg) * 0.02 * options.contourTurnReliefWeight
            );
            turnPenalty *= 1 - relief;
          }
        }
        if (plannerStepScore) {
          turnPenalty *= plannerStepScore.turnPenaltyMultiplier;
        }
        stepCost += turnPenalty;
      }

      const nextG = currentG + stepCost;
      const equalCost = Math.abs(nextG - gScore[nIdx]) <= 1e-7;
      const betterWaterUsage = nextWaterUsed < waterTilesUsed[nIdx];
      const nextSlopeState = grade + crossfall + gradeChange;
      const currentSlopeState = Math.abs(signedGradeAt[nIdx]) + crossfallAt[nIdx];
      if (nextG > gScore[nIdx] + 1e-7 && !betterWaterUsage) {
        continue;
      }
      if (equalCost && !betterWaterUsage && nextSlopeState >= currentSlopeState - 1e-6) {
        continue;
      }

      gScore[nIdx] = nextG;
      prev[nIdx] = currentIdx;
      waterTilesUsed[nIdx] = nextWaterUsed;
      consecutiveWater[nIdx] = nextConsecutiveWater;
      stepDx[nIdx] = dir.x;
      stepDy[nIdx] = dir.y;
      signedGradeAt[nIdx] = signedGrade;
      crossfallAt[nIdx] = crossfall;
      if (plannerStepScore) {
        steepRunAt[nIdx] = plannerStepScore.nextSteepRun;
        stepsSinceTurnAt[nIdx] = plannerStepScore.nextStepsSinceTurn;
        turnDirectionAt[nIdx] = plannerStepScore.nextTurnDirection;
        stepsSinceTurnDirectionChangeAt[nIdx] = plannerStepScore.nextStepsSinceTurnDirectionChange;
        lateralLegLengthAt[nIdx] = plannerStepScore.nextLateralLegLength;
        stepsSinceHairpinDiscountAt[nIdx] = plannerStepScore.nextStepsSinceHairpinDiscount;
        hairpinSteepStepRunAt[nIdx] = plannerStepScore.nextHairpinSteepStepRun;
        cumulativeClimbAt[nIdx] = plannerStepScore.nextCumulativeClimb;
        cumulativeDescentAt[nIdx] = plannerStepScore.nextCumulativeDescent;
        switchbackTurnsAt[nIdx] = switchbackTurnsAt[currentIdx] + (plannerStepScore.switchbackTurn ? 1 : 0);
        hairpinGradeDiscountsAt[nIdx] =
          hairpinGradeDiscountsAt[currentIdx] + (plannerStepScore.hairpinGradeDiscount ? 1 : 0);
        longStraightSteepAt[nIdx] = longStraightSteepAt[currentIdx] + (plannerStepScore.longStraightSteep ? 1 : 0);
      } else {
        steepRunAt[nIdx] = 0;
        stepsSinceTurnAt[nIdx] = Math.min(32767, stepsSinceTurnAt[currentIdx] + 1);
        turnDirectionAt[nIdx] = turnDirectionAt[currentIdx];
        stepsSinceTurnDirectionChangeAt[nIdx] = Math.min(32767, stepsSinceTurnDirectionChangeAt[currentIdx] + 1);
        lateralLegLengthAt[nIdx] = Math.min(32767, lateralLegLengthAt[currentIdx] + 1);
        stepsSinceHairpinDiscountAt[nIdx] = Math.min(32767, stepsSinceHairpinDiscountAt[currentIdx] + 1);
        hairpinSteepStepRunAt[nIdx] = 0;
        cumulativeClimbAt[nIdx] = cumulativeClimbAt[currentIdx];
        cumulativeDescentAt[nIdx] = cumulativeDescentAt[currentIdx];
        switchbackTurnsAt[nIdx] = switchbackTurnsAt[currentIdx];
        hairpinGradeDiscountsAt[nIdx] = hairpinGradeDiscountsAt[currentIdx];
        longStraightSteepAt[nIdx] = longStraightSteepAt[currentIdx];
      }
      heapPush(openIdx, openF, nIdx, nextG + estimate(nx, ny));
    }
  }

  if (goalIdx < 0) {
    return finish(null, false, visitedNodes);
  }

  const pathIndices: number[] = [];
  let current = goalIdx;
  const pathGuard = new Uint8Array(total);
  while (current !== startIdx) {
    if (pathGuard[current] > 0) {
      return finish(null, false, visitedNodes);
    }
    pathGuard[current] = 1;
    pathIndices.push(current);
    current = prev[current];
    if (current < 0) {
      return finish(null, false, visitedNodes);
    }
  }
  pathIndices.push(startIdx);
  pathIndices.reverse();
  const result = buildPathResult(state, pathIndices, riverDistance, options);
  result.switchbackTurnCount = Math.max(result.switchbackTurnCount, switchbackTurnsAt[goalIdx]);
  result.hairpinGradeDiscountCount = Math.max(result.hairpinGradeDiscountCount, hairpinGradeDiscountsAt[goalIdx]);
  result.longStraightSteepSegmentCount = Math.max(result.longStraightSteepSegmentCount, longStraightSteepAt[goalIdx]);
  result.switchbackRoute = options.pathMode === "switchback" && result.switchbackTurnCount > 0;
  return finish(result, false, visitedNodes);
};

const findPathWithGradeRelaxation = (
  state: WorldState,
  start: Point,
  end: Point | null,
  isTarget: ((x: number, y: number) => boolean) | null,
  options: RoadPathOptionsResolved,
  allowBridge: boolean
): RoadPathResult | null => {
  const tryOptions = (candidate: RoadPathOptionsResolved): RoadPathResult | null => {
    let gradeLimit = candidate.gradeLimitStart;
    let crossfallLimit = candidate.crossfallLimitStart;
    let gradeChangeLimit = candidate.gradeChangeLimitStart;
    let relaxationPasses = 0;
    while (true) {
      const result = candidate.useBidirectionalStreamer
        ? runBidirectionalStreamer(
            state,
            start,
            end,
            isTarget,
            candidate,
            allowBridge,
            gradeLimit,
            crossfallLimit,
            gradeChangeLimit
          ) ??
          runDijkstraRoadPlanner(
            state,
            start,
            end,
            isTarget,
            candidate,
            allowBridge,
            gradeLimit,
            crossfallLimit,
            gradeChangeLimit
          )
        : runDijkstraRoadPlanner(
          state,
          start,
          end,
          isTarget,
          candidate,
          allowBridge,
          gradeLimit,
          crossfallLimit,
          gradeChangeLimit
          );
      if (result) {
        return result;
      }
      relaxationPasses += 1;
      if (candidate.maxGradeRelaxationPasses !== null && relaxationPasses >= candidate.maxGradeRelaxationPasses) {
        return null;
      }
      const atMaxGrade = gradeLimit >= candidate.gradeLimitMax - 1e-9;
      const atMaxCrossfall = crossfallLimit >= candidate.crossfallLimitMax - 1e-9;
      const atMaxGradeChange = gradeChangeLimit >= candidate.gradeChangeLimitMax - 1e-9;
      if (atMaxGrade && atMaxCrossfall && atMaxGradeChange) {
        return null;
      }
      gradeLimit += candidate.gradeLimitRelaxStep;
      crossfallLimit += candidate.crossfallLimitRelaxStep;
      gradeChangeLimit += candidate.gradeChangeLimitRelaxStep;
      gradeLimit = Math.min(candidate.gradeLimitMax, gradeLimit);
      crossfallLimit = Math.min(candidate.crossfallLimitMax, crossfallLimit);
      gradeChangeLimit = Math.min(candidate.gradeChangeLimitMax, gradeChangeLimit);
    }
  };

  if (options.pathMode === "switchback") {
    roadGenerationStats.switchbackRouteAttempts += 1;
  }
  const standard = tryOptions(options);
  if (standard) {
    return standard;
  }
  if (options.pathMode === "normal" && !options.allowMountainPassFallback) {
    return null;
  }
  if (options.pathMode !== "switchback") {
    roadGenerationStats.switchbackRouteAttempts += 1;
  }
  const switchback = tryOptions(buildSwitchbackFallbackOptions(options));
  if (switchback) {
    return switchback;
  }
  if (!options.allowMountainPassFallback) {
    return null;
  }
  const mountainPass = tryOptions(buildMountainPassFallbackOptions(options));
  if (mountainPass) {
    mountainPass.mountainPassFallback = true;
  }
  return mountainPass;
};

const findPathWithGradeRelaxationAsync = async (
  state: WorldState,
  start: Point,
  end: Point | null,
  isTarget: ((x: number, y: number) => boolean) | null,
  options: RoadPathOptionsResolved,
  allowBridge: boolean
): Promise<RoadPathResult | null> => {
  const tryOptions = async (candidate: RoadPathOptionsResolved): Promise<RoadPathResult | null> => {
    let gradeLimit = candidate.gradeLimitStart;
    let crossfallLimit = candidate.crossfallLimitStart;
    let gradeChangeLimit = candidate.gradeChangeLimitStart;
    let relaxationPasses = 0;
    while (true) {
      const result = candidate.useBidirectionalStreamer
        ? runBidirectionalStreamer(
            state,
            start,
            end,
            isTarget,
            candidate,
            allowBridge,
            gradeLimit,
            crossfallLimit,
            gradeChangeLimit,
            true
          ) ??
          runDijkstraRoadPlanner(
            state,
            start,
            end,
            isTarget,
            candidate,
            allowBridge,
            gradeLimit,
            crossfallLimit,
            gradeChangeLimit
          )
        : runDijkstraRoadPlanner(
          state,
          start,
          end,
          isTarget,
          candidate,
          allowBridge,
          gradeLimit,
          crossfallLimit,
          gradeChangeLimit
          );
      if (result) {
        return result;
      }
      relaxationPasses += 1;
      if (candidate.maxGradeRelaxationPasses !== null && relaxationPasses >= candidate.maxGradeRelaxationPasses) {
        return null;
      }
      const atMaxGrade = gradeLimit >= candidate.gradeLimitMax - 1e-9;
      const atMaxCrossfall = crossfallLimit >= candidate.crossfallLimitMax - 1e-9;
      const atMaxGradeChange = gradeChangeLimit >= candidate.gradeChangeLimitMax - 1e-9;
      if (atMaxGrade && atMaxCrossfall && atMaxGradeChange) {
        return null;
      }
      gradeLimit += candidate.gradeLimitRelaxStep;
      crossfallLimit += candidate.crossfallLimitRelaxStep;
      gradeChangeLimit += candidate.gradeChangeLimitRelaxStep;
      gradeLimit = Math.min(candidate.gradeLimitMax, gradeLimit);
      crossfallLimit = Math.min(candidate.crossfallLimitMax, crossfallLimit);
      gradeChangeLimit = Math.min(candidate.gradeChangeLimitMax, gradeChangeLimit);
    }
  };

  if (options.pathMode === "switchback") {
    roadGenerationStats.switchbackRouteAttempts += 1;
  }
  const standard = await tryOptions(options);
  if (standard) {
    return standard;
  }
  if (options.pathMode === "normal" && !options.allowMountainPassFallback) {
    return null;
  }
  if (options.pathMode !== "switchback") {
    roadGenerationStats.switchbackRouteAttempts += 1;
  }
  const switchback = await tryOptions(buildSwitchbackFallbackOptions(options));
  if (switchback) {
    return switchback;
  }
  if (!options.allowMountainPassFallback) {
    return null;
  }
  const mountainPass = await tryOptions(buildMountainPassFallbackOptions(options));
  if (mountainPass) {
    mountainPass.mountainPassFallback = true;
  }
  return mountainPass;
};

const findRoadPathDetailed = (
  state: WorldState,
  start: Point,
  end: Point,
  options: RoadPathOptions = {}
): RoadPathResult => {
  const resolved = resolveRoadPathOptions(options);
  const failureCache = getRoadPathFailureCache(state);
  const failureKey = buildRoadPathFailureKey(start, end, resolved);
  if (failureCache.failures.has(failureKey)) {
    roadGenerationStats.connectorCacheSkipCount += 1;
    return buildEmptyRoadPathResult();
  }
  roadGenerationStats.pathsAttempted += 1;
  let result: RoadPathResult | null = null;
  if (resolved.bridgePolicy === "allow" && resolved.allowBridgeFirstRetry) {
    result = findPathWithGradeRelaxation(state, start, end, null, resolved, true);
    if (!result) {
      result = findPathWithGradeRelaxation(state, start, end, null, resolved, false);
    }
  } else {
    result = findPathWithGradeRelaxation(state, start, end, null, resolved, false);
  }
  if (!result) {
    failureCache.failures.add(failureKey);
    return buildEmptyRoadPathResult();
  }
  recordPathStats(result);
  return result;
};

const findRoadPathDetailedAsync = async (
  state: WorldState,
  start: Point,
  end: Point,
  options: RoadPathOptions = {}
): Promise<RoadPathResult> => {
  const resolved = resolveRoadPathOptions(options);
  const failureCache = getRoadPathFailureCache(state);
  const failureKey = buildRoadPathFailureKey(start, end, resolved);
  if (failureCache.failures.has(failureKey)) {
    roadGenerationStats.connectorCacheSkipCount += 1;
    return buildEmptyRoadPathResult();
  }
  roadGenerationStats.pathsAttempted += 1;
  let result: RoadPathResult | null = null;
  if (resolved.bridgePolicy === "allow" && resolved.allowBridgeFirstRetry) {
    result = await findPathWithGradeRelaxationAsync(state, start, end, null, resolved, true);
    if (!result) {
      result = await findPathWithGradeRelaxationAsync(state, start, end, null, resolved, false);
    }
  } else {
    result = await findPathWithGradeRelaxationAsync(state, start, end, null, resolved, false);
  }
  if (!result) {
    failureCache.failures.add(failureKey);
    return buildEmptyRoadPathResult();
  }
  recordPathStats(result);
  return result;
};

const findRoadPathToTargetDetailed = (
  state: WorldState,
  start: Point,
  isTarget: (x: number, y: number) => boolean,
  options: RoadPathOptions = {}
): RoadPathResult => {
  const resolved = resolveRoadPathOptions(options);
  roadGenerationStats.pathsAttempted += 1;
  let result: RoadPathResult | null = null;
  if (resolved.bridgePolicy === "allow" && resolved.allowBridgeFirstRetry) {
    result = findPathWithGradeRelaxation(state, start, null, isTarget, resolved, true);
    if (!result) {
      result = findPathWithGradeRelaxation(state, start, null, isTarget, resolved, false);
    }
  } else {
    result = findPathWithGradeRelaxation(state, start, null, isTarget, resolved, false);
  }
  if (!result) {
    return buildEmptyRoadPathResult();
  }
  recordPathStats(result);
  return result;
};

export function findRoadPath(state: WorldState, start: Point, end: Point, options: RoadPathOptions = {}): Point[] {
  return findRoadPathDetailed(state, start, end, options).path;
}

export function findRoadPathToTarget(
  state: WorldState,
  start: Point,
  isTarget: (x: number, y: number) => boolean,
  options: RoadPathOptions = {}
): Point[] {
  return findRoadPathToTargetDetailed(state, start, isTarget, options).path;
}

export function carveRoadToTarget(
  state: WorldState,
  rng: RNG,
  start: Point,
  isTarget: (x: number, y: number) => boolean,
  options: RoadCarveOptions = {}
): Point | null {
  const bridgePolicy =
    options.bridgePolicy ?? (typeof options.allowBridge === "boolean" ? (options.allowBridge ? "allow" : "never") : "allow");
  const result = findRoadPathToTargetDetailed(state, start, isTarget, { ...options, bridgePolicy });
  if (result.path.length === 0) {
    return null;
  }
  const bridgeSet = new Set<number>(result.bridgeTileIndices);
  carveRoadPath(state, rng, result.path, {
    allowBridgeIndices: bridgeSet,
    diagnosticRouteGroup: options.diagnosticRouteGroup,
    diagnosticRouteId: options.diagnosticRouteId,
    diagnosticRouteLabel: options.diagnosticRouteLabel
  });
  return result.path[result.path.length - 1] ?? null;
}

export function carveRoadPath(
  state: WorldState,
  rng: RNG,
  path: Point[],
  options: {
    allowBridgeIndices?: Set<number>;
    allowBridgeByPoint?: (point: Point) => boolean;
    diagnosticRouteGroup?: RoadDiagnosticRouteGroup;
    diagnosticRouteId?: string;
    diagnosticRouteLabel?: string;
  } = {}
): boolean {
  if (path.length === 0) {
    return false;
  }
  const bridgeTileIndices: number[] = [];
  for (let i = 0; i < path.length; i += 1) {
    const point = path[i];
    const idx = indexFor(state.grid, point.x, point.y);
    const allowBridge =
      options.allowBridgeIndices?.has(idx) ?? options.allowBridgeByPoint?.(point) ?? false;
    if (allowBridge) {
      bridgeTileIndices.push(idx);
    }
    setRoadAt(state, rng, point.x, point.y, { allowBridge });
  }
  for (let i = 1; i < path.length; i += 1) {
    const prev = path[i - 1];
    const next = path[i];
    connectRoadPoints(state, prev.x, prev.y, next.x, next.y);
  }
  bumpRoadNetworkRevision(state);
  emitRoadPathDebugEvent({
    kind: "road:carve",
    diagnosticRouteId: options.diagnosticRouteId,
    diagnosticRouteLabel: options.diagnosticRouteLabel,
    routeGroup: options.diagnosticRouteGroup ?? "unknown",
    pathLength: path.length,
    bridgeTileIndices: bridgeTileIndices.length > 0 ? bridgeTileIndices : undefined,
    bounds: getPathBounds(path) ?? undefined
  });
  return true;
}

export function carveRoad(state: WorldState, rng: RNG, start: Point, end: Point, options: RoadCarveOptions = {}): boolean {
  return carveRoadDetailed(state, rng, start, end, options).carved;
}

export async function carveRoadAsync(
  state: WorldState,
  rng: RNG,
  start: Point,
  end: Point,
  options: RoadCarveOptions = {}
): Promise<boolean> {
  roadPathDebugHooks?.checkCancelled?.();
  await yieldToNextFrame();
  roadPathDebugHooks?.checkCancelled?.();
  const bridgePolicy =
    options.bridgePolicy ?? (typeof options.allowBridge === "boolean" ? (options.allowBridge ? "allow" : "never") : "allow");
  const result = await findRoadPathDetailedAsync(state, start, end, { ...options, bridgePolicy });
  if (result.path.length === 0) {
    return false;
  }
  const bridgeSet = new Set<number>(result.bridgeTileIndices);
  return carveRoadPath(state, rng, result.path, {
    allowBridgeIndices: bridgeSet,
    diagnosticRouteGroup: options.diagnosticRouteGroup,
    diagnosticRouteId: options.diagnosticRouteId,
    diagnosticRouteLabel: options.diagnosticRouteLabel
  });
}

export function carveRoadSequence(state: WorldState, rng: RNG, segments: RoadCarveSegment[]): boolean {
  if (segments.length === 0) {
    return false;
  }
  const planned: Array<{
    path: Point[];
    bridgeTileIndices: number[];
    diagnosticRouteGroup?: RoadDiagnosticRouteGroup;
    diagnosticRouteId?: string;
    diagnosticRouteLabel?: string;
  }> = [];
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i]!;
    const options = segment.options ?? {};
    const bridgePolicy =
      options.bridgePolicy ??
      (typeof options.allowBridge === "boolean" ? (options.allowBridge ? "allow" : "never") : "allow");
    const result = findRoadPathDetailed(state, segment.start, segment.end, { ...options, bridgePolicy });
    if (result.path.length === 0) {
      return false;
    }
    planned.push({
      path: result.path,
      bridgeTileIndices: result.bridgeTileIndices,
      diagnosticRouteGroup: options.diagnosticRouteGroup,
      diagnosticRouteId: options.diagnosticRouteId,
      diagnosticRouteLabel: options.diagnosticRouteLabel
    });
  }
  for (let i = 0; i < planned.length; i += 1) {
    const result = planned[i]!;
    carveRoadPath(state, rng, result.path, {
      allowBridgeIndices: new Set<number>(result.bridgeTileIndices),
      diagnosticRouteGroup: result.diagnosticRouteGroup,
      diagnosticRouteId: result.diagnosticRouteId,
      diagnosticRouteLabel: result.diagnosticRouteLabel
    });
  }
  return true;
}

export async function carveRoadSequenceAsync(state: WorldState, rng: RNG, segments: RoadCarveSegment[]): Promise<boolean> {
  if (segments.length === 0) {
    return false;
  }
  const planned: Array<{
    path: Point[];
    bridgeTileIndices: number[];
    diagnosticRouteGroup?: RoadDiagnosticRouteGroup;
    diagnosticRouteId?: string;
    diagnosticRouteLabel?: string;
  }> = [];
  for (let i = 0; i < segments.length; i += 1) {
    roadPathDebugHooks?.checkCancelled?.();
    await yieldToNextFrame();
    roadPathDebugHooks?.checkCancelled?.();
    const segment = segments[i]!;
    const options = segment.options ?? {};
    const bridgePolicy =
      options.bridgePolicy ??
      (typeof options.allowBridge === "boolean" ? (options.allowBridge ? "allow" : "never") : "allow");
    const result = await findRoadPathDetailedAsync(state, segment.start, segment.end, { ...options, bridgePolicy });
    if (result.path.length === 0) {
      return false;
    }
    planned.push({
      path: result.path,
      bridgeTileIndices: result.bridgeTileIndices,
      diagnosticRouteGroup: options.diagnosticRouteGroup,
      diagnosticRouteId: options.diagnosticRouteId,
      diagnosticRouteLabel: options.diagnosticRouteLabel
    });
  }
  for (let i = 0; i < planned.length; i += 1) {
    const result = planned[i]!;
    carveRoadPath(state, rng, result.path, {
      allowBridgeIndices: new Set<number>(result.bridgeTileIndices),
      diagnosticRouteGroup: result.diagnosticRouteGroup,
      diagnosticRouteId: result.diagnosticRouteId,
      diagnosticRouteLabel: result.diagnosticRouteLabel
    });
  }
  return true;
}

export function carveRoadDetailed(
  state: WorldState,
  rng: RNG,
  start: Point,
  end: Point,
  options: RoadCarveOptions = {}
): RoadCarveResult {
  const bridgePolicy =
    options.bridgePolicy ?? (typeof options.allowBridge === "boolean" ? (options.allowBridge ? "allow" : "never") : "allow");
  const result = findRoadPathDetailed(state, start, end, { ...options, bridgePolicy });
  if (result.path.length === 0) {
    return {
      carved: false,
      bounds: null,
      pathLength: 0,
      path: [],
      bridgeTileIndices: []
    };
  }
  const bridgeSet = new Set<number>(result.bridgeTileIndices);
  const carved = carveRoadPath(state, rng, result.path, {
    allowBridgeIndices: bridgeSet,
    diagnosticRouteGroup: options.diagnosticRouteGroup,
    diagnosticRouteId: options.diagnosticRouteId,
    diagnosticRouteLabel: options.diagnosticRouteLabel
  });
  return {
    carved,
    bounds: carved ? getPathBounds(result.path) : null,
    pathLength: carved ? result.path.length : 0,
    path: carved ? result.path.map((point) => ({ ...point })) : [],
    bridgeTileIndices: carved ? [...result.bridgeTileIndices] : []
  };
}

export async function carveRoadDetailedAsync(
  state: WorldState,
  rng: RNG,
  start: Point,
  end: Point,
  options: RoadCarveOptions = {}
): Promise<RoadCarveResult> {
  roadPathDebugHooks?.checkCancelled?.();
  await yieldToNextFrame();
  roadPathDebugHooks?.checkCancelled?.();
  const bridgePolicy =
    options.bridgePolicy ?? (typeof options.allowBridge === "boolean" ? (options.allowBridge ? "allow" : "never") : "allow");
  const result = await findRoadPathDetailedAsync(state, start, end, { ...options, bridgePolicy });
  if (result.path.length === 0) {
    return {
      carved: false,
      bounds: null,
      pathLength: 0,
      path: [],
      bridgeTileIndices: []
    };
  }
  const bridgeSet = new Set<number>(result.bridgeTileIndices);
  const carved = carveRoadPath(state, rng, result.path, {
    allowBridgeIndices: bridgeSet,
    diagnosticRouteGroup: options.diagnosticRouteGroup,
    diagnosticRouteId: options.diagnosticRouteId,
    diagnosticRouteLabel: options.diagnosticRouteLabel
  });
  return {
    carved,
    bounds: carved ? getPathBounds(result.path) : null,
    pathLength: carved ? result.path.length : 0,
    path: carved ? result.path.map((point) => ({ ...point })) : [],
    bridgeTileIndices: carved ? [...result.bridgeTileIndices] : []
  };
}

export function collectRoadTiles(state: WorldState): Point[] {
  const roads: Point[] = [];
  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      if (isRoadLikeTile(state, x, y)) {
        roads.push({ x, y });
      }
    }
  }
  return roads;
}

export function findNearestRoadTile(state: WorldState, origin: Point): Point {
  let best: Point | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      if (!isRoadLikeTile(state, x, y)) {
        continue;
      }
      const idx = indexFor(state.grid, x, y);
      if (state.structureMask[idx] > 0 || state.tiles[idx]?.type === "house") {
        continue;
      }
      const dist = Math.abs(origin.x - x) + Math.abs(origin.y - y);
      if (dist < bestDist) {
        bestDist = dist;
        best = { x, y };
      }
    }
  }
  if (best) {
    return best;
  }

  let fallback = state.basePoint;
  bestDist = Number.POSITIVE_INFINITY;
  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = indexFor(state.grid, x, y);
      const tile = state.tiles[idx];
      if (!tile || tile.type === "water" || state.structureMask[idx] > 0) {
        continue;
      }
      const dist = Math.abs(origin.x - x) + Math.abs(origin.y - y);
      if (dist < bestDist) {
        bestDist = dist;
        fallback = { x, y };
      }
    }
  }
  return fallback;
}

export const analyzeRoadSurfaceMetrics = (state: WorldState, heightScaleMultiplier = 1): RoadSurfaceMetrics => {
  const total = state.grid.totalTiles;
  const cols = state.grid.cols;
  const elevationToGradeScale = getRoadGradeScale(state, heightScaleMultiplier);
  let maxRoadGrade = 0;
  let maxRoadCrossfall = 0;
  let maxRoadGradeChange = 0;
  let maxRoadAngleDeg = 0;
  let roadAngleSum = 0;
  let roadAngleCount = 0;
  let highAngleRoadStepCount = 0;
  let wallEdgeCount = 0;
  let longStraightSteepSegmentCount = 0;

  for (let idx = 0; idx < total; idx += 1) {
    const wallMask = state.tileRoadWallEdges[idx] ?? 0;
    if (wallMask !== 0) {
      for (let bit = wallMask; bit !== 0; bit &= bit - 1) {
        wallEdgeCount += 1;
      }
    }
    if (!isRoadLikeIndex(state, idx) || state.tiles[idx]?.type === "water") {
      continue;
    }
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    const mask = getRoadEdgeMaskAtIndex(state, idx);
    const connectedSignedGrades: number[] = [];
    const steepAxis = {
      ew: 0,
      ns: 0,
      neSw: 0,
      nwSe: 0
    };
    for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
      const dir = ROAD_EDGE_DIRS[i];
      if ((mask & dir.bit) === 0) {
        continue;
      }
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const neighborIdx = indexFor(state.grid, nx, ny);
      if (!isRoadLikeIndex(state, neighborIdx) || state.tiles[neighborIdx]?.type === "water") {
        continue;
      }
      const signedGrade = computeStepSignedGrade(
        state.tiles[idx].elevation,
        state.tiles[neighborIdx].elevation,
        Math.hypot(dir.dx, dir.dy),
        elevationToGradeScale
      );
      connectedSignedGrades.push(signedGrade);
      if (neighborIdx > idx) {
        const angleDeg = computeRoadStepAngleDeg(
          state,
          state.tiles[idx].elevation,
          state.tiles[neighborIdx].elevation,
          Math.hypot(dir.dx, dir.dy),
          heightScaleMultiplier
        );
        maxRoadAngleDeg = Math.max(maxRoadAngleDeg, angleDeg);
        roadAngleSum += angleDeg;
        roadAngleCount += 1;
        if (angleDeg > ROAD_AVOID_ANGLE_DEG) {
          highAngleRoadStepCount += 1;
        }
        if (angleDeg > ROAD_SOFT_ANGLE_DEG) {
          if (dir.dx !== 0 && dir.dy === 0) {
            steepAxis.ew += 1;
          } else if (dir.dx === 0 && dir.dy !== 0) {
            steepAxis.ns += 1;
          } else if (dir.dx === dir.dy) {
            steepAxis.nwSe += 1;
          } else {
            steepAxis.neSw += 1;
          }
        }
        maxRoadGrade = Math.max(maxRoadGrade, Math.abs(signedGrade));
        maxRoadCrossfall = Math.max(
          maxRoadCrossfall,
          computeCrossfallAtStep(
            state,
            x,
            y,
            nx,
            ny,
            state.tiles[idx].elevation,
            state.tiles[neighborIdx].elevation,
            elevationToGradeScale
          )
        );
      }
    }
    if (connectedSignedGrades.length >= 2) {
      for (let i = 0; i < connectedSignedGrades.length; i += 1) {
        for (let j = i + 1; j < connectedSignedGrades.length; j += 1) {
          maxRoadGradeChange = Math.max(
            maxRoadGradeChange,
            Math.abs(connectedSignedGrades[i] - connectedSignedGrades[j])
          );
        }
      }
    }
    if (steepAxis.ew >= 2 || steepAxis.ns >= 2 || steepAxis.neSw >= 2 || steepAxis.nwSe >= 2) {
      longStraightSteepSegmentCount += 1;
    }
  }

  return {
    maxRoadGrade,
    maxRoadCrossfall,
    maxRoadGradeChange,
    maxRoadAngleDeg,
    meanRoadAngleDeg: roadAngleCount > 0 ? roadAngleSum / roadAngleCount : 0,
    highAngleRoadStepCount,
    wallEdgeCount,
    maxRoadGradingDelta: 0,
    longStraightSteepSegmentCount
  };
};

export const resetRoadGenerationStats = (): void => {
  roadGenerationStats.pathsAttempted = 0;
  roadGenerationStats.pathsFound = 0;
  roadGenerationStats.maxRealizedGrade = 0;
  roadGenerationStats.maxRealizedCrossfall = 0;
  roadGenerationStats.maxRealizedGradeChange = 0;
  roadGenerationStats.maxRealizedAngleDeg = 0;
  roadGenerationStats.meanRealizedAngleDeg = 0;
  roadGenerationStats.highAngleStepCount = 0;
  roadGenerationStats.minRiverClearance = Number.POSITIVE_INFINITY;
  roadGenerationStats.bridgeSegments = 0;
  roadGenerationStats.mountainPassFallbackCount = 0;
  roadGenerationStats.switchbackTurnCount = 0;
  roadGenerationStats.switchbackRouteAttempts = 0;
  roadGenerationStats.switchbackRouteCount = 0;
  roadGenerationStats.hairpinGradeDiscountCount = 0;
  roadGenerationStats.connectorArtifactPrunedEdgeCount = 0;
  roadGenerationStats.longStraightSteepSegmentCount = 0;
  roadGenerationStats.generatedJunctionCount = 0;
  roadGenerationStats.searchBudgetAbortCount = 0;
  roadGenerationStats.connectorCacheSkipCount = 0;
  roadDiagnosticRouteStats.clear();
};

export const getRoadGenerationStats = (): RoadGenerationStats => ({
  pathsAttempted: roadGenerationStats.pathsAttempted,
  pathsFound: roadGenerationStats.pathsFound,
  maxRealizedGrade: roadGenerationStats.maxRealizedGrade,
  maxRealizedCrossfall: roadGenerationStats.maxRealizedCrossfall,
  maxRealizedGradeChange: roadGenerationStats.maxRealizedGradeChange,
  maxRealizedAngleDeg: roadGenerationStats.maxRealizedAngleDeg,
  meanRealizedAngleDeg: roadGenerationStats.meanRealizedAngleDeg,
  highAngleStepCount: roadGenerationStats.highAngleStepCount,
  minRiverClearance: roadGenerationStats.minRiverClearance,
  bridgeSegments: roadGenerationStats.bridgeSegments,
  mountainPassFallbackCount: roadGenerationStats.mountainPassFallbackCount,
  switchbackTurnCount: roadGenerationStats.switchbackTurnCount,
  switchbackRouteAttempts: roadGenerationStats.switchbackRouteAttempts,
  switchbackRouteCount: roadGenerationStats.switchbackRouteCount,
  hairpinGradeDiscountCount: roadGenerationStats.hairpinGradeDiscountCount,
  connectorArtifactPrunedEdgeCount: roadGenerationStats.connectorArtifactPrunedEdgeCount,
  longStraightSteepSegmentCount: roadGenerationStats.longStraightSteepSegmentCount,
  generatedJunctionCount: roadGenerationStats.generatedJunctionCount,
  searchBudgetAbortCount: roadGenerationStats.searchBudgetAbortCount,
  connectorCacheSkipCount: roadGenerationStats.connectorCacheSkipCount
});

export const recordGeneratedRoadJunctions = (count: number): void => {
  roadGenerationStats.generatedJunctionCount += Math.max(0, Math.floor(count));
};

export const recordRoadConnectorCacheSkip = (count = 1): void => {
  roadGenerationStats.connectorCacheSkipCount += Math.max(0, Math.floor(count));
};
