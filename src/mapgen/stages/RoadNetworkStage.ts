import { DEBUG_TERRAIN } from "../../core/config.js";
import { clearVegetationState } from "../../core/vegetation.js";
import type { PipelineStage } from "../pipeline/TerrainPipeline.js";
import { yieldToNextFrame } from "../pipeline/yieldController.js";
import { connectSettlementsByRoad, repairSettlementRoadConnectivity } from "../communities.js";
import { emitStageSnapshot } from "../pipeline/stageDebug.js";
import { getRoadGenerationStats, pruneRoadConnectorArtifacts, resetRoadGenerationStats, type RoadSurfaceMetrics } from "../roads.js";
import { assignForestComposition, flattenSettlementGround, gradeRoadNetworkTerrain, seedInitialVegetationState } from "../runtime.js";

const formatRoadSolveStatus = (prefix: string): string => {
  const stats = getRoadGenerationStats();
  return `${prefix}: A* ${stats.pathsFound}/${stats.pathsAttempted} routes, switchback ${stats.switchbackRouteCount}/${stats.switchbackRouteAttempts}, mountain-pass fallbacks ${stats.mountainPassFallbackCount}, cleanup ${stats.connectorArtifactPrunedEdgeCount}`;
};

export const RoadNetworkStage: PipelineStage = {
  id: "roads:connect",
  weight: 6,
  run: async (ctx) => {
    resetRoadGenerationStats();
    await ctx.reportStage("Road solver: preparing recursive A* route attempts...", 0.02);
    await yieldToNextFrame();
    flattenSettlementGround(ctx.state);
    connectSettlementsByRoad(ctx.state, ctx.rng, ctx.settlementPlan ?? null);
    pruneRoadConnectorArtifacts(ctx.state);
    await ctx.reportStage(formatRoadSolveStatus("Road solver: settlement routes planned"), 0.42);
    await yieldToNextFrame();
    let roadSurfaceMetrics = gradeRoadNetworkTerrain(ctx.state, ctx.settings.heightScaleMultiplier);
    await ctx.reportStage("Road solver: checking isolated town components...", 0.58);
    await yieldToNextFrame();
    if (repairSettlementRoadConnectivity(ctx.state, ctx.rng, ctx.settlementPlan ?? null)) {
      await ctx.reportStage(formatRoadSolveStatus("Road solver: repairing disconnected components"), 0.72);
      await yieldToNextFrame();
      flattenSettlementGround(ctx.state);
      pruneRoadConnectorArtifacts(ctx.state);
      roadSurfaceMetrics = gradeRoadNetworkTerrain(ctx.state, ctx.settings.heightScaleMultiplier);
    }
    await ctx.reportStage(formatRoadSolveStatus("Road solver: final grading pass"), 0.86);
    await yieldToNextFrame();
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
    await ctx.reportStage(formatRoadSolveStatus("Road network connected"), 0.96);
    await yieldToNextFrame();
    if (DEBUG_TERRAIN) {
      const stats = getRoadGenerationStats();
      const finalMetrics: RoadSurfaceMetrics = roadSurfaceMetrics;
      console.log(
        `[roadsurface] maxGrade=${finalMetrics.maxRoadGrade.toFixed(3)} maxCrossfall=${finalMetrics.maxRoadCrossfall.toFixed(3)} maxGradeChange=${finalMetrics.maxRoadGradeChange.toFixed(3)} maxAngle=${finalMetrics.maxRoadAngleDeg.toFixed(2)} highAngle=${finalMetrics.highAngleRoadStepCount} straightSteep=${finalMetrics.longStraightSteepSegmentCount} gradingDelta=${finalMetrics.maxRoadGradingDelta.toFixed(3)} wallEdges=${finalMetrics.wallEdgeCount} routedMaxGrade=${stats.maxRealizedGrade.toFixed(3)} routedMaxCrossfall=${stats.maxRealizedCrossfall.toFixed(3)} routedMaxGradeChange=${stats.maxRealizedGradeChange.toFixed(3)} routedAngle=${stats.maxRealizedAngleDeg.toFixed(2)}/${stats.meanRealizedAngleDeg.toFixed(2)} pass=${stats.mountainPassFallbackCount} switchbackRoutes=${stats.switchbackRouteCount}/${stats.switchbackRouteAttempts} budgetAbort=${stats.searchBudgetAbortCount} cacheSkip=${stats.connectorCacheSkipCount} cleanup=${stats.connectorArtifactPrunedEdgeCount} junctions=${stats.generatedJunctionCount}`
      );
    }
    await ctx.reportStage("Road network connected.", 1);
    await emitStageSnapshot(ctx, "roads:connect");
  }
};
