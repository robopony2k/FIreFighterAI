import type { WorldState } from "../../../core/state.js";
import type { FireKernelResult, FireKernelStepOptions } from "../sim/fireKernelTypes.js";

export type FireRuntimeTelemetrySnapshot = {
  sequence: number;
  recordedAtMs: number;
  totalMs: number;
  maxSubstepMs: number;
  timingsMs: {
    setup: number;
    terrainWind: number;
    blockBuild: number;
    cellLoop: number;
    ignitionCommit: number;
    finalize: number;
  };
  substeps: number;
  simulatedDays: number;
  deferredDays: number;
  activeFiresStart: number;
  activeFiresEnd: number;
  activeFiresMax: number;
  activeBlocksMax: number;
  workBlocksMax: number;
  fireBoundsAreaMax: number;
  heatBoundsAreaMax: number;
  processedTiles: number;
  inactiveTilesSkipped: number;
  burningTilesEvaluated: number;
  ignitionCandidates: number;
  ignitionsCommitted: number;
  terrainMutations: number;
  rangedDiffusionSamples: number;
  smokeEvents: number;
  houseDamageEvents: number;
  houseLossEvents: number;
  vegetationBurnoutEvents: number;
  spreadScaleMax: number;
  weatherSpreadMax: number;
  weatherIgnitionMax: number;
  climateIgnitionMultiplierMax: number;
};

type MutableFireRuntimeTelemetry = Omit<FireRuntimeTelemetrySnapshot, "recordedAtMs" | "totalMs" | "simulatedDays" | "deferredDays">;

const activeTelemetry = new WeakMap<WorldState, MutableFireRuntimeTelemetry>();
const latestTelemetry = new WeakMap<WorldState, FireRuntimeTelemetrySnapshot>();

const nowMs = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();

const createTelemetry = (state: WorldState): MutableFireRuntimeTelemetry => ({
  sequence: (latestTelemetry.get(state)?.sequence ?? 0) + 1,
  maxSubstepMs: 0,
  timingsMs: { setup: 0, terrainWind: 0, blockBuild: 0, cellLoop: 0, ignitionCommit: 0, finalize: 0 },
  substeps: 0,
  activeFiresStart: state.lastActiveFires,
  activeFiresEnd: state.lastActiveFires,
  activeFiresMax: state.lastActiveFires,
  activeBlocksMax: 0,
  workBlocksMax: 0,
  fireBoundsAreaMax: 0,
  heatBoundsAreaMax: 0,
  processedTiles: 0,
  inactiveTilesSkipped: 0,
  burningTilesEvaluated: 0,
  ignitionCandidates: 0,
  ignitionsCommitted: 0,
  terrainMutations: 0,
  rangedDiffusionSamples: 0,
  smokeEvents: 0,
  houseDamageEvents: 0,
  houseLossEvents: 0,
  vegetationBurnoutEvents: 0,
  spreadScaleMax: 0,
  weatherSpreadMax: 0,
  weatherIgnitionMax: 0,
  climateIgnitionMultiplierMax: 0
});

export const beginFireRuntimeTelemetry = (state: WorldState): void => {
  activeTelemetry.set(state, createTelemetry(state));
};

export const recordFireKernelTelemetry = (
  state: WorldState,
  result: FireKernelResult,
  options: FireKernelStepOptions
): void => {
  const aggregate = activeTelemetry.get(state);
  if (!aggregate) return;
  const telemetry = result.telemetry;
  aggregate.substeps += 1;
  aggregate.activeFiresEnd = result.activeFires;
  aggregate.activeFiresMax = Math.max(aggregate.activeFiresMax, result.activeFires);
  aggregate.maxSubstepMs = Math.max(aggregate.maxSubstepMs, telemetry.timingsMs.total);
  aggregate.timingsMs.setup += telemetry.timingsMs.setup;
  aggregate.timingsMs.terrainWind += telemetry.timingsMs.terrainWind;
  aggregate.timingsMs.blockBuild += telemetry.timingsMs.blockBuild;
  aggregate.timingsMs.cellLoop += telemetry.timingsMs.cellLoop;
  aggregate.timingsMs.ignitionCommit += telemetry.timingsMs.ignitionCommit;
  aggregate.timingsMs.finalize += telemetry.timingsMs.finalize;
  aggregate.activeBlocksMax = Math.max(aggregate.activeBlocksMax, telemetry.activeBlocks);
  aggregate.workBlocksMax = Math.max(aggregate.workBlocksMax, telemetry.workBlocks);
  aggregate.fireBoundsAreaMax = Math.max(aggregate.fireBoundsAreaMax, telemetry.fireBoundsArea);
  aggregate.heatBoundsAreaMax = Math.max(aggregate.heatBoundsAreaMax, telemetry.heatBoundsArea);
  aggregate.processedTiles += telemetry.processedTiles;
  aggregate.inactiveTilesSkipped += telemetry.inactiveTilesSkipped;
  aggregate.burningTilesEvaluated += telemetry.burningTilesEvaluated;
  aggregate.ignitionCandidates += telemetry.igniteCandidates;
  aggregate.ignitionsCommitted += telemetry.ignitionsCommitted;
  aggregate.terrainMutations += telemetry.terrainMutations;
  aggregate.rangedDiffusionSamples += telemetry.rangedDiffusionSamples;
  aggregate.smokeEvents += result.smokeEvents;
  aggregate.houseDamageEvents += result.houseDamageEvents;
  aggregate.houseLossEvents += result.houseLossEvents;
  aggregate.vegetationBurnoutEvents += result.vegetationBurnoutEvents;
  aggregate.spreadScaleMax = Math.max(aggregate.spreadScaleMax, options.spreadScale);
  aggregate.weatherSpreadMax = Math.max(aggregate.weatherSpreadMax, options.weatherResponse?.spread ?? 1);
  aggregate.weatherIgnitionMax = Math.max(aggregate.weatherIgnitionMax, options.weatherResponse?.ignition ?? 1);
  aggregate.climateIgnitionMultiplierMax = Math.max(
    aggregate.climateIgnitionMultiplierMax,
    options.climateIgnitionMultiplier ?? state.climateIgnitionMultiplier ?? 1
  );
};

export const finishFireRuntimeTelemetry = (
  state: WorldState,
  totalMs: number,
  simulatedDays: number,
  deferredDays: number
): FireRuntimeTelemetrySnapshot | null => {
  const aggregate = activeTelemetry.get(state);
  activeTelemetry.delete(state);
  if (!aggregate) return null;
  const snapshot: FireRuntimeTelemetrySnapshot = {
    ...aggregate,
    timingsMs: { ...aggregate.timingsMs },
    recordedAtMs: nowMs(),
    totalMs: Math.max(0, totalMs),
    simulatedDays: Math.max(0, simulatedDays),
    deferredDays: Math.max(0, deferredDays)
  };
  latestTelemetry.set(state, snapshot);
  return snapshot;
};

export const getLatestFireRuntimeTelemetry = (state: WorldState): FireRuntimeTelemetrySnapshot | null => {
  const snapshot = latestTelemetry.get(state);
  return snapshot ? { ...snapshot, timingsMs: { ...snapshot.timingsMs } } : null;
};

export const clearFireRuntimeTelemetry = (state: WorldState): void => {
  activeTelemetry.delete(state);
  latestTelemetry.delete(state);
};
