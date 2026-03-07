import type { Point } from "../core/types.js";
import type { WorldState } from "../core/state.js";
import { MOVE_DOWNHILL_FACTOR, MOVE_SLOPE_MAX, MOVE_SLOPE_MIN, MOVE_TERRAIN_COST, MOVE_UPHILL_FACTOR } from "../core/config.js";
import { inBounds, indexFor } from "../core/grid.js";
import { clamp } from "../core/utils.js";
import { profEnd, profStart } from "./prof.js";

type MoveDir = { x: number; y: number; cost: number };

const ROAD_EDGE_N = 1 << 0;
const ROAD_EDGE_E = 1 << 1;
const ROAD_EDGE_S = 1 << 2;
const ROAD_EDGE_W = 1 << 3;
const ROAD_EDGE_NE = 1 << 4;
const ROAD_EDGE_NW = 1 << 5;
const ROAD_EDGE_SE = 1 << 6;
const ROAD_EDGE_SW = 1 << 7;

const MOVE_DIRS: MoveDir[] = [
  { x: 1, y: 0, cost: 1 },
  { x: -1, y: 0, cost: 1 },
  { x: 0, y: 1, cost: 1 },
  { x: 0, y: -1, cost: 1 },
  { x: 1, y: 1, cost: Math.SQRT2 },
  { x: -1, y: 1, cost: Math.SQRT2 },
  { x: 1, y: -1, cost: Math.SQRT2 },
  { x: -1, y: -1, cost: Math.SQRT2 }
];

const getTerrainCost = (state: WorldState, idx: number): number => {
  if (state.tiles[idx].type === "water" && state.tileRoadBridge[idx] > 0) {
    return MOVE_TERRAIN_COST.road;
  }
  return MOVE_TERRAIN_COST[state.tiles[idx].type] ?? 1;
};

const isBridgeTile = (state: WorldState, idx: number): boolean =>
  state.tiles[idx].type === "water" && state.tileRoadBridge[idx] > 0;

const isRoadLikeTile = (state: WorldState, idx: number): boolean => {
  const type = state.tiles[idx].type;
  return type === "road" || type === "base" || isBridgeTile(state, idx);
};

const getRoadEdgeBit = (dx: number, dy: number): number => {
  if (dx === 0 && dy < 0) {
    return ROAD_EDGE_N;
  }
  if (dx > 0 && dy === 0) {
    return ROAD_EDGE_E;
  }
  if (dx === 0 && dy > 0) {
    return ROAD_EDGE_S;
  }
  if (dx < 0 && dy === 0) {
    return ROAD_EDGE_W;
  }
  if (dx > 0 && dy < 0) {
    return ROAD_EDGE_NE;
  }
  if (dx < 0 && dy < 0) {
    return ROAD_EDGE_NW;
  }
  if (dx > 0 && dy > 0) {
    return ROAD_EDGE_SE;
  }
  if (dx < 0 && dy > 0) {
    return ROAD_EDGE_SW;
  }
  return 0;
};

const getOppositeRoadEdgeBit = (bit: number): number => {
  switch (bit) {
    case ROAD_EDGE_N:
      return ROAD_EDGE_S;
    case ROAD_EDGE_E:
      return ROAD_EDGE_W;
    case ROAD_EDGE_S:
      return ROAD_EDGE_N;
    case ROAD_EDGE_W:
      return ROAD_EDGE_E;
    case ROAD_EDGE_NE:
      return ROAD_EDGE_SW;
    case ROAD_EDGE_NW:
      return ROAD_EDGE_SE;
    case ROAD_EDGE_SE:
      return ROAD_EDGE_NW;
    case ROAD_EDGE_SW:
      return ROAD_EDGE_NE;
    default:
      return 0;
  }
};

const hasExplicitRoadConnection = (state: WorldState, fromIdx: number, toIdx: number, dx: number, dy: number): boolean => {
  if (!isRoadLikeTile(state, fromIdx) || !isRoadLikeTile(state, toIdx)) {
    return false;
  }
  const bit = getRoadEdgeBit(dx, dy);
  const opposite = getOppositeRoadEdgeBit(bit);
  if (bit === 0 || opposite === 0) {
    return false;
  }
  return (state.tileRoadEdges[fromIdx] & bit) !== 0 && (state.tileRoadEdges[toIdx] & opposite) !== 0;
};

const getSlopeFactor = (fromElev: number, toElev: number): number => {
  const delta = toElev - fromElev;
  const factor = delta >= 0 ? 1 + delta * MOVE_UPHILL_FACTOR : 1 + delta * MOVE_DOWNHILL_FACTOR;
  return clamp(factor, MOVE_SLOPE_MIN, MOVE_SLOPE_MAX);
};

export const getMoveSpeedMultiplier = (state: WorldState, fromX: number, fromY: number, toX: number, toY: number): number => {
  if (!inBounds(state.grid, fromX, fromY) || !inBounds(state.grid, toX, toY)) {
    return 1;
  }
  const fromIdx = indexFor(state.grid, fromX, fromY);
  const toIdx = indexFor(state.grid, toX, toY);
  const terrain = getTerrainCost(state, toIdx);
  const slope = isBridgeTile(state, fromIdx) || isBridgeTile(state, toIdx)
    ? 1
    : getSlopeFactor(state.tiles[fromIdx].elevation, state.tiles[toIdx].elevation);
  return 1 / (terrain * slope);
};

const getMoveCost = (state: WorldState, fromX: number, fromY: number, toX: number, toY: number, baseCost: number): number => {
  const fromIdx = indexFor(state.grid, fromX, fromY);
  const toIdx = indexFor(state.grid, toX, toY);
  const terrain = getTerrainCost(state, toIdx);
  const slope = isBridgeTile(state, fromIdx) || isBridgeTile(state, toIdx)
    ? 1
    : getSlopeFactor(state.tiles[fromIdx].elevation, state.tiles[toIdx].elevation);
  return baseCost * terrain * slope;
};

export function isPassable(state: WorldState, x: number, y: number): boolean {
  if (!inBounds(state.grid, x, y)) {
    return false;
  }
  const idx = indexFor(state.grid, x, y);
  const type = state.tiles[idx].type;
  if ((type === "water" && state.tileRoadBridge[idx] === 0) || type === "house") {
    return false;
  }
  return state.structureMask[idx] === 0;
}

export function findPath(state: WorldState, start: Point, goal: Point): Point[] {
  const profStartAt = profStart();
  if (!inBounds(state.grid, goal.x, goal.y) || !isPassable(state, goal.x, goal.y)) {
    profEnd("findPath", profStartAt);
    return [];
  }
  if (!inBounds(state.grid, start.x, start.y) || !isPassable(state, start.x, start.y)) {
    profEnd("findPath", profStartAt);
    return [];
  }
  const startIdx = indexFor(state.grid, start.x, start.y);
  const goalIdx = indexFor(state.grid, goal.x, goal.y);
  if (startIdx === goalIdx) {
    profEnd("findPath", profStartAt);
    return [];
  }

  const total = state.grid.totalTiles;
  const prev = state.pathPrev;
  const gScore = state.pathGScore;
  const visit = state.pathVisitStamp;
  const closed = state.pathClosedStamp;
  let stamp = (state.pathStamp + 1) >>> 0;
  if (stamp === 0) {
    visit.fill(0);
    closed.fill(0);
    stamp = 1;
  }
  state.pathStamp = stamp;
  const openIdx = state.pathOpenIdx;
  const openF = state.pathOpenF;
  let openSize = 0;
  let nodesExpanded = 0;
  let maxOpen = 0;
  const epsilon = Math.max(1, state.simPerf.pathEpsilon || 1);
  const maxExpansions = Math.max(0, state.simPerf.pathMaxExpansions || 0);

  const heuristicScale = MOVE_SLOPE_MIN;
  const estimate = (x: number, y: number) => {
    const dx = Math.abs(x - goal.x);
    const dy = Math.abs(y - goal.y);
    const diagonal = Math.min(dx, dy);
    return (dx + dy + (Math.SQRT2 - 2) * diagonal) * heuristicScale;
  };

  const heapPush = (idx: number, f: number): void => {
    if (openSize >= openIdx.length) {
      return;
    }
    let i = openSize;
    openIdx[i] = idx;
    openF[i] = f;
    openSize += 1;
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

  const heapPop = (): number => {
    if (openSize === 0) {
      return -1;
    }
    const result = openIdx[0];
    openSize -= 1;
    if (openSize > 0) {
      const idx = openIdx[openSize];
      const f = openF[openSize];
      let i = 0;
      while (true) {
        const left = i * 2 + 1;
        if (left >= openSize) {
          break;
        }
        const right = left + 1;
        let smallest = left;
        if (right < openSize && openF[right] < openF[left]) {
          smallest = right;
        }
        if (openF[smallest] >= f) {
          break;
        }
        openIdx[i] = openIdx[smallest];
        openF[i] = openF[smallest];
        i = smallest;
      }
      openIdx[i] = idx;
      openF[i] = f;
    }
    return result;
  };

  visit[startIdx] = stamp;
  gScore[startIdx] = 0;
  prev[startIdx] = startIdx;
  heapPush(startIdx, estimate(start.x, start.y) * epsilon);
  if (openSize > maxOpen) {
    maxOpen = openSize;
  }

  while (openSize > 0) {
    const currentIdx = heapPop();
    if (currentIdx < 0) {
      break;
    }
    if (closed[currentIdx] === stamp) {
      continue;
    }
    closed[currentIdx] = stamp;
    nodesExpanded += 1;
    if (currentIdx === goalIdx) {
      break;
    }
    if (maxExpansions > 0 && nodesExpanded >= maxExpansions) {
      break;
    }
    const cx = currentIdx % state.grid.cols;
    const cy = Math.floor(currentIdx / state.grid.cols);
    const currentScore = gScore[currentIdx];

    for (const dir of MOVE_DIRS) {
      const nx = cx + dir.x;
      const ny = cy + dir.y;
      if (!inBounds(state.grid, nx, ny) || !isPassable(state, nx, ny)) {
        continue;
      }
      const nIdx = indexFor(state.grid, nx, ny);
      if (dir.x !== 0 && dir.y !== 0) {
        const allowExplicitRoadDiagonal = hasExplicitRoadConnection(state, currentIdx, nIdx, dir.x, dir.y);
        if (!allowExplicitRoadDiagonal && (!isPassable(state, cx + dir.x, cy) || !isPassable(state, cx, cy + dir.y))) {
          continue;
        }
      }
      const stepCost = getMoveCost(state, cx, cy, nx, ny, dir.cost);
      const nextScore = currentScore + stepCost;
      if (visit[nIdx] === stamp && nextScore >= gScore[nIdx]) {
        continue;
      }
      visit[nIdx] = stamp;
      gScore[nIdx] = nextScore;
      prev[nIdx] = currentIdx;
      const f = nextScore + estimate(nx, ny) * epsilon;
      heapPush(nIdx, f);
      if (openSize > maxOpen) {
        maxOpen = openSize;
      }
    }
  }

  state.pathOpenSize = openSize;
  state.pathLastNodesExpanded = nodesExpanded;
  state.pathMaxOpenSize = Math.max(state.pathMaxOpenSize, maxOpen);
  state.pathNodesExpanded = state.pathNodesExpanded > 0 ? state.pathNodesExpanded * 0.8 + nodesExpanded * 0.2 : nodesExpanded;

  if (visit[goalIdx] !== stamp || prev[goalIdx] === -1) {
    profEnd("findPath", profStartAt);
    return [];
  }

  const path: Point[] = [];
  let current = goalIdx;
  let steps = 0;
  while (current !== startIdx) {
    if (steps > total) {
      console.warn("Path reconstruction aborted due to unexpected cycle.", { start, goal, total });
      profEnd("findPath", profStartAt);
      return [];
    }
    const px = current % state.grid.cols;
    const py = Math.floor(current / state.grid.cols);
    path.push({ x: px, y: py });
    current = prev[current];
    steps += 1;
  }
  path.reverse();
  profEnd("findPath", profStartAt);
  return path;
}

