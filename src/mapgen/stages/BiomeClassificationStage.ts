import { COAST_CLASS_NONE, COAST_CLASS_SHELF_WATER } from "../../core/state.js";
import type { TileType } from "../../core/types.js";
import { clamp } from "../../core/utils.js";
import type { PipelineStage } from "../pipeline/TerrainPipeline.js";
import { emitStageSnapshot } from "../pipeline/stageDebug.js";
import {
  assignForestComposition,
  assertEdgeWater,
  classifyOceanCoastTile,
  classifySeedSpreadTile,
  classifyTile,
  COAST_LOCAL_SEA_MARGIN,
  COAST_MIN_LAND_ABOVE_SEA,
  computeStemDensityForTile,
  getYieldEveryRows,
  seedInitialVegetationState,
  shapeOceanFloorAtSeaLevel
} from "../runtime.js";

export const BiomeClassificationStage: PipelineStage = {
  id: "biome:classify",
  weight: 12,
  run: async (ctx) => {
    const {
      state,
      settings,
      oceanMask,
      riverMask,
      seaLevelMap,
      slopeMap,
      moistureMap,
      forestNoiseMap,
      microMap,
      meadowMaskMap,
      biomeSuitabilityMap,
      forestMask
    } = ctx;
    if (
      !oceanMask ||
      !riverMask ||
      !seaLevelMap ||
      !slopeMap ||
      !moistureMap ||
      !forestNoiseMap ||
      !microMap ||
      !meadowMaskMap
    ) {
      throw new Error("Biome classification stage missing derived fields.");
    }

    const useSeedSpread = settings.biomeClassifierMode === "seedSpread";
    if (useSeedSpread && (!biomeSuitabilityMap || !forestMask)) {
      throw new Error("Seed-spread biome classification missing spread maps.");
    }

    const nextTypes: TileType[] = new Array(state.grid.totalTiles);
    const nextMoisture = new Float32Array(state.grid.totalTiles);
    const nextCanopy = new Float32Array(state.grid.totalTiles);
    const nextStemDensity = new Uint8Array(state.grid.totalTiles);
    const yieldEveryRows = getYieldEveryRows(state.grid.cols);

    for (let y = 0; y < state.grid.rows; y += 1) {
      const rowBase = y * state.grid.cols;
      for (let x = 0; x < state.grid.cols; x += 1) {
        const idx = rowBase + x;
        const tile = state.tiles[idx];
        const moisture = moistureMap[idx] ?? 0;
        nextMoisture[idx] = moisture;
        if (oceanMask[idx] || riverMask[idx] > 0) {
          nextTypes[idx] = "water";
          nextCanopy[idx] = 0;
          nextStemDensity[idx] = 0;
          continue;
        }

        const elevation = tile.elevation;
        const valley = state.valleyMap[idx] ?? 0;
        const slope = slopeMap[idx] ?? 0;
        const seaLevel = seaLevelMap[idx] ?? 0;
        const waterDistM = tile.waterDist * ctx.cellSizeM;
        const coastlineOverride = classifyOceanCoastTile(
          state,
          idx,
          oceanMask,
          riverMask,
          seaLevelMap,
          slope,
          elevation
        );
        const nextType =
          coastlineOverride ??
          (useSeedSpread
            ? classifySeedSpreadTile({
                elevation,
                slope,
                waterDistM,
                valley,
                moisture,
                seaLevel,
                highlandForestElevation: settings.highlandForestElevation,
                forestCandidate: (forestMask?.[idx] ?? 0) > 0
              })
            : classifyTile({
                elevation,
                slope,
                waterDistM,
                valley,
                moisture,
                forestNoise: forestNoiseMap[idx] ?? 0.5,
                seaLevel,
                forestThreshold: settings.forestThreshold,
                highlandForestElevation: settings.highlandForestElevation
              }));
        nextTypes[idx] = nextType;

        let canopyCover = 0;
        if (nextType === "forest" || nextType === "grass" || nextType === "scrub" || nextType === "floodplain") {
          const micro = microMap[idx] ?? 0;
          const grassCanopyBase =
            (settings.grassCanopyBase + micro * settings.grassCanopyRange) *
            (1 - (meadowMaskMap[idx] ?? 0) * settings.meadowStrength);
          const valleyDry = valley > 0.1 && elevation < 0.6;
          if (nextType === "forest" && useSeedSpread) {
            canopyCover = clamp(0.48 + 0.42 * (biomeSuitabilityMap?.[idx] ?? 0) + 0.1 * micro, 0, 1);
          } else {
            const canopyBase = nextType === "forest" ? 0.55 + micro * 0.55 : grassCanopyBase - (valleyDry ? 0.08 : 0);
            canopyCover = clamp(canopyBase, 0, 1);
          }
        }
        nextCanopy[idx] = canopyCover;
        nextStemDensity[idx] = computeStemDensityForTile(state, nextType, canopyCover, x, y);
      }
      if ((y === state.grid.rows - 1 || (y + 1) % yieldEveryRows === 0) && (await ctx.yieldIfNeeded())) {
        await ctx.reportStage("Classifying terrain...", ((y + 1) / state.grid.rows) * 0.8);
      }
    }

    for (let y = 0; y < state.grid.rows; y += 1) {
      const rowBase = y * state.grid.cols;
      for (let x = 0; x < state.grid.cols; x += 1) {
        const idx = rowBase + x;
        const tile = state.tiles[idx];
        tile.type = nextTypes[idx] ?? tile.type;
        tile.moisture = nextMoisture[idx] ?? tile.moisture;
        tile.canopy = nextCanopy[idx] ?? 0;
        tile.canopyCover = tile.canopy;
        tile.stemDensity = nextStemDensity[idx] ?? 0;
        const seaLevel = seaLevelMap[idx] ?? tile.elevation;
        if (
          tile.type === "water" &&
          oceanMask[idx] &&
          riverMask[idx] === 0 &&
          (state.tileCoastClass[idx] ?? COAST_CLASS_NONE) !== COAST_CLASS_SHELF_WATER
        ) {
          tile.elevation = shapeOceanFloorAtSeaLevel(
            tile.elevation,
            seaLevel,
            ctx.rng.next()
          );
        } else if (tile.type !== "water" && riverMask[idx] === 0 && tile.elevation <= seaLevel + COAST_LOCAL_SEA_MARGIN) {
          tile.elevation = seaLevel + COAST_MIN_LAND_ABOVE_SEA;
        }
        if (ctx.elevationMap) {
          ctx.elevationMap[idx] = tile.elevation;
        }
      }
      if ((y === state.grid.rows - 1 || (y + 1) % yieldEveryRows === 0) && (await ctx.yieldIfNeeded())) {
        await ctx.reportStage("Classifying terrain...", 0.8 + ((y + 1) / state.grid.rows) * 0.2);
      }
    }

    seedInitialVegetationState(state, biomeSuitabilityMap, microMap, meadowMaskMap);
    assignForestComposition(state);
    assertEdgeWater(state);
    await emitStageSnapshot(ctx, "biome:classify");
  }
};
