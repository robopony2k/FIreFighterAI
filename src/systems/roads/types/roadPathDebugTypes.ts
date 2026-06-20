import type { Point } from "../../../core/types.js";
import type { SettlementRoadPathMode } from "../../settlements/types/settlementTypes.js";
import type { RoadDiagnosticRouteGroup } from "./roadDiagnosticTuning.js";
import type { RoadPathPlannerFailureReason } from "./roadPathPlannerTypes.js";

export type RoadPathDebugAttemptKind = "point" | "target" | "sequence";
export type RoadPathDebugPlannerKind = "streamer" | "astar" | "dijkstra";
export type RoadPathDiagnosticRouteType = "intertown" | "intratown";
export type RoadPathDiagnosticRouteReason =
  | "minimum-spanning-town-link"
  | "second-pass-connectivity"
  | "fallback-nearest-road"
  | "waypoint-rescue"
  | "guaranteed-town-connectivity"
  | "initial-street-skeleton"
  | "initial-house-access"
  | "future-growth-house-access"
  | "local-connectivity-repair";

export type RoadPathDiagnosticTownRef = {
  id: number;
  name: string;
  x: number;
  y: number;
};

export type RoadPathDiagnosticFailureReason =
  | RoadPathPlannerFailureReason
  | "already-connected"
  | "duplicate-retry"
  | "route-failed"
  | "no-frontage-candidate"
  | "footprint-invalid"
  | "local-road-cap"
  | "compact-town-constraint"
  | "no-path"
  | "path-too-long"
  | "blocked-endpoint"
  | "insufficient-shoreline"
  | "excessive-earthwork"
  | "unknown";

export type RoadPathDebugAttemptEvent = {
  kind: "road:attempt";
  attemptId: number;
  diagnosticRouteId?: string;
  diagnosticRouteLabel?: string;
  attemptKind: RoadPathDebugAttemptKind;
  planner?: RoadPathDebugPlannerKind;
  start: Point;
  end?: Point;
  destinationSeedCount?: number;
  joinRadius?: number;
  mode: SettlementRoadPathMode;
  routeGroup: RoadDiagnosticRouteGroup;
  allowBridge: boolean;
  gradeLimit: number;
  crossfallLimit: number;
  gradeChangeLimit: number;
  maxSearchNodeVisits: number;
};

export type RoadPathDebugProgressEvent = {
  kind: "road:progress";
  attemptId: number;
  visitedNodes: number;
  openNodes: number;
  current?: Point;
  elapsedMs: number;
  planner?: RoadPathDebugPlannerKind;
};

export type RoadPathDebugResultEvent = {
  kind: "road:result";
  attemptId: number;
  diagnosticRouteId?: string;
  diagnosticRouteLabel?: string;
  found: boolean;
  budgetAborted: boolean;
  visitedNodes: number;
  pathLength: number;
  bridgeTileIndices?: number[];
  selectedDestinationSeed?: Point;
  selectedDestinationSeedKind?: string;
  selectedDestinationSeedLabel?: string;
  totalRouteCost?: number;
  failureReason?: RoadPathPlannerFailureReason;
  elapsedMs: number;
  mode: SettlementRoadPathMode;
  routeGroup: RoadDiagnosticRouteGroup;
  allowBridge: boolean;
  planner?: RoadPathDebugPlannerKind;
  joined?: boolean;
};

export type RoadPathDebugCarveEvent = {
  kind: "road:carve";
  diagnosticRouteId?: string;
  diagnosticRouteLabel?: string;
  routeGroup: RoadDiagnosticRouteGroup;
  pathLength: number;
  bridgeTileIndices?: number[];
  bounds?: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
};

export type RoadPathDebugPlannedEvent = {
  kind: "road:planned";
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
};

export type RoadPathDebugDuplicateRetryEvent = {
  kind: "road:duplicate-retry";
  diagnosticRouteId: string;
  diagnosticRouteLabel: string;
  routeType: RoadPathDiagnosticRouteType;
  routeGroup: RoadDiagnosticRouteGroup;
  reason: RoadPathDiagnosticRouteReason;
  start?: Point;
  end?: Point;
  attempts: number;
  elapsedMs: number;
};

export type RoadPathDebugCompletedEvent = {
  kind: "road:completed";
  diagnosticRouteId: string;
  diagnosticRouteLabel: string;
  routeType: RoadPathDiagnosticRouteType;
  routeGroup: RoadDiagnosticRouteGroup;
  reason: RoadPathDiagnosticRouteReason;
  townA?: RoadPathDiagnosticTownRef;
  townB?: RoadPathDiagnosticTownRef;
  town?: RoadPathDiagnosticTownRef;
  houseId?: string;
  attempts: number;
  elapsedMs: number;
  pathLength: number;
  searchBudget: number;
};

export type RoadPathDebugFailedEvent = {
  kind: "road:failed";
  diagnosticRouteId: string;
  diagnosticRouteLabel: string;
  routeType: RoadPathDiagnosticRouteType;
  routeGroup: RoadDiagnosticRouteGroup;
  reason: RoadPathDiagnosticRouteReason;
  townA?: RoadPathDiagnosticTownRef;
  townB?: RoadPathDiagnosticTownRef;
  town?: RoadPathDiagnosticTownRef;
  houseId?: string;
  attempts: number;
  elapsedMs: number;
  searchBudget: number;
  failureReason: RoadPathDiagnosticFailureReason;
};

export type RoadPathDebugIntratownSummaryEvent = {
  kind: "road:intratown-summary";
  diagnosticRouteId: string;
  diagnosticRouteLabel: string;
  routeGroup: RoadDiagnosticRouteGroup;
  town: RoadPathDiagnosticTownRef;
  housesNeedingAccess: number;
  townRoutingBudget: number;
  attempts: number;
  housesConnected: number;
  housesFailed: number;
  elapsedMs: number;
};

export type RoadPathDebugFailedHouseEvent = {
  kind: "road:failed-house";
  diagnosticRouteId: string;
  diagnosticRouteLabel: string;
  routeGroup: RoadDiagnosticRouteGroup;
  town: RoadPathDiagnosticTownRef;
  houseId: string;
  anchorIndex: number;
  failureReason: RoadPathDiagnosticFailureReason;
  attempts: number;
  elapsedMs: number;
};

export type RoadPathDebugEvent =
  | RoadPathDebugAttemptEvent
  | RoadPathDebugProgressEvent
  | RoadPathDebugResultEvent
  | RoadPathDebugCarveEvent
  | RoadPathDebugPlannedEvent
  | RoadPathDebugDuplicateRetryEvent
  | RoadPathDebugCompletedEvent
  | RoadPathDebugFailedEvent
  | RoadPathDebugIntratownSummaryEvent
  | RoadPathDebugFailedHouseEvent;

export type RoadPathDebugHooks = {
  emit?: (event: RoadPathDebugEvent) => void;
  checkCancelled?: () => void;
  yield?: () => Promise<void>;
};
