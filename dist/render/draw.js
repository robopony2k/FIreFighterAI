import { TILE_SIZE, TILE_COLOR_RGB } from "../core/config.js";
import { indexFor } from "../core/grid.js";
import { getTileHeight, getViewTransform, isoProject } from "./iso.js";
import { syncTileSoA } from "../core/state.js";
import { getVisibleBounds } from "./view.js";
import { ensureTerrainCache, ensureTreeLayerCache, getRenderHeightAt } from "./terrainCache.js";
import { updateFireSmoothing, drawFireFx } from "./fireFx.js";
import { drawUnits } from "./units.js";
import { drawParticles } from "./particles.js";
import { clamp } from "../core/utils.js";
import { darken, mixRgb } from "./color.js";
import { hash2D } from "../mapgen/noise.js";
const formatNumber = (value, digits = 3) => (Number.isFinite(value) ? value.toFixed(digits) : "inf");
const formatOptional = (value, digits = 3) => typeof value === "number" ? value.toFixed(digits) : "n/a";
const GRID_COLORS = {
    grass: darken(TILE_COLOR_RGB.grass, 0.35),
    forest: darken(TILE_COLOR_RGB.forest, 0.4),
    ash: { r: 72, g: 62, b: 54 },
    road: darken(TILE_COLOR_RGB.road, 0.28),
    base: darken(TILE_COLOR_RGB.base, 0.2),
    house: darken(TILE_COLOR_RGB.house, 0.2),
    firebreak: darken(TILE_COLOR_RGB.firebreak, 0.25)
};
const rgbaString = (color, alpha) => `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${alpha})`;
const COAST_EDGE_N = 1;
const COAST_EDGE_E = 2;
const COAST_EDGE_S = 4;
const COAST_EDGE_W = 8;
const COAST_BAND_PX = TILE_SIZE * 0.45;
const COAST_JITTER_PX = 2.2;
const COAST_BAND_ALPHA = 0.42;
const COAST_BAND_ALPHA_JITTER = 0.18;
const SHALLOW_WATER_COLOR = mixRgb(TILE_COLOR_RGB.water, TILE_COLOR_RGB.grass, 0.22);
const getBaseTileColor = (state, tile) => {
    if (tile.type === "grass" || tile.type === "forest") {
        const canopy = clamp(tile.canopy, 0, 1);
        return mixRgb(TILE_COLOR_RGB.grass, TILE_COLOR_RGB.forest, canopy);
    }
    if (tile.type === "ash") {
        return TILE_COLOR_RGB.ash;
    }
    if (tile.type === "firebreak") {
        return TILE_COLOR_RGB.firebreak;
    }
    return TILE_COLOR_RGB.grass;
};
const getShoreLandColor = (state, tile) => {
    const base = getBaseTileColor(state, tile);
    const sandMix = mixRgb(base, TILE_COLOR_RGB.firebreak, tile.type === "forest" ? 0.25 : 0.35);
    return mixRgb(sandMix, TILE_COLOR_RGB.grass, 0.2);
};
const computeCoastEdgeMask = (state, x, y) => {
    const tile = state.tiles[indexFor(state.grid, x, y)];
    if (tile.type !== "water") {
        return 0;
    }
    let mask = 0;
    if (y > 0 && state.tiles[indexFor(state.grid, x, y - 1)].type !== "water") {
        mask |= COAST_EDGE_N;
    }
    if (x < state.grid.cols - 1 && state.tiles[indexFor(state.grid, x + 1, y)].type !== "water") {
        mask |= COAST_EDGE_E;
    }
    if (y < state.grid.rows - 1 && state.tiles[indexFor(state.grid, x, y + 1)].type !== "water") {
        mask |= COAST_EDGE_S;
    }
    if (x > 0 && state.tiles[indexFor(state.grid, x - 1, y)].type !== "water") {
        mask |= COAST_EDGE_W;
    }
    return mask;
};
const getWaterLandInfluence = (state, x, y) => {
    const neighbors = [
        { x: x + 1, y, w: 1 },
        { x: x - 1, y, w: 1 },
        { x, y: y + 1, w: 1 },
        { x, y: y - 1, w: 1 },
        { x: x + 1, y: y + 1, w: 0.7 },
        { x: x + 1, y: y - 1, w: 0.7 },
        { x: x - 1, y: y + 1, w: 0.7 },
        { x: x - 1, y: y - 1, w: 0.7 }
    ];
    let landWeight = 0;
    let totalWeight = 0;
    neighbors.forEach((pos) => {
        totalWeight += pos.w;
        if (pos.x < 0 || pos.y < 0 || pos.x >= state.grid.cols || pos.y >= state.grid.rows) {
            landWeight += pos.w;
            return;
        }
        const neighbor = state.tiles[indexFor(state.grid, pos.x, pos.y)];
        if (neighbor.type !== "water") {
            landWeight += pos.w;
        }
    });
    return totalWeight > 0 ? clamp(landWeight / totalWeight, 0, 1) : 0;
};
const getSmoothedWaterInfluence = (state, x, y) => {
    let sum = getWaterLandInfluence(state, x, y);
    let count = 1;
    const cardinals = [
        { x: x + 1, y },
        { x: x - 1, y },
        { x, y: y + 1 },
        { x, y: y - 1 }
    ];
    cardinals.forEach((pos) => {
        if (pos.x < 0 || pos.y < 0 || pos.x >= state.grid.cols || pos.y >= state.grid.rows) {
            return;
        }
        const neighbor = state.tiles[indexFor(state.grid, pos.x, pos.y)];
        if (neighbor.type !== "water") {
            return;
        }
        sum += getWaterLandInfluence(state, pos.x, pos.y);
        count += 1;
    });
    return clamp(sum / count, 0, 1);
};
const getWaterSurfaceCorners = (state, x, y) => {
    const tile = state.tiles[indexFor(state.grid, x, y)];
    const waterHeight = getTileHeight(tile);
    const landInfluence = getSmoothedWaterInfluence(state, x, y);
    const surfaceBlend = clamp(landInfluence * 0.85, 0, 0.8);
    const h00 = getRenderHeightAt(state, x, y);
    const h10 = getRenderHeightAt(state, x + 1, y);
    const h11 = getRenderHeightAt(state, x + 1, y + 1);
    const h01 = getRenderHeightAt(state, x, y + 1);
    const w00 = waterHeight + (h00 - waterHeight) * surfaceBlend;
    const w10 = waterHeight + (h10 - waterHeight) * surfaceBlend;
    const w11 = waterHeight + (h11 - waterHeight) * surfaceBlend;
    const w01 = waterHeight + (h01 - waterHeight) * surfaceBlend;
    const p0 = isoProject(x, y, w00);
    const p1 = isoProject(x + 1, y, w10);
    const p2 = isoProject(x + 1, y + 1, w11);
    const p3 = isoProject(x, y + 1, w01);
    return { p0, p1, p2, p3, landInfluence };
};
const drawCoastBandForTile = (state, ctx, x, y, view) => {
    const edgeMask = computeCoastEdgeMask(state, x, y);
    if (!edgeMask) {
        return;
    }
    const { p0, p1, p2, p3, landInfluence } = getWaterSurfaceCorners(state, x, y);
    const center = {
        x: (p0.x + p1.x + p2.x + p3.x) * 0.25,
        y: (p0.y + p1.y + p2.y + p3.y) * 0.25
    };
    const bandBase = COAST_BAND_PX / Math.max(0.5, view.scale);
    const edgeCount = (edgeMask & COAST_EDGE_N ? 1 : 0) +
        (edgeMask & COAST_EDGE_E ? 1 : 0) +
        (edgeMask & COAST_EDGE_S ? 1 : 0) +
        (edgeMask & COAST_EDGE_W ? 1 : 0);
    const alphaScale = edgeCount > 0 ? 1 / edgeCount : 1;
    const drawEdge = (edgeId, a, b, neighborTile) => {
        const noise = hash2D(x + edgeId * 11, y + edgeId * 29, state.seed + 991);
        const jitter = (noise * 2 - 1) * COAST_JITTER_PX / Math.max(0.5, view.scale);
        const band = Math.max(0.5 / Math.max(0.5, view.scale), bandBase + jitter);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        let nx = -dy / len;
        let ny = dx / len;
        const mid = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
        const toCenter = { x: center.x - mid.x, y: center.y - mid.y };
        if (nx * toCenter.x + ny * toCenter.y < 0) {
            nx = -nx;
            ny = -ny;
        }
        const a2 = { x: a.x + nx * band, y: a.y + ny * band };
        const b2 = { x: b.x + nx * band, y: b.y + ny * band };
        const outerMid = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
        const innerMid = { x: (a2.x + b2.x) * 0.5, y: (a2.y + b2.y) * 0.5 };
        const landColor = getShoreLandColor(state, neighborTile);
        const shoreBase = mixRgb(SHALLOW_WATER_COLOR, TILE_COLOR_RGB.water, 0.35);
        const outerColor = mixRgb(shoreBase, landColor, 0.18 + landInfluence * 0.12);
        const grad = ctx.createLinearGradient(outerMid.x, outerMid.y, innerMid.x, innerMid.y);
        const alphaJitter = 1 + (hash2D(x + edgeId * 17, y + edgeId * 37, state.seed + 733) - 0.5) * COAST_BAND_ALPHA_JITTER;
        const edgeAlpha = clamp(COAST_BAND_ALPHA * alphaScale * alphaJitter, 0, 0.6);
        grad.addColorStop(0, rgbaString(outerColor, edgeAlpha));
        grad.addColorStop(1, rgbaString(TILE_COLOR_RGB.water, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(b2.x, b2.y);
        ctx.lineTo(a2.x, a2.y);
        ctx.closePath();
        ctx.fill();
    };
    if (edgeMask & COAST_EDGE_N) {
        const neighbor = state.tiles[indexFor(state.grid, x, y - 1)];
        drawEdge(1, p0, p1, neighbor);
    }
    if (edgeMask & COAST_EDGE_E) {
        const neighbor = state.tiles[indexFor(state.grid, x + 1, y)];
        drawEdge(2, p1, p2, neighbor);
    }
    if (edgeMask & COAST_EDGE_S) {
        const neighbor = state.tiles[indexFor(state.grid, x, y + 1)];
        drawEdge(3, p2, p3, neighbor);
    }
    if (edgeMask & COAST_EDGE_W) {
        const neighbor = state.tiles[indexFor(state.grid, x - 1, y)];
        drawEdge(4, p3, p0, neighbor);
    }
};
const drawCoastBands = (state, canvas, ctx, view) => {
    const bounds = getVisibleBounds(state, canvas, view);
    for (let y = bounds.startY; y <= bounds.endY; y += 1) {
        for (let x = bounds.startX; x <= bounds.endX; x += 1) {
            if (state.tiles[indexFor(state.grid, x, y)].type !== "water") {
                continue;
            }
            drawCoastBandForTile(state, ctx, x, y, view);
        }
    }
};
const drawGridOverlay = (state, canvas, ctx, view) => {
    const zoomFactor = clamp((view.scale - 0.75) / 1.3, 0, 1);
    const gridActive = state.deployMode !== null ||
        state.selectedUnitIds.length > 0 ||
        state.selectionBox !== null ||
        state.formationStart !== null ||
        state.formationEnd !== null ||
        state.clearLineStart !== null;
    const hoverBoost = state.debugHoverTile !== null;
    const baseAlpha = 0.03 + 0.1 * zoomFactor;
    const boostAlpha = (gridActive || hoverBoost ? 0.24 : 0) * zoomFactor;
    const alpha = clamp(baseAlpha + boostAlpha, 0, 0.35);
    if (alpha < 0.02) {
        return;
    }
    const bounds = getVisibleBounds(state, canvas, view);
    ctx.save();
    ctx.lineWidth = Math.max(0.8, 1.1 / view.scale);
    for (let y = bounds.startY; y <= bounds.endY; y += 1) {
        for (let x = bounds.startX; x <= bounds.endX; x += 1) {
            const idx = indexFor(state.grid, x, y);
            const tile = state.tiles[idx];
            if (tile.type === "water" || tile.type === "road" || tile.type === "base" || tile.type === "house") {
                continue;
            }
            let tileAlpha = alpha;
            if (tile.type === "forest") {
                tileAlpha *= 0.75;
            }
            else if (tile.type === "ash") {
                tileAlpha *= 0.6;
            }
            if (tile.waterDist <= 1) {
                tileAlpha *= 0.2;
            }
            else if (tile.waterDist === 2) {
                tileAlpha *= 0.5;
            }
            const nearRoad = (x > 0 && ["road", "base"].includes(state.tiles[indexFor(state.grid, x - 1, y)].type)) ||
                (x < state.grid.cols - 1 && ["road", "base"].includes(state.tiles[indexFor(state.grid, x + 1, y)].type)) ||
                (y > 0 && ["road", "base"].includes(state.tiles[indexFor(state.grid, x, y - 1)].type)) ||
                (y < state.grid.rows - 1 && ["road", "base"].includes(state.tiles[indexFor(state.grid, x, y + 1)].type));
            if (nearRoad) {
                tileAlpha *= 0.3;
            }
            if (tileAlpha < 0.01) {
                continue;
            }
            const p0 = isoProject(x, y, getRenderHeightAt(state, x, y));
            const p1 = isoProject(x + 1, y, getRenderHeightAt(state, x + 1, y));
            const p2 = isoProject(x + 1, y + 1, getRenderHeightAt(state, x + 1, y + 1));
            const p3 = isoProject(x, y + 1, getRenderHeightAt(state, x, y + 1));
            const color = GRID_COLORS[tile.type] ?? GRID_COLORS.grass;
            ctx.strokeStyle = rgbaString(color, tileAlpha);
            const edgeAllowed = (nx, ny) => {
                if (nx < 0 || ny < 0 || nx >= state.grid.cols || ny >= state.grid.rows) {
                    return false;
                }
                const neighbor = state.tiles[indexFor(state.grid, nx, ny)];
                return neighbor.type !== "water" && neighbor.type !== "road" && neighbor.type !== "base";
            };
            if (edgeAllowed(x, y - 1)) {
                ctx.beginPath();
                ctx.moveTo(p0.x, p0.y);
                ctx.lineTo(p1.x, p1.y);
                ctx.stroke();
            }
            if (edgeAllowed(x + 1, y)) {
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.stroke();
            }
            if (edgeAllowed(x, y + 1)) {
                ctx.beginPath();
                ctx.moveTo(p2.x, p2.y);
                ctx.lineTo(p3.x, p3.y);
                ctx.stroke();
            }
            if (edgeAllowed(x - 1, y)) {
                ctx.beginPath();
                ctx.moveTo(p3.x, p3.y);
                ctx.lineTo(p0.x, p0.y);
                ctx.stroke();
            }
        }
    }
    if (state.debugHoverTile) {
        const { x, y } = state.debugHoverTile;
        const p0 = isoProject(x, y, getRenderHeightAt(state, x, y));
        const p1 = isoProject(x + 1, y, getRenderHeightAt(state, x + 1, y));
        const p2 = isoProject(x + 1, y + 1, getRenderHeightAt(state, x + 1, y + 1));
        const p3 = isoProject(x, y + 1, getRenderHeightAt(state, x, y + 1));
        ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
        ctx.lineWidth = Math.max(1.2, 1.6 / view.scale);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.closePath();
        ctx.stroke();
    }
    ctx.restore();
};
const drawDebugCellHighlight = (state, ctx, view, tileX, tileY) => {
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
const drawDebugCellPanel = (state, canvas, ctx, tileX, tileY) => {
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
    const inBounds = state.fireBoundsActive &&
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
 * @param alpha Interpolation factor between the previous and current sim step.
 */
export function draw(state, canvas, ctx, alpha = 1) {
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
    drawCoastBands(state, canvas, ctx, view);
    drawGridOverlay(state, canvas, ctx, view);
    const treeLayer = ensureTreeLayerCache(state, now);
    if (treeLayer) {
        ctx.drawImage(treeLayer.canvas, treeLayer.originX, treeLayer.originY);
    }
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
        drawUnits(state, ctx, alpha);
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
