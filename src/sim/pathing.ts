import type { Point } from "../core/types.js";
import type { WorldState } from "../core/state.js";
import { MOVE_DOWNHILL_FACTOR, MOVE_SLOPE_MAX, MOVE_SLOPE_MIN, MOVE_TERRAIN_COST, MOVE_UPHILL_FACTOR } from "../core/config.js";
import { inBounds, indexFor } from "../core/grid.js";
import { clamp } from "../core/utils.js";

type MoveDir = { x: number; y: number; cost: number };

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

const getTerrainCost = (state: WorldState, idx: number): number => MOVE_TERRAIN_COST[state.tiles[idx].type] ?? 1;

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
  const slope = getSlopeFactor(state.tiles[fromIdx].elevation, state.tiles[toIdx].elevation);
  return 1 / (terrain * slope);
};

const getMoveCost = (state: WorldState, fromX: number, fromY: number, toX: number, toY: number, baseCost: number): number => {
  const fromIdx = indexFor(state.grid, fromX, fromY);
  const toIdx = indexFor(state.grid, toX, toY);
  const terrain = getTerrainCost(state, toIdx);
  const slope = getSlopeFactor(state.tiles[fromIdx].elevation, state.tiles[toIdx].elevation);
  return baseCost * terrain * slope;
};

class MinHeap {
  private heap: { idx: number; f: number }[] = [];

  push(node: { idx: number; f: number }): void {
    this.heap.push(node);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): { idx: number; f: number } | null {
    if (this.heap.length === 0) {
      return null;
    }
    const top = this.heap[0];
    const end = this.heap.pop();
    if (end && this.heap.length > 0) {
      this.heap[0] = end;
      this.sinkDown(0);
    }
    return top;
  }

  get size(): number {
    return this.heap.length;
  }

  private bubbleUp(index: number): void {
    const node = this.heap[index];
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const parent = this.heap[parentIndex];
      if (node.f >= parent.f) {
        break;
      }
      this.heap[parentIndex] = node;
      this.heap[index] = parent;
      index = parentIndex;
    }
  }

  private sinkDown(index: number): void {
    const length = this.heap.length;
    const node = this.heap[index];
    while (true) {
      let swap = -1;
      const leftIndex = index * 2 + 1;
      const rightIndex = index * 2 + 2;

      if (leftIndex < length && this.heap[leftIndex].f < node.f) {
        swap = leftIndex;
      }
      if (
        rightIndex < length &&
        this.heap[rightIndex].f < (swap === -1 ? node.f : this.heap[leftIndex].f)
      ) {
        swap = rightIndex;
      }
      if (swap === -1) {
        break;
      }
      this.heap[index] = this.heap[swap];
      this.heap[swap] = node;
      index = swap;
    }
  }
}

export function isPassable(state: WorldState, x: number, y: number): boolean {
  if (!inBounds(state.grid, x, y)) {
    return false;
  }
  const idx = indexFor(state.grid, x, y);
  const type = state.tiles[idx].type;
  if (type === "water" || type === "house") {
    return false;
  }
  return state.structureMask[idx] === 0;
}

export function findPath(state: WorldState, start: Point, goal: Point): Point[] {
  if (!inBounds(state.grid, goal.x, goal.y) || !isPassable(state, goal.x, goal.y)) {
    return [];
  }
  if (!inBounds(state.grid, start.x, start.y) || !isPassable(state, start.x, start.y)) {
    return [];
  }
  const startIdx = indexFor(state.grid, start.x, start.y);
  const goalIdx = indexFor(state.grid, goal.x, goal.y);
  if (startIdx === goalIdx) {
    return [];
  }

  const total = state.grid.totalTiles;
  const prev = new Int32Array(total);
  prev.fill(-1);
  const gScore = new Float32Array(total);
  gScore.fill(Number.POSITIVE_INFINITY);

  const open = new MinHeap();
  gScore[startIdx] = 0;
  prev[startIdx] = startIdx;

  const heuristicScale = MOVE_SLOPE_MIN;
  const estimate = (x: number, y: number) => {
    const dx = Math.abs(x - goal.x);
    const dy = Math.abs(y - goal.y);
    const diagonal = Math.min(dx, dy);
    return (dx + dy + (Math.SQRT2 - 2) * diagonal) * heuristicScale;
  };

  open.push({ idx: startIdx, f: estimate(start.x, start.y) });

  while (open.size > 0) {
    const current = open.pop();
    if (!current) {
      break;
    }
    if (current.idx === goalIdx) {
      break;
    }
    const cx = current.idx % state.grid.cols;
    const cy = Math.floor(current.idx / state.grid.cols);
    const currentScore = gScore[current.idx];

    for (const dir of MOVE_DIRS) {
      const nx = cx + dir.x;
      const ny = cy + dir.y;
      if (!inBounds(state.grid, nx, ny) || !isPassable(state, nx, ny)) {
        continue;
      }
      if (dir.x !== 0 && dir.y !== 0) {
        if (!isPassable(state, cx + dir.x, cy) || !isPassable(state, cx, cy + dir.y)) {
          continue;
        }
      }
      const nIdx = indexFor(state.grid, nx, ny);
      const stepCost = getMoveCost(state, cx, cy, nx, ny, dir.cost);
      const nextScore = currentScore + stepCost;
      if (nextScore >= gScore[nIdx]) {
        continue;
      }
      gScore[nIdx] = nextScore;
      prev[nIdx] = current.idx;
      open.push({ idx: nIdx, f: nextScore + estimate(nx, ny) });
    }
  }

  if (prev[goalIdx] === -1) {
    return [];
  }

  const path: Point[] = [];
  let current = goalIdx;
  while (current !== startIdx) {
    const px = current % state.grid.cols;
    const py = Math.floor(current / state.grid.cols);
    path.push({ x: px, y: py });
    current = prev[current];
  }
  path.reverse();
  return path;
}

