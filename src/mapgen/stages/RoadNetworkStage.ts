import type { PipelineStage } from "../pipeline/TerrainPipeline.js";
import { runRoadNetworkStage } from "../runtime.js";

export const RoadNetworkStage: PipelineStage = {
  id: "roads:connect",
  weight: 6,
  run: runRoadNetworkStage
};

