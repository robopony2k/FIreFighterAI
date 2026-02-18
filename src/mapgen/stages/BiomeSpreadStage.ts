import type { PipelineStage } from "../pipeline/TerrainPipeline.js";
import { runBiomeSpreadStage } from "../runtime.js";

export const BiomeSpreadStage: PipelineStage = {
  id: "biome:spread",
  weight: 8,
  run: runBiomeSpreadStage
};

