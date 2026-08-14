import {
  createRetainedPerformanceEventStore,
  type RetainedPerformanceEvent
} from "../../core/diagnostics/performanceTelemetry.js";
import type { FireRuntimeTelemetrySnapshot } from "../../systems/fire/controllers/fireRuntimeTelemetry.js";
import type { AnnualVegetationGrowthResult } from "../../systems/terrain/sim/annualVegetationGrowth.js";
import type { GpuCategoryProfileResult } from "../../render/diagnostics/gpuCategoryCapture.js";

export type RuntimeTelemetryContext = {
  nowMs: number;
  phase: string;
  year: number;
  careerDay: number;
  speed: number;
  simTimeMode: "strategic" | "incident";
  pauseOnFireEvent: boolean;
  advancingToEvent: boolean;
};

export type TerrainSyncProfileInput = RuntimeTelemetryContext & {
  totalMs: number;
  sampleBuildMs: number;
  terrainSetMs: number;
  intent: string;
  path: string;
  dominantStep: string;
  fullRebuildReason: string;
  terrainTypeRevisionDelta: number;
  vegetationRevisionDelta: number;
  structureRevisionDelta: number;
};

export type HitchProfileInput = RuntimeTelemetryContext & {
  gapMs: number;
  mainFrameMs: number;
  simMs: number;
  renderMs: number;
  terrainSyncMs: number;
  frameBudgetMs: number;
  gpuWorldMs: number | null;
  gpuShadowRefreshMs: number | null;
  longTaskMs: number;
  longTaskAgeMs: number;
  longTaskSource: string;
};

export type GpuProfileInput = RuntimeTelemetryContext & {
  result: GpuCategoryProfileResult;
};

type GrowthProfileEvent = RetainedPerformanceEvent & {
  kind: "growth";
  snapshot: AnnualVegetationGrowthResult;
};

type FireProfileEvent = RetainedPerformanceEvent & {
  kind: "fire";
  snapshot: FireRuntimeTelemetrySnapshot;
};

type TerrainProfileEvent = RetainedPerformanceEvent & {
  kind: "terrain";
  input: TerrainSyncProfileInput;
  causeId: string | null;
};

type HitchProfileEvent = RetainedPerformanceEvent & {
  kind: "hitch";
  input: HitchProfileInput;
  dominant: string;
  unattributedMs: number;
  links: string[];
};

type GpuProfileEvent = RetainedPerformanceEvent & {
  kind: "gpu";
  input: GpuProfileInput;
};

export type RuntimeTelemetryCapture = {
  consoleLine: string | null;
};

export type RuntimeTelemetryPresenter = {
  clear: () => void;
  captureFire: (snapshot: FireRuntimeTelemetrySnapshot, context: RuntimeTelemetryContext) => RuntimeTelemetryCapture;
  captureGrowth: (snapshot: AnnualVegetationGrowthResult, context: RuntimeTelemetryContext) => RuntimeTelemetryCapture;
  captureHitch: (input: HitchProfileInput) => RuntimeTelemetryCapture;
  captureGpu: (input: GpuProfileInput) => RuntimeTelemetryCapture;
  captureTerrainSync: (input: TerrainSyncProfileInput) => RuntimeTelemetryCapture;
  formatOverlayLines: (nowMs: number) => string[];
};

const formatMs = (value: number): string => `${Math.max(0, value).toFixed(2)}ms`;
const formatInt = (value: number): string => Math.max(0, Math.round(value)).toString();

export const selectDominantContributor = (contributors: Record<string, number>): string => {
  let dominant = "unattributed";
  let dominantMs = 0;
  for (const [name, value] of Object.entries(contributors)) {
    if (Number.isFinite(value) && value > dominantMs) {
      dominant = name;
      dominantMs = value;
    }
  }
  return dominant;
};

export const createRuntimeTelemetryPresenter = (
  hitchThresholdMs = 45,
  retentionMs = 60_000
): RuntimeTelemetryPresenter => {
  const growthStore = createRetainedPerformanceEventStore<GrowthProfileEvent>(retentionMs);
  const fireStore = createRetainedPerformanceEventStore<FireProfileEvent>(retentionMs);
  const terrainStore = createRetainedPerformanceEventStore<TerrainProfileEvent>(retentionMs);
  const hitchStore = createRetainedPerformanceEventStore<HitchProfileEvent>(retentionMs);
  const gpuStore = createRetainedPerformanceEventStore<GpuProfileEvent>(retentionMs);
  let terrainSequence = 0;
  let hitchSequence = 0;
  let lastGrowthSequence = 0;
  let lastFireSequence = 0;
  let lastFireLoggedAtMs = Number.NEGATIVE_INFINITY;
  let previousFireActiveEnd = 0;
  let lastHitchCapturedAtMs = Number.NEGATIVE_INFINITY;

  const clear = (): void => {
    growthStore.clear();
    fireStore.clear();
    terrainStore.clear();
    hitchStore.clear();
    gpuStore.clear();
    terrainSequence = 0;
    hitchSequence = 0;
    lastGrowthSequence = 0;
    lastFireSequence = 0;
    lastFireLoggedAtMs = Number.NEGATIVE_INFINITY;
    previousFireActiveEnd = 0;
    lastHitchCapturedAtMs = Number.NEGATIVE_INFINITY;
  };

  const captureGrowth = (
    snapshot: AnnualVegetationGrowthResult,
    context: RuntimeTelemetryContext
  ): RuntimeTelemetryCapture => {
    if (snapshot.sequence <= lastGrowthSequence) return { consoleLine: null };
    lastGrowthSequence = snapshot.sequence;
    const id = `G${snapshot.sequence}`;
    growthStore.set({ id, recordedAtMs: context.nowMs, kind: "growth", snapshot });
    return {
      consoleLine:
        `[growthprofile] id=${id} year=${snapshot.year} phase=${context.phase} day=${context.careerDay.toFixed(2)} ` +
        `speed=${context.speed.toFixed(2)} total=${snapshot.timingsMs.total.toFixed(2)}ms ` +
        `mask=${snapshot.timingsMs.maskBuild.toFixed(2)}ms cache=${snapshot.timingsMs.suitabilityCache.toFixed(2)}ms ` +
        `scan=${snapshot.timingsMs.mutationScan.toFixed(2)}ms finalize=${snapshot.timingsMs.revisionFinalize.toFixed(2)}ms ` +
        `cacheSource=${snapshot.cacheSource} tiles=${snapshot.tilesScanned} aged=${snapshot.agedTiles} ` +
        `fuel=${snapshot.fuelTilesChanged} shrub=${snapshot.shrubExpandedTiles} forest=${snapshot.forestExpandedTiles} ` +
        `recover=${snapshot.recoveredTiles} revisions=terrain+${snapshot.terrainTypeRevisionDelta}/vegetation+${snapshot.vegetationRevisionDelta}`
    };
  };

  const captureFire = (
    snapshot: FireRuntimeTelemetrySnapshot,
    context: RuntimeTelemetryContext
  ): RuntimeTelemetryCapture => {
    if (snapshot.sequence <= lastFireSequence) return { consoleLine: null };
    lastFireSequence = snapshot.sequence;
    const id = `F${snapshot.sequence}`;
    fireStore.set({ id, recordedAtMs: context.nowMs, kind: "fire", snapshot });
    const started = previousFireActiveEnd <= 0 && snapshot.activeFiresEnd > 0;
    const surgeThreshold = Math.max(32, Math.ceil(Math.max(1, snapshot.activeFiresStart) * 0.5));
    const surged = snapshot.activeFiresEnd - snapshot.activeFiresStart >= surgeThreshold;
    const cadence = snapshot.activeFiresEnd > 0 && context.nowMs - lastFireLoggedAtMs >= 2000;
    const slow = snapshot.totalMs >= hitchThresholdMs;
    previousFireActiveEnd = snapshot.activeFiresEnd;
    if (!started && !surged && !cadence && !slow) return { consoleLine: null };
    lastFireLoggedAtMs = context.nowMs;
    const t = snapshot.timingsMs;
    return {
      consoleLine:
        `[fireprofile] id=${id} phase=${context.phase} year=${context.year} day=${context.careerDay.toFixed(2)} ` +
        `speed=${context.speed.toFixed(2)} mode=${context.simTimeMode} pauseFire=${context.pauseOnFireEvent ? 1 : 0} advance=${context.advancingToEvent ? 1 : 0} ` +
        `total=${snapshot.totalMs.toFixed(2)}ms maxStep=${snapshot.maxSubstepMs.toFixed(2)}ms ` +
        `kernel=setup:${t.setup.toFixed(2)}/wind:${t.terrainWind.toFixed(2)}/blocks:${t.blockBuild.toFixed(2)}/` +
        `loop:${t.cellLoop.toFixed(2)}/ignite:${t.ignitionCommit.toFixed(2)}/final:${t.finalize.toFixed(2)}ms ` +
        `substeps=${snapshot.substeps} simDays=${snapshot.simulatedDays.toFixed(2)} deferredDays=${snapshot.deferredDays.toFixed(2)} ` +
        `active=${snapshot.activeFiresStart}->${snapshot.activeFiresEnd} max=${snapshot.activeFiresMax} ` +
        `blocks=${snapshot.activeBlocksMax}/${snapshot.workBlocksMax} area=${snapshot.fireBoundsAreaMax}/${snapshot.heatBoundsAreaMax} ` +
        `tiles=${snapshot.processedTiles}/${snapshot.inactiveTilesSkipped}/${snapshot.burningTilesEvaluated} ` +
        `ignite=${snapshot.ignitionCandidates}/${snapshot.ignitionsCommitted} ranged=${snapshot.rangedDiffusionSamples} ` +
        `terrainMut=${snapshot.terrainMutations} burnout=${snapshot.vegetationBurnoutEvents} ` +
        `spread=${snapshot.spreadScaleMax.toFixed(3)} weather=${snapshot.weatherSpreadMax.toFixed(3)}/${snapshot.weatherIgnitionMax.toFixed(3)} ` +
        `climateIgnite=${snapshot.climateIgnitionMultiplierMax.toFixed(3)}`
    };
  };

  const captureTerrainSync = (input: TerrainSyncProfileInput): RuntimeTelemetryCapture => {
    terrainSequence += 1;
    const id = `T${terrainSequence}`;
    const growth = growthStore.get(input.nowMs);
    const linkedGrowth =
      growth &&
      input.nowMs >= growth.recordedAtMs &&
      input.nowMs - growth.recordedAtMs <= retentionMs &&
      ((growth.snapshot.vegetationRevisionDelta > 0 && input.vegetationRevisionDelta > 0) ||
        (growth.snapshot.terrainTypeRevisionDelta > 0 && input.terrainTypeRevisionDelta > 0))
        ? growth
        : null;
    terrainStore.set({ id, recordedAtMs: input.nowMs, kind: "terrain", input, causeId: linkedGrowth?.id ?? null });
    const shouldLog = input.totalMs >= hitchThresholdMs || input.path === "full" || linkedGrowth !== null;
    if (!shouldLog) return { consoleLine: null };
    return {
      consoleLine:
        `[terrainsyncprofile] id=${id} cause=${linkedGrowth?.id ?? "none"} phase=${input.phase} year=${input.year} ` +
        `day=${input.careerDay.toFixed(2)} speed=${input.speed.toFixed(2)} total=${input.totalMs.toFixed(2)}ms ` +
        `sample=${input.sampleBuildMs.toFixed(2)}ms set=${input.terrainSetMs.toFixed(2)}ms intent=${input.intent} ` +
        `path=${input.path} hot=${input.dominantStep} reason=${input.fullRebuildReason} ` +
        `revisions=terrain+${input.terrainTypeRevisionDelta}/vegetation+${input.vegetationRevisionDelta}/structure+${input.structureRevisionDelta}`
    };
  };

  const captureHitch = (input: HitchProfileInput): RuntimeTelemetryCapture => {
    if (Math.max(input.gapMs, input.mainFrameMs) < hitchThresholdMs) return { consoleLine: null };
    if (input.nowMs - lastHitchCapturedAtMs < 250) return { consoleLine: null };
    lastHitchCapturedAtMs = input.nowMs;
    hitchSequence += 1;
    const id = `H${hitchSequence}`;
    const recentLongTask = input.longTaskMs >= hitchThresholdMs && input.longTaskAgeMs <= 250;
    const attributedMs = input.simMs + input.renderMs + input.terrainSyncMs + (recentLongTask ? input.longTaskMs : 0);
    const referenceMs = Math.max(input.gapMs, input.mainFrameMs);
    const unattributedMs = Math.max(0, referenceMs - attributedMs);
    const recentGpuMs = Math.max(input.gpuWorldMs ?? 0, input.gpuShadowRefreshMs ?? 0);
    const gpuBound =
      !recentLongTask &&
      input.mainFrameMs < hitchThresholdMs &&
      input.terrainSyncMs < hitchThresholdMs &&
      recentGpuMs >= Math.max(1, input.frameBudgetMs * 0.9);
    const dominant = recentLongTask
      ? "browser-long-task"
      : gpuBound
        ? "gpu-frame-pacing"
        : selectDominantContributor({
            sim: input.simMs,
            render: input.renderMs,
            terrain: input.terrainSyncMs,
            unattributed: unattributedMs
          });
    const links = [growthStore.get(input.nowMs)?.id, fireStore.get(input.nowMs)?.id, terrainStore.get(input.nowMs)?.id]
      .filter((value): value is string => !!value);
    hitchStore.set({ id, recordedAtMs: input.nowMs, kind: "hitch", input, dominant, unattributedMs, links });
    return {
      consoleLine:
        `[hitchprofile] id=${id} phase=${input.phase} year=${input.year} day=${input.careerDay.toFixed(2)} ` +
        `speed=${input.speed.toFixed(2)} mode=${input.simTimeMode} pauseFire=${input.pauseOnFireEvent ? 1 : 0} advance=${input.advancingToEvent ? 1 : 0} ` +
        `gap=${input.gapMs.toFixed(2)}ms main=${input.mainFrameMs.toFixed(2)}ms budget=${input.frameBudgetMs.toFixed(2)}ms ` +
        `sim=${input.simMs.toFixed(2)}ms render=${input.renderMs.toFixed(2)}ms terrain=${input.terrainSyncMs.toFixed(2)}ms ` +
        `gpu=${(input.gpuWorldMs ?? 0).toFixed(2)}/${(input.gpuShadowRefreshMs ?? 0).toFixed(2)}ms ` +
        `longTask=${input.longTaskMs.toFixed(2)}ms@${input.longTaskAgeMs.toFixed(0)}ms:${input.longTaskSource || "n/a"} ` +
        `unattributed=${unattributedMs.toFixed(2)}ms dominant=${dominant} links=${links.join(",") || "none"}`
    };
  };

  const captureGpu = (input: GpuProfileInput): RuntimeTelemetryCapture => {
    const id = `P${input.result.sequence}`;
    gpuStore.set({ id, recordedAtMs: input.nowMs, kind: "gpu", input });
    const baseline = input.result.measurements.find((entry) => entry.category === "baseline");
    const deltas = input.result.measurements
      .filter((entry) => entry.category !== "baseline")
      .map((entry) => `${entry.category}:${Math.max(0, (baseline?.gpuMs ?? entry.gpuMs) - entry.gpuMs).toFixed(2)}`)
      .join("/");
    return {
      consoleLine:
        `[gpuprofile] id=${id} status=${input.result.status} reason=${input.result.reason} phase=${input.phase} ` +
        `year=${input.year} day=${input.careerDay.toFixed(2)} speed=${input.speed.toFixed(2)} mode=${input.simTimeMode} ` +
        `baseline=${(baseline?.gpuMs ?? 0).toFixed(2)}ms calls=${baseline?.calls ?? 0} tri=${baseline?.triangles ?? 0} ` +
        `deltaMs=${deltas || "n/a"}`
    };
  };

  const formatOverlayLines = (nowMs: number): string[] => {
    const growth = growthStore.get(nowMs);
    const fire = fireStore.get(nowMs);
    const terrain = terrainStore.get(nowMs);
    const hitch = hitchStore.get(nowMs);
    const gpu = gpuStore.get(nowMs);
    const growthLine = growth
      ? `Event growth ${growth.id}: Y${growth.snapshot.year} ${formatMs(growth.snapshot.timingsMs.total)} mask/cache/scan ${formatMs(growth.snapshot.timingsMs.maskBuild)}/${formatMs(growth.snapshot.timingsMs.suitabilityCache)}/${formatMs(growth.snapshot.timingsMs.mutationScan)} changed a/f/r ${formatInt(growth.snapshot.agedTiles)}/${formatInt(growth.snapshot.fuelTilesChanged)}/${formatInt(growth.snapshot.forestExpandedTiles)}`
      : "Event growth: n/a";
    const fireLine = fire
      ? `Event fire ${fire.id}: ${formatMs(fire.snapshot.totalMs)} loop/wind ${formatMs(fire.snapshot.timingsMs.cellLoop)}/${formatMs(fire.snapshot.timingsMs.terrainWind)} active ${formatInt(fire.snapshot.activeFiresStart)}->${formatInt(fire.snapshot.activeFiresEnd)} ignite ${formatInt(fire.snapshot.ignitionCandidates)}/${formatInt(fire.snapshot.ignitionsCommitted)} tiles ${formatInt(fire.snapshot.processedTiles)} skip ${formatInt(fire.snapshot.inactiveTilesSkipped)}`
      : "Event fire: n/a";
    const terrainLine = terrain
      ? `Event terrain ${terrain.id}: ${formatMs(terrain.input.totalMs)} cause ${terrain.causeId ?? "none"} ${terrain.input.intent}/${terrain.input.path} hot ${terrain.input.dominantStep}`
      : "Event terrain: n/a";
    const hitchLine = hitch
      ? `Event hitch ${hitch.id}: ${formatMs(Math.max(hitch.input.gapMs, hitch.input.mainFrameMs))} dominant ${hitch.dominant} unattr ${formatMs(hitch.unattributedMs)} links ${hitch.links.join(",") || "none"}`
      : "Event hitch: n/a";
    const gpuLine = (() => {
      if (!gpu) return "Event GPU: n/a";
      const baseline = gpu.input.result.measurements.find((entry) => entry.category === "baseline");
      const leaders = gpu.input.result.measurements
        .filter((entry) => entry.category !== "baseline")
        .map((entry) => ({ category: entry.category, delta: Math.max(0, (baseline?.gpuMs ?? entry.gpuMs) - entry.gpuMs) }))
        .sort((a, b) => b.delta - a.delta)
        .slice(0, 2)
        .map((entry) => `${entry.category} ${formatMs(entry.delta)}`)
        .join(" / ");
      return `Event GPU ${gpu.id}: ${gpu.input.result.status} base ${formatMs(baseline?.gpuMs ?? 0)} top ${leaders || "n/a"}`;
    })();
    return [growthLine, fireLine, terrainLine, hitchLine, gpuLine];
  };

  return { clear, captureFire, captureGpu, captureGrowth, captureHitch, captureTerrainSync, formatOverlayLines };
};
