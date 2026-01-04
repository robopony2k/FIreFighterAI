import type { RNG, Point } from "../core/types.js";
import type { WorldState } from "../core/state.js";

export interface PopulationGrowthPlan {
  targetNewHouses: number;
  targetNewRoads: number;
  seedPoints: Point[];
}

export function planPopulationGrowth(_state: WorldState, _rng: RNG): PopulationGrowthPlan {
  return {
    targetNewHouses: 0,
    targetNewRoads: 0,
    seedPoints: []
  };
}

export function applyPopulationGrowth(_state: WorldState, _plan: PopulationGrowthPlan, _rng: RNG): void {
  // Placeholder: future implementation will add houses/roads based on the plan.
}
