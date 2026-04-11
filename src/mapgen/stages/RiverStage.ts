import { clearVegetationState } from "../../core/vegetation.js";
import { clamp } from "../../core/utils.js";
import type { PipelineStage } from "../pipeline/TerrainPipeline.js";
import { emitStageSnapshot } from "../pipeline/stageDebug.js";
import { carveRiverValleys, clampRiverMouthDepthsToSeaLevel, suppressIsolatedElevationSpikes } from "../runtime.js";

export const RiverStage: PipelineStage = {
  id: "hydro:rivers",
  weight: 10,
  run: async (ctx) => {
    const { state, settings, elevationMap, seaLevelMap, oceanMask, riverMask } = ctx;
    if (!elevationMap || !seaLevelMap || !oceanMask || !riverMask) {
      throw new Error("River stage missing terrain or shoreline fields.");
    }

    const total = state.grid.totalTiles;
    riverMask.fill(0);
    if (state.tileRiverMask.length !== total) {
      state.tileRiverMask = new Uint8Array(total);
    } else {
      state.tileRiverMask.fill(0);
    }
    if (state.tileRiverBed.length !== total) {
      state.tileRiverBed = new Float32Array(total).fill(Number.NaN);
    } else {
      state.tileRiverBed.fill(Number.NaN);
    }
    if (state.tileRiverSurface.length !== total) {
      state.tileRiverSurface = new Float32Array(total).fill(Number.NaN);
    } else {
      state.tileRiverSurface.fill(Number.NaN);
    }
    if (state.tileRiverStepStrength.length !== total) {
      state.tileRiverStepStrength = new Float32Array(total);
    } else {
      state.tileRiverStepStrength.fill(0);
    }

    await ctx.reportStage("Routing rivers to final coast...", 0.2);
    carveRiverValleys(
      state,
      ctx.rng,
      elevationMap,
      riverMask,
      clamp(settings.valleyDepth, 0.4, 3),
      settings.riverWaterBias,
      settings,
      seaLevelMap,
      oceanMask
    );

    for (let i = 0; i < total; i += 1) {
      state.tiles[i].elevation = elevationMap[i] ?? state.tiles[i].elevation;
      if (riverMask[i] > 0) {
        state.tiles[i].type = "water";
        clearVegetationState(state.tiles[i]);
        state.tiles[i].dominantTreeType = null;
        state.tiles[i].treeType = null;
        state.tiles[i].isBase = false;
      }
    }
    const protectedRiverWater = new Uint8Array(total);
    for (let i = 0; i < total; i += 1) {
      protectedRiverWater[i] = oceanMask[i] > 0 || riverMask[i] > 0 ? 1 : 0;
    }
    suppressIsolatedElevationSpikes(elevationMap, state.grid.cols, state.grid.rows, protectedRiverWater);
    for (let i = 0; i < total; i += 1) {
      const resolvedElevation = elevationMap[i] ?? state.tiles[i].elevation;
      state.tiles[i].elevation = resolvedElevation;
      state.tileElevation[i] = resolvedElevation;
    }
    state.tileRiverMask = riverMask;
    clampRiverMouthDepthsToSeaLevel(state, oceanMask, riverMask, seaLevelMap);
    await ctx.reportStage("Rivers carved.", 1);
    await emitStageSnapshot(ctx, "hydro:rivers");
  }
};
