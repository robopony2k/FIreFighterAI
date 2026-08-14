import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { RNG } from "../dist/core/rng.js";
import { createInitialState, syncTileSoA } from "../dist/core/state.js";
import { PHASES } from "../dist/core/time.js";
import { applyFuel } from "../dist/core/tiles.js";
import { createEffectsState } from "../dist/core/effectsState.js";
import { markFireBlockActiveByTile } from "../dist/sim/fire/activeBlocks.js";
import { stepSim } from "../dist/sim/index.js";
import { applyFireActivityMetrics } from "../dist/systems/fire/sim/fireActivityState.js";
import { getLatestFireRuntimeTelemetry } from "../dist/systems/fire/controllers/fireRuntimeTelemetry.js";
import { getLatestAnnualVegetationGrowthTelemetry } from "../dist/systems/terrain/sim/annualVegetationGrowth.js";
import {
  createRuntimeTelemetryPresenter,
  selectDominantContributor
} from "../dist/ui/performance/runtimeTelemetryPresenter.js";
import { decideTerrainVisualSync } from "../dist/app/threeTestTerrainSync.js";

const BASE_STEP = 0.25;
const SIZE = 65;
const SPEEDS = [1, 10, 20];
const FRAMES = 18;
const MAX_FRAME_MS = 1200;
const MAX_FIRE_SUBSTEPS = 40;
const SPRING_SPEED = 20;
const SPRING_FRAMES = 12;
const MAX_SPRING_FRAME_MS = 300;
const MAX_SPRING_GROWTH_MS = 90;
const MAX_SPRING_TOWN_MS = 90;

const buildTile = (x, y) => {
  const ridge = Math.abs(x - y) < 5;
  return {
    type: ridge ? "forest" : "grass",
    fuel: 0,
    fire: 0,
    isBase: false,
    elevation: 0.16 + (ridge ? 0.08 : 0) + y / SIZE * 0.08,
    heat: 0,
    ignitionPoint: 0.8,
    burnRate: ridge ? 0.82 : 0.68,
    heatOutput: ridge ? 1.08 : 0.86,
    spreadBoost: ridge ? 1.08 : 0.92,
    heatTransferCap: 5,
    heatRetention: ridge ? 0.96 : 0.82,
    windFactor: ridge ? 0.38 : 0.18,
    moisture: ridge ? 0.16 : 0.24,
    waterDist: 12,
    vegetationAgeYears: ridge ? 22 : 3,
    canopy: ridge ? 0.58 : 0.12,
    canopyCover: ridge ? 0.58 : 0.12,
    stemDensity: ridge ? 6 : 1.4,
    dominantTreeType: null,
    treeType: null,
    houseValue: 0,
    houseResidents: 0,
    houseDestroyed: false,
    ashAge: 0
  };
};

const syncFireSeasonCursor = (state, careerDay) => {
  const yearDays = PHASES.reduce((sum, phase) => sum + phase.duration, 0);
  let remaining = ((careerDay % yearDays) + yearDays) % yearDays;
  state.careerDay = careerDay;
  state.year = Math.floor(careerDay / yearDays) + 1;
  for (let i = 0; i < PHASES.length; i += 1) {
    const phase = PHASES[i];
    if (remaining < phase.duration) {
      state.phaseIndex = i;
      state.phase = phase.id;
      state.phaseDay = remaining;
      return;
    }
    remaining -= phase.duration;
  }
};

const buildScenario = (speed) => {
  const seed = 7400 + speed;
  const grid = { cols: SIZE, rows: SIZE, totalTiles: SIZE * SIZE };
  const state = createInitialState(seed, grid);
  const rng = new RNG(seed ^ 0x9e3779b9);
  state.tiles = Array.from({ length: grid.totalTiles }, (_, idx) => {
    const x = idx % SIZE;
    const y = Math.floor(idx / SIZE);
    const tile = buildTile(x, y);
    applyFuel(tile, tile.moisture, rng);
    return tile;
  });
  syncTileSoA(state);
  syncFireSeasonCursor(state, 225);
  state.paused = false;
  state.simTimeMode = "strategic";
  state.timeSpeedIndex = 8;
  state.timeSpeedSliderValue = speed;
  state.fireSettings.ignitionChancePerDay = 0;
  state.wind = { name: "SW", dx: 0.72, dy: -0.68, strength: 0.82 };

  const center = Math.floor(SIZE / 2);
  const idx = center * SIZE + center;
  const tile = state.tiles[idx];
  tile.fire = 0.9;
  tile.heat = Math.max(tile.ignitionPoint * 2.5, 2.2);
  state.tileFire[idx] = tile.fire;
  state.tileHeat[idx] = tile.heat;
  state.tileHeatRelease[idx] = 0.7;
  markFireBlockActiveByTile(state, idx);
  state.lastActiveFires = 1;
  applyFireActivityMetrics(state, 1);
  return { state, effects: createEffectsState(), rng };
};

const pinGrowthWeather = (state) => {
  state.climateTemp = 22;
  state.climateMoisture = 0.55;
  state.climateDay = 365;
  state.climateYear = 0;
  state.seasonalRain = {
    ...state.seasonalRain,
    active: false,
    event: null,
    hasStartPauseHandled: true
  };
};

const buildSpringGrowthScenario = () => {
  const seed = 8801;
  const grid = { cols: SIZE, rows: SIZE, totalTiles: SIZE * SIZE };
  const state = createInitialState(seed, grid);
  const rng = new RNG(seed ^ 0x7f4a7c15);
  state.tiles = Array.from({ length: grid.totalTiles }, (_, idx) => {
    const x = idx % SIZE;
    const y = Math.floor(idx / SIZE);
    const tile = buildTile(x, y);
    tile.fire = 0;
    tile.heat = 0;
    applyFuel(tile, tile.moisture, rng);
    return tile;
  });
  syncTileSoA(state);
  syncFireSeasonCursor(state, 89);
  pinGrowthWeather(state);
  state.paused = false;
  state.simTimeMode = "strategic";
  state.timeSpeedIndex = 8;
  state.timeSpeedSliderValue = SPRING_SPEED;
  state.fireSettings.ignitionChancePerDay = 0;
  state.lastActiveFires = 0;
  applyFireActivityMetrics(state, 0);
  return { state, effects: createEffectsState(), rng };
};

const runScenario = (speed) => {
  const { state, effects, rng } = buildScenario(speed);
  let maxFrameMs = 0;
  let maxSubsteps = 0;
  let maxDeferredDays = 0;
  let maxRangedSamples = 0;
  for (let frame = 0; frame < FRAMES && !state.gameOver; frame += 1) {
    const startedAt = performance.now();
    stepSim(state, effects, rng, BASE_STEP * speed);
    maxFrameMs = Math.max(maxFrameMs, performance.now() - startedAt);
    maxSubsteps = Math.max(maxSubsteps, state.firePerfSubsteps);
    maxDeferredDays = Math.max(maxDeferredDays, state.firePerfDeferredDays);
    maxRangedSamples = Math.max(maxRangedSamples, state.firePerfRangedDiffusionSamples);
    if (state.paused) {
      state.paused = false;
    }
  }
  return {
    speed,
    burnedTiles: state.burnedTiles,
    activeFires: state.lastActiveFires,
    maxFrameMs,
    maxSubsteps,
    maxDeferredDays,
    maxRangedSamples,
    telemetry: getLatestFireRuntimeTelemetry(state)
  };
};

const runSpringGrowthScenario = () => {
  const { state, effects, rng } = buildSpringGrowthScenario();
  const initialStartedAt = performance.now();
  stepSim(state, effects, rng, BASE_STEP * SPRING_SPEED);
  const initialFrameMs = performance.now() - initialStartedAt;
  if (state.paused) {
    state.paused = false;
  }
  pinGrowthWeather(state);

  let maxFrameMs = initialFrameMs;
  let maxGrowthMs = state.simPerfGrowthMs;
  let maxTownConstructionMs = 0;
  let totalGrowthTilesScanned = state.simPerfGrowthTilesScanned;
  let totalGrowthFuelChanged = state.simPerfGrowthFuelTilesChanged;
  for (let frame = 0; frame < SPRING_FRAMES && !state.gameOver; frame += 1) {
    const startedAt = performance.now();
    stepSim(state, effects, rng, BASE_STEP * SPRING_SPEED);
    maxFrameMs = Math.max(maxFrameMs, performance.now() - startedAt);
    maxGrowthMs = Math.max(maxGrowthMs, state.simPerfGrowthMs);
    maxTownConstructionMs = Math.max(maxTownConstructionMs, state.simPerfTownConstructionMs);
    totalGrowthTilesScanned += state.simPerfGrowthTilesScanned;
    totalGrowthFuelChanged += state.simPerfGrowthFuelTilesChanged;
    if (state.paused) {
      state.paused = false;
    }
    pinGrowthWeather(state);
  }
  return {
    speed: SPRING_SPEED,
    maxFrameMs,
    maxGrowthMs,
    maxTownConstructionMs,
    totalGrowthTilesScanned,
    totalGrowthFuelChanged,
    phase: state.phase,
    careerDay: state.careerDay,
    telemetry: getLatestAnnualVegetationGrowthTelemetry(state)
  };
};

const runActiveFireVisualSyncScenario = () => {
  const previous = {
    terrainTypeRevision: 10,
    vegetationRevision: 20,
    structureRevision: 3,
    debugTypeColors: false
  };
  return decideTerrainVisualSync({
    previous,
    next: { ...previous },
    geometryTerrainChanged: false,
    activeFireTerrainPressure: true,
    activeFireVisualRefresh: true,
    nowMs: 5000,
    lastSyncMs: 0,
    cooldownMs: 0,
    fireVisualCooldownMs: 0,
    cameraInteracting: false
  });
};

const results = SPEEDS.map(runScenario);
for (const result of results) {
  console.log(
    [
      `speed=${result.speed}x`,
      `burned=${result.burnedTiles}`,
      `active=${result.activeFires}`,
      `maxFrameMs=${result.maxFrameMs.toFixed(1)}`,
      `maxSubsteps=${result.maxSubsteps}`,
      `maxDeferredDays=${result.maxDeferredDays.toFixed(2)}`,
      `maxRanged=${result.maxRangedSamples}`,
      `inactiveSkip=${result.telemetry?.inactiveTilesSkipped ?? 0}/${result.telemetry?.processedTiles ?? 0}`
    ].join(" ")
  );
  assert.ok(result.maxFrameMs < MAX_FRAME_MS, `runtime frame exceeded ${MAX_FRAME_MS}ms at ${result.speed}x`);
  assert.ok(result.maxSubsteps <= MAX_FIRE_SUBSTEPS, `fire substep budget exceeded at ${result.speed}x`);
  assert.ok(result.telemetry, `fire runtime telemetry missing at ${result.speed}x`);
  assert.ok(Number.isInteger(result.telemetry.substeps), "fire telemetry substeps should be integral");
  assert.ok(result.telemetry.activeFiresStart >= 0 && result.telemetry.activeFiresEnd >= 0, "fire telemetry active counts should be non-negative");
  assert.ok(result.telemetry.ignitionsCommitted <= result.telemetry.ignitionCandidates, "committed ignitions exceeded candidates");
  assert.ok(result.telemetry.processedTiles >= result.telemetry.burningTilesEvaluated, "burning visits exceeded processed tiles");
  assert.ok(
    result.telemetry.inactiveTilesSkipped >= 0 &&
      result.telemetry.inactiveTilesSkipped <= result.telemetry.processedTiles,
    "inactive fire skips must remain bounded by visited tiles"
  );
  assert.ok(result.telemetry.inactiveTilesSkipped > 0, "sparse fire work blocks should bypass inactive tile work");
  assert.ok(result.telemetry.maxSubstepMs <= result.telemetry.totalMs + 1, "max fire substep exceeded frame fire time");
  for (const [phase, duration] of Object.entries(result.telemetry.timingsMs)) {
    assert.ok(Number.isFinite(duration) && duration >= 0, `fire ${phase} timing should be finite and non-negative`);
  }
}

const springResult = runSpringGrowthScenario();
console.log(
  [
    `springSpeed=${springResult.speed}x`,
    `phase=${springResult.phase}`,
    `careerDay=${springResult.careerDay.toFixed(1)}`,
    `maxFrameMs=${springResult.maxFrameMs.toFixed(1)}`,
    `maxGrowthMs=${springResult.maxGrowthMs.toFixed(1)}`,
    `maxTownMs=${springResult.maxTownConstructionMs.toFixed(1)}`,
    `annualGrowthTiles=${springResult.totalGrowthTilesScanned}`,
    `growthFuelChanged=${springResult.totalGrowthFuelChanged}`
  ].join(" ")
);
assert.ok(springResult.totalGrowthTilesScanned > 0, "spring runtime scenario did not execute annual vegetation growth");
assert.ok(springResult.telemetry, "spring runtime scenario did not retain annual growth telemetry");
assert.ok(
  springResult.maxFrameMs < MAX_SPRING_FRAME_MS,
  `spring runtime frame exceeded ${MAX_SPRING_FRAME_MS}ms at ${SPRING_SPEED}x`
);
assert.ok(
  springResult.maxGrowthMs < MAX_SPRING_GROWTH_MS,
  `spring growth step exceeded ${MAX_SPRING_GROWTH_MS}ms at ${SPRING_SPEED}x`
);
assert.ok(
  springResult.maxTownConstructionMs < MAX_SPRING_TOWN_MS,
  `spring town construction step exceeded ${MAX_SPRING_TOWN_MS}ms at ${SPRING_SPEED}x`
);

const activeFireVisualDecision = runActiveFireVisualSyncScenario();
console.log(
  [
    `activeFireVisualSync=${activeFireVisualDecision.shouldSync ? "sync" : "skip"}`,
    `fireVisual=${activeFireVisualDecision.invalidation.fireVisual ? "yes" : "no"}`
  ].join(" ")
);
assert.equal(
  activeFireVisualDecision.shouldSync,
  false,
  "active fire visual pressure without terrain revisions must not request terrain sync"
);
assert.equal(
  activeFireVisualDecision.invalidation.fireVisual,
  false,
  "active fire visual pressure alone must not create fireVisual terrain invalidation"
);

const telemetryPresenter = createRuntimeTelemetryPresenter(45, 60_000);
const telemetryContext = {
  nowMs: 100,
  phase: "growth",
  year: 2,
  careerDay: 90,
  speed: 20,
  simTimeMode: "strategic",
  pauseOnFireEvent: true,
  advancingToEvent: false
};
const growthCapture = telemetryPresenter.captureGrowth(springResult.telemetry, telemetryContext);
assert.match(growthCapture.consoleLine ?? "", /^\[growthprofile\] id=G\d+ /, "growth profile prefix or event id changed");
const fireTelemetry = results.find((result) => result.telemetry?.activeFiresEnd > 0)?.telemetry ?? results[0].telemetry;
const fireCapture = telemetryPresenter.captureFire(fireTelemetry, {
  ...telemetryContext,
  nowMs: 101,
  phase: "fire",
  careerDay: 225
});
assert.match(fireCapture.consoleLine ?? "", /^\[fireprofile\] id=F\d+ /, "fire profile prefix or event id changed");
assert.match(
  fireCapture.consoleLine ?? "",
  /kernel=setup:[\d.]+\/wind:[\d.]+\/blocks:[\d.]+\/loop:[\d.]+\/ignite:[\d.]+\/final:[\d.]+ms/,
  "fire profile should expose named terrain-wind and kernel phase timings"
);
const terrainCapture = telemetryPresenter.captureTerrainSync({
  ...telemetryContext,
  nowMs: 102,
  totalMs: 150,
  sampleBuildMs: 10,
  terrainSetMs: 135,
  intent: "vegetation",
  path: "full",
  dominantStep: "fullBuild",
  fullRebuildReason: "fast-update-disabled",
  terrainTypeRevisionDelta: 0,
  vegetationRevisionDelta: 1,
  structureRevisionDelta: 0
});
assert.match(terrainCapture.consoleLine ?? "", /\[terrainsyncprofile\].*cause=G\d+/, "terrain profile did not link annual growth");
const delayedTelemetryPresenter = createRuntimeTelemetryPresenter(45, 60_000);
delayedTelemetryPresenter.captureGrowth(springResult.telemetry, telemetryContext);
const delayedTerrainCapture = delayedTelemetryPresenter.captureTerrainSync({
  ...telemetryContext,
  nowMs: 30_100,
  totalMs: 29_100,
  sampleBuildMs: 10,
  terrainSetMs: 29_080,
  intent: "mixed:surfaceColor+vegetation",
  path: "full",
  dominantStep: "fullBuild",
  fullRebuildReason: "full-sample",
  terrainTypeRevisionDelta: 1,
  vegetationRevisionDelta: 1,
  structureRevisionDelta: 0
});
assert.match(
  delayedTerrainCapture.consoleLine ?? "",
  /\[terrainsyncprofile\].*cause=G\d+/,
  "a slow terrain sync must retain its initiating growth link through the 60-second episode window"
);
const hitchCapture = telemetryPresenter.captureHitch({
  ...telemetryContext,
  nowMs: 103,
  gapMs: 175,
  mainFrameMs: 160,
  simMs: 8,
  renderMs: 2,
  terrainSyncMs: 140,
  frameBudgetMs: 16.67,
  gpuWorldMs: 12,
  gpuShadowRefreshMs: 12,
  longTaskMs: 0,
  longTaskAgeMs: Infinity,
  longTaskSource: "n/a"
});
assert.match(hitchCapture.consoleLine ?? "", /\[hitchprofile\].*dominant=terrain.*links=.*G\d+.*F\d+.*T\d+/, "hitch profile attribution or links changed");
assert.equal(
  selectDominantContributor({ sim: 8, render: 2, terrain: 140, unattributed: 25 }),
  "terrain",
  "dominant telemetry contributor selection changed"
);
const retainedOverlay = telemetryPresenter.formatOverlayLines(104);
assert.equal(retainedOverlay.length, 5, "runtime telemetry overlay should contain five compact event lines");
assert.ok(retainedOverlay.every((line) => line.startsWith("Event ")), "runtime telemetry overlay line format changed");
assert.match(retainedOverlay[1], /loop\/wind [\d.]+ms\/[\d.]+ms/, "fire overlay should lead with loop and wind timings");
const gpuBoundCapture = telemetryPresenter.captureHitch({
  ...telemetryContext,
  nowMs: 500,
  phase: "fire",
  gapMs: 52,
  mainFrameMs: 7,
  simMs: 0.5,
  renderMs: 8,
  terrainSyncMs: 0,
  frameBudgetMs: 16.67,
  gpuWorldMs: 23,
  gpuShadowRefreshMs: 0,
  longTaskMs: 0,
  longTaskAgeMs: Infinity,
  longTaskSource: "n/a"
});
assert.match(gpuBoundCapture.consoleLine ?? "", /dominant=gpu-frame-pacing/, "GPU-bound frame gap was not classified");
const browserTaskCapture = telemetryPresenter.captureHitch({
  ...telemetryContext,
  nowMs: 800,
  gapMs: 74,
  mainFrameMs: 8,
  simMs: 0.5,
  renderMs: 8,
  terrainSyncMs: 0,
  frameBudgetMs: 16.67,
  gpuWorldMs: 12,
  gpuShadowRefreshMs: 0,
  longTaskMs: 65,
  longTaskAgeMs: 20,
  longTaskSource: "self"
});
assert.match(browserTaskCapture.consoleLine ?? "", /dominant=browser-long-task/, "browser long task was not classified");
const gpuCapture = telemetryPresenter.captureGpu({
  ...telemetryContext,
  nowMs: 600,
  result: {
    sequence: 1,
    status: "complete",
    reason: "complete",
    completedAtMs: 599,
    measurements: [
      { category: "baseline", gpuMs: 24, calls: 1800, triangles: 7_000_000 },
      { category: "terrain", gpuMs: 10, calls: 400, triangles: 1_000_000 },
      { category: "fireFx", gpuMs: 20, calls: 1750, triangles: 6_800_000 }
    ]
  }
});
assert.match(gpuCapture.consoleLine ?? "", /^\[gpuprofile\].*deltaMs=terrain:14\.00\/fireFx:4\.00/, "GPU profile formatting changed");
assert.ok(
  telemetryPresenter.formatOverlayLines(60_801).every((line) => line.endsWith("n/a")),
  "runtime telemetry events should expire after the retention window"
);

console.log("Runtime perf regression passed.");
