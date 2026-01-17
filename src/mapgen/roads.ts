import type { Point } from "../core/types.js";
import type { WorldState } from "../core/state.js";
import type { RNG } from "../core/types.js";
import { inBounds, indexFor } from "../core/grid.js";
import { applyFuel } from "../core/tiles.js";

type RoadPathOptions = {
  allowWater?: boolean;
};

type RoadCarveOptions = {
  allowBridge?: boolean;
};

export function setRoadAt(state: WorldState, rng: RNG, x: number, y: number, options: RoadCarveOptions = {}): void {
  if (!inBounds(state.grid, x, y)) {
    return;
  }
  const tile = state.tiles[indexFor(state.grid, x, y)];
  if (tile.type === "house" || tile.type === "base") {
    return;
  }
  if (tile.type === "water" && !options.allowBridge) {
    return;
  }
  tile.type = "road";
  tile.canopy = 0;
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
  const type = state.tiles[indexFor(state.grid, x, y)].type;
  const allowWater = options.allowWater ?? false;
  if (type === "water") {
    return allowWater;
  }
  if ((x === start.x && y === start.y) || (x === end.x && y === end.y)) {
    return true;
  }
  return type !== "house";
}

export function findRoadPath(state: WorldState, start: Point, end: Point, options: RoadPathOptions = {}): Point[] {
  if (!inBounds(state.grid, start.x, start.y) || !inBounds(state.grid, end.x, end.y)) {
    return [];
  }
  const startIdx = indexFor(state.grid, start.x, start.y);
  const endIdx = indexFor(state.grid, end.x, end.y);
  const allowWater = options.allowWater ?? false;
  if (
    !allowWater &&
    (state.tiles[startIdx].type === "water" || state.tiles[endIdx].type === "water")
  ) {
    return [];
  }
  if (startIdx === endIdx) {
    return [start];
  }

  const prev = new Int32Array(state.grid.totalTiles);
  prev.fill(-1);
  const queueX = new Int16Array(state.grid.totalTiles);
  const queueY = new Int16Array(state.grid.totalTiles);
  let head = 0;
  let tail = 0;

  queueX[tail] = start.x;
  queueY[tail] = start.y;
  tail += 1;
  prev[startIdx] = startIdx;

  while (head < tail) {
    const x = queueX[head];
    const y = queueY[head];
    head += 1;
    if (x === end.x && y === end.y) {
      break;
    }
    const neighbors: Point[] = [
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y + 1 },
      { x, y: y - 1 },
      { x: x + 1, y: y + 1 },
      { x: x + 1, y: y - 1 },
      { x: x - 1, y: y + 1 },
      { x: x - 1, y: y - 1 }
    ];
    for (const next of neighbors) {
      if (!canRoadTraverse(state, next.x, next.y, start, end, options)) {
        continue;
      }
      if (next.x !== x && next.y !== y) {
        const dx = next.x - x;
        const dy = next.y - y;
        const passA = canRoadTraverse(state, x + dx, y, start, end, options);
        const passB = canRoadTraverse(state, x, y + dy, start, end, options);
        if (!passA && !passB) {
          continue;
        }
      }
      const idx = indexFor(state.grid, next.x, next.y);
      if (prev[idx] !== -1) {
        continue;
      }
      prev[idx] = indexFor(state.grid, x, y);
      queueX[tail] = next.x;
      queueY[tail] = next.y;
      tail += 1;
    }
  }

  if (prev[endIdx] === -1) {
    return [];
  }

  const path: Point[] = [];
  let current = endIdx;
  while (current !== startIdx) {
    const px = current % state.grid.cols;
    const py = Math.floor(current / state.grid.cols);
    path.push({ x: px, y: py });
    current = prev[current];
  }
  path.push(start);
  path.reverse();
  return path;
}

export function findRoadPathToTarget(
  state: WorldState,
  start: Point,
  isTarget: (x: number, y: number) => boolean,
  options: RoadPathOptions = {}
): Point[] {
  if (!inBounds(state.grid, start.x, start.y)) {
    return [];
  }
  const startIdx = indexFor(state.grid, start.x, start.y);
  const allowWater = options.allowWater ?? false;
  if (state.tiles[startIdx].type === "water" && !allowWater) {
    return [];
  }

  if (isTarget(start.x, start.y)) {
    return [start];
  }

  const prev = new Int32Array(state.grid.totalTiles);
  prev.fill(-1);
  const queueX = new Int16Array(state.grid.totalTiles);
  const queueY = new Int16Array(state.grid.totalTiles);
  let head = 0;
  let tail = 0;

  queueX[tail] = start.x;
  queueY[tail] = start.y;
  tail += 1;
  prev[startIdx] = startIdx;

  let targetIdx = -1;
  while (head < tail) {
    const x = queueX[head];
    const y = queueY[head];
    head += 1;
    if (isTarget(x, y)) {
      targetIdx = indexFor(state.grid, x, y);
      break;
    }
    const neighbors: Point[] = [
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y + 1 },
      { x, y: y - 1 },
      { x: x + 1, y: y + 1 },
      { x: x + 1, y: y - 1 },
      { x: x - 1, y: y + 1 },
      { x: x - 1, y: y - 1 }
    ];
    for (const next of neighbors) {
      if (!canRoadTraverse(state, next.x, next.y, start, start, options)) {
        continue;
      }
      if (next.x !== x && next.y !== y) {
        const dx = next.x - x;
        const dy = next.y - y;
        const passA = canRoadTraverse(state, x + dx, y, start, start, options);
        const passB = canRoadTraverse(state, x, y + dy, start, start, options);
        if (!passA && !passB) {
          continue;
        }
      }
      const idx = indexFor(state.grid, next.x, next.y);
      if (prev[idx] !== -1) {
        continue;
      }
      prev[idx] = indexFor(state.grid, x, y);
      queueX[tail] = next.x;
      queueY[tail] = next.y;
      tail += 1;
    }
  }

  if (targetIdx === -1) {
    return [];
  }

  const path: Point[] = [];
  let current = targetIdx;
  while (current !== startIdx) {
    const px = current % state.grid.cols;
    const py = Math.floor(current / state.grid.cols);
    path.push({ x: px, y: py });
    current = prev[current];
  }
  path.push(start);
  path.reverse();
  return path;
}

export function carveRoad(state: WorldState, rng: RNG, start: Point, end: Point, options: RoadCarveOptions = {}): boolean {
  const allowBridge = options.allowBridge ?? false;
  const path = findRoadPath(state, start, end, { allowWater: allowBridge });
  if (path.length === 0) {
    return false;
  }
  path.forEach((point) => setRoadAt(state, rng, point.x, point.y, options));
  return true;
}

export function collectRoadTiles(state: WorldState): Point[] {
  const roads: Point[] = [];
  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const type = state.tiles[indexFor(state.grid, x, y)].type;
      if (type === "road" || type === "base") {
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
      const type = state.tiles[indexFor(state.grid, x, y)].type;
      if (type !== "road" && type !== "base") {
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

