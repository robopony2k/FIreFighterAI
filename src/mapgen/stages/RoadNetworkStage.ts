import { DEBUG_TERRAIN } from "../../core/config.js";
import { clearVegetationState } from "../../core/vegetation.js";
import type { PipelineStage } from "../pipeline/TerrainPipeline.js";
import { yieldToNextFrame } from "../pipeline/yieldController.js";
import {
  connectSettlementsByRoad,
  connectSettlementsByRoadAsync,
  repairSettlementRoadConnectivity,
  repairSettlementRoadConnectivityAsync
} from "../communities.js";
import { emitStageSnapshot } from "../pipeline/stageDebug.js";
import { getRoadGenerationStats, pruneRoadConnectorArtifacts, resetRoadGenerationStats, setRoadPathDebugHooks, type RoadSurfaceMetrics } from "../roads.js";
import { assignForestComposition, flattenSettlementGround, gradeRoadNetworkTerrain, seedInitialVegetationState } from "../runtime.js";
import { resolveRoadDiagnosticTuning } from "../../systems/roads/types/roadDiagnosticTuning.js";

const formatRoadSolveStatus = (prefix: string): string => {
  const stats = getRoadGenerationStats();
  return `${prefix}: road search ${stats.pathsFound}/${stats.pathsAttempted} routes, switchback ${stats.switchbackRouteCount}/${stats.switchbackRouteAttempts}, mountain-pass fallbacks ${stats.mountainPassFallbackCount}, cleanup ${stats.connectorArtifactPrunedEdgeCount}`;
};

export const RoadNetworkStage: PipelineStage = {
  id: "roads:connect",
  weight: 6,
  run: async (ctx) => {
    resetRoadGenerationStats();
    const diagnosticsEnabled = Boolean(ctx.debug?.onDiagnosticEvent);
    const roadTuning = diagnosticsEnabled ? resolveRoadDiagnosticTuning(ctx.debug?.roadTuning) : null;
    if (roadTuning && ctx.settlementPlan) {
      ctx.settlementPlan.roadDiagnosticTuning = roadTuning;
      if (roadTuning.futureGrowthPlanYearsOverride !== null) {
        ctx.settlementPlan.futureGrowthPlanYears = roadTuning.futureGrowthPlanYearsOverride;
      }
    }
    if (diagnosticsEnabled) {
      setRoadPathDebugHooks({
        emit: (event) => {
          void ctx.emitDiagnosticEvent(event);
        },
        checkCancelled: () => ctx.checkCancelled(),
        yield: async () => {
          await ctx.yieldAndCheck();
        }
      });
    }
    try {
      await ctx.reportStage("Road solver: preparing multi-destination route search...", 0.02);
      await yieldToNextFrame();
      flattenSettlementGround(ctx.state);
      if (ctx.settings.skipRoadNetworkRouting) {
        await ctx.reportStage("Road solver: skipped by debug road-routing toggle.", 0.42);
        await yieldToNextFrame();
      } else {
        if (diagnosticsEnabled) {
          await connectSettlementsByRoadAsync(ctx.state, ctx.rng, ctx.settlementPlan ?? null, roadTuning);
        } else {
          connectSettlementsByRoad(ctx.state, ctx.rng, ctx.settlementPlan ?? null);
        }
        if (!roadTuning || roadTuning.enableConnectorCleanup) {
          pruneRoadConnectorArtifacts(ctx.state);
        }
        await ctx.reportStage(formatRoadSolveStatus("Road solver: settlement routes planned"), 0.42);
        await yieldToNextFrame();
      }
      let roadSurfaceMetrics = gradeRoadNetworkTerrain(ctx.state, ctx.settings.heightScaleMultiplier);
      if (!ctx.settings.skipRoadNetworkRouting && (!roadTuning || roadTuning.enableConnectivityRepairPass)) {
        await ctx.reportStage("Road solver: checking isolated town components...", 0.58);
        await yieldToNextFrame();
        const repaired = diagnosticsEnabled
          ? await repairSettlementRoadConnectivityAsync(ctx.state, ctx.rng, ctx.settlementPlan ?? null, roadTuning)
          : repairSettlementRoadConnectivity(ctx.state, ctx.rng, ctx.settlementPlan ?? null);
        if (repaired) {
          await ctx.reportStage(formatRoadSolveStatus("Road solver: repairing disconnected components"), 0.72);
          await yieldToNextFrame();
          flattenSettlementGround(ctx.state);
          if (!roadTuning || roadTuning.enableConnectorCleanup) {
            pruneRoadConnectorArtifacts(ctx.state);
          }
          roadSurfaceMetrics = gradeRoadNetworkTerrain(ctx.state, ctx.settings.heightScaleMultiplier);
        }
      } else if (!ctx.settings.skipRoadNetworkRouting && roadTuning && !roadTuning.enableConnectivityRepairPass) {
        await ctx.reportStage("Road solver: connectivity repair skipped by diagnostics tuning.", 0.72);
        await yieldToNextFrame();
      }
      await ctx.reportStage(
        ctx.settings.skipRoadNetworkRouting
          ? "Road solver: routing disabled; finishing mapgen road stage."
          : formatRoadSolveStatus("Road solver: final grading pass"),
        0.86
      );
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
      await ctx.reportStage(
        ctx.settings.skipRoadNetworkRouting
          ? "Road network routing skipped by debug toggle."
          : formatRoadSolveStatus("Road network connected"),
        0.96
      );
      await yieldToNextFrame();
      if (DEBUG_TERRAIN) {
        const stats = getRoadGenerationStats();
        const finalMetrics: RoadSurfaceMetrics = roadSurfaceMetrics;
        console.log(
          `[roadsurface] maxGrade=${finalMetrics.maxRoadGrade.toFixed(3)} maxCrossfall=${finalMetrics.maxRoadCrossfall.toFixed(3)} maxGradeChange=${finalMetrics.maxRoadGradeChange.toFixed(3)} maxAngle=${finalMetrics.maxRoadAngleDeg.toFixed(2)} highAngle=${finalMetrics.highAngleRoadStepCount} straightSteep=${finalMetrics.longStraightSteepSegmentCount} gradingDelta=${finalMetrics.maxRoadGradingDelta.toFixed(3)} wallEdges=${finalMetrics.wallEdgeCount} routedMaxGrade=${stats.maxRealizedGrade.toFixed(3)} routedMaxCrossfall=${stats.maxRealizedCrossfall.toFixed(3)} routedMaxGradeChange=${stats.maxRealizedGradeChange.toFixed(3)} routedAngle=${stats.maxRealizedAngleDeg.toFixed(2)}/${stats.meanRealizedAngleDeg.toFixed(2)} pass=${stats.mountainPassFallbackCount} switchbackRoutes=${stats.switchbackRouteCount}/${stats.switchbackRouteAttempts} budgetAbort=${stats.searchBudgetAbortCount} cacheSkip=${stats.connectorCacheSkipCount} cleanup=${stats.connectorArtifactPrunedEdgeCount} junctions=${stats.generatedJunctionCount}`
        );
      }
      await ctx.reportStage(ctx.settings.skipRoadNetworkRouting ? "Road network routing skipped." : "Road network connected.", 1);
      await emitStageSnapshot(ctx, "roads:connect");
    } finally {
      if (diagnosticsEnabled) {
        setRoadPathDebugHooks(null);
      }
    }
  }
};
