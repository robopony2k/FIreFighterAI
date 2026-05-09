import type { MapGenDebugPhase } from "../mapgenTypes.js";
import { resolveStageLimit } from "./stageDebug.js";
import { ProgressTracker } from "./ProgressTracker.js";
import type { MapGenContext } from "./MapGenContext.js";

export type PipelineStage = {
  id: MapGenDebugPhase;
  weight: number;
  run: (ctx: MapGenContext) => Promise<void>;
};

export type TerrainPipelineRunOptions = {
  startAfterPhase?: MapGenDebugPhase | null;
};

export class TerrainPipeline {
  private readonly stages: PipelineStage[];

  constructor(stages: PipelineStage[]) {
    this.stages = stages;
  }

  async run(ctx: MapGenContext, options: TerrainPipelineRunOptions = {}): Promise<MapGenDebugPhase | null> {
    const stageLimit = resolveStageLimit(ctx.debug?.stopAfterPhase);
    const startAfterIndex = options.startAfterPhase
      ? this.stages.findIndex((stage) => stage.id === options.startAfterPhase)
      : -1;
    const startIndex = Math.max(0, startAfterIndex + 1);
    const endIndex = stageLimit
      ? this.stages.findIndex((stage) => stage.id === stageLimit)
      : this.stages.length - 1;
    if (endIndex < startIndex || startIndex >= this.stages.length) {
      return options.startAfterPhase ?? null;
    }
    const runStages = this.stages.slice(startIndex, endIndex + 1);
    const tracker = new ProgressTracker(
      runStages.map((stage) => ({ id: stage.id, weight: stage.weight })),
      ctx.report
    );
    let completedPhase: MapGenDebugPhase | null = null;
    for (let i = startIndex; i <= endIndex; i += 1) {
      const stage = this.stages[i];
      if (!stage) {
        continue;
      }
      ctx.setStageReporter(stage.id, async (message, localProgress) => {
        await tracker.reportStage(i - startIndex, message, localProgress);
      });
      const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      await stage.run(ctx);
      const endedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      const durationMs = Math.max(0, endedAt - startedAt);
      if (ctx.debug?.onStageTiming) {
        await ctx.debug.onStageTiming({ phase: stage.id, durationMs });
      }
      console.log(`[mapgenstage] ${stage.id} ${durationMs.toFixed(2)}ms`);
      completedPhase = stage.id;
      if (stageLimit === stage.id) {
        break;
      }
    }
    return completedPhase;
  }
}
