import type { RNG } from "../core/types.js";
import type { WorldState } from "../core/state.js";
import {
  backfillRoadEdgesFromAdjacency,
  carveRoad,
  carveRoadAsync,
  carveRoadDetailed,
  carveRoadDetailedAsync,
  carveRoadPath,
  carveRoadSequence,
  carveRoadSequenceAsync,
  clearRoadEdges,
  collectConnectedRoadNeighbors,
  collectRoadTiles,
  findNearestRoadTile,
  pruneRoadDiagonalStubs,
  recordRoadConnectorCacheSkip,
  recordGeneratedRoadJunctions
} from "./roads.js";
import {
  createSettlementPlacementPlan as createSharedSettlementPlacementPlan,
  executeSettlementPlacementPlan,
  executeSettlementPlacementPlanAsync as executeSharedSettlementPlacementPlanAsync,
  populateCommunities as populateSharedCommunities,
  repairSettlementRoadConnectivity as repairSharedSettlementRoadConnectivity,
  repairSettlementRoadConnectivityAsync as repairSharedSettlementRoadConnectivityAsync
} from "../systems/settlements/controllers/settlementGeneration.js";
import type { SettlementPlacementResult, SettlementRoadAdapter } from "../systems/settlements/types/settlementTypes.js";

const createRoadAdapter = (rng: RNG): SettlementRoadAdapter => ({
  carveRoad: (state, start, end, options = {}) => carveRoad(state, rng, start, end, options),
  carveRoadAsync: (state, start, end, options = {}) => carveRoadAsync(state, rng, start, end, options),
  carveRoadDetailed: (state, start, end, options = {}) => carveRoadDetailed(state, rng, start, end, options),
  carveRoadDetailedAsync: (state, start, end, options = {}) => carveRoadDetailedAsync(state, rng, start, end, options),
  carveRoadPath: (state, path, bridgeTileIndices = []) =>
    carveRoadPath(state, rng, path, { allowBridgeIndices: new Set(bridgeTileIndices) }),
  carveRoadSequence: (state, segments) => carveRoadSequence(state, rng, segments),
  carveRoadSequenceAsync: (state, segments) => carveRoadSequenceAsync(state, rng, segments),
  collectConnectedRoadNeighbors,
  collectRoadTiles,
  findNearestRoadTile,
  clearRoadEdges,
  backfillRoadEdgesFromAdjacency,
  pruneRoadDiagonalStubs,
  recordGeneratedJunctions: recordGeneratedRoadJunctions,
  recordConnectorCacheSkip: recordRoadConnectorCacheSkip
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
  plan.roadMaxGrade = realized.roadMaxGrade;
  plan.settlementPreGrowthYears = realized.settlementPreGrowthYears;
}

export async function connectSettlementsByRoadAsync(
  state: WorldState,
  rng: RNG,
  plan: SettlementPlacementResult | null
): Promise<void> {
  const realized = await executeSharedSettlementPlacementPlanAsync(state, createRoadAdapter(rng), plan);
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
  plan.roadMaxGrade = realized.roadMaxGrade;
  plan.settlementPreGrowthYears = realized.settlementPreGrowthYears;
}

export function repairSettlementRoadConnectivity(
  state: WorldState,
  rng: RNG,
  plan: SettlementPlacementResult | null
): boolean {
  return repairSharedSettlementRoadConnectivity(state, createRoadAdapter(rng), plan);
}

export function repairSettlementRoadConnectivityAsync(
  state: WorldState,
  rng: RNG,
  plan: SettlementPlacementResult | null
): Promise<boolean> {
  return repairSharedSettlementRoadConnectivityAsync(state, createRoadAdapter(rng), plan);
}

export function populateCommunities(state: WorldState, rng: RNG): void {
  populateSharedCommunities(state, createRoadAdapter(rng));
}
