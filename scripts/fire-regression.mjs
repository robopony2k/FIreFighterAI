import { performance } from "node:perf_hooks";

import { DEFAULT_MOISTURE_PARAMS, VIRTUAL_CLIMATE_PARAMS, buildClimateTimeline } from "../dist/core/climate.js";
import { createEffectsState } from "../dist/core/effectsState.js";
import { RNG } from "../dist/core/rng.js";
import { TILE_TYPE_IDS, createInitialState, syncTileSoA } from "../dist/core/state.js";
import { PHASES } from "../dist/core/time.js";
import { applyFuel } from "../dist/core/tiles.js";
import { buildSampleTypeMap } from "../dist/render/threeTestTerrain.js";
import { isSkipToNextFireAvailable, stepSim } from "../dist/sim/index.js";
import { markFireBlockActiveByTile } from "../dist/sim/fire/activeBlocks.js";
import { findIgnitionCandidate } from "../dist/sim/fire/ignite.js";
import { createUnit } from "../dist/sim/units.js";
import { applyFireActivityMetrics } from "../dist/systems/fire/sim/fireActivityState.js";

const YEAR_DAYS = 360;
const PHASE_DAYS = 90;
const BASE_STEP = 0.25;
const GRID_SIZE = 33;
const MAX_SCENARIO_STEPS = 4096;
const HOLDOVER_SEQUENCE_MAX_DAYS = 40;

const getCenter = (state) => Math.floor(state.grid.cols / 2);
const syncFireActivity = (state, activeFires = state.lastActiveFires, holdoverTiles = state.fireHoldoverTiles ?? 0) =>
  applyFireActivityMetrics(state, activeFires, holdoverTiles);

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
  state.fireScheduledCount = 0;
  syncFireActivity(state, 0, 0);
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
  syncFireActivity(state, 0, 0);
  return idx;
};

const seedHoldoverIncident = (state) => {
  const center = getCenter(state);
  const idx = center * state.grid.cols + center;
  for (let y = center - 1; y <= center + 1; y += 1) {
    for (let x = center - 1; x <= center + 1; x += 1) {
      const ringIdx = y * state.grid.cols + x;
      const tile = state.tiles[ringIdx];
      if (x === center && y === center) {
        resetTile(tile, "grass", 0.18, {
          fuel: 3.2,
          heat: 2.2,
          fire: 0,
          burnRate: 0.08,
          heatOutput: 0.44,
          spreadBoost: 0.12,
          heatTransferCap: 2.4,
          heatRetention: 0.9,
          windFactor: 0.08
        });
        continue;
      }
      resetTile(tile, "bare", 0.98, {
        fuel: 0,
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
  state.tileIgniteAt[idx] = state.fireSeasonDay;
  state.fireScheduledCount = 1;
  state.lastActiveFires = 0;
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
  markFireBlockActiveByTile(state, idx);
  syncFireActivity(state, 0, 1);
  return idx;
};

const captureDistinctActivitySequence = (state, transitions) => {
  const nextState = state.fireActivityState;
  if (transitions.length <= 0 || transitions[transitions.length - 1] !== nextState) {
    transitions.push(nextState);
  }
};

const runHoldoverSequence = (speed) => {
  const { state, rng } = buildState(3904);
  const effects = createEffectsState();
  setCareerCursor(state, 225);
  state.fireSettings.ignitionChancePerDay = 0;
  seedHoldoverIncident(state);
  const transitions = [];
  captureDistinctActivitySequence(state, transitions);
  let pauseResumes = 0;
  const maxCareerDay = state.careerDay + HOLDOVER_SEQUENCE_MAX_DAYS;
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
    finalActiveFires: state.lastActiveFires,
    finalHoldoverTiles: state.fireHoldoverTiles,
    finalScheduledCount: state.fireScheduledCount
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
  const { state, rng } = buildState(3902);
  const effects = createEffectsState();
  setCareerCursor(state, 225);
  state.fireSettings.ignitionChancePerDay = 0;
  seedHoldoverIncident(state);
  stepSim(state, effects, rng, BASE_STEP);
  console.log(
    `\nHoldover Incident Continuity\npaused=${state.paused ? 1 : 0} mode=${state.simTimeMode} state=${state.fireActivityState} active=${state.lastActiveFires} holdover=${state.fireHoldoverTiles} scheduled=${state.fireScheduledCount} bounds=${state.fireBoundsActive ? 1 : 0}`
  );
  if (state.paused || state.simTimeMode !== "incident" || state.fireActivityState === "idle") {
    failures.push("Holdover reignition incorrectly re-triggered incident auto-pause.");
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
  state.lastActiveFires = 0;
  state.fireScheduledCount = 0;
  state.fireBoundsActive = true;
  state.fireMinX = center - 1;
  state.fireMaxX = center + 1;
  state.fireMinY = center - 1;
  state.fireMaxY = center + 1;
  state.simTimeMode = "incident";
  state.timeSpeedIndex = state.incidentTimeSpeedIndex;
  state.paused = false;
  markFireBlockActiveByTile(state, idx);
  syncFireActivity(state, 0, 0);
  stepSim(state, effects, rng, BASE_STEP);
  console.log(
    `\nCooling Incident Release\nmode=${state.simTimeMode} state=${state.fireActivityState} active=${state.lastActiveFires} holdover=${state.fireHoldoverTiles} scheduled=${state.fireScheduledCount} bounds=${state.fireBoundsActive ? 1 : 0} canSkip=${isSkipToNextFireAvailable(state) ? 1 : 0}`
  );
  if (state.simTimeMode !== "strategic" || !isSkipToNextFireAvailable(state)) {
    failures.push("Cooling-only fire bounds incorrectly kept incident time or blocked next-fire skip.");
  }
}

{
  const { state } = buildState(3905);
  setCareerCursor(state, 225);
  seedHoldoverIncident(state);
  console.log(
    `\nHoldover Skip Gate\nmode=${state.simTimeMode} state=${state.fireActivityState} active=${state.lastActiveFires} holdover=${state.fireHoldoverTiles} scheduled=${state.fireScheduledCount} canSkip=${isSkipToNextFireAvailable(state) ? 1 : 0}`
  );
  if (isSkipToNextFireAvailable(state)) {
    failures.push("Holdover activity incorrectly allowed skip-to-next-fire before the chain was idle.");
  }
}

{
  const holdoverRuns = [1, 20, 80].map((speed) => runHoldoverSequence(speed));
  console.log("\nHoldover Speed Sequence");
  holdoverRuns.forEach((scenario) => {
    console.log(
      [
        `speed=${scenario.speed}x`,
        `sequence=${scenario.transitions.join(">")}`,
        `mode=${scenario.mode}`,
        `paused=${scenario.paused ? 1 : 0}`,
        `pauseResumes=${scenario.pauseResumes}`,
        `finalState=${scenario.finalActivityState}`,
        `active=${scenario.finalActiveFires}`,
        `holdover=${scenario.finalHoldoverTiles}`,
        `scheduled=${scenario.finalScheduledCount}`
      ].join(" ")
    );
  });
  if (holdoverRuns.some((scenario) => scenario.transitions[0] !== "holdover")) {
    failures.push("Holdover fire-chain did not start in holdover state across all tested speeds.");
  }
  if (
    holdoverRuns.some((scenario) => {
      const idleIndex = scenario.transitions.indexOf("idle");
      return idleIndex >= 0 && idleIndex < scenario.transitions.length - 1;
    })
  ) {
    failures.push("Holdover fire-chain hit idle before the final transition in at least one speed scenario.");
  }
  if (
    holdoverRuns.some((scenario) =>
      scenario.transitions.some((value) => value !== "holdover" && value !== "burning" && value !== "idle")
    )
  ) {
    failures.push("Holdover fire-chain emitted an unexpected activity state during the speed regression.");
  }
  if (
    holdoverRuns.some(
      (scenario) =>
        scenario.pauseResumes > 0 ||
        scenario.paused ||
        scenario.mode !== "strategic" ||
        scenario.finalActivityState !== "idle"
    )
  ) {
    failures.push("Holdover fire-chain did not cleanly resolve back to strategic idle across all tested speeds.");
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
  if (summerRun.burnedTiles <= springRun.burnedTiles || summerRun.burnedTiles <= autumnRun.burnedTiles) {
    failures.push("Summer fire did not outgrow spring and autumn scenarios.");
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
