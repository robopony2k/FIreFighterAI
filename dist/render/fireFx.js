import { inBounds, indexFor } from "../core/grid.js";
import { FIRE_RENDER_SMOOTH_SECONDS, TILE_SIZE } from "../core/config.js";
import { clamp } from "../core/utils.js";
import { isoProject } from "./iso.js";
import { hash2D } from "../mapgen/noise.js";
import { getRenderHeightAt } from "./terrainCache.js";
import { mixRgbTo, rgbString } from "./color.js";
const DRAW_HEAT_MAX = 5;
const MAX_VISIBLE_TILES = 5200;
/**
 * Updates the smoothed fire intensity values used for rendering.
 */
export const updateFireSmoothing = (state, now) => {
    const dt = state.lastRenderTime > 0 ? (now - state.lastRenderTime) / 1000 : 0.016;
    const clampedDt = Math.min(dt, 0.05);
    const alpha = clampedDt > 0 && FIRE_RENDER_SMOOTH_SECONDS > 0
        ? 1 - Math.exp(-clampedDt / FIRE_RENDER_SMOOTH_SECONDS)
        : 1;
    const total = state.grid.totalTiles;
    const targetFire = state.tileFire;
    const smooth = state.renderFireSmooth;
    for (let i = 0; i < total; i += 1) {
        smooth[i] += (targetFire[i] - smooth[i]) * alpha;
    }
};
/**
 * Draws the fire glow and flame particles.
 */
export const drawFireFx = (state, ctx, now, visibleBounds, view) => {
    const { startX, endX, startY, endY } = visibleBounds;
    const sumStart = startX + startY;
    const sumEnd = endX + endY;
    const viewWidth = endX - startX + 1;
    const viewHeight = endY - startY + 1;
    const tileBudget = MAX_VISIBLE_TILES;
    const sampleStep = Math.max(1, Math.ceil(Math.sqrt((viewWidth * viewHeight) / tileBudget)));
    const samplingEnabled = sampleStep > 1;
    const pColor = { r: 0, g: 0, b: 0 };
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
            const height = getRenderHeightAt(state, x + 0.5, y + 0.5);
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
            }
            else {
                fire = state.renderFireSmooth[idx];
            }
            if (fire > 0.01) {
                const intensity = clamp(fire, 0, 1);
                const heatIntensity = clamp(state.tileHeat[idx] / DRAW_HEAT_MAX, 0, 1);
                const radiusScale = samplingEnabled ? sampleStep * 0.75 : 1.0;
                const paleOrange = { r: 255, g: 210, b: 140 };
                const amber = { r: 255, g: 165, b: 60 };
                const ember = { r: 235, g: 95, b: 20 };
                const deepRed = { r: 195, g: 35, b: 10 };
                // 1. Strengthened, grounded base glow, aligned with fire intensity
                const groundCenter = isoProject(x + 0.5, y + 0.5, height);
                const groundGlowRadius = TILE_SIZE * (0.75 + intensity * 0.6) * radiusScale;
                const groundGlowGrad = ctx.createRadialGradient(groundCenter.x, groundCenter.y, TILE_SIZE * 0.1 * radiusScale, groundCenter.x, groundCenter.y, groundGlowRadius);
                groundGlowGrad.addColorStop(0, `rgba(${paleOrange.r}, ${paleOrange.g}, ${paleOrange.b}, ${0.85 * intensity + 0.1})`);
                groundGlowGrad.addColorStop(0.25, `rgba(${amber.r}, ${amber.g}, ${amber.b}, ${0.65 * intensity})`);
                groundGlowGrad.addColorStop(0.6, `rgba(${ember.r}, ${ember.g}, ${ember.b}, 0.35)`);
                groundGlowGrad.addColorStop(1, `rgba(${deepRed.r}, ${deepRed.g}, ${deepRed.b}, 0.0)`);
                ctx.fillStyle = groundGlowGrad;
                ctx.beginPath();
                ctx.arc(groundCenter.x, groundCenter.y, groundGlowRadius, 0, Math.PI * 2);
                ctx.fill();
                // --- Flamelet Rendering ---
                const zoomThreshold = 0.6;
                const isLodZoom = view.scale < zoomThreshold;
                // Dynamic flamelet count based on fire + heat to keep hot fronts continuous
                const baseFlameletCount = isLodZoom ? 12 : 18;
                const densityBoost = 0.75 + intensity * 0.75 + heatIntensity * 0.4;
                const flameletCount = Math.ceil(baseFlameletCount * densityBoost);
                let spawnHeightOffset = TILE_SIZE * 0.05;
                if (tile.type === "forest") {
                    spawnHeightOffset += tile.canopy * TILE_SIZE * 0.8;
                }
                const spawnBase = isoProject(x + 0.5, y + 0.5, height + spawnHeightOffset);
                const windScreen = isoProject(x + 0.5 + state.wind.dx, y + 0.5 + state.wind.dy, height + spawnHeightOffset);
                const windVec = {
                    x: windScreen.x - spawnBase.x,
                    y: windScreen.y - spawnBase.y
                };
                const windLen = Math.hypot(windVec.x, windVec.y) || 1;
                const windDir = {
                    x: windVec.x / windLen,
                    y: windVec.y / windLen
                };
                for (let i = 0; i < flameletCount; i++) {
                    const s1 = hash2D(idx, i, state.seed + 151);
                    const s2 = hash2D(idx, i, state.seed + 353);
                    const s3 = hash2D(idx, i, state.seed + 555);
                    let tier;
                    if (samplingEnabled) {
                        tier = s1 < 0.5 ? "large" : "medium";
                    }
                    else {
                        if (s1 < 0.15)
                            tier = "large";
                        else if (s1 < 0.5)
                            tier = "medium";
                        else
                            tier = "small";
                    }
                    let maxPhaseDuration = 1.0, riseHeightFactor = 1.0, startSizeFactor = 1.0, alphaFactor = 1.0;
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
                    const baseSpread = (samplingEnabled ? TILE_SIZE * 0.4 * sampleStep : TILE_SIZE * 0.3) * (0.85 + intensity * 0.4);
                    const ox = (s1 - 0.5) * baseSpread;
                    const oy = (s2 - 0.5) * baseSpread * 0.5;
                    const spawnPos = { x: spawnBase.x + ox, y: spawnBase.y + oy };
                    const riseT = Math.pow(phase, 2.2);
                    const riseHeight = TILE_SIZE * (1.4 + intensity * 1.6) * riseHeightFactor;
                    const curlAmp = TILE_SIZE * 0.2 * (1.0 - riseT);
                    const curl = Math.sin(phase * 18 + s1 * 6.28) * curlAmp;
                    const windStrength = state.wind.strength;
                    const windFlicker = 0.7 + 0.3 * Math.sin(timeSeconds * 3.6 + s2 * Math.PI * 2);
                    const windStrengthBoost = 0.35 + windStrength * windStrength * 0.9;
                    const windScale = TILE_SIZE * (0.14 + intensity * 0.35 + heatIntensity * 0.3) * windStrengthBoost * windFlicker;
                    const windOffsetX = windDir.x * windScale * riseT;
                    const windOffsetY = windDir.y * windScale * riseT;
                    const flameletY = spawnPos.y - riseT * riseHeight + windOffsetY;
                    const flameletX = spawnPos.x + curl + windOffsetX;
                    const windAngle = Math.atan2(windVec.y, windVec.x);
                    const tilt = windAngle * (0.3 + 1.1 * windStrength) * (0.35 + 0.65 * riseT);
                    // Flamelet size is now thicker and driven by heat
                    const startSize = TILE_SIZE * (0.35 + heatIntensity * 0.9 + intensity * 0.2) * startSizeFactor;
                    const heightDecay = Math.pow(1.0 - phase, 1.0);
                    const widthDecay = Math.pow(1.0 - phase, 2.2);
                    const flameHeight = startSize * heightDecay;
                    const flameWidth = startSize * 0.7 * widthDecay;
                    if (flameHeight < 1.0)
                        continue;
                    const alphaT = Math.pow(Math.sin(Math.PI * phase), 1.5);
                    const alpha = alphaT * (0.7 + 0.3 * intensity) * alphaFactor;
                    if (phase < 0.25) {
                        mixRgbTo(pColor, paleOrange, amber, phase / 0.25);
                    }
                    else if (phase < 0.6) {
                        mixRgbTo(pColor, amber, ember, (phase - 0.25) / 0.35);
                    }
                    else {
                        mixRgbTo(pColor, ember, deepRed, (phase - 0.6) / 0.4);
                    }
                    ctx.globalAlpha = alpha;
                    ctx.fillStyle = rgbString(pColor);
                    ctx.beginPath();
                    ctx.ellipse(flameletX, flameletY, flameWidth, flameHeight, tilt, 0, Math.PI * 2);
                    ctx.fill();
                    if (tier !== "small" && phase < 0.7) {
                        const blurOffset = flameHeight * 0.4;
                        const blurAlpha = alpha * 0.5;
                        ctx.globalAlpha = blurAlpha;
                        ctx.beginPath();
                        ctx.ellipse(flameletX, flameletY - blurOffset, flameWidth * 0.8, flameHeight * 0.9, tilt, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            }
        }
    }
    ctx.globalAlpha = 1.0;
    ctx.globalCompositeOperation = "source-over";
};
