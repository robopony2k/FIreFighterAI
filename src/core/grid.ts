import type { Grid } from "./types.js";

export function indexFor(grid: Grid, x: number, y: number): number {
  return y * grid.cols + x;
}

export function inBounds(grid: Grid, x: number, y: number): boolean {
  return x >= 0 && x < grid.cols && y >= 0 && y < grid.rows;
}

export function buildNeighborOffsets(cols: number, mode: 4 | 8): Int32Array {
  if (mode === 4) {
    return new Int32Array([1, -1, cols, -cols]);
  }
  return new Int32Array([1, -1, cols, -cols, cols + 1, -(cols + 1), -(cols - 1), cols - 1]);
}

