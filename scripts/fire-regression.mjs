import { performance } from "node:perf_hooks";

import { DEFAULT_MOISTURE_PARAMS, VIRTUAL_CLIMATE_PARAMS, buildClimateTimeline } from "../dist/core/climate.js";
import { DEFAULT_FIRE_SETTINGS, INCIDENT_TIME_SPEED_OPTIONS } from "../dist/core/config.js";
import { createEffectsState } from "../dist/core/effectsState.js";
import { RNG } from "../dist/core/rng.js";
import { TILE_TYPE_IDS, createInitialState, syncTileSoA } from "../dist/core/state.js";
import { PHASES } from "../dist/core/time.js";
import { applyFuel } from "../dist/core/tiles.js";
import { buildSampleTypeMap } from "../dist/render/threeTestTerrain.js";
import {
  getStrategicFireSimulationStepCap,
  isAdvanceToNextEventAvailable,
  requestAdvanceToNextEvent,
  setPhase,
  stepSim
} from "../dist/sim/index.js";
import { getRuntimeSettings, setRuntimeSetting } from "../dist/persistence/runtimeSettings.js";
import { markFireBlockActiveByTile } from "../dist/sim/fire/activeBlocks.js";
import { stepFire } from "../dist/sim/fire.js";
import { isRandomIgnitionWeatherViable } from "../dist/sim/fire/fireWeather.js";
import { findIgnitionCandidate } from "../dist/sim/fire/ignite.js";
import { createUnit } from "../dist/sim/units.js";
import { applyFireActivityMetrics } from "../dist/systems/fire/sim/fireActivityState.js";
import { buildSeasonalRainEvent } from "../dist/systems/climate/sim/seasonalRain.js";
import {
  getElevationHeatTransferMultiplier,
  resolveTerrainAdjustedWind
} from "../dist/systems/fire/sim/fireTerrainInfluence.js";
import {
  getTerrainWindField,
  sampleTerrainWindAt
} from "../dist/systems/fire/sim/terrainWindField.js";
import {
  getPathWindbreakMultiplier,
  getRangedHeatTransferScale
} from "../dist/systems/fire/sim/fireRangedHeatDiffusion.js";
import { createLabTile } from "../dist/systems/fire/sim/fireSimLabScenario.js";

const YEAR_DAYS = 360;
const PHASE_DAYS = 90;
const BASE_STEP = 0.25;
const GRID_SIZE = 33;
const MAX_SCENARIO_STEPS = 4096;
const EXPOSURE_SEQUENCE_MAX_DAYS = 20;

const getCenter = (state) => Math.floor(state.grid.cols / 2);
const syncFireActivity = (state, activeFires = state.lastActiveFires) => applyFireActivityMetrics(state, activeFires);

const withRuntimeSetting = (key, value, run) => {
  const previous = getRuntimeSettings()[key];
  setRuntimeSetting(key, value);
  try {
    return run();
  } finally {
    setRuntimeSetting(key, previous);
  }
};

const createTile = (type, moisture) => ({
  type,
  fuel: 0,
  fire: 0,
  isBase: false,
  elevation: 0.15,
  heat: 0,
  ignitionPoint: 0.8,
  burnRate: 0.7,
  heatOutput: 1,
  spreadBoost: 1,
  heatTransferCap: 5,
  heatRetention: type === "bare" ? 0.45 : 0.95,
  windFactor: type === "bare" ? 0 : 0.35,
  moisture,
  waterDist: 12,
  vegetationAgeYears: type === "forest" ? 28 : 1.5,
  canopy: type === "forest" ? 0.6 : 0.05,
  canopyCover: type === "forest" ? 0.6 : 0.05,
  stemDensity: type === "forest" ? 7 : 1,
  dominantTreeType: null,
  treeType: null,
  houseValue: 0,
  houseResidents: 0,
  houseDestroyed: false,
  ashAge: 0
});

const resetTile = (tile, type, moisture, overrides = {}) => {
  Object.assign(tile, createTile(type, moisture), overrides);
};

const buildState = (seed, size = GRID_SIZE) => {
  const grid = { cols: size, rows: size, totalTiles: size * size };
  const state = createInitialState(seed, grid);
  const rng = new RNG(seed ^ 0x9e3779b9);
  const center = Math.floor(size / 2);
  state.basePoint = { x: Math.max(1, center - 4), y: center };
  state.totalLandTiles = (size - 2) * (size - 2);
  state.tiles = Array.from({ length: grid.totalTiles }, (_, index) => {
    const x = index % size;
    const y = Math.floor(index / size);
    const border = x === 0 || y === 0 || x === size - 1 || y === size - 1;
    const type = border ? "bare" : "forest";
    const moisture = type === "bare" ? 0.95 : 0.14;
    const tile = createTile(type, moisture);
    applyFuel(tile, moisture, rng);
    return tile;
  });
  syncTileSoA(state);
  state.climateTimeline = buildClimateTimeline(seed, 20, VIRTUAL_CLIMATE_PARAMS, DEFAULT_MOISTURE_PARAMS);
  state.climateTimelineSeed = seed;
  return { state, rng };
};

const setCareerCursor = (state, careerDay) => {
  const safeCareerDay = Math.max(0, careerDay);
  const dayInYear = ((safeCareerDay % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;
  const phaseIndex = Math.min(PHASES.length - 1, Math.floor(dayInYear / PHASE_DAYS));
  state.careerDay = safeCareerDay;
  state.year = Math.floor(safeCareerDay / YEAR_DAYS) + 1;
  state.phaseIndex = phaseIndex;
  state.phase = PHASES[phaseIndex].id;
  state.phaseDay = dayInYear - phaseIndex * PHASE_DAYS;
  state.fireSeasonDay = safeCareerDay;
  state.climateDay = 0;
  state.climateYear = 0;
  state.climateMoisture = DEFAULT_MOISTURE_PARAMS.Mmax;
  state.lastActiveFires = 0;
  state.fireBoundsActive = false;
  syncFireActivity(state, 0);
};

const igniteCenter = (state) => {
  const center = getCenter(state);
  const idx = center * state.grid.cols + center;
  const tile = state.tiles[idx];
  tile.fire = 0.9;
  tile.heat = Math.max(tile.ignitionPoint * 2.4, 2.2);
  state.tileFire[idx] = tile.fire;
  state.tileHeat[idx] = tile.heat;
  state.lastActiveFires = 1;
  state.fireBoundsActive = true;
  state.fireMinX = center - 1;
  state.fireMaxX = center + 1;
  state.fireMinY = center - 1;
  state.fireMaxY = center + 1;
  markFireBlockActiveByTile(state, idx);
  syncFireActivity(state, 1, 0);
  return idx;
};

const seedAlertIncident = (state) => {
  const idx = igniteCenter(state);
  state.lastActiveFires = 0;
  state.fireBoundsActive = false;
  state.fireMinX = 0;
  state.fireMaxX = 0;
  state.fireMinY = 0;
  state.fireMaxY = 0;
  state.simTimeMode = "strategic";
  state.timeSpeedIndex = state.strategicTimeSpeedIndex;
  state.paused = false;
  state.latestFireAlert = null;
  syncFireActivity(state, 0);
  return idx;
};

const seedExposureIncident = (state) => {
  const center = getCenter(state);
  const sourceIdx = center * state.grid.cols + center;
  const targetIdx = center * state.grid.cols + (center + 1);
  for (let y = center - 1; y <= center + 1; y += 1) {
    for (let x = center - 1; x <= center + 1; x += 1) {
      const ringIdx = y * state.grid.cols + x;
      const tile = state.tiles[ringIdx];
      if (x === center && y === center) {
        resetTile(tile, "grass", 0.18, {
          fuel: 0.82,
          heat: 2.35,
          fire: 0.74,
          burnRate: 0.7,
          heatOutput: 0.92,
          spreadBoost: 0.98,
          heatTransferCap: 3.2,
          heatRetention: 0.72,
          windFactor: 0.42
        });
        continue;
      }
      if (x === center + 1 && y === center) {
        resetTile(tile, "grass", 0.22, {
          fuel: 0.68,
          fire: 0,
          heat: 0.42,
          burnRate: 0.75,
          heatOutput: 0.78,
          spreadBoost: 0.9,
          heatTransferCap: 2.8,
          heatRetention: 0.62,
          windFactor: 0.48
        });
        continue;
      }
      resetTile(tile, "bare", 0.98, {
        fuel: 0.01,
        fire: 0,
        heat: 0,
        burnRate: 0.2,
        heatOutput: 0,
        spreadBoost: 0,
        heatTransferCap: 0.8,
        heatRetention: 0.28,
        windFactor: 0
      });
    }
  }
  syncTileSoA(state);
  state.tileFire[sourceIdx] = state.tiles[sourceIdx].fire;
  state.tileHeat[sourceIdx] = state.tiles[sourceIdx].heat;
  state.tileFuel[sourceIdx] = state.tiles[sourceIdx].fuel;
  state.tileBurnAge[sourceIdx] = 0.18;
  state.tileHeatRelease[sourceIdx] = 0.32;
  state.tileFire[targetIdx] = state.tiles[targetIdx].fire;
  state.tileHeat[targetIdx] = state.tiles[targetIdx].heat;
  state.tileFuel[targetIdx] = state.tiles[targetIdx].fuel;
  state.tileBurnAge[targetIdx] = 0;
  state.tileHeatRelease[targetIdx] = 0;
  state.lastActiveFires = 1;
  state.fireBoundsActive = true;
  state.fireMinX = center - 1;
  state.fireMaxX = center + 1;
  state.fireMinY = center - 1;
  state.fireMaxY = center + 1;
  state.simTimeMode = "incident";
  state.timeSpeedIndex = state.incidentTimeSpeedIndex;
  state.paused = false;
  state.latestFireAlert = {
    id: state.nextFireAlertId++,
    tileX: center,
    tileY: center,
    townId: -1,
    year: state.year,
    careerDay: state.careerDay,
    phaseDay: state.phaseDay
  };
  markFireBlockActiveByTile(state, sourceIdx);
  markFireBlockActiveByTile(state, targetIdx);
  syncFireActivity(state, 1);
  return { sourceIdx, targetIdx };
};

const stepWithRuntimeCap = (state, effects, rng, requestedDelta) => {
  const cap = getStrategicFireSimulationStepCap(state);
  const appliedDelta = cap !== null && Number.isFinite(cap) && cap > 0
    ? Math.min(requestedDelta, cap)
    : requestedDelta;
  stepSim(state, effects, rng, appliedDelta);
  return { cap, appliedDelta };
};

const captureDistinctActivitySequence = (state, transitions) => {
  const nextState = state.fireActivityState;
  if (transitions.length <= 0 || transitions[transitions.length - 1] !== nextState) {
    transitions.push(nextState);
  }
};

const runExposureSequence = (speed) => {
  const { state, rng } = buildState(3904);
  const effects = createEffectsState();
  setCareerCursor(state, 225);
  state.fireSettings.ignitionChancePerDay = 0;
  seedExposureIncident(state);
  const transitions = [];
  captureDistinctActivitySequence(state, transitions);
  let pauseResumes = 0;
  const maxCareerDay = state.careerDay + EXPOSURE_SEQUENCE_MAX_DAYS;
  while (state.careerDay < maxCareerDay && state.fireActivityState !== "idle" && !state.gameOver) {
    stepSim(state, effects, rng, BASE_STEP * speed);
    captureDistinctActivitySequence(state, transitions);
    if (state.paused && state.fireActivityState !== "idle") {
      pauseResumes += 1;
      state.paused = false;
    }
  }
  return {
    speed,
    transitions,
    paused: state.paused,
    pauseResumes,
    mode: state.simTimeMode,
    finalActivityState: state.fireActivityState,
    finalActivityCount: state.fireActivityCount,
    finalActiveFires: state.lastActiveFires
  };
};

const runSlowIncidentCrawlScenario = () => {
  const { state, rng } = buildState(3906);
  const effects = createEffectsState();
  setCareerCursor(state, 225);
  state.fireSettings.ignitionChancePerDay = 0;
  const { sourceIdx, targetIdx } = seedExposureIncident(state);
  state.tiles[targetIdx].fire = 0;
  state.tiles[targetIdx].heat = 0;
  state.tileFire[targetIdx] = 0;
  state.tileHeat[targetIdx] = 0;
  state.tileBurnAge[targetIdx] = 0;
  state.tileHeatRelease[targetIdx] = 0;
  const slowestIncidentSpeed = INCIDENT_TIME_SPEED_OPTIONS[0] ?? 0.015625;
  for (let step = 0; step < 4; step += 1) {
    stepSim(state, effects, rng, BASE_STEP * slowestIncidentSpeed);
  }
  return {
    activeFires: state.lastActiveFires,
    activityState: state.fireActivityState,
    sourceFire: state.tileFire[sourceIdx],
    targetFire: state.tileFire[targetIdx],
    targetHeat: state.tileHeat[targetIdx],
    burnedTiles: state.burnedTiles
  };
};

const addSupportTruck = (state, rng) => {
  const center = getCenter(state);
  const truck = createUnit(state, "truck", rng, null);
  truck.x = center - 2.5;
  truck.y = center + 0.5;
  truck.prevX = truck.x;
  truck.prevY = truck.y;
  truck.autonomous = false;
  truck.attackTarget = { x: center + 0.5, y: center + 0.5 };
  state.units.push(truck);
  return truck;
};

const runScenario = ({ seed, startDay, speed, durationDays, withTruck = false, size = GRID_SIZE }) => {
  const { state, rng } = buildState(seed, size);
  const effects = createEffectsState();
  setCareerCursor(state, startDay);
  state.fireSettings.ignitionChancePerDay = 0;
  igniteCenter(state);
  if (withTruck) {
    addSupportTruck(state, rng);
  }
  const simDelta = BASE_STEP * speed;
  const endDay = state.careerDay + durationDays;
  let extinguishedDay = null;
  let maxSubsteps = 0;
  let maxActiveBlocks = 0;
  let steps = 0;
  let pauseResumes = 0;
  let stalled = false;
  let stalledReason = "";
  const startedAt = performance.now();
  while (state.careerDay < endDay && !state.gameOver) {
    if (steps >= MAX_SCENARIO_STEPS) {
      stalled = true;
      stalledReason = `scenario exceeded ${MAX_SCENARIO_STEPS} steps`;
      break;
    }
    stepSim(state, effects, rng, simDelta);
    steps += 1;
    maxSubsteps = Math.max(maxSubsteps, state.firePerfSubsteps);
    maxActiveBlocks = Math.max(maxActiveBlocks, state.firePerfActiveBlocks);
    if (state.paused && state.careerDay < endDay && !state.gameOver) {
      pauseResumes += 1;
      state.paused = false;
    }
    if (
      extinguishedDay === null &&
      state.fireActivityState === "idle" &&
      !state.fireBoundsActive
    ) {
      extinguishedDay = state.careerDay;
    }
  }
  const elapsedMs = performance.now() - startedAt;
  return {
    startDay,
    speed,
    durationDays,
    withTruck,
    burnedTiles: state.burnedTiles,
    endActiveFires: state.lastActiveFires,
    extinguishedDay,
    maxSubsteps,
    maxActiveBlocks,
    elapsedMs,
    steps,
    pauseResumes,
    stalled,
    stalledReason
  };
};

const runSeasonalRainClearScenario = () => {
  const seed = 8821;
  const { state, rng } = buildState(seed);
  const effects = createEffectsState();
  const rain = buildSeasonalRainEvent(seed, 0);
  setCareerCursor(state, rain.extinguishDayOfYear - 2);
  state.fireSettings.ignitionChancePerDay = 0;
  const idx = igniteCenter(state);
  state.fireSnapshot[idx] = state.tileFire[idx];
  state.scoring.prevFireBoundsActive = true;
  state.scoring.prevFireMinX = state.fireMinX;
  state.scoring.prevFireMaxX = state.fireMaxX;
  state.scoring.prevFireMinY = state.fireMinY;
  state.scoring.prevFireMaxY = state.fireMaxY;
  stepSim(state, effects, rng, 1);
  const creditedEvents = state.scoring.events.filter((event) => event.lane === "extinguished");
  const fireFlowEvents = state.scoring.flowEvents.filter(
    (event) => event.kind === "extinguished" || event.kind === "decay"
  );
  return {
    rain,
    activeFires: state.lastActiveFires,
    centerFire: state.tileFire[idx],
    centerHeat: state.tileHeat[idx],
    hasExtinguished: state.seasonalRain.hasExtinguished,
    creditedEvents: creditedEvents.length,
    fireFlowEvents: fireFlowEvents.length,
    seasonExtinguishedCount: state.scoring.seasonExtinguishedCount,
    seasonExtinguishPoints: state.scoring.seasonExtinguishPoints
  };
};

const runSingleTargetElevationSpread = (targetElevation) => {
  const { state, rng } = buildState(8850);
  const effects = createEffectsState();
  const center = getCenter(state);
  const sourceIdx = center * state.grid.cols + center;
  const targetIdx = center * state.grid.cols + center + 1;
  setCareerCursor(state, 225);
  state.fireSettings.ignitionChancePerDay = 0;
  state.wind = { name: "calm", dx: 0, dy: 0, strength: 0 };
  for (let y = center - 2; y <= center + 2; y += 1) {
    for (let x = center - 2; x <= center + 3; x += 1) {
      const idx = y * state.grid.cols + x;
      resetTile(state.tiles[idx], "bare", 0.98, {
        elevation: 0.5,
        fuel: 0,
        heat: 0,
        fire: 0,
        spreadBoost: 0,
        heatOutput: 0,
        windFactor: 0
      });
    }
  }
  resetTile(state.tiles[sourceIdx], "grass", 0.16, {
    elevation: 0.5,
    fuel: 0.9,
    fire: 0.82,
    heat: 2.4,
    burnRate: 0.58,
    heatOutput: 1.05,
    spreadBoost: 1,
    heatTransferCap: 4,
    heatRetention: 0.88,
    windFactor: 0
  });
  resetTile(state.tiles[targetIdx], "grass", 0.16, {
    elevation: targetElevation,
    fuel: 0.9,
    fire: 0,
    heat: 0,
    ignitionPoint: 3.8,
    burnRate: 0.58,
    heatOutput: 1.05,
    spreadBoost: 1,
    heatTransferCap: 4,
    heatRetention: 0.88,
    windFactor: 0
  });
  syncTileSoA(state);
  state.tileBurnAge[sourceIdx] = 0.2;
  state.tileHeatRelease[sourceIdx] = 0.3;
  state.lastActiveFires = 1;
  state.fireBoundsActive = true;
  state.fireMinX = center - 1;
  state.fireMaxX = center + 2;
  state.fireMinY = center - 1;
  state.fireMaxY = center + 1;
  state.simTimeMode = "incident";
  state.timeSpeedIndex = state.incidentTimeSpeedIndex;
  state.paused = false;
  markFireBlockActiveByTile(state, sourceIdx);
  syncFireActivity(state, 1);
  stepFire(state, effects, rng, BASE_STEP, 1, 1);
  return {
    targetHeat: state.tileHeat[targetIdx],
    targetFire: state.tileFire[targetIdx]
  };
};

const EXTREME_GAP_WEATHER = {
  careerDay: 0,
  climateDayOfYear: 225,
  climateYearIndex: 12,
  climateRisk: 0.92,
  climateTemp: 42,
  climateMoisture: 0.08,
  climateIgnitionMultiplier: 1.85,
  climateSpreadMultiplier: 1.7,
  seasonIndex: 2,
  ignition: 1.35,
  spread: 1.55,
  sustain: 1.2,
  cooling: 0.72,
  suppression: 0.92,
  effectiveAmbient: 42
};

const CALM_GAP_WEATHER = {
  ...EXTREME_GAP_WEATHER,
  climateRisk: 0.25,
  climateTemp: 22,
  climateMoisture: 0.5,
  climateIgnitionMultiplier: 0.75,
  climateSpreadMultiplier: 0.75,
  ignition: 0.72,
  spread: 0.82,
  sustain: 0.72,
  cooling: 1.35,
  effectiveAmbient: 22
};

const prepareGapJumpState = (gapTiles, mode = "extreme") => {
  const { state, rng } = buildState(9100 + gapTiles + (mode === "explicit-30m" ? 100 : 0), 19);
  const effects = createEffectsState();
  const centerY = getCenter(state);
  const sourceX = 5;
  const targetX = sourceX + gapTiles + 1;
  const sourceIdx = centerY * state.grid.cols + sourceX;
  const targetIdx = centerY * state.grid.cols + targetX;
  setCareerCursor(state, 225);
  state.fireSettings = {
    ...DEFAULT_FIRE_SETTINGS,
    ignitionChancePerDay: 0,
    diffusionSecondary: mode === "explicit-30m" ? 0.52 : DEFAULT_FIRE_SETTINGS.diffusionSecondary,
    rangedDiffusionMaxTiles: mode === "explicit-30m" ? 4 : DEFAULT_FIRE_SETTINGS.rangedDiffusionMaxTiles,
    rangedDiffusionThreeTileThreshold:
      mode === "explicit-30m" ? 0.62 : DEFAULT_FIRE_SETTINGS.rangedDiffusionThreeTileThreshold,
    rangedDiffusionDistanceFalloff:
      mode === "explicit-30m" ? 0.72 : DEFAULT_FIRE_SETTINGS.rangedDiffusionDistanceFalloff
  };
  state.wind =
    mode === "calm"
      ? { name: "calm", dx: 1, dy: 0, strength: 0.2 }
      : { name: "extreme-east", dx: 1, dy: 0, strength: mode === "explicit-30m" ? 0.95 : 0.82 };

  for (let y = centerY - 2; y <= centerY + 2; y += 1) {
    for (let x = sourceX - 2; x <= targetX + 2; x += 1) {
      const idx = y * state.grid.cols + x;
      resetTile(state.tiles[idx], "bare", 0.95, {
        elevation: 0.2,
        fuel: 0,
        fire: 0,
        heat: 0,
        ignitionPoint: 9,
        burnRate: 0,
        heatOutput: 0,
        spreadBoost: 0,
        heatTransferCap: 0,
        heatRetention: 0.35,
        windFactor: 0
      });
    }
  }
  for (let x = sourceX + 1; x < targetX; x += 1) {
    resetTile(state.tiles[centerY * state.grid.cols + x], "road", 0.95, {
      fuel: 0,
      fire: 0,
      heat: 0,
      ignitionPoint: 9,
      burnRate: 0,
      heatOutput: 0,
      spreadBoost: 0,
      heatTransferCap: 0,
      heatRetention: 0.35,
      windFactor: 0
    });
  }
  resetTile(state.tiles[sourceIdx], "grass", 0.06, {
    fuel: 2,
    fire: 0.96,
    heat: 4.4,
    ignitionPoint: 0.22,
    burnRate: 0.2,
    heatOutput: 2.15,
    spreadBoost: 1.55,
    heatTransferCap: 5,
    heatRetention: 0.94,
    windFactor: 0
  });
  resetTile(state.tiles[targetIdx], "grass", mode === "calm" ? 0.5 : 0.08, {
    fuel: 1.2,
    fire: 0,
    heat: 0,
    ignitionPoint: mode === "explicit-30m" ? 0.28 : 0.32,
    burnRate: 0.45,
    heatOutput: 1,
    spreadBoost: 1,
    heatTransferCap: 5,
    heatRetention: 0.9,
    windFactor: 0
  });
  syncTileSoA(state);
  state.tileBurnAge[sourceIdx] = 0.35;
  state.lastActiveFires = 1;
  state.fireBoundsActive = true;
  state.fireMinX = sourceX - 1;
  state.fireMaxX = targetX + 1;
  state.fireMinY = centerY - 1;
  state.fireMaxY = centerY + 1;
  state.simTimeMode = "incident";
  state.timeSpeedIndex = state.incidentTimeSpeedIndex;
  state.paused = false;
  markFireBlockActiveByTile(state, sourceIdx);
  syncFireActivity(state, 1);
  return { state, rng, effects, sourceIdx, targetIdx };
};

const runGapJumpScenario = (gapTiles, mode = "extreme") => {
  const context = prepareGapJumpState(gapTiles, mode);
  const weather = mode === "calm" ? CALM_GAP_WEATHER : EXTREME_GAP_WEATHER;
  for (let step = 0; step < 96; step += 1) {
    stepFire(context.state, context.effects, context.rng, BASE_STEP, 1.15, 1, 0, weather, weather.climateIgnitionMultiplier);
    if (context.state.tileFire[context.targetIdx] > 0.02) {
      break;
    }
  }
  return {
    gapTiles,
    mode,
    targetHeat: context.state.tileHeat[context.targetIdx],
    targetFire: context.state.tileFire[context.targetIdx],
    sourceFuel: context.state.tileFuel[context.sourceIdx]
  };
};

const runMatchedFuelTypeSpread = (type) => {
  const { state, rng } = buildState(9400, 17);
  const effects = createEffectsState();
  const center = getCenter(state);
  const sourceIdx = center * state.grid.cols + center;
  const targetIdx = center * state.grid.cols + center + 1;
  setCareerCursor(state, 225);
  state.fireSettings = { ...DEFAULT_FIRE_SETTINGS, ignitionChancePerDay: 0, diffusionSecondary: 0 };
  state.wind = { name: "east", dx: 1, dy: 0, strength: 0.7 };
  for (let y = center - 2; y <= center + 2; y += 1) {
    for (let x = center - 2; x <= center + 3; x += 1) {
      const idx = y * state.grid.cols + x;
      resetTile(state.tiles[idx], "bare", 0.95, {
        fuel: 0,
        fire: 0,
        heat: 0,
        ignitionPoint: 9,
        burnRate: 0,
        heatOutput: 0,
        spreadBoost: 0,
        heatTransferCap: 0,
        heatRetention: 0.35,
        windFactor: 0
      });
    }
  }
  const sharedProfile = {
    fuel: 1.1,
    ignitionPoint: 0.34,
    burnRate: 0.52,
    heatOutput: 1.08,
    spreadBoost: 1.02,
    heatTransferCap: 4,
    heatRetention: 0.82,
    windFactor: 0.35,
    moisture: 0.12
  };
  resetTile(state.tiles[sourceIdx], type, sharedProfile.moisture, {
    ...sharedProfile,
    fire: 0.82,
    heat: 2.9
  });
  resetTile(state.tiles[targetIdx], type, sharedProfile.moisture, {
    ...sharedProfile,
    fire: 0,
    heat: 0
  });
  syncTileSoA(state);
  state.tileBurnAge[sourceIdx] = 0.2;
  state.lastActiveFires = 1;
  state.fireBoundsActive = true;
  state.fireMinX = center - 1;
  state.fireMaxX = center + 2;
  state.fireMinY = center - 1;
  state.fireMaxY = center + 1;
  state.simTimeMode = "incident";
  state.timeSpeedIndex = state.incidentTimeSpeedIndex;
  state.paused = false;
  markFireBlockActiveByTile(state, sourceIdx);
  syncFireActivity(state, 1);
  stepFire(state, effects, rng, BASE_STEP, 1, 1, 0, EXTREME_GAP_WEATHER, EXTREME_GAP_WEATHER.climateIgnitionMultiplier);
  return {
    targetHeat: state.tileHeat[targetIdx],
    targetFire: state.tileFire[targetIdx],
    sourceHeat: state.tileHeat[sourceIdx],
    sourceFire: state.tileFire[sourceIdx]
  };
};

const printScenarioGroup = (label, scenarios) => {
  console.log(`\n${label}`);
  scenarios.forEach((scenario) => {
    const extinguished = scenario.extinguishedDay === null ? "none" : scenario.extinguishedDay.toFixed(2);
    console.log(
      [
        `speed=${scenario.speed}x`,
        `start=${scenario.startDay}`,
        `burned=${scenario.burnedTiles}`,
        `endActive=${scenario.endActiveFires}`,
        `extinguished=${extinguished}`,
        `maxSubsteps=${scenario.maxSubsteps}`,
        `maxBlocks=${scenario.maxActiveBlocks}`,
        `elapsedMs=${scenario.elapsedMs.toFixed(1)}`,
        `steps=${scenario.steps}`,
        `pauseResumes=${scenario.pauseResumes}`,
        `stalled=${scenario.stalled ? scenario.stalledReason : "no"}`
      ].join(" ")
    );
  });
};

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) {
    return Number.NaN;
  }
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return (sorted[middle - 1] + sorted[middle]) * 0.5;
};

const failures = [];

{
  const settings = getRuntimeSettings();
  console.log(
    `\nRuntime Event Pause Defaults\nfire=${settings.pauseOnFireEvent ? 1 : 0} annual=${settings.pauseOnAnnualReportEvent ? 1 : 0} rain=${settings.pauseOnRainEvent ? 1 : 0}`
  );
  if (!settings.pauseOnFireEvent || !settings.pauseOnAnnualReportEvent || !settings.pauseOnRainEvent) {
    failures.push("Runtime event pause toggles should default to enabled.");
  }
}

{
  const lowRiskWeather = {
    climateRisk: 0.59,
    ignition: 1.05,
    spread: 1.1,
    sustain: 1.0,
    cooling: 1.0
  };
  const viableWeather = {
    climateRisk: 0.65,
    ignition: 0.9,
    spread: 1.0,
    sustain: 0.9,
    cooling: 1.1
  };
  console.log(
    `\nRandom Ignition Weather Viability\nlow=${isRandomIgnitionWeatherViable(lowRiskWeather) ? 1 : 0} viable=${isRandomIgnitionWeatherViable(viableWeather) ? 1 : 0}`
  );
  if (isRandomIgnitionWeatherViable(lowRiskWeather)) {
    failures.push("Low-risk weather passed random ignition viability.");
  }
  if (!isRandomIgnitionWeatherViable(viableWeather)) {
    failures.push("Viable weather failed random ignition viability.");
  }
}

{
  const settings = { ...DEFAULT_FIRE_SETTINGS };
  const flatMultiplier = getElevationHeatTransferMultiplier(0.42, 0.42, 1, settings);
  const uphillMultiplier = getElevationHeatTransferMultiplier(0.42, 0.62, 1, settings);
  const downhillMultiplier = getElevationHeatTransferMultiplier(0.42, 0.22, 1, settings);
  const steepUphillMultiplier = getElevationHeatTransferMultiplier(0.1, 0.95, 1, settings);
  const steepDownhillMultiplier = getElevationHeatTransferMultiplier(0.95, 0.1, 1, settings);
  console.log(
    `\nElevation Spread Multipliers\nflat=${flatMultiplier.toFixed(3)} uphill=${uphillMultiplier.toFixed(3)} downhill=${downhillMultiplier.toFixed(3)} steepUp=${steepUphillMultiplier.toFixed(3)} steepDown=${steepDownhillMultiplier.toFixed(3)}`
  );
  if (flatMultiplier !== 1) {
    failures.push("Flat elevation changed heat transfer.");
  }
  if (!(uphillMultiplier > 1 && downhillMultiplier < 1)) {
    failures.push("Elevation heat transfer did not boost uphill and penalize downhill spread.");
  }
  if (
    steepUphillMultiplier > settings.elevationSpreadMaxBoost ||
    steepDownhillMultiplier < settings.elevationSpreadMaxPenalty
  ) {
    failures.push("Elevation heat-transfer clamp was not enforced.");
  }

  const uphillSpread = runSingleTargetElevationSpread(0.7);
  const downhillSpread = runSingleTargetElevationSpread(0.3);
  console.log(
    `Elevation Spread Integration\nuphillHeat=${uphillSpread.targetHeat.toFixed(3)} downhillHeat=${downhillSpread.targetHeat.toFixed(3)} uphillFire=${uphillSpread.targetFire.toFixed(3)} downhillFire=${downhillSpread.targetFire.toFixed(3)}`
  );
  if (!(uphillSpread.targetHeat > downhillSpread.targetHeat * 1.08)) {
    failures.push("Integrated fire spread did not deliver more heat uphill than downhill.");
  }
}

{
  const labGrass = createLabTile("grass");
  const labWater = createLabTile("water");
  console.log(`\nSIM Lab Elevation\nwater=${labWater.elevation.toFixed(3)} grass=${labGrass.elevation.toFixed(3)}`);
  if (labWater.elevation !== labGrass.elevation) {
    failures.push("SIM Lab tiles should remain flat for elevation-aware fire spread.");
  }
}

{
  const settings = { ...DEFAULT_FIRE_SETTINGS };
  const cols = 17;
  const rows = 17;
  const centerX = 8;
  const centerY = 8;
  const centerIdx = centerY * cols + centerX;
  const sample = new Float32Array(cols * rows);
  sample.fill(0.5);
  const out = { dx: 0, dy: 0, strength: 0 };
  const setElev = (x, y, value) => {
    sample[y * cols + x] = value;
  };

  resolveTerrainAdjustedWind(centerX, centerY, centerIdx, cols, rows, sample, 1, 0, 1, settings, out);
  const flatStrength = out.strength;
  const flatDy = out.dy;

  sample.fill(0.5);
  [1, 2, 4, 7].forEach((r) => setElev(centerX + r, centerY, 0.82));
  [1, 2, 4, 7].forEach((r) => setElev(centerX + r, centerY + Math.max(1, Math.round(r * 0.75)), 0.88));
  resolveTerrainAdjustedWind(centerX, centerY, centerIdx, cols, rows, sample, 1, 0, 1, settings, out);
  const ridgeStrength = out.strength;
  const ridgeDy = out.dy;

  sample.fill(0.5);
  [1, 2, 4, 7].forEach((r) => setElev(centerX + r, centerY, 0.28));
  resolveTerrainAdjustedWind(centerX, centerY, centerIdx, cols, rows, sample, 1, 0, 1, settings, out);
  const descendingStrength = out.strength;

  sample.fill(0.5);
  [1, 2, 4, 7].forEach((r) => setElev(centerX, centerY + r, 0.9));
  resolveTerrainAdjustedWind(centerX, centerY, centerIdx, cols, rows, sample, 1, 0, 1, settings, out);
  const steeredDy = out.dy;

  sample.fill(0.5);
  [1, 2, 4, 7].forEach((r) => setElev(centerX + r, centerY, 0.24));
  [1, 2, 4, 7].forEach((r) => {
    setElev(centerX, centerY - r, 0.82);
    setElev(centerX, centerY + r, 0.82);
    setElev(centerX + r, centerY - Math.max(1, Math.round(r * 0.75)), 0.82);
    setElev(centerX + r, centerY + Math.max(1, Math.round(r * 0.75)), 0.82);
  });
  resolveTerrainAdjustedWind(centerX, centerY, centerIdx, cols, rows, sample, 1, 0, 1, settings, out);
  const corridorStrength = out.strength;
  const corridorDy = out.dy;

  sample.fill(0.5);
  [1, 2, 4, 7].forEach((r) => {
    setElev(centerX + r, centerY, 1.4);
    setElev(centerX, centerY + r, 1.4);
    setElev(centerX + r, centerY + Math.max(1, Math.round(r * 0.75)), 1.4);
  });
  resolveTerrainAdjustedWind(centerX, centerY, centerIdx, cols, rows, sample, 1, 0, 1, settings, out);
  const clampedStrength = out.strength;
  const clampedDot = out.dx / Math.max(0.0001, Math.hypot(out.dx, out.dy));

  console.log(
    `Terrain Wind\nflat=${flatStrength.toFixed(3)} ridge=${ridgeStrength.toFixed(3)} ridgeDy=${ridgeDy.toFixed(3)} descending=${descendingStrength.toFixed(3)} steeredDy=${steeredDy.toFixed(3)} corridor=${corridorStrength.toFixed(3)} corridorDy=${corridorDy.toFixed(3)} clamp=${clampedStrength.toFixed(3)}`
  );
  if (Math.abs(flatStrength - 1) > 0.0001 || Math.abs(flatDy) > 0.0001) {
    failures.push("Flat terrain changed ambient wind.");
  }
  if (!(ridgeStrength < flatStrength && Math.abs(ridgeDy) > 0.015)) {
    failures.push("Broad downwind ridge did not slow and deflect local wind.");
  }
  if (!(descendingStrength > flatStrength)) {
    failures.push("Lower downwind terrain did not preserve or increase effective wind strength.");
  }
  if (Math.abs(steeredDy) <= 0.01) {
    failures.push("Side terrain imbalance did not steer local wind direction.");
  }
  if (!(corridorStrength > flatStrength)) {
    failures.push("Low corridor with raised sides did not increase effective wind strength.");
  }
  if (Math.abs(corridorDy) > 0.015) {
    failures.push("Symmetric valley corridor should channel wind without lateral drift.");
  }
  if (
    clampedStrength < settings.terrainWindSpeedMin ||
    clampedStrength > settings.terrainWindSpeedMax ||
    clampedDot < 0.7
  ) {
    failures.push("Terrain wind adjustment did not respect speed and direction clamps.");
  }
}

{
  const buildWindWorld = (wind, paint) => {
    const cols = 17;
    const rows = 17;
    const elevation = new Float32Array(cols * rows);
    elevation.fill(0.45);
    const world = {
      grid: { cols, rows, totalTiles: cols * rows },
      tileElevation: elevation,
      wind,
      fireSettings: { ...DEFAULT_FIRE_SETTINGS },
      terrainTypeRevision: 1,
      seed: 9901
    };
    paint?.(world, (x, y, value) => {
      elevation[y * cols + x] = value;
    });
    return world;
  };
  const sampleField = (world, x, y) => {
    const field = getTerrainWindField(world);
    return sampleTerrainWindAt(field, y * world.grid.cols + x, world.wind);
  };

  const flatWorld = buildWindWorld({ name: "E", dx: 1, dy: 0, strength: 1 });
  const flat = sampleField(flatWorld, 8, 8);

  const ridgeWorld = buildWindWorld({ name: "E", dx: 1, dy: 0, strength: 1 }, (_world, setElev) => {
    for (let y = 4; y <= 12; y += 1) {
      setElev(8, y, 0.95);
      setElev(9, y, 0.88);
    }
  });
  const northShoulder = sampleField(ridgeWorld, 7, 4);
  const southShoulder = sampleField(ridgeWorld, 7, 12);
  const lee = sampleField(ridgeWorld, 10, 8);

  const valleyWorld = buildWindWorld({ name: "E", dx: 1, dy: 0, strength: 1 }, (_world, setElev) => {
    for (let x = 1; x <= 15; x += 1) {
      setElev(x, 6, 0.86);
      setElev(x, 10, 0.86);
      setElev(x, 8, 0.28);
    }
  });
  const valley = sampleField(valleyWorld, 9, 8);

  const clampWorld = buildWindWorld({ name: "E", dx: 1, dy: 0, strength: 1 }, (_world, setElev) => {
    for (let x = 7; x <= 10; x += 1) {
      for (let y = 5; y <= 12; y += 1) {
        setElev(x, y, 1.35);
      }
    }
  });
  const clamped = sampleField(clampWorld, 9, 8);
  const clampedDot = clamped.dx / Math.max(0.0001, Math.hypot(clamped.dx, clamped.dy));

  console.log(
    `Terrain Wind Field\nflat=(${flat.dx.toFixed(3)},${flat.dy.toFixed(3)},${flat.strength.toFixed(3)}) ` +
      `northDy=${northShoulder.dy.toFixed(3)} southDy=${southShoulder.dy.toFixed(3)} ` +
      `lee=${lee.strength.toFixed(3)} valley=${valley.strength.toFixed(3)} clampDot=${clampedDot.toFixed(3)}`
  );

  if (Math.abs(flat.dx - 1) > 0.001 || Math.abs(flat.dy) > 0.001 || Math.abs(flat.strength - 1) > 0.001) {
    failures.push("Propagated terrain wind field changed flat terrain wind.");
  }
  if (!(northShoulder.dy < -0.02 && southShoulder.dy > 0.02)) {
    failures.push("Propagated terrain wind did not split around a central ridge.");
  }
  if (!(lee.strength < flat.strength * 0.92)) {
    failures.push("Propagated terrain wind did not create a sheltered lee behind a ridge.");
  }
  if (!(valley.strength > flat.strength)) {
    failures.push("Propagated terrain wind did not accelerate through an aligned valley.");
  }
  if (
    clamped.strength < clampWorld.fireSettings.terrainWindSpeedMin ||
    clamped.strength > clampWorld.fireSettings.terrainWindSpeedMax ||
    clampedDot < 0.55
  ) {
    failures.push("Propagated terrain wind field exceeded direction or speed clamps.");
  }
}

{
  const settings = { ...DEFAULT_FIRE_SETTINGS };
  const cols = 7;
  const rows = 3;
  const windbreaks = new Float32Array(cols * rows);
  const sourceX = 1;
  const sourceY = 1;
  const openScale = getRangedHeatTransferScale({
    settings,
    sourceX,
    sourceY,
    dx: 1,
    dy: 0,
    distanceTiles: 2,
    cols,
    rows,
    windDx: 1,
    windDy: 0,
    windStrength: 0.9,
    heatRelease: 0.8,
    weatherSpread: 1.4,
    targetMoisture: 0.08,
    windbreakFactor: windbreaks
  });
  const openMultiplier = getPathWindbreakMultiplier(sourceX, sourceY, 1, 0, 2, cols, rows, windbreaks, settings);
  windbreaks[sourceY * cols + sourceX + 1] = 0.45;
  const forestMultiplier = getPathWindbreakMultiplier(sourceX, sourceY, 1, 0, 2, cols, rows, windbreaks, settings);
  windbreaks[sourceY * cols + sourceX + 1] = 0.85;
  const houseScale = getRangedHeatTransferScale({
    settings,
    sourceX,
    sourceY,
    dx: 1,
    dy: 0,
    distanceTiles: 2,
    cols,
    rows,
    windDx: 1,
    windDy: 0,
    windStrength: 0.9,
    heatRelease: 0.8,
    weatherSpread: 1.4,
    targetMoisture: 0.08,
    windbreakFactor: windbreaks
  });
  const houseMultiplier = getPathWindbreakMultiplier(sourceX, sourceY, 1, 0, 2, cols, rows, windbreaks, settings);
  console.log(
    `\nWindbreak Ranged Heat\nopenScale=${openScale.toFixed(3)} openMult=${openMultiplier.toFixed(3)} forestMult=${forestMultiplier.toFixed(3)} houseScale=${houseScale.toFixed(3)} houseMult=${houseMultiplier.toFixed(3)}`
  );
  if (!(openScale > 0 && Math.abs(openMultiplier - 1) < 0.0001)) {
    failures.push("Open terrain should allow deterministic ranged heat transfer under extreme aligned conditions.");
  }
  if (!(forestMultiplier < openMultiplier && houseMultiplier < forestMultiplier && houseScale < openScale)) {
    failures.push("Windbreak factors did not reduce deterministic ranged heat transfer by terrain obstruction.");
  }
}

{
  const calm10m = runGapJumpScenario(1, "calm");
  const extreme10m = runGapJumpScenario(1, "extreme");
  const extreme20m = runGapJumpScenario(2, "extreme");
  const default30m = runGapJumpScenario(3, "extreme");
  const explicit30m = runGapJumpScenario(3, "explicit-30m");
  console.log(
    `\nGap Jump Diffusion\ncalm10m fire=${calm10m.targetFire.toFixed(3)} heat=${calm10m.targetHeat.toFixed(3)} ` +
      `extreme10m fire=${extreme10m.targetFire.toFixed(3)} heat=${extreme10m.targetHeat.toFixed(3)} ` +
      `extreme20m fire=${extreme20m.targetFire.toFixed(3)} heat=${extreme20m.targetHeat.toFixed(3)} ` +
      `default30m fire=${default30m.targetFire.toFixed(3)} heat=${default30m.targetHeat.toFixed(3)} ` +
      `explicit30m fire=${explicit30m.targetFire.toFixed(3)} heat=${explicit30m.targetHeat.toFixed(3)}`
  );
  if (calm10m.targetFire > 0.02) {
    failures.push("Calm/wet conditions crossed a 10m fuel gap.");
  }
  if (extreme10m.targetFire <= 0.02) {
    failures.push("Extreme aligned conditions did not cross a 10m fuel gap.");
  }
  if (extreme20m.targetFire <= 0.02) {
    failures.push("Extreme aligned conditions did not cross a 20m fuel gap.");
  }
  if (default30m.targetFire > 0.02) {
    failures.push("Default extreme conditions crossed a 30m fuel gap without explicit 30m tuning.");
  }
  if (explicit30m.targetFire <= 0.02) {
    failures.push("Explicit extreme 30m tuning did not cross a 30m fuel gap.");
  }
}

{
  const forestSpread = runMatchedFuelTypeSpread("forest");
  const houseSpread = runMatchedFuelTypeSpread("house");
  const heatDelta = Math.abs(forestSpread.targetHeat - houseSpread.targetHeat);
  const fireDelta = Math.abs(forestSpread.targetFire - houseSpread.targetFire);
  console.log(
    `\nMatched Fuel Profiles\nforestHeat=${forestSpread.targetHeat.toFixed(3)} houseHeat=${houseSpread.targetHeat.toFixed(3)} forestFire=${forestSpread.targetFire.toFixed(3)} houseFire=${houseSpread.targetFire.toFixed(3)}`
  );
  if (heatDelta > 0.0001 || fireDelta > 0.0001) {
    failures.push("Matching forest and house fuel profiles produced different spread behavior before damage/scoring side effects.");
  }
}

{
  const { state, rng } = buildState(3901);
  const effects = createEffectsState();
  setCareerCursor(state, 225);
  seedAlertIncident(state);
  stepSim(state, effects, rng, BASE_STEP);
  console.log(
    `\nIncident Alert\npaused=${state.paused ? 1 : 0} mode=${state.simTimeMode} speedIndex=${state.timeSpeedIndex} alertId=${state.latestFireAlert?.id ?? "none"}`
  );
  if (!state.paused || state.simTimeMode !== "incident" || !state.latestFireAlert) {
    failures.push("New incidents did not auto-pause and switch into incident mode.");
  }
}

{
  const { state, rng } = buildState(3904);
  const effects = createEffectsState();
  setCareerCursor(state, 179.75);
  state.simTimeMode = "strategic";
  state.timeSpeedIndex = state.strategicTimeSpeedIndex;
  state.timeSpeedSliderValue = 80;
  state.paused = false;
  stepSim(state, effects, rng, BASE_STEP * 80);
  console.log(
    `\nHigh-Speed Season Entry Alert\nphase=${state.phase} paused=${state.paused ? 1 : 0} mode=${state.simTimeMode} active=${state.lastActiveFires} alertId=${state.latestFireAlert?.id ?? "none"} burned=${state.burnedTiles}`
  );
  if (!state.paused || state.simTimeMode !== "incident" || !state.latestFireAlert || state.burnedTiles !== 0) {
    failures.push("High-speed season entry did not pause immediately on the seeded fire incident.");
  }
}

{
  const { state, rng } = buildState(3910);
  const effects = createEffectsState();
  setCareerCursor(state, 225);
  state.simTimeMode = "strategic";
  state.timeSpeedIndex = state.strategicTimeSpeedIndex;
  state.timeSpeedSliderValue = 80;
  state.fireSettings.ignitionChancePerDay = 100;
  state.paused = false;
  const { cap, appliedDelta } = stepWithRuntimeCap(state, effects, rng, BASE_STEP * 80);
  console.log(
    `\nHigh-Speed Random Ignition Cap\ncap=${cap?.toFixed(3) ?? "none"} applied=${appliedDelta.toFixed(3)} paused=${state.paused ? 1 : 0} mode=${state.simTimeMode} active=${state.lastActiveFires} simulatedDays=${state.firePerfSimulatedDays.toFixed(3)} burned=${state.burnedTiles}`
  );
  if (
    cap === null ||
    appliedDelta > 0.5 + 0.0001 ||
    !state.paused ||
    state.simTimeMode !== "incident" ||
    !state.latestFireAlert ||
    state.lastActiveFires > 4 ||
    state.firePerfSimulatedDays > 0.5 + 0.0001 ||
    state.burnedTiles !== 0
  ) {
    failures.push("High-speed random ignition was not capped before incident pause.");
  }
}

{
  const { state, rng } = buildState(3911);
  const effects = createEffectsState();
  setCareerCursor(state, 225);
  state.fireSettings.ignitionChancePerDay = 100;
  state.timeSpeedSliderValue = 17;
  const requested = requestAdvanceToNextEvent(state);
  const { cap, appliedDelta } = stepWithRuntimeCap(state, effects, rng, BASE_STEP * 80);
  console.log(
    `\nAdvance-To-Event Fire Runtime Cap\nrequested=${requested ? 1 : 0} cap=${cap?.toFixed(3) ?? "none"} applied=${appliedDelta.toFixed(3)} paused=${state.paused ? 1 : 0} mode=${state.simTimeMode} active=${state.lastActiveFires} slider=${state.timeSpeedSliderValue.toFixed(2)}`
  );
  if (
    !requested ||
    cap === null ||
    appliedDelta > 0.5 + 0.0001 ||
    !state.paused ||
    state.simTimeMode !== "incident" ||
    !state.latestFireAlert ||
    state.advanceToNextEvent !== null ||
    Math.abs(state.timeSpeedSliderValue - 17) > 0.0001
  ) {
    failures.push("Advance to next event did not use the runtime cap and restore incident alert state.");
  }
}

withRuntimeSetting("pauseOnFireEvent", false, () => {
  const { state, rng } = buildState(3912);
  const effects = createEffectsState();
  setCareerCursor(state, 225);
  state.fireSettings.ignitionChancePerDay = 100;
  state.timeSpeedSliderValue = 19;
  const requested = requestAdvanceToNextEvent(state);
  const { cap, appliedDelta } = stepWithRuntimeCap(state, effects, rng, BASE_STEP * 80);
  console.log(
    `\nAdvance-To-Event Fire Pause Disabled\nrequested=${requested ? 1 : 0} cap=${cap?.toFixed(3) ?? "none"} applied=${appliedDelta.toFixed(3)} paused=${state.paused ? 1 : 0} advance=${state.advanceToNextEvent ? 1 : 0} alertId=${state.latestFireAlert?.id ?? "none"} active=${state.lastActiveFires}`
  );
  if (
    !requested ||
    cap === null ||
    !state.latestFireAlert ||
    state.paused ||
    state.advanceToNextEvent === null ||
    state.lastActiveFires <= 0
  ) {
    failures.push("Disabled fire pause did not let a fire event occur while advance-to-event continued.");
  }
});

{
  const { state, rng } = buildState(3913);
  setCareerCursor(state, 269);
  state.timeSpeedSliderValue = 13;
  const requested = requestAdvanceToNextEvent(state);
  setPhase(state, rng, "maintenance", { openAnnualReport: true });
  console.log(
    `\nAdvance-To-Event Annual Report Pause\nrequested=${requested ? 1 : 0} paused=${state.paused ? 1 : 0} report=${state.annualReportOpen ? 1 : 0} advance=${state.advanceToNextEvent ? 1 : 0} slider=${state.timeSpeedSliderValue.toFixed(2)}`
  );
  if (
    !requested ||
    !state.paused ||
    !state.annualReportOpen ||
    state.advanceToNextEvent !== null ||
    Math.abs(state.timeSpeedSliderValue - 13) > 0.0001
  ) {
    failures.push("Annual report did not pause and restore advance-to-event controls by default.");
  }
}

withRuntimeSetting("pauseOnAnnualReportEvent", false, () => {
  const { state, rng } = buildState(3914);
  setCareerCursor(state, 269);
  state.timeSpeedSliderValue = 11;
  const requested = requestAdvanceToNextEvent(state);
  setPhase(state, rng, "maintenance", { openAnnualReport: true });
  console.log(
    `\nAdvance-To-Event Annual Report Pause Disabled\nrequested=${requested ? 1 : 0} paused=${state.paused ? 1 : 0} report=${state.annualReportOpen ? 1 : 0} advance=${state.advanceToNextEvent ? 1 : 0} budget=${state.budget}`
  );
  if (!requested || state.paused || state.annualReportOpen || state.advanceToNextEvent === null) {
    failures.push("Disabled annual report pause opened a blocking report or stopped advance-to-event.");
  }
});

{
  const seed = 3915;
  const { state, rng } = buildState(seed);
  const effects = createEffectsState();
  const rain = buildSeasonalRainEvent(seed, 0);
  setCareerCursor(state, rain.startDayOfYear);
  state.fireSettings.ignitionChancePerDay = 0;
  state.paused = false;
  state.timeSpeedSliderValue = 15;
  const requested = requestAdvanceToNextEvent(state);
  stepSim(state, effects, rng, BASE_STEP);
  const pausedAtStart = state.paused;
  const handledAtStart = state.seasonalRain.hasStartPauseHandled;
  state.paused = false;
  stepSim(state, effects, rng, BASE_STEP);
  console.log(
    `\nAdvance-To-Event Rain Start Pause\nrequested=${requested ? 1 : 0} pausedStart=${pausedAtStart ? 1 : 0} pausedAgain=${state.paused ? 1 : 0} active=${state.seasonalRain.active ? 1 : 0} handled=${state.seasonalRain.hasStartPauseHandled ? 1 : 0} advance=${state.advanceToNextEvent ? 1 : 0}`
  );
  if (!requested || !pausedAtStart || !handledAtStart || state.advanceToNextEvent !== null) {
    failures.push("Rain start did not pause advance-to-event once by default.");
  }
  if (state.paused) {
    failures.push("Rain start pause fired more than once for the same seasonal rain event.");
  }
}

withRuntimeSetting("pauseOnRainEvent", false, () => {
  const seed = 3916;
  const { state, rng } = buildState(seed);
  const effects = createEffectsState();
  const rain = buildSeasonalRainEvent(seed, 0);
  setCareerCursor(state, rain.startDayOfYear);
  state.fireSettings.ignitionChancePerDay = 0;
  state.paused = false;
  const requested = requestAdvanceToNextEvent(state);
  stepSim(state, effects, rng, BASE_STEP);
  console.log(
    `\nAdvance-To-Event Rain Pause Disabled\nrequested=${requested ? 1 : 0} paused=${state.paused ? 1 : 0} active=${state.seasonalRain.active ? 1 : 0} handled=${state.seasonalRain.hasStartPauseHandled ? 1 : 0} advance=${state.advanceToNextEvent ? 1 : 0}`
  );
  if (
    !requested ||
    state.paused ||
    !state.seasonalRain.active ||
    !state.seasonalRain.hasStartPauseHandled ||
    state.advanceToNextEvent === null
  ) {
    failures.push("Disabled rain pause did not let the rain event pass while advance-to-event continued.");
  }
});

{
  const { state, rng } = buildState(3902);
  const effects = createEffectsState();
  setCareerCursor(state, 225);
  state.fireSettings.ignitionChancePerDay = 0;
  const { targetIdx } = seedExposureIncident(state);
  stepSim(state, effects, rng, BASE_STEP);
  console.log(
    `\nDirect Exposure Ignition\npaused=${state.paused ? 1 : 0} mode=${state.simTimeMode} state=${state.fireActivityState} active=${state.lastActiveFires} targetFire=${state.tileFire[targetIdx].toFixed(3)} targetRelease=${state.tileHeatRelease[targetIdx].toFixed(3)} bounds=${state.fireBoundsActive ? 1 : 0}`
  );
  if (state.paused || state.simTimeMode !== "incident" || state.fireActivityState !== "burning" || (state.tileFire[targetIdx] ?? 0) <= 0.02) {
    failures.push("Neighbor exposure did not ignite a receptive tile without deferred scheduling.");
  }
}

{
  const crawl = runSlowIncidentCrawlScenario();
  console.log(
    `\nSlow Incident Crawl\nstate=${crawl.activityState} active=${crawl.activeFires} sourceFire=${crawl.sourceFire.toFixed(3)} targetFire=${crawl.targetFire.toFixed(3)} targetHeat=${crawl.targetHeat.toFixed(3)} burned=${crawl.burnedTiles}`
  );
  if (crawl.activityState !== "burning" || crawl.activeFires <= 0 || crawl.sourceFire <= 0.02) {
    failures.push("Slowest incident pacing did not keep the source fire active.");
  }
  if (crawl.targetFire > 0.02 || crawl.burnedTiles > 0) {
    failures.push("Slowest incident pacing advanced the fire front too far within one real second.");
  }
}

{
  const { state, rng } = buildState(3903);
  const effects = createEffectsState();
  const center = getCenter(state);
  const idx = center * state.grid.cols + center;
  setCareerCursor(state, 225);
  state.fireSettings.ignitionChancePerDay = 0;
  state.tiles[idx].heat = 0.34;
  state.tileHeat[idx] = state.tiles[idx].heat;
  state.tileHeatRelease[idx] = 0;
  state.lastActiveFires = 0;
  state.fireBoundsActive = true;
  state.fireMinX = center - 1;
  state.fireMaxX = center + 1;
  state.fireMinY = center - 1;
  state.fireMaxY = center + 1;
  state.simTimeMode = "incident";
  state.timeSpeedIndex = state.incidentTimeSpeedIndex;
  state.paused = false;
  markFireBlockActiveByTile(state, idx);
  syncFireActivity(state, 0);
  stepSim(state, effects, rng, BASE_STEP);
  console.log(
    `\nCooling Incident Release\nmode=${state.simTimeMode} state=${state.fireActivityState} active=${state.lastActiveFires} release=${state.tileHeatRelease[idx].toFixed(3)} bounds=${state.fireBoundsActive ? 1 : 0} canAdvance=${isAdvanceToNextEventAvailable(state) ? 1 : 0}`
  );
  if (state.simTimeMode !== "strategic" || !isAdvanceToNextEventAvailable(state)) {
    failures.push("Cooling-only fire bounds incorrectly kept incident time or blocked advance-to-event.");
  }
}

{
  const { state } = buildState(3905);
  setCareerCursor(state, 225);
  seedExposureIncident(state);
  console.log(
    `\nBurning Advance Gate\nmode=${state.simTimeMode} state=${state.fireActivityState} active=${state.lastActiveFires} canAdvance=${isAdvanceToNextEventAvailable(state) ? 1 : 0}`
  );
  if (isAdvanceToNextEventAvailable(state)) {
    failures.push("Active burning fire incorrectly allowed advance-to-event.");
  }
}

{
  const exposureRuns = [1, 20, 80].map((speed) => runExposureSequence(speed));
  console.log("\nExposure Speed Sequence");
  exposureRuns.forEach((scenario) => {
    console.log(
      [
        `speed=${scenario.speed}x`,
        `sequence=${scenario.transitions.join(">")}`,
        `mode=${scenario.mode}`,
        `paused=${scenario.paused ? 1 : 0}`,
        `pauseResumes=${scenario.pauseResumes}`,
        `finalState=${scenario.finalActivityState}`,
        `active=${scenario.finalActiveFires}`
      ].join(" ")
    );
  });
  if (exposureRuns.some((scenario) => scenario.transitions[0] !== "burning")) {
    failures.push("Exposure-driven fire-chain did not start in burning state across all tested speeds.");
  }
  if (
    exposureRuns.some((scenario) => {
      const idleIndex = scenario.transitions.indexOf("idle");
      return idleIndex >= 0 && idleIndex < scenario.transitions.length - 1;
    })
  ) {
    failures.push("Exposure-driven fire-chain hit idle before the final transition in at least one speed scenario.");
  }
  if (
    exposureRuns.some((scenario) =>
      scenario.transitions.some((value) => value !== "burning" && value !== "idle")
    )
  ) {
    failures.push("Exposure-driven fire-chain emitted an unexpected activity state during the speed regression.");
  }
  if (
    exposureRuns.some(
      (scenario) =>
        (scenario.paused && scenario.finalActivityState !== "idle") ||
        !["strategic", "incident"].includes(scenario.mode) ||
        !["idle", "burning"].includes(scenario.finalActivityState)
    )
  ) {
    failures.push("Exposure-driven fire-chain produced an unstable pause or terminal activity state across speeds.");
  }
}

{
  const cols = 4;
  const rows = 4;
  const sample = {
    cols,
    rows,
    tileTypes: new Uint8Array([
      TILE_TYPE_IDS.ash,
      TILE_TYPE_IDS.grass,
      TILE_TYPE_IDS.grass,
      TILE_TYPE_IDS.grass,
      TILE_TYPE_IDS.grass,
      TILE_TYPE_IDS.grass,
      TILE_TYPE_IDS.grass,
      TILE_TYPE_IDS.grass,
      TILE_TYPE_IDS.grass,
      TILE_TYPE_IDS.grass,
      TILE_TYPE_IDS.grass,
      TILE_TYPE_IDS.grass,
      TILE_TYPE_IDS.grass,
      TILE_TYPE_IDS.grass,
      TILE_TYPE_IDS.grass,
      TILE_TYPE_IDS.grass
    ])
  };
  const sampledTypes = buildSampleTypeMap(
    sample,
    2,
    2,
    2,
    TILE_TYPE_IDS.grass,
    TILE_TYPE_IDS.water,
    Object.keys(TILE_TYPE_IDS).length,
    [TILE_TYPE_IDS.base, TILE_TYPE_IDS.house, TILE_TYPE_IDS.road, TILE_TYPE_IDS.firebreak]
  );
  console.log(
    `\nTerrain Ash Sampling\nsampled=${Array.from(sampledTypes)
      .map((value) => value.toString())
      .join(",")}`
  );
  if ((sampledTypes[0] ?? -1) === TILE_TYPE_IDS.ash) {
    failures.push("Sparse ash tiles still overpaint an entire sampled terrain cell.");
  }
}

{
  const ignitionDistanceByYear = [1, 5, 10, 15].map((year, index) => {
    const { state, rng } = buildState(4500 + index, 257);
    setCareerCursor(state, (year - 1) * YEAR_DAYS + 225);
    const distances = [];
    for (let sample = 0; sample < 48; sample += 1) {
      const candidate = findIgnitionCandidate(state, rng, { maxAttempts: 120 });
      if (!candidate) {
        continue;
      }
      distances.push(Math.hypot(candidate.x - state.basePoint.x, candidate.y - state.basePoint.y));
    }
    return {
      year,
      medianDistance: median(distances)
    };
  });

  console.log("\nIgnition Distance");
  ignitionDistanceByYear.forEach((entry) => {
    console.log(`year=${entry.year} medianDistance=${entry.medianDistance.toFixed(2)}`);
  });

  const [year1, year5, year10, year15] = ignitionDistanceByYear;
  if (
    !Number.isFinite(year1?.medianDistance) ||
    !Number.isFinite(year5?.medianDistance) ||
    !Number.isFinite(year10?.medianDistance) ||
    !Number.isFinite(year15?.medianDistance)
  ) {
    failures.push("Ignition-distance regression did not produce valid samples.");
  } else if (
    !(year1.medianDistance < year5.medianDistance &&
      year5.medianDistance < year10.medianDistance &&
      year10.medianDistance < year15.medianDistance)
  ) {
    failures.push("Ignition distance did not widen across career-year bands.");
  }
}

const SPEED_SEED = 4100;
const speedRuns = [1, 20, 80].map((speed) =>
  runScenario({
    seed: SPEED_SEED,
    startDay: 225,
    speed,
    durationDays: 12
  })
);

printScenarioGroup("Speed Regression", speedRuns);

if (speedRuns.some((scenario) => scenario.stalled)) {
  failures.push("Speed regression stalled before completing its tactical incident window.");
}

const burnedValues = speedRuns.map((scenario) => scenario.burnedTiles).sort((a, b) => a - b);
if (burnedValues[burnedValues.length - 1] > Math.max(10, burnedValues[0] + 8)) {
  console.warn("Speed regression note: burned area differs materially across speeds; review tuning if this becomes player-visible.");
}

const seasonalRuns = [
  { label: "winter", day: 15 },
  { label: "spring", day: 135 },
  { label: "summer", day: 225 },
  { label: "autumn", day: 315 }
].map((entry, index) => ({
  label: entry.label,
  ...runScenario({
    seed: 5200 + index,
    startDay: entry.day,
    speed: 1,
    durationDays: 10
  })
}));

console.log("\nSeasonal Spread");
seasonalRuns.forEach((scenario) => {
  console.log(
    `${scenario.label} burned=${scenario.burnedTiles} endActive=${scenario.endActiveFires} extinguished=${
      scenario.extinguishedDay === null ? "none" : scenario.extinguishedDay.toFixed(2)
    }`
  );
});

const winterRun = seasonalRuns.find((scenario) => scenario.label === "winter");
const springRun = seasonalRuns.find((scenario) => scenario.label === "spring");
const summerRun = seasonalRuns.find((scenario) => scenario.label === "summer");
const autumnRun = seasonalRuns.find((scenario) => scenario.label === "autumn");

if (!winterRun || !springRun || !summerRun || !autumnRun) {
  failures.push("Seasonal regression scenarios were not created correctly.");
} else {
  if (seasonalRuns.some((scenario) => scenario.stalled)) {
    failures.push("Seasonal regression stalled before completing its within-season tactical window.");
  }
  if (summerRun.burnedTiles <= springRun.burnedTiles || summerRun.endActiveFires <= autumnRun.endActiveFires) {
    failures.push("Summer fire did not sustain a stronger spread signature than spring and autumn.");
  }
  if (winterRun.endActiveFires > 0 || winterRun.burnedTiles > 2) {
    failures.push("Winter fire did not extinguish quickly enough relative to spring and autumn.");
  }
}

const suppressionRuns = [
  { label: "winter", day: 15 },
  { label: "summer", day: 225 }
].map((entry, index) => ({
  label: entry.label,
  ...runScenario({
    seed: 6300 + index,
    startDay: entry.day,
    speed: 1,
    durationDays: 10,
    withTruck: true
  })
}));

console.log("\nSuppression Regression");
suppressionRuns.forEach((scenario) => {
  console.log(
    `${scenario.label} burned=${scenario.burnedTiles} endActive=${scenario.endActiveFires} extinguished=${
      scenario.extinguishedDay === null ? "none" : scenario.extinguishedDay.toFixed(2)
    }`
  );
});

const winterSuppression = suppressionRuns.find((scenario) => scenario.label === "winter");
const summerSuppression = suppressionRuns.find((scenario) => scenario.label === "summer");
if (!winterSuppression || !summerSuppression) {
  failures.push("Suppression regression scenarios were not created correctly.");
} else {
  if (suppressionRuns.some((scenario) => scenario.stalled)) {
    failures.push("Suppression regression stalled before completing its tactical window.");
  }
  const winterExtinguishedAt = winterSuppression.extinguishedDay ?? Number.POSITIVE_INFINITY;
  const summerExtinguishedAt = summerSuppression.extinguishedDay ?? Number.POSITIVE_INFINITY;
  if (!(winterExtinguishedAt < summerExtinguishedAt || (winterSuppression.endActiveFires === 0 && summerSuppression.endActiveFires > 0))) {
    failures.push("Winter suppression did not outperform summer suppression.");
  }
}

const rainClear = withRuntimeSetting("pauseOnRainEvent", false, runSeasonalRainClearScenario);
console.log(
  `\nSeasonal Rain Clear\npeak=${rainClear.rain.peakDayOfYear} active=${rainClear.activeFires} ` +
    `fire=${rainClear.centerFire.toFixed(3)} heat=${rainClear.centerHeat.toFixed(3)} credited=${rainClear.creditedEvents} ` +
    `fireFlow=${rainClear.fireFlowEvents}`
);
if (rainClear.activeFires !== 0 || rainClear.centerFire > 0 || rainClear.centerHeat > 0) {
  failures.push("Seasonal autumn rain did not clear the active fire.");
}
if (!rainClear.hasExtinguished) {
  failures.push("Seasonal autumn rain did not mark its yearly clear as consumed.");
}
if (
  rainClear.creditedEvents > 0 ||
  rainClear.fireFlowEvents > 0 ||
  rainClear.seasonExtinguishedCount > 0 ||
  rainClear.seasonExtinguishPoints > 0
) {
  failures.push("Seasonal autumn rain clearing awarded fire suppression or decay credit.");
}

const perfScenario = runScenario({
  seed: 7700,
  startDay: 225,
  speed: 80,
  durationDays: 8,
  size: 49
});

console.log(
  `\nPerformance Smoke\nspeed=${perfScenario.speed}x burned=${perfScenario.burnedTiles} maxSubsteps=${perfScenario.maxSubsteps} ` +
    `maxBlocks=${perfScenario.maxActiveBlocks} elapsedMs=${perfScenario.elapsedMs.toFixed(1)}`
);

if (perfScenario.elapsedMs > 8000) {
  failures.push(`Performance smoke test exceeded budget: ${perfScenario.elapsedMs.toFixed(1)}ms.`);
}
if (perfScenario.stalled) {
  failures.push(`Performance smoke test stalled: ${perfScenario.stalledReason}.`);
}

if (failures.length > 0) {
  console.error("\nFire regression failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log("\nFire regression passed.");
}
