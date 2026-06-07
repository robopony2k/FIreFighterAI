import type { Point } from "../../../core/types.js";
import type { SettlementRoadPathMode } from "../../settlements/types/settlementTypes.js";
import type { RoadPathPlannerFailureReason } from "./roadPathPlannerTypes.js";

export type RoadPathDebugAttemptKind = "point" | "target" | "sequence";
export type RoadPathDebugPlannerKind = "streamer" | "astar" | "dijkstra";

export type RoadPathDebugAttemptEvent = {
  kind: "road:attempt";
  attemptId: number;
  attemptKind: RoadPathDebugAttemptKind;
  planner?: RoadPathDebugPlannerKind;
  start: Point;
  end?: Point;
  destinationSeedCount?: number;
  joinRadius?: number;
  mode: SettlementRoadPathMode;
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
  found: boolean;
  budgetAborted: boolean;
  visitedNodes: number;
  pathLength: number;
  bridgeTileIndices?: number[];
  path?: Point[];
  selectedDestinationSeed?: Point;
  selectedDestinationSeedKind?: string;
  selectedDestinationSeedLabel?: string;
  totalRouteCost?: number;
  failureReason?: RoadPathPlannerFailureReason;
  elapsedMs: number;
  mode: SettlementRoadPathMode;
  allowBridge: boolean;
  planner?: RoadPathDebugPlannerKind;
  joined?: boolean;
};

export type RoadPathDebugCarveEvent = {
  kind: "road:carve";
  pathLength: number;
  bridgeTileIndices?: number[];
  bounds?: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
};

export type RoadPathDebugEvent =
  | RoadPathDebugAttemptEvent
  | RoadPathDebugProgressEvent
  | RoadPathDebugResultEvent
  | RoadPathDebugCarveEvent;

export type RoadPathDebugHooks = {
  emit?: (event: RoadPathDebugEvent) => void;
  checkCancelled?: () => void;
  yield?: () => Promise<void>;
};
