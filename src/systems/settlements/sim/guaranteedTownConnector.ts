import { inBounds, indexFor } from "../../../core/grid.js";
import type { WorldState } from "../../../core/state.js";
import type { Point } from "../../../core/types.js";

export type GuaranteedTownConnectorStyle = "shoreline-contour" | "sidehill-contour" | "direct-guaranteed";

export type GuaranteedTownConnectorStyleAttempt = {
  style: GuaranteedTownConnectorStyle;
  pathLength: number;
  bridgeCount: number;
  visitedNodes: number;
  failureReason:
    | "no-path"
    | "path-too-long"
    | "blocked-endpoint"
    | "insufficient-shoreline"
    | "excessive-earthwork"
    | null;
};

export type GuaranteedTownConnectorResult = {
  path: Point[];
  bridgeTileIndices: number[];
  visitedNodes: number;
  maxPathLength: number;
  style: GuaranteedTownConnectorStyle | null;
  styleAttempts: GuaranteedTownConnectorStyleAttempt[];
  failureReason:
    | "no-path"
    | "path-too-long"
    | "blocked-endpoint"
    | "insufficient-shoreline"
    | "excessive-earthwork"
    | null;
};

const LAKE_LIP_BENCH_CLEARANCE = 0.04;
const LAKE_LIP_BENCH_MAX_CUT = 0.11;
const LAKE_LIP_SURFACE_SEARCH_RADIUS = 3;

type QueueEntry = {
  idx: number;
  cost: number;
  priority: number;
};

type SearchProfile = {
  style: GuaranteedTownConnectorStyle;
  distanceWeight: number;
  waterCost: number;
  reliefWeight: number;
  gradeWeight: number;
  steepGradeWeight: number;
  contourWeight: number;
  earthworkWeight: number;
  shorelineBonus: number;
  roadBonus: number;
  straightClimbWeight: number;
  maxPathMultiplier?: number;
  maxVisitedNodes: number;
  minShorelineTouches?: number;
  maxMeanEarthwork?: number;
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

const SEARCH_PROFILES: readonly SearchProfile[] = [
  {
    style: "shoreline-contour",
    distanceWeight: 0.9,
    waterCost: 20,
    reliefWeight: 255,
    gradeWeight: 170,
    steepGradeWeight: 880,
    contourWeight: 95,
    earthworkWeight: 360,
    shorelineBonus: 9.5,
    roadBonus: -0.45,
    straightClimbWeight: 34,
    maxPathMultiplier: 4.8,
    maxVisitedNodes: 36000,
    minShorelineTouches: 4,
    maxMeanEarthwork: 0.075
  },
  {
    style: "sidehill-contour",
    distanceWeight: 0.82,
    waterCost: 18,
    reliefWeight: 185,
    gradeWeight: 105,
    steepGradeWeight: 420,
    contourWeight: 18,
    earthworkWeight: 82,
    shorelineBonus: 7,
    roadBonus: -0.4,
    straightClimbWeight: 16,
    maxPathMultiplier: 4.8,
    maxVisitedNodes: 90000,
    maxMeanEarthwork: 0.18
  },
  {
    style: "direct-guaranteed",
    distanceWeight: 1,
    waterCost: 12,
    reliefWeight: 150,
    gradeWeight: 95,
    steepGradeWeight: 360,
    contourWeight: 0,
    earthworkWeight: 0,
    shorelineBonus: 0,
    roadBonus: -0.35,
    straightClimbWeight: 0,
    maxPathMultiplier: 3.2,
    maxVisitedNodes: Number.MAX_SAFE_INTEGER
  }
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
  return false;
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

const getElevation = (state: WorldState, x: number, y: number): number =>
  state.tiles[indexFor(state.grid, x, y)]?.elevation ?? 0;

const getNearbyLakeSurface = (state: WorldState, x: number, y: number): number | null => {
  let bestSurface = Number.NaN;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let dy = -LAKE_LIP_SURFACE_SEARCH_RADIUS; dy <= LAKE_LIP_SURFACE_SEARCH_RADIUS; dy += 1) {
    for (let dx = -LAKE_LIP_SURFACE_SEARCH_RADIUS; dx <= LAKE_LIP_SURFACE_SEARCH_RADIUS; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const nIdx = indexFor(state.grid, nx, ny);
      const neighbor = state.tiles[nIdx];
      const isLake = (state.tileLakeMask[nIdx] ?? 0) > 0;
      const isWater = neighbor?.type === "water";
      if (!isLake && !isWater) {
        continue;
      }
      const surface = state.tileLakeSurface[nIdx] ?? neighbor?.elevation ?? Number.NaN;
      if (!Number.isFinite(surface)) {
        continue;
      }
      const distance = Math.hypot(dx, dy);
      if (distance < bestDistance || (distance === bestDistance && surface > bestSurface)) {
        bestSurface = surface;
        bestDistance = distance;
      }
    }
  }
  return Number.isFinite(bestSurface) ? bestSurface : null;
};

const getLakeLipScore = (state: WorldState, x: number, y: number): number => {
  const idx = indexFor(state.grid, x, y);
  const tile = state.tiles[idx];
  const elevation = tile?.elevation ?? 0;
  let best = 0;
  for (let dy = -3; dy <= 3; dy += 1) {
    for (let dx = -3; dx <= 3; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const nIdx = indexFor(state.grid, nx, ny);
      const neighbor = state.tiles[nIdx];
      const isLake = (state.tileLakeMask[nIdx] ?? 0) > 0;
      const isWater = neighbor?.type === "water";
      if (!isLake && !isWater) {
        continue;
      }
      const distance = Math.max(1, Math.hypot(dx, dy));
      const lakeSurface = state.tileLakeSurface[nIdx] ?? neighbor?.elevation ?? elevation;
      const lipHeight = Math.max(0, elevation - lakeSurface);
      if (lipHeight > 0.16) {
        continue;
      }
      const heightScore = 1 - Math.min(1, Math.abs(lipHeight - 0.035) / 0.13);
      const distanceScore = 1 - Math.min(1, (distance - 1) / 3);
      best = Math.max(best, heightScore * 0.65 + distanceScore * 0.35);
    }
  }
  if (tile?.type === "water") {
    return best * 0.25;
  }
  return best;
};

export const applyGuaranteedTownConnectorLakeLipBench = (
  state: WorldState,
  path: readonly Point[],
  bridgeTileIndices: readonly number[] = []
): void => {
  const bridgeTiles = new Set(bridgeTileIndices);
  for (let i = 0; i < path.length; i += 1) {
    const point = path[i]!;
    if (!inBounds(state.grid, point.x, point.y)) {
      continue;
    }
    const idx = indexFor(state.grid, point.x, point.y);
    if (bridgeTiles.has(idx) || state.tiles[idx]?.type === "water") {
      continue;
    }
    const surface = getNearbyLakeSurface(state, point.x, point.y);
    if (surface === null) {
      continue;
    }
    const tile = state.tiles[idx];
    if (!tile) {
      continue;
    }
    const benchElevation = Math.min(1, surface + LAKE_LIP_BENCH_CLEARANCE);
    if (tile.elevation > benchElevation + LAKE_LIP_BENCH_MAX_CUT) {
      continue;
    }
    if (tile.elevation < benchElevation) {
      tile.elevation = benchElevation;
      state.tileElevation[idx] = benchElevation;
    }
  }
};

const getContourScore = (
  state: WorldState,
  currentIndex: number,
  nextIndex: number,
  startElevation: number,
  endElevation: number
): number => {
  const currentElevation = state.tiles[currentIndex]?.elevation ?? startElevation;
  const nextElevation = state.tiles[nextIndex]?.elevation ?? currentElevation;
  const preferredElevation = (startElevation + endElevation) * 0.5;
  const bandDeviation = Math.abs(nextElevation - preferredElevation);
  const grade = Math.abs(nextElevation - currentElevation);
  return bandDeviation * 1.35 + grade * 2.4;
};

const getEarthworkPenalty = (
  state: WorldState,
  currentIndex: number,
  nextIndex: number,
  stepDistance: number,
  heightScale: number
): number => {
  const currentElevation = state.tiles[currentIndex]?.elevation ?? 0;
  const nextElevation = state.tiles[nextIndex]?.elevation ?? currentElevation;
  const nx = nextIndex % state.grid.cols;
  const ny = Math.floor(nextIndex / state.grid.cols);
  const grade = Math.abs(nextElevation - currentElevation) * heightScale / Math.max(1e-6, stepDistance);
  const relief = localRelief(state, nx, ny);
  const shelfPenalty = Math.max(0, relief - 0.026) * 1.8;
  const gradePenalty = Math.max(0, grade - 0.14) * 2.6;
  return relief * 0.9 + shelfPenalty + gradePenalty;
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

const appendLine = (path: Point[], start: Point, end: Point): void => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (steps === 0) {
    if (path.length === 0 || path[path.length - 1]!.x !== start.x || path[path.length - 1]!.y !== start.y) {
      path.push({ ...start });
    }
    return;
  }
  for (let step = 0; step <= steps; step += 1) {
    const point = {
      x: Math.round(start.x + (dx * step) / steps),
      y: Math.round(start.y + (dy * step) / steps)
    };
    const previous = path[path.length - 1];
    if (!previous || previous.x !== point.x || previous.y !== point.y) {
      path.push(point);
    }
  }
};

const buildPathThroughWaypoints = (points: Point[]): Point[] => {
  const path: Point[] = [];
  for (let i = 1; i < points.length; i += 1) {
    appendLine(path, points[i - 1]!, points[i]!);
  }
  return path;
};

const repairBlockedPolylinePath = (
  state: WorldState,
  path: Point[],
  startIdx: number,
  endIdx: number
): Point[] => {
  const repaired: Point[] = [];
  const appendContinuousPoint = (target: Point): void => {
    const previous = repaired[repaired.length - 1];
    if (!previous) {
      repaired.push(target);
      return;
    }
    appendLine(repaired, previous, target);
  };
  for (let i = 0; i < path.length; i += 1) {
    const point = path[i]!;
    if (!isBlockedForGuaranteedConnector(state, point, startIdx, endIdx)) {
      appendContinuousPoint(point);
      continue;
    }
    let bestX = -1;
    let bestY = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    const previous = repaired[repaired.length - 1] ?? path[Math.max(0, i - 1)]!;
    const next = path[Math.min(path.length - 1, i + 1)]!;
    for (let radius = 1; radius <= 8; radius += 1) {
      for (let y = point.y - radius; y <= point.y + radius; y += 1) {
        for (let x = point.x - radius; x <= point.x + radius; x += 1) {
          if (!inBounds(state.grid, x, y) || isBlockedForGuaranteedConnector(state, { x, y }, startIdx, endIdx)) {
            continue;
          }
          const score =
            Math.hypot(x - previous.x, y - previous.y) +
            Math.hypot(next.x - x, next.y - y) +
            localRelief(state, x, y) * 80 -
            getLakeLipScore(state, x, y) * 3;
          if (score < bestScore || (score === bestScore && (y < bestY || (y === bestY && x < bestX)))) {
            bestX = x;
            bestY = y;
            bestScore = score;
          }
        }
      }
      if (bestX >= 0) {
        break;
      }
    }
    if (bestX < 0 || bestY < 0) {
      return [];
    }
    const replacement = { x: bestX, y: bestY };
    appendContinuousPoint(replacement);
  }
  return repaired;
};

const summarizePathShape = (
  state: WorldState,
  path: Point[],
  heightScale: number
): { bridgeTileIndices: number[]; shorelineTouches: number; meanEarthwork: number; blocked: boolean } => {
  const bridgeTileIndices: number[] = [];
  let shorelineTouches = 0;
  let earthworkTotal = 0;
  for (let i = 0; i < path.length; i += 1) {
    const point = path[i]!;
    if (!inBounds(state.grid, point.x, point.y)) {
      return { bridgeTileIndices: [], shorelineTouches: 0, meanEarthwork: Number.POSITIVE_INFINITY, blocked: true };
    }
    const idx = indexFor(state.grid, point.x, point.y);
    if (state.tiles[idx]?.type === "water" && (state.tileRoadBridge[idx] ?? 0) === 0) {
      bridgeTileIndices.push(idx);
    }
    if (getLakeLipScore(state, point.x, point.y) > 0.36) {
      shorelineTouches += 1;
    }
    if (i > 0) {
      const previous = path[i - 1]!;
      const previousIdx = indexFor(state.grid, previous.x, previous.y);
      earthworkTotal += getEarthworkPenalty(state, previousIdx, idx, Math.hypot(point.x - previous.x, point.y - previous.y), heightScale);
    }
  }
  return {
    bridgeTileIndices,
    shorelineTouches,
    meanEarthwork: path.length > 1 ? earthworkTotal / (path.length - 1) : 0,
    blocked: false
  };
};

const buildShorelineContourPolyline = (
  state: WorldState,
  start: Point,
  end: Point,
  startIdx: number,
  endIdx: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  maxPathLength: number,
  heightScale: number
): { path: Point[]; bridgeTileIndices: number[]; failureReason: GuaranteedTownConnectorStyleAttempt["failureReason"] } => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = Math.max(1, dx * dx + dy * dy);
  const bySide = new Map<number, Array<Point & { t: number; score: number }>>();
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const idx = indexFor(state.grid, x, y);
      if (isBlockedForGuaranteedConnector(state, { x, y }, startIdx, endIdx) || state.tiles[idx]?.type === "water") {
        continue;
      }
      const lipScore = getLakeLipScore(state, x, y);
      if (lipScore < 0.42) {
        continue;
      }
      const relX = x - start.x;
      const relY = y - start.y;
      const t = (relX * dx + relY * dy) / lengthSq;
      if (t < 0.08 || t > 0.92) {
        continue;
      }
      const cross = relX * dy - relY * dx;
      const side = cross < 0 ? -1 : 1;
      const lineDistance = Math.abs(cross) / Math.sqrt(lengthSq);
      const score = localRelief(state, x, y) * 180 + lineDistance * 0.07 - lipScore * 8 + Math.abs(t - 0.5) * 0.4;
      const list = bySide.get(side) ?? [];
      list.push({ x, y, t, score });
      bySide.set(side, list);
    }
  }
  let selectedSide: Array<Point & { t: number; score: number }> = [];
  for (const list of bySide.values()) {
    if (list.length > selectedSide.length) {
      selectedSide = list;
    }
  }
  if (selectedSide.length < 4) {
    return { path: [], bridgeTileIndices: [], failureReason: "insufficient-shoreline" };
  }
  const bucketCount = 10;
  const buckets: Array<(Point & { t: number; score: number }) | null> = Array.from({ length: bucketCount }, () => null);
  for (let i = 0; i < selectedSide.length; i += 1) {
    const candidate = selectedSide[i]!;
    const bucket = Math.max(0, Math.min(bucketCount - 1, Math.floor(candidate.t * bucketCount)));
    const existing = buckets[bucket];
    if (
      !existing ||
      candidate.score < existing.score ||
      (candidate.score === existing.score && (candidate.y < existing.y || (candidate.y === existing.y && candidate.x < existing.x)))
    ) {
      buckets[bucket] = candidate;
    }
  }
  const waypoints = buckets.filter((point): point is Point & { t: number; score: number } => point !== null);
  if (waypoints.length < 3) {
    return { path: [], bridgeTileIndices: [], failureReason: "insufficient-shoreline" };
  }
  waypoints.sort((left, right) => left.t - right.t || left.y - right.y || left.x - right.x);
  let path = buildPathThroughWaypoints([start, ...waypoints.map(({ x, y }) => ({ x, y })), end]);
  for (let repairPass = 0; repairPass < 4; repairPass += 1) {
    if (!path.some((point) => isBlockedForGuaranteedConnector(state, point, startIdx, endIdx))) {
      break;
    }
    path = repairBlockedPolylinePath(state, path, startIdx, endIdx);
  }
  if (path.length === 0) {
    return { path: [], bridgeTileIndices: [], failureReason: "blocked-endpoint" };
  }
  if (path.some((point) => isBlockedForGuaranteedConnector(state, point, startIdx, endIdx))) {
    return { path: [], bridgeTileIndices: [], failureReason: "blocked-endpoint" };
  }
  if (path.length > maxPathLength) {
    return { path: [], bridgeTileIndices: [], failureReason: "path-too-long" };
  }
  const summary = summarizePathShape(state, path, heightScale);
  if (summary.blocked) {
    return { path: [], bridgeTileIndices: [], failureReason: "blocked-endpoint" };
  }
  if (summary.shorelineTouches < 8) {
    return { path: [], bridgeTileIndices: [], failureReason: "insufficient-shoreline" };
  }
  if (summary.meanEarthwork > 0.11) {
    return { path: [], bridgeTileIndices: [], failureReason: "excessive-earthwork" };
  }
  return { path, bridgeTileIndices: summary.bridgeTileIndices, failureReason: null };
};

const buildSidehillContourPolyline = (
  state: WorldState,
  start: Point,
  end: Point,
  startIdx: number,
  endIdx: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  maxPathLength: number,
  heightScale: number
): { path: Point[]; bridgeTileIndices: number[]; failureReason: GuaranteedTownConnectorStyleAttempt["failureReason"] } => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const routeLength = Math.max(1, Math.hypot(dx, dy));
  const lengthSq = Math.max(1, dx * dx + dy * dy);
  const startElevation = getElevation(state, start.x, start.y);
  const endElevation = getElevation(state, end.x, end.y);
  const bucketCount = 16;
  const bySide = new Map<number, Array<Point & { t: number; score: number }>>();
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const idx = indexFor(state.grid, x, y);
      const tile = state.tiles[idx];
      if (isBlockedForGuaranteedConnector(state, { x, y }, startIdx, endIdx) || tile?.type === "water") {
        continue;
      }
      const relX = x - start.x;
      const relY = y - start.y;
      const t = (relX * dx + relY * dy) / lengthSq;
      if (t < 0.06 || t > 0.94) {
        continue;
      }
      const cross = relX * dy - relY * dx;
      const side = cross < 0 ? -1 : 1;
      const lineDistance = Math.abs(cross) / routeLength;
      const preferredOffset = Math.min(42, Math.max(12, routeLength * 0.18));
      const elevation = tile?.elevation ?? 0;
      const targetElevation = startElevation + (endElevation - startElevation) * t;
      const gradeBandPenalty = Math.abs(elevation - targetElevation) * 130;
      const shelfPenalty = localRelief(state, x, y) * 260;
      const lipScore = getLakeLipScore(state, x, y);
      const waterDistance = Math.max(0, Math.min(12, tile?.waterDist ?? 12));
      const nearWaterShelfBonus = Math.max(0, 1 - Math.abs(waterDistance - 2.5) / 5) * 3.5;
      const offsetPenalty = Math.abs(lineDistance - preferredOffset) * 0.12 + (lineDistance < 7 ? (7 - lineDistance) * 1.4 : 0);
      const score =
        shelfPenalty +
        gradeBandPenalty +
        offsetPenalty +
        Math.abs(t - 0.5) * 0.25 -
        lipScore * 6 -
        nearWaterShelfBonus;
      const list = bySide.get(side) ?? [];
      list.push({ x, y, t, score });
      bySide.set(side, list);
    }
  }

  let bestPath: Point[] = [];
  let bestSummary: ReturnType<typeof summarizePathShape> | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidates of bySide.values()) {
    const buckets: Array<(Point & { t: number; score: number }) | null> = Array.from({ length: bucketCount }, () => null);
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i]!;
      const bucket = Math.max(0, Math.min(bucketCount - 1, Math.floor(candidate.t * bucketCount)));
      const existing = buckets[bucket];
      if (
        !existing ||
        candidate.score < existing.score ||
        (candidate.score === existing.score && (candidate.y < existing.y || (candidate.y === existing.y && candidate.x < existing.x)))
      ) {
        buckets[bucket] = candidate;
      }
    }
    const waypoints = buckets.filter((point): point is Point & { t: number; score: number } => point !== null);
    if (waypoints.length < 3) {
      continue;
    }
    waypoints.sort((left, right) => left.t - right.t || left.y - right.y || left.x - right.x);
    let path = buildPathThroughWaypoints([start, ...waypoints.map(({ x, y }) => ({ x, y })), end]);
    for (let repairPass = 0; repairPass < 4; repairPass += 1) {
      if (!path.some((point) => isBlockedForGuaranteedConnector(state, point, startIdx, endIdx))) {
        break;
      }
      path = repairBlockedPolylinePath(state, path, startIdx, endIdx);
    }
    if (
      path.length === 0 ||
      path.length > maxPathLength ||
      path.some((point) => isBlockedForGuaranteedConnector(state, point, startIdx, endIdx))
    ) {
      continue;
    }
    const summary = summarizePathShape(state, path, heightScale);
    if (summary.blocked || summary.meanEarthwork > 0.26) {
      continue;
    }
    const totalScore =
      summary.meanEarthwork * 900 +
      path.length * 0.15 -
      summary.shorelineTouches * 0.7 +
      waypoints.reduce((sum, point) => sum + point.score, 0) / waypoints.length;
    if (totalScore < bestScore) {
      bestPath = path;
      bestSummary = summary;
      bestScore = totalScore;
    }
  }
  if (bestPath.length === 0) {
    const controlCandidates: Array<Point & { score: number }> = [];
    for (const candidates of bySide.values()) {
      for (let i = 0; i < candidates.length; i += 1) {
        const candidate = candidates[i]!;
        const startLeg = Math.hypot(candidate.x - start.x, candidate.y - start.y);
        const endLeg = Math.hypot(end.x - candidate.x, end.y - candidate.y);
        if (startLeg + endLeg > maxPathLength * 0.92) {
          continue;
        }
        const idx = indexFor(state.grid, candidate.x, candidate.y);
        const tile = state.tiles[idx];
        const elevation = tile?.elevation ?? 0;
        const targetElevation = startElevation + (endElevation - startElevation) * candidate.t;
        const lakeLip = getLakeLipScore(state, candidate.x, candidate.y);
        const waterDistance = Math.max(0, Math.min(12, tile?.waterDist ?? 12));
        const waterShelfBonus = Math.max(0, 1 - Math.abs(waterDistance - 2.5) / 5);
        const score =
          startLeg * 0.12 +
          endLeg * 0.12 +
          localRelief(state, candidate.x, candidate.y) * 240 +
          Math.abs(elevation - targetElevation) * 95 -
          lakeLip * 18 -
          waterShelfBonus * 8 -
          Math.min(22, Math.hypot(candidate.x - start.x, candidate.y - start.y)) * 0.04;
        controlCandidates.push({ x: candidate.x, y: candidate.y, score });
      }
    }
    controlCandidates.sort((left, right) => left.score - right.score || left.y - right.y || left.x - right.x);
    const maxControlsToTry = Math.min(48, controlCandidates.length);
    for (let controlIndex = 0; controlIndex < maxControlsToTry; controlIndex += 1) {
      const bestControl = controlCandidates[controlIndex]!;
      let path = buildPathThroughWaypoints([start, bestControl, end]);
      for (let repairPass = 0; repairPass < 4; repairPass += 1) {
        if (!path.some((point) => isBlockedForGuaranteedConnector(state, point, startIdx, endIdx))) {
          break;
        }
        path = repairBlockedPolylinePath(state, path, startIdx, endIdx);
      }
      if (
        path.length > 0 &&
        path.length <= maxPathLength &&
        !path.some((point) => isBlockedForGuaranteedConnector(state, point, startIdx, endIdx))
      ) {
        const summary = summarizePathShape(state, path, heightScale);
        if (!summary.blocked && summary.meanEarthwork <= 0.6) {
          bestPath = path;
          bestSummary = summary;
          break;
        }
      }
    }
  }
  if (bestPath.length === 0 || !bestSummary) {
    return { path: [], bridgeTileIndices: [], failureReason: "no-path" };
  }
  return { path: bestPath, bridgeTileIndices: bestSummary.bridgeTileIndices, failureReason: null };
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
  const baseMaxPathLength = Math.max(24, Math.ceil(directDistance * (options.maxPathLengthMultiplier ?? 3.2)));
  const padding = Math.max(32, Math.ceil(directDistance * 0.75));
  const minX = Math.max(0, Math.min(start.x, end.x) - padding);
  const maxX = Math.min(state.grid.cols - 1, Math.max(start.x, end.x) + padding);
  const minY = Math.max(0, Math.min(start.y, end.y) - padding);
  const maxY = Math.min(state.grid.rows - 1, Math.max(start.y, end.y) + padding);
  const total = state.grid.totalTiles;
  const styleAttempts: GuaranteedTownConnectorStyleAttempt[] = [];
  if (
    isBlockedForGuaranteedConnector(state, start, startIdx, endIdx) ||
    isBlockedForGuaranteedConnector(state, end, startIdx, endIdx)
  ) {
    return {
      path: [],
      bridgeTileIndices: [],
      visitedNodes: 0,
      maxPathLength: baseMaxPathLength,
      style: null,
      styleAttempts,
      failureReason: "blocked-endpoint"
    };
  }
  const heightScale = options.heightScaleMultiplier ?? 1;
  const startElevation = getElevation(state, start.x, start.y);
  const endElevation = getElevation(state, end.x, end.y);
  let totalVisitedNodes = 0;
  let lastFailureReason: GuaranteedTownConnectorResult["failureReason"] = "no-path";

  const shorelineProfile = SEARCH_PROFILES[0]!;
  const shorelineMaxPathLength = Math.max(24, Math.ceil(directDistance * (shorelineProfile.maxPathMultiplier ?? 3.2)));
  const shorelinePolyline = buildShorelineContourPolyline(
    state,
    start,
    end,
    startIdx,
    endIdx,
    minX,
    maxX,
    minY,
    maxY,
    shorelineMaxPathLength,
    heightScale
  );
  if (shorelinePolyline.path.length > 0) {
    styleAttempts.push({
      style: "shoreline-contour",
      pathLength: shorelinePolyline.path.length,
      bridgeCount: shorelinePolyline.bridgeTileIndices.length,
      visitedNodes: 0,
      failureReason: null
    });
    return {
      path: shorelinePolyline.path,
      bridgeTileIndices: shorelinePolyline.bridgeTileIndices,
      visitedNodes: 0,
      maxPathLength: shorelineMaxPathLength,
      style: "shoreline-contour",
      styleAttempts,
      failureReason: null
    };
  }
  styleAttempts.push({
    style: "shoreline-contour",
    pathLength: 0,
    bridgeCount: 0,
    visitedNodes: 0,
    failureReason: shorelinePolyline.failureReason ?? "no-path"
  });

  const sidehillProfile = SEARCH_PROFILES[1]!;
  const sidehillMaxPathLength = Math.max(24, Math.ceil(directDistance * (sidehillProfile.maxPathMultiplier ?? 3.2)));
  const sidehillPolyline = buildSidehillContourPolyline(
    state,
    start,
    end,
    startIdx,
    endIdx,
    minX,
    maxX,
    minY,
    maxY,
    sidehillMaxPathLength,
    heightScale
  );
  if (sidehillPolyline.path.length > 0) {
    styleAttempts.push({
      style: "sidehill-contour",
      pathLength: sidehillPolyline.path.length,
      bridgeCount: sidehillPolyline.bridgeTileIndices.length,
      visitedNodes: 0,
      failureReason: null
    });
    return {
      path: sidehillPolyline.path,
      bridgeTileIndices: sidehillPolyline.bridgeTileIndices,
      visitedNodes: 0,
      maxPathLength: sidehillMaxPathLength,
      style: "sidehill-contour",
      styleAttempts,
      failureReason: null
    };
  }
  const sidehillPolylineFailureReason = sidehillPolyline.failureReason ?? "no-path";

  for (let profileIndex = 1; profileIndex < SEARCH_PROFILES.length; profileIndex += 1) {
    const profile = SEARCH_PROFILES[profileIndex]!;
    const maxPathLength = Math.max(24, Math.ceil(directDistance * (profile.maxPathMultiplier ?? options.maxPathLengthMultiplier ?? 3.2)));
    const costs = new Float64Array(total);
    const prev = new Int32Array(total);
    const pathLength = new Int32Array(total);
    costs.fill(Number.POSITIVE_INFINITY);
    prev.fill(-1);
    pathLength.fill(0);
    const queue: QueueEntry[] = [];
    costs[startIdx] = 0;
    const reliefCache = new Float32Array(total);
    const lakeLipCache = new Float32Array(total);
    reliefCache.fill(-1);
    lakeLipCache.fill(-1);
    const getCachedRelief = (x: number, y: number): number => {
      const idx = indexFor(state.grid, x, y);
      const cached = reliefCache[idx];
      if (cached >= 0) {
        return cached;
      }
      const value = localRelief(state, x, y);
      reliefCache[idx] = value;
      return value;
    };
    const getCachedLakeLipScore = (x: number, y: number): number => {
      const idx = indexFor(state.grid, x, y);
      const cached = lakeLipCache[idx];
      if (cached >= 0) {
        return cached;
      }
      const value = getLakeLipScore(state, x, y);
      lakeLipCache[idx] = value;
      return value;
    };
    const getCachedEarthworkPenalty = (
      currentIndex: number,
      nextIndex: number,
      stepDistance: number
    ): number => {
      const currentElevation = state.tiles[currentIndex]?.elevation ?? 0;
      const nextElevation = state.tiles[nextIndex]?.elevation ?? currentElevation;
      const nx = nextIndex % state.grid.cols;
      const ny = Math.floor(nextIndex / state.grid.cols);
      const grade = Math.abs(nextElevation - currentElevation) * heightScale / Math.max(1e-6, stepDistance);
      const relief = getCachedRelief(nx, ny);
      const shelfPenalty = Math.max(0, relief - 0.026) * 1.8;
      const gradePenalty = Math.max(0, grade - 0.14) * 2.6;
      return relief * 0.9 + shelfPenalty + gradePenalty;
    };
    pushQueue(queue, { idx: startIdx, cost: 0, priority: directDistance });
    let visitedNodes = 0;
    while (queue.length > 0) {
      const current = popQueue(queue)!;
      const cx = current.idx % state.grid.cols;
      const cy = Math.floor(current.idx / state.grid.cols);
      visitedNodes += 1;
      if (visitedNodes > profile.maxVisitedNodes) {
        break;
      }
      if (current.idx === endIdx) {
        break;
      }
      if (pathLength[current.idx] >= maxPathLength) {
        continue;
      }
      const currentElevation = state.tiles[current.idx]?.elevation ?? 0;
      const previousIdx = prev[current.idx] ?? -1;
      const previousElevation = previousIdx >= 0 ? state.tiles[previousIdx]?.elevation ?? currentElevation : currentElevation;
      const previousGradeSign = Math.sign(currentElevation - previousElevation);
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
        const nextGradeSign = Math.sign(elevation - currentElevation);
        const sustainedClimb =
          previousGradeSign !== 0 && previousGradeSign === nextGradeSign && Math.abs(elevation - currentElevation) > 0.018;
        const waterCost = tile?.type === "water" && (state.tileRoadBridge[nIdx] ?? 0) === 0 ? profile.waterCost : 0;
        const reliefCost = getCachedRelief(nx, ny) * profile.reliefWeight;
        const gradeCost = grade * profile.gradeWeight + Math.max(0, grade - 0.22) * profile.steepGradeWeight;
        const shorelineBonus = profile.shorelineBonus > 0 ? getCachedLakeLipScore(nx, ny) * profile.shorelineBonus : 0;
        const contourCost =
          profile.contourWeight > 0 ? getContourScore(state, current.idx, nIdx, startElevation, endElevation) * profile.contourWeight : 0;
        const earthworkCost =
          profile.earthworkWeight > 0 ? getCachedEarthworkPenalty(current.idx, nIdx, stepDistance) * profile.earthworkWeight : 0;
        const straightClimbCost = sustainedClimb ? profile.straightClimbWeight : 0;
        const roadBonus = isRoadLike(state, nx, ny) ? profile.roadBonus : 0;
        const nextCost =
          costs[current.idx] +
          stepDistance * profile.distanceWeight +
          waterCost +
          reliefCost +
          gradeCost +
          contourCost +
          earthworkCost +
          straightClimbCost +
          roadBonus -
          shorelineBonus;
        if (nextCost >= costs[nIdx]) {
          continue;
        }
        costs[nIdx] = nextCost;
        prev[nIdx] = current.idx;
        pathLength[nIdx] = pathLength[current.idx] + 1;
        const heuristic = Math.hypot(end.x - nx, end.y - ny) * profile.distanceWeight;
        pushQueue(queue, { idx: nIdx, cost: nextCost, priority: nextCost + heuristic });
      }
    }
    totalVisitedNodes += visitedNodes;
    if (!Number.isFinite(costs[endIdx])) {
      styleAttempts.push({
        style: profile.style,
        pathLength: 0,
        bridgeCount: 0,
        visitedNodes,
        failureReason: profile.style === "sidehill-contour" ? sidehillPolylineFailureReason : "no-path"
      });
      lastFailureReason = "no-path";
      continue;
    }
    const path = reconstructPath(prev, startIdx, endIdx, state.grid.cols);
    if (path.length === 0) {
      styleAttempts.push({ style: profile.style, pathLength: 0, bridgeCount: 0, visitedNodes, failureReason: "no-path" });
      lastFailureReason = "no-path";
      continue;
    }
    if (path.length > maxPathLength) {
      styleAttempts.push({ style: profile.style, pathLength: path.length, bridgeCount: 0, visitedNodes, failureReason: "path-too-long" });
      lastFailureReason = "path-too-long";
      continue;
    }
    const bridgeTileIndices = path
      .map((point) => indexFor(state.grid, point.x, point.y))
      .filter((idx) => state.tiles[idx]?.type === "water" && (state.tileRoadBridge[idx] ?? 0) === 0);
    let shorelineTouches = 0;
    let earthworkTotal = 0;
    for (let i = 0; i < path.length; i += 1) {
      const point = path[i]!;
      const idx = indexFor(state.grid, point.x, point.y);
      if (getCachedLakeLipScore(point.x, point.y) > 0.36) {
        shorelineTouches += 1;
      }
      if (i > 0) {
        const previous = path[i - 1]!;
        const previousIdx = indexFor(state.grid, previous.x, previous.y);
        earthworkTotal += getCachedEarthworkPenalty(previousIdx, idx, Math.hypot(point.x - previous.x, point.y - previous.y));
      }
    }
    const meanEarthwork = path.length > 1 ? earthworkTotal / (path.length - 1) : 0;
    if (profile.minShorelineTouches !== undefined && shorelineTouches < profile.minShorelineTouches) {
      styleAttempts.push({
        style: profile.style,
        pathLength: path.length,
        bridgeCount: bridgeTileIndices.length,
        visitedNodes,
        failureReason: "insufficient-shoreline"
      });
      lastFailureReason = "insufficient-shoreline";
      continue;
    }
    if (profile.maxMeanEarthwork !== undefined && meanEarthwork > profile.maxMeanEarthwork) {
      styleAttempts.push({
        style: profile.style,
        pathLength: path.length,
        bridgeCount: bridgeTileIndices.length,
        visitedNodes,
        failureReason: "excessive-earthwork"
      });
      lastFailureReason = "excessive-earthwork";
      continue;
    }
    styleAttempts.push({
      style: profile.style,
      pathLength: path.length,
      bridgeCount: bridgeTileIndices.length,
      visitedNodes,
      failureReason: null
    });
    return {
      path,
      bridgeTileIndices,
      visitedNodes: totalVisitedNodes,
      maxPathLength,
      style: profile.style,
      styleAttempts,
      failureReason: null
    };
  }
  return {
    path: [],
    bridgeTileIndices: [],
    visitedNodes: totalVisitedNodes,
    maxPathLength: baseMaxPathLength,
    style: null,
    styleAttempts,
    failureReason: lastFailureReason
  };
};
