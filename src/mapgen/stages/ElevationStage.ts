import type { PipelineStage } from "../pipeline/TerrainPipeline.js";
import { runElevationStage } from "../runtime.js";

export const ElevationStage: PipelineStage = {
  id: "terrain:elevation",
  weight: 22,
  run: runElevationStage
};

