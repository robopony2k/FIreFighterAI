import type { PipelineStage } from "../pipeline/TerrainPipeline.js";
import { runHydrologyStage } from "../runtime.js";

export const HydrologyStage: PipelineStage = {
  id: "hydro:solve",
  weight: 16,
  run: runHydrologyStage
};

