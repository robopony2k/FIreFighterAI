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
  const { state, oceanMask, riverMask, moistureMap } = ctx;
  if (!oceanMask || !riverMask || !moistureMap) {
    throw new Error("Forest spread requires ocean/rivers/moisture maps.");
  }
  const { cols, rows, totalTiles } = state.grid;
  const forestMask = new Uint8Array(totalTiles);
  const seedXs: number[] = [];
  const seedYs: number[] = [];
  const seedIndices: number[] = [];

  let landTiles = 0;
  let moistureSum = 0;
  for (let i = 0; i < totalTiles; i += 1) {
    if (isWater(i, oceanMask, riverMask)) {
      continue;
    }
    landTiles += 1;
    moistureSum += moistureMap[i] ?? 0;
  }

  for (let by = 0; by < rows; by += SEED_CELL) {
    const yMax = Math.min(rows, by + SEED_CELL);
    for (let bx = 0; bx < cols; bx += SEED_CELL) {
      const xMax = Math.min(cols, bx + SEED_CELL);
      let bestIdx = -1;
      let bestSuitability = -1;
      let bestTie = -1;
      for (let y = by; y < yMax; y += 1) {
        const rowBase = y * cols;
        for (let x = bx; x < xMax; x += 1) {
          const idx = rowBase + x;
          if (isWater(idx, oceanMask, riverMask)) {
            continue;
          }
          const s = suitability[idx] ?? 0;
          if (s < 0.57) {
            continue;
          }
          const tie = hash2D(x, y, state.seed + 4101);
          if (s > bestSuitability || (Math.abs(s - bestSuitability) < 1e-6 && tie > bestTie)) {
            bestSuitability = s;
            bestTie = tie;
            bestIdx = idx;
          }
        }
      }
      if (bestIdx < 0) {
        continue;
      }
      const x = bestIdx % cols;
      const y = Math.floor(bestIdx / cols);
      if (!hasMinSeedDistance(x, y, seedXs, seedYs)) {
        continue;
      }
      forestMask[bestIdx] = 1;
      seedXs.push(x);
      seedYs.push(y);
      seedIndices.push(bestIdx);
    }
  }

  const minSeeds = Math.max(8, Math.floor(landTiles / 4096));
  if (seedIndices.length < minSeeds) {
    const buckets: number[][] = Array.from({ length: HASH_BUCKET_COUNT }, () => []);
    for (let y = 0; y < rows; y += 1) {
      const rowBase = y * cols;
      for (let x = 0; x < cols; x += 1) {
        const idx = rowBase + x;
        if (forestMask[idx] > 0 || isWater(idx, oceanMask, riverMask)) {
          continue;
        }
        if ((suitability[idx] ?? 0) <= 0) {
          continue;
        }
        const hash = hash2D(x, y, state.seed + 4271);
        const bucket = Math.min(HASH_BUCKET_COUNT - 1, Math.floor(hash * HASH_BUCKET_COUNT));
        buckets[bucket]?.push(idx);
      }
    }
    for (let b = 0; b < HASH_BUCKET_COUNT && seedIndices.length < minSeeds; b += 1) {
      const bucket = buckets[b];
      if (!bucket || bucket.length === 0) {
        continue;
      }
      for (let i = 0; i < bucket.length && seedIndices.length < minSeeds; i += 1) {
        const idx = bucket[i] ?? -1;
        if (idx < 0 || forestMask[idx] > 0) {
          continue;
        }
        const x = idx % cols;
        const y = Math.floor(idx / cols);
        if (!hasMinSeedDistance(x, y, seedXs, seedYs)) {
          continue;
        }
        forestMask[idx] = 1;
        seedXs.push(x);
        seedYs.push(y);
        seedIndices.push(idx);
      }
    }
  }

  const avgLandMoisture = moistureSum / Math.max(1, landTiles);
  const targetForestPct = clamp(0.22 + (avgLandMoisture - 0.45) * 0.25, 0.18, 0.3);
  const targetForestTiles = Math.floor(landTiles * targetForestPct);
  let forestTiles = seedIndices.length;
  let frontier = seedIndices.slice();
  const candidateSeen = new Uint16Array(totalTiles);

  for (let wave = 0; wave < MAX_WAVES && frontier.length > 0 && forestTiles < targetForestTiles; wave += 1) {
    const nextFrontier: number[] = [];
    const stamp = wave + 1;
    for (let f = 0; f < frontier.length; f += 1) {
      const idx = frontier[f] ?? -1;
      if (idx < 0) {
        continue;
      }
      const x = idx % cols;
      const y = Math.floor(idx / cols);
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
          const nIdx = ny * cols + nx;
          if (candidateSeen[nIdx] === stamp || forestMask[nIdx] > 0 || isWater(nIdx, oceanMask, riverMask)) {
            continue;
          }
          candidateSeen[nIdx] = stamp;
          const s = suitability[nIdx] ?? 0;
          if (s <= 0) {
            continue;
          }
          const neighborFrac = countForestNeighbors(forestMask, cols, rows, nx, ny) / 8;
          const chance = 0.7 * s + 0.2 * neighborFrac + 0.1 * hash2D(nx, ny, state.seed + 611);
          const threshold = 0.58 + wave * 0.015;
          if (chance < threshold) {
            continue;
          }
          forestMask[nIdx] = 1;
          nextFrontier.push(nIdx);
          forestTiles += 1;
          if (forestTiles >= targetForestTiles) {
            break;
          }
        }
        if (forestTiles >= targetForestTiles) {
          break;
        }
      }
      if (forestTiles >= targetForestTiles) {
        break;
      }
    }
    frontier = nextFrontier;
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
      if (neighbors >= 5 && (suitability[idx] ?? 0) >= 0.46) {
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
      if (neighbors <= 1 && (suitability[idx] ?? 0) < 0.6) {
        pruned[idx] = 0;
      }
    }
  }

  return pruned;
};
