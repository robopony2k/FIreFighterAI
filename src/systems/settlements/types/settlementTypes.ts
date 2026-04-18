import type { Point } from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";

export type SettlementRoadBridgePolicy = "allow" | "never";

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
};

export type SettlementRoadAdapter = {
  carveRoad: (state: WorldState, start: Point, end: Point, options?: SettlementRoadOptions) => boolean;
  collectRoadTiles: (state: WorldState) => Point[];
  findNearestRoadTile: (state: WorldState, origin: Point) => Point;
  clearRoadEdges: (state: WorldState) => void;
  backfillRoadEdgesFromAdjacency: (state: WorldState) => void;
  pruneRoadDiagonalStubs: (state: WorldState) => void;
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
