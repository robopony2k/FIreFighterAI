import { getTerrainHeightScale } from "../../core/terrainScale.js";
import { runDrainageErosion } from "../../systems/terrain/sim/drainageErosion.js";
import { buildTerrainMorphologyFields } from "../../systems/terrain/sim/terrainMorphology.js";
import type { PipelineStage } from "../pipeline/TerrainPipeline.js";
import { emitStageSnapshot } from "../pipeline/stageDebug.js";
import { buildOceanMaskFromElevation, clampSeaLevel, resolveSeaLevelBase } from "../runtime.js";

export const ErosionStage: PipelineStage = {
  id: "terrain:erosion",
  weight: 8,
  run: async (ctx) => {
    const { state, settings, cellSizeM } = ctx;
    if (!ctx.elevationMap) throw new Error("Erosion stage missing elevation map.");

    const seaLevel = clampSeaLevel(ctx.seaLevelBase, settings);
    const provisionalSeaLevel = new Float32Array(state.grid.totalTiles).fill(seaLevel);
    const provisionalOcean = buildOceanMaskFromElevation(state, ctx.elevationMap, provisionalSeaLevel);
    const result = runDrainageErosion({
      cols: state.grid.cols,
      rows: state.grid.rows,
      elevations: ctx.elevationMap,
      oceanMask: provisionalOcean,
      seaLevel,
      heightScale: getTerrainHeightScale(state.grid.cols, state.grid.rows, settings.heightScaleMultiplier),
      relief: settings.relief,
      ruggedness: settings.ruggedness,
      riverIntensity: settings.riverIntensity
    });

    ctx.elevationMap = Array.from(result.elevations);
    ctx.drainageReceiverMap = result.receiver;
    ctx.flowAccumulationMap = result.flowAccumulation;
    ctx.depressionFillMap = result.filledElevation;
    ctx.depressionDepthMap = result.depressionDepth;
    ctx.erosionWearMap = result.wear;
    ctx.erosionDepositMap = result.deposit;
    ctx.erosionFlowXMap = result.flowX;
    ctx.erosionFlowYMap = result.flowY;
    const morphology = buildTerrainMorphologyFields({
      cols: state.grid.cols,
      rows: state.grid.rows,
      elevations: result.elevations,
      heightScale: getTerrainHeightScale(state.grid.cols, state.grid.rows, settings.heightScaleMultiplier),
      erosionWear: result.wear,
      erosionDeposit: result.deposit
    });
    ctx.rockExposureMap = morphology.rockExposure;
    ctx.terrainCurvatureMap = morphology.curvature;
    if (state.tileErosionWear.length !== result.wear.length) state.tileErosionWear = new Float32Array(result.wear.length);
    state.tileErosionWear.set(result.wear);
    if (state.tileRockExposure.length !== morphology.rockExposure.length) {
      state.tileRockExposure = new Float32Array(morphology.rockExposure.length);
    }
    state.tileRockExposure.set(morphology.rockExposure);
    ctx.seaLevelBase = resolveSeaLevelBase(state, settings, ctx.elevationMap, cellSizeM);
    await ctx.reportStage("Carving drainage and settling slopes...", 1);
    await emitStageSnapshot(ctx, "terrain:erosion");
  }
};
