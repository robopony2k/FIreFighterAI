import type { Point } from "../../../core/types.js";

export type RoadPathPlannerFront = "origin" | "destination";

export type RoadPathPlannerDirection = {
  x: number;
  y: number;
  cost: number;
};

export type RoadDestinationSeedKind = "point" | "network" | "settlementAccess" | "bridgehead" | "pass" | "valley";

export type RoadDestinationSeed = {
  index: number;
  point: Point;
  priority?: number;
  kind?: RoadDestinationSeedKind;
  label?: string;
};

export type RoadStreamerDestinationSeed = RoadDestinationSeed;

export type RoadPathPlannerFailureReason =
  | "invalid-start"
  | "invalid-destination"
  | "no-destination-seeds"
  | "no-route"
  | "budget-aborted"
  | "cancelled";

export type RoadPathPlannerNodeState = {
  waterTilesUsed: number;
  consecutiveWater: number;
  stepDx: number;
  stepDy: number;
  signedGrade: number;
  crossfall: number;
  steepRun: number;
  stepsSinceTurn: number;
  turnDirection: number;
  stepsSinceTurnDirectionChange: number;
  lateralLegLength: number;
  stepsSinceHairpinDiscount: number;
  hairpinSteepStepRun: number;
  cumulativeClimb: number;
  cumulativeDescent: number;
  switchbackTurns: number;
  hairpinGradeDiscounts: number;
  longStraightSteepSegments: number;
};

export type RoadPathPlannerStepResult = {
  cost: number;
  state: RoadPathPlannerNodeState;
};

export type RoadPathPlannerJoinResult = {
  pathIndices: number[];
  cost: number;
};

export type RoadPathPlannerProgress = {
  visitedNodes: number;
  openNodes: number;
  currentIndex: number;
};

export type RoadPathPlannerInput = {
  cols: number;
  rows: number;
  totalTiles: number;
  startIndex: number;
  destinationSeeds: RoadStreamerDestinationSeed[];
  directions: RoadPathPlannerDirection[];
  joinRadius: number;
  maxSearchNodeVisits?: number;
  initialState?: RoadPathPlannerNodeState;
  evaluateStep: (
    front: RoadPathPlannerFront,
    currentIndex: number,
    nextIndex: number,
    direction: RoadPathPlannerDirection,
    currentState: RoadPathPlannerNodeState
  ) => RoadPathPlannerStepResult | null;
  validateJoin: (
    originIndex: number,
    destinationIndex: number,
    originState: RoadPathPlannerNodeState,
    destinationState: RoadPathPlannerNodeState
  ) => RoadPathPlannerJoinResult | null;
  onProgress?: (progress: RoadPathPlannerProgress) => void;
  shouldYield?: (progress: RoadPathPlannerProgress) => boolean;
  yield?: () => Promise<void>;
  checkCancelled?: () => void;
};

export type RoadPathPlannerResult = {
  pathIndices: number[];
  bridgeTileIndices: number[];
  found: boolean;
  budgetAborted: boolean;
  totalCost: number;
  selectedDestinationSeed: RoadDestinationSeed | null;
  failureReason: RoadPathPlannerFailureReason | null;
  visitedNodes: number;
  originVisitedNodes: number;
  destinationVisitedNodes: number;
  joinedOriginIndex: number;
  joinedDestinationIndex: number;
  destinationSeedIndex: number;
};
