import type { MapGenSettings } from "../../../mapgen/settings.js";
import { clamp } from "../../../core/utils.js";
import { hash2D } from "../../../mapgen/noise.js";

const NEIGHBORS_4 = [
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 }
] as const;

export type LakeConnectionPathInput = {
  cols: number;
  rows: number;
  elevationMap: ArrayLike<number>;
  riverMask: Uint8Array;
  oceanMask: Uint8Array;
  lakeMask: Uint16Array;
  lakeId: number;
  lakeTiles: readonly number[];
  surfaceLevel: number;
  settings: MapGenSettings;
  seed: number;
};

export type LakeRiverConnectionPaths = {
  inletTiles: number[];
  outletTiles: number[];
};

const idxAt = (x: number, y: number, cols: number): number => y * cols + x;

const isValid = (x: number, y: number, cols: number, rows: number): boolean =>
  x >= 0 && y >= 0 && x < cols && y < rows;

const uniqueSorted = (values: Iterable<number>): number[] => Array.from(new Set(values)).sort((a, b) => a - b);

const buildLakeEdgeSets = (
  cols: number,
  rows: number,
  lakeMask: Uint16Array,
  lakeId: number,
  lakeTiles: readonly number[]
): { lakeEdge: number[]; outsideEdge: number[] } => {
  const lakeEdge = new Set<number>();
  const outsideEdge = new Set<number>();
  for (const idx of lakeTiles) {
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    for (const dir of NEIGHBORS_4) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (!isValid(nx, ny, cols, rows)) {
        continue;
      }
      const nIdx = idxAt(nx, ny, cols);
      if ((lakeMask[nIdx] ?? 0) === lakeId) {
        continue;
      }
      lakeEdge.add(idx);
      outsideEdge.add(nIdx);
    }
  }
  return {
    lakeEdge: uniqueSorted(lakeEdge),
    outsideEdge: uniqueSorted(outsideEdge)
  };
};

const reconstructPath = (endIdx: number, previous: Int32Array): number[] => {
  const path: number[] = [];
  let cursor = endIdx;
  while (cursor >= 0) {
    path.push(cursor);
    cursor = previous[cursor] ?? -1;
  }
  path.reverse();
  return path;
};

const findShortestHydrologyPath = (input: {
  cols: number;
  rows: number;
  elevationMap: ArrayLike<number>;
  riverMask: Uint8Array;
  oceanMask: Uint8Array;
  lakeMask: Uint16Array;
  lakeId: number;
  starts: readonly number[];
  goals: readonly number[];
  maxSteps: number;
  smoothing: number;
  seed: number;
  preferDownhill: boolean;
}): number[] => {
  const {
    cols,
    rows,
    elevationMap,
    riverMask,
    oceanMask,
    lakeMask,
    lakeId,
    starts,
    goals,
    maxSteps,
    smoothing,
    seed,
    preferDownhill
  } = input;
  const total = cols * rows;
  if (starts.length === 0 || goals.length === 0 || maxSteps <= 0) {
    return [];
  }
  const goalMask = new Uint8Array(total);
  for (const goal of goals) {
    if (goal >= 0 && goal < total) {
      goalMask[goal] = 1;
    }
  }
  const previous = new Int32Array(total);
  previous.fill(-1);
  const steps = new Int16Array(total);
  steps.fill(-1);
  const cost = new Float32Array(total);
  cost.fill(Number.POSITIVE_INFINITY);
  const open: number[] = [];
  for (const start of starts) {
    if (start < 0 || start >= total || oceanMask[start] > 0 || lakeMask[start] > 0) {
      continue;
    }
    if (steps[start] >= 0) {
      continue;
    }
    steps[start] = 0;
    cost[start] = 0;
    open.push(start);
  }
  let bestGoal = -1;
  while (open.length > 0) {
    let bestOpenIndex = 0;
    let bestOpenCost = cost[open[0]] ?? Number.POSITIVE_INFINITY;
    for (let i = 1; i < open.length; i += 1) {
      const candidateCost = cost[open[i]] ?? Number.POSITIVE_INFINITY;
      if (candidateCost < bestOpenCost) {
        bestOpenIndex = i;
        bestOpenCost = candidateCost;
      }
    }
    const current = open.splice(bestOpenIndex, 1)[0];
    if (goalMask[current] > 0) {
      bestGoal = current;
      break;
    }
    const currentStep = steps[current] ?? 0;
    if (currentStep >= maxSteps) {
      continue;
    }
    const x = current % cols;
    const y = Math.floor(current / cols);
    const currentElevation = elevationMap[current] ?? 0;
    for (const dir of NEIGHBORS_4) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (!isValid(nx, ny, cols, rows)) {
        continue;
      }
      const nIdx = idxAt(nx, ny, cols);
      const nLakeId = lakeMask[nIdx] ?? 0;
      if (oceanMask[nIdx] > 0 || (nLakeId > 0 && nLakeId !== lakeId)) {
        continue;
      }
      if (nLakeId === lakeId && goalMask[nIdx] === 0) {
        continue;
      }
      const nextStep = currentStep + 1;
      if (nextStep > maxSteps) {
        continue;
      }
      const nElevation = elevationMap[nIdx] ?? currentElevation;
      const uphill = Math.max(0, nElevation - currentElevation);
      const downhill = Math.max(0, currentElevation - nElevation);
      const elevationPenalty = preferDownhill ? uphill * 20 - downhill * 2 : Math.abs(nElevation - currentElevation) * 8;
      const riverBonus = riverMask[nIdx] > 0 ? -0.45 : 0;
      const noise = hash2D(nx, ny, seed + 91_337) * 0.04;
      const nextCost =
        bestOpenCost +
        1 +
        elevationPenalty * clamp(smoothing, 0, 1) +
        riverBonus +
        noise;
      if (nextCost >= (cost[nIdx] ?? Number.POSITIVE_INFINITY)) {
        continue;
      }
      cost[nIdx] = nextCost;
      previous[nIdx] = current;
      if (steps[nIdx] < 0) {
        open.push(nIdx);
      }
      steps[nIdx] = nextStep;
    }
  }
  return bestGoal >= 0 ? reconstructPath(bestGoal, previous) : [];
};

const collectNearbyRiverStarts = (
  cols: number,
  rows: number,
  riverMask: Uint8Array,
  lakeMask: Uint16Array,
  lakeId: number,
  lakeTiles: readonly number[],
  maxDistance: number
): number[] => {
  const starts = new Set<number>();
  const maxDistSq = maxDistance * maxDistance;
  for (const lakeIdx of lakeTiles) {
    const lx = lakeIdx % cols;
    const ly = Math.floor(lakeIdx / cols);
    const minX = Math.max(0, lx - maxDistance);
    const maxX = Math.min(cols - 1, lx + maxDistance);
    const minY = Math.max(0, ly - maxDistance);
    const maxY = Math.min(rows - 1, ly + maxDistance);
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x - lx;
        const dy = y - ly;
        if (dx * dx + dy * dy > maxDistSq) {
          continue;
        }
        const idx = idxAt(x, y, cols);
        if (riverMask[idx] > 0 && lakeMask[idx] !== lakeId) {
          starts.add(idx);
        }
      }
    }
  }
  return uniqueSorted(starts);
};

const buildOutletContinuation = (
  input: LakeConnectionPathInput,
  outletTargetIndex: number,
  outsideEdge: readonly number[]
): number[] => {
  const { cols, rows, elevationMap, riverMask, oceanMask, lakeMask, lakeId, settings, seed } = input;
  if (outletTargetIndex < 0 || outletTargetIndex >= cols * rows || lakeMask[outletTargetIndex] > 0) {
    return [];
  }
  const maxSteps = Math.max(1, settings.lakeOutletSearchRadius);
  const path: number[] = [outletTargetIndex];
  const used = new Set<number>(path);
  let current = outletTargetIndex;
  for (let step = 1; step < maxSteps; step += 1) {
    const x = current % cols;
    const y = Math.floor(current / cols);
    const currentElevation = elevationMap[current] ?? input.surfaceLevel;
    let bestIdx = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const dir of NEIGHBORS_4) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (!isValid(nx, ny, cols, rows)) {
        continue;
      }
      const nIdx = idxAt(nx, ny, cols);
      if (used.has(nIdx) || oceanMask[nIdx] > 0 || lakeMask[nIdx] === lakeId) {
        continue;
      }
      const nElevation = elevationMap[nIdx] ?? currentElevation;
      const downhill = currentElevation - nElevation;
      const riverBonus = riverMask[nIdx] > 0 ? -2.2 : 0;
      const edgePenalty = outsideEdge.includes(nIdx) ? 3 : 0;
      const score =
        -downhill * 8 +
        Math.max(0, nElevation - currentElevation) * 18 +
        riverBonus +
        edgePenalty +
        hash2D(nx, ny, seed + 74_909) * 0.2;
      if (score < bestScore) {
        bestScore = score;
        bestIdx = nIdx;
      }
    }
    if (bestIdx < 0) {
      break;
    }
    path.push(bestIdx);
    used.add(bestIdx);
    current = bestIdx;
    if (riverMask[current] > 0 && current !== outletTargetIndex) {
      break;
    }
  }
  return path;
};

export const buildLakeRiverConnectionPaths = (
  input: LakeConnectionPathInput & { outletTargetIndex: number }
): LakeRiverConnectionPaths => {
  const { cols, rows, riverMask, lakeMask, lakeId, lakeTiles, settings, outletTargetIndex } = input;
  const edgeSets = buildLakeEdgeSets(cols, rows, lakeMask, lakeId, lakeTiles);
  const outsideLakeEdge = edgeSets.outsideEdge.filter((idx) => lakeMask[idx] === 0 && input.oceanMask[idx] === 0);
  const inletStarts = collectNearbyRiverStarts(
    cols,
    rows,
    riverMask,
    lakeMask,
    lakeId,
    lakeTiles,
    Math.max(1, settings.maxRiverRerouteDistanceTiles)
  );
  const inletPath = findShortestHydrologyPath({
    cols,
    rows,
    elevationMap: input.elevationMap,
    riverMask,
    oceanMask: input.oceanMask,
    lakeMask,
    lakeId,
    starts: inletStarts,
    goals: outsideLakeEdge,
    maxSteps: Math.max(1, settings.maxRiverRerouteDistanceTiles),
    smoothing: settings.riverLakeConnectionSmoothing,
    seed: input.seed,
    preferDownhill: false
  }).filter((idx) => lakeMask[idx] === 0);
  const outletContinuation = buildOutletContinuation(input, outletTargetIndex, outsideLakeEdge);
  return {
    inletTiles: inletPath,
    outletTiles: outletContinuation
  };
};
