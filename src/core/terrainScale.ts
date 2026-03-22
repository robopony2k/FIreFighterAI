import { HEIGHT_MAP_RATIO, HEIGHT_SCALE, TILE_SIZE } from "./config.js";

export const TERRAIN_HEIGHT_EXAGGERATION = 1.35;

export const getTerrainHeightScale = (cols: number, rows: number, heightScaleMultiplier = 1): number => {
  const baseScale = Math.max(HEIGHT_SCALE / TILE_SIZE, Math.min(cols, rows) * HEIGHT_MAP_RATIO);
  return baseScale * TERRAIN_HEIGHT_EXAGGERATION * Math.max(0.1, heightScaleMultiplier);
};
