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

const BASE_STEP = 0.25;
const SIZE = 65;
const SPEEDS = [1, 20, 80];
const FRAMES = 18;
const MAX_FRAME_MS = 1200;
const MAX_FIRE_SUBSTEPS = 40;

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
    maxRangedSamples
  };
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
      `maxRanged=${result.maxRangedSamples}`
    ].join(" ")
  );
  assert.ok(result.maxFrameMs < MAX_FRAME_MS, `runtime frame exceeded ${MAX_FRAME_MS}ms at ${result.speed}x`);
  assert.ok(result.maxSubsteps <= MAX_FIRE_SUBSTEPS, `fire substep budget exceeded at ${result.speed}x`);
}

console.log("Runtime perf regression passed.");
