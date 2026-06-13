import type {
  StaticHydrologyDebugHooks,
  StaticHydrologyLake,
  StaticHydrologyOverflowFailureReason
} from "../types/staticHydrologyTypes.js";

const NEIGHBORS_4 = [
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 }
] as const;

const DIRECT_DROP_MIN = 0.01;
const FLAT_STEP_EPSILON = 0.0015;
const SOURCE_LAKE_ESCAPE_GRACE_TILES = 1;
const MAX_SOURCE_LAKE_ADJACENT_ROUTE_TILES = 2;

export type LakeOverflowRiverPath = {
  lakeId: number;
  outletTargetIndex: number;
  tiles: number[];
  reachedLakeId: number;
  reachedOcean: boolean;
  reachedExistingRiver: boolean;
  terminalReached: boolean;
  failureReason?: StaticHydrologyOverflowFailureReason;
};

export type LakeOverflowRiverRoutingInput = {
  cols: number;
  rows: number;
  elevationMap: ArrayLike<number>;
  riverMask: Uint8Array;
  oceanMask: Uint8Array;
  lakeMask: Uint16Array;
  flowTarget: Int32Array;
  lakes: readonly StaticHydrologyLake[];
  maxSteps: number;
  minVisibleLength: number;
  debug?: StaticHydrologyDebugHooks;
};

const idxAt = (x: number, y: number, cols: number): number => y * cols + x;

const inBounds = (x: number, y: number, cols: number, rows: number): boolean =>
  x >= 0 && y >= 0 && x < cols && y < rows;

const countAdjacentLakeTiles = (
  idx: number,
  lakeId: number,
  input: Pick<LakeOverflowRiverRoutingInput, "cols" | "rows" | "lakeMask">
): number => {
  const { cols, rows, lakeMask } = input;
  const x = idx % cols;
  const y = Math.floor(idx / cols);
  let count = 0;
  for (const dir of NEIGHBORS_4) {
    const nx = x + dir.dx;
    const ny = y + dir.dy;
    if (!inBounds(nx, ny, cols, rows)) {
      continue;
    }
    const nIdx = idxAt(nx, ny, cols);
    if ((lakeMask[nIdx] ?? 0) === lakeId) {
      count += 1;
    }
  }
  return count;
};

const isAdjacentToLake = (
  idx: number,
  lakeId: number,
  input: Pick<LakeOverflowRiverRoutingInput, "cols" | "rows" | "lakeMask">
): boolean => countAdjacentLakeTiles(idx, lakeId, input) > 0;

type RouteCandidate = {
  idx: number;
  score: number;
  downhill: number;
};

const collectCandidateIndexes = (
  current: number,
  flowTarget: number,
  input: LakeOverflowRiverRoutingInput
): number[] => {
  const { cols, rows } = input;
  const indexes: number[] = [];
  const add = (idx: number): void => {
    if (idx < 0 || idx >= cols * rows || indexes.includes(idx)) {
      return;
    }
    indexes.push(idx);
  };
  add(flowTarget);
  const x = current % cols;
  const y = Math.floor(current / cols);
  for (const dir of NEIGHBORS_4) {
    const nx = x + dir.dx;
    const ny = y + dir.dy;
    if (inBounds(nx, ny, cols, rows)) {
      add(idxAt(nx, ny, cols));
    }
  }
  return indexes;
};

const canUseTerminalCandidate = (
  tilesLength: number,
  currentEscapedSourceLake: boolean,
  candidateEscapesSourceLake: boolean,
  minVisibleLength: number
): boolean =>
  tilesLength <= SOURCE_LAKE_ESCAPE_GRACE_TILES ||
  currentEscapedSourceLake ||
  candidateEscapesSourceLake ||
  tilesLength >= minVisibleLength;

const chooseNextRouteCandidate = (
  current: number,
  lake: StaticHydrologyLake,
  tilesLength: number,
  visited: Uint8Array,
  input: LakeOverflowRiverRoutingInput
): number => {
  const { cols, rows, elevationMap, riverMask, oceanMask, lakeMask, flowTarget, minVisibleLength } = input;
  const currentElevation = elevationMap[current] ?? lake.surfaceLevel;
  const currentAdjacentToSourceLake = isAdjacentToLake(current, lake.id, input);
  let best: RouteCandidate | null = null;

  for (const nIdx of collectCandidateIndexes(current, flowTarget[current] ?? -1, input)) {
    if (nIdx === current || visited[nIdx] > 0) {
      continue;
    }
    const targetLakeId = lakeMask[nIdx] ?? 0;
    if (targetLakeId === lake.id) {
      continue;
    }
    const isOcean = oceanMask[nIdx] > 0;
    const isOtherLake = targetLakeId > 0;
    const reachesExistingRiver = riverMask[nIdx] > 0;
    const terminal = isOcean || isOtherLake || reachesExistingRiver;
    const candidateAdjacentToSourceLake = isAdjacentToLake(nIdx, lake.id, input);
    if (
      terminal &&
      !canUseTerminalCandidate(
        tilesLength,
        !currentAdjacentToSourceLake,
        !candidateAdjacentToSourceLake,
        minVisibleLength
      )
    ) {
      continue;
    }
    const nElevation = elevationMap[nIdx] ?? currentElevation;
    const downhill = Math.max(0, currentElevation - nElevation);
    const uphill = Math.max(0, nElevation - currentElevation);
    const flat = downhill < FLAT_STEP_EPSILON && uphill < FLAT_STEP_EPSILON;
    const nx = nIdx % cols;
    const ny = Math.floor(nIdx / cols);
    const edgeDistance = Math.min(nx, ny, cols - 1 - nx, rows - 1 - ny);
    const followsFlowTarget = (flowTarget[current] ?? -1) === nIdx;
    const sourceLakeNeighborCount = countAdjacentLakeTiles(nIdx, lake.id, input);
    let score =
      nElevation * 2 +
      uphill * 65 -
      downhill * 38 +
      edgeDistance * 0.002 +
      (followsFlowTarget ? -0.75 : 0) +
      (terminal ? -4 : 0);

    if (downhill >= DIRECT_DROP_MIN) {
      score -= 18 + downhill * 95;
    } else if (flat) {
      score += 8;
    }
    if (currentAdjacentToSourceLake && !candidateAdjacentToSourceLake) {
      score -= 12;
    }
    if (candidateAdjacentToSourceLake && tilesLength > SOURCE_LAKE_ESCAPE_GRACE_TILES) {
      score += 28 + sourceLakeNeighborCount * 8 + tilesLength * 0.6;
    }
    if (uphill > DIRECT_DROP_MIN * 0.5 && tilesLength > 0) {
      score += 10;
    }

    if (
      !best ||
      score < best.score ||
      (score === best.score && (downhill > best.downhill || (downhill === best.downhill && nIdx < best.idx)))
    ) {
      best = { idx: nIdx, score, downhill };
    }
  }

  return best?.idx ?? -1;
};

const buildLakeOverflowPath = async (
  lake: StaticHydrologyLake,
  input: LakeOverflowRiverRoutingInput
): Promise<LakeOverflowRiverPath> => {
  const { cols, rows, riverMask, oceanMask, lakeMask, flowTarget, maxSteps, minVisibleLength } = input;
  const total = cols * rows;
  const tiles: number[] = [];
  const visited = new Uint8Array(total);
  let current = lake.outletTargetIndex;
  let reachedLakeId = 0;
  let reachedOcean = false;
  let reachedExistingRiver = false;
  let failureReason: StaticHydrologyOverflowFailureReason | undefined;
  let sourceLakeAdjacentTiles = 0;

  for (let step = 0; step < maxSteps; step += 1) {
    input.debug?.checkCancelled?.();
    if (step > 0 && step % 32 === 0) {
      await input.debug?.yieldIfNeeded?.();
      input.debug?.checkCancelled?.();
    }
    if (current < 0 || current >= total) {
      failureReason = "invalid-start";
      break;
    }
    if (visited[current] > 0) {
      failureReason = "cycle";
      break;
    }
    visited[current] = 1;
    const currentLakeId = lakeMask[current] ?? 0;
    if (oceanMask[current] > 0) {
      reachedOcean = true;
      break;
    }
    if (currentLakeId > 0) {
      if (currentLakeId !== lake.id) {
        reachedLakeId = currentLakeId;
      }
      break;
    }
    if (riverMask[current] > 0 && tiles.length > 0) {
      reachedExistingRiver = true;
      break;
    }

    tiles.push(current);
    if (isAdjacentToLake(current, lake.id, input)) {
      sourceLakeAdjacentTiles += 1;
      if (sourceLakeAdjacentTiles > MAX_SOURCE_LAKE_ADJACENT_ROUTE_TILES) {
        failureReason = "source-lake-lap";
        break;
      }
    }
    const next = chooseNextRouteCandidate(current, lake, tiles.length, visited, input);
    if (next < 0) {
      failureReason = "dead-end";
      break;
    }
    current = next;
  }

  const terminalReached = reachedOcean || reachedLakeId > 0 || reachedExistingRiver;
  if (!terminalReached && !failureReason) {
    failureReason = "max-steps";
  }
  const result = {
    lakeId: lake.id,
    outletTargetIndex: lake.outletTargetIndex,
    tiles,
    reachedLakeId,
    reachedOcean,
    reachedExistingRiver,
    terminalReached,
    failureReason
  };
  await input.debug?.emit?.({
    kind: "hydrology:overflow",
    lakeId: result.lakeId,
    outletTargetIndex: result.outletTargetIndex,
    tiles: [...result.tiles],
    reachedLakeId: result.reachedLakeId,
    reachedOcean: result.reachedOcean,
    reachedExistingRiver: result.reachedExistingRiver,
    terminalReached: result.terminalReached,
    failureReason: result.failureReason
  });
  return result;
};

export const buildLakeOverflowRiverPaths = (
  input: LakeOverflowRiverRoutingInput
): Promise<LakeOverflowRiverPath[]> => {
  const maxSteps = Math.max(1, input.maxSteps);
  const minVisibleLength = Math.max(1, input.minVisibleLength);
  const eligible = input.lakes.filter((lake) => lake.outletIndex >= 0 && lake.outletTargetIndex >= 0);
  const run = async (): Promise<LakeOverflowRiverPath[]> => {
    const paths: LakeOverflowRiverPath[] = [];
    for (const lake of eligible) {
      paths.push(await buildLakeOverflowPath(lake, { ...input, maxSteps, minVisibleLength }));
    }
    return paths;
  };
  return run();
};
