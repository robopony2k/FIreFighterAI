import type { RNG } from "../core/types.js";
import type { WorldState } from "../core/state.js";
import type { RoadDiagnosticTuning } from "../systems/roads/types/roadDiagnosticTuning.js";
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
import type { SettlementRoadOptions } from "../systems/settlements/types/settlementTypes.js";

const isRoadModeEnabled = (options: SettlementRoadOptions, tuning: RoadDiagnosticTuning | null): boolean => {
  if (!tuning) {
    return true;
  }
  if (options.pathMode === "switchback" && !tuning.enableSwitchbackConnectors) {
    return false;
  }
  if (options.pathMode === "mountainPass" && !tuning.enableMountainPassFallbacks) {
    return false;
  }
  return true;
};

const applyRoadDiagnosticTuning = (
  options: SettlementRoadOptions = {},
  tuning: RoadDiagnosticTuning | null
): SettlementRoadOptions => {
  if (!tuning) {
    return options;
  }
  const next: SettlementRoadOptions = {
    ...options,
    allowBridgeFirstRetry: tuning.enableBridgeFirstRetries,
    allowMountainPassFallback: (options.allowMountainPassFallback ?? true) && tuning.enableMountainPassFallbacks
  };
  if (tuning.maxGradeRelaxationPasses !== null) {
    next.maxGradeRelaxationPasses = tuning.maxGradeRelaxationPasses;
  }
  if (tuning.intertownDetourMultiplier !== null && next.diagnosticRouteGroup === "intertown") {
    next.maxPathLengthMultiplier = tuning.intertownDetourMultiplier;
  }
  if (Math.abs(tuning.gradeToleranceMultiplier - 1) > 1e-6) {
    const scale = (value: number | undefined): number | undefined =>
      typeof value === "number" && Number.isFinite(value) ? value * tuning.gradeToleranceMultiplier : value;
    next.gradeLimitStart = scale(next.gradeLimitStart);
    next.gradeLimitMax = scale(next.gradeLimitMax);
    next.crossfallLimitStart = scale(next.crossfallLimitStart);
    next.crossfallLimitMax = scale(next.crossfallLimitMax);
    next.gradeChangeLimitStart = scale(next.gradeChangeLimitStart);
    next.gradeChangeLimitMax = scale(next.gradeChangeLimitMax);
  }
  if (typeof next.maxSearchNodeVisits === "number" && Number.isFinite(next.maxSearchNodeVisits)) {
    next.maxSearchNodeVisits = Math.max(1, Math.floor(next.maxSearchNodeVisits * tuning.searchBudgetMultiplier));
  }
  return next;
};

const createRoadAdapter = (rng: RNG, tuning: RoadDiagnosticTuning | null = null): SettlementRoadAdapter => ({
  carveRoad: (state, start, end, options = {}) => {
    const tuned = applyRoadDiagnosticTuning(options, tuning);
    return isRoadModeEnabled(tuned, tuning) && carveRoad(state, rng, start, end, tuned);
  },
  carveRoadAsync: (state, start, end, options = {}) => {
    const tuned = applyRoadDiagnosticTuning(options, tuning);
    return isRoadModeEnabled(tuned, tuning) ? carveRoadAsync(state, rng, start, end, tuned) : Promise.resolve(false);
  },
  carveRoadDetailed: (state, start, end, options = {}) => {
    const tuned = applyRoadDiagnosticTuning(options, tuning);
    return isRoadModeEnabled(tuned, tuning)
      ? carveRoadDetailed(state, rng, start, end, tuned)
      : { carved: false, path: [], bridgeTileIndices: [] };
  },
  carveRoadDetailedAsync: (state, start, end, options = {}) => {
    const tuned = applyRoadDiagnosticTuning(options, tuning);
    return isRoadModeEnabled(tuned, tuning)
      ? carveRoadDetailedAsync(state, rng, start, end, tuned)
      : Promise.resolve({ carved: false, path: [], bridgeTileIndices: [] });
  },
  carveRoadPath: (state, path, bridgeTileIndices = []) =>
    carveRoadPath(state, rng, path, { allowBridgeIndices: new Set(bridgeTileIndices) }),
  carveRoadSequence: (state, segments) => {
    const tunedSegments = segments.map((segment) => ({
      ...segment,
      options: applyRoadDiagnosticTuning(segment.options ?? {}, tuning)
    }));
    return tunedSegments.every((segment) => isRoadModeEnabled(segment.options ?? {}, tuning)) &&
      carveRoadSequence(state, rng, tunedSegments);
  },
  carveRoadSequenceAsync: (state, segments) => {
    const tunedSegments = segments.map((segment) => ({
      ...segment,
      options: applyRoadDiagnosticTuning(segment.options ?? {}, tuning)
    }));
    return tunedSegments.every((segment) => isRoadModeEnabled(segment.options ?? {}, tuning))
      ? carveRoadSequenceAsync(state, rng, tunedSegments)
      : Promise.resolve(false);
  },
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
  plan: SettlementPlacementResult | null,
  roadTuning: RoadDiagnosticTuning | null = null
): void {
  if (plan && roadTuning) {
    plan.roadDiagnosticTuning = roadTuning;
  }
  const realized = executeSettlementPlacementPlan(state, createRoadAdapter(rng, roadTuning), plan);
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
  plan.futureGrowthPlanYears = realized.futureGrowthPlanYears;
}

export async function connectSettlementsByRoadAsync(
  state: WorldState,
  rng: RNG,
  plan: SettlementPlacementResult | null,
  roadTuning: RoadDiagnosticTuning | null = null
): Promise<void> {
  if (plan && roadTuning) {
    plan.roadDiagnosticTuning = roadTuning;
  }
  const realized = await executeSharedSettlementPlacementPlanAsync(state, createRoadAdapter(rng, roadTuning), plan);
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
  plan.futureGrowthPlanYears = realized.futureGrowthPlanYears;
}

export function repairSettlementRoadConnectivity(
  state: WorldState,
  rng: RNG,
  plan: SettlementPlacementResult | null,
  roadTuning: RoadDiagnosticTuning | null = null
): boolean {
  if (plan && roadTuning) {
    plan.roadDiagnosticTuning = roadTuning;
  }
  return repairSharedSettlementRoadConnectivity(state, createRoadAdapter(rng, roadTuning), plan);
}

export function repairSettlementRoadConnectivityAsync(
  state: WorldState,
  rng: RNG,
  plan: SettlementPlacementResult | null,
  roadTuning: RoadDiagnosticTuning | null = null
): Promise<boolean> {
  if (plan && roadTuning) {
    plan.roadDiagnosticTuning = roadTuning;
  }
  return repairSharedSettlementRoadConnectivityAsync(state, createRoadAdapter(rng, roadTuning), plan);
}

export function populateCommunities(state: WorldState, rng: RNG): void {
  populateSharedCommunities(state, createRoadAdapter(rng));
}
