import type { EffectsState } from "../core/effectsState.js";
import type { WorldState } from "../core/state.js";
import { TILE_SIZE, WATER_PARTICLE_COLOR } from "../core/config.js";
import { clamp } from "../core/utils.js";
import { getRenderHeightAt } from "./terrainCache.js";
import { isoProject } from "./iso.js";

export {
  createParticleBuffers,
  createSmokeShaderMaterial,
  type ParticleBuffers,
  type SmokeShaderMaterialOptions
} from "../systems/fire/rendering/fireSmokeSystem.js";

/**
 * Draws all non-fire particle effects (smoke, water).
 */
/**
 * @deprecated Legacy 2D renderer. Prefer the 3D render backend.
 */
export const drawParticles = (state: WorldState, effects: EffectsState, ctx: CanvasRenderingContext2D) => {
  const canvasWidth = ctx.canvas.width;
  const canvasHeight = ctx.canvas.height;

  effects.smokeParticles.forEach((particle) => {
    const baseHeight = getRenderHeightAt(state, particle.x, particle.y);
    const rise = (1 - particle.alpha) * TILE_SIZE * 5;
    const pos = isoProject(particle.x, particle.y, baseHeight + TILE_SIZE * 2 + rise);
    const alpha = clamp(particle.alpha * 0.95, 0, 0.95);
    const radius = particle.size * 0.7;
    if (
      pos.x + radius < 0 ||
      pos.x - radius > canvasWidth ||
      pos.y + radius < 0 ||
      pos.y - radius > canvasHeight
    ) {
      return;
    }
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

  ctx.fillStyle = WATER_PARTICLE_COLOR;
  const originalAlpha = ctx.globalAlpha;
  effects.waterParticles.forEach((particle) => {
    const baseHeight = getRenderHeightAt(state, particle.x, particle.y);
    const pos = isoProject(particle.x, particle.y, baseHeight + TILE_SIZE * 0.5);
    const half = particle.size * 0.5;
    if (
      pos.x + half < 0 ||
      pos.x - half > canvasWidth ||
      pos.y + half < 0 ||
      pos.y - half > canvasHeight
    ) {
      return;
    }
    ctx.globalAlpha = clamp(particle.alpha, 0, 1);
    ctx.fillRect(pos.x - half, pos.y - half, particle.size, particle.size);
  });
  ctx.globalAlpha = originalAlpha;
};
