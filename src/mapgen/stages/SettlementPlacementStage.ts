import { inBounds, indexFor } from "../../core/grid.js";
import { TILE_TYPE_IDS } from "../../core/state.js";
import { clearVegetationState } from "../../core/vegetation.js";
import type { PipelineStage } from "../pipeline/TerrainPipeline.js";
import { createSettlementPlacementPlan } from "../communities.js";
import { emitStageSnapshot } from "../pipeline/stageDebug.js";
import { findBasePoint } from "../runtime.js";

export const SettlementPlacementStage: PipelineStage = {
  id: "settlement:place",
  weight: 10,
  run: async (ctx) => {
    const { state } = ctx;
    const beforeType = new Uint8Array(state.grid.totalTiles);
    const beforeElevation = new Float32Array(state.grid.totalTiles);
    for (let i = 0; i < state.grid.totalTiles; i += 1) {
      beforeType[i] = TILE_TYPE_IDS[state.tiles[i]?.type ?? "grass"];
      beforeElevation[i] = state.tiles[i]?.elevation ?? 0;
    }
    ctx.settlementSnapshot = { typeBefore: beforeType, elevationBefore: beforeElevation };

    state.basePoint = findBasePoint(state);
    if (state.tileRoadBridge.length !== state.grid.totalTiles) {
      state.tileRoadBridge = new Uint8Array(state.grid.totalTiles);
    } else {
      state.tileRoadBridge.fill(0);
    }
    if (state.tileRoadEdges.length !== state.grid.totalTiles) {
      state.tileRoadEdges = new Uint8Array(state.grid.totalTiles);
    } else {
      state.tileRoadEdges.fill(0);
    }
    if (state.tileRoadWallEdges.length !== state.grid.totalTiles) {
      state.tileRoadWallEdges = new Uint8Array(state.grid.totalTiles);
    } else {
      state.tileRoadWallEdges.fill(0);
    }
    for (let y = -2; y <= 2; y += 1) {
      for (let x = -2; x <= 2; x += 1) {
        const nx = state.basePoint.x + x;
        const ny = state.basePoint.y + y;
        if (inBounds(state.grid, nx, ny) && Math.hypot(x, y) <= 2.2) {
          const idx = indexFor(state.grid, nx, ny);
          const tile = state.tiles[idx];
          tile.type = "base";
          tile.isBase = true;
          clearVegetationState(tile);
          tile.dominantTreeType = null;
          tile.treeType = null;
        }
      }
    }

    await ctx.reportStage("Planning settlements...", 0.4);
    ctx.settlementPlan = createSettlementPlacementPlan({
      heightScaleMultiplier: ctx.settings.heightScaleMultiplier,
      diagonalPenalty: ctx.settings.road.diagonalPenalty,
      pruneRedundantDiagonals: ctx.settings.road.pruneRedundantDiagonals,
      bridgeTransitions: ctx.settings.road.bridgeTransitions,
      townDensity: ctx.settings.townDensity,
      bridgeAllowance: ctx.settings.bridgeAllowance,
      settlementSpacing: ctx.settings.settlementSpacing,
      roadStrictness: ctx.settings.roadStrictness,
      settlementPreGrowthYears: ctx.settings.settlementPreGrowthYears
    });

    await ctx.reportStage("Settlement plan ready.", 1);
    await emitStageSnapshot(ctx, "settlement:place");
  }
};
