import { inBounds, indexFor } from "../../../core/grid.js";
import type { WorldState } from "../../../core/state.js";
import type { Point } from "../../../core/types.js";

export type GuaranteedTownConnectorResult = {
  path: Point[];
  bridgeTileIndices: number[];
  visitedNodes: number;
  maxPathLength: number;
  failureReason: "no-path" | "path-too-long" | "blocked-endpoint" | null;
};

type QueueEntry = {
  idx: number;
  priority: number;
};

const NEIGHBORS: readonly Point[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: -1 },
  { x: -1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 }
];

const pushQueue = (queue: QueueEntry[], entry: QueueEntry): void => {
  queue.push(entry);
  let index = queue.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (queue[parent]!.priority <= entry.priority) {
      break;
    }
    queue[index] = queue[parent]!;
    index = parent;
  }
  queue[index] = entry;
};

const popQueue = (queue: QueueEntry[]): QueueEntry | null => {
  if (queue.length === 0) {
    return null;
  }
  const result = queue[0]!;
  const last = queue.pop()!;
  if (queue.length === 0) {
    return result;
  }
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    if (left >= queue.length) {
      break;
    }
    const child = right < queue.length && queue[right]!.priority < queue[left]!.priority ? right : left;
    if (queue[child]!.priority >= last.priority) {
      break;
    }
    queue[index] = queue[child]!;
    index = child;
  }
  queue[index] = last;
  return result;
};

const isRoadLike = (state: WorldState, x: number, y: number): boolean => {
  if (!inBounds(state.grid, x, y)) {
    return false;
  }
  const idx = indexFor(state.grid, x, y);
  return state.tiles[idx]?.type === "road" || (state.tileRoadEdges[idx] ?? 0) > 0 || (state.tileRoadBridge[idx] ?? 0) > 0;
};

const isBlockedForGuaranteedConnector = (state: WorldState, point: Point, startIdx: number, endIdx: number): boolean => {
  if (!inBounds(state.grid, point.x, point.y)) {
    return true;
  }
  const idx = indexFor(state.grid, point.x, point.y);
  if (idx === startIdx || idx === endIdx || isRoadLike(state, point.x, point.y)) {
    return false;
  }
  const tile = state.tiles[idx];
  if (!tile) {
    return true;
  }
  if (tile.type === "house" || tile.type === "base") {
    return true;
  }
  return (state.structureMask[idx] ?? 0) > 0;
};

const localRelief = (state: WorldState, x: number, y: number): number => {
  const center = state.tiles[indexFor(state.grid, x, y)]?.elevation ?? 0;
  let maxDiff = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0 || !inBounds(state.grid, x + dx, y + dy)) {
        continue;
      }
      const neighbor = state.tiles[indexFor(state.grid, x + dx, y + dy)]?.elevation ?? center;
      maxDiff = Math.max(maxDiff, Math.abs(neighbor - center));
    }
  }
  return maxDiff;
};

const reconstructPath = (prev: Int32Array, startIdx: number, endIdx: number, cols: number): Point[] => {
  const path: Point[] = [];
  let current = endIdx;
  while (current >= 0) {
    path.push({ x: current % cols, y: Math.floor(current / cols) });
    if (current === startIdx) {
      break;
    }
    current = prev[current]!;
  }
  path.reverse();
  return path[0]?.x === startIdx % cols && path[0]?.y === Math.floor(startIdx / cols) ? path : [];
};

export const buildGuaranteedTownConnectorPath = (
  state: WorldState,
  start: Point,
  end: Point,
  options: {
    heightScaleMultiplier?: number;
    maxPathLengthMultiplier?: number;
  } = {}
): GuaranteedTownConnectorResult => {
  const startIdx = indexFor(state.grid, start.x, start.y);
  const endIdx = indexFor(state.grid, end.x, end.y);
  const directDistance = Math.max(1, Math.hypot(end.x - start.x, end.y - start.y));
  const maxPathLength = Math.max(24, Math.ceil(directDistance * (options.maxPathLengthMultiplier ?? 3.2)));
  const padding = Math.max(32, Math.ceil(directDistance * 0.75));
  const minX = Math.max(0, Math.min(start.x, end.x) - padding);
  const maxX = Math.min(state.grid.cols - 1, Math.max(start.x, end.x) + padding);
  const minY = Math.max(0, Math.min(start.y, end.y) - padding);
  const maxY = Math.min(state.grid.rows - 1, Math.max(start.y, end.y) + padding);
  const total = state.grid.totalTiles;
  const costs = new Float64Array(total);
  const prev = new Int32Array(total);
  const pathLength = new Int32Array(total);
  costs.fill(Number.POSITIVE_INFINITY);
  prev.fill(-1);
  pathLength.fill(0);
  if (
    isBlockedForGuaranteedConnector(state, start, startIdx, endIdx) ||
    isBlockedForGuaranteedConnector(state, end, startIdx, endIdx)
  ) {
    return { path: [], bridgeTileIndices: [], visitedNodes: 0, maxPathLength, failureReason: "blocked-endpoint" };
  }
  const queue: QueueEntry[] = [];
  const heightScale = options.heightScaleMultiplier ?? 1;
  costs[startIdx] = 0;
  pushQueue(queue, { idx: startIdx, priority: directDistance });
  let visitedNodes = 0;
  while (queue.length > 0) {
    const current = popQueue(queue)!;
    const cx = current.idx % state.grid.cols;
    const cy = Math.floor(current.idx / state.grid.cols);
    if (current.priority < costs[current.idx]) {
      continue;
    }
    visitedNodes += 1;
    if (current.idx === endIdx) {
      break;
    }
    if (pathLength[current.idx] >= maxPathLength) {
      continue;
    }
    const currentElevation = state.tiles[current.idx]?.elevation ?? 0;
    for (let i = 0; i < NEIGHBORS.length; i += 1) {
      const dir = NEIGHBORS[i]!;
      const nx = cx + dir.x;
      const ny = cy + dir.y;
      if (nx < minX || nx > maxX || ny < minY || ny > maxY) {
        continue;
      }
      const point = { x: nx, y: ny };
      if (isBlockedForGuaranteedConnector(state, point, startIdx, endIdx)) {
        continue;
      }
      const nIdx = indexFor(state.grid, nx, ny);
      const tile = state.tiles[nIdx];
      const diagonal = dir.x !== 0 && dir.y !== 0;
      const stepDistance = diagonal ? Math.SQRT2 : 1;
      const elevation = tile?.elevation ?? currentElevation;
      const grade = Math.abs(elevation - currentElevation) * heightScale / stepDistance;
      const waterCost = tile?.type === "water" && (state.tileRoadBridge[nIdx] ?? 0) === 0 ? 12 : 0;
      const reliefCost = localRelief(state, nx, ny) * 150;
      const gradeCost = grade * 95 + Math.max(0, grade - 0.22) * 360;
      const roadBonus = isRoadLike(state, nx, ny) ? -0.35 : 0;
      const nextCost = costs[current.idx] + stepDistance + waterCost + reliefCost + gradeCost + roadBonus;
      if (nextCost >= costs[nIdx]) {
        continue;
      }
      costs[nIdx] = nextCost;
      prev[nIdx] = current.idx;
      pathLength[nIdx] = pathLength[current.idx] + 1;
      const heuristic = Math.hypot(end.x - nx, end.y - ny);
      pushQueue(queue, { idx: nIdx, priority: nextCost + heuristic });
    }
  }
  if (!Number.isFinite(costs[endIdx])) {
    return { path: [], bridgeTileIndices: [], visitedNodes, maxPathLength, failureReason: "no-path" };
  }
  const path = reconstructPath(prev, startIdx, endIdx, state.grid.cols);
  if (path.length === 0) {
    return { path: [], bridgeTileIndices: [], visitedNodes, maxPathLength, failureReason: "no-path" };
  }
  if (path.length > maxPathLength) {
    return { path: [], bridgeTileIndices: [], visitedNodes, maxPathLength, failureReason: "path-too-long" };
  }
  const bridgeTileIndices = path
    .map((point) => indexFor(state.grid, point.x, point.y))
    .filter((idx) => state.tiles[idx]?.type === "water" && (state.tileRoadBridge[idx] ?? 0) === 0);
  return { path, bridgeTileIndices, visitedNodes, maxPathLength, failureReason: null };
};
