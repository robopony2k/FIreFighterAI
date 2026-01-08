
import type { WorldState } from "../core/state.js";
import { inBounds, indexFor } from "../core/grid.js";
import { FIRE_RENDER_SMOOTH_SECONDS, TILE_SIZE, FIRE_COLORS } from "../core/config.js";
import { clamp } from "../core/utils.js";
import { isoProject } from "./iso.js";
import { hash2D } from "../mapgen/noise.js";
import { getRenderHeightForTile } from "./terrainCache.js";
import type { Bounds, ViewTransform } from "./view.js";
import { FIRE_COLORS_RGB, mixRgbTo, rgbString, type RGB } from "./color.js";

const DRAW_HEAT_MAX = 5;
const MAX_VISIBLE_TILES = 5200;

/**
 * Updates the smoothed fire intensity values used for rendering.
 */
export const updateFireSmoothing = (state: WorldState, now: number) => {
  const dt = state.lastRenderTime > 0 ? (now - state.lastRenderTime) / 1000 : 0.016;
  const clampedDt = Math.min(dt, 0.05);

  const alpha =
    clampedDt > 0 && FIRE_RENDER_SMOOTH_SECONDS > 0
      ? 1 - Math.exp(-clampedDt / FIRE_RENDER_SMOOTH_SECONDS)
      : 1;

  if (state.fireBoundsActive) {
    for (let y = state.fireMinY; y <= state.fireMaxY; y++) {
      for (let x = state.fireMinX; x <= state.fireMaxX; x++) {
        const idx = indexFor(state.grid, x, y);
        const targetFire = state.tileFire[idx];
        state.renderFireSmooth[idx] += (targetFire - state.renderFireSmooth[idx]) * alpha;
      }
    }
  }
};

/**
 * Draws the fire glow and flame particles.
 */
export const drawFireFx = (
  state: WorldState,
  ctx: CanvasRenderingContext2D,
  now: number,
  visibleBounds: Bounds,
  view: ViewTransform
) => {
  const { startX, endX, startY, endY } = visibleBounds;
  const sumStart = startX + startY;
  const sumEnd = endX + endY;

  const viewWidth = endX - startX + 1;
  const viewHeight = endY - startY + 1;
  const tileBudget = MAX_VISIBLE_TILES;
  const sampleStep = Math.max(1, Math.ceil(Math.sqrt((viewWidth * viewHeight) / tileBudget)));
  const samplingEnabled = sampleStep > 1;

  const pColor: RGB = { r: 0, g: 0, b: 0 };
  const timeSeconds = now / 1000;

  ctx.globalCompositeOperation = "lighter";

  for (let sum = sumStart; sum <= sumEnd; sum += 1) {
    const xStart = Math.max(startX, sum - endY);
    const xEnd = Math.min(endX, sum - startY);
    for (let x = xStart; x <= xEnd; x += 1) {
      const y = sum - x;

      if (samplingEnabled && (x % sampleStep !== 0 || y % sampleStep !== 0)) {
        continue;
      }

      const idx = indexFor(state.grid, x, y);
      const tile = state.tiles[idx];
      const height = getRenderHeightForTile(tile);

      let fire = 0;
      if (samplingEnabled) {
        let maxFireInBlock = 0;
        for (let dy = 0; dy < sampleStep; dy++) {
          for (let dx = 0; dx < sampleStep; dx++) {
            if (inBounds(state.grid, x + dx, y + dy)) {
              const blockIdx = indexFor(state.grid, x + dx, y + dy);
              const blockFire = state.renderFireSmooth[blockIdx];
              if (blockFire > maxFireInBlock) {
                maxFireInBlock = blockFire;
              }
            }
          }
        }
        fire = maxFireInBlock;
      } else {
        fire = state.renderFireSmooth[idx];
      }

      if (fire > 0.01) {
        const intensity = clamp(fire, 0, 1);
        const radiusScale = samplingEnabled ? sampleStep * 0.75 : 1.0;

        const white = { r: 255, g: 255, b: 255 };
        const lightYellow = { r: 255, g: 255, b: 220 };
        const gold = { r: 255, g: 190, b: 0 };
        const orange = { r: 240, g: 120, b: 0 };
        const red = { r: 200, g: 30, b: 0 };

        // 1. Strengthened, grounded base glow
        const groundCenter = isoProject(x + 0.5, y + 0.5, height);
        const groundGlowRadius = TILE_SIZE * (0.7 + intensity * 0.5) * radiusScale;
        const groundGlowGrad = ctx.createRadialGradient(
          groundCenter.x,
          groundCenter.y,
          TILE_SIZE * 0.1 * radiusScale,
          groundCenter.x,
          groundCenter.y,
          groundGlowRadius
        );
        groundGlowGrad.addColorStop(0, `rgba(255, 255, 240, ${0.9 * intensity + 0.1})`);
        groundGlowGrad.addColorStop(0.25, `rgba(${gold.r}, ${gold.g}, ${gold.b}, ${0.6 * intensity})`);
        groundGlowGrad.addColorStop(0.6, `rgba(${orange.r}, ${orange.g}, ${orange.b}, 0.25)`);
        groundGlowGrad.addColorStop(1, `rgba(${red.r}, ${red.g}, ${red.b}, 0.0)`);

        ctx.fillStyle = groundGlowGrad;
        ctx.beginPath();
        ctx.arc(groundCenter.x, groundCenter.y, groundGlowRadius, 0, Math.PI * 2);
        ctx.fill();

        // --- LOD Setup ---
        const zoomThreshold = 0.6;
        const isLodZoom = view.scale < zoomThreshold;
        let flameletCount = 10;
        
        if (samplingEnabled) {
          flameletCount = 5;
        } else if (isLodZoom) {
          flameletCount = 7;
        }

        const spawnBase = isoProject(x + 0.5, y + 0.5, height + TILE_SIZE * 0.05);

        for (let i = 0; i < flameletCount; i++) {
          const s1 = hash2D(idx, i, state.seed + 151);
          const s2 = hash2D(idx, i, state.seed + 353);
          const s3 = hash2D(idx, i, state.seed + 555);

          let tier: "small" | "medium" | "large";
          if (samplingEnabled) {
             tier = s1 < 0.5 ? "large" : "medium";
          } else {
            if (s1 < 0.15) tier = "large";
            else if (s1 < 0.5) tier = "medium";
            else tier = "small";
          }
          
          let maxPhaseDuration = 1.0,
            riseHeightFactor = 1.0,
            startSizeFactor = 1.0,
            alphaFactor = 1.0;

          switch (tier) {
            case "large":
              maxPhaseDuration = 1.0 + s2 * 0.4;
              riseHeightFactor = 0.8 + s3 * 0.2;
              startSizeFactor = 1.0 + s2 * 0.2;
              break;
            case "medium":
              maxPhaseDuration = 0.6 + s2 * 0.3;
              riseHeightFactor = 0.5;
              startSizeFactor = 0.7;
              alphaFactor = 0.9;
              break;
            case "small":
              maxPhaseDuration = 0.3 + s2 * 0.2;
              riseHeightFactor = 0.2;
              startSizeFactor = 0.5;
              alphaFactor = 0.7;
              break;
          }
          const rate = 1.0 / maxPhaseDuration;
          const phase = (timeSeconds * rate + s3) % 1.0;

          const baseSpread = samplingEnabled ? TILE_SIZE * 0.4 * sampleStep : TILE_SIZE * 0.25;
          const ox = (s1 - 0.5) * baseSpread;
          const oy = (s2 - 0.5) * baseSpread * 0.5;
          const spawnPos = { x: spawnBase.x + ox, y: spawnBase.y + oy };

          const riseT = Math.pow(phase, 2.2);
          const riseHeight = TILE_SIZE * (1.4 + intensity * 1.6) * riseHeightFactor;

          const curlAmp = TILE_SIZE * 0.2 * (1.0 - riseT);
          const curl = Math.sin(phase * 18 + s1 * 6.28) * curlAmp;

          const flameletY = spawnPos.y - riseT * riseHeight;
          const flameletX = spawnPos.x + curl;

          const startSize = TILE_SIZE * (0.09 + intensity * 0.18) * startSizeFactor;
          const heightDecay = Math.pow(1.0 - phase, 1.0);
          const widthDecay = Math.pow(1.0 - phase, 2.2);
          const flameHeight = startSize * heightDecay;
          const flameWidth = startSize * 0.45 * widthDecay;

          if (flameHeight < 1.0) continue;

          const alphaT = Math.pow(Math.sin(Math.PI * phase), 1.5);
          const alpha = alphaT * (0.7 + 0.3 * intensity) * alphaFactor;

          if (phase < 0.2) {
            mixRgbTo(pColor, white, lightYellow, phase / 0.2);
          } else if (phase < 0.5) {
            mixRgbTo(pColor, lightYellow, gold, (phase - 0.2) / 0.3);
          } else {
            mixRgbTo(pColor, gold, orange, (phase - 0.5) / 0.5);
          }

          ctx.globalAlpha = alpha;
          ctx.fillStyle = rgbString(pColor);
          ctx.beginPath();
          ctx.ellipse(flameletX, flameletY, flameWidth, flameHeight, 0, 0, Math.PI * 2);
          ctx.fill();

          if (tier !== "small" && phase < 0.7) {
            const blurOffset = flameHeight * 0.4;
            const blurAlpha = alpha * 0.5;
            ctx.globalAlpha = blurAlpha;
            ctx.beginPath();
            ctx.ellipse(flameletX, flameletY - blurOffset, flameWidth * 0.8, flameHeight * 0.9, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
  }
  ctx.globalAlpha = 1.0;
  ctx.globalCompositeOperation = "source-over";
};
