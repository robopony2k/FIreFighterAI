import type { RNG } from "../core/types.js";
import type { WorldState } from "../core/state.js";
import { DEBUG_GROWTH_METRICS } from "../core/config.js";
import { stepRuntimeTownGrowth } from "../systems/settlements/sim/townGrowth.js";
import { processVegetationSuccessionBlock } from "../systems/terrain/sim/vegetationSuccession.js";
import { profEnd, profStart } from "./prof.js";

const GROWTH_BLOCK_CATCHUP_MAX_DAYS = 180;
const VEGETATION_VISUAL_FLUSH_DAYS = 30;

let lastLoggedYear = 0;

const ensureGrowthBlockTiming = (state: WorldState, fallbackLastCareerDay: number): void => {
  if (!state.growthBlockLastCareerDay || state.growthBlockLastCareerDay.length !== state.fireBlockCount) {
    state.growthBlockLastCareerDay = new Float32Array(state.fireBlockCount).fill(fallbackLastCareerDay);
    state.growthBlockCursor = 0;
  }
  if (!Number.isFinite(state.growthVisualDayAccumulator)) {
    state.growthVisualDayAccumulator = 0;
  }
};

const getGrowthBlockElapsedDays = (state: WorldState, blockIndex: number, dayDelta: number): number => {
  const currentCareerDay = Number.isFinite(state.careerDay) ? Math.max(0, state.careerDay) : 0;
  const lastCareerDay = state.growthBlockLastCareerDay[blockIndex] ?? 0;
  if (currentCareerDay > lastCareerDay + 1e-6) {
    return Math.min(GROWTH_BLOCK_CATCHUP_MAX_DAYS, currentCareerDay - lastCareerDay);
  }
  return Math.max(0, dayDelta);
};

const markGrowthBlockProcessed = (state: WorldState, blockIndex: number, elapsedDays: number): void => {
  const currentCareerDay = Number.isFinite(state.careerDay) ? Math.max(0, state.careerDay) : 0;
  const lastCareerDay = state.growthBlockLastCareerDay[blockIndex] ?? 0;
  if (currentCareerDay > lastCareerDay + 1e-6) {
    state.growthBlockLastCareerDay[blockIndex] = Math.min(currentCareerDay, lastCareerDay + elapsedDays);
    return;
  }
  state.growthBlockLastCareerDay[blockIndex] = lastCareerDay + elapsedDays;
};

function logGrowthMetrics(state: WorldState): void {
  let ashCount = 0;
  let grassCount = 0;
  let forestCount = 0;
  const bandCounts = [0, 0, 0, 0, 0];
  const bandCanopy = [0, 0, 0, 0, 0];

  for (const tile of state.tiles) {
    if (tile.type === "ash") {
      ashCount += 1;
    }
    if (tile.type === "grass" || tile.type === "scrub" || tile.type === "floodplain") {
      grassCount += 1;
    }
    if (tile.type === "forest" || tile.canopy >= 0.35) {
      forestCount += 1;
    }
    if (tile.type !== "water") {
      const band = Math.min(Math.floor(tile.waterDist / 5), 4);
      bandCounts[band] += 1;
      bandCanopy[band] += tile.canopy;
    }
  }

  const bandAverages = bandCounts.map((count, index) => (count > 0 ? (bandCanopy[index] / count).toFixed(2) : "0.00"));
  console.log(
    `Year ${state.year} growth: ash ${ashCount} grass ${grassCount} forest ${forestCount} canopyByWaterDist [0-4:${bandAverages[0]} 5-9:${bandAverages[1]} 10-14:${bandAverages[2]} 15-19:${bandAverages[3]} 20+:${bandAverages[4]}]`
  );
}

export function stepTownSeasonScaling(state: WorldState): void {
  stepRuntimeTownGrowth(state);
}

export function stepGrowth(state: WorldState, dayDelta: number, rng: RNG): void {
  const profStartAt = profStart();
  if (dayDelta <= 0) {
    profEnd("growth", profStartAt);
    return;
  }

  if (DEBUG_GROWTH_METRICS && state.year !== lastLoggedYear) {
    logGrowthMetrics(state);
    lastLoggedYear = state.year;
  }

  ensureGrowthBlockTiming(state, Math.max(0, (state.careerDay ?? 0) - dayDelta));
  state.growthVisualDayAccumulator = Math.max(0, state.growthVisualDayAccumulator + dayDelta);

  let terrainTypeChanged = false;
  let vegetationChanged = false;
  let visualChanged = false;
  const blockCount = Math.max(1, state.fireBlockCount);
  const blocksPerTick = Math.max(1, Math.floor(state.simPerf.growthBlocksPerTick || 1));
  const blockSize = Math.max(4, state.fireBlockSize || 16);
  let processed = 0;
  let cursor = state.growthBlockCursor % blockCount;
  for (; processed < blocksPerTick; processed += 1) {
    const blockIndex = cursor;
    cursor = (cursor + 1) % blockCount;
    const blockX = blockIndex % state.fireBlockCols;
    const blockY = Math.floor(blockIndex / state.fireBlockCols);
    const minX = blockX * blockSize;
    const minY = blockY * blockSize;
    const maxX = Math.min(state.grid.cols - 1, minX + blockSize - 1);
    const maxY = Math.min(state.grid.rows - 1, minY + blockSize - 1);
    const elapsedDays = getGrowthBlockElapsedDays(state, blockIndex, dayDelta);
    if (elapsedDays <= 0 || minX >= state.grid.cols || minY >= state.grid.rows) {
      markGrowthBlockProcessed(state, blockIndex, elapsedDays);
      continue;
    }
    const result = processVegetationSuccessionBlock(
      state,
      { minX, maxX, minY, maxY },
      elapsedDays,
      rng
    );
    terrainTypeChanged ||= result.terrainTypeChanged;
    vegetationChanged ||= result.vegetationChanged;
    visualChanged ||= result.visualChanged;
    markGrowthBlockProcessed(state, blockIndex, elapsedDays);
  }
  state.growthBlockCursor = cursor;

  if (terrainTypeChanged) {
    state.terrainTypeRevision += 1;
  }
  const flushVisuals =
    terrainTypeChanged ||
    visualChanged ||
    (vegetationChanged && state.growthVisualDayAccumulator >= VEGETATION_VISUAL_FLUSH_DAYS);
  if (flushVisuals) {
    state.terrainDirty = true;
    state.vegetationRevision += 1;
    state.growthVisualDayAccumulator = 0;
  }

  profEnd("growth", profStartAt);
}
