import { indexFor } from "../../core/grid.js";
import { markTileSoADirty } from "../../core/tileCache.js";
import { applyFuel } from "../../core/tiles.js";
import { clamp } from "../../core/utils.js";
import { getTerrainHeightScale } from "../../core/terrainScale.js";
import {
  applyVegetationPreGrowth,
  type VegetationPreGrowthReporter
} from "../../systems/terrain/sim/vegetationPreGrowth.js";
import { initializeCampaignVegetationFuel } from "../../systems/terrain/sim/annualVegetationGrowth.js";
import { primeRuntimeVegetationSuitabilityCache } from "../../systems/terrain/sim/runtimeVegetationSuitabilityCache.js";
import { buildTerrainMorphologyFields } from "../../systems/terrain/sim/terrainMorphology.js";
import { fractalNoise } from "../noise.js";
import type { MapGenContext } from "../pipeline/MapGenContext.js";
import type { PipelineStage } from "../pipeline/TerrainPipeline.js";
import { emitStageSnapshot } from "../pipeline/stageDebug.js";
import { yieldToNextFrame } from "../pipeline/yieldController.js";
import {
  assignForestComposition,
  getWorldX,
  getWorldY,
  seedInitialVegetationState
} from "../runtime.js";

const nowMs = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

const runFinalizeSubstep = async <T>(
  ctx: MapGenContext,
  id: string,
  message: string,
  localProgress: number,
  task: () => T | Promise<T>
): Promise<T> => {
  await ctx.reportStage(message, localProgress);
  ctx.checkCancelled();
  if (ctx.report) {
    await yieldToNextFrame();
    ctx.checkCancelled();
  }
  const startedAt = nowMs();
  let status = "failed";
  try {
    const result = await task();
    status = "complete";
    return result;
  } finally {
    const durationMs = Math.max(0, nowMs() - startedAt);
    console.log(`[mapgenstep] map:finalize ${id} ${durationMs.toFixed(2)}ms status=${status}`);
  }
};

export const FinalizeStage: PipelineStage = {
  id: "map:finalize",
  weight: 6,
  run: async (ctx) => {
    const { state, rng, settings, cellSizeM } = ctx;
    if (ctx.elevationMap) {
      await runFinalizeSubstep(ctx, "terrain-morphology", "Deriving final terrain morphology...", 0.02, () => {
        const morphology = buildTerrainMorphologyFields({
          cols: state.grid.cols,
          rows: state.grid.rows,
          elevations: ctx.elevationMap!,
          heightScale: getTerrainHeightScale(state.grid.cols, state.grid.rows, settings.heightScaleMultiplier),
          erosionWear: ctx.erosionWearMap,
          erosionDeposit: ctx.erosionDepositMap
        });
        ctx.rockExposureMap = morphology.rockExposure;
        ctx.terrainCurvatureMap = morphology.curvature;
        if (state.tileRockExposure.length !== morphology.rockExposure.length) {
          state.tileRockExposure = new Float32Array(morphology.rockExposure.length);
        }
        state.tileRockExposure.set(morphology.rockExposure);
      });
    }
    if (ctx.treeSuitabilityMap && ctx.vegetationSiteQualityMap) {
      await runFinalizeSubstep(ctx, "vegetation-cache", "Caching vegetation suitability...", 0.12, () => {
        primeRuntimeVegetationSuitabilityCache(state, {
          suitability: ctx.treeSuitabilityMap!,
          siteQuality: ctx.vegetationSiteQualityMap!
        });
      });
    }
    await runFinalizeSubstep(ctx, "vegetation-seed", "Seeding initial vegetation structure...", 0.16, () => {
      seedInitialVegetationState(
        state,
        ctx.biomeSuitabilityMap,
        ctx.microMap,
        ctx.meadowMaskMap,
        ctx.treeDensityMap,
        ctx.vegetationSiteQualityMap
      );
    });
    await runFinalizeSubstep(ctx, "forest-composition", "Assigning forest composition...", 0.3, () => {
      assignForestComposition(state);
    });
    let preGrowthYearStartedAt = nowMs();
    await runFinalizeSubstep(
      ctx,
      "vegetation-pregrowth",
      settings.vegetationPreGrowthYears > 0
        ? `Simulating vegetation pre-growth (year 1/${settings.vegetationPreGrowthYears})...`
        : "Skipping vegetation pre-growth (0 years)...",
      0.38,
      async () => {
        preGrowthYearStartedAt = nowMs();
        const reportPreGrowth: VegetationPreGrowthReporter | undefined = ctx.report
          ? async (progress) => {
              const yearDurationMs = Math.max(0, nowMs() - preGrowthYearStartedAt);
              console.log(
                `[mapgenstep] map:finalize vegetation-pregrowth-year ` +
                  `${progress.completedYears}/${progress.totalYears} ${yearDurationMs.toFixed(2)}ms ` +
                  `visited=${progress.tilesVisited} changed=${progress.tilesChanged}`
              );
              const fraction = progress.completedYears / Math.max(1, progress.totalYears);
              const message = progress.completedYears < progress.totalYears
                ? `Simulating vegetation pre-growth (year ${progress.completedYears + 1}/${progress.totalYears}; ${progress.completedYears} complete)...`
                : `Vegetation pre-growth complete (${progress.completedYears}/${progress.totalYears} years).`;
              await ctx.reportStage(message, 0.38 + fraction * 0.34);
              await ctx.yieldAndCheck();
              preGrowthYearStartedAt = nowMs();
            }
          : undefined;
        await applyVegetationPreGrowth(state, settings.vegetationPreGrowthYears, rng, reportPreGrowth);
      }
    );
    state.vegetationRevision += 1;
    await runFinalizeSubstep(ctx, "tile-fuel", "Initializing tile fuel and land totals...", 0.74, () => {
      state.totalLandTiles = 0;
      state.tiles.forEach((tile) => {
        applyFuel(tile, tile.moisture, rng);
        if (tile.type !== "water" && !tile.isBase) {
          state.totalLandTiles += 1;
        }
      });
    });
    await runFinalizeSubstep(ctx, "campaign-fuel", "Initializing campaign vegetation fuel...", 0.8, () => {
      initializeCampaignVegetationFuel(state);
    });

    await runFinalizeSubstep(ctx, "terrain-color", "Generating terrain color variation (0 rows complete)...", 0.84, async () => {
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
          const fraction = (y + 1) / state.grid.rows;
          await ctx.reportStage(
            `Generating terrain color variation (${y + 1}/${state.grid.rows} rows complete)...`,
            0.84 + fraction * 0.14
          );
        }
      }
    });

    await runFinalizeSubstep(ctx, "publish-state", "Publishing final map state...", 0.99, () => {
      state.burnedTiles = 0;
      state.containedCount = 0;
      state.terrainDirty = true;
      markTileSoADirty(state);
    });
    await runFinalizeSubstep(ctx, "diagnostic-snapshot", "Capturing final map diagnostics...", 0.995, async () => {
      await emitStageSnapshot(ctx, "map:finalize");
    });
    await ctx.reportStage("Map generation complete.", 1);
  }
};
