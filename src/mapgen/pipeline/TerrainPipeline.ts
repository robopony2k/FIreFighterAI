import type { MapGenDebugPhase } from "../mapgenTypes.js";
import { resolveStageLimit } from "./stageDebug.js";
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
      const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      await stage.run(ctx);
      const endedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      const durationMs = Math.max(0, endedAt - startedAt);
      if (ctx.debug?.onStageTiming) {
        await ctx.debug.onStageTiming({ phase: stage.id, durationMs });
      }
      console.log(`[mapgenstage] ${stage.id} ${durationMs.toFixed(2)}ms`);
      if (stageLimit === stage.id) {
        break;
      }
    }
  }
}
