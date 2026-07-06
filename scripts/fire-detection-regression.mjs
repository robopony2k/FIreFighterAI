import assert from "node:assert/strict";

import { RNG } from "../dist/core/rng.js";
import { computeChecksum, createInitialState, syncTileSoA } from "../dist/core/state.js";
import { applyFuel } from "../dist/core/tiles.js";
import {
  buildWatchTowerForTown,
  getWatchTowerForTown,
  stepFireDetection,
  upgradeWatchTowerForTown
} from "../dist/systems/fire/sim/fireDetection.js";
import { captureFireRenderSnapshot } from "../dist/systems/fire/rendering/fireRenderSnapshot.js";

const createTile = () => ({
  type: "forest",
  fuel: 0.75,
  fire: 0,
  isBase: false,
  elevation: 0.2,
  heat: 0,
  ignitionPoint: 0.8,
  burnRate: 0.7,
  heatOutput: 1,
  spreadBoost: 1,
  heatTransferCap: 5,
  heatRetention: 0.9,
  windFactor: 0.35,
  moisture: 0.12,
  waterDist: 12,
  vegetationAgeYears: 18,
  canopy: 0.55,
  canopyCover: 0.55,
  stemDensity: 6,
  dominantTreeType: null,
  treeType: null,
  houseValue: 0,
  houseResidents: 0,
  houseDestroyed: false,
  ashAge: 0
});

const createTown = (id, x, y, radius = 2) => ({
  id,
  name: `Town ${id}`,
  x,
  y,
  cx: x,
  cy: y,
  radius,
  industryProfile: "general",
  streetArchetype: "crossroads",
  growthFrontiers: [],
  growthSeedYear: 1,
  simulatedGrowthYears: 0,
  houseCount: 4,
  housesLost: 0,
  alertPosture: 0,
  alertCooldownDays: 0,
  nonApprovingHouseCount: 0,
  approval: 0.7,
  evacState: "none",
  evacProgress: 0,
  evacuationStatus: "None",
  populationRemaining: 0,
  populationQueued: 0,
  populationEvacuating: 0,
  populationEvacuated: 0,
  populationDead: 0,
  vehiclesQueued: 0,
  vehiclesMoving: 0,
  vehiclesDestroyed: 0,
  growthPressure: 0,
  recoveryPressure: 0,
  buildStartCooldownDays: 0,
  activeBuildCap: 0,
  buildStartSerial: 0
});

const createUnit = (id, x, y) => ({
  id,
  kind: "truck",
  rosterId: null,
  autonomous: false,
  x,
  y,
  prevX: x,
  prevY: y,
  target: null,
  path: [],
  pathIndex: 0,
  speed: 1,
  radius: 1,
  hoseRange: 4,
  power: 1,
  selected: false,
  carrierId: null,
  passengerIds: [],
  assignedTruckId: null,
  commandUnitId: null,
  crewIds: [],
  crewMode: "boarded",
  crewAction: null,
  formation: "medium",
  behaviourMode: "balanced",
  attackTarget: null,
  sprayTarget: null,
  truckOverrideIntent: null,
  water: 100,
  waterCapacity: 100,
  waterRefillRate: 0,
  lastBackburnAt: -1,
  currentStatus: "holding",
  currentAlerts: []
});

const buildState = (seed = 901, size = 65) => {
  const grid = { cols: size, rows: size, totalTiles: size * size };
  const state = createInitialState(seed, grid);
  const rng = new RNG(seed);
  state.tiles = Array.from({ length: grid.totalTiles }, () => {
    const tile = createTile();
    applyFuel(tile, tile.moisture, rng);
    return tile;
  });
  state.totalLandTiles = grid.totalTiles;
  syncTileSoA(state);
  return state;
};

const ignite = (state, x, y) => {
  const idx = y * state.grid.cols + x;
  const tile = state.tiles[idx];
  tile.fire = 0.9;
  tile.heat = 2.4;
  state.tileFire[idx] = tile.fire;
  state.tileHeat[idx] = tile.heat;
  state.lastActiveFires = 1;
  state.fireActivityState = "burning";
  state.fireBoundsActive = true;
  state.fireMinX = Math.max(0, x - 1);
  state.fireMaxX = Math.min(state.grid.cols - 1, x + 1);
  state.fireMinY = Math.max(0, y - 1);
  state.fireMaxY = Math.min(state.grid.rows - 1, y + 1);
  return idx;
};

{
  const state = buildState();
  const idx = ignite(state, 32, 32);
  const checksumBefore = computeChecksum(state);
  const result = stepFireDetection(state, 0.5);
  assert.equal(result.activeReportCount, 0, "uncovered fire should not create a player report");
  assert.equal(state.fireKnowledge.tileState[idx], 0, "uncovered burning tile should remain unknown");
  const snapshot = captureFireRenderSnapshot(state, null);
  assert.equal(snapshot.lastActiveFires > 0, true, "unknown fire should still be visible to 3D fire rendering");
  assert.equal(snapshot.tileFire.some((value) => value > 0), true, "3D fire snapshot should not be gated by detection");
  assert.equal(computeChecksum(state), checksumBefore, "fire knowledge must not alter legacy checksum");
  console.log("unknown fire: ok");
}

{
  const state = buildState();
  state.phase = "maintenance";
  state.budget = 5000;
  state.towns = [createTown(1, 32, 32, 2)];
  assert.equal(buildWatchTowerForTown(state, 1).ok, true, "tower should build");
  const tower = getWatchTowerForTown(state, 1);
  assert.equal(Math.hypot(tower.x - 32, tower.y - 32) > 2, true, "tower should be built near, not inside, town");
  state.phase = "fire";
  const fireX = Math.max(1, Math.min(state.grid.cols - 2, Math.round(tower.x + 4)));
  const fireY = Math.max(1, Math.min(state.grid.rows - 2, Math.round(tower.y)));
  const idx = ignite(state, fireX, fireY);
  const result = stepFireDetection(state, 0.25);
  assert.equal(result.activeReportCount > 0, true, "tower should detect in-radius fire");
  assert.equal(state.fireKnowledge.tileState[idx] > 0, true, "in-radius fire should become known");
  assert.equal(result.alertReport?.confidenceLabel, "Medium", "initial tower alert should be medium confidence");
  console.log("tower in radius: ok");
}

{
  const state = buildState();
  state.phase = "maintenance";
  state.budget = 5000;
  state.towns = [createTown(1, 10, 10, 2)];
  assert.equal(buildWatchTowerForTown(state, 1).ok, true, "tower should build");
  state.phase = "fire";
  const idx = ignite(state, 44, 44);
  const result = stepFireDetection(state, 1);
  assert.equal(result.activeReportCount, 0, "out-of-radius fire should stay hidden");
  assert.equal(state.fireKnowledge.tileState[idx], 0, "out-of-radius tile should remain unknown");
  console.log("tower out of radius: ok");
}

{
  const state = buildState();
  state.towns = [createTown(2, 32, 32, 3)];
  const idx = ignite(state, 36, 32);
  const result = stepFireDetection(state, 0.01);
  assert.equal(result.activeReportCount, 1, "town fallback should reveal nearby fire");
  assert.equal(state.fireKnowledge.tileState[idx] >= 2, true, "town fallback should confirm nearby fire");
  console.log("town fallback: ok");
}

{
  const state = buildState();
  state.units = [createUnit(1, 32, 32)];
  const idx = ignite(state, 37, 32);
  const result = stepFireDetection(state, 0.01);
  assert.equal(result.activeReportCount, 1, "unit fallback should reveal nearby fire");
  assert.equal(state.fireKnowledge.tileState[idx] >= 2, true, "unit fallback should confirm nearby fire");
  console.log("unit fallback: ok");
}

{
  const state = buildState();
  state.phase = "maintenance";
  state.budget = 5000;
  state.towns = [createTown(3, 32, 32, 2)];
  assert.equal(buildWatchTowerForTown(state, 3).ok, true, "tower should build");
  const level1 = { ...getWatchTowerForTown(state, 3) };
  assert.equal(upgradeWatchTowerForTown(state, 3).ok, true, "tower should upgrade to level 2");
  const level2 = { ...getWatchTowerForTown(state, 3) };
  assert.equal(upgradeWatchTowerForTown(state, 3).ok, true, "tower should upgrade to level 3");
  const level3 = getWatchTowerForTown(state, 3);
  assert.equal(level2.detectionRadius > level1.detectionRadius, true, "level 2 should improve radius");
  assert.equal(level2.detectionDelayDays < level1.detectionDelayDays, true, "level 2 should improve delay");
  assert.equal(level3.accuracyRadius < level2.accuracyRadius, true, "level 3 should improve accuracy");
  console.log("tower upgrades: ok");
}

console.log("\nFire detection regression passed.");
