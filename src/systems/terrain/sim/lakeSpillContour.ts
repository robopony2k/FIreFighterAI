import type { DepressionBasin } from "./depressionBasinSolver.js";

const NEIGHBORS_4 = [
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 }
] as const;

export type LakeSpillContourInput = {
  cols: number;
  rows: number;
  basin: DepressionBasin;
  elevationMap: ArrayLike<number>;
  filledElevation: Float32Array;
  oceanMask: Uint8Array;
  exclude?: Iterable<number>;
  spillTolerance?: number;
  surfaceMargin?: number;
};

const idxAt = (x: number, y: number, cols: number): number => y * cols + x;

export const buildLakeSpillContour = ({
  cols,
  rows,
  basin,
  elevationMap,
  filledElevation,
  oceanMask,
  exclude,
  spillTolerance = 0.0025,
  surfaceMargin = 0.0001
}: LakeSpillContourInput): number[] => {
  const total = cols * rows;
  const excluded = new Uint8Array(total);
  if (exclude) {
    for (const idx of exclude) {
      if (idx >= 0 && idx < total) {
        excluded[idx] = 1;
      }
    }
  }
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const result: number[] = [];
  let head = 0;
  let tail = 0;
  const surface = basin.spillElevation;
  const canInclude = (idx: number): boolean => {
    if (idx < 0 || idx >= total || oceanMask[idx] > 0 || excluded[idx] > 0) {
      return false;
    }
    const elevation = elevationMap[idx] ?? surface;
    if (elevation > surface - surfaceMargin) {
      return false;
    }
    return Math.abs((filledElevation[idx] ?? elevation) - surface) <= spillTolerance;
  };

  for (const idx of basin.tiles) {
    if (visited[idx] > 0 || !canInclude(idx)) {
      continue;
    }
    visited[idx] = 1;
    queue[tail] = idx;
    tail += 1;
  }

  while (head < tail) {
    const idx = queue[head];
    head += 1;
    result.push(idx);
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    for (const dir of NEIGHBORS_4) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
        continue;
      }
      const nIdx = idxAt(nx, ny, cols);
      if (visited[nIdx] > 0 || !canInclude(nIdx)) {
        continue;
      }
      visited[nIdx] = 1;
      queue[tail] = nIdx;
      tail += 1;
    }
  }

  return result.sort((a, b) => a - b);
};
