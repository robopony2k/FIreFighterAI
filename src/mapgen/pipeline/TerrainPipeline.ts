import type { MapGenDebugPhase } from "../mapgenTypes.js";
import { ProgressTracker } from "./ProgressTracker.js";
import type { MapGenContext } from "./MapGenContext.js";

export type PipelineStage = {
  id: MapGenDebugPhase;
  weight: number;
  run: (ctx: MapGenContext) => Promise<void>;
};

export class TerrainPipeline {
  private readonly stages: PipelineStage[];

  constructor(stages: PipelineStage[]) {
    this.stages = stages;
  }

  async run(ctx: MapGenContext): Promise<void> {
    const stageLimit = resolveStageLimit(ctx.debug?.stopAfterPhase);
    const tracker = new ProgressTracker(
      this.stages.map((stage) => ({ id: stage.id, weight: stage.weight })),
      ctx.report
    );
    for (let i = 0; i < this.stages.length; i += 1) {
      const stage = this.stages[i];
      if (!stage) {
        continue;
      }
      ctx.setStageReporter(stage.id, async (message, localProgress) => {
        await tracker.reportStage(i, message, localProgress);
      });
      await stage.run(ctx);
      if (stageLimit === stage.id) {
        break;
      }
    }
  }
}

const resolveStageLimit = (phase: MapGenDebugPhase | undefined): MapGenDebugPhase | null => {
  switch (phase) {
    case "terrain:relief":
    case "terrain:landmass":
    case "terrain:mountains":
    case "terrain:carving":
    case "terrain:flooding":
    case "terrain:elevation":
      return "terrain:elevation";
    case "terrain:erosion":
      return "terrain:erosion";
    case "hydro:solve":
      return "hydro:solve";
    case "terrain:shoreline":
      return "terrain:shoreline";
    case "hydro:rivers":
      return "hydro:rivers";
    case "biome:fields":
      return "biome:fields";
    case "biome:spread":
      return "biome:spread";
    case "biome:classify":
      return "biome:classify";
    case "settlement:place":
      return "settlement:place";
    case "roads:connect":
      return "roads:connect";
    case "reconcile:postSettlement":
      return "reconcile:postSettlement";
    case "map:finalize":
      return "map:finalize";
    default:
      return null;
  }
};
