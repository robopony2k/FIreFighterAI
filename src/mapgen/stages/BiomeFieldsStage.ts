import type { PipelineStage } from "../pipeline/TerrainPipeline.js";
import { runBiomeFieldsStage } from "../runtime.js";

export const BiomeFieldsStage: PipelineStage = {
  id: "biome:fields",
  weight: 14,
  run: runBiomeFieldsStage
};

