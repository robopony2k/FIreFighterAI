import type { Grid } from "./types.js";

export function indexFor(grid: Grid, x: number, y: number): number {
  return y * grid.cols + x;
}

export function inBounds(grid: Grid, x: number, y: number): boolean {
  return x >= 0 && x < grid.cols && y >= 0 && y < grid.rows;
}

