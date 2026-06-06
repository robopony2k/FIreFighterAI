import type { StaticHydrologyLake } from "../types/staticHydrologyTypes.js";

const NEIGHBORS_4 = [
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 }
] as const;

export type LakeOverflowRiverPath = {
  lakeId: number;
  outletTargetIndex: number;
  tiles: number[];
  reachedLakeId: number;
  reachedOcean: boolean;
};

export type LakeOverflowRiverRoutingInput = {
  cols: number;
  rows: number;
  elevationMap: ArrayLike<number>;
  oceanMask: Uint8Array;
  lakeMask: Uint16Array;
  flowTarget: Int32Array;
  lakes: readonly StaticHydrologyLake[];
  maxSteps: number;
};

const idxAt = (x: number, y: number, cols: number): number => y * cols + x;

const inBounds = (x: number, y: number, cols: number, rows: number): boolean =>
  x >= 0 && y >= 0 && x < cols && y < rows;

const findFallbackDownstreamNeighbor = (
  current: number,
  sourceLakeId: number,
  visited: Uint8Array,
  input: LakeOverflowRiverRoutingInput
): number => {
  const { cols, rows, elevationMap, oceanMask, lakeMask } = input;
  const x = current % cols;
  const y = Math.floor(current / cols);
  const currentElevation = elevationMap[current] ?? 0;
  let bestIdx = -1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const dir of NEIGHBORS_4) {
    const nx = x + dir.dx;
    const ny = y + dir.dy;
    if (!inBounds(nx, ny, cols, rows)) {
      continue;
    }
    const nIdx = idxAt(nx, ny, cols);
    const nLakeId = lakeMask[nIdx] ?? 0;
    if (visited[nIdx] > 0 || nLakeId === sourceLakeId) {
      continue;
    }
    const nElevation = elevationMap[nIdx] ?? currentElevation;
    const downhill = Math.max(0, currentElevation - nElevation);
    const uphill = Math.max(0, nElevation - currentElevation);
    const edgeDistance = Math.min(nx, ny, cols - 1 - nx, rows - 1 - ny);
    const terminalBonus = oceanMask[nIdx] > 0 || nLakeId > 0 ? -4 : 0;
    const score = nElevation + uphill * 8 - downhill * 3 + edgeDistance * 0.002 + terminalBonus;
    if (score < bestScore || (score === bestScore && nIdx < bestIdx)) {
      bestScore = score;
      bestIdx = nIdx;
    }
  }

  return bestIdx;
};

const buildLakeOverflowPath = (
  lake: StaticHydrologyLake,
  input: LakeOverflowRiverRoutingInput
): LakeOverflowRiverPath => {
  const { cols, rows, oceanMask, lakeMask, flowTarget, maxSteps } = input;
  const total = cols * rows;
  const tiles: number[] = [];
  const visited = new Uint8Array(total);
  let current = lake.outletTargetIndex;
  let reachedLakeId = 0;
  let reachedOcean = false;

  for (let step = 0; step < maxSteps; step += 1) {
    if (current < 0 || current >= total || visited[current] > 0) {
      break;
    }
    visited[current] = 1;
    const currentLakeId = lakeMask[current] ?? 0;
    if (oceanMask[current] > 0) {
      reachedOcean = true;
      break;
    }
    if (currentLakeId > 0) {
      if (currentLakeId !== lake.id) {
        reachedLakeId = currentLakeId;
      }
      break;
    }

    tiles.push(current);
    const target = flowTarget[current] ?? -1;
    if (target >= 0 && target < total && target !== current && visited[target] === 0) {
      current = target;
      continue;
    }

    const fallback = findFallbackDownstreamNeighbor(current, lake.id, visited, input);
    if (fallback < 0) {
      break;
    }
    current = fallback;
  }

  return {
    lakeId: lake.id,
    outletTargetIndex: lake.outletTargetIndex,
    tiles,
    reachedLakeId,
    reachedOcean
  };
};

export const buildLakeOverflowRiverPaths = (
  input: LakeOverflowRiverRoutingInput
): LakeOverflowRiverPath[] => {
  const maxSteps = Math.max(1, input.maxSteps);
  return input.lakes
    .filter((lake) => lake.outletIndex >= 0 && lake.outletTargetIndex >= 0)
    .map((lake) => buildLakeOverflowPath(lake, { ...input, maxSteps }));
};
