import type { PipelineStage } from "../pipeline/TerrainPipeline.js";
import { runFinalizeStage } from "../runtime.js";

export const FinalizeStage: PipelineStage = {
  id: "map:finalize",
  weight: 6,
  run: runFinalizeStage
};

