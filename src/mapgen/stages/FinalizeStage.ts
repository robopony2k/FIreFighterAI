import { indexFor } from "../../core/grid.js";
import { markTileSoADirty } from "../../core/tileCache.js";
import { applyFuel } from "../../core/tiles.js";
import { clamp } from "../../core/utils.js";
import type { PipelineStage } from "../pipeline/TerrainPipeline.js";
import { fractalNoise } from "../noise.js";
import { emitStageSnapshot } from "../pipeline/stageDebug.js";
import { assignForestComposition, getWorldX, getWorldY, seedInitialVegetationState } from "../runtime.js";

export const FinalizeStage: PipelineStage = {
  id: "map:finalize",
  weight: 6,
  run: async (ctx) => {
    const { state, rng, settings, cellSizeM } = ctx;
    seedInitialVegetationState(state, ctx.biomeSuitabilityMap, ctx.microMap, ctx.meadowMaskMap);
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
