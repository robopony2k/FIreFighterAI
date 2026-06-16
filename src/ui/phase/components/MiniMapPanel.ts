import type { WorldState } from "../../../core/state.js";
import { getMinimapModeLabel, MINIMAP_MODES, type MinimapMode } from "../../runtime/minimap/minimapModes.js";
import {
  buildThermalBackdropField,
  DEFAULT_THERMAL_PALETTE,
  isDynamicMinimapMode,
  isTerrainRevisionMinimapMode,
  MINIMAP_DYNAMIC_REFRESH_MS,
  paintMinimapRaster
} from "../../runtime/minimap/minimapRaster.js";
import { getRuntimeWidgetTitle } from "../../runtime/widgets/registry.js";
import type { MinimapWidgetModel } from "../../runtime/widgets/models.js";
import { generateWorldClimateSeed } from "../../../systems/climate/sim/worldClimateSeed.js";
import { buildTerrainWindOverlaySamples } from "../../../systems/fire/rendering/terrainWindOverlay.js";

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export type MiniMapPanelData = MinimapWidgetModel;

export type MiniMapPanelView = {
  element: HTMLElement;
  update: (data: MiniMapPanelData) => void;
};

export const createMiniMapPanel = (): MiniMapPanelView => {
  const element = document.createElement("section");
  element.className = "phase-panel phase-card phase-minimap-panel";
  element.dataset.panel = "miniMap";

  const header = document.createElement("div");
  header.className = "phase-minimap-header";

  const title = document.createElement("div");
  title.className = "phase-card-title";
  title.textContent = getRuntimeWidgetTitle("minimap", "phaseDom");

  const modeButton = document.createElement("button");
  modeButton.className = "phase-minimap-mode";
  modeButton.type = "button";
  modeButton.textContent = "Terrain";

  header.append(title, modeButton);

  const canvasWrap = document.createElement("div");
  canvasWrap.className = "phase-minimap-canvas-wrap";
  const canvas = document.createElement("canvas");
  canvas.className = "phase-minimap-canvas";
  canvasWrap.appendChild(canvas);

  element.append(header, canvasWrap);

  const ctx = canvas.getContext("2d");
  const rasterCanvas = document.createElement("canvas");
  const rasterCtx = rasterCanvas.getContext("2d");

  let modeIndex = 0;
  let lastMode: MinimapMode = "terrain";
  let lastTerrainRevision = -1;
  let lastRasterWidth = 0;
  let lastRasterHeight = 0;
  let lastRasterMs = -Infinity;
  let thermalBackdrop: Float32Array = new Float32Array(0);

  const updateModeLabel = (): void => {
    modeButton.textContent = getMinimapModeLabel(MINIMAP_MODES[modeIndex] ?? "terrain");
  };

  modeButton.addEventListener("click", () => {
    modeIndex = (modeIndex + 1) % MINIMAP_MODES.length;
    updateModeLabel();
    lastMode = "terrain";
  });
  updateModeLabel();

  const drawRaster = (world: WorldState, mode: MinimapMode, mapWidth: number, mapHeight: number): void => {
    if (!rasterCtx) {
      return;
    }
    if (rasterCanvas.width !== mapWidth || rasterCanvas.height !== mapHeight) {
      rasterCanvas.width = mapWidth;
      rasterCanvas.height = mapHeight;
    }
    const image = rasterCtx.createImageData(mapWidth, mapHeight);
    paintMinimapRaster(image.data, world, mode, mapWidth, mapHeight, {
      thermalBackdrop,
      thermalPalette: DEFAULT_THERMAL_PALETTE
    });
    rasterCtx.putImageData(image, 0, 0);
  };

  const drawWindOverlay = (
    targetCtx: CanvasRenderingContext2D,
    world: WorldState,
    x: number,
    y: number,
    size: number
  ): void => {
    const climateSeed = generateWorldClimateSeed(world.seed);
    const originX = x + size * 0.16;
    const originY = y + size * 0.16;
    const len = Math.max(8, size * 0.12);
    const barbLen = Math.max(9, size * 0.072);
    const drawBarb = (sx: number, sy: number, dx: number, dy: number, strength: number): void => {
      const mag = Math.hypot(dx, dy);
      const scaledLen = barbLen * clamp(strength, 0, 1.6);
      if (strength <= 0.04 || mag <= 0.0001 || scaledLen < 2.25) {
        targetCtx.fillStyle = "rgba(8, 10, 14, 0.78)";
        targetCtx.beginPath();
        targetCtx.arc(sx, sy, 2.3, 0, Math.PI * 2);
        targetCtx.fill();
        targetCtx.fillStyle = "rgba(255, 255, 255, 0.96)";
        targetCtx.beginPath();
        targetCtx.arc(sx, sy, 1.35, 0, Math.PI * 2);
        targetCtx.fill();
        return;
      }
      const ux = dx / mag;
      const uy = dy / mag;
      const ex = sx + ux * scaledLen;
      const ey = sy + uy * scaledLen;
      const side = scaledLen * 0.28;
      targetCtx.strokeStyle = "rgba(8, 10, 14, 0.78)";
      targetCtx.lineWidth = 3.1;
      targetCtx.beginPath();
      targetCtx.moveTo(sx, sy);
      targetCtx.lineTo(ex, ey);
      targetCtx.moveTo(ex, ey);
      targetCtx.lineTo(ex - ux * side - uy * side * 0.7, ey - uy * side + ux * side * 0.7);
      targetCtx.moveTo(ex - ux * side * 0.45, ey - uy * side * 0.45);
      targetCtx.lineTo(ex - ux * side * 1.15 + uy * side * 0.55, ey - uy * side * 1.15 - ux * side * 0.55);
      targetCtx.stroke();
      targetCtx.strokeStyle = "rgba(255, 255, 255, 0.96)";
      targetCtx.lineWidth = 1.65;
      targetCtx.stroke();
    };
    const drawArrow = (dx: number, dy: number, strength: number, color: string, offsetY: number): void => {
      const mag = Math.hypot(dx, dy);
      if (mag <= 0.0001) {
        return;
      }
      const ux = dx / mag;
      const uy = dy / mag;
      const scaledLen = len * clamp(strength, 0.35, 1);
      const sx = originX;
      const sy = originY + offsetY;
      const ex = sx + ux * scaledLen;
      const ey = sy + uy * scaledLen;
      targetCtx.strokeStyle = color;
      targetCtx.fillStyle = color;
      targetCtx.lineWidth = 1.5;
      targetCtx.beginPath();
      targetCtx.moveTo(sx, sy);
      targetCtx.lineTo(ex, ey);
      targetCtx.stroke();
      targetCtx.beginPath();
      targetCtx.moveTo(ex, ey);
      targetCtx.lineTo(ex - ux * 4 - uy * 2.5, ey - uy * 4 + ux * 2.5);
      targetCtx.lineTo(ex - ux * 4 + uy * 2.5, ey - uy * 4 - ux * 2.5);
      targetCtx.closePath();
      targetCtx.fill();
    };
    targetCtx.save();
    buildTerrainWindOverlaySamples(world).forEach((sample) => {
      drawBarb(x + sample.x01 * size, y + sample.y01 * size, sample.dx, sample.dy, sample.strength);
    });
    drawArrow(
      Math.cos(climateSeed.prevailingWindAngleRad),
      Math.sin(climateSeed.prevailingWindAngleRad),
      climateSeed.prevailingWindStrength,
      "rgba(83, 211, 194, 0.95)",
      0
    );
    drawArrow(world.wind?.dx ?? 0, world.wind?.dy ?? 0, world.wind?.strength ?? 0, "rgba(245, 247, 250, 0.95)", 11);
    targetCtx.restore();
  };

  return {
    element,
    update: (data) => {
      const world = data.world;
      if (!ctx || !world || !rasterCtx) {
        return;
      }
      const bounds = canvasWrap.getBoundingClientRect();
      if (bounds.width < 2 || bounds.height < 2) {
        return;
      }
      const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
      const targetWidth = Math.max(1, Math.floor(bounds.width * dpr));
      const targetHeight = Math.max(1, Math.floor(bounds.height * dpr));
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }

      const mode = MINIMAP_MODES[modeIndex] ?? "terrain";
      const cols = world.grid.cols;
      const rows = world.grid.rows;
      if (cols <= 0 || rows <= 0) {
        return;
      }
      const size = Math.max(1, Math.floor(Math.min(targetWidth, targetHeight)));
      const maxDim = Math.min(240, Math.max(80, Math.floor(size / dpr)));
      const scale = maxDim / Math.max(cols, rows);
      const mapWidth = Math.max(1, Math.floor(cols * scale));
      const mapHeight = Math.max(1, Math.floor(rows * scale));

      const now = performance.now();
      const terrainRevision = world.terrainTypeRevision ?? 0;
      const dynamicDue = isDynamicMinimapMode(mode) && now - lastRasterMs >= MINIMAP_DYNAMIC_REFRESH_MS;
      const needsRaster =
        mapWidth !== lastRasterWidth ||
        mapHeight !== lastRasterHeight ||
        mode !== lastMode ||
        (isTerrainRevisionMinimapMode(mode) && terrainRevision !== lastTerrainRevision) ||
        dynamicDue;
      if (needsRaster) {
        if (
          mode === "thermal" &&
          (thermalBackdrop.length !== mapWidth * mapHeight ||
            mapWidth !== lastRasterWidth ||
            mapHeight !== lastRasterHeight ||
            terrainRevision !== lastTerrainRevision)
        ) {
          thermalBackdrop = buildThermalBackdropField(world, mapWidth, mapHeight);
        }
        drawRaster(world, mode, mapWidth, mapHeight);
        lastMode = mode;
        lastRasterWidth = mapWidth;
        lastRasterHeight = mapHeight;
        lastTerrainRevision = terrainRevision;
        lastRasterMs = now;
      }

      ctx.clearRect(0, 0, targetWidth, targetHeight);
      const drawSize = Math.floor(Math.min(targetWidth, targetHeight));
      const drawX = Math.floor((targetWidth - drawSize) * 0.5);
      const drawY = Math.floor((targetHeight - drawSize) * 0.5);
      const smoothing = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(rasterCanvas, drawX, drawY, drawSize, drawSize);
      ctx.imageSmoothingEnabled = smoothing;
      drawWindOverlay(ctx, world, drawX, drawY, drawSize);
    }
  };
};
