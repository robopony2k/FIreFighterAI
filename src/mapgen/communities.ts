import type { RNG } from "../core/types.js";
import type { WorldState } from "../core/state.js";
import {
  backfillRoadEdgesFromAdjacency,
  carveRoad,
  clearRoadEdges,
  collectConnectedRoadNeighbors,
  collectRoadTiles,
  findNearestRoadTile,
  pruneRoadDiagonalStubs
} from "./roads.js";
import {
  createSettlementPlacementPlan as createSharedSettlementPlacementPlan,
  executeSettlementPlacementPlan,
  populateCommunities as populateSharedCommunities,
  repairSettlementRoadConnectivity as repairSharedSettlementRoadConnectivity
} from "../systems/settlements/controllers/settlementGeneration.js";
import type { SettlementPlacementResult, SettlementRoadAdapter } from "../systems/settlements/types/settlementTypes.js";

const createRoadAdapter = (rng: RNG): SettlementRoadAdapter => ({
  carveRoad: (state, start, end, options = {}) => carveRoad(state, rng, start, end, options),
  collectConnectedRoadNeighbors,
  collectRoadTiles,
  findNearestRoadTile,
  clearRoadEdges,
  backfillRoadEdgesFromAdjacency,
  pruneRoadDiagonalStubs
});

export type { SettlementPlacementResult } from "../systems/settlements/types/settlementTypes.js";

export const createSettlementPlacementPlan = createSharedSettlementPlan;

function createSharedSettlementPlan(options: Parameters<typeof createSharedSettlementPlacementPlan>[0] = {}): SettlementPlacementResult {
  return createSharedSettlementPlacementPlan(options);
}

export function connectSettlementsByRoad(
  state: WorldState,
  rng: RNG,
  plan: SettlementPlacementResult | null
): void {
  const realized = executeSettlementPlacementPlan(state, createRoadAdapter(rng), plan);
  if (!plan) {
    return;
  }
  plan.generatedRoads = realized.generatedRoads;
  plan.diagonalPenalty = realized.diagonalPenalty;
  plan.pruneRedundantDiagonals = realized.pruneRedundantDiagonals;
  plan.bridgeTransitions = realized.bridgeTransitions;
  plan.heightScaleMultiplier = realized.heightScaleMultiplier;
  plan.townDensity = realized.townDensity;
  plan.bridgeAllowance = realized.bridgeAllowance;
  plan.settlementSpacing = realized.settlementSpacing;
  plan.roadStrictness = realized.roadStrictness;
  plan.settlementPreGrowthYears = realized.settlementPreGrowthYears;
}

export function repairSettlementRoadConnectivity(
  state: WorldState,
  rng: RNG,
  plan: SettlementPlacementResult | null
): boolean {
  return repairSharedSettlementRoadConnectivity(state, createRoadAdapter(rng), plan);
}

export function populateCommunities(state: WorldState, rng: RNG): void {
  populateSharedCommunities(state, createRoadAdapter(rng));
}
