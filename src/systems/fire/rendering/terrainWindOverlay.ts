import type { WorldState } from "../../../core/state.js";
import { getTerrainWindField, sampleTerrainWindAt } from "../sim/terrainWindField.js";

export type TerrainWindOverlaySample = {
  x01: number;
  y01: number;
  dx: number;
  dy: number;
  strength: number;
};

export type TerrainWindOverlayOptions = {
  maxColumns?: number;
  maxRows?: number;
  minSampleSpacingTiles?: number;
  calmThreshold?: number;
  maxVisualSpeedMultiplier?: number;
  visualDeflectionScale?: number;
  maxVisualDeflectionAngleDeg?: number;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const resolveSampleCount = (tiles: number, maxSamples: number, minSpacing: number): number =>
  clamp(Math.floor(tiles / Math.max(1, minSpacing)), 2, Math.max(2, maxSamples));

const resolveDisplayDirection = (
  baseDx: number,
  baseDy: number,
  adjustedDx: number,
  adjustedDy: number,
  deflectionScale: number,
  maxDeflectionAngleRad: number
): { dx: number; dy: number } => {
  const baseMagnitude = Math.hypot(baseDx, baseDy);
  const adjustedMagnitude = Math.hypot(adjustedDx, adjustedDy);
  if (baseMagnitude <= 0.0001 || adjustedMagnitude <= 0.0001 || deflectionScale <= 1) {
    return { dx: adjustedDx, dy: adjustedDy };
  }

  const baseAngle = Math.atan2(baseDy, baseDx);
  const adjustedAngle = Math.atan2(adjustedDy, adjustedDx);
  const shortestDelta = Math.atan2(Math.sin(adjustedAngle - baseAngle), Math.cos(adjustedAngle - baseAngle));
  const displayDelta = clamp(shortestDelta * deflectionScale, -maxDeflectionAngleRad, maxDeflectionAngleRad);
  const displayAngle = baseAngle + displayDelta;
  return {
    dx: Math.cos(displayAngle) * adjustedMagnitude,
    dy: Math.sin(displayAngle) * adjustedMagnitude
  };
};

export const buildTerrainWindOverlaySamples = (
  world: WorldState,
  options: TerrainWindOverlayOptions = {}
): TerrainWindOverlaySample[] => {
  const cols = world.grid.cols;
  const rows = world.grid.rows;
  const wind = world.wind;
  if (!wind || cols < 3 || rows < 3) {
    return [];
  }

  const maxColumns = Math.max(2, Math.floor(options.maxColumns ?? 12));
  const maxRows = Math.max(2, Math.floor(options.maxRows ?? 12));
  const minSpacing = Math.max(1, Math.floor(options.minSampleSpacingTiles ?? 5));
  const sampleColumns = resolveSampleCount(cols, maxColumns, minSpacing);
  const sampleRows = resolveSampleCount(rows, maxRows, minSpacing);
  const samples: TerrainWindOverlaySample[] = [];
  const field = getTerrainWindField(world);
  const adjusted = { dx: wind.dx, dy: wind.dy, strength: wind.strength ?? 0 };
  const maxVisualSpeed = Math.max(1, options.maxVisualSpeedMultiplier ?? 1.6);
  const deflectionScale = Math.max(1, options.visualDeflectionScale ?? 4);
  const maxDeflectionAngleRad = (Math.max(0, options.maxVisualDeflectionAngleDeg ?? 42) * Math.PI) / 180;

  for (let sy = 0; sy < sampleRows; sy += 1) {
    const y = clamp(Math.round(((sy + 0.5) / sampleRows) * rows), 1, rows - 2);
    for (let sx = 0; sx < sampleColumns; sx += 1) {
      const x = clamp(Math.round(((sx + 0.5) / sampleColumns) * cols), 1, cols - 2);
      const idx = y * cols + x;
      sampleTerrainWindAt(field, idx, wind, adjusted);
      // Keep the display readable without making the visual field look like a separate simulator.
      const displayDirection = resolveDisplayDirection(
        wind.dx,
        wind.dy,
        adjusted.dx,
        adjusted.dy,
        deflectionScale,
        maxDeflectionAngleRad
      );
      samples.push({
        x01: (x + 0.5) / cols,
        y01: (y + 0.5) / rows,
        dx: displayDirection.dx,
        dy: displayDirection.dy,
        strength: clamp(adjusted.strength, 0, maxVisualSpeed)
      });
    }
  }

  return samples;
};
