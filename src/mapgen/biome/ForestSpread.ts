import { clamp } from "../../core/utils.js";
import { hash2D } from "../noise.js";
import type { MapGenContext } from "../pipeline/MapGenContext.js";

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

export const buildForestMask = (ctx: MapGenContext, suitability: Float32Array): Uint8Array => {
  const { state, oceanMask, riverMask, moistureMap, treeProbabilityMap, treeDensityMap } = ctx;
  if (!oceanMask || !riverMask || !moistureMap || !treeProbabilityMap || !treeDensityMap) {
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
      const clusterHash = hash2D(Math.floor(x / 3), Math.floor(y / 3), state.seed + 977);
      const placementScore = probability * 0.76 + density * 0.18 + clusterHash * 0.06;
      if (probability >= 0.82 || localHash < placementScore * 0.72) {
        forestMask[idx] = 1;
      }
    }
  }

  const holeFilled = Uint8Array.from(forestMask);
  for (let y = 0; y < rows; y += 1) {
    const rowBase = y * cols;
    for (let x = 0; x < cols; x += 1) {
      const idx = rowBase + x;
      if (isWater(idx, oceanMask, riverMask) || forestMask[idx] > 0) {
        continue;
      }
      const neighbors = countForestNeighbors(forestMask, cols, rows, x, y);
      const probability = treeProbabilityMap[idx] ?? 0;
      if (neighbors >= 4 && probability >= 0.38 && (suitability[idx] ?? 0) >= 0.34) {
        holeFilled[idx] = 1;
      }
    }
  }

  const pruned = Uint8Array.from(holeFilled);
  for (let y = 0; y < rows; y += 1) {
    const rowBase = y * cols;
    for (let x = 0; x < cols; x += 1) {
      const idx = rowBase + x;
      if (isWater(idx, oceanMask, riverMask) || holeFilled[idx] === 0) {
        pruned[idx] = 0;
        continue;
      }
      const neighbors = countForestNeighbors(holeFilled, cols, rows, x, y);
      if (neighbors <= 1 && (treeProbabilityMap[idx] ?? 0) < 0.5) {
        pruned[idx] = 0;
      }
    }
  }

  return pruned;
};
