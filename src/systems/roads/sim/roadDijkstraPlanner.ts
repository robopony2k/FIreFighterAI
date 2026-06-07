import {
  cloneRoadPathPlannerNodeState,
  createInitialRoadPathPlannerNodeState
} from "./roadTerrainCost.js";
import type {
  RoadDestinationSeed,
  RoadPathPlannerInput,
  RoadPathPlannerNodeState,
  RoadPathPlannerProgress,
  RoadPathPlannerResult
} from "../types/roadPathPlannerTypes.js";

type OpenEntry = {
  index: number;
  cost: number;
};

type SeedCandidate = {
  seed: RoadDestinationSeed;
  order: number;
};

type BestDestination = {
  seed: RoadDestinationSeed;
  order: number;
  index: number;
  cost: number;
};

const COST_EPSILON = 1e-7;

const compareOpenEntry = (left: OpenEntry, right: OpenEntry): number => {
  const costDelta = left.cost - right.cost;
  if (Math.abs(costDelta) > COST_EPSILON) {
    return costDelta;
  }
  return left.index - right.index;
};

const heapPush = (heap: OpenEntry[], entry: OpenEntry): void => {
  let i = heap.length;
  heap.push(entry);
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (compareOpenEntry(heap[parent]!, entry) <= 0) {
      break;
    }
    heap[i] = heap[parent]!;
    i = parent;
  }
  heap[i] = entry;
};

const heapPop = (heap: OpenEntry[]): OpenEntry | null => {
  if (heap.length === 0) {
    return null;
  }
  const result = heap[0]!;
  const last = heap.pop()!;
  if (heap.length > 0) {
    let i = 0;
    while (true) {
      const left = i * 2 + 1;
      if (left >= heap.length) {
        break;
      }
      const right = left + 1;
      let child = left;
      if (right < heap.length && compareOpenEntry(heap[right]!, heap[left]!) < 0) {
        child = right;
      }
      if (compareOpenEntry(heap[child]!, last) >= 0) {
        break;
      }
      heap[i] = heap[child]!;
      i = child;
    }
    heap[i] = last;
  }
  return result;
};

const tracePath = (prev: Int32Array, startIndex: number, endIndex: number, totalTiles: number): number[] => {
  const path: number[] = [];
  const guard = new Uint8Array(totalTiles);
  let current = endIndex;
  while (current >= 0) {
    if (guard[current] > 0) {
      return [];
    }
    guard[current] = 1;
    path.push(current);
    if (current === startIndex) {
      path.reverse();
      return path;
    }
    current = prev[current] ?? -1;
  }
  return [];
};

const cloneSeed = (seed: RoadDestinationSeed): RoadDestinationSeed => ({
  index: seed.index,
  point: { ...seed.point },
  priority: seed.priority,
  kind: seed.kind,
  label: seed.label
});

const chooseSeedForIndex = (seeds: SeedCandidate[]): SeedCandidate => {
  let best = seeds[0]!;
  for (let i = 1; i < seeds.length; i += 1) {
    const candidate = seeds[i]!;
    const priorityDelta = Math.max(0, candidate.seed.priority ?? 0) - Math.max(0, best.seed.priority ?? 0);
    if (
      priorityDelta < -COST_EPSILON ||
      (Math.abs(priorityDelta) <= COST_EPSILON && candidate.order < best.order)
    ) {
      best = candidate;
    }
  }
  return best;
};

const isBetterDestination = (candidate: BestDestination, best: BestDestination | null): boolean => {
  if (!best) {
    return true;
  }
  const costDelta = candidate.cost - best.cost;
  if (costDelta < -COST_EPSILON) {
    return true;
  }
  if (Math.abs(costDelta) > COST_EPSILON) {
    return false;
  }
  if (candidate.index !== best.index) {
    return candidate.index < best.index;
  }
  return candidate.order < best.order;
};

const finish = (
  input: RoadPathPlannerInput,
  prev: Int32Array,
  best: BestDestination | null,
  budgetAborted: boolean,
  visitedNodes: number,
  openNodes: number
): RoadPathPlannerResult => {
  const pathIndices = best ? tracePath(prev, input.startIndex, best.index, input.totalTiles) : [];
  const found = pathIndices.length > 0;
  return {
    pathIndices,
    bridgeTileIndices: [],
    found,
    budgetAborted,
    totalCost: found ? best?.cost ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY,
    selectedDestinationSeed: found && best ? cloneSeed(best.seed) : null,
    failureReason: found ? null : budgetAborted ? "budget-aborted" : "no-route",
    visitedNodes,
    originVisitedNodes: visitedNodes,
    destinationVisitedNodes: 0,
    joinedOriginIndex: found ? input.startIndex : -1,
    joinedDestinationIndex: found ? best?.index ?? -1 : -1,
    destinationSeedIndex: found ? best?.index ?? -1 : -1
  };
};

const buildSeedMap = (input: RoadPathPlannerInput): Map<number, SeedCandidate[]> => {
  const byIndex = new Map<number, SeedCandidate[]>();
  for (let i = 0; i < input.destinationSeeds.length; i += 1) {
    const seed = input.destinationSeeds[i]!;
    if (seed.index < 0 || seed.index >= input.totalTiles) {
      continue;
    }
    const existing = byIndex.get(seed.index);
    const candidate = { seed, order: i };
    if (existing) {
      existing.push(candidate);
    } else {
      byIndex.set(seed.index, [candidate]);
    }
  }
  return byIndex;
};

export const planRoadPathDijkstra = (input: RoadPathPlannerInput): RoadPathPlannerResult => {
  input.checkCancelled?.();
  const seedMap = buildSeedMap(input);
  if (seedMap.size === 0) {
    const emptyPrev = new Int32Array(input.totalTiles);
    emptyPrev.fill(-1);
    return {
      ...finish(input, emptyPrev, null, false, 0, 0),
      failureReason: "no-destination-seeds"
    };
  }

  const initial: RoadPathPlannerNodeState = cloneRoadPathPlannerNodeState(
    input.initialState ?? createInitialRoadPathPlannerNodeState()
  );
  const gScore = new Float64Array(input.totalTiles);
  gScore.fill(Number.POSITIVE_INFINITY);
  const prev = new Int32Array(input.totalTiles);
  prev.fill(-1);
  const closed = new Uint8Array(input.totalTiles);
  const states = new Array<RoadPathPlannerNodeState | null>(input.totalTiles).fill(null);
  const open: OpenEntry[] = [];
  const maxVisits = Math.max(0, Math.floor(input.maxSearchNodeVisits ?? 0));

  gScore[input.startIndex] = 0;
  prev[input.startIndex] = input.startIndex;
  states[input.startIndex] = initial;
  heapPush(open, { index: input.startIndex, cost: 0 });

  let best: BestDestination | null = null;
  let visitedNodes = 0;

  while (open.length > 0) {
    input.checkCancelled?.();
    if (best && open[0]!.cost >= best.cost - COST_EPSILON) {
      break;
    }
    const current = heapPop(open);
    if (!current || closed[current.index] > 0) {
      continue;
    }
    if (current.cost > gScore[current.index] + COST_EPSILON) {
      continue;
    }

    closed[current.index] = 1;
    visitedNodes += 1;
    const progress: RoadPathPlannerProgress = {
      visitedNodes,
      openNodes: open.length,
      currentIndex: current.index
    };
    input.onProgress?.(progress);
    if (maxVisits > 0 && visitedNodes > maxVisits) {
      return finish(input, prev, best, true, visitedNodes, open.length);
    }

    const seedCandidates = seedMap.get(current.index);
    if (seedCandidates) {
      const selected = chooseSeedForIndex(seedCandidates);
      const candidate: BestDestination = {
        seed: selected.seed,
        order: selected.order,
        index: current.index,
        cost: gScore[current.index] + Math.max(0, selected.seed.priority ?? 0)
      };
      if (isBetterDestination(candidate, best)) {
        best = candidate;
      }
      if (best && (open.length === 0 || open[0]!.cost >= best.cost - COST_EPSILON)) {
        break;
      }
    }

    const currentState = states[current.index];
    if (!currentState) {
      continue;
    }
    const cx = current.index % input.cols;
    const cy = Math.floor(current.index / input.cols);
    for (let i = 0; i < input.directions.length; i += 1) {
      const direction = input.directions[i]!;
      const nx = cx + direction.x;
      const ny = cy + direction.y;
      if (nx < 0 || nx >= input.cols || ny < 0 || ny >= input.rows) {
        continue;
      }
      const nextIndex = ny * input.cols + nx;
      if (closed[nextIndex] > 0) {
        continue;
      }
      const step = input.evaluateStep("origin", current.index, nextIndex, direction, currentState);
      if (!step) {
        continue;
      }
      const nextCost = gScore[current.index] + step.cost;
      if (nextCost >= gScore[nextIndex] - COST_EPSILON) {
        continue;
      }
      gScore[nextIndex] = nextCost;
      prev[nextIndex] = current.index;
      states[nextIndex] = step.state;
      heapPush(open, { index: nextIndex, cost: nextCost });
    }
  }

  return finish(input, prev, best, false, visitedNodes, open.length);
};

export const planRoadPathDijkstraAsync = async (
  input: RoadPathPlannerInput
): Promise<RoadPathPlannerResult> => {
  input.checkCancelled?.();
  return planRoadPathDijkstra(input);
};
