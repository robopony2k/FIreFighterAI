import type { MapGenReporter } from "../mapgenTypes.js";

type StageMeta = {
  id: string;
  weight: number;
};

export class ProgressTracker {
  private readonly report?: MapGenReporter;
  private readonly totalWeight: number;
  private readonly prefixWeight: number[];

  constructor(stages: StageMeta[], report?: MapGenReporter) {
    this.report = report;
    this.totalWeight = Math.max(
      0.0001,
      stages.reduce((sum, stage) => sum + Math.max(0.0001, stage.weight), 0)
    );
    this.prefixWeight = new Array(stages.length).fill(0);
    let running = 0;
    for (let i = 0; i < stages.length; i += 1) {
      this.prefixWeight[i] = running;
      running += Math.max(0.0001, stages[i]?.weight ?? 0.0001);
    }
  }

  async reportStage(stageIndex: number, message: string, localProgress: number): Promise<void> {
    if (!this.report) {
      return;
    }
    const start = this.prefixWeight[stageIndex] ?? 0;
    const nextWeight =
      (this.prefixWeight[stageIndex + 1] ?? this.totalWeight) - start;
    const clamped = Math.max(0, Math.min(1, localProgress));
    const global = Math.max(0, Math.min(1, (start + nextWeight * clamped) / this.totalWeight));
    await this.report(message, global);
  }
}

