import type { WorldState } from "../../../core/state.js";
import { TILE_ID_TO_TYPE } from "../../../core/state.js";
import { ELEVATION_TINT_HIGH, ELEVATION_TINT_LOW, TILE_COLOR_RGB } from "../../../core/config.js";
import type { HudState } from "../hudState.js";
import { cycleMinimapMode } from "../hudState.js";
import type { Rect, WidgetSlot, WidgetType } from "../hudLayout.js";
import { HUD_PLANE_Y } from "../hudLayout.js";
import type { HudInput, HudWidget } from "./hudWidget.js";
import { computeViewportCenterOnPlane } from "../minimapViewport.js";
import { buildThermalBackdropField, buildThermalHotspotField, paintThermalField } from "../../minimapRaster.js";

type RGB = { r: number; g: number; b: number };

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const mix = (a: RGB, b: RGB, t: number): RGB => ({
  r: a.r + (b.r - a.r) * t,
  g: a.g + (b.g - a.g) * t,
  b: a.b + (b.b - a.b) * t
});

export class MinimapWidget implements HudWidget {
  public readonly type: WidgetType = "minimap";
  private slot: WidgetSlot;
  private mapCanvas: HTMLCanvasElement;
  private mapCtx: CanvasRenderingContext2D | null;
  private modeRect: Rect | null = null;
  private lastMode = "";
  private lastMapWidth = 0;
  private lastMapHeight = 0;
  private lastTerrainRevision = -1;
  private lastRasterMs = -Infinity;
  private thermalBackdrop: Float32Array = new Float32Array(0);

  constructor(slot: WidgetSlot) {
    this.slot = slot;
    this.mapCanvas = document.createElement("canvas");
    this.mapCtx = this.mapCanvas.getContext("2d");
  }

  render(ctx: CanvasRenderingContext2D, rect: Rect, world: WorldState, ui: HudState): void {
    const padding = 6;
    const labelHeight = 18;
    const mode = ui.slots[this.slot].minimapMode;
    const labelWidth = Math.min(150, Math.max(80, rect.width * 0.6));
    this.modeRect = {
      x: rect.x + padding,
      y: rect.y + padding,
      width: labelWidth,
      height: labelHeight
    };

    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();

    ctx.fillStyle = ui.theme.minimapPanelBackground;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

    ctx.fillStyle = ui.theme.minimapModeBackground;
    ctx.strokeStyle = ui.theme.minimapModeBorder;
    ctx.lineWidth = 1;
    ctx.fillRect(this.modeRect.x, this.modeRect.y, this.modeRect.width, this.modeRect.height);
    ctx.strokeRect(this.modeRect.x + 0.5, this.modeRect.y + 0.5, this.modeRect.width - 1, this.modeRect.height - 1);
    ctx.fillStyle = ui.theme.minimapModeText;
    ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`MODE: ${mode.toUpperCase()}`, this.modeRect.x + 6, this.modeRect.y + this.modeRect.height / 2);

    const rawMapRect: Rect = {
      x: rect.x + padding,
      y: rect.y + padding + labelHeight + 6,
      width: Math.max(10, rect.width - padding * 2),
      height: Math.max(10, rect.height - padding * 2 - labelHeight - 6)
    };

    const squareSize = Math.min(rawMapRect.width, rawMapRect.height);
    const mapRect: Rect = {
      x: rawMapRect.x + (rawMapRect.width - squareSize) / 2,
      y: rawMapRect.y + (rawMapRect.height - squareSize) / 2,
      width: squareSize,
      height: squareSize
    };

    this.drawMinimap(ctx, mapRect, world, ui, mode);

    ctx.strokeStyle = ui.theme.minimapBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(mapRect.x + 0.5, mapRect.y + 0.5, mapRect.width - 1, mapRect.height - 1);

    this.drawViewportOverlay(ctx, mapRect, world, ui);

    ctx.restore();
  }

  handleInput(input: HudInput, _rect: Rect, _world: WorldState, ui: HudState): void {
    if (input.type !== "click" || !this.modeRect) {
      return;
    }
    const { x, y } = input;
    if (
      x >= this.modeRect.x &&
      x <= this.modeRect.x + this.modeRect.width &&
      y >= this.modeRect.y &&
      y <= this.modeRect.y + this.modeRect.height
    ) {
      cycleMinimapMode(ui, this.slot);
    }
  }

  private drawMinimap(ctx: CanvasRenderingContext2D, rect: Rect, world: WorldState, ui: HudState, mode: string): void {
    if (!this.mapCtx || rect.width <= 2 || rect.height <= 2) {
      return;
    }
    const cols = world.grid.cols;
    const rows = world.grid.rows;
    if (cols <= 0 || rows <= 0) {
      return;
    }

    const maxDim = Math.min(180, Math.max(60, Math.floor(Math.min(rect.width, rect.height))));
    const scale = maxDim / Math.max(cols, rows);
    const mapWidth = Math.max(1, Math.floor(cols * scale));
    const mapHeight = Math.max(1, Math.floor(rows * scale));
    const sizeChanged = this.mapCanvas.width !== mapWidth || this.mapCanvas.height !== mapHeight;
    if (sizeChanged) {
      this.mapCanvas.width = mapWidth;
      this.mapCanvas.height = mapHeight;
    }

    const now = performance.now();
    const terrainRevision = world.terrainTypeRevision ?? 0;
    const thermalIntervalMs = 180;
    const thermalDue = mode === "thermal" && now - this.lastRasterMs >= thermalIntervalMs;
    const needsRaster =
      sizeChanged ||
      mode !== this.lastMode ||
      (mode === "terrain" && terrainRevision !== this.lastTerrainRevision) ||
      (mode === "thermal" && terrainRevision !== this.lastTerrainRevision) ||
      thermalDue;

    if (needsRaster) {
      const image = this.mapCtx.createImageData(mapWidth, mapHeight);
      const data = image.data;
      const tileTypes = world.tileTypeId;
      const elevations = world.tileElevation;
      if (mode === "thermal") {
        const pixelCount = mapWidth * mapHeight;
        const thermalBackdropDirty =
          this.thermalBackdrop.length !== pixelCount ||
          sizeChanged ||
          terrainRevision !== this.lastTerrainRevision;
        if (thermalBackdropDirty) {
          this.thermalBackdrop = buildThermalBackdropField(world, mapWidth, mapHeight);
        }
        const hotspots = buildThermalHotspotField(world, mapWidth, mapHeight);
        paintThermalField(data, this.thermalBackdrop, hotspots, {
          low: ui.theme.thermalLow,
          mid: ui.theme.thermalMid,
          high: ui.theme.thermalHigh
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
      this.mapCtx.putImageData(image, 0, 0);
      this.lastMode = mode;
      this.lastMapWidth = mapWidth;
      this.lastMapHeight = mapHeight;
      this.lastTerrainRevision = terrainRevision;
      this.lastRasterMs = now;
    }

    const destX = Math.round(rect.x);
    const destY = Math.round(rect.y);
    const destW = Math.round(rect.width);
    const destH = Math.round(rect.height);
    const smoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.mapCanvas, destX, destY, destW, destH);
    ctx.imageSmoothingEnabled = smoothing;
  }

  private drawViewportOverlay(ctx: CanvasRenderingContext2D, rect: Rect, world: WorldState, ui: HudState): void {
    const cols = world.grid.cols;
    const rows = world.grid.rows;
    const worldWidth = Math.max(1, cols - 1);
    const worldDepth = Math.max(1, rows - 1);
    const bounds = {
      minX: -worldWidth * 0.5,
      maxX: worldWidth * 0.5,
      minZ: -worldDepth * 0.5,
      maxZ: worldDepth * 0.5
    };
    const center = computeViewportCenterOnPlane(ui.camera, HUD_PLANE_Y, bounds);
    if (!center) {
      return;
    }
    const toMap = (x: number, z: number): { x: number; y: number } => {
      const tx = (x - bounds.minX) / Math.max(1e-6, bounds.maxX - bounds.minX);
      const tz = (z - bounds.minZ) / Math.max(1e-6, bounds.maxZ - bounds.minZ);
      return {
        x: rect.x + tx * rect.width,
        y: rect.y + tz * rect.height
      };
    };
    ctx.save();
    const mapped = toMap(center.x, center.y);
    const len = Math.min(rect.width, rect.height) * 0.12;
    ctx.strokeStyle = ui.theme.minimapViewportStroke;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mapped.x - len, mapped.y);
    ctx.lineTo(mapped.x + len, mapped.y);
    ctx.moveTo(mapped.x, mapped.y - len);
    ctx.lineTo(mapped.x, mapped.y + len);
    ctx.stroke();
    ctx.fillStyle = ui.theme.minimapViewportFill;
    ctx.beginPath();
    ctx.arc(mapped.x, mapped.y, Math.max(2, len * 0.15), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
