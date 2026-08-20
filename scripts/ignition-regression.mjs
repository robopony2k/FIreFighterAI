import { DEFAULT_MOISTURE_PARAMS, VIRTUAL_CLIMATE_PARAMS, buildClimateTimeline } from "../dist/core/climate.js";
import { createInitialState, syncTileSoA } from "../dist/core/state.js";
import { RNG } from "../dist/core/rng.js";
import { applyFuel } from "../dist/core/tiles.js";
import { normalizeFireSettings } from "../dist/ui/run-config.js";
import { buildConvectiveStormTimeline, sampleConvectiveStorm } from "../dist/systems/climate/sim/convectiveStorms.js";
import { sampleFireWeatherResponse } from "../dist/systems/fire/sim/fireWeather.js";
import { createIgnitionRng } from "../dist/systems/fire/sim/ignition/deterministicIgnitionRng.js";
import { calculateIgnitionSuccessProbability, commitExternalIgnition } from "../dist/systems/fire/sim/ignition/externalIgnition.js";
import { getIgnitionCandidateCacheStats } from "../dist/systems/fire/sim/ignition/ignitionCandidateCaches.js";
import { IGNITION_SOURCE_REGISTRY } from "../dist/systems/fire/sim/ignition/ignitionSourceRegistry.js";
import { getIgnitionTelemetrySnapshot, resetIgnitionSchedule, stepIgnitionSources } from "../dist/systems/fire/sim/ignition/ignitionScheduler.js";

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const createTile = (type, moisture = 0.12) => ({
  type, fuel: 0, fire: 0, isBase: type === "base", elevation: 0.15, heat: 0,
  ignitionPoint: 0.8, burnRate: 0.7, heatOutput: 1, spreadBoost: 1,
  heatTransferCap: 5, heatRetention: 0.95, windFactor: 0.35, moisture,
  waterDist: 12, vegetationAgeYears: type === "forest" ? 20 : 2,
  canopy: 0.2, canopyCover: 0.2, stemDensity: 2, dominantTreeType: null,
  treeType: null, houseValue: 0, houseResidents: 0, houseDestroyed: false, ashAge: 0
});

const createTown = (id, x, y) => ({
  id, name: `Town ${id}`, x, y, cx: x, cy: y, radius: 4, industryProfile: "general",
  streetArchetype: "crossroads", growthFrontiers: [], growthSeedYear: 1,
  simulatedGrowthYears: 0, houseCount: 6, housesLost: 0, alertPosture: 0,
  alertCooldownDays: 0, nonApprovingHouseCount: 0, approval: 0.7,
  evacState: "none", evacProgress: 0, evacuationStatus: "None",
  populationRemaining: 24, populationQueued: 0, populationEvacuating: 0,
  populationEvacuated: 0, populationDead: 0, vehiclesQueued: 0, vehiclesMoving: 0,
  vehiclesDestroyed: 0, growthPressure: 0, recoveryPressure: 0,
  buildStartCooldownDays: 0, activeBuildCap: 0, buildStartSerial: 0
});

const buildFixture = (seed, size = 32) => {
  const grid = { cols: size, rows: size, totalTiles: size * size };
  const state = createInitialState(seed, grid);
  const rng = new RNG(seed ^ 0x714ac3);
  state.tiles = Array.from({ length: grid.totalTiles }, (_, index) => {
    const x = index % size;
    const y = Math.floor(index / size);
    const tile = createTile(x === 0 || y === 0 || x === size - 1 || y === size - 1 ? "bare" : "forest");
    applyFuel(tile, tile.moisture, rng);
    return tile;
  });
  const roadX = 9;
  for (let y = 5; y < size - 5; y += 1) {
    const idx = y * size + roadX;
    state.tiles[idx] = createTile("road", 0.2);
    applyFuel(state.tiles[idx], 0.2, rng);
  }
  const town = createTown(7, 22, 18);
  state.towns = [town];
  state.totalHouses = town.houseCount;
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1]]) {
    const idx = (town.cy + dy) * size + town.cx + dx;
    state.tiles[idx] = createTile("house", 0.1);
    applyFuel(state.tiles[idx], 0.1, rng);
  }
  syncTileSoA(state);
  for (let y = 5; y < size - 5; y += 1) state.tileRoadEdges[y * size + roadX] = 5;
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1]]) {
    const idx = (town.cy + dy) * size + town.cx + dx;
    state.tileTownId[idx] = town.id;
    state.tileStructure[idx] = 1;
  }
  state.structureRevision += 1;
  state.climateTimeline = buildClimateTimeline(seed, 20, VIRTUAL_CLIMATE_PARAMS, DEFAULT_MOISTURE_PARAMS);
  state.climateTimelineSeed = seed;
  return state;
};

const source = (id) => IGNITION_SOURCE_REGISTRY.find((entry) => entry.id === id);

{
  const migrated = normalizeFireSettings({ ignitionChancePerDay: 0.16 });
  expect(migrated.ignitionOpportunityRateScale === 2, "Legacy 0.08/day fire setting was not migrated as a relative rate scale.");
}

{
  const a = buildFixture(7001);
  const b = buildFixture(7001);
  resetIgnitionSchedule(a, 0);
  resetIgnitionSchedule(b, 0);
  const logA = stepIgnitionSources(a, 720, true).results;
  const logB = stepIgnitionSources(b, 720, true).results;
  expect(JSON.stringify(logA) === JSON.stringify(logB), "Identical seed/config did not produce identical ignition logs.");
  const c = buildFixture(7002);
  resetIgnitionSchedule(c, 0);
  const logC = stepIgnitionSources(c, 720, true).results;
  expect(JSON.stringify(logA) !== JSON.stringify(logC), "Different seeds did not diverge.");
}

{
  const before = createIgnitionRng(81, "roadside-human", 12, "candidate").next();
  createIgnitionRng(81, "lightning", 999, "candidate").next();
  const after = createIgnitionRng(81, "roadside-human", 12, "candidate").next();
  expect(before === after, "Another source perturbed the roadside keyed RNG sequence.");
}

{
  const state = buildFixture(7003);
  const schedule = resetIgnitionSchedule(state, 0);
  const firstDay = Math.min(...Object.values(schedule.clocks).map((clock) => clock.nextOpportunityDay));
  stepIgnitionSources(state, firstDay + 120, false);
  const disabledTelemetry = getIgnitionTelemetrySnapshot(state);
  const serialsAfterDisabled = Object.values(schedule.clocks).map((clock) => clock.serial);
  const enabled = stepIgnitionSources(state, firstDay + 120, true);
  expect(serialsAfterDisabled.some((serial) => serial > 0), "Disabled ignition did not advance source schedules.");
  expect(disabledTelemetry.disabledSkipped > 0 && !disabledTelemetry.enabled, "Disabled opportunities were not exposed in telemetry.");
  expect(enabled.results.length === 0, "Re-enabling ignition processed a disabled-time backlog.");
  expect(state.tileFire.every((fire) => fire === 0), "Disabled ignition mutated fire state.");
}

{
  const state = buildFixture(7004);
  const weather = sampleFireWeatherResponse(state, 240);
  const context = { state, day: 240, weather, storm: null };
  const roadside = source("roadside-human").selectCandidate(context, new RNG(12));
  expect(Boolean(roadside), "Roadside source did not find a candidate.");
  if (roadside) {
    const adjacent = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const x = roadside.x + dx;
      const y = roadside.y + dy;
      if (x < 0 || y < 0 || x >= state.grid.cols || y >= state.grid.rows) return false;
      const idx = y * state.grid.cols + x;
      return state.tiles[idx].type === "road" || state.tileRoadBridge[idx] > 0;
    });
    expect(adjacent, "Roadside candidate was not cardinally adjacent to a road or bridge.");
  }
  const settlement = source("settlement-activity").selectCandidate(context, new RNG(13));
  expect(Boolean(settlement), "Settlement source did not find a candidate.");
  if (settlement) expect(Math.hypot(settlement.x - 22, settlement.y - 18) <= 7, "Settlement candidate escaped its town envelope.");
  const firstStats = getIgnitionCandidateCacheStats(state);
  const originalBase = state.basePoint;
  state.basePoint = { x: 1, y: 1 };
  const remoteBaseCandidate = source("roadside-human").selectCandidate(context, new RNG(44));
  state.basePoint = { x: 9, y: 12 };
  const adjacentBaseCandidate = source("roadside-human").selectCandidate(context, new RNG(44));
  state.basePoint = originalBase;
  expect(remoteBaseCandidate?.idx === adjacentBaseCandidate?.idx, "Changing HQ distance changed source candidate selection.");
  source("roadside-human").selectCandidate(context, new RNG(14));
  const secondStats = getIgnitionCandidateCacheStats(state);
  expect(firstStats.rebuildCount === secondStats.rebuildCount, "Candidate caches rebuilt without a relevant revision.");
}

{
  let state = null;
  let event = null;
  for (let seed = 7100; seed < 7300 && !event; seed += 1) {
    state = buildFixture(seed, 48);
    event = buildConvectiveStormTimeline(state, 0)[0] ?? null;
  }
  expect(Boolean(event && state), "No deterministic convective storm fixture was found.");
  if (event && state) {
    const day = (event.startDay + event.endDay) * 0.5;
    const storm = sampleConvectiveStorm(state, day);
    const context = { state, day, weather: sampleFireWeatherResponse(state, day), storm };
    let candidate = null;
    for (let strikeSeed = 1; strikeSeed <= 64 && !candidate; strikeSeed += 1) {
      candidate = source("lightning").selectCandidate(context, new RNG(strikeSeed));
    }
    expect(Boolean(candidate), "Lightning source did not find a bounded footprint candidate.");
    if (candidate && storm) {
      const dx = candidate.x - storm.centerX * (state.grid.cols - 1);
      const dy = candidate.y - storm.centerY * (state.grid.rows - 1);
      const localX = dx * Math.cos(storm.angle) + dy * Math.sin(storm.angle);
      const localY = -dx * Math.sin(storm.angle) + dy * Math.cos(storm.angle);
      const ellipse = (localX / (storm.radiusX * state.grid.cols)) ** 2 + (localY / (storm.radiusY * state.grid.rows)) ** 2;
      expect(ellipse <= 1.2, "Lightning candidate fell outside the sampled storm footprint.");
    }
  }
}

{
  const state = buildFixture(7005);
  const idx = 12 * state.grid.cols + 12;
  const weather = sampleFireWeatherResponse(state, 240);
  const baseline = calculateIgnitionSuccessProbability(state, idx, 0.4, weather).probability;
  const stronger = calculateIgnitionSuccessProbability(state, idx, 0.8, weather).probability;
  expect(stronger >= baseline, "Increasing source strength lowered success probability.");
  state.tileFuel[idx] *= 0.5;
  const lowerFuel = calculateIgnitionSuccessProbability(state, idx, 0.4, weather).probability;
  state.tileFuel[idx] *= 2;
  expect(baseline >= lowerFuel, "Increasing fuel lowered success probability.");
  state.tileMoisture[idx] = 0.65;
  const wetter = calculateIgnitionSuccessProbability(state, idx, 0.4, weather).probability;
  state.tileMoisture[idx] = 0.12;
  expect(baseline >= wetter, "Increasing dryness lowered success probability.");
  const lowerDanger = calculateIgnitionSuccessProbability(state, idx, 0.4, {
    ...weather,
    ignition: weather.ignition * 0.5,
    climateRisk: weather.climateRisk * 0.5,
    climateIgnitionMultiplier: weather.climateIgnitionMultiplier * 0.5
  }).probability;
  expect(baseline >= lowerDanger, "Increasing fire danger lowered success probability.");
  const fireBefore = state.tileFire[idx];
  const heatBefore = state.tileHeat[idx];
  state.tileFuel[idx] = 0;
  const noFuel = calculateIgnitionSuccessProbability(state, idx, 1, weather);
  expect(noFuel.probability === 0 && noFuel.failureReason === "no-fuel", "Zero fuel was not hard-rejected.");
  expect(state.tileFire[idx] === fireBefore && state.tileHeat[idx] === heatBefore, "Failed resolution mutated fire or heat.");
  state.tileFuel[idx] = 1;
  state.tileSuppressionWetness[idx] = 0.25;
  expect(calculateIgnitionSuccessProbability(state, idx, 1, weather).failureReason === "suppression-blocked", "Blocking wetness was not hard-rejected.");
  state.tileSuppressionWetness[idx] = 0;
  state.tileFire[idx] = 0.1;
  expect(calculateIgnitionSuccessProbability(state, idx, 1, weather).failureReason === "already-burning", "Existing fire was not hard-rejected.");
  state.tileFire[idx] = 0;
  const originalType = state.tiles[idx].type;
  state.tiles[idx].type = "water";
  expect(calculateIgnitionSuccessProbability(state, idx, 1, weather).failureReason === "non-ignitable", "Inert terrain was not hard-rejected.");
  state.tiles[idx].type = originalType;
  commitExternalIgnition(state, idx, 0.7);
  expect(state.tileFire[idx] > 0 && state.fireBoundsActive && state.fireBlockActiveCount > 0, "Successful commit did not activate existing fire bounds/blocks.");
}

{
  const bands = [[], [], [], []];
  for (let seed = 7401; seed <= 7410; seed += 1) {
    const state = buildFixture(seed, 48);
    resetIgnitionSchedule(state, 0);
    for (let year = 1; year <= 15; year += 1) {
      state.year = year;
      const results = stepIgnitionSources(state, year * 360, true).results;
      const incidents = results.filter((result) => result.succeeded).length;
      const band = year === 1 ? 0 : year <= 5 ? 1 : year <= 10 ? 2 : 3;
      bands[band].push(incidents);
      state.tileFire.fill(0);
      state.tileHeat.fill(0);
      state.tiles.forEach((tile) => { tile.fire = 0; tile.heat = 0; });
    }
  }
  const averages = bands.map((values) => values.reduce((sum, value) => sum + value, 0) / values.length);
  const legacyCareerPacingBaseline = [9, 8, 10, 12];
  console.log(`Fixed-seed incident calibration y1=${averages[0].toFixed(2)} y2-5=${averages[1].toFixed(2)} y6-10=${averages[2].toFixed(2)} y11-15=${averages[3].toFixed(2)}`);
  expect(
    averages.every((value, index) => Math.abs(value - legacyCareerPacingBaseline[index]) / legacyCareerPacingBaseline[index] <= 0.2),
    "Aggregate successful incident rate moved more than 20% from the captured legacy career-band pacing."
  );
  expect(averages[3] >= averages[0], "Career pressure did not increase aggregate successful incidents.");
}

console.log("Ignition sources:", IGNITION_SOURCE_REGISTRY.map((entry) => entry.id).join(", "));
if (failures.length) {
  console.error("\nIgnition regression failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log("Ignition regression passed.");
}
