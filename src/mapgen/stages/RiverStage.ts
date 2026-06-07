import { clearVegetationState } from "../../core/vegetation.js";
import type { PipelineStage } from "../pipeline/TerrainPipeline.js";
import { emitStageSnapshot } from "../pipeline/stageDebug.js";
import { clampRiverMouthDepthsToSeaLevel, suppressIsolatedElevationSpikes } from "../runtime.js";
import { buildStaticInlandLakeNetwork } from "../../systems/terrain/sim/inlandLakeNetwork.js";

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
    if (state.tileLakeMask.length !== total) {
      state.tileLakeMask = new Uint16Array(total);
    } else {
      state.tileLakeMask.fill(0);
    }
    if (state.tileLakeSurface.length !== total) {
      state.tileLakeSurface = new Float32Array(total).fill(Number.NaN);
    } else {
      state.tileLakeSurface.fill(Number.NaN);
    }
    if (state.tileLakeOutletMask.length !== total) {
      state.tileLakeOutletMask = new Uint8Array(total);
    } else {
      state.tileLakeOutletMask.fill(0);
    }
    if (state.tileWaterfallSourceMask.length !== total) {
      state.tileWaterfallSourceMask = new Uint8Array(total);
    } else {
      state.tileWaterfallSourceMask.fill(0);
    }
    if (state.tileWaterfallTarget.length !== total) {
      state.tileWaterfallTarget = new Int32Array(total).fill(-1);
    } else {
      state.tileWaterfallTarget.fill(-1);
    }
    if (state.tileWaterfallDrop.length !== total) {
      state.tileWaterfallDrop = new Float32Array(total);
    } else {
      state.tileWaterfallDrop.fill(0);
    }

    state.valleyMap = Array.from({ length: total }, () => 0);

    await ctx.reportStage("Resolving inland lake overflow network...", 0.72);
    const staticHydrology = await buildStaticInlandLakeNetwork({
      state,
      elevationMap,
      riverMask,
      oceanMask,
      settings,
      debug: {
        emit: (event) => ctx.emitDiagnosticEvent(event),
        yieldIfNeeded: () => ctx.yieldAndCheck(),
        checkCancelled: () => ctx.checkCancelled()
      }
    });
    ctx.lakeMask = staticHydrology.lakeMask;
    ctx.lakeSurfaceMap = staticHydrology.lakeSurface;
    ctx.lakeOutletMask = staticHydrology.lakeOutletMask;
    ctx.rainfallMap = staticHydrology.rainfall;
    ctx.runoffMap = staticHydrology.runoff;
    ctx.riverLakeEntryMask = staticHydrology.riverLakeEntryMask;
    ctx.riverLakeExitMask = staticHydrology.riverLakeExitMask;
    ctx.waterfallSourceMask = staticHydrology.waterfallSourceMask;
    ctx.waterfallTargetMap = staticHydrology.waterfallTarget;
    ctx.waterfallDropMap = staticHydrology.waterfallDrop;
    ctx.staticHydrologyLakes = staticHydrology.lakes;
    ctx.staticHydrologyWaterfalls = staticHydrology.waterfalls;
    ctx.staticHydrologyRejectedLakeCandidates = staticHydrology.rejectedLakeCandidates;
    ctx.staticHydrologyRejectedWaterfallCandidates = staticHydrology.rejectedWaterfallCandidates;

    for (let i = 0; i < total; i += 1) {
      state.tiles[i].elevation = elevationMap[i] ?? state.tiles[i].elevation;
      if (riverMask[i] > 0 || state.tileLakeMask[i] > 0) {
        state.tiles[i].type = "water";
        clearVegetationState(state.tiles[i]);
        state.tiles[i].dominantTreeType = null;
        state.tiles[i].treeType = null;
        state.tiles[i].isBase = false;
      }
    }
    const protectedRiverWater = new Uint8Array(total);
    for (let i = 0; i < total; i += 1) {
      protectedRiverWater[i] = oceanMask[i] > 0 || riverMask[i] > 0 || state.tileLakeMask[i] > 0 ? 1 : 0;
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
