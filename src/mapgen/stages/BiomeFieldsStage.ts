import { MOISTURE_WATER_DIST_CAP } from "../../core/config.js";
import { indexFor } from "../../core/grid.js";
import { clamp } from "../../core/utils.js";
import type { PipelineStage } from "../pipeline/TerrainPipeline.js";
import { fractalNoise } from "../noise.js";
import { emitStageSnapshot } from "../pipeline/stageDebug.js";
import { buildMoistureMap, buildSlopeMap, computeWaterDistances } from "../runtime.js";

const FOREST_MACRO_WEIGHT = 0.85;
const FOREST_DETAIL_WEIGHT = 0.15;

type BiomeSample = {
  micro: number;
  forestNoise: number;
  meadowMask: number;
};

const buildBiomeSamples = async (ctx: Parameters<PipelineStage["run"]>[0]): Promise<BiomeSample[] | null> => {
  const { state, biomeBlock, cellSizeM, worldOffsetXM, worldOffsetYM, microScaleM } = ctx;
  const blockCols = Math.ceil(state.grid.cols / biomeBlock);
  const blockRows = Math.ceil(state.grid.rows / biomeBlock);
  if (biomeBlock <= 1) {
    return null;
  }
  const samples = new Array<BiomeSample>(blockCols * blockRows);
  for (let by = 0; by < blockRows; by += 1) {
    const sampleY = (by + 0.5) * biomeBlock;
    for (let bx = 0; bx < blockCols; bx += 1) {
      const sampleX = (bx + 0.5) * biomeBlock;
      const worldX = worldOffsetXM + sampleX * cellSizeM;
      const worldY = worldOffsetYM + sampleY * cellSizeM;
      const micro = fractalNoise(worldX / microScaleM, worldY / microScaleM, state.seed + 211);
      const forestMacro = fractalNoise(worldX / ctx.forestMacroScaleM, worldY / ctx.forestMacroScaleM, state.seed + 415);
      const forestDetail = fractalNoise(
        worldX / ctx.forestDetailScaleM,
        worldY / ctx.forestDetailScaleM,
        state.seed + 619
      );
      const forestNoise = forestMacro * FOREST_MACRO_WEIGHT + forestDetail * FOREST_DETAIL_WEIGHT;
      const meadowNoise = fractalNoise(worldX / ctx.meadowScaleM, worldY / ctx.meadowScaleM, state.seed + 933);
      const meadowMask = clamp(
        (meadowNoise - ctx.settings.meadowThreshold) / (1 - ctx.settings.meadowThreshold),
        0,
        1
      );
      samples[by * blockCols + bx] = { micro, forestNoise, meadowMask };
    }
    if (await ctx.yieldIfNeeded()) {
      await ctx.reportStage("Seeding biome fields...", (by + 1) / blockRows);
    }
  }
  return samples;
};

export const BiomeFieldsStage: PipelineStage = {
  id: "biome:fields",
  weight: 14,
  run: async (ctx) => {
    const { state, elevationMap } = ctx;
    if (!elevationMap) {
      throw new Error("Biome field stage missing elevation map.");
    }
    ctx.slopeMap = buildSlopeMap(state, elevationMap);

    const totalTiles = state.grid.totalTiles;
    const microMap = new Float32Array(totalTiles);
    const forestNoiseMap = new Float32Array(totalTiles);
    const meadowMaskMap = new Float32Array(totalTiles);
    ctx.microMap = microMap;
    ctx.forestNoiseMap = forestNoiseMap;
    ctx.meadowMaskMap = meadowMaskMap;

    const blockCols = Math.ceil(state.grid.cols / ctx.biomeBlock);
    const biomeSamples = await buildBiomeSamples(ctx);
    for (let y = 0; y < state.grid.rows; y += 1) {
      for (let x = 0; x < state.grid.cols; x += 1) {
        const idx = indexFor(state.grid, x, y);
        let micro = 0.5;
        let forestNoise = 0.5;
        let meadowMask = 0;
        if (ctx.biomeBlock > 1 && biomeSamples) {
          const bx = Math.floor(x / ctx.biomeBlock);
          const by = Math.floor(y / ctx.biomeBlock);
          const sample = biomeSamples[by * blockCols + bx];
          micro = sample?.micro ?? 0.5;
          forestNoise = sample?.forestNoise ?? 0.5;
          meadowMask = sample?.meadowMask ?? 0;
        } else {
          const worldX = ctx.worldOffsetXM + x * ctx.cellSizeM;
          const worldY = ctx.worldOffsetYM + y * ctx.cellSizeM;
          micro = fractalNoise(worldX / ctx.microScaleM, worldY / ctx.microScaleM, state.seed + 211);
          const forestMacro = fractalNoise(worldX / ctx.forestMacroScaleM, worldY / ctx.forestMacroScaleM, state.seed + 415);
          const forestDetail = fractalNoise(
            worldX / ctx.forestDetailScaleM,
            worldY / ctx.forestDetailScaleM,
            state.seed + 619
          );
          forestNoise = forestMacro * FOREST_MACRO_WEIGHT + forestDetail * FOREST_DETAIL_WEIGHT;
          const meadowNoise = fractalNoise(worldX / ctx.meadowScaleM, worldY / ctx.meadowScaleM, state.seed + 933);
          meadowMask = clamp(
            (meadowNoise - ctx.settings.meadowThreshold) / (1 - ctx.settings.meadowThreshold),
            0,
            1
          );
        }
        microMap[idx] = micro;
        forestNoiseMap[idx] = forestNoise;
        meadowMaskMap[idx] = meadowMask;
      }
      if (await ctx.yieldIfNeeded()) {
        await ctx.reportStage("Deriving biome fields...", (y + 1) / state.grid.rows * 0.6);
      }
    }

    const waterDistMap = await computeWaterDistances(
      state,
      MOISTURE_WATER_DIST_CAP,
      async (message, progress) => ctx.reportStage(message, 0.6 + progress * 0.2),
      ctx.yieldIfNeeded
    );
    ctx.waterDistMap = waterDistMap;
    const moistureMap = await buildMoistureMap(
      state,
      waterDistMap,
      MOISTURE_WATER_DIST_CAP,
      async (message, progress) => ctx.reportStage(message, 0.8 + progress * 0.2),
      ctx.yieldIfNeeded
    );
    ctx.moistureMap = moistureMap;
    await emitStageSnapshot(ctx, "biome:fields");
  }
};
