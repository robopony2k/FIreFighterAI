import type { Point } from "../core/types.js";
import type { WorldState } from "../core/state.js";
import { HEIGHT_SCALE, HEIGHT_WATER_DROP, ISO_TILE_HEIGHT, ISO_TILE_WIDTH, ZOOM_MAX, ZOOM_MIN } from "../core/config.js";
import { clamp } from "../core/utils.js";
import { inBounds, indexFor } from "../core/grid.js";

export function isoProject(wx: number, wy: number, height: number): Point {
  return {
    x: (wx - wy) * (ISO_TILE_WIDTH * 0.5),
    y: (wx + wy) * (ISO_TILE_HEIGHT * 0.5) - height
  };
}

export function getTileHeight(tile: WorldState["tiles"][number]): number {
  return tile.elevation * HEIGHT_SCALE - (tile.type === "water" ? HEIGHT_WATER_DROP : 0);
}

export function getHeightAt(state: WorldState, wx: number, wy: number): number {
  const x = Math.floor(wx);
  const y = Math.floor(wy);
  if (!inBounds(state.grid, x, y)) {
    return 0;
  }
  return getTileHeight(state.tiles[indexFor(state.grid, x, y)]);
}

export function getViewTransform(
  state: WorldState,
  canvas: HTMLCanvasElement
): { scale: number; offsetX: number; offsetY: number } {
  const scale = state.zoom;
  const centerHeight = getHeightAt(state, state.cameraCenter.x, state.cameraCenter.y);
  const center = isoProject(state.cameraCenter.x, state.cameraCenter.y, centerHeight);
  const offsetX = canvas.width / 2 - center.x * scale;
  const offsetY = canvas.height / 2 - center.y * scale;
  return { scale, offsetX, offsetY };
}

export function screenToWorld(state: WorldState, canvas: HTMLCanvasElement, screenX: number, screenY: number): Point {
  const view = getViewTransform(state, canvas);
  const worldX = (screenX - view.offsetX) / view.scale;
  const worldY = (screenY - view.offsetY) / view.scale;
  const isoX = worldX / (ISO_TILE_WIDTH * 0.5);
  const isoY = worldY / (ISO_TILE_HEIGHT * 0.5);
  return {
    x: (isoY + isoX) / 2,
    y: (isoY - isoX) / 2
  };
}

export function zoomAtPointer(state: WorldState, canvas: HTMLCanvasElement, targetZoom: number, screenX: number, screenY: number): void {
  const nextZoom = clamp(targetZoom, ZOOM_MIN, ZOOM_MAX);
  const before = screenToWorld(state, canvas, screenX, screenY);
  const prevZoom = state.zoom;
  state.zoom = nextZoom;
  const ratio = prevZoom / state.zoom;
  state.cameraCenter = {
    x: before.x + (state.cameraCenter.x - before.x) * ratio,
    y: before.y + (state.cameraCenter.y - before.y) * ratio
  };
}

export function setZoom(state: WorldState, next: number): void {
  state.zoom = clamp(next, ZOOM_MIN, ZOOM_MAX);
}

