import type { PipelineStage } from "../pipeline/TerrainPipeline.js";
import { runShorelinePolishStage } from "../runtime.js";

export const ShorelinePolishStage: PipelineStage = {
  id: "terrain:shoreline",
  weight: 6,
  run: runShorelinePolishStage
};
