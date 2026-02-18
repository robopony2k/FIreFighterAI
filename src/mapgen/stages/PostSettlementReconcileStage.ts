import type { PipelineStage } from "../pipeline/TerrainPipeline.js";
import { runPostSettlementReconcileStage } from "../runtime.js";

export const PostSettlementReconcileStage: PipelineStage = {
  id: "reconcile:postSettlement",
  weight: 6,
  run: runPostSettlementReconcileStage
};

