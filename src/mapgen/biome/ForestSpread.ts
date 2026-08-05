import { clamp } from "../../core/utils.js";
import { hash2D } from "../noise.js";
import type { MapGenContext } from "../pipeline/MapGenContext.js";
import { VEGETATION_DISTRIBUTION_TUNING } from "../../systems/terrain/constants/vegetationDistributionTuning.js";

const SEED_CELL = 12;
const MIN_SEED_DISTANCE = 7;
const MAX_WAVES = 14;
const HASH_BUCKET_COUNT = 512;

const isWater = (idx: number, oceanMask: Uint8Array, riverMask: Uint8Array): boolean =>
  oceanMask[idx] > 0 || riverMask[idx] > 0;

const hasMinSeedDistance = (x: number, y: number, seedXs: number[], seedYs: number[]): boolean => {
  const minDistSq = MIN_SEED_DISTANCE * MIN_SEED_DISTANCE;
  for (let i = 0; i < seedXs.length; i += 1) {
    const dx = x - (seedXs[i] ?? x);
    const dy = y - (seedYs[i] ?? y);
    if (dx * dx + dy * dy < minDistSq) {
      return false;
    }
  }
  return true;
};

const countForestNeighbors = (mask: Uint8Array, cols: number, rows: number, x: number, y: number): number => {
  let count = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
        continue;
      }
      if (mask[ny * cols + nx] > 0) {
        count += 1;
      }
    }
  }
  return count;
};

const removeSmallForestComponents = (
  mask: Uint8Array,
  cols: number,
  rows: number,
  minArea: number
): void => {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] === 0 || visited[start]) continue;
    let head = 0;
    let tail = 0;
    visited[start] = 1;
    queue[tail++] = start;
    while (head < tail) {
      const idx = queue[head++];
      const x = idx % cols;
      const y = Math.floor(idx / cols);
      const neighbors = [x > 0 ? idx - 1 : -1, x < cols - 1 ? idx + 1 : -1, y > 0 ? idx - cols : -1, y < rows - 1 ? idx + cols : -1];
      for (const next of neighbors) {
        if (next >= 0 && mask[next] > 0 && !visited[next]) {
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    if (tail < minArea) {
      for (let i = 0; i < tail; i += 1) mask[queue[i]] = 0;
    }
  }
};

const fillSmallLandClearings = (
  mask: Uint8Array,
  cols: number,
  rows: number,
  oceanMask: Uint8Array,
  riverMask: Uint8Array,
  minArea: number
): void => {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] > 0 || visited[start] || isWater(start, oceanMask, riverMask)) continue;
    let head = 0;
    let tail = 0;
    let touchesOpenBoundary = false;
    visited[start] = 1;
    queue[tail++] = start;
    while (head < tail) {
      const idx = queue[head++];
      const x = idx % cols;
      const y = Math.floor(idx / cols);
      if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) touchesOpenBoundary = true;
      const neighbors = [x > 0 ? idx - 1 : -1, x < cols - 1 ? idx + 1 : -1, y > 0 ? idx - cols : -1, y < rows - 1 ? idx + cols : -1];
      for (const next of neighbors) {
        if (next < 0 || visited[next] || mask[next] > 0 || isWater(next, oceanMask, riverMask)) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    if (!touchesOpenBoundary && tail < minArea) {
      for (let i = 0; i < tail; i += 1) mask[queue[i]] = 1;
    }
  }
};

export const buildForestMask = (ctx: MapGenContext, suitability: Float32Array): Uint8Array => {
  const { state, oceanMask, riverMask, moistureMap, treeProbabilityMap, treeDensityMap, vegetationClusterMap } = ctx;
  if (!oceanMask || !riverMask || !moistureMap || !treeProbabilityMap || !treeDensityMap || !vegetationClusterMap) {
    throw new Error("Forest spread requires ocean/rivers/moisture/tree-density maps.");
  }
  const { cols, rows, totalTiles } = state.grid;
  const forestMask = new Uint8Array(totalTiles);
  const densityScale = clamp(0.58 + ctx.settings.vegetationDensity * 0.42, 0.58, 1);

  for (let y = 0; y < rows; y += 1) {
    const rowBase = y * cols;
    for (let x = 0; x < cols; x += 1) {
      const idx = rowBase + x;
      if (isWater(idx, oceanMask, riverMask)) {
        continue;
      }
      const probability = clamp((treeProbabilityMap[idx] ?? 0) * densityScale, 0, 1);
      const density = clamp(treeDensityMap[idx] ?? 0, 0, 1);
      const localHash = hash2D(x, y, state.seed + 611);
      const cluster = clamp(vegetationClusterMap[idx] ?? 0.5, 0, 1);
      const placementScore =
        probability * VEGETATION_DISTRIBUTION_TUNING.forestPlacementProbabilityWeight +
        density * VEGETATION_DISTRIBUTION_TUNING.forestPlacementDensityWeight +
        cluster * VEGETATION_DISTRIBUTION_TUNING.forestPlacementClusterWeight;
      const acceptance =
        VEGETATION_DISTRIBUTION_TUNING.forestPlacementAcceptanceBase +
        cluster * VEGETATION_DISTRIBUTION_TUNING.forestPlacementAcceptanceClusterScale;
      if (localHash < placementScore * acceptance) {
        forestMask[idx] = 1;
      }
    }
  }

  let resolved = forestMask;
  for (let pass = 0; pass < VEGETATION_DISTRIBUTION_TUNING.morphologyPasses; pass += 1) {
    const next = Uint8Array.from(resolved);
    for (let y = 0; y < rows; y += 1) {
      const rowBase = y * cols;
      for (let x = 0; x < cols; x += 1) {
        const idx = rowBase + x;
        if (isWater(idx, oceanMask, riverMask)) {
          next[idx] = 0;
          continue;
        }
        const neighbors = countForestNeighbors(resolved, cols, rows, x, y);
        const probability = treeProbabilityMap[idx] ?? 0;
        if (resolved[idx] === 0 && neighbors >= 5 && probability >= 0.34 && (suitability[idx] ?? 0) >= 0.3) {
          next[idx] = 1;
        } else if (resolved[idx] > 0 && neighbors <= 1 && probability < 0.58) {
          next[idx] = 0;
        }
      }
    }
    resolved = next;
  }
  removeSmallForestComponents(resolved, cols, rows, VEGETATION_DISTRIBUTION_TUNING.forestMinComponentTiles);
  fillSmallLandClearings(
    resolved,
    cols,
    rows,
    oceanMask,
    riverMask,
    VEGETATION_DISTRIBUTION_TUNING.clearingMinComponentTiles
  );
  return resolved;
};
