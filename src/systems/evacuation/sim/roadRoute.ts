import type { WorldState } from "../../../core/state.js";
import type { Point } from "../../../core/types.js";
import { inBounds, indexFor } from "../../../core/grid.js";
import type { EvacuationRoute, EvacuationRouteResult } from "../types/evacuationTypes.js";
import { EVACUATION_TOWN_ROAD_SCAN_RADIUS } from "../constants/runtimeConstants.js";

const ROAD_EDGE_N = 1 << 0;
const ROAD_EDGE_E = 1 << 1;
const ROAD_EDGE_S = 1 << 2;
const ROAD_EDGE_W = 1 << 3;
const ROAD_EDGE_NE = 1 << 4;
const ROAD_EDGE_NW = 1 << 5;
const ROAD_EDGE_SE = 1 << 6;
const ROAD_EDGE_SW = 1 << 7;

const ROAD_DIRS = [
  { dx: 0, dy: -1, bit: ROAD_EDGE_N, opposite: ROAD_EDGE_S },
  { dx: 1, dy: 0, bit: ROAD_EDGE_E, opposite: ROAD_EDGE_W },
  { dx: 0, dy: 1, bit: ROAD_EDGE_S, opposite: ROAD_EDGE_N },
  { dx: -1, dy: 0, bit: ROAD_EDGE_W, opposite: ROAD_EDGE_E },
  { dx: 1, dy: -1, bit: ROAD_EDGE_NE, opposite: ROAD_EDGE_SW },
  { dx: -1, dy: -1, bit: ROAD_EDGE_NW, opposite: ROAD_EDGE_SE },
  { dx: 1, dy: 1, bit: ROAD_EDGE_SE, opposite: ROAD_EDGE_NW },
  { dx: -1, dy: 1, bit: ROAD_EDGE_SW, opposite: ROAD_EDGE_NE }
] as const;

export const isEvacuationRoadTile = (state: WorldState, x: number, y: number): boolean => {
  if (!inBounds(state.grid, x, y)) {
    return false;
  }
  const idx = indexFor(state.grid, x, y);
  const type = state.tiles[idx]?.type;
  return type === "road" || type === "base" || (type === "water" && (state.tileRoadBridge[idx] ?? 0) > 0);
};

const hasRoadConnection = (state: WorldState, fromIdx: number, toIdx: number, bit: number, opposite: number): boolean => {
  const fromMask = state.tileRoadEdges[fromIdx] ?? 0;
  const toMask = state.tileRoadEdges[toIdx] ?? 0;
  if (fromMask === 0 && toMask === 0) {
    return bit === ROAD_EDGE_N || bit === ROAD_EDGE_E || bit === ROAD_EDGE_S || bit === ROAD_EDGE_W;
  }
  return (fromMask & bit) !== 0 && (toMask & opposite) !== 0;
};

const getTownCenter = (town: WorldState["towns"][number]): Point => ({
  x: Math.round(Number.isFinite(town.cx) ? town.cx : town.x),
  y: Math.round(Number.isFinite(town.cy) ? town.cy : town.y)
});

export const findTownEvacuationDeparture = (
  state: WorldState,
  town: WorldState["towns"][number],
  radius = EVACUATION_TOWN_ROAD_SCAN_RADIUS
): Point | null => {
  const center = getTownCenter(town);
  let best: Point | null = null;
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (let y = Math.max(0, center.y - radius); y <= Math.min(state.grid.rows - 1, center.y + radius); y += 1) {
    for (let x = Math.max(0, center.x - radius); x <= Math.min(state.grid.cols - 1, center.x + radius); x += 1) {
      if (!isEvacuationRoadTile(state, x, y)) {
        continue;
      }
      const dx = x - center.x;
      const dy = y - center.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq || (distSq === bestDistSq && (y < (best?.y ?? y + 1) || x < (best?.x ?? x + 1)))) {
        best = { x, y };
        bestDistSq = distSq;
      }
    }
  }
  return best;
};

const findRoadRoute = (state: WorldState, start: Point, goal: Point): Point[] => {
  if (!isEvacuationRoadTile(state, start.x, start.y) || !isEvacuationRoadTile(state, goal.x, goal.y)) {
    return [];
  }
  const startIdx = indexFor(state.grid, start.x, start.y);
  const goalIdx = indexFor(state.grid, goal.x, goal.y);
  if (startIdx === goalIdx) {
    return [{ x: start.x, y: start.y }];
  }

  const total = state.grid.totalTiles;
  const prev = new Int32Array(total).fill(-1);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  prev[startIdx] = startIdx;
  queue[tail++] = startIdx;

  while (head < tail) {
    const currentIdx = queue[head++];
    if (currentIdx === goalIdx) {
      break;
    }
    const cx = currentIdx % state.grid.cols;
    const cy = Math.floor(currentIdx / state.grid.cols);
    for (const dir of ROAD_DIRS) {
      const nx = cx + dir.dx;
      const ny = cy + dir.dy;
      if (!isEvacuationRoadTile(state, nx, ny)) {
        continue;
      }
      const nextIdx = indexFor(state.grid, nx, ny);
      if (prev[nextIdx] !== -1 || !hasRoadConnection(state, currentIdx, nextIdx, dir.bit, dir.opposite)) {
        continue;
      }
      prev[nextIdx] = currentIdx;
      queue[tail++] = nextIdx;
    }
  }

  if (prev[goalIdx] === -1) {
    return [];
  }
  const reversed: Point[] = [];
  let cursor = goalIdx;
  while (cursor !== startIdx) {
    reversed.push({ x: cursor % state.grid.cols, y: Math.floor(cursor / state.grid.cols) });
    cursor = prev[cursor];
  }
  reversed.push({ x: start.x, y: start.y });
  reversed.reverse();
  return reversed;
};

export const createEvacuationRoute = (state: WorldState, townId: number, destination: Point): EvacuationRouteResult => {
  const town = state.towns.find((entry) => entry.id === townId) ?? null;
  if (!town) {
    return { ok: false, reason: "invalid-town" };
  }
  const target = { x: Math.trunc(destination.x), y: Math.trunc(destination.y) };
  if (!isEvacuationRoadTile(state, target.x, target.y)) {
    return { ok: false, reason: "invalid-destination" };
  }
  const departure = findTownEvacuationDeparture(state, town);
  if (!departure) {
    return { ok: false, reason: "no-town-road" };
  }
  const tiles = findRoadRoute(state, departure, target);
  if (tiles.length === 0) {
    return { ok: false, reason: "no-route" };
  }
  return {
    ok: true,
    route: {
      townId,
      departure,
      destination: target,
      tiles,
      createdDay: state.careerDay
    }
  };
};
