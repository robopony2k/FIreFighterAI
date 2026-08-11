import type { StaticHydrologyLake } from "../types/staticHydrologyTypes.js";

const NEIGHBORS_4 = [
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 }
] as const;

export type DepressionLakeFieldInput = {
  cols: number;
  rows: number;
  elevations: ArrayLike<number>;
  filledElevation: Float32Array;
  depressionDepth: Float32Array;
  flowAccumulation: Float32Array;
  oceanMask: Uint8Array;
  riverIntensity: number;
  basinStrength: number;
  minLakeDepth: number;
  minLakeAreaTiles: number;
  maxLakeAreaTiles: number;
  maxLakeCount: number;
};

export type DepressionLakeFieldResult = {
  lakeMask: Uint16Array;
  lakeSurface: Float32Array;
  lakes: StaticHydrologyLake[];
};

type LakeCandidate = {
  tiles: number[];
  surfaceLevel: number;
  floorIndex: number;
  maxDepth: number;
  runoffScore: number;
  score: number;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export const buildDepressionLakeField = (input: DepressionLakeFieldInput): DepressionLakeFieldResult => {
  const total = input.cols * input.rows;
  const waterStrength = clamp01(input.riverIntensity * 0.65 + input.basinStrength * 0.35);
  const depthThreshold = input.minLakeDepth * (0.9 - waterStrength * 0.68);
  const linearMapScale = Math.max(1, Math.sqrt(total) / 64);
  const minimumArea = Math.max(input.minLakeAreaTiles, Math.round(3 * linearMapScale));
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const candidates: LakeCandidate[] = [];

  for (let start = 0; start < total; start += 1) {
    if (visited[start] > 0 || input.oceanMask[start] > 0 || (input.depressionDepth[start] ?? 0) < depthThreshold) {
      continue;
    }
    let head = 0;
    let tail = 0;
    let maxDepth = 0;
    let maxRunoff = 0;
    let surfaceLevel = input.filledElevation[start] ?? 0;
    let floorIndex = start;
    let floorElevation = input.elevations[start] ?? surfaceLevel;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const idx = queue[head++];
      const depth = input.depressionDepth[idx] ?? 0;
      const elevation = input.elevations[idx] ?? 0;
      maxDepth = Math.max(maxDepth, depth);
      maxRunoff = Math.max(maxRunoff, input.flowAccumulation[idx] ?? 0);
      surfaceLevel = Math.max(surfaceLevel, input.filledElevation[idx] ?? surfaceLevel);
      if (elevation < floorElevation) {
        floorElevation = elevation;
        floorIndex = idx;
      }
      const x = idx % input.cols;
      const y = Math.floor(idx / input.cols);
      for (const neighbor of NEIGHBORS_4) {
        const nx = x + neighbor.dx;
        const ny = y + neighbor.dy;
        if (nx < 0 || ny < 0 || nx >= input.cols || ny >= input.rows) continue;
        const next = ny * input.cols + nx;
        if (
          visited[next] > 0 ||
          input.oceanMask[next] > 0 ||
          (input.depressionDepth[next] ?? 0) < depthThreshold
        ) {
          continue;
        }
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    if (tail < minimumArea || tail > input.maxLakeAreaTiles) continue;
    const tiles = Array.from(queue.subarray(0, tail));
    candidates.push({
      tiles,
      surfaceLevel,
      floorIndex,
      maxDepth,
      runoffScore: maxRunoff,
      score: tail * maxDepth * (0.45 + maxRunoff * 0.55)
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.floorIndex - b.floorIndex);
  const accepted = candidates.slice(0, Math.max(0, input.maxLakeCount));
  const lakeMask = new Uint16Array(total);
  const lakeSurface = new Float32Array(total).fill(Number.NaN);
  const lakes: StaticHydrologyLake[] = [];
  for (let candidateIndex = 0; candidateIndex < accepted.length; candidateIndex += 1) {
    const candidate = accepted[candidateIndex];
    const id = candidateIndex + 1;
    for (const idx of candidate.tiles) {
      lakeMask[idx] = id;
      lakeSurface[idx] = candidate.surfaceLevel;
    }
    lakes.push({
      id,
      tiles: candidate.tiles,
      surfaceLevel: candidate.surfaceLevel,
      outletIndex: -1,
      outletTargetIndex: -1,
      inflowRiverTiles: [],
      outflowRiverTile: -1,
      basinSeedIndex: candidate.floorIndex,
      rainfallScore: candidate.runoffScore,
      runoffScore: candidate.runoffScore,
      maxDepth: candidate.maxDepth,
      spillElevation: candidate.surfaceLevel,
      basinAreaTiles: candidate.tiles.length,
      catchmentRunoff: candidate.runoffScore,
      overflowTargetIndex: -1
    });
  }
  return { lakeMask, lakeSurface, lakes };
};
