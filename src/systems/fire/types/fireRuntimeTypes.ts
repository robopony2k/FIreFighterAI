export type FireStepTelemetry = {
  activeBlocks: number;
  workBlocks: number;
  fireBoundsArea: number;
  heatBoundsArea: number;
  terrainMutations: number;
  rangedDiffusionSamples: number;
  igniteCandidates: number;
};

export type RuntimeWorkBudget = {
  maxFireSubsteps: number;
  maxFireDeltaSeconds: number;
  deferredFireDeltaSeconds: number;
};

export const createEmptyFireStepTelemetry = (): FireStepTelemetry => ({
  activeBlocks: 0,
  workBlocks: 0,
  fireBoundsArea: 0,
  heatBoundsArea: 0,
  terrainMutations: 0,
  rangedDiffusionSamples: 0,
  igniteCandidates: 0
});
