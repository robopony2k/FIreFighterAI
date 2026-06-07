import {
  buildRoadStreamerJoinOffsets,
  cloneRoadPathPlannerNodeState,
  createInitialRoadPathPlannerNodeState
} from "./roadTerrainCost.js";
import type {
  RoadPathPlannerFront,
  RoadPathPlannerInput,
  RoadPathPlannerNodeState,
  RoadPathPlannerResult
} from "../types/roadPathPlannerTypes.js";

type Frontier = {
  front: RoadPathPlannerFront;
  gScore: Float64Array;
  prev: Int32Array;
  closed: Uint8Array;
  states: Array<RoadPathPlannerNodeState | null>;
  openIdx: number[];
  openCost: number[];
  visitedNodes: number;
};

type JoinCandidate = {
  originIndex: number;
  destinationIndex: number;
  cost: number;
  joinPath: number[];
};

const heapPush = (openIdx: number[], openCost: number[], idx: number, cost: number): void => {
  let i = openIdx.length;
  openIdx.push(idx);
  openCost.push(cost);
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (openCost[parent] <= cost) {
      break;
    }
    openIdx[i] = openIdx[parent];
    openCost[i] = openCost[parent];
    i = parent;
  }
  openIdx[i] = idx;
  openCost[i] = cost;
};

const heapPop = (openIdx: number[], openCost: number[]): number => {
  if (openIdx.length === 0) {
    return -1;
  }
  const result = openIdx[0];
  const lastIdx = openIdx.pop() as number;
  const lastCost = openCost.pop() as number;
  if (openIdx.length > 0) {
    let i = 0;
    while (true) {
      const left = i * 2 + 1;
      if (left >= openIdx.length) {
        break;
      }
      const right = left + 1;
      let child = left;
      if (right < openIdx.length && openCost[right] < openCost[left]) {
        child = right;
      }
      if (openCost[child] >= lastCost) {
        break;
      }
      openIdx[i] = openIdx[child];
      openCost[i] = openCost[child];
      i = child;
    }
    openIdx[i] = lastIdx;
    openCost[i] = lastCost;
  }
  return result;
};

const createFrontier = (front: RoadPathPlannerFront, totalTiles: number): Frontier => ({
  front,
  gScore: new Float64Array(totalTiles),
  prev: new Int32Array(totalTiles),
  closed: new Uint8Array(totalTiles),
  states: new Array<RoadPathPlannerNodeState | null>(totalTiles).fill(null),
  openIdx: [],
  openCost: [],
  visitedNodes: 0
});

const initializeFrontier = (frontier: Frontier): void => {
  frontier.gScore.fill(Number.POSITIVE_INFINITY);
  frontier.prev.fill(-1);
};

const traceToRoot = (prev: Int32Array, index: number, totalTiles: number): number[] => {
  const path: number[] = [];
  const guard = new Uint8Array(totalTiles);
  let current = index;
  while (current >= 0) {
    if (guard[current] > 0) {
      return [];
    }
    guard[current] = 1;
    path.push(current);
    if (prev[current] === current) {
      return path;
    }
    current = prev[current];
  }
  return [];
};

const buildJoinedPath = (
  origin: Frontier,
  destination: Frontier,
  join: JoinCandidate,
  totalTiles: number
): number[] => {
  const originTrace = traceToRoot(origin.prev, join.originIndex, totalTiles);
  const destinationTrace = traceToRoot(destination.prev, join.destinationIndex, totalTiles);
  if (originTrace.length === 0 || destinationTrace.length === 0) {
    return [];
  }
  originTrace.reverse();
  if (join.originIndex === join.destinationIndex) {
    return [...originTrace, ...destinationTrace.slice(1)];
  }
  return [...originTrace, ...join.joinPath.slice(1, -1), ...destinationTrace];
};

const tryJoinAt = (
  input: RoadPathPlannerInput,
  origin: Frontier,
  destination: Frontier,
  originIndex: number,
  destinationIndex: number
): JoinCandidate | null => {
  const originState = origin.states[originIndex];
  const destinationState = destination.states[destinationIndex];
  if (!originState || !destinationState || !Number.isFinite(origin.gScore[originIndex]) || !Number.isFinite(destination.gScore[destinationIndex])) {
    return null;
  }
  const join = input.validateJoin(originIndex, destinationIndex, originState, destinationState);
  if (!join || join.pathIndices.length === 0) {
    return null;
  }
  return {
    originIndex,
    destinationIndex,
    cost: origin.gScore[originIndex] + destination.gScore[destinationIndex] + join.cost,
    joinPath: join.pathIndices
  };
};

const findJoinCandidate = (
  input: RoadPathPlannerInput,
  active: Frontier,
  passive: Frontier,
  currentIndex: number,
  joinOffsets: Array<{ dx: number; dy: number }>
): JoinCandidate | null => {
  const cx = currentIndex % input.cols;
  const cy = Math.floor(currentIndex / input.cols);
  let best: JoinCandidate | null = null;
  for (let i = 0; i < joinOffsets.length; i += 1) {
    const offset = joinOffsets[i]!;
    const nx = cx + offset.dx;
    const ny = cy + offset.dy;
    if (nx < 0 || nx >= input.cols || ny < 0 || ny >= input.rows) {
      continue;
    }
    const otherIndex = ny * input.cols + nx;
    if (!passive.states[otherIndex] || !Number.isFinite(passive.gScore[otherIndex])) {
      continue;
    }
    const candidate =
      active.front === "origin"
        ? tryJoinAt(input, active, passive, currentIndex, otherIndex)
        : tryJoinAt(input, passive, active, otherIndex, currentIndex);
    if (!candidate) {
      continue;
    }
    if (
      !best ||
      candidate.cost < best.cost - 1e-7 ||
      (Math.abs(candidate.cost - best.cost) <= 1e-7 &&
        (candidate.originIndex < best.originIndex ||
          (candidate.originIndex === best.originIndex && candidate.destinationIndex < best.destinationIndex)))
    ) {
      best = candidate;
    }
  }
  return best;
};

const chooseFrontier = (origin: Frontier, destination: Frontier): Frontier | null => {
  if (origin.openIdx.length === 0 && destination.openIdx.length === 0) {
    return null;
  }
  if (origin.openIdx.length === 0) {
    return destination;
  }
  if (destination.openIdx.length === 0) {
    return origin;
  }
  if (origin.openCost[0] <= destination.openCost[0]) {
    return origin;
  }
  return destination;
};

const finish = (
  input: RoadPathPlannerInput,
  origin: Frontier,
  destination: Frontier,
  bestJoin: JoinCandidate | null,
  budgetAborted: boolean,
  visitedNodes: number
): RoadPathPlannerResult => {
  const pathIndices = bestJoin ? buildJoinedPath(origin, destination, bestJoin, input.totalTiles) : [];
  const destinationSeedIndex = pathIndices.length > 0 ? pathIndices[pathIndices.length - 1] ?? -1 : -1;
  const selectedDestinationSeed =
    destinationSeedIndex >= 0
      ? input.destinationSeeds.find((seed) => seed.index === destinationSeedIndex) ?? null
      : null;
  return {
    pathIndices,
    bridgeTileIndices: [],
    found: pathIndices.length > 0,
    budgetAborted,
    totalCost: pathIndices.length > 0 ? bestJoin?.cost ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY,
    selectedDestinationSeed,
    failureReason: pathIndices.length > 0 ? null : budgetAborted ? "budget-aborted" : "no-route",
    visitedNodes,
    originVisitedNodes: origin.visitedNodes,
    destinationVisitedNodes: destination.visitedNodes,
    joinedOriginIndex: bestJoin?.originIndex ?? -1,
    joinedDestinationIndex: bestJoin?.destinationIndex ?? -1,
    destinationSeedIndex
  };
};

const runStreamerSync = (input: RoadPathPlannerInput): RoadPathPlannerResult => {
  input.checkCancelled?.();
  const initial = cloneRoadPathPlannerNodeState(input.initialState ?? createInitialRoadPathPlannerNodeState());
  const origin = createFrontier("origin", input.totalTiles);
  const destination = createFrontier("destination", input.totalTiles);
  initializeFrontier(origin);
  initializeFrontier(destination);

  origin.gScore[input.startIndex] = 0;
  origin.prev[input.startIndex] = input.startIndex;
  origin.states[input.startIndex] = cloneRoadPathPlannerNodeState(initial);
  heapPush(origin.openIdx, origin.openCost, input.startIndex, 0);

  for (let i = 0; i < input.destinationSeeds.length; i += 1) {
    const seed = input.destinationSeeds[i]!;
    if (seed.index < 0 || seed.index >= input.totalTiles || Number.isFinite(destination.gScore[seed.index])) {
      continue;
    }
    const priority = Math.max(0, seed.priority ?? 0);
    destination.gScore[seed.index] = priority;
    destination.prev[seed.index] = seed.index;
    destination.states[seed.index] = cloneRoadPathPlannerNodeState(initial);
    heapPush(destination.openIdx, destination.openCost, seed.index, priority);
  }

  const joinOffsets = buildRoadStreamerJoinOffsets(input.joinRadius);
  const maxVisits = Math.max(0, Math.floor(input.maxSearchNodeVisits ?? 0));
  let bestJoin: JoinCandidate | null = null;
  let visitedNodes = 0;

  while (true) {
    input.checkCancelled?.();
    const active = chooseFrontier(origin, destination);
    if (!active) {
      break;
    }
    if (bestJoin && active.openCost.length > 0 && active.openCost[0] >= bestJoin.cost - 1e-7) {
      break;
    }
    const passive = active === origin ? destination : origin;
    const currentIndex = heapPop(active.openIdx, active.openCost);
    if (currentIndex < 0 || active.closed[currentIndex]) {
      continue;
    }
    active.closed[currentIndex] = 1;
    active.visitedNodes += 1;
    visitedNodes += 1;
    const progress = {
      visitedNodes,
      openNodes: origin.openIdx.length + destination.openIdx.length,
      currentIndex
    };
    input.onProgress?.(progress);
    if (maxVisits > 0 && visitedNodes > maxVisits) {
      return finish(input, origin, destination, bestJoin, true, visitedNodes);
    }
    const joined = findJoinCandidate(input, active, passive, currentIndex, joinOffsets);
    if (joined && (!bestJoin || joined.cost < bestJoin.cost - 1e-7)) {
      bestJoin = joined;
    }
    const currentState = active.states[currentIndex];
    if (!currentState) {
      continue;
    }
    const cx = currentIndex % input.cols;
    const cy = Math.floor(currentIndex / input.cols);
    for (let i = 0; i < input.directions.length; i += 1) {
      const direction = input.directions[i]!;
      const nx = cx + direction.x;
      const ny = cy + direction.y;
      if (nx < 0 || nx >= input.cols || ny < 0 || ny >= input.rows) {
        continue;
      }
      const nextIndex = ny * input.cols + nx;
      if (active.closed[nextIndex]) {
        continue;
      }
      const step = input.evaluateStep(active.front, currentIndex, nextIndex, direction, currentState);
      if (!step) {
        continue;
      }
      const nextCost = active.gScore[currentIndex] + step.cost;
      if (nextCost >= active.gScore[nextIndex] - 1e-7) {
        continue;
      }
      active.gScore[nextIndex] = nextCost;
      active.prev[nextIndex] = currentIndex;
      active.states[nextIndex] = step.state;
      heapPush(active.openIdx, active.openCost, nextIndex, nextCost);
    }
  }

  return finish(input, origin, destination, bestJoin, false, visitedNodes);
};

export const planRoadPathBidirectionalStreamer = (input: RoadPathPlannerInput): RoadPathPlannerResult => {
  return runStreamerSync(input);
};

export const planRoadPathBidirectionalStreamerAsync = (
  input: RoadPathPlannerInput
): Promise<RoadPathPlannerResult> => {
  return Promise.resolve(runStreamerSync(input));
};
