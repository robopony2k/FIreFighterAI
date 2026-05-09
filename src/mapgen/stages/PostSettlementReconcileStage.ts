import { inBounds, indexFor } from "../../core/grid.js";
import { TILE_TYPE_IDS } from "../../core/state.js";
import type { TileType } from "../../core/types.js";
import { clamp } from "../../core/utils.js";
import { clearVegetationState } from "../../core/vegetation.js";
import type { PipelineStage } from "../pipeline/TerrainPipeline.js";
import { computeBiomeSuitabilityValue } from "../biome/BiomeSuitability.js";
import { emitStageSnapshot } from "../pipeline/stageDebug.js";
import {
  assignForestComposition,
  classifyOceanCoastTile,
  classifySeedSpreadTile,
  classifyTile,
  COAST_LOCAL_SEA_MARGIN,
  COAST_MIN_LAND_ABOVE_SEA,
  computeStemDensityForTile,
  seedInitialVegetationState
} from "../runtime.js";

export const PostSettlementReconcileStage: PipelineStage = {
  id: "reconcile:postSettlement",
  weight: 6,
  run: async (ctx) => {
    const snapshot = ctx.settlementSnapshot;
    if (
      !snapshot ||
      !ctx.elevationMap ||
      !ctx.slopeMap ||
      !ctx.moistureMap ||
      !ctx.forestNoiseMap ||
      !ctx.microMap ||
      !ctx.meadowMaskMap ||
      !ctx.seaLevelMap ||
      !ctx.riverMask ||
      !ctx.oceanMask
    ) {
      await ctx.reportStage("Reconciling terrain...", 1);
      await emitStageSnapshot(ctx, "reconcile:postSettlement");
      return;
    }

    const { state } = ctx;
    ctx.dirtyRegions.clear();
    for (let i = 0; i < state.grid.totalTiles; i += 1) {
      const tile = state.tiles[i];
      const oldType = snapshot.typeBefore[i];
      const oldElevation = snapshot.elevationBefore[i] ?? 0;
      if (oldType !== TILE_TYPE_IDS[tile.type] || Math.abs(oldElevation - tile.elevation) > 1e-5) {
        const x = i % state.grid.cols;
        const y = Math.floor(i / state.grid.cols);
        ctx.dirtyRegions.markTile(x, y, 1);
      }
    }

    const regions = ctx.dirtyRegions.getMergedRegions(1);
    if (regions.length === 0) {
      await ctx.reportStage("Reconciling terrain...", 1);
      await emitStageSnapshot(ctx, "reconcile:postSettlement");
      return;
    }

    let processed = 0;
    const total = regions.reduce((sum, region) => sum + (region.maxX - region.minX + 1) * (region.maxY - region.minY + 1), 0);
    for (const region of regions) {
      for (let y = region.minY; y <= region.maxY; y += 1) {
        for (let x = region.minX; x <= region.maxX; x += 1) {
          const idx = indexFor(state.grid, x, y);
          const tile = state.tiles[idx];
          ctx.elevationMap[idx] = tile.elevation;
          const slopeLocal = (() => {
            const center = ctx.elevationMap?.[idx] ?? tile.elevation;
            let maxDiff = 0;
            if (x > 0) {
              maxDiff = Math.max(maxDiff, Math.abs(center - (ctx.elevationMap?.[idx - 1] ?? center)));
            }
            if (x < state.grid.cols - 1) {
              maxDiff = Math.max(maxDiff, Math.abs(center - (ctx.elevationMap?.[idx + 1] ?? center)));
            }
            if (y > 0) {
              maxDiff = Math.max(maxDiff, Math.abs(center - (ctx.elevationMap?.[idx - state.grid.cols] ?? center)));
            }
            if (y < state.grid.rows - 1) {
              maxDiff = Math.max(maxDiff, Math.abs(center - (ctx.elevationMap?.[idx + state.grid.cols] ?? center)));
            }
            return clamp(maxDiff, 0, 1);
          })();
          ctx.slopeMap[idx] = slopeLocal;
          const moisture =
            ctx.oceanMask[idx] || ctx.riverMask[idx] > 0
              ? 1
              : clamp(ctx.moistureMap[idx] ?? tile.moisture, 0, 1);
          ctx.moistureMap[idx] = moisture;
          tile.moisture = moisture;

          if (ctx.oceanMask[idx] || ctx.riverMask[idx] > 0) {
            tile.type = "water";
            clearVegetationState(tile);
            tile.dominantTreeType = null;
            tile.treeType = null;
            processed += 1;
            continue;
          }
          if (tile.type === "road" || tile.type === "house" || tile.type === "base") {
            clearVegetationState(tile);
            tile.dominantTreeType = null;
            tile.treeType = null;
            processed += 1;
            continue;
          }

          const valley = state.valleyMap[idx] ?? 0;
          const seaLevel = ctx.seaLevelMap[idx] ?? 0;
          let nextType: TileType;
          const coastlineOverride = classifyOceanCoastTile(
            state,
            idx,
            ctx.oceanMask,
            ctx.riverMask,
            ctx.seaLevelMap,
            slopeLocal,
            tile.elevation
          );
          if (coastlineOverride) {
            nextType = coastlineOverride;
          } else if (ctx.settings.biomeClassifierMode === "seedSpread" && ctx.forestMask && ctx.biomeSuitabilityMap) {
            const suitability = computeBiomeSuitabilityValue({
              elevation: tile.elevation,
              slope: slopeLocal,
              moisture,
              valley,
              seaLevel,
              highlandForestElevation: ctx.settings.highlandForestElevation
            });
            ctx.biomeSuitabilityMap[idx] = suitability;
            let forestNeighborCount = 0;
            for (let dy = -1; dy <= 1; dy += 1) {
              for (let dx = -1; dx <= 1; dx += 1) {
                if (dx === 0 && dy === 0) {
                  continue;
                }
                const nx = x + dx;
                const ny = y + dy;
                if (!inBounds(state.grid, nx, ny)) {
                  continue;
                }
                const nIdx = indexFor(state.grid, nx, ny);
                if (ctx.forestMask[nIdx] > 0) {
                  forestNeighborCount += 1;
                }
              }
            }
            const wasForest = ctx.forestMask[idx] > 0;
            let forestCandidate = false;
            if (wasForest) {
              forestCandidate = suitability >= 0.42;
            } else if (suitability >= 0.62 && forestNeighborCount >= 2) {
              forestCandidate = true;
            }
            if (suitability < 0.3) {
              forestCandidate = false;
            }
            ctx.forestMask[idx] = forestCandidate ? 1 : 0;
            nextType = classifySeedSpreadTile({
              elevation: tile.elevation,
              slope: slopeLocal,
              waterDistM: tile.waterDist * ctx.cellSizeM,
              valley,
              moisture,
              seaLevel,
              highlandForestElevation: ctx.settings.highlandForestElevation,
              forestCandidate
            });
          } else {
            nextType = classifyTile({
              elevation: tile.elevation,
              slope: slopeLocal,
              waterDistM: tile.waterDist * ctx.cellSizeM,
              valley,
              moisture,
              forestNoise: ctx.forestNoiseMap[idx] ?? 0.5,
              seaLevel,
              forestThreshold: ctx.settings.forestThreshold,
              highlandForestElevation: ctx.settings.highlandForestElevation
            });
          }
          tile.type = nextType;
          if (tile.type !== "water" && tile.elevation <= seaLevel + COAST_LOCAL_SEA_MARGIN) {
            tile.elevation = seaLevel + COAST_MIN_LAND_ABOVE_SEA;
            ctx.elevationMap[idx] = tile.elevation;
          }
          let canopy = 0;
          if (nextType === "forest" || nextType === "grass" || nextType === "scrub" || nextType === "floodplain") {
            const grassCanopyBase =
              (ctx.settings.grassCanopyBase + (ctx.microMap[idx] ?? 0) * ctx.settings.grassCanopyRange) *
              (1 - (ctx.meadowMaskMap[idx] ?? 0) * ctx.settings.meadowStrength);
            const valleyDry = valley > 0.1 && tile.elevation < 0.6;
            if (nextType === "forest" && ctx.settings.biomeClassifierMode === "seedSpread" && ctx.biomeSuitabilityMap) {
              canopy = clamp(
                0.48 + 0.42 * (ctx.biomeSuitabilityMap[idx] ?? 0) + 0.1 * (ctx.microMap[idx] ?? 0),
                0,
                1
              );
            } else {
              canopy = clamp(
                nextType === "forest" ? 0.55 + (ctx.microMap[idx] ?? 0) * 0.55 : grassCanopyBase - (valleyDry ? 0.08 : 0),
                0,
                1
              );
            }
          }
          tile.canopy = canopy;
          tile.canopyCover = canopy;
          tile.stemDensity = computeStemDensityForTile(state, nextType, canopy, x, y);
          processed += 1;
        }
        if (await ctx.yieldIfNeeded()) {
          await ctx.reportStage("Reconciling terrain...", processed / Math.max(1, total));
        }
      }
    }
    seedInitialVegetationState(state, ctx.biomeSuitabilityMap, ctx.microMap, ctx.meadowMaskMap);
    assignForestComposition(state);
    await emitStageSnapshot(ctx, "reconcile:postSettlement");
  }
};
