import type { PipelineStage } from "../pipeline/TerrainPipeline.js";
import { runSettlementPlacementStage } from "../runtime.js";

export const SettlementPlacementStage: PipelineStage = {
  id: "settlement:place",
  weight: 10,
  run: runSettlementPlacementStage
};

