import { TILE_SIZE, WATER_PARTICLE_COLOR } from "../core/config.js";
import { clamp } from "../core/utils.js";
import { getRenderHeightAt } from "./terrainCache.js";
import { isoProject } from "./iso.js";
/**
 * Draws all non-fire particle effects (smoke, water).
 */
export const drawParticles = (state, ctx) => {
    // Draw smoke particles
    state.smokeParticles.forEach((particle) => {
        const baseHeight = getRenderHeightAt(state, particle.x, particle.y);
        const rise = (1 - particle.alpha) * TILE_SIZE * 5;
        const pos = isoProject(particle.x, particle.y, baseHeight + TILE_SIZE * 2 + rise);
        const alpha = clamp(particle.alpha * 0.95, 0, 0.95);
        const radius = particle.size * 0.7;
        ctx.fillStyle = `rgba(85, 85, 85, ${alpha})`;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
        ctx.fill();
        if (alpha > 0.1) {
            ctx.fillStyle = `rgba(55, 55, 55, ${alpha * 0.45})`;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, radius * 0.6, 0, Math.PI * 2);
            ctx.fill();
        }
    });
    // Draw water particles
    ctx.fillStyle = WATER_PARTICLE_COLOR;
    const originalAlpha = ctx.globalAlpha;
    state.waterParticles.forEach((particle) => {
        const baseHeight = getRenderHeightAt(state, particle.x, particle.y);
        const pos = isoProject(particle.x, particle.y, baseHeight + TILE_SIZE * 0.5);
        ctx.globalAlpha = clamp(particle.alpha, 0, 1);
        ctx.fillRect(pos.x - particle.size / 2, pos.y - particle.size / 2, particle.size, particle.size);
    });
    ctx.globalAlpha = originalAlpha;
};
