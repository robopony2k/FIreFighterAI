import type { PipelineStage } from "../pipeline/TerrainPipeline.js";
import { emitStageSnapshot } from "../pipeline/stageDebug.js";
import { buildElevationMap } from "../runtime.js";

export const ElevationStage: PipelineStage = {
  id: "terrain:elevation",
  weight: 22,
  run: async (ctx) => {
    ctx.state.tiles = new Array(ctx.state.grid.totalTiles);
    await ctx.reportStage("Reticulating splines...", 0);
    const {
      elevationMap,
      riverMask,
      seaLevelBase,
      erosionWearMap,
      erosionDepositMap,
      erosionHardnessMap,
      erosionFlowXMap,
      erosionFlowYMap,
      tectonicStressMap,
      tectonicTrendXMap,
      tectonicTrendYMap
    } = await buildElevationMap(
      ctx.state,
      ctx.rng,
      ctx.settings,
      async (message, progress) => ctx.reportStage(message, progress),
      ctx.yieldIfNeeded,
      ctx.debug
    );
    ctx.elevationMap = elevationMap;
    ctx.riverMask = riverMask;
    ctx.seaLevelBase = seaLevelBase;
    ctx.erosionWearMap = erosionWearMap;
    ctx.erosionDepositMap = erosionDepositMap;
    ctx.erosionHardnessMap = erosionHardnessMap;
    ctx.erosionFlowXMap = erosionFlowXMap;
    ctx.erosionFlowYMap = erosionFlowYMap;
    ctx.tectonicStressMap = tectonicStressMap ?? new Float32Array(erosionWearMap.length);
    ctx.tectonicTrendXMap = tectonicTrendXMap ?? new Float32Array(erosionWearMap.length);
    ctx.tectonicTrendYMap = tectonicTrendYMap ?? new Float32Array(erosionWearMap.length);
    if (ctx.state.tileErosionWear.length !== erosionWearMap.length) {
      ctx.state.tileErosionWear = new Float32Array(erosionWearMap.length);
    }
    ctx.state.tileErosionWear.set(erosionWearMap);
    await emitStageSnapshot(ctx, "terrain:elevation");
  }
};
