import { indexFor } from "../../core/grid.js";
import { markTileSoADirty } from "../../core/tileCache.js";
import { applyFuel } from "../../core/tiles.js";
import { clamp } from "../../core/utils.js";
import type { PipelineStage } from "../pipeline/TerrainPipeline.js";
import { fractalNoise } from "../noise.js";
import { emitStageSnapshot } from "../pipeline/stageDebug.js";
import {
  assignForestComposition,
  buildDistanceFromMask,
  COAST_LAND_EASE_BAND,
  COAST_LAND_EASE_MAX_HEIGHTS,
  COAST_MIN_LAND_ABOVE_SEA,
  getCoastBandValue,
  getWorldX,
  getWorldY,
  seedInitialVegetationState
} from "../runtime.js";

export const FinalizeStage: PipelineStage = {
  id: "map:finalize",
  weight: 6,
  run: async (ctx) => {
    const { state, rng, settings, cellSizeM } = ctx;
    if (ctx.oceanMask && ctx.seaLevelMap) {
      const distToOcean = buildDistanceFromMask(ctx.oceanMask, state.grid.cols, state.grid.rows);
      for (let i = 0; i < state.grid.totalTiles; i += 1) {
        const tile = state.tiles[i];
        if (!tile || tile.type === "water" || tile.type === "road" || tile.type === "house" || tile.type === "base") {
          continue;
        }
        const dist = distToOcean[i] ?? 0;
        if (dist < 1 || dist > COAST_LAND_EASE_BAND) {
          continue;
        }
        const sea = ctx.seaLevelMap[i] ?? 0;
        const easedMax = sea + getCoastBandValue(COAST_LAND_EASE_MAX_HEIGHTS, dist);
        const nextElevation = clamp(
          Math.min(tile.elevation, Math.max(easedMax, sea + COAST_MIN_LAND_ABOVE_SEA)),
          0,
          1
        );
        tile.elevation = nextElevation;
        state.tileElevation[i] = nextElevation;
        if (ctx.elevationMap) {
          ctx.elevationMap[i] = nextElevation;
        }
      }
    }
    seedInitialVegetationState(state, ctx.biomeSuitabilityMap, ctx.microMap, ctx.meadowMaskMap, ctx.treeDensityMap);
    assignForestComposition(state);
    state.vegetationRevision += 1;
    state.totalLandTiles = 0;
    state.tiles.forEach((tile) => {
      applyFuel(tile, tile.moisture, rng);
      if (tile.type !== "water" && !tile.isBase) {
        state.totalLandTiles += 1;
      }
    });

    state.colorNoiseMap = Array.from({ length: state.grid.totalTiles }, () => 0.5);
    for (let y = 0; y < state.grid.rows; y += 1) {
      for (let x = 0; x < state.grid.cols; x += 1) {
        const idx = indexFor(state.grid, x, y);
        const worldX = getWorldX(settings, x);
        const worldY = getWorldY(settings, y);
        const low = fractalNoise(worldX / (14 * cellSizeM), worldY / (14 * cellSizeM), state.seed + 801);
        const broad = fractalNoise(worldX / (38 * cellSizeM), worldY / (38 * cellSizeM), state.seed + 1001);
        state.colorNoiseMap[idx] = clamp(low * 0.65 + broad * 0.35, 0, 1);
      }
      if (await ctx.yieldIfNeeded()) {
        await ctx.reportStage("Coloring terrain...", (y + 1) / state.grid.rows);
      }
    }

    state.burnedTiles = 0;
    state.containedCount = 0;
    state.terrainDirty = true;
    markTileSoADirty(state);
    await ctx.reportStage("Finalizing map...", 1);
    await emitStageSnapshot(ctx, "map:finalize");
  }
};
