import type { PipelineStage } from "../pipeline/TerrainPipeline.js";
import { runErosionStage } from "../runtime.js";

export const ErosionStage: PipelineStage = {
  id: "terrain:erosion",
  weight: 8,
  run: runErosionStage
};

