import { TILE_SIZE } from "../core/config.js";
import { indexFor } from "../core/grid.js";
import { getViewTransform, isoProject } from "./iso.js";
import { syncTileSoA } from "../core/state.js";
import { getVisibleBounds } from "./view.js";
import { ensureTerrainCache, getRenderHeightForTile } from "./terrainCache.js";
import { updateFireSmoothing, drawFireFx } from "./fireFx.js";
import { drawUnits } from "./units.js";
import { drawParticles } from "./particles.js";
/**
 * The main rendering function for the game.
 * Orchestrates drawing the terrain, fire, units, particles, and UI elements.
 * @param state The current world state.
 * @param canvas The target HTML canvas element.
 * @param ctx The 2D rendering context of the canvas.
 */
export function draw(state, canvas, ctx) {
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
            const startHeight = getRenderHeightForTile(state.tiles[indexFor(state.grid, state.formationStart.x, state.formationStart.y)]);
            const endHeight = getRenderHeightForTile(state.tiles[indexFor(state.grid, state.formationEnd.x, state.formationEnd.y)]);
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
