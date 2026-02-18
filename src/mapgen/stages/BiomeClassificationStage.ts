import type { PipelineStage } from "../pipeline/TerrainPipeline.js";
import { runBiomeClassificationStage } from "../runtime.js";

export const BiomeClassificationStage: PipelineStage = {
  id: "biome:classify",
  weight: 12,
  run: runBiomeClassificationStage
};

