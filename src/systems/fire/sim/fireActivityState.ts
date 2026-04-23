import { TILE_TYPE_IDS, type FireActivityState, type WorldState } from "../../../core/state.js";

const HOLDOVER_BLOCKED_TYPE_IDS = new Set<number>([
  TILE_TYPE_IDS.water,
  TILE_TYPE_IDS.ash,
  TILE_TYPE_IDS.firebreak,
  TILE_TYPE_IDS.beach,
  TILE_TYPE_IDS.rocky,
  TILE_TYPE_IDS.bare
]);

const isHoldoverCandidateType = (typeId: number): boolean => !HOLDOVER_BLOCKED_TYPE_IDS.has(typeId);

export type FireActivityMetrics = {
  fireActivityState: FireActivityState;
  fireActivityCount: number;
  fireHoldoverTiles: number;
};

export const resolveFireActivityState = (
  lastActiveFires: number,
  fireHoldoverTiles: number,
  fireScheduledCount: number
): FireActivityState => {
  if (lastActiveFires > 0) {
    return "burning";
  }
  if (fireHoldoverTiles > 0 || fireScheduledCount > 0) {
    return "holdover";
  }
  return "idle";
};

export const applyFireActivityMetrics = (
  state: Pick<WorldState, "fireActivityState" | "fireActivityCount" | "fireHoldoverTiles" | "fireScheduledCount">,
  lastActiveFires: number,
  fireHoldoverTiles: number
): FireActivityMetrics => {
  const clampedActive = Math.max(0, Math.floor(lastActiveFires));
  const clampedHoldover = Math.max(0, Math.floor(fireHoldoverTiles));
  const nextState = resolveFireActivityState(clampedActive, clampedHoldover, Math.max(0, state.fireScheduledCount));
  const metrics = {
    fireActivityState: nextState,
    fireActivityCount: clampedActive + clampedHoldover,
    fireHoldoverTiles: clampedHoldover
  };
  state.fireActivityState = metrics.fireActivityState;
  state.fireActivityCount = metrics.fireActivityCount;
  state.fireHoldoverTiles = metrics.fireHoldoverTiles;
  return metrics;
};

export const countFireHoldoverTiles = (
  state: Pick<
    WorldState,
    | "grid"
    | "fireBlockActiveCount"
    | "fireBlockActiveList"
    | "fireBlockCols"
    | "fireBlockSize"
    | "tileFire"
    | "tileHeat"
    | "tileFuel"
    | "tileSuppressionWetness"
    | "tileIgniteAt"
    | "tileIgnitionPoint"
    | "tileTypeId"
    | "fireScheduledCount"
  >,
  fireEps: number,
  ignitionBoost: number,
  wetnessBlockThreshold: number
): number => {
  let holdoverTiles = 0;
  const cols = state.grid.cols;
  const rows = state.grid.rows;
  const clampedIgnitionBoost = Math.max(0.0001, ignitionBoost);

  for (let i = 0; i < state.fireBlockActiveCount; i += 1) {
    const blockIndex = state.fireBlockActiveList[i];
    const blockX = blockIndex % state.fireBlockCols;
    const blockY = Math.floor(blockIndex / state.fireBlockCols);
    const minX = blockX * state.fireBlockSize;
    const minY = blockY * state.fireBlockSize;
    const maxX = Math.min(cols - 1, minX + state.fireBlockSize - 1);
    const maxY = Math.min(rows - 1, minY + state.fireBlockSize - 1);
    for (let y = minY; y <= maxY; y += 1) {
      let idx = y * cols + minX;
      for (let x = minX; x <= maxX; x += 1, idx += 1) {
        if ((state.tileFire[idx] ?? 0) > fireEps) {
          continue;
        }
        if ((state.tileIgniteAt[idx] ?? Number.POSITIVE_INFINITY) < Number.POSITIVE_INFINITY) {
          holdoverTiles += 1;
          continue;
        }
        if ((state.tileFuel[idx] ?? 0) <= 0) {
          continue;
        }
        const wetness = Math.max(0, state.tileSuppressionWetness[idx] ?? 0);
        if (wetness > wetnessBlockThreshold) {
          continue;
        }
        const typeId = state.tileTypeId[idx] ?? -1;
        if (!isHoldoverCandidateType(typeId)) {
          continue;
        }
        const ignitionPoint = Math.max(0.0001, state.tileIgnitionPoint[idx] ?? 0);
        const effectiveIgnitionThreshold = (ignitionPoint * (1 + 1.8 * wetness)) / clampedIgnitionBoost;
        if ((state.tileHeat[idx] ?? 0) >= effectiveIgnitionThreshold) {
          holdoverTiles += 1;
        }
      }
    }
  }

  if (holdoverTiles === 0 && state.fireScheduledCount > 0) {
    return Math.max(0, state.fireScheduledCount);
  }

  return holdoverTiles;
};
