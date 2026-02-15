import type { Point } from "../core/types.js";
import type { RenderState } from "./renderState.js";
import { ISO_TILE_HEIGHT, ISO_TILE_WIDTH } from "../core/config.js";
import { screenToWorld as isoScreenToWorld, zoomAtPointer as isoZoomAtPointer } from "./iso.js";

export const screenToWorld = isoScreenToWorld;
export const zoomAtPointer = isoZoomAtPointer;

export const panCameraByPixels = (
  renderState: RenderState,
  baseCamera: Point,
  dxPx: number,
  dyPx: number
): Point => {
  const worldDx = dxPx / renderState.zoom;
  const worldDy = dyPx / renderState.zoom;
  return {
    x: baseCamera.x - (worldDy / ISO_TILE_HEIGHT + worldDx / ISO_TILE_WIDTH),
    y: baseCamera.y - (worldDy / ISO_TILE_HEIGHT - worldDx / ISO_TILE_WIDTH)
  };
};
