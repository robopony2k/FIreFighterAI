import type { WorldState } from "../../../core/state.js";
import type { Point } from "../../../core/types.js";
import { inBounds, indexFor } from "../../../core/grid.js";
import { profEnd, profStart } from "../../../core/diagnostics/simProfiler.js";
import type { UnitMovementProfile, UnitPathResult } from "../types/unitPathTypes.js";
import {
  canTraverseUnitEdge,
  getUnitHeuristicScale,
  getUnitTraversalCost,
  isUnitTilePassable
} from "./unitTraversalRules.js";

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

const octileDistance = (fromX: number, fromY: number, toX: number, toY: number): number => {
  const dx = Math.abs(fromX - toX);
  const dy = Math.abs(fromY - toY);
  const diagonal = Math.min(dx, dy);
  return dx + dy + (Math.SQRT2 - 2) * diagonal;
};

const reconstructPath = (state: WorldState, startIdx: number, endIdx: number): Point[] | null => {
  const path: Point[] = [];
  let current = endIdx;
  let steps = 0;
  while (current !== startIdx) {
    if (steps > state.grid.totalTiles) {
      console.warn("Path reconstruction aborted due to unexpected cycle.", { startIdx, endIdx });
      return null;
    }
    path.push({ x: current % state.grid.cols, y: Math.floor(current / state.grid.cols) });
    current = state.pathPrev[current];
    steps += 1;
  }
  path.reverse();
  return path;
};

export const findUnitPath = (
  state: WorldState,
  start: Point,
  goal: Point,
  profile: UnitMovementProfile
): UnitPathResult => {
  const profStartAt = profStart();
  const finish = (result: UnitPathResult): UnitPathResult => {
    profEnd("findPath", profStartAt);
    return result;
  };
  const none = (): UnitPathResult => ({
    status: "none",
    requestedTarget: { x: goal.x, y: goal.y },
    resolvedTarget: null,
    path: []
  });
  if (!inBounds(state.grid, goal.x, goal.y) || !inBounds(state.grid, start.x, start.y) ||
    !isUnitTilePassable(state, start.x, start.y)) {
    return finish(none());
  }
  const startIdx = indexFor(state.grid, start.x, start.y);
  const goalIdx = indexFor(state.grid, goal.x, goal.y);
  if (startIdx === goalIdx) {
    return finish({
      status: "exact",
      requestedTarget: { x: goal.x, y: goal.y },
      resolvedTarget: { x: goal.x, y: goal.y },
      path: []
    });
  }

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
  const heuristicScale = getUnitHeuristicScale(profile);
  const estimate = (x: number, y: number): number => octileDistance(x, y, goal.x, goal.y) * heuristicScale;

  const heapPush = (idx: number, f: number): void => {
    if (openSize >= openIdx.length) return;
    let i = openSize;
    openSize += 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (openF[parent] <= f) break;
      openIdx[i] = openIdx[parent];
      openF[i] = openF[parent];
      i = parent;
    }
    openIdx[i] = idx;
    openF[i] = f;
  };

  const heapPop = (): number => {
    if (openSize === 0) return -1;
    const result = openIdx[0];
    openSize -= 1;
    if (openSize > 0) {
      const idx = openIdx[openSize];
      const f = openF[openSize];
      let i = 0;
      while (true) {
        const left = i * 2 + 1;
        if (left >= openSize) break;
        const right = left + 1;
        let smallest = left;
        if (right < openSize && openF[right] < openF[left]) smallest = right;
        if (openF[smallest] >= f) break;
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
  let bestIdx = startIdx;
  let bestDistance = octileDistance(start.x, start.y, goal.x, goal.y);
  let bestCost = 0;
  let reachedGoal = false;

  while (openSize > 0) {
    const currentIdx = heapPop();
    if (currentIdx < 0) break;
    if (closed[currentIdx] === stamp) continue;
    closed[currentIdx] = stamp;
    nodesExpanded += 1;
    const cx = currentIdx % state.grid.cols;
    const cy = Math.floor(currentIdx / state.grid.cols);
    const currentScore = gScore[currentIdx];
    const currentDistance = octileDistance(cx, cy, goal.x, goal.y);
    if (currentDistance < bestDistance - 1e-6 ||
      (Math.abs(currentDistance - bestDistance) <= 1e-6 &&
        (currentScore < bestCost - 1e-6 ||
          (Math.abs(currentScore - bestCost) <= 1e-6 && currentIdx < bestIdx)))) {
      bestIdx = currentIdx;
      bestDistance = currentDistance;
      bestCost = currentScore;
    }
    if (currentIdx === goalIdx && isUnitTilePassable(state, goal.x, goal.y)) {
      reachedGoal = true;
      bestIdx = goalIdx;
      break;
    }
    if (maxExpansions > 0 && nodesExpanded >= maxExpansions) break;

    for (const dir of MOVE_DIRS) {
      const nx = cx + dir.x;
      const ny = cy + dir.y;
      if (!inBounds(state.grid, nx, ny) || !canTraverseUnitEdge(state, profile, cx, cy, nx, ny)) continue;
      const nextIdx = indexFor(state.grid, nx, ny);
      const nextScore = currentScore + getUnitTraversalCost(state, profile, cx, cy, nx, ny, dir.cost);
      if (visit[nextIdx] === stamp && nextScore >= gScore[nextIdx]) continue;
      visit[nextIdx] = stamp;
      gScore[nextIdx] = nextScore;
      prev[nextIdx] = currentIdx;
      heapPush(nextIdx, nextScore + estimate(nx, ny) * epsilon);
      if (openSize > maxOpen) maxOpen = openSize;
    }
  }

  state.pathOpenSize = openSize;
  state.pathLastNodesExpanded = nodesExpanded;
  state.pathMaxOpenSize = Math.max(state.pathMaxOpenSize, maxOpen);
  state.pathNodesExpanded = state.pathNodesExpanded > 0
    ? state.pathNodesExpanded * 0.8 + nodesExpanded * 0.2
    : nodesExpanded;

  const path = reconstructPath(state, startIdx, bestIdx);
  if (!path) return finish(none());
  const resolvedTarget = { x: bestIdx % state.grid.cols, y: Math.floor(bestIdx / state.grid.cols) };
  return finish({
    status: reachedGoal ? "exact" : "nearest",
    requestedTarget: { x: goal.x, y: goal.y },
    resolvedTarget,
    path
  });
};
