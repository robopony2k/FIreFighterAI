import type { PipelineStage } from "../pipeline/TerrainPipeline.js";
import { runRiverStage } from "../runtime.js";

export const RiverStage: PipelineStage = {
  id: "hydro:rivers",
  weight: 10,
  run: runRiverStage
};
