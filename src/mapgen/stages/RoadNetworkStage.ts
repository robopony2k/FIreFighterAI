import { DEBUG_TERRAIN } from "../../core/config.js";
import { clearVegetationState } from "../../core/vegetation.js";
import type { PipelineStage } from "../pipeline/TerrainPipeline.js";
import { connectSettlementsByRoad } from "../communities.js";
import { emitStageSnapshot } from "../pipeline/stageDebug.js";
import { getRoadGenerationStats, type RoadSurfaceMetrics } from "../roads.js";
import { assignForestComposition, flattenSettlementGround, gradeRoadNetworkTerrain, seedInitialVegetationState } from "../runtime.js";

export const RoadNetworkStage: PipelineStage = {
  id: "roads:connect",
  weight: 6,
  run: async (ctx) => {
    connectSettlementsByRoad(ctx.state, ctx.rng, ctx.settlementPlan ?? null);
    flattenSettlementGround(ctx.state);
    const roadSurfaceMetrics = gradeRoadNetworkTerrain(ctx.state, ctx.settings.heightScaleMultiplier);
    if (ctx.riverMask) {
      for (let i = 0; i < ctx.state.tiles.length; i += 1) {
        if (ctx.riverMask[i] === 0) {
          continue;
        }
        const tile = ctx.state.tiles[i];
        tile.type = "water";
        clearVegetationState(tile);
        tile.dominantTreeType = null;
        tile.treeType = null;
        tile.isBase = false;
      }
    }
    seedInitialVegetationState(ctx.state, ctx.biomeSuitabilityMap, ctx.microMap, ctx.meadowMaskMap, ctx.treeDensityMap);
    assignForestComposition(ctx.state);
    if (DEBUG_TERRAIN) {
      const stats = getRoadGenerationStats();
      const finalMetrics: RoadSurfaceMetrics = roadSurfaceMetrics;
      console.log(
        `[roadsurface] maxGrade=${finalMetrics.maxRoadGrade.toFixed(3)} maxCrossfall=${finalMetrics.maxRoadCrossfall.toFixed(3)} maxGradeChange=${finalMetrics.maxRoadGradeChange.toFixed(3)} wallEdges=${finalMetrics.wallEdgeCount} routedMaxGrade=${stats.maxRealizedGrade.toFixed(3)} routedMaxCrossfall=${stats.maxRealizedCrossfall.toFixed(3)} routedMaxGradeChange=${stats.maxRealizedGradeChange.toFixed(3)}`
      );
    }
    await ctx.reportStage("Connecting roads...", 1);
    await emitStageSnapshot(ctx, "roads:connect");
  }
};
