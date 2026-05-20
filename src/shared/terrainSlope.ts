import { getTerrainHeightScale } from "../core/terrainScale.js";

export const computeRenderedSlopeAngleDeg = (
  slope: number,
  cols: number,
  rows: number,
  heightScaleMultiplier = 1
): number => {
  const tileSpan = Math.max(1e-4, Math.max(1, Math.min(cols, rows) - 1) / Math.max(1, Math.min(cols, rows)));
  const grade = (Math.max(0, slope) * getTerrainHeightScale(cols, rows, heightScaleMultiplier)) / tileSpan;
  return (Math.atan(grade) * 180) / Math.PI;
};

export type TerrainSlopeSurface = {
  cols: number;
  rows: number;
  elevations: ArrayLike<number>;
};

const clampIndex = (value: number, max: number): number => Math.max(0, Math.min(max, value));

export const computeLocalCardinalSlope = (surface: TerrainSlopeSurface, x: number, y: number): number => {
  const cols = Math.max(1, surface.cols);
  const rows = Math.max(1, surface.rows);
  const cx = clampIndex(x, cols - 1);
  const cy = clampIndex(y, rows - 1);
  const idx = cy * cols + cx;
  const center = surface.elevations[idx] ?? 0;
  let maxDiff = 0;
  if (cx > 0) {
    maxDiff = Math.max(maxDiff, Math.abs(center - (surface.elevations[idx - 1] ?? center)));
  }
  if (cx < cols - 1) {
    maxDiff = Math.max(maxDiff, Math.abs(center - (surface.elevations[idx + 1] ?? center)));
  }
  if (cy > 0) {
    maxDiff = Math.max(maxDiff, Math.abs(center - (surface.elevations[idx - cols] ?? center)));
  }
  if (cy < rows - 1) {
    maxDiff = Math.max(maxDiff, Math.abs(center - (surface.elevations[idx + cols] ?? center)));
  }
  return Math.max(0, maxDiff);
};

export const computeLocalRenderedSlopeAngleDeg = (
  surface: TerrainSlopeSurface,
  x: number,
  y: number,
  heightScaleMultiplier = 1
): number =>
  computeRenderedSlopeAngleDeg(
    computeLocalCardinalSlope(surface, x, y),
    surface.cols,
    surface.rows,
    heightScaleMultiplier
  );
