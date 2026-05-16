import type { Point, RNG } from "../core/types.js";
import type { WorldState } from "../core/state.js";
import { inBounds, indexFor } from "../core/grid.js";
import { getTerrainHeightScale } from "../core/terrainScale.js";
import { applyFuel } from "../core/tiles.js";
import { clearVegetationState } from "../core/vegetation.js";

export const ROAD_GRADE_LIMIT_START = 0.09;
export const ROAD_GRADE_LIMIT_RELAX_STEP = 0.015;
export const ROAD_GRADE_LIMIT_MAX = 0.13;
const ROAD_SWITCHBACK_GRADE_LIMIT_START = 0.12;
const ROAD_SWITCHBACK_GRADE_LIMIT_RELAX_STEP = 0.02;
const ROAD_SWITCHBACK_GRADE_LIMIT_MAX = 0.22;
export const ROAD_SLOPE_PENALTY_WEIGHT = 22;
export const ROAD_CROSSFALL_LIMIT_START = 0.06;
export const ROAD_CROSSFALL_LIMIT_RELAX_STEP = 0.012;
export const ROAD_CROSSFALL_LIMIT_MAX = 0.1;
const ROAD_SWITCHBACK_CROSSFALL_LIMIT_START = 0.08;
const ROAD_SWITCHBACK_CROSSFALL_LIMIT_RELAX_STEP = 0.018;
const ROAD_SWITCHBACK_CROSSFALL_LIMIT_MAX = 0.16;
export const ROAD_CROSSFALL_PENALTY_WEIGHT = 18;
export const ROAD_GRADE_CHANGE_LIMIT_START = 0.06;
export const ROAD_GRADE_CHANGE_LIMIT_RELAX_STEP = 0.012;
export const ROAD_GRADE_CHANGE_LIMIT_MAX = 0.1;
const ROAD_SWITCHBACK_GRADE_CHANGE_LIMIT_START = 0.08;
const ROAD_SWITCHBACK_GRADE_CHANGE_LIMIT_RELAX_STEP = 0.018;
const ROAD_SWITCHBACK_GRADE_CHANGE_LIMIT_MAX = 0.16;
export const ROAD_GRADE_CHANGE_PENALTY_WEIGHT = 16;
export const ROAD_RIVER_BLOCK_DIST = 1;
export const ROAD_RIVER_PENALTY_DIST = 3;
export const ROAD_RIVER_PENALTY_WEIGHT = 8;
export const ROAD_TURN_PENALTY = 0.2;
export const ROAD_DIAGONAL_PENALTY = 0.18;
export const ROAD_EXISTING_SEGMENT_COST_MULTIPLIER = 0.3;
const ROAD_SWITCHBACK_TURN_PENALTY = 0.04;
const ROAD_SWITCHBACK_DIAGONAL_PENALTY = 0.04;
export const ROAD_BRIDGE_STEP_COST = 24;
export const ROAD_BRIDGE_MAX_CONSEC_WATER = 3;
export const ROAD_BRIDGE_MAX_WATER_TILES_PER_PATH = 6;
const ROAD_SWITCHBACK_RELIEF_WEIGHT = 3.25;

type RoadBridgePolicy = "never" | "allow";

export type RoadTileBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export type RoadPathOptions = {
  allowWater?: boolean;
  bridgePolicy?: RoadBridgePolicy;
  searchBounds?: RoadTileBounds;
  heightScaleMultiplier?: number;
  gradeLimitStart?: number;
  gradeLimitRelaxStep?: number;
  gradeLimitMax?: number;
  slopePenaltyWeight?: number;
  crossfallLimitStart?: number;
  crossfallLimitRelaxStep?: number;
  crossfallLimitMax?: number;
  crossfallPenaltyWeight?: number;
  gradeChangeLimitStart?: number;
  gradeChangeLimitRelaxStep?: number;
  gradeChangeLimitMax?: number;
  gradeChangePenaltyWeight?: number;
  riverBlockDistance?: number;
  riverPenaltyDistance?: number;
  riverPenaltyWeight?: number;
  turnPenalty?: number;
  diagonalPenalty?: number;
  bridgeStepCost?: number;
  bridgeMaxConsecutiveWater?: number;
  bridgeMaxWaterTilesPerPath?: number;
};

type RoadPathOptionsResolved = {
  bridgePolicy: RoadBridgePolicy;
  searchBounds: RoadTileBounds | null;
  heightScaleMultiplier: number;
  gradeLimitStart: number;
  gradeLimitRelaxStep: number;
  gradeLimitMax: number;
  slopePenaltyWeight: number;
  crossfallLimitStart: number;
  crossfallLimitRelaxStep: number;
  crossfallLimitMax: number;
  crossfallPenaltyWeight: number;
  gradeChangeLimitStart: number;
  gradeChangeLimitRelaxStep: number;
  gradeChangeLimitMax: number;
  gradeChangePenaltyWeight: number;
  riverBlockDistance: number;
  riverPenaltyDistance: number;
  riverPenaltyWeight: number;
  turnPenalty: number;
  diagonalPenalty: number;
  bridgeStepCost: number;
  bridgeMaxConsecutiveWater: number;
  bridgeMaxWaterTilesPerPath: number;
};

type RoadCarveOptions = RoadPathOptions & {
  allowBridge?: boolean;
};

export type RoadCarveResult = {
  carved: boolean;
  bounds: RoadTileBounds | null;
  pathLength: number;
};

type RoadPathResult = {
  path: Point[];
  bridgeTileIndices: number[];
  maxGrade: number;
  maxCrossfall: number;
  maxGradeChange: number;
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
  maxRealizedCrossfall: number;
  maxRealizedGradeChange: number;
  minRiverClearance: number;
  bridgeSegments: number;
};

export type RoadSurfaceMetrics = {
  maxRoadGrade: number;
  maxRoadCrossfall: number;
  maxRoadGradeChange: number;
  wallEdgeCount: number;
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

export const ROAD_EDGE_N = 1 << 0;
export const ROAD_EDGE_E = 1 << 1;
export const ROAD_EDGE_S = 1 << 2;
export const ROAD_EDGE_W = 1 << 3;
export const ROAD_EDGE_NE = 1 << 4;
export const ROAD_EDGE_NW = 1 << 5;
export const ROAD_EDGE_SE = 1 << 6;
export const ROAD_EDGE_SW = 1 << 7;
export const ROAD_EDGE_CARDINAL_MASK = ROAD_EDGE_N | ROAD_EDGE_E | ROAD_EDGE_S | ROAD_EDGE_W;
export const ROAD_EDGE_DIAGONAL_MASK = ROAD_EDGE_NE | ROAD_EDGE_NW | ROAD_EDGE_SE | ROAD_EDGE_SW;

type RoadEdgeDir = {
  dx: number;
  dy: number;
  bit: number;
  opposite: number;
  diagonal: boolean;
};

export const ROAD_EDGE_DIRS: RoadEdgeDir[] = [
  { dx: 0, dy: -1, bit: ROAD_EDGE_N, opposite: ROAD_EDGE_S, diagonal: false },
  { dx: 1, dy: 0, bit: ROAD_EDGE_E, opposite: ROAD_EDGE_W, diagonal: false },
  { dx: 0, dy: 1, bit: ROAD_EDGE_S, opposite: ROAD_EDGE_N, diagonal: false },
  { dx: -1, dy: 0, bit: ROAD_EDGE_W, opposite: ROAD_EDGE_E, diagonal: false },
  { dx: 1, dy: -1, bit: ROAD_EDGE_NE, opposite: ROAD_EDGE_SW, diagonal: true },
  { dx: -1, dy: -1, bit: ROAD_EDGE_NW, opposite: ROAD_EDGE_SE, diagonal: true },
  { dx: 1, dy: 1, bit: ROAD_EDGE_SE, opposite: ROAD_EDGE_NW, diagonal: true },
  { dx: -1, dy: 1, bit: ROAD_EDGE_SW, opposite: ROAD_EDGE_NE, diagonal: true }
];

const getRoadEdgeDir = (dx: number, dy: number): RoadEdgeDir | null => {
  for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
    const dir = ROAD_EDGE_DIRS[i];
    if (dir.dx === dx && dir.dy === dy) {
      return dir;
    }
  }
  return null;
};

const getPathBounds = (path: readonly Point[]): RoadTileBounds | null => {
  if (path.length === 0) {
    return null;
  }
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < path.length; i += 1) {
    const point = path[i]!;
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, maxX, minY, maxY };
};

export const expandRoadTileBounds = (
  state: WorldState,
  bounds: RoadTileBounds,
  padding: number
): RoadTileBounds => {
  const pad = Math.max(0, Math.floor(padding));
  return {
    minX: Math.max(0, bounds.minX - pad),
    maxX: Math.min(state.grid.cols - 1, bounds.maxX + pad),
    minY: Math.max(0, bounds.minY - pad),
    maxY: Math.min(state.grid.rows - 1, bounds.maxY + pad)
  };
};

export const mergeRoadTileBounds = (
  left: RoadTileBounds | null,
  right: RoadTileBounds | null
): RoadTileBounds | null => {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return {
    minX: Math.min(left.minX, right.minX),
    maxX: Math.max(left.maxX, right.maxX),
    minY: Math.min(left.minY, right.minY),
    maxY: Math.max(left.maxY, right.maxY)
  };
};

const isPointInRoadBounds = (point: Point, bounds: RoadTileBounds | null): boolean =>
  !bounds ||
  (point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY);

const riverDistanceCache = new WeakMap<WorldState, RiverDistanceCache>();

const roadGenerationStats: RoadGenerationStats = {
  pathsAttempted: 0,
  pathsFound: 0,
  maxRealizedGrade: 0,
  maxRealizedCrossfall: 0,
  maxRealizedGradeChange: 0,
  minRiverClearance: Number.POSITIVE_INFINITY,
  bridgeSegments: 0
};

const resolveRoadPathOptions = (options: RoadPathOptions = {}): RoadPathOptionsResolved => {
  const bridgePolicy = options.bridgePolicy ?? (options.allowWater ? "allow" : "never");
  const gradeLimitStart = Math.max(0.01, options.gradeLimitStart ?? ROAD_GRADE_LIMIT_START);
  const gradeLimitRelaxStep = Math.max(0.001, options.gradeLimitRelaxStep ?? ROAD_GRADE_LIMIT_RELAX_STEP);
  const gradeLimitMax = Math.max(gradeLimitStart, options.gradeLimitMax ?? ROAD_GRADE_LIMIT_MAX);
  const crossfallLimitStart = Math.max(0.01, options.crossfallLimitStart ?? ROAD_CROSSFALL_LIMIT_START);
  const gradeChangeLimitStart = Math.max(0.01, options.gradeChangeLimitStart ?? ROAD_GRADE_CHANGE_LIMIT_START);
  return {
    bridgePolicy,
    searchBounds: options.searchBounds ?? null,
    heightScaleMultiplier: Math.max(0.1, options.heightScaleMultiplier ?? 1),
    gradeLimitStart,
    gradeLimitRelaxStep,
    gradeLimitMax,
    slopePenaltyWeight: Math.max(0, options.slopePenaltyWeight ?? ROAD_SLOPE_PENALTY_WEIGHT),
    crossfallLimitStart,
    crossfallLimitRelaxStep: Math.max(0.001, options.crossfallLimitRelaxStep ?? ROAD_CROSSFALL_LIMIT_RELAX_STEP),
    crossfallLimitMax: Math.max(crossfallLimitStart, options.crossfallLimitMax ?? ROAD_CROSSFALL_LIMIT_MAX),
    crossfallPenaltyWeight: Math.max(0, options.crossfallPenaltyWeight ?? ROAD_CROSSFALL_PENALTY_WEIGHT),
    gradeChangeLimitStart,
    gradeChangeLimitRelaxStep: Math.max(
      0.001,
      options.gradeChangeLimitRelaxStep ?? ROAD_GRADE_CHANGE_LIMIT_RELAX_STEP
    ),
    gradeChangeLimitMax: Math.max(gradeChangeLimitStart, options.gradeChangeLimitMax ?? ROAD_GRADE_CHANGE_LIMIT_MAX),
    gradeChangePenaltyWeight: Math.max(
      0,
      options.gradeChangePenaltyWeight ?? ROAD_GRADE_CHANGE_PENALTY_WEIGHT
    ),
    riverBlockDistance: Math.max(0, Math.round(options.riverBlockDistance ?? ROAD_RIVER_BLOCK_DIST)),
    riverPenaltyDistance: Math.max(0, Math.round(options.riverPenaltyDistance ?? ROAD_RIVER_PENALTY_DIST)),
    riverPenaltyWeight: Math.max(0, options.riverPenaltyWeight ?? ROAD_RIVER_PENALTY_WEIGHT),
    turnPenalty: Math.max(0, options.turnPenalty ?? ROAD_TURN_PENALTY),
    diagonalPenalty: Math.max(0, options.diagonalPenalty ?? ROAD_DIAGONAL_PENALTY),
    bridgeStepCost: Math.max(0, options.bridgeStepCost ?? ROAD_BRIDGE_STEP_COST),
    bridgeMaxConsecutiveWater: Math.max(1, Math.round(options.bridgeMaxConsecutiveWater ?? ROAD_BRIDGE_MAX_CONSEC_WATER)),
    bridgeMaxWaterTilesPerPath: Math.max(1, Math.round(options.bridgeMaxWaterTilesPerPath ?? ROAD_BRIDGE_MAX_WATER_TILES_PER_PATH))
  };
};

const buildSwitchbackFallbackOptions = (options: RoadPathOptionsResolved): RoadPathOptionsResolved => ({
  ...options,
  gradeLimitStart: Math.max(options.gradeLimitStart, ROAD_SWITCHBACK_GRADE_LIMIT_START),
  gradeLimitRelaxStep: Math.max(options.gradeLimitRelaxStep, ROAD_SWITCHBACK_GRADE_LIMIT_RELAX_STEP),
  gradeLimitMax: Math.max(options.gradeLimitMax, ROAD_SWITCHBACK_GRADE_LIMIT_MAX),
  crossfallLimitStart: Math.max(options.crossfallLimitStart, ROAD_SWITCHBACK_CROSSFALL_LIMIT_START),
  crossfallLimitRelaxStep: Math.max(options.crossfallLimitRelaxStep, ROAD_SWITCHBACK_CROSSFALL_LIMIT_RELAX_STEP),
  crossfallLimitMax: Math.max(options.crossfallLimitMax, ROAD_SWITCHBACK_CROSSFALL_LIMIT_MAX),
  gradeChangeLimitStart: Math.max(options.gradeChangeLimitStart, ROAD_SWITCHBACK_GRADE_CHANGE_LIMIT_START),
  gradeChangeLimitRelaxStep: Math.max(options.gradeChangeLimitRelaxStep, ROAD_SWITCHBACK_GRADE_CHANGE_LIMIT_RELAX_STEP),
  gradeChangeLimitMax: Math.max(options.gradeChangeLimitMax, ROAD_SWITCHBACK_GRADE_CHANGE_LIMIT_MAX),
  turnPenalty: Math.min(options.turnPenalty, ROAD_SWITCHBACK_TURN_PENALTY),
  diagonalPenalty: Math.min(options.diagonalPenalty, ROAD_SWITCHBACK_DIAGONAL_PENALTY)
});

const toPoint = (idx: number, cols: number): Point => ({ x: idx % cols, y: Math.floor(idx / cols) });

const getElevationAt = (state: WorldState, x: number, y: number, fallback: number): number => {
  if (!inBounds(state.grid, x, y)) {
    return fallback;
  }
  return state.tiles[indexFor(state.grid, x, y)]?.elevation ?? fallback;
};

const getRoadGradeScale = (state: WorldState, heightScaleMultiplier: number): number =>
  getTerrainHeightScale(state.grid.cols, state.grid.rows, heightScaleMultiplier);

const computeStepSignedGrade = (
  fromElevation: number,
  toElevation: number,
  runCost: number,
  elevationToGradeScale = 1
): number => ((toElevation - fromElevation) * elevationToGradeScale) / Math.max(1, runCost);

const computeCrossfallAtStep = (
  state: WorldState,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  fromElevation: number,
  toElevation: number,
  elevationToGradeScale = 1
): number => {
  const dx = Math.sign(toX - fromX);
  const dy = Math.sign(toY - fromY);
  if (dx === 0 && dy === 0) {
    return 0;
  }
  const perpX = -dy;
  const perpY = dx;
  const centerElevation = (fromElevation + toElevation) * 0.5;
  const leftA = getElevationAt(state, fromX + perpX, fromY + perpY, centerElevation);
  const leftB = getElevationAt(state, toX + perpX, toY + perpY, centerElevation);
  const rightA = getElevationAt(state, fromX - perpX, fromY - perpY, centerElevation);
  const rightB = getElevationAt(state, toX - perpX, toY - perpY, centerElevation);
  const leftElevation = (leftA + leftB) * 0.5;
  const rightElevation = (rightA + rightB) * 0.5;
  return Math.abs(leftElevation - rightElevation) * 0.5 * elevationToGradeScale;
};

const getRoadEdgeMaskAtIndex = (state: WorldState, idx: number): number => {
  const cols = state.grid.cols;
  const x = idx % cols;
  const y = Math.floor(idx / cols);
  let mask = state.tileRoadEdges[idx] ?? 0;
  if (mask !== 0) {
    let sanitized = 0;
    for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
      const dir = ROAD_EDGE_DIRS[i];
      if ((mask & dir.bit) === 0) {
        continue;
      }
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const neighborIdx = indexFor(state.grid, nx, ny);
      if (isRoadLikeIndex(state, neighborIdx)) {
        sanitized |= dir.bit;
      }
    }
    if (sanitized !== 0) {
      return sanitized;
    }
  }
  mask = 0;
  for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
    const dir = ROAD_EDGE_DIRS[i];
    const nx = x + dir.dx;
    const ny = y + dir.dy;
    if (!inBounds(state.grid, nx, ny)) {
      continue;
    }
    const neighborIdx = indexFor(state.grid, nx, ny);
    if (isRoadLikeIndex(state, neighborIdx)) {
      mask |= dir.bit;
    }
  }
  return mask;
};

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

const ensureRoadEdgeBuffer = (state: WorldState): void => {
  if (state.tileRoadEdges.length !== state.grid.totalTiles) {
    state.tileRoadEdges = new Uint8Array(state.grid.totalTiles);
  }
};

export const clearRoadEdges = (state: WorldState): void => {
  ensureRoadEdgeBuffer(state);
  state.tileRoadEdges.fill(0);
};

export const getRoadEdgeMaskAt = (state: WorldState, x: number, y: number): number => {
  if (!inBounds(state.grid, x, y)) {
    return 0;
  }
  ensureRoadEdgeBuffer(state);
  return state.tileRoadEdges[indexFor(state.grid, x, y)] ?? 0;
};

const setRoadEdgeMaskAtIndex = (state: WorldState, idx: number, mask: number): void => {
  ensureRoadEdgeBuffer(state);
  state.tileRoadEdges[idx] = mask & 0xff;
};

const setRoadEdgeBitAtIndex = (state: WorldState, idx: number, bit: number): void => {
  ensureRoadEdgeBuffer(state);
  state.tileRoadEdges[idx] |= bit;
};

const clearRoadEdgeBitAtIndex = (state: WorldState, idx: number, bit: number): void => {
  ensureRoadEdgeBuffer(state);
  state.tileRoadEdges[idx] &= ~bit;
};

export const clearRoadEdgesAt = (state: WorldState, x: number, y: number): void => {
  if (!inBounds(state.grid, x, y)) {
    return;
  }
  const idx = indexFor(state.grid, x, y);
  setRoadEdgeMaskAtIndex(state, idx, 0);
};

export const connectRoadPoints = (
  state: WorldState,
  ax: number,
  ay: number,
  bx: number,
  by: number
): boolean => {
  if (!inBounds(state.grid, ax, ay) || !inBounds(state.grid, bx, by)) {
    return false;
  }
  if (ax === bx && ay === by) {
    return false;
  }
  if (!isRoadLikeTile(state, ax, ay) || !isRoadLikeTile(state, bx, by)) {
    return false;
  }
  const dx = bx - ax;
  const dy = by - ay;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
    return false;
  }
  const dir = getRoadEdgeDir(dx, dy);
  if (!dir) {
    return false;
  }
  const aIdx = indexFor(state.grid, ax, ay);
  const bIdx = indexFor(state.grid, bx, by);
  setRoadEdgeBitAtIndex(state, aIdx, dir.bit);
  setRoadEdgeBitAtIndex(state, bIdx, dir.opposite);
  return true;
};

export const disconnectRoadPoints = (
  state: WorldState,
  ax: number,
  ay: number,
  bx: number,
  by: number
): boolean => {
  if (!inBounds(state.grid, ax, ay) || !inBounds(state.grid, bx, by)) {
    return false;
  }
  const dx = bx - ax;
  const dy = by - ay;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
    return false;
  }
  const dir = getRoadEdgeDir(dx, dy);
  if (!dir) {
    return false;
  }
  const aIdx = indexFor(state.grid, ax, ay);
  const bIdx = indexFor(state.grid, bx, by);
  clearRoadEdgeBitAtIndex(state, aIdx, dir.bit);
  clearRoadEdgeBitAtIndex(state, bIdx, dir.opposite);
  return true;
};

const hasCardinalLinkPair = (
  state: WorldState,
  x: number,
  y: number,
  dx: number,
  dy: number
): boolean => {
  const mx1 = x + dx;
  const my1 = y;
  const mx2 = x;
  const my2 = y + dy;
  const tx = x + dx;
  const ty = y + dy;
  const hasPathA =
    isRoadLikeTile(state, mx1, my1) &&
    isRoadLikeTile(state, tx, ty) &&
    (getRoadEdgeMaskAt(state, x, y) & (dx > 0 ? ROAD_EDGE_E : ROAD_EDGE_W)) > 0 &&
    (getRoadEdgeMaskAt(state, mx1, my1) & (dx > 0 ? ROAD_EDGE_W : ROAD_EDGE_E)) > 0 &&
    (getRoadEdgeMaskAt(state, mx1, my1) & (dy > 0 ? ROAD_EDGE_S : ROAD_EDGE_N)) > 0 &&
    (getRoadEdgeMaskAt(state, tx, ty) & (dy > 0 ? ROAD_EDGE_N : ROAD_EDGE_S)) > 0;
  const hasPathB =
    isRoadLikeTile(state, mx2, my2) &&
    isRoadLikeTile(state, tx, ty) &&
    (getRoadEdgeMaskAt(state, x, y) & (dy > 0 ? ROAD_EDGE_S : ROAD_EDGE_N)) > 0 &&
    (getRoadEdgeMaskAt(state, mx2, my2) & (dy > 0 ? ROAD_EDGE_N : ROAD_EDGE_S)) > 0 &&
    (getRoadEdgeMaskAt(state, mx2, my2) & (dx > 0 ? ROAD_EDGE_E : ROAD_EDGE_W)) > 0 &&
    (getRoadEdgeMaskAt(state, tx, ty) & (dx > 0 ? ROAD_EDGE_W : ROAD_EDGE_E)) > 0;
  return hasPathA || hasPathB;
};

export const pruneRoadDiagonalStubs = (state: WorldState): void => {
  ensureRoadEdgeBuffer(state);
  const removals: Array<{ ax: number; ay: number; bx: number; by: number }> = [];
  const { cols, rows } = state.grid;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (!isRoadLikeTile(state, x, y)) {
        continue;
      }
      const mask = getRoadEdgeMaskAt(state, x, y);
      for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
        const dir = ROAD_EDGE_DIRS[i];
        if (!dir.diagonal || (mask & dir.bit) === 0) {
          continue;
        }
        const nx = x + dir.dx;
        const ny = y + dir.dy;
        if (!inBounds(state.grid, nx, ny) || !isRoadLikeTile(state, nx, ny)) {
          removals.push({ ax: x, ay: y, bx: nx, by: ny });
          continue;
        }
        if (hasCardinalLinkPair(state, x, y, dir.dx, dir.dy)) {
          removals.push({ ax: x, ay: y, bx: nx, by: ny });
        }
      }
    }
  }
  for (let i = 0; i < removals.length; i += 1) {
    const edge = removals[i];
    disconnectRoadPoints(state, edge.ax, edge.ay, edge.bx, edge.by);
  }
};

export const backfillRoadEdgesFromAdjacency = (state: WorldState): void => {
  ensureRoadEdgeBuffer(state);
  const { cols, rows } = state.grid;
  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    if (!isRoadLikeIndex(state, idx)) {
      setRoadEdgeMaskAtIndex(state, idx, 0);
      continue;
    }
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    let sanitized = 0;
    for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
      const dir = ROAD_EDGE_DIRS[i];
      if ((state.tileRoadEdges[idx] & dir.bit) === 0) {
        continue;
      }
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (isRoadLikeTile(state, nx, ny)) {
        sanitized |= dir.bit;
      }
    }
    setRoadEdgeMaskAtIndex(state, idx, sanitized);
  }
  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    if (!isRoadLikeIndex(state, idx) || state.tileRoadEdges[idx] === 0) {
      continue;
    }
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
      const dir = ROAD_EDGE_DIRS[i];
      if ((state.tileRoadEdges[idx] & dir.bit) === 0) {
        continue;
      }
      connectRoadPoints(state, x, y, x + dir.dx, y + dir.dy);
    }
  }
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (!isRoadLikeTile(state, x, y)) {
        continue;
      }
      const idx = indexFor(state.grid, x, y);
      if (state.tileRoadEdges[idx] !== 0) {
        continue;
      }
      for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
        const dir = ROAD_EDGE_DIRS[i];
        const nx = x + dir.dx;
        const ny = y + dir.dy;
        if (isRoadLikeTile(state, nx, ny)) {
          connectRoadPoints(state, x, y, nx, ny);
        }
      }
    }
  }
};

export const backfillRoadEdgesInBounds = (
  state: WorldState,
  bounds: RoadTileBounds,
  padding = 1
): void => {
  ensureRoadEdgeBuffer(state);
  const clipped = expandRoadTileBounds(state, bounds, padding);
  const { cols } = state.grid;
  for (let y = clipped.minY; y <= clipped.maxY; y += 1) {
    for (let x = clipped.minX; x <= clipped.maxX; x += 1) {
      const idx = y * cols + x;
      if (!isRoadLikeIndex(state, idx)) {
        setRoadEdgeMaskAtIndex(state, idx, 0);
        continue;
      }
      let sanitized = 0;
      for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
        const dir = ROAD_EDGE_DIRS[i]!;
        if ((state.tileRoadEdges[idx] & dir.bit) === 0) {
          continue;
        }
        const nx = x + dir.dx;
        const ny = y + dir.dy;
        if (isRoadLikeTile(state, nx, ny)) {
          sanitized |= dir.bit;
        }
      }
      setRoadEdgeMaskAtIndex(state, idx, sanitized);
    }
  }
  for (let y = clipped.minY; y <= clipped.maxY; y += 1) {
    for (let x = clipped.minX; x <= clipped.maxX; x += 1) {
      const idx = y * cols + x;
      if (!isRoadLikeIndex(state, idx) || state.tileRoadEdges[idx] === 0) {
        continue;
      }
      for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
        const dir = ROAD_EDGE_DIRS[i]!;
        if ((state.tileRoadEdges[idx] & dir.bit) === 0) {
          continue;
        }
        connectRoadPoints(state, x, y, x + dir.dx, y + dir.dy);
      }
    }
  }
  for (let y = clipped.minY; y <= clipped.maxY; y += 1) {
    for (let x = clipped.minX; x <= clipped.maxX; x += 1) {
      if (!isRoadLikeTile(state, x, y)) {
        continue;
      }
      const idx = indexFor(state.grid, x, y);
      if (state.tileRoadEdges[idx] !== 0) {
        continue;
      }
      for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
        const dir = ROAD_EDGE_DIRS[i]!;
        const nx = x + dir.dx;
        const ny = y + dir.dy;
        if (isRoadLikeTile(state, nx, ny)) {
          connectRoadPoints(state, x, y, nx, ny);
        }
      }
    }
  }
};

export const collectConnectedRoadNeighbors = (state: WorldState, x: number, y: number): Point[] => {
  if (!isRoadLikeTile(state, x, y)) {
    return [];
  }
  ensureRoadEdgeBuffer(state);
  const mask = state.tileRoadEdges[indexFor(state.grid, x, y)] ?? 0;
  const neighbors: Point[] = [];
  for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
    const dir = ROAD_EDGE_DIRS[i];
    if ((mask & dir.bit) === 0) {
      continue;
    }
    const nx = x + dir.dx;
    const ny = y + dir.dy;
    if (isRoadLikeTile(state, nx, ny)) {
      neighbors.push({ x: nx, y: ny });
    }
  }
  return neighbors;
};

export const analyzeRoadEdgeQuality = (
  state: WorldState
): {
  roadCount: number;
  ignoredDiagonalCount: number;
  unmatchedPatternCount: number;
  nodeDegreeHistogram: Record<string, number>;
} => {
  ensureRoadEdgeBuffer(state);
  const { cols, rows } = state.grid;
  let roadCount = 0;
  let ignoredDiagonalCount = 0;
  let unmatchedPatternCount = 0;
  const degreeHistogram = new Map<number, number>();
  const classifyPattern = (orth: number, diag: number, orthMask: number): string => {
    if (orth === 0 && diag === 0) {
      return "isolated";
    }
    if (orth === 0) {
      return diag === 1 ? "endcap_diagonal" : "diag_only";
    }
    if (diag === 0) {
      if (orth === 1) {
        return "endcap_cardinal";
      }
      if (orth === 2) {
        const oppositeNS = (orthMask & (ROAD_EDGE_N | ROAD_EDGE_S)) === (ROAD_EDGE_N | ROAD_EDGE_S);
        const oppositeEW = (orthMask & (ROAD_EDGE_E | ROAD_EDGE_W)) === (ROAD_EDGE_E | ROAD_EDGE_W);
        return oppositeNS || oppositeEW ? "straight" : "corner";
      }
      if (orth === 3) {
        return "tee";
      }
      return "cross";
    }
    if (orth === 1) {
      return "o1d";
    }
    if (orth === 2 && diag === 1) {
      return "o2d1";
    }
    if (orth === 2 && diag >= 2) {
      return "o2d2plus";
    }
    if (orth === 3 && diag === 1) {
      return "o3d1";
    }
    if (orth >= 3 && diag >= 2) {
      return "hub_dense";
    }
    return "mixed_dense";
  };
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (!isRoadLikeTile(state, x, y)) {
        continue;
      }
      roadCount += 1;
      const mask = getRoadEdgeMaskAt(state, x, y);
      const orth =
        Number((mask & ROAD_EDGE_N) > 0) +
        Number((mask & ROAD_EDGE_E) > 0) +
        Number((mask & ROAD_EDGE_S) > 0) +
        Number((mask & ROAD_EDGE_W) > 0);
      const diag =
        Number((mask & ROAD_EDGE_NE) > 0) +
        Number((mask & ROAD_EDGE_NW) > 0) +
        Number((mask & ROAD_EDGE_SE) > 0) +
        Number((mask & ROAD_EDGE_SW) > 0);
      const family = classifyPattern(orth, diag, mask & ROAD_EDGE_CARDINAL_MASK);
      const mixedHandled =
        family === "o1d" ||
        family === "o2d1" ||
        family === "o2d2plus" ||
        family === "o3d1" ||
        family === "hub_dense" ||
        family === "mixed_dense";
      if (orth >= 2 && diag > 0 && !mixedHandled) {
        ignoredDiagonalCount += 1;
      }
      if (family === "mixed_unknown") {
        unmatchedPatternCount += 1;
      }
      const degree = orth + diag;
      degreeHistogram.set(degree, (degreeHistogram.get(degree) ?? 0) + 1);
    }
  }
  const nodeDegreeHistogram: Record<string, number> = {};
  degreeHistogram.forEach((count, degree) => {
    nodeDegreeHistogram[String(degree)] = count;
  });
  return {
    roadCount,
    ignoredDiagonalCount,
    unmatchedPatternCount,
    nodeDegreeHistogram
  };
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
    clearVegetationState(tile);
    tile.dominantTreeType = null;
    tile.treeType = null;
    tile.ashAge = 0;
    applyFuel(tile, tile.moisture, rng);
    return;
  }
  state.tileRoadBridge[idx] = 0;
  tile.type = "road";
  clearVegetationState(tile);
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
  riverDistance: Int16Array,
  options: RoadPathOptionsResolved
): RoadPathResult => {
  const path = pathIndices.map((idx) => toPoint(idx, state.grid.cols));
  const elevationToGradeScale = getRoadGradeScale(state, options.heightScaleMultiplier);
  const bridgeTileIndices: number[] = [];
  let maxGrade = 0;
  let maxCrossfall = 0;
  let maxGradeChange = 0;
  let minRiverClearance = Number.POSITIVE_INFINITY;
  let bridgeSegments = 0;
  let inBridge = false;
  let prevSignedGrade: number | null = null;

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
      prevSignedGrade = null;
      continue;
    }
    const point = path[i];
    const prevPoint = path[i - 1];
    const runCost = Math.hypot(point.x - prevPoint.x, point.y - prevPoint.y);
    const signedGrade = computeStepSignedGrade(prevTile.elevation, tile.elevation, runCost, elevationToGradeScale);
    const grade = Math.abs(signedGrade);
    if (grade > maxGrade) {
      maxGrade = grade;
    }
    const crossfall = computeCrossfallAtStep(
      state,
      prevPoint.x,
      prevPoint.y,
      point.x,
      point.y,
      prevTile.elevation,
      tile.elevation,
      elevationToGradeScale
    );
    if (crossfall > maxCrossfall) {
      maxCrossfall = crossfall;
    }
    if (prevSignedGrade !== null) {
      const gradeChange = Math.abs(signedGrade - prevSignedGrade);
      if (gradeChange > maxGradeChange) {
        maxGradeChange = gradeChange;
      }
    }
    prevSignedGrade = signedGrade;
  }

  return {
    path,
    bridgeTileIndices,
    maxGrade,
    maxCrossfall,
    maxGradeChange,
    minRiverClearance,
    bridgeSegments
  };
};

const recordPathStats = (result: RoadPathResult): void => {
  roadGenerationStats.pathsFound += 1;
  roadGenerationStats.maxRealizedGrade = Math.max(roadGenerationStats.maxRealizedGrade, result.maxGrade);
  roadGenerationStats.maxRealizedCrossfall = Math.max(roadGenerationStats.maxRealizedCrossfall, result.maxCrossfall);
  roadGenerationStats.maxRealizedGradeChange = Math.max(
    roadGenerationStats.maxRealizedGradeChange,
    result.maxGradeChange
  );
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
  gradeLimit: number,
  crossfallLimit: number,
  gradeChangeLimit: number
): RoadPathResult | null => {
  if (!inBounds(state.grid, start.x, start.y)) {
    return null;
  }
  if (end && !inBounds(state.grid, end.x, end.y)) {
    return null;
  }
  const searchBounds = options.searchBounds ? expandRoadTileBounds(state, options.searchBounds, 0) : null;
  if (!isPointInRoadBounds(start, searchBounds) || (end && !isPointInRoadBounds(end, searchBounds))) {
    return null;
  }
  const total = state.grid.totalTiles;
  const cols = state.grid.cols;
  const startIdx = indexFor(state.grid, start.x, start.y);
  const endIdx = end ? indexFor(state.grid, end.x, end.y) : -1;
  const riverDistance = getRiverDistanceField(state);
  const elevationToGradeScale = getRoadGradeScale(state, options.heightScaleMultiplier);

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
      maxCrossfall: 0,
      maxGradeChange: 0,
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
  const signedGradeAt = new Float32Array(total);
  const crossfallAt = new Float32Array(total);
  const openIdx: number[] = [];
  const openF: number[] = [];

  const estimate = (x: number, y: number): number => {
    if (!end) {
      return 0;
    }
    const dx = Math.abs(x - end.x);
    const dy = Math.abs(y - end.y);
    const diagonal = Math.min(dx, dy);
    const octile = dx + dy + (Math.SQRT2 - 2) * diagonal;
    return octile * Math.min(1, ROAD_EXISTING_SEGMENT_COST_MULTIPLIER);
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
      if (
        searchBounds &&
        (nx < searchBounds.minX || nx > searchBounds.maxX || ny < searchBounds.minY || ny > searchBounds.maxY)
      ) {
        continue;
      }
      const nIdx = indexFor(state.grid, nx, ny);
      if (closed[nIdx]) {
        continue;
      }
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

      let signedGrade = 0;
      let grade = 0;
      let crossfall = 0;
      let gradeChange = 0;
      const hasPreviousLandStep =
        prev[currentIdx] !== currentIdx &&
        currentIsWater === false &&
        state.tiles[prev[currentIdx]]?.type !== "water";
      if (!currentIsWater && !nextIsWater) {
        signedGrade = computeStepSignedGrade(currentTile.elevation, nextTile.elevation, dir.cost, elevationToGradeScale);
        grade = Math.abs(signedGrade);
        if (grade > gradeLimit) {
          continue;
        }
        crossfall = computeCrossfallAtStep(
          state,
          cx,
          cy,
          nx,
          ny,
          currentTile.elevation,
          nextTile.elevation,
          elevationToGradeScale
        );
        if (crossfall > crossfallLimit) {
          continue;
        }
        if (hasPreviousLandStep) {
          gradeChange = Math.abs(signedGrade - signedGradeAt[currentIdx]);
          if (gradeChange > gradeChangeLimit) {
            continue;
          }
        }
      }

      let stepCost = dir.cost;
      if (dir.x !== 0 && dir.y !== 0) {
        stepCost += options.diagonalPenalty;
      }
      if (!currentIsWater && !nextIsWater) {
        stepCost += grade * options.slopePenaltyWeight;
        stepCost += crossfall * options.crossfallPenaltyWeight;
        stepCost += gradeChange * options.gradeChangePenaltyWeight;
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
      if (isRoadLikeIndex(state, nIdx)) {
        stepCost *= ROAD_EXISTING_SEGMENT_COST_MULTIPLIER;
      }
      if (prev[currentIdx] !== currentIdx && (stepDx[currentIdx] !== dir.x || stepDy[currentIdx] !== dir.y)) {
        let turnPenalty = options.turnPenalty;
        if (!currentIsWater && !nextIsWater && hasPreviousLandStep) {
          const previousSeverity = Math.max(Math.abs(signedGradeAt[currentIdx]), crossfallAt[currentIdx]);
          const nextSeverity = Math.max(grade, crossfall);
          if (nextSeverity < previousSeverity) {
            const relief = Math.min(0.85, (previousSeverity - nextSeverity) * ROAD_SWITCHBACK_RELIEF_WEIGHT);
            turnPenalty *= 1 - relief;
          }
        }
        stepCost += turnPenalty;
      }

      const nextG = currentG + stepCost;
      const equalCost = Math.abs(nextG - gScore[nIdx]) <= 1e-7;
      const betterWaterUsage = nextWaterUsed < waterTilesUsed[nIdx];
      const nextSlopeState = grade + crossfall + gradeChange;
      const currentSlopeState = Math.abs(signedGradeAt[nIdx]) + crossfallAt[nIdx];
      if (nextG > gScore[nIdx] + 1e-7 && !betterWaterUsage) {
        continue;
      }
      if (equalCost && !betterWaterUsage && nextSlopeState >= currentSlopeState - 1e-6) {
        continue;
      }

      gScore[nIdx] = nextG;
      prev[nIdx] = currentIdx;
      waterTilesUsed[nIdx] = nextWaterUsed;
      consecutiveWater[nIdx] = nextConsecutiveWater;
      stepDx[nIdx] = dir.x;
      stepDy[nIdx] = dir.y;
      signedGradeAt[nIdx] = signedGrade;
      crossfallAt[nIdx] = crossfall;
      heapPush(openIdx, openF, nIdx, nextG + estimate(nx, ny));
    }
  }

  if (goalIdx < 0) {
    return null;
  }

  const pathIndices: number[] = [];
  let current = goalIdx;
  const pathGuard = new Uint8Array(total);
  while (current !== startIdx) {
    if (pathGuard[current] > 0) {
      return null;
    }
    pathGuard[current] = 1;
    pathIndices.push(current);
    current = prev[current];
    if (current < 0) {
      return null;
    }
  }
  pathIndices.push(startIdx);
  pathIndices.reverse();
  return buildPathResult(state, pathIndices, riverDistance, options);
};

const findPathWithGradeRelaxation = (
  state: WorldState,
  start: Point,
  end: Point | null,
  isTarget: ((x: number, y: number) => boolean) | null,
  options: RoadPathOptionsResolved,
  allowBridge: boolean
): RoadPathResult | null => {
  const tryOptions = (candidate: RoadPathOptionsResolved): RoadPathResult | null => {
    let gradeLimit = candidate.gradeLimitStart;
    let crossfallLimit = candidate.crossfallLimitStart;
    let gradeChangeLimit = candidate.gradeChangeLimitStart;
    while (true) {
      const result = runAStar(
        state,
        start,
        end,
        isTarget,
        candidate,
        allowBridge,
        gradeLimit,
        crossfallLimit,
        gradeChangeLimit
      );
      if (result) {
        return result;
      }
      const atMaxGrade = gradeLimit >= candidate.gradeLimitMax - 1e-9;
      const atMaxCrossfall = crossfallLimit >= candidate.crossfallLimitMax - 1e-9;
      const atMaxGradeChange = gradeChangeLimit >= candidate.gradeChangeLimitMax - 1e-9;
      if (atMaxGrade && atMaxCrossfall && atMaxGradeChange) {
        return null;
      }
      gradeLimit += candidate.gradeLimitRelaxStep;
      crossfallLimit += candidate.crossfallLimitRelaxStep;
      gradeChangeLimit += candidate.gradeChangeLimitRelaxStep;
      gradeLimit = Math.min(candidate.gradeLimitMax, gradeLimit);
      crossfallLimit = Math.min(candidate.crossfallLimitMax, crossfallLimit);
      gradeChangeLimit = Math.min(candidate.gradeChangeLimitMax, gradeChangeLimit);
    }
  };

  const standard = tryOptions(options);
  if (standard) {
    return standard;
  }
  return tryOptions(buildSwitchbackFallbackOptions(options));
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
      maxCrossfall: 0,
      maxGradeChange: 0,
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
      maxCrossfall: 0,
      maxGradeChange: 0,
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

export function carveRoadToTarget(
  state: WorldState,
  rng: RNG,
  start: Point,
  isTarget: (x: number, y: number) => boolean,
  options: RoadCarveOptions = {}
): Point | null {
  const bridgePolicy =
    options.bridgePolicy ?? (typeof options.allowBridge === "boolean" ? (options.allowBridge ? "allow" : "never") : "allow");
  const result = findRoadPathToTargetDetailed(state, start, isTarget, { ...options, bridgePolicy });
  if (result.path.length === 0) {
    return null;
  }
  const bridgeSet = new Set<number>(result.bridgeTileIndices);
  carveRoadPath(state, rng, result.path, { allowBridgeIndices: bridgeSet });
  return result.path[result.path.length - 1] ?? null;
}

export function carveRoadPath(
  state: WorldState,
  rng: RNG,
  path: Point[],
  options: {
    allowBridgeIndices?: Set<number>;
    allowBridgeByPoint?: (point: Point) => boolean;
  } = {}
): boolean {
  if (path.length === 0) {
    return false;
  }
  for (let i = 0; i < path.length; i += 1) {
    const point = path[i];
    const idx = indexFor(state.grid, point.x, point.y);
    const allowBridge =
      options.allowBridgeIndices?.has(idx) ?? options.allowBridgeByPoint?.(point) ?? false;
    setRoadAt(state, rng, point.x, point.y, { allowBridge });
  }
  for (let i = 1; i < path.length; i += 1) {
    const prev = path[i - 1];
    const next = path[i];
    connectRoadPoints(state, prev.x, prev.y, next.x, next.y);
  }
  return true;
}

export function carveRoad(state: WorldState, rng: RNG, start: Point, end: Point, options: RoadCarveOptions = {}): boolean {
  return carveRoadDetailed(state, rng, start, end, options).carved;
}

export function carveRoadDetailed(
  state: WorldState,
  rng: RNG,
  start: Point,
  end: Point,
  options: RoadCarveOptions = {}
): RoadCarveResult {
  const bridgePolicy =
    options.bridgePolicy ?? (typeof options.allowBridge === "boolean" ? (options.allowBridge ? "allow" : "never") : "allow");
  const result = findRoadPathDetailed(state, start, end, { ...options, bridgePolicy });
  if (result.path.length === 0) {
    return {
      carved: false,
      bounds: null,
      pathLength: 0
    };
  }
  const bridgeSet = new Set<number>(result.bridgeTileIndices);
  const carved = carveRoadPath(state, rng, result.path, { allowBridgeIndices: bridgeSet });
  return {
    carved,
    bounds: carved ? getPathBounds(result.path) : null,
    pathLength: carved ? result.path.length : 0
  };
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
  let best: Point | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      if (!isRoadLikeTile(state, x, y)) {
        continue;
      }
      const idx = indexFor(state.grid, x, y);
      if (state.structureMask[idx] > 0 || state.tiles[idx]?.type === "house") {
        continue;
      }
      const dist = Math.abs(origin.x - x) + Math.abs(origin.y - y);
      if (dist < bestDist) {
        bestDist = dist;
        best = { x, y };
      }
    }
  }
  if (best) {
    return best;
  }

  let fallback = state.basePoint;
  bestDist = Number.POSITIVE_INFINITY;
  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = indexFor(state.grid, x, y);
      const tile = state.tiles[idx];
      if (!tile || tile.type === "water" || state.structureMask[idx] > 0) {
        continue;
      }
      const dist = Math.abs(origin.x - x) + Math.abs(origin.y - y);
      if (dist < bestDist) {
        bestDist = dist;
        fallback = { x, y };
      }
    }
  }
  return fallback;
}

export const analyzeRoadSurfaceMetrics = (state: WorldState, heightScaleMultiplier = 1): RoadSurfaceMetrics => {
  const total = state.grid.totalTiles;
  const cols = state.grid.cols;
  const elevationToGradeScale = getRoadGradeScale(state, heightScaleMultiplier);
  let maxRoadGrade = 0;
  let maxRoadCrossfall = 0;
  let maxRoadGradeChange = 0;
  let wallEdgeCount = 0;

  for (let idx = 0; idx < total; idx += 1) {
    const wallMask = state.tileRoadWallEdges[idx] ?? 0;
    if (wallMask !== 0) {
      for (let bit = wallMask; bit !== 0; bit &= bit - 1) {
        wallEdgeCount += 1;
      }
    }
    if (!isRoadLikeIndex(state, idx) || state.tiles[idx]?.type === "water") {
      continue;
    }
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    const mask = getRoadEdgeMaskAtIndex(state, idx);
    const connectedSignedGrades: number[] = [];
    for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
      const dir = ROAD_EDGE_DIRS[i];
      if ((mask & dir.bit) === 0) {
        continue;
      }
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const neighborIdx = indexFor(state.grid, nx, ny);
      if (!isRoadLikeIndex(state, neighborIdx) || state.tiles[neighborIdx]?.type === "water") {
        continue;
      }
      const signedGrade = computeStepSignedGrade(
        state.tiles[idx].elevation,
        state.tiles[neighborIdx].elevation,
        Math.hypot(dir.dx, dir.dy),
        elevationToGradeScale
      );
      connectedSignedGrades.push(signedGrade);
      if (neighborIdx > idx) {
        maxRoadGrade = Math.max(maxRoadGrade, Math.abs(signedGrade));
        maxRoadCrossfall = Math.max(
          maxRoadCrossfall,
          computeCrossfallAtStep(
            state,
            x,
            y,
            nx,
            ny,
            state.tiles[idx].elevation,
            state.tiles[neighborIdx].elevation,
            elevationToGradeScale
          )
        );
      }
    }
    if (connectedSignedGrades.length >= 2) {
      for (let i = 0; i < connectedSignedGrades.length; i += 1) {
        for (let j = i + 1; j < connectedSignedGrades.length; j += 1) {
          maxRoadGradeChange = Math.max(
            maxRoadGradeChange,
            Math.abs(connectedSignedGrades[i] - connectedSignedGrades[j])
          );
        }
      }
    }
  }

  return {
    maxRoadGrade,
    maxRoadCrossfall,
    maxRoadGradeChange,
    wallEdgeCount
  };
};

export const resetRoadGenerationStats = (): void => {
  roadGenerationStats.pathsAttempted = 0;
  roadGenerationStats.pathsFound = 0;
  roadGenerationStats.maxRealizedGrade = 0;
  roadGenerationStats.maxRealizedCrossfall = 0;
  roadGenerationStats.maxRealizedGradeChange = 0;
  roadGenerationStats.minRiverClearance = Number.POSITIVE_INFINITY;
  roadGenerationStats.bridgeSegments = 0;
};

export const getRoadGenerationStats = (): RoadGenerationStats => ({
  pathsAttempted: roadGenerationStats.pathsAttempted,
  pathsFound: roadGenerationStats.pathsFound,
  maxRealizedGrade: roadGenerationStats.maxRealizedGrade,
  maxRealizedCrossfall: roadGenerationStats.maxRealizedCrossfall,
  maxRealizedGradeChange: roadGenerationStats.maxRealizedGradeChange,
  minRiverClearance: roadGenerationStats.minRiverClearance,
  bridgeSegments: roadGenerationStats.bridgeSegments
});
