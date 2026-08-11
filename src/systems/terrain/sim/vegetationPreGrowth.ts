import type { RNG } from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";
import { processVegetationSuccessionYears, type VegetationBlockResult } from "./vegetationSuccession.js";

export type VegetationPreGrowthResult = VegetationBlockResult & {
  yearsApplied: number;
};

export type VegetationPreGrowthProgress = {
  completedYears: number;
  totalYears: number;
  tilesVisited: number;
  tilesChanged: number;
};

export type VegetationPreGrowthReporter = (
  progress: VegetationPreGrowthProgress
) => void | Promise<void>;

const clampPreGrowthYears = (years: number): number =>
  Math.max(0, Math.min(40, Math.round(Number.isFinite(years) ? years : 0)));

export const applyVegetationPreGrowth = async (
  state: WorldState,
  years: number,
  rng: RNG,
  reportProgress?: VegetationPreGrowthReporter
): Promise<VegetationPreGrowthResult> => {
  const yearsApplied = clampPreGrowthYears(years);
  const result: VegetationPreGrowthResult = {
    yearsApplied,
    terrainTypeChanged: false,
    vegetationChanged: false,
    visualChanged: false,
    tilesVisited: 0,
    tilesChanged: 0
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
    const annual = processVegetationSuccessionYears(state, bounds, 1, rng, year);
    result.terrainTypeChanged ||= annual.terrainTypeChanged;
    result.vegetationChanged ||= annual.vegetationChanged;
    result.visualChanged ||= annual.visualChanged;
    result.tilesVisited += annual.tilesVisited;
    result.tilesChanged += annual.tilesChanged;
    await reportProgress?.({
      completedYears: year + 1,
      totalYears: yearsApplied,
      tilesVisited: result.tilesVisited,
      tilesChanged: result.tilesChanged
    });
  }
  return result;
};
