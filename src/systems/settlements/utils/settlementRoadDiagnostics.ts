import type { Point, Town } from "../../../core/types.js";
import type { RoadDiagnosticRouteGroup } from "../../roads/types/roadDiagnosticTuning.js";
import type {
  RoadPathDebugEvent,
  RoadPathDiagnosticFailureReason,
  RoadPathDiagnosticRouteReason,
  RoadPathDiagnosticRouteType,
  RoadPathDiagnosticTownRef
} from "../../roads/types/roadPathDebugTypes.js";
import type {
  SettlementRoadAdapter,
  SettlementRoadDiagnosticRouteStats,
  SettlementRoadOptions
} from "../types/settlementTypes.js";

const emptyRouteStats = (): SettlementRoadDiagnosticRouteStats => ({
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

export const getRoadDiagnosticNowMs = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

export const createDiagnosticTownRef = (town: Town): RoadPathDiagnosticTownRef => ({
  id: town.id,
  name: town.name,
  x: town.x,
  y: town.y
});

export const buildIntertownDiagnosticRouteId = (pass: number, left: Town, right: Town): string => {
  const a = Math.min(left.id, right.id);
  const b = Math.max(left.id, right.id);
  return `intertown:${pass}:${a}-${b}`;
};

export const buildIntertownDiagnosticRouteLabel = (left: Town, right: Town): string =>
  `${left.name} -> ${right.name}`;

export const buildIntratownHouseDiagnosticId = (
  townId: number,
  anchorIndex: number,
  sequence?: number
): string =>
  typeof sequence === "number" && Number.isFinite(sequence)
    ? `town:${townId}:house:${anchorIndex}:seq:${Math.max(0, Math.trunc(sequence))}`
    : `town:${townId}:house:${anchorIndex}`;

export const buildIntratownDiagnosticRouteId = (
  townId: number,
  anchorIndex: number,
  reason: RoadPathDiagnosticRouteReason,
  sequence?: number
): string => `${reason}:${buildIntratownHouseDiagnosticId(townId, anchorIndex, sequence)}`;

export const buildIntratownDiagnosticRouteLabel = (town: Town, anchorIndex: number): string =>
  `${town.name} house ${anchorIndex}`;

export const estimateRoadSearchBudget = (options?: SettlementRoadOptions): number =>
  Math.max(0, Math.floor(options?.maxSearchNodeVisits ?? 0));

export const withDiagnosticRoute = (
  options: SettlementRoadOptions,
  diagnosticRouteId: string,
  diagnosticRouteLabel: string,
  diagnosticRouteType: RoadPathDiagnosticRouteType,
  diagnosticRouteReason: RoadPathDiagnosticRouteReason
): SettlementRoadOptions => ({
  ...options,
  diagnosticRouteId,
  diagnosticRouteLabel,
  diagnosticRouteType,
  diagnosticRouteReason
});

export const getDiagnosticRouteStats = (
  roadAdapter: SettlementRoadAdapter,
  diagnosticRouteId: string
): SettlementRoadDiagnosticRouteStats =>
  roadAdapter.getDiagnosticRouteStats?.(diagnosticRouteId) ?? emptyRouteStats();

export const emitSettlementRoadDiagnostic = (
  roadAdapter: SettlementRoadAdapter,
  event: RoadPathDebugEvent
): void => {
  roadAdapter.emitDiagnosticEvent?.(event);
};

export const emitPlannedRoadDiagnostic = (
  roadAdapter: SettlementRoadAdapter,
  input: {
    diagnosticRouteId: string;
    diagnosticRouteLabel: string;
    routeType: RoadPathDiagnosticRouteType;
    routeGroup: RoadDiagnosticRouteGroup;
    reason: RoadPathDiagnosticRouteReason;
    townA?: RoadPathDiagnosticTownRef;
    townB?: RoadPathDiagnosticTownRef;
    town?: RoadPathDiagnosticTownRef;
    houseId?: string;
    start?: Point;
    end?: Point;
    searchBudget: number;
  }
): void => {
  emitSettlementRoadDiagnostic(roadAdapter, {
    kind: "road:planned",
    ...input
  });
};

export const emitCompletedRoadDiagnostic = (
  roadAdapter: SettlementRoadAdapter,
  input: {
    diagnosticRouteId: string;
    diagnosticRouteLabel: string;
    routeType: RoadPathDiagnosticRouteType;
    routeGroup: RoadDiagnosticRouteGroup;
    reason: RoadPathDiagnosticRouteReason;
    townA?: RoadPathDiagnosticTownRef;
    townB?: RoadPathDiagnosticTownRef;
    town?: RoadPathDiagnosticTownRef;
    houseId?: string;
    startedAtMs: number;
    searchBudget: number;
    pathLength?: number;
  }
): void => {
  const stats = getDiagnosticRouteStats(roadAdapter, input.diagnosticRouteId);
  emitSettlementRoadDiagnostic(roadAdapter, {
    kind: "road:completed",
    diagnosticRouteId: input.diagnosticRouteId,
    diagnosticRouteLabel: input.diagnosticRouteLabel,
    routeType: input.routeType,
    routeGroup: input.routeGroup,
    reason: input.reason,
    townA: input.townA,
    townB: input.townB,
    town: input.town,
    houseId: input.houseId,
    attempts: stats.attempts,
    elapsedMs: Math.max(0, getRoadDiagnosticNowMs() - input.startedAtMs),
    pathLength: input.pathLength ?? stats.lastPathLength,
    searchBudget: input.searchBudget
  });
};

export const emitFailedRoadDiagnostic = (
  roadAdapter: SettlementRoadAdapter,
  input: {
    diagnosticRouteId: string;
    diagnosticRouteLabel: string;
    routeType: RoadPathDiagnosticRouteType;
    routeGroup: RoadDiagnosticRouteGroup;
    reason: RoadPathDiagnosticRouteReason;
    townA?: RoadPathDiagnosticTownRef;
    townB?: RoadPathDiagnosticTownRef;
    town?: RoadPathDiagnosticTownRef;
    houseId?: string;
    startedAtMs: number;
    searchBudget: number;
    failureReason?: RoadPathDiagnosticFailureReason;
  }
): void => {
  const stats = getDiagnosticRouteStats(roadAdapter, input.diagnosticRouteId);
  emitSettlementRoadDiagnostic(roadAdapter, {
    kind: "road:failed",
    diagnosticRouteId: input.diagnosticRouteId,
    diagnosticRouteLabel: input.diagnosticRouteLabel,
    routeType: input.routeType,
    routeGroup: input.routeGroup,
    reason: input.reason,
    townA: input.townA,
    townB: input.townB,
    town: input.town,
    houseId: input.houseId,
    attempts: stats.attempts,
    elapsedMs: Math.max(0, getRoadDiagnosticNowMs() - input.startedAtMs),
    searchBudget: input.searchBudget,
    failureReason: input.failureReason ?? (stats.lastFailureReason as RoadPathDiagnosticFailureReason | null) ?? "unknown"
  });
};

export const emitDuplicateRetryRoadDiagnostic = (
  roadAdapter: SettlementRoadAdapter,
  input: {
    diagnosticRouteId: string;
    diagnosticRouteLabel: string;
    routeType: RoadPathDiagnosticRouteType;
    routeGroup: RoadDiagnosticRouteGroup;
    reason: RoadPathDiagnosticRouteReason;
    start?: Point;
    end?: Point;
    startedAtMs: number;
  }
): void => {
  const stats = getDiagnosticRouteStats(roadAdapter, input.diagnosticRouteId);
  emitSettlementRoadDiagnostic(roadAdapter, {
    kind: "road:duplicate-retry",
    diagnosticRouteId: input.diagnosticRouteId,
    diagnosticRouteLabel: input.diagnosticRouteLabel,
    routeType: input.routeType,
    routeGroup: input.routeGroup,
    reason: input.reason,
    start: input.start,
    end: input.end,
    attempts: stats.attempts,
    elapsedMs: Math.max(0, getRoadDiagnosticNowMs() - input.startedAtMs)
  });
};
