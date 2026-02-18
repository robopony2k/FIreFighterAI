import type { Point, RNG } from "../core/types.js";
import type { WorldState } from "../core/state.js";
import { inBounds, indexFor } from "../core/grid.js";
import { applyFuel } from "../core/tiles.js";

export const ROAD_GRADE_LIMIT_START = 0.12;
export const ROAD_GRADE_LIMIT_RELAX_STEP = 0.02;
export const ROAD_GRADE_LIMIT_MAX = 0.18;
export const ROAD_SLOPE_PENALTY_WEIGHT = 14;
export const ROAD_RIVER_BLOCK_DIST = 1;
export const ROAD_RIVER_PENALTY_DIST = 3;
export const ROAD_RIVER_PENALTY_WEIGHT = 8;
export const ROAD_TURN_PENALTY = 0.35;
export const ROAD_BRIDGE_STEP_COST = 24;
export const ROAD_BRIDGE_MAX_CONSEC_WATER = 3;
export const ROAD_BRIDGE_MAX_WATER_TILES_PER_PATH = 6;

type RoadBridgePolicy = "never" | "allow";

export type RoadPathOptions = {
  allowWater?: boolean;
  bridgePolicy?: RoadBridgePolicy;
  gradeLimitStart?: number;
  gradeLimitRelaxStep?: number;
  gradeLimitMax?: number;
  slopePenaltyWeight?: number;
  riverBlockDistance?: number;
  riverPenaltyDistance?: number;
  riverPenaltyWeight?: number;
  turnPenalty?: number;
  bridgeStepCost?: number;
  bridgeMaxConsecutiveWater?: number;
  bridgeMaxWaterTilesPerPath?: number;
};

type RoadPathOptionsResolved = {
  bridgePolicy: RoadBridgePolicy;
  gradeLimitStart: number;
  gradeLimitRelaxStep: number;
  gradeLimitMax: number;
  slopePenaltyWeight: number;
  riverBlockDistance: number;
  riverPenaltyDistance: number;
  riverPenaltyWeight: number;
  turnPenalty: number;
  bridgeStepCost: number;
  bridgeMaxConsecutiveWater: number;
  bridgeMaxWaterTilesPerPath: number;
};

type RoadCarveOptions = RoadPathOptions & {
  allowBridge?: boolean;
};

type RoadPathResult = {
  path: Point[];
  bridgeTileIndices: number[];
  maxGrade: number;
  minRiverClearance: number;
  bridgeSegments: number;
};

type RiverDistanceCache = {
  maskRef: Uint8Array;
  distances: Int16Array;
};

export type RoadGenerationStats = {
  pathsAttempted: number;
  pathsFound: number;
  maxRealizedGrade: number;
  minRiverClearance: number;
  bridgeSegments: number;
};

const ROAD_DIRS: Array<{ x: number; y: number; cost: number }> = [
  { x: 1, y: 0, cost: 1 },
  { x: -1, y: 0, cost: 1 },
  { x: 0, y: 1, cost: 1 },
  { x: 0, y: -1, cost: 1 },
  { x: 1, y: 1, cost: Math.SQRT2 },
  { x: -1, y: 1, cost: Math.SQRT2 },
  { x: 1, y: -1, cost: Math.SQRT2 },
  { x: -1, y: -1, cost: Math.SQRT2 }
];

const riverDistanceCache = new WeakMap<WorldState, RiverDistanceCache>();

const roadGenerationStats: RoadGenerationStats = {
  pathsAttempted: 0,
  pathsFound: 0,
  maxRealizedGrade: 0,
  minRiverClearance: Number.POSITIVE_INFINITY,
  bridgeSegments: 0
};

const resolveRoadPathOptions = (options: RoadPathOptions = {}): RoadPathOptionsResolved => {
  const bridgePolicy = options.bridgePolicy ?? (options.allowWater ? "allow" : "never");
  const gradeLimitStart = Math.max(0.01, options.gradeLimitStart ?? ROAD_GRADE_LIMIT_START);
  const gradeLimitRelaxStep = Math.max(0.001, options.gradeLimitRelaxStep ?? ROAD_GRADE_LIMIT_RELAX_STEP);
  const gradeLimitMax = Math.max(gradeLimitStart, options.gradeLimitMax ?? ROAD_GRADE_LIMIT_MAX);
  return {
    bridgePolicy,
    gradeLimitStart,
    gradeLimitRelaxStep,
    gradeLimitMax,
    slopePenaltyWeight: Math.max(0, options.slopePenaltyWeight ?? ROAD_SLOPE_PENALTY_WEIGHT),
    riverBlockDistance: Math.max(0, Math.round(options.riverBlockDistance ?? ROAD_RIVER_BLOCK_DIST)),
    riverPenaltyDistance: Math.max(0, Math.round(options.riverPenaltyDistance ?? ROAD_RIVER_PENALTY_DIST)),
    riverPenaltyWeight: Math.max(0, options.riverPenaltyWeight ?? ROAD_RIVER_PENALTY_WEIGHT),
    turnPenalty: Math.max(0, options.turnPenalty ?? ROAD_TURN_PENALTY),
    bridgeStepCost: Math.max(0, options.bridgeStepCost ?? ROAD_BRIDGE_STEP_COST),
    bridgeMaxConsecutiveWater: Math.max(1, Math.round(options.bridgeMaxConsecutiveWater ?? ROAD_BRIDGE_MAX_CONSEC_WATER)),
    bridgeMaxWaterTilesPerPath: Math.max(1, Math.round(options.bridgeMaxWaterTilesPerPath ?? ROAD_BRIDGE_MAX_WATER_TILES_PER_PATH))
  };
};

const toPoint = (idx: number, cols: number): Point => ({ x: idx % cols, y: Math.floor(idx / cols) });

const getRiverDistanceField = (state: WorldState): Int16Array => {
  const cached = riverDistanceCache.get(state);
  if (cached && cached.maskRef === state.tileRiverMask && cached.distances.length === state.grid.totalTiles) {
    return cached.distances;
  }

  const total = state.grid.totalTiles;
  const cols = state.grid.cols;
  const rows = state.grid.rows;
  const dist = new Int16Array(total);
  dist.fill(32767);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  for (let i = 0; i < total; i += 1) {
    if (state.tileRiverMask[i] > 0) {
      dist[i] = 0;
      queue[tail] = i;
      tail += 1;
    }
  }

  while (head < tail) {
    const idx = queue[head];
    head += 1;
    const nextDist = dist[idx] + 1;
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    if (x > 0) {
      const nIdx = idx - 1;
      if (nextDist < dist[nIdx]) {
        dist[nIdx] = nextDist;
        queue[tail] = nIdx;
        tail += 1;
      }
    }
    if (x < cols - 1) {
      const nIdx = idx + 1;
      if (nextDist < dist[nIdx]) {
        dist[nIdx] = nextDist;
        queue[tail] = nIdx;
        tail += 1;
      }
    }
    if (y > 0) {
      const nIdx = idx - cols;
      if (nextDist < dist[nIdx]) {
        dist[nIdx] = nextDist;
        queue[tail] = nIdx;
        tail += 1;
      }
    }
    if (y < rows - 1) {
      const nIdx = idx + cols;
      if (nextDist < dist[nIdx]) {
        dist[nIdx] = nextDist;
        queue[tail] = nIdx;
        tail += 1;
      }
    }
  }

  riverDistanceCache.set(state, { maskRef: state.tileRiverMask, distances: dist });
  return dist;
};

const isRoadLikeIndex = (state: WorldState, idx: number): boolean => {
  const type = state.tiles[idx].type;
  return type === "road" || type === "base" || state.tileRoadBridge[idx] > 0;
};

const isRiverApproachTile = (state: WorldState, idx: number): boolean => {
  const cols = state.grid.cols;
  const rows = state.grid.rows;
  const x = idx % cols;
  const y = Math.floor(idx / cols);
  if (x > 0 && state.tileRiverMask[idx - 1] > 0) {
    return true;
  }
  if (x < cols - 1 && state.tileRiverMask[idx + 1] > 0) {
    return true;
  }
  if (y > 0 && state.tileRiverMask[idx - cols] > 0) {
    return true;
  }
  if (y < rows - 1 && state.tileRiverMask[idx + cols] > 0) {
    return true;
  }
  return false;
};

export const isRoadLikeTile = (state: WorldState, x: number, y: number): boolean => {
  if (!inBounds(state.grid, x, y)) {
    return false;
  }
  return isRoadLikeIndex(state, indexFor(state.grid, x, y));
};

const canTraverseTileIndex = (
  state: WorldState,
  idx: number,
  isEndpoint: boolean,
  allowBridge: boolean,
  options: RoadPathOptionsResolved,
  riverDistance: Int16Array
): boolean => {
  if (state.structureMask[idx]) {
    return false;
  }
  const tile = state.tiles[idx];
  if (tile.type === "house" && !isEndpoint) {
    return false;
  }
  const existingBridge = state.tileRoadBridge[idx] > 0;
  if (tile.type === "water") {
    if (existingBridge) {
      return true;
    }
    if (!allowBridge) {
      return false;
    }
    return state.tileRiverMask[idx] > 0;
  }
  if (
    !isEndpoint &&
    options.riverBlockDistance > 0 &&
    riverDistance[idx] <= options.riverBlockDistance &&
    !isRoadLikeIndex(state, idx)
  ) {
    if (!(allowBridge && isRiverApproachTile(state, idx))) {
      return false;
    }
  }
  return true;
};

export function setRoadAt(state: WorldState, rng: RNG, x: number, y: number, options: RoadCarveOptions = {}): void {
  if (!inBounds(state.grid, x, y)) {
    return;
  }
  const idx = indexFor(state.grid, x, y);
  const tile = state.tiles[idx];
  if (state.structureMask[idx]) {
    return;
  }
  if (tile.type === "house" || tile.type === "base") {
    return;
  }
  if (tile.type === "water") {
    if (!options.allowBridge || state.tileRiverMask[idx] === 0) {
      return;
    }
    state.tileRoadBridge[idx] = 1;
    tile.canopy = 0;
    tile.canopyCover = 0;
    tile.stemDensity = 0;
    tile.dominantTreeType = null;
    tile.treeType = null;
    tile.ashAge = 0;
    applyFuel(tile, tile.moisture, rng);
    return;
  }
  state.tileRoadBridge[idx] = 0;
  tile.type = "road";
  tile.canopy = 0;
  tile.canopyCover = 0;
  tile.stemDensity = 0;
  tile.dominantTreeType = null;
  tile.treeType = null;
  tile.ashAge = 0;
  applyFuel(tile, tile.moisture, rng);
}

export function canRoadTraverse(
  state: WorldState,
  x: number,
  y: number,
  start: Point,
  end: Point,
  options: RoadPathOptions = {}
): boolean {
  if (!inBounds(state.grid, x, y)) {
    return false;
  }
  const idx = indexFor(state.grid, x, y);
  const resolved = resolveRoadPathOptions(options);
  const allowBridge = resolved.bridgePolicy === "allow";
  const riverDistance = getRiverDistanceField(state);
  return canTraverseTileIndex(
    state,
    idx,
    (x === start.x && y === start.y) || (x === end.x && y === end.y),
    allowBridge,
    resolved,
    riverDistance
  );
}

const heapPush = (openIdx: number[], openF: number[], idx: number, f: number): void => {
  let i = openIdx.length;
  openIdx.push(idx);
  openF.push(f);
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (openF[parent] <= f) {
      break;
    }
    openIdx[i] = openIdx[parent];
    openF[i] = openF[parent];
    i = parent;
  }
  openIdx[i] = idx;
  openF[i] = f;
};

const heapPop = (openIdx: number[], openF: number[]): number => {
  if (openIdx.length === 0) {
    return -1;
  }
  const result = openIdx[0];
  const lastIdx = openIdx.pop() as number;
  const lastF = openF.pop() as number;
  if (openIdx.length > 0) {
    let i = 0;
    while (true) {
      const left = i * 2 + 1;
      if (left >= openIdx.length) {
        break;
      }
      const right = left + 1;
      let child = left;
      if (right < openIdx.length && openF[right] < openF[left]) {
        child = right;
      }
      if (openF[child] >= lastF) {
        break;
      }
      openIdx[i] = openIdx[child];
      openF[i] = openF[child];
      i = child;
    }
    openIdx[i] = lastIdx;
    openF[i] = lastF;
  }
  return result;
};

const buildPathResult = (
  state: WorldState,
  pathIndices: number[],
  riverDistance: Int16Array
): RoadPathResult => {
  const path = pathIndices.map((idx) => toPoint(idx, state.grid.cols));
  const bridgeTileIndices: number[] = [];
  let maxGrade = 0;
  let minRiverClearance = Number.POSITIVE_INFINITY;
  let bridgeSegments = 0;
  let inBridge = false;

  for (let i = 0; i < pathIndices.length; i += 1) {
    const idx = pathIndices[i];
    const tile = state.tiles[idx];
    const isBridge = tile.type === "water";
    if (isBridge) {
      bridgeTileIndices.push(idx);
      if (!inBridge) {
        bridgeSegments += 1;
        inBridge = true;
      }
    } else {
      inBridge = false;
      minRiverClearance = Math.min(minRiverClearance, riverDistance[idx]);
    }

    if (i <= 0) {
      continue;
    }
    const prevIdx = pathIndices[i - 1];
    const prevTile = state.tiles[prevIdx];
    if (tile.type === "water" || prevTile.type === "water") {
      continue;
    }
    const grade = Math.abs(tile.elevation - prevTile.elevation);
    if (grade > maxGrade) {
      maxGrade = grade;
    }
  }

  return {
    path,
    bridgeTileIndices,
    maxGrade,
    minRiverClearance,
    bridgeSegments
  };
};

const recordPathStats = (result: RoadPathResult): void => {
  roadGenerationStats.pathsFound += 1;
  roadGenerationStats.maxRealizedGrade = Math.max(roadGenerationStats.maxRealizedGrade, result.maxGrade);
  roadGenerationStats.minRiverClearance = Math.min(roadGenerationStats.minRiverClearance, result.minRiverClearance);
  roadGenerationStats.bridgeSegments += result.bridgeSegments;
};

const runAStar = (
  state: WorldState,
  start: Point,
  end: Point | null,
  isTarget: ((x: number, y: number) => boolean) | null,
  options: RoadPathOptionsResolved,
  allowBridge: boolean,
  gradeLimit: number
): RoadPathResult | null => {
  if (!inBounds(state.grid, start.x, start.y)) {
    return null;
  }
  if (end && !inBounds(state.grid, end.x, end.y)) {
    return null;
  }
  const total = state.grid.totalTiles;
  const cols = state.grid.cols;
  const startIdx = indexFor(state.grid, start.x, start.y);
  const endIdx = end ? indexFor(state.grid, end.x, end.y) : -1;
  const riverDistance = getRiverDistanceField(state);

  if (
    !canTraverseTileIndex(state, startIdx, true, allowBridge, options, riverDistance) ||
    (endIdx >= 0 && !canTraverseTileIndex(state, endIdx, true, allowBridge, options, riverDistance))
  ) {
    return null;
  }
  if (endIdx >= 0 && startIdx === endIdx) {
    return {
      path: [start],
      bridgeTileIndices: [],
      maxGrade: 0,
      minRiverClearance: riverDistance[startIdx],
      bridgeSegments: 0
    };
  }

  const gScore = new Float64Array(total);
  gScore.fill(Number.POSITIVE_INFINITY);
  const prev = new Int32Array(total);
  prev.fill(-1);
  const closed = new Uint8Array(total);
  const waterTilesUsed = new Int16Array(total);
  waterTilesUsed.fill(32767);
  const consecutiveWater = new Int8Array(total);
  const stepDx = new Int8Array(total);
  const stepDy = new Int8Array(total);
  const openIdx: number[] = [];
  const openF: number[] = [];

  const estimate = (x: number, y: number): number => {
    if (!end) {
      return 0;
    }
    const dx = Math.abs(x - end.x);
    const dy = Math.abs(y - end.y);
    const diagonal = Math.min(dx, dy);
    return dx + dy + (Math.SQRT2 - 2) * diagonal;
  };

  const startWater = state.tiles[startIdx].type === "water" && state.tileRoadBridge[startIdx] === 0 ? 1 : 0;
  gScore[startIdx] = 0;
  prev[startIdx] = startIdx;
  waterTilesUsed[startIdx] = startWater;
  consecutiveWater[startIdx] = startWater;
  heapPush(openIdx, openF, startIdx, estimate(start.x, start.y));

  let goalIdx = -1;
  while (openIdx.length > 0) {
    const currentIdx = heapPop(openIdx, openF);
    if (currentIdx < 0 || closed[currentIdx]) {
      continue;
    }
    closed[currentIdx] = 1;
    const cx = currentIdx % cols;
    const cy = Math.floor(currentIdx / cols);
    const isGoal = end ? currentIdx === endIdx : !!isTarget?.(cx, cy);
    if (isGoal) {
      goalIdx = currentIdx;
      break;
    }
    const currentG = gScore[currentIdx];
    const currentTile = state.tiles[currentIdx];
    const currentIsWater = currentTile.type === "water" && state.tileRoadBridge[currentIdx] === 0;

    for (const dir of ROAD_DIRS) {
      const nx = cx + dir.x;
      const ny = cy + dir.y;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const nIdx = indexFor(state.grid, nx, ny);
      const neighborIsGoal = end ? nIdx === endIdx : false;
      if (!canTraverseTileIndex(state, nIdx, neighborIsGoal, allowBridge, options, riverDistance)) {
        continue;
      }
      if (dir.x !== 0 && dir.y !== 0) {
        const idxA = indexFor(state.grid, cx + dir.x, cy);
        const idxB = indexFor(state.grid, cx, cy + dir.y);
        if (
          !canTraverseTileIndex(state, idxA, false, allowBridge, options, riverDistance) &&
          !canTraverseTileIndex(state, idxB, false, allowBridge, options, riverDistance)
        ) {
          continue;
        }
      }

      const nextTile = state.tiles[nIdx];
      const nextIsWater = nextTile.type === "water" && state.tileRoadBridge[nIdx] === 0;
      let nextWaterUsed = waterTilesUsed[currentIdx];
      let nextConsecutiveWater = 0;
      if (nextIsWater) {
        if (!allowBridge || state.tileRiverMask[nIdx] === 0) {
          continue;
        }
        nextWaterUsed += 1;
        if (nextWaterUsed > options.bridgeMaxWaterTilesPerPath) {
          continue;
        }
        nextConsecutiveWater = consecutiveWater[currentIdx] + 1;
        if (nextConsecutiveWater > options.bridgeMaxConsecutiveWater) {
          continue;
        }
      }

      const grade = Math.abs(nextTile.elevation - currentTile.elevation);
      if (!currentIsWater && !nextIsWater && grade > gradeLimit) {
        continue;
      }

      let stepCost = dir.cost;
      if (!currentIsWater && !nextIsWater) {
        stepCost += grade * options.slopePenaltyWeight;
      }
      if (nextIsWater) {
        stepCost += options.bridgeStepCost;
      } else if (!isRoadLikeIndex(state, nIdx) && options.riverPenaltyDistance > 0) {
        const riverDist = riverDistance[nIdx];
        if (riverDist <= options.riverPenaltyDistance) {
          const riverPenaltyRatio = (options.riverPenaltyDistance - riverDist + 1) / (options.riverPenaltyDistance + 1);
          stepCost += riverPenaltyRatio * options.riverPenaltyWeight;
        }
      }
      if (prev[currentIdx] !== currentIdx && (stepDx[currentIdx] !== dir.x || stepDy[currentIdx] !== dir.y)) {
        stepCost += options.turnPenalty;
      }

      const nextG = currentG + stepCost;
      if (
        nextG > gScore[nIdx] + 1e-7 &&
        !(Math.abs(nextG - gScore[nIdx]) <= 1e-7 && nextWaterUsed < waterTilesUsed[nIdx])
      ) {
        continue;
      }

      gScore[nIdx] = nextG;
      prev[nIdx] = currentIdx;
      waterTilesUsed[nIdx] = nextWaterUsed;
      consecutiveWater[nIdx] = nextConsecutiveWater;
      stepDx[nIdx] = dir.x;
      stepDy[nIdx] = dir.y;
      heapPush(openIdx, openF, nIdx, nextG + estimate(nx, ny));
    }
  }

  if (goalIdx < 0) {
    return null;
  }

  const pathIndices: number[] = [];
  let current = goalIdx;
  while (current !== startIdx) {
    pathIndices.push(current);
    current = prev[current];
    if (current < 0) {
      return null;
    }
  }
  pathIndices.push(startIdx);
  pathIndices.reverse();
  return buildPathResult(state, pathIndices, riverDistance);
};

const findPathWithGradeRelaxation = (
  state: WorldState,
  start: Point,
  end: Point | null,
  isTarget: ((x: number, y: number) => boolean) | null,
  options: RoadPathOptionsResolved,
  allowBridge: boolean
): RoadPathResult | null => {
  let gradeLimit = options.gradeLimitStart;
  while (gradeLimit <= options.gradeLimitMax + 1e-9) {
    const result = runAStar(state, start, end, isTarget, options, allowBridge, gradeLimit);
    if (result) {
      return result;
    }
    gradeLimit += options.gradeLimitRelaxStep;
  }
  return null;
};

const findRoadPathDetailed = (
  state: WorldState,
  start: Point,
  end: Point,
  options: RoadPathOptions = {}
): RoadPathResult => {
  const resolved = resolveRoadPathOptions(options);
  roadGenerationStats.pathsAttempted += 1;
  let result: RoadPathResult | null = null;
  if (resolved.bridgePolicy === "allow") {
    result = findPathWithGradeRelaxation(state, start, end, null, resolved, true);
    if (!result) {
      result = findPathWithGradeRelaxation(state, start, end, null, resolved, false);
    }
  } else {
    result = findPathWithGradeRelaxation(state, start, end, null, resolved, false);
  }
  if (!result) {
    return {
      path: [],
      bridgeTileIndices: [],
      maxGrade: 0,
      minRiverClearance: Number.POSITIVE_INFINITY,
      bridgeSegments: 0
    };
  }
  recordPathStats(result);
  return result;
};

const findRoadPathToTargetDetailed = (
  state: WorldState,
  start: Point,
  isTarget: (x: number, y: number) => boolean,
  options: RoadPathOptions = {}
): RoadPathResult => {
  const resolved = resolveRoadPathOptions(options);
  roadGenerationStats.pathsAttempted += 1;
  let result: RoadPathResult | null = null;
  if (resolved.bridgePolicy === "allow") {
    result = findPathWithGradeRelaxation(state, start, null, isTarget, resolved, true);
    if (!result) {
      result = findPathWithGradeRelaxation(state, start, null, isTarget, resolved, false);
    }
  } else {
    result = findPathWithGradeRelaxation(state, start, null, isTarget, resolved, false);
  }
  if (!result) {
    return {
      path: [],
      bridgeTileIndices: [],
      maxGrade: 0,
      minRiverClearance: Number.POSITIVE_INFINITY,
      bridgeSegments: 0
    };
  }
  recordPathStats(result);
  return result;
};

export function findRoadPath(state: WorldState, start: Point, end: Point, options: RoadPathOptions = {}): Point[] {
  return findRoadPathDetailed(state, start, end, options).path;
}

export function findRoadPathToTarget(
  state: WorldState,
  start: Point,
  isTarget: (x: number, y: number) => boolean,
  options: RoadPathOptions = {}
): Point[] {
  return findRoadPathToTargetDetailed(state, start, isTarget, options).path;
}

export function carveRoad(state: WorldState, rng: RNG, start: Point, end: Point, options: RoadCarveOptions = {}): boolean {
  const bridgePolicy =
    options.bridgePolicy ?? (typeof options.allowBridge === "boolean" ? (options.allowBridge ? "allow" : "never") : "allow");
  const result = findRoadPathDetailed(state, start, end, { ...options, bridgePolicy });
  if (result.path.length === 0) {
    return false;
  }
  const bridgeSet = new Set<number>(result.bridgeTileIndices);
  result.path.forEach((point) => {
    const idx = indexFor(state.grid, point.x, point.y);
    setRoadAt(state, rng, point.x, point.y, { allowBridge: bridgeSet.has(idx) });
  });
  return true;
}

export function collectRoadTiles(state: WorldState): Point[] {
  const roads: Point[] = [];
  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      if (isRoadLikeTile(state, x, y)) {
        roads.push({ x, y });
      }
    }
  }
  return roads;
}

export function findNearestRoadTile(state: WorldState, origin: Point): Point {
  let best = state.basePoint;
  let bestDist = Math.abs(origin.x - state.basePoint.x) + Math.abs(origin.y - state.basePoint.y);
  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      if (!isRoadLikeTile(state, x, y)) {
        continue;
      }
      const dist = Math.abs(origin.x - x) + Math.abs(origin.y - y);
      if (dist < bestDist) {
        bestDist = dist;
        best = { x, y };
      }
    }
  }
  return best;
}

export const resetRoadGenerationStats = (): void => {
  roadGenerationStats.pathsAttempted = 0;
  roadGenerationStats.pathsFound = 0;
  roadGenerationStats.maxRealizedGrade = 0;
  roadGenerationStats.minRiverClearance = Number.POSITIVE_INFINITY;
  roadGenerationStats.bridgeSegments = 0;
};

export const getRoadGenerationStats = (): RoadGenerationStats => ({
  pathsAttempted: roadGenerationStats.pathsAttempted,
  pathsFound: roadGenerationStats.pathsFound,
  maxRealizedGrade: roadGenerationStats.maxRealizedGrade,
  minRiverClearance: roadGenerationStats.minRiverClearance,
  bridgeSegments: roadGenerationStats.bridgeSegments
});
