
import type { WorldState } from "../core/state.js";
import { ISO_TILE_WIDTH, ISO_TILE_HEIGHT } from "../core/config.js";
import { clamp } from "../core/utils.js";

/** Defines the camera's zoom and position. */
export type ViewTransform = { scale: number; offsetX: number; offsetY: number };

/** Defines a bounding box in tile coordinates. */
export type Bounds = { startX: number; endX: number; startY: number; endY: number };

/** The maximum number of tiles to render with full detail before sampling is enabled. */
export const MAX_VISIBLE_TILES = 5200;

/**
 * Calculates the visible tile bounds based on the camera view.
 */
export const getVisibleBounds = (
  state: WorldState,
  canvas: HTMLCanvasElement,
  view: ViewTransform
): Bounds => {
  const toWorld = (screenX: number, screenY: number) => {
    const worldX = (screenX - view.offsetX) / view.scale;
    const worldY = (screenY - view.offsetY) / view.scale;
    const isoX = worldX / (ISO_TILE_WIDTH * 0.5);
    const isoY = worldY / (ISO_TILE_HEIGHT * 0.5);
    return {
      x: (isoY + isoX) / 2,
      y: (isoY - isoX) / 2,
    };
  };

  const corners = [
    toWorld(0, 0),
    toWorld(canvas.width, 0),
    toWorld(0, canvas.height),
    toWorld(canvas.width, canvas.height),
  ];
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const corner of corners) {
    minX = Math.min(minX, corner.x);
    maxX = Math.max(maxX, corner.x);
    minY = Math.min(minY, corner.y);
    maxY = Math.max(maxY, corner.y);
  }

  // Add padding to ensure tiles just outside the viewport are included for effects.
  const pad = view.scale < 1 ? 6 : 4;
  return {
    startX: clamp(Math.floor(minX) - pad, 0, state.grid.cols - 1),
    endX: clamp(Math.ceil(maxX) + pad, 0, state.grid.cols - 1),
    startY: clamp(Math.floor(minY) - pad, 0, state.grid.rows - 1),
    endY: clamp(Math.ceil(maxY) + pad, 0, state.grid.rows - 1),
  };
};
