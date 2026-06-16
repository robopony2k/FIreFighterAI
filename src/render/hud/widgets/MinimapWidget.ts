import type { WorldState } from "../../../core/state.js";
import type { HudState } from "../hudState.js";
import { cycleMinimapMode } from "../hudState.js";
import type { Rect, WidgetSlot, WidgetType } from "../hudLayout.js";
import { HUD_PLANE_Y } from "../hudLayout.js";
import type { HudInput, HudWidget } from "./hudWidget.js";
import { computeViewportCenterOnPlane } from "../minimapViewport.js";
import { getMinimapModeLabel, type MinimapMode } from "../../../ui/runtime/minimap/minimapModes.js";
import {
  buildThermalBackdropField,
  isDynamicMinimapMode,
  isTerrainRevisionMinimapMode,
  MINIMAP_DYNAMIC_REFRESH_MS,
  paintMinimapRaster
} from "../../../ui/runtime/minimap/minimapRaster.js";
import { generateWorldClimateSeed } from "../../../systems/climate/sim/worldClimateSeed.js";
import { buildTerrainWindOverlaySamples } from "../../../systems/fire/rendering/terrainWindOverlay.js";

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

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
    ctx.fillText(`MODE: ${getMinimapModeLabel(mode).toUpperCase()}`, this.modeRect.x + 6, this.modeRect.y + this.modeRect.height / 2);

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
    this.drawWindOverlay(ctx, mapRect, world, mode);

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

  private drawMinimap(ctx: CanvasRenderingContext2D, rect: Rect, world: WorldState, ui: HudState, mode: MinimapMode): void {
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
    const dynamicDue = isDynamicMinimapMode(mode) && now - this.lastRasterMs >= MINIMAP_DYNAMIC_REFRESH_MS;
    const needsRaster =
      sizeChanged ||
      mode !== this.lastMode ||
      (isTerrainRevisionMinimapMode(mode) && terrainRevision !== this.lastTerrainRevision) ||
      dynamicDue;

    if (needsRaster) {
      const image = this.mapCtx.createImageData(mapWidth, mapHeight);
      const data = image.data;
      const pixelCount = mapWidth * mapHeight;
      if (mode === "thermal") {
        const thermalBackdropDirty =
          this.thermalBackdrop.length !== pixelCount ||
          sizeChanged ||
          terrainRevision !== this.lastTerrainRevision;
        if (thermalBackdropDirty) {
          this.thermalBackdrop = buildThermalBackdropField(world, mapWidth, mapHeight);
        }
      }
      paintMinimapRaster(data, world, mode, mapWidth, mapHeight, {
        thermalBackdrop: this.thermalBackdrop,
        thermalPalette: {
          low: ui.theme.thermalLow,
          mid: ui.theme.thermalMid,
          high: ui.theme.thermalHigh
        }
      });
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

  private drawWindOverlay(ctx: CanvasRenderingContext2D, rect: Rect, world: WorldState, mode: MinimapMode): void {
    const climateSeed = generateWorldClimateSeed(world.seed);
    const prevailing = {
      dx: Math.cos(climateSeed.prevailingWindAngleRad),
      dy: Math.sin(climateSeed.prevailingWindAngleRad),
      strength: climateSeed.prevailingWindStrength
    };
    const originX = rect.x + rect.width * 0.16;
    const originY = rect.y + rect.height * 0.16;
    const len = Math.max(8, Math.min(rect.width, rect.height) * 0.13);
    const barbLen = Math.max(9, Math.min(rect.width, rect.height) * 0.072);
    const barbColor =
      mode === "thermal"
        ? "rgba(115, 235, 255, 0.95)"
        : mode === "topographic"
          ? "rgba(255, 238, 128, 0.96)"
          : mode === "moisture"
            ? "rgba(255, 247, 214, 0.96)"
            : "rgba(255, 255, 255, 0.96)";
    const drawBarb = (x: number, y: number, dx: number, dy: number, strength: number): void => {
      const mag = Math.hypot(dx, dy);
      const scaledLen = barbLen * clamp(strength, 0, 1.6);
      if (strength <= 0.04 || mag <= 0.0001 || scaledLen < 2.25) {
        ctx.fillStyle = "rgba(8, 10, 14, 0.78)";
        ctx.beginPath();
        ctx.arc(x, y, 2.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = barbColor;
        ctx.beginPath();
        ctx.arc(x, y, 1.35, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      const ux = dx / mag;
      const uy = dy / mag;
      const ex = x + ux * scaledLen;
      const ey = y + uy * scaledLen;
      const side = scaledLen * 0.28;
      ctx.strokeStyle = "rgba(8, 10, 14, 0.78)";
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(ex, ey);
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - ux * side - uy * side * 0.7, ey - uy * side + ux * side * 0.7);
      ctx.moveTo(ex - ux * side * 0.45, ey - uy * side * 0.45);
      ctx.lineTo(ex - ux * side * 1.15 + uy * side * 0.55, ey - uy * side * 1.15 - ux * side * 0.55);
      ctx.stroke();
      ctx.strokeStyle = barbColor;
      ctx.lineWidth = 1.7;
      ctx.stroke();
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
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - ux * 4 - uy * 2.5, ey - uy * 4 + ux * 2.5);
      ctx.lineTo(ex - ux * 4 + uy * 2.5, ey - uy * 4 - ux * 2.5);
      ctx.closePath();
      ctx.fill();
    };
    ctx.save();
    buildTerrainWindOverlaySamples(world).forEach((sample) => {
      const x = rect.x + sample.x01 * rect.width;
      const y = rect.y + sample.y01 * rect.height;
      drawBarb(x, y, sample.dx, sample.dy, sample.strength);
    });
    drawArrow(prevailing.dx, prevailing.dy, prevailing.strength, "rgba(83, 211, 194, 0.95)", 0);
    drawArrow(world.wind?.dx ?? 0, world.wind?.dy ?? 0, world.wind?.strength ?? 0, "rgba(245, 247, 250, 0.95)", 11);
    ctx.restore();
  }
}
