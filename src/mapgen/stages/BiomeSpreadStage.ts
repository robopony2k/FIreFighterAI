import type { PipelineStage } from "../pipeline/TerrainPipeline.js";
import { buildBiomeSuitability } from "../biome/BiomeSuitability.js";
import { buildForestMask } from "../biome/ForestSpread.js";
import { emitStageSnapshot } from "../pipeline/stageDebug.js";

export const BiomeSpreadStage: PipelineStage = {
  id: "biome:spread",
  weight: 8,
  run: async (ctx) => {
    if (ctx.settings.biomeClassifierMode === "legacy") {
      ctx.biomeSuitabilityMap = null;
      ctx.elevationStressMap = null;
      ctx.slopeStressMap = null;
      ctx.treeSuitabilityMap = null;
      ctx.treeProbabilityMap = null;
      ctx.treeDensityMap = null;
      ctx.forestMask = null;
      await ctx.reportStage("Biome spread skipped (legacy mode).", 1);
      await emitStageSnapshot(ctx, "biome:spread");
      return;
    }

    await ctx.reportStage("Scoring biome suitability...", 0.35);
    const suitability = buildBiomeSuitability(ctx);
    ctx.biomeSuitabilityMap = suitability;

    await ctx.reportStage("Growing forest stands...", 0.7);
    ctx.forestMask = buildForestMask(ctx, suitability);
    await ctx.reportStage("Biome spread solved.", 1);
    await emitStageSnapshot(ctx, "biome:spread");
  }
};
