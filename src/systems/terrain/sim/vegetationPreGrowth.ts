import type { RNG } from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";
import { processVegetationSuccessionBlock, type VegetationBlockResult } from "./vegetationSuccession.js";

export type VegetationPreGrowthResult = VegetationBlockResult & {
  yearsApplied: number;
};

const clampPreGrowthYears = (years: number): number =>
  Math.max(0, Math.min(40, Math.round(Number.isFinite(years) ? years : 0)));

export const applyVegetationPreGrowth = (
  state: WorldState,
  years: number,
  rng: RNG
): VegetationPreGrowthResult => {
  const yearsApplied = clampPreGrowthYears(years);
  const result: VegetationPreGrowthResult = {
    yearsApplied,
    terrainTypeChanged: false,
    vegetationChanged: false,
    visualChanged: false
  };
  if (yearsApplied === 0 || state.grid.totalTiles === 0) {
    return result;
  }

  const bounds = {
    minX: 0,
    maxX: state.grid.cols - 1,
    minY: 0,
    maxY: state.grid.rows - 1
  };
  for (let year = 0; year < yearsApplied; year += 1) {
    const annual = processVegetationSuccessionBlock(state, bounds, 1, rng);
    result.terrainTypeChanged ||= annual.terrainTypeChanged;
    result.vegetationChanged ||= annual.vegetationChanged;
    result.visualChanged ||= annual.visualChanged;
  }
  return result;
};
