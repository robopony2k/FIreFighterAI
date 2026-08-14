export type FireStepTelemetry = {
  timingsMs: {
    setup: number;
    terrainWind: number;
    blockBuild: number;
    cellLoop: number;
    ignitionCommit: number;
    finalize: number;
    total: number;
  };
  activeBlocks: number;
  workBlocks: number;
  fireBoundsArea: number;
  heatBoundsArea: number;
  processedTiles: number;
  inactiveTilesSkipped: number;
  burningTilesEvaluated: number;
  terrainMutations: number;
  rangedDiffusionSamples: number;
  igniteCandidates: number;
  ignitionsCommitted: number;
};

export type RuntimeWorkBudget = {
  maxFireSubsteps: number;
  maxFireDeltaSeconds: number;
  deferredFireDeltaSeconds: number;
};

export const createEmptyFireStepTelemetry = (): FireStepTelemetry => ({
  timingsMs: {
    setup: 0,
    terrainWind: 0,
    blockBuild: 0,
    cellLoop: 0,
    ignitionCommit: 0,
    finalize: 0,
    total: 0
  },
  activeBlocks: 0,
  workBlocks: 0,
  fireBoundsArea: 0,
  heatBoundsArea: 0,
  processedTiles: 0,
  inactiveTilesSkipped: 0,
  burningTilesEvaluated: 0,
  terrainMutations: 0,
  rangedDiffusionSamples: 0,
  igniteCandidates: 0,
  ignitionsCommitted: 0
});
