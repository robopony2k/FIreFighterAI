import type { WorldState } from "../core/state.js";
import { TILE_SIZE } from "../core/config.js";
import { indexFor } from "../core/grid.js";
import { getViewTransform, isoProject } from "./iso.js";
import { syncTileSoA } from "../core/state.js";
import { getVisibleBounds } from "./view.js";
import { ensureTerrainCache, getRenderHeightAt } from "./terrainCache.js";
import { updateFireSmoothing, drawFireFx } from "./fireFx.js";
import { drawUnits } from "./units.js";
import { drawParticles } from "./particles.js";

const formatNumber = (value: number, digits = 3): string => (Number.isFinite(value) ? value.toFixed(digits) : "inf");

const formatOptional = (value: number | undefined | null, digits = 3): string =>
  typeof value === "number" ? value.toFixed(digits) : "n/a";

const drawDebugCellHighlight = (
  state: WorldState,
  ctx: CanvasRenderingContext2D,
  view: { scale: number },
  tileX: number,
  tileY: number
): void => {
  const idx = indexFor(state.grid, tileX, tileY);
  const p0 = isoProject(tileX, tileY, getRenderHeightAt(state, tileX, tileY));
  const p1 = isoProject(tileX + 1, tileY, getRenderHeightAt(state, tileX + 1, tileY));
  const p2 = isoProject(tileX + 1, tileY + 1, getRenderHeightAt(state, tileX + 1, tileY + 1));
  const p3 = isoProject(tileX, tileY + 1, getRenderHeightAt(state, tileX, tileY + 1));

  ctx.save();
  ctx.lineWidth = Math.max(1, 1.5 / view.scale);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p3.x, p3.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
};

const drawDebugCellPanel = (
  state: WorldState,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  tileX: number,
  tileY: number
): void => {
  const idx = indexFor(state.grid, tileX, tileY);
  const tile = state.tiles[idx];
  const cachedFire = state.tileFire[idx];
  const cachedHeat = state.tileHeat[idx];
  const cachedFuel = state.tileFuel[idx];
  const cachedIgniteAt = state.tileIgniteAt[idx];
  const cachedIgnition = state.tileIgnitionPoint[idx];
  const cachedBurnRate = state.tileBurnRate[idx];
  const cachedHeatOutput = state.tileHeatOutput[idx];
  const smoothFire = state.renderFireSmooth[idx];
  const inBounds =
    state.fireBoundsActive &&
    tileX >= state.fireMinX &&
    tileX <= state.fireMaxX &&
    tileY >= state.fireMinY &&
    tileY <= state.fireMaxY;
  const hoverWorld = state.debugHoverWorld;
  const height = getRenderHeightAt(state, tileX + 0.5, tileY + 0.5);

  const lines = [
    `cell ${tileX},${tileY}`,
    `type=${tile.type} id=${state.tileTypeId[idx] ?? "n/a"} base=${tile.isBase ? "1" : "0"}`,
    `phase=${state.phase} paused=${state.paused ? "1" : "0"} fireDay=${formatNumber(state.fireSeasonDay, 2)}`,
    `simAcc=${formatNumber(state.fireSimAccumulator, 2)} active=${state.lastActiveFires}`,
    `fire=${formatNumber(tile.fire)} heat=${formatNumber(tile.heat)} fuel=${formatNumber(tile.fuel)}`,
    `ignite=${formatNumber(tile.ignitionPoint)} burn=${formatNumber(tile.burnRate)} heatOut=${formatNumber(tile.heatOutput)}`,
    `spread=${formatOptional(tile.spreadBoost)} cap=${formatOptional(tile.heatTransferCap)} retain=${formatOptional(tile.heatRetention)}`,
    `wind=${formatOptional(tile.windFactor)} moist=${formatNumber(tile.moisture)} canopy=${formatNumber(tile.canopy)}`,
    `ashAge=${formatNumber(tile.ashAge, 2)} elev=${formatNumber(tile.elevation)} height=${formatNumber(height, 2)}`,
    `cache fire=${formatNumber(cachedFire)} heat=${formatNumber(cachedHeat)} fuel=${formatNumber(cachedFuel)}`,
    `cache ignite=${formatNumber(cachedIgnition)} burn=${formatNumber(cachedBurnRate)} heatOut=${formatNumber(cachedHeatOutput)}`,
    `igniteAt=${formatNumber(cachedIgniteAt, 3)} smooth=${formatNumber(smoothFire)}`,
    `bounds active=${state.fireBoundsActive ? "1" : "0"} in=${inBounds ? "1" : "0"}`,
    hoverWorld ? `world ${formatNumber(hoverWorld.x, 2)},${formatNumber(hoverWorld.y, 2)}` : "world n/a"
  ];

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.textBaseline = "top";
  const padding = 8;
  const lineHeight = 14;
  let maxWidth = 0;
  lines.forEach((line) => {
    const width = ctx.measureText(line).width;
    if (width > maxWidth) {
      maxWidth = width;
    }
  });
  const boxWidth = Math.min(canvas.width - padding * 2, maxWidth + padding * 2);
  const boxHeight = lines.length * lineHeight + padding * 2;
  const boxX = Math.max(padding, canvas.width - boxWidth - padding);
  const boxY = Math.max(padding, canvas.height - boxHeight - padding);
  ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
  ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
  ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
  ctx.fillStyle = "#e8e8e8";
  lines.forEach((line, i) => {
    ctx.fillText(line, boxX + padding, boxY + padding + i * lineHeight);
  });
  ctx.restore();
};

/**
 * The main rendering function for the game.
 * Orchestrates drawing the terrain, fire, units, particles, and UI elements.
 * @param state The current world state.
 * @param canvas The target HTML canvas element.
 * @param ctx The 2D rendering context of the canvas.
 */
export function draw(state: WorldState, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
  // Ensure the Structure-of-Arrays tile data is in sync with the main state.
  syncTileSoA(state);

  const view = getViewTransform(state, canvas);
  const now = performance.now();

  // Update smoothed fire values for rendering
  updateFireSmoothing(state, now);
  state.lastRenderTime = now;

  // --- Main Rendering ---
  const cache = ensureTerrainCache(state, now);

  // Reset transform and clear screen
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Apply camera view transform
  ctx.setTransform(view.scale, 0, 0, view.scale, view.offsetX, view.offsetY);

  // Draw the pre-rendered terrain from its cache
  ctx.drawImage(cache.canvas, cache.originX, cache.originY);

  if (state.renderEffects) {
    // Draw formation line for units
    if (state.formationStart && state.formationEnd) {
      const startHeight = getRenderHeightAt(state, state.formationStart.x + 0.5, state.formationStart.y + 0.5);
      const endHeight = getRenderHeightAt(state, state.formationEnd.x + 0.5, state.formationEnd.y + 0.5);
      const start = isoProject(state.formationStart.x + 0.5, state.formationStart.y + 0.5, startHeight + TILE_SIZE * 0.1);
      const end = isoProject(state.formationEnd.x + 0.5, state.formationEnd.y + 0.5, endHeight + TILE_SIZE * 0.1);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.65)";
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const visibleBounds = getVisibleBounds(state, canvas, view);

    // Draw all fire effects
    drawFireFx(state, ctx, now, visibleBounds, view);

    // Draw all units and their related effects (selection, hoses)
    drawUnits(state, ctx);

    // Draw non-fire particles (smoke, water)
    drawParticles(state, ctx);
  }

  // Draw screen-space UI elements like the selection box
  if (state.debugCellEnabled && state.debugHoverTile) {
    drawDebugCellHighlight(state, ctx, view, state.debugHoverTile.x, state.debugHoverTile.y);
  }
  if (state.debugCellEnabled && state.debugHoverTile) {
    drawDebugCellPanel(state, canvas, ctx, state.debugHoverTile.x, state.debugHoverTile.y);
  }
  if (state.selectionBox) {
    const { x1, y1, x2, y2 } = state.selectionBox;
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);

    // Reset transform to draw in screen space
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "rgba(240, 179, 59, 0.15)";
    ctx.strokeStyle = "rgba(240, 179, 59, 0.85)";
    ctx.lineWidth = 1.5;
    ctx.fillRect(left, top, width, height);
    ctx.strokeRect(left, top, width, height);
  }
}
