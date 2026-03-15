import type { WorldState } from "../../../core/state.js";
import { TILE_ID_TO_TYPE } from "../../../core/state.js";
import { ELEVATION_TINT_HIGH, ELEVATION_TINT_LOW, TILE_COLOR_RGB } from "../../../core/config.js";
import { buildThermalBackdropField, buildThermalHotspotField, paintThermalField } from "../../../render/minimapRaster.js";

type RGB = { r: number; g: number; b: number };
type MiniMapMode = "terrain" | "elevation" | "thermal";

const MODES: readonly MiniMapMode[] = ["terrain", "elevation", "thermal"];
const THERMAL_LOW: RGB = { r: 20, g: 20, b: 22 };
const THERMAL_MID: RGB = { r: 192, g: 70, b: 40 };
const THERMAL_HIGH: RGB = { r: 242, g: 201, b: 76 };
const THERMAL_REFRESH_MS = 180;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const mix = (a: RGB, b: RGB, t: number): RGB => ({
  r: a.r + (b.r - a.r) * t,
  g: a.g + (b.g - a.g) * t,
  b: a.b + (b.b - a.b) * t
});

export type MiniMapPanelData = {
  world: WorldState | null;
};

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
  title.textContent = "Map";

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
  let lastMode: MiniMapMode = "terrain";
  let lastTerrainRevision = -1;
  let lastRasterWidth = 0;
  let lastRasterHeight = 0;
  let lastRasterMs = -Infinity;
  let thermalBackdrop: Float32Array = new Float32Array(0);

  const updateModeLabel = (): void => {
    modeButton.textContent = MODES[modeIndex].charAt(0).toUpperCase() + MODES[modeIndex].slice(1);
  };

  modeButton.addEventListener("click", () => {
    modeIndex = (modeIndex + 1) % MODES.length;
    updateModeLabel();
    lastMode = "terrain";
  });
  updateModeLabel();

  const drawRaster = (world: WorldState, mode: MiniMapMode, mapWidth: number, mapHeight: number): void => {
    if (!rasterCtx) {
      return;
    }
    if (rasterCanvas.width !== mapWidth || rasterCanvas.height !== mapHeight) {
      rasterCanvas.width = mapWidth;
      rasterCanvas.height = mapHeight;
    }
    const image = rasterCtx.createImageData(mapWidth, mapHeight);
    const data = image.data;
    const cols = world.grid.cols;
    const rows = world.grid.rows;
    const tileTypes = world.tileTypeId;
    const elevations = world.tileElevation;
    if (mode === "thermal") {
      const hotspots = buildThermalHotspotField(world, mapWidth, mapHeight);
      paintThermalField(data, thermalBackdrop, hotspots, {
        low: THERMAL_LOW,
        mid: THERMAL_MID,
        high: THERMAL_HIGH
      });
    } else {
      for (let y = 0; y < mapHeight; y += 1) {
        const ty = Math.min(rows - 1, Math.floor((y / mapHeight) * rows));
        for (let x = 0; x < mapWidth; x += 1) {
          const tx = Math.min(cols - 1, Math.floor((x / mapWidth) * cols));
          const idx = ty * cols + tx;
          let color: RGB = { r: 40, g: 40, b: 42 };
          if (mode === "terrain") {
            const typeId = tileTypes[idx] ?? 0;
            const tileType = TILE_ID_TO_TYPE[typeId] ?? "grass";
            color = TILE_COLOR_RGB[tileType] ?? color;
          } else {
            const elev = clamp(elevations[idx] ?? 0, 0, 1);
            color = mix(ELEVATION_TINT_LOW, ELEVATION_TINT_HIGH, elev);
          }
          const base = (y * mapWidth + x) * 4;
          data[base] = color.r;
          data[base + 1] = color.g;
          data[base + 2] = color.b;
          data[base + 3] = 255;
        }
      }
    }
    rasterCtx.putImageData(image, 0, 0);
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

      const mode = MODES[modeIndex];
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
      const thermalDue = mode === "thermal" && now - lastRasterMs >= THERMAL_REFRESH_MS;
      const needsRaster =
        mapWidth !== lastRasterWidth ||
        mapHeight !== lastRasterHeight ||
        mode !== lastMode ||
        (mode === "terrain" && terrainRevision !== lastTerrainRevision) ||
        (mode === "thermal" && terrainRevision !== lastTerrainRevision) ||
        thermalDue;
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
    }
  };
};
