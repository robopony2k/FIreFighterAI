import { DEFAULT_MOISTURE_PARAMS, VIRTUAL_CLIMATE_PARAMS, buildClimateTimeline } from "../dist/core/climate.js";
import { MAP_SIZE_PRESETS } from "../dist/core/config.js";
import { createEffectsState } from "../dist/core/effectsState.js";
import { RNG } from "../dist/core/rng.js";
import { createInitialState, syncTileSoA } from "../dist/core/state.js";
import { PHASES } from "../dist/core/time.js";
import { generateMap } from "../dist/mapgen/index.js";
import { createDefaultTerrainRecipe } from "../dist/mapgen/terrainProfile.js";
import { setRuntimeSetting } from "../dist/persistence/runtimeSettings.js";
import { getStrategicFireSimulationStepCap, setPhase, stepSim } from "../dist/sim/index.js";
import { initScoringForRun } from "../dist/sim/scoring.js";
import { getLatestIgnitionAttemptResults, resetIgnitionSchedule, stepIgnitionSources } from "../dist/systems/fire/sim/ignition/ignitionScheduler.js";

const seed = Number(process.argv[2] ?? 1294615983);
const sizeId = "colossal";
const size = MAP_SIZE_PRESETS[sizeId];
const grid = { cols: size, rows: size, totalTiles: size * size };
const state = createInitialState(seed, grid);
await generateMap(state, new RNG(seed), undefined, createDefaultTerrainRecipe(sizeId));
syncTileSoA(state);
state.climateTimeline = buildClimateTimeline(seed, 20, VIRTUAL_CLIMATE_PARAMS, DEFAULT_MOISTURE_PARAMS);
state.climateTimelineSeed = seed;
resetIgnitionSchedule(state, 0);

if (process.argv.includes("--sim")) {
  setRuntimeSetting("pauseOnFireEvent", false);
  setRuntimeSetting("annualReportEnabled", false);
  setRuntimeSetting("pauseOnAnnualReportEvent", false);
  setRuntimeSetting("pauseOnRainEvent", false);
  initScoringForRun(state);
  const maintenanceIndex = PHASES.findIndex((phase) => phase.id === "maintenance");
  state.phaseIndex = maintenanceIndex;
  state.phaseDay = 0;
  setPhase(state, new RNG(seed), "maintenance");
  const effects = createEffectsState();
  const runtimeRng = new RNG(seed);
  let opportunities = 0;
  let successes = 0;
  let successesSurvivingStep = 0;
  let maxActive = 0;
  for (let frame = 0; frame < 20000 && state.careerDay < 7200 && !state.gameOver; frame += 1) {
    const cap = getStrategicFireSimulationStepCap(state);
    const delta = Math.min(5, cap ?? 5);
    stepSim(state, effects, runtimeRng, delta);
    const attempts = getLatestIgnitionAttemptResults(state);
    opportunities += attempts.length;
    const stepSuccesses = attempts.filter((result) => result.succeeded).length;
    successes += stepSuccesses;
    const active = state.tileFire.reduce((count, value) => count + (value > 0 ? 1 : 0), 0);
    if (stepSuccesses > 0 && active > 0) successesSurvivingStep += stepSuccesses;
    maxActive = Math.max(maxActive, active);
  }
  console.log(JSON.stringify({
    mode: "simulation",
    careerDay: state.careerDay,
    year: state.year,
    opportunities,
    successes,
    successesSurvivingStep,
    maxActive,
    reports: state.fireKnowledge.reports.length,
    latestReportId: state.fireKnowledge.latestReportId
  }, null, 2));
  if (successes <= 0 || successesSurvivingStep <= 0 || state.fireKnowledge.reports.length <= 0 || maxActive <= 0) {
    console.error("Exact-seed ignition did not survive into an observable fire incident.");
    process.exit(1);
  }
  process.exit(0);
}

const totals = new Map();
for (let year = 1; year <= 20; year += 1) {
  state.year = year;
  const results = stepIgnitionSources(state, year * 360, true).results;
  for (const result of results) {
    const entry = totals.get(result.sourceId) ?? { opportunities: 0, candidates: 0, successes: 0, failures: {} };
    entry.opportunities += 1;
    if (result.tileIndex !== null) entry.candidates += 1;
    if (result.succeeded) entry.successes += 1;
    else entry.failures[result.failureReason] = (entry.failures[result.failureReason] ?? 0) + 1;
    totals.set(result.sourceId, entry);
  }
  const successes = results.filter((result) => result.succeeded).length;
  console.log(`year=${year} opportunities=${results.length} successes=${successes}`);
}
console.log(JSON.stringify({ seed, size, towns: state.towns.length, totals: Object.fromEntries(totals) }, null, 2));
