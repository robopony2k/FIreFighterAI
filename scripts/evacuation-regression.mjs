import assert from "node:assert/strict";
import { createInitialState } from "../dist/core/state.js";
import { createEvacuationRoute } from "../dist/systems/evacuation/sim/roadRoute.js";
import {
  issueTownEvacuation,
  returnTownEvacuationHome,
  selectTownEvacuationDestination
} from "../dist/systems/evacuation/controllers/evacuationController.js";
import { stepEvacuations } from "../dist/systems/evacuation/sim/evacuationRuntime.js";
import { buildEvacuationRenderModel } from "../dist/systems/evacuation/rendering/evacuationRenderModel.js";

const ROAD_EDGE_N = 1 << 0;
const ROAD_EDGE_E = 1 << 1;
const ROAD_EDGE_S = 1 << 2;
const ROAD_EDGE_W = 1 << 3;

const makeTile = (type = "grass") => ({
  type,
  fuel: type === "house" ? 1 : 0,
  fire: 0,
  isBase: false,
  elevation: 0.5,
  heat: 0,
  ignitionPoint: 1,
  burnRate: 0.1,
  heatOutput: 0,
  spreadBoost: 1,
  heatTransferCap: 0,
  heatRetention: 0.9,
  windFactor: 0,
  moisture: 0.4,
  waterDist: 0,
  vegetationAgeYears: 0,
  canopy: 0,
  canopyCover: 0,
  stemDensity: 0,
  dominantTreeType: null,
  treeType: null,
  houseValue: type === "house" ? 100 : 0,
  houseResidents: type === "house" ? 8 : 0,
  houseDestroyed: false,
  houseDamage01: 0,
  ashAge: 0,
  buildingClass: type === "house" ? "residential_low" : null
});

const makeTown = () => ({
  id: 0,
  name: "Teston",
  x: 0,
  y: 1,
  cx: 0,
  cy: 1,
  radius: 4,
  industryProfile: "general",
  streetArchetype: "main_street",
  growthFrontiers: [],
  growthSeedYear: 0,
  simulatedGrowthYears: 0,
  houseCount: 2,
  housesLost: 0,
  alertPosture: 0,
  alertCooldownDays: 0,
  nonApprovingHouseCount: 0,
  approval: 1,
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
  lastPostureChangeDay: 0,
  desiredHouseDelta: 0,
  lastSeasonHouseDelta: 0,
  growthPressure: 0,
  recoveryPressure: 0,
  buildStartCooldownDays: 0,
  activeBuildCap: 1,
  buildStartSerial: 0
});

const createRoadState = () => {
  const state = createInitialState(1234, { cols: 6, rows: 3, totalTiles: 18 });
  state.tiles = Array.from({ length: state.grid.totalTiles }, () => makeTile());
  for (let x = 0; x < state.grid.cols; x += 1) {
    const idx = 1 * state.grid.cols + x;
    state.tiles[idx] = makeTile("road");
    state.tileRoadEdges[idx] = (x > 0 ? ROAD_EDGE_W : 0) | (x < state.grid.cols - 1 ? ROAD_EDGE_E : 0);
  }
  state.tiles[0] = makeTile("house");
  state.tiles[0].houseTownId = 0;
  state.tileTownId[0] = 0;
  state.tiles[12] = makeTile("house");
  state.tiles[12].houseTownId = 0;
  state.tileTownId[12] = 0;
  state.towns = [makeTown()];
  return state;
};

const createHostTownRoadState = () => {
  const state = createInitialState(4321, { cols: 10, rows: 3, totalTiles: 30 });
  state.tiles = Array.from({ length: state.grid.totalTiles }, () => makeTile());
  for (let x = 0; x < state.grid.cols; x += 1) {
    const idx = 1 * state.grid.cols + x;
    state.tiles[idx] = makeTile("road");
    state.tileRoadEdges[idx] = (x > 0 ? ROAD_EDGE_W : 0) | (x < state.grid.cols - 1 ? ROAD_EDGE_E : 0);
  }
  state.tiles[0] = makeTile("house");
  state.tiles[0].houseTownId = 0;
  state.tileTownId[0] = 0;
  state.tiles[20] = makeTile("house");
  state.tiles[20].houseTownId = 0;
  state.tileTownId[20] = 0;
  const origin = makeTown();
  const host = {
    ...makeTown(),
    id: 1,
    name: "Hoston",
    x: 8,
    y: 1,
    cx: 8,
    cy: 1,
    houseCount: 2
  };
  state.towns = [origin, host];
  state.tileTownId[1 * state.grid.cols + 8] = 1;
  return state;
};

const assertRoute = () => {
  const state = createRoadState();
  const route = createEvacuationRoute(state, 0, { x: 5, y: 1 });
  assert.equal(route.ok, true);
  assert.deepEqual(route.route.tiles.map((tile) => `${tile.x},${tile.y}`), ["0,1", "1,1", "2,1", "3,1", "4,1", "5,1"]);
  const invalid = createEvacuationRoute(state, 0, { x: 5, y: 0 });
  assert.equal(invalid.ok, false);
};

const assertSpawnQueueAndLock = () => {
  const state = createRoadState();
  assert.equal(selectTownEvacuationDestination(state, 0, { x: 5, y: 1 }), true);
  assert.equal(issueTownEvacuation(state, 0), true);
  const active = state.activeEvacuations[0];
  assert.ok(active);
  const lockedRoute = active.route.tiles.map((tile) => `${tile.x},${tile.y}`).join("|");
  stepEvacuations(state, 0.016);
  assert.equal(active.vehicles.length, 1);
  assert.equal(active.populationToSpawn, 8);
  stepEvacuations(state, 0.016);
  assert.equal(active.vehicles.length, 1);
  assert.equal(state.towns[0].populationQueued > 0, true);
  state.tiles[3 + state.grid.cols].type = "grass";
  assert.equal(active.route.tiles.map((tile) => `${tile.x},${tile.y}`).join("|"), lockedRoute);
};

const assertHeatDestruction = () => {
  const state = createRoadState();
  assert.equal(selectTownEvacuationDestination(state, 0, { x: 5, y: 1 }), true);
  assert.equal(issueTownEvacuation(state, 0), true);
  const active = state.activeEvacuations[0];
  stepEvacuations(state, 0.016);
  const vehicle = active.vehicles[0];
  assert.ok(vehicle);
  const idx = Math.floor(vehicle.y) * state.grid.cols + Math.floor(vehicle.x);
  state.tileFire[idx] = 0.9;
  const events = stepEvacuations(state, 0.016);
  assert.equal(events.length, 1);
  assert.equal(events[0].occupants, 8);
  assert.equal(active.obstacles.length, 1);
  assert.equal(active.vehicles[0].status, "destroyed");
  assert.equal(state.towns[0].populationDead, 8);
};

const assertArrivalPersistsAndReturnHome = () => {
  const state = createRoadState();
  assert.equal(selectTownEvacuationDestination(state, 0, { x: 5, y: 1 }), true);
  assert.equal(issueTownEvacuation(state, 0), true);
  const active = state.activeEvacuations[0];
  assert.ok(active);
  for (let i = 0; i < 120; i += 1) {
    stepEvacuations(state, 0.05);
  }
  assert.equal(state.towns[0].evacuationStatus, "Completed");
  assert.equal(state.activeEvacuations.includes(active), true);
  assert.equal(active.phase, "holding");
  assert.equal(active.vehicles.some((vehicle) => vehicle.status === "evacuated"), true);
  assert.equal(active.vehicles.every((vehicle) => vehicle.status === "evacuated"), true);
  assert.equal(active.vehicles.every((vehicle) => vehicle.holdKind === "parked"), true);
  assert.equal(buildEvacuationRenderModel(state).vehicles.length, active.vehicles.length);
  assert.equal(returnTownEvacuationHome(state, 0), true);
  assert.equal(state.towns[0].evacuationStatus, "Returning");
  assert.equal(active.phase, "returning");
  for (let i = 0; i < 120; i += 1) {
    stepEvacuations(state, 0.05);
  }
  assert.equal(state.towns[0].evacuationStatus, "Returned");
  assert.equal(active.phase, "returned");
  assert.equal(active.vehicles.every((vehicle) => vehicle.status === "returned"), true);
  assert.equal(state.towns[0].populationEvacuated, 0);
  assert.equal(state.towns[0].populationRemaining, 16);
};

const assertTerminalCellsDoNotDeadlock = () => {
  const state = createRoadState();
  assert.equal(selectTownEvacuationDestination(state, 0, { x: 5, y: 1 }), true);
  assert.equal(issueTownEvacuation(state, 0), true);
  const active = state.activeEvacuations[0];
  assert.ok(active);
  for (let i = 0; i < 160; i += 1) {
    stepEvacuations(state, 0.05);
  }
  assert.equal(active.phase, "holding");
  assert.equal(active.vehicles.length, 2);
  assert.equal(active.vehicles.every((vehicle) => vehicle.status === "evacuated"), true);
  assert.equal(active.vehicles.some((vehicle) => vehicle.routeIndex >= active.route.tiles.length - 2), true);
  assert.equal(active.vehicles.some((vehicle) => vehicle.status === "queued" || vehicle.status === "moving"), false);
  for (let i = 0; i < 40; i += 1) {
    stepEvacuations(state, 0.05);
  }
  assert.equal(active.phase, "holding");
  assert.equal(active.vehicles.some((vehicle) => vehicle.status === "queued" || vehicle.status === "moving"), false);
};

const assertHostTownHoldingAndApprovalPressure = () => {
  const state = createHostTownRoadState();
  assert.equal(selectTownEvacuationDestination(state, 0, { x: 8, y: 1 }), true);
  assert.equal(issueTownEvacuation(state, 0), true);
  const active = state.activeEvacuations[0];
  assert.ok(active);
  for (let i = 0; i < 220; i += 1) {
    stepEvacuations(state, 0.05);
  }
  assert.equal(active.phase, "holding");
  assert.equal(active.destinationTownId, 1);
  assert.equal(active.vehicles.every((vehicle) => vehicle.status === "evacuated" && vehicle.holdKind === "hosted"), true);
  assert.equal(buildEvacuationRenderModel(state).vehicles.length, 0);
  const originPressureBefore = state.towns[0].nonApprovingHouseCount;
  const hostPressureBefore = state.towns[1].nonApprovingHouseCount;
  stepEvacuations(state, 1);
  assert.equal(state.towns[0].nonApprovingHouseCount > originPressureBefore, true);
  assert.equal(state.towns[1].nonApprovingHouseCount > hostPressureBefore, true);
  assert.equal(returnTownEvacuationHome(state, 0), true);
  assert.equal(buildEvacuationRenderModel(state).vehicles.length, active.vehicles.length);
  for (let i = 0; i < 220; i += 1) {
    stepEvacuations(state, 0.05);
  }
  assert.equal(active.phase, "returned");
  assert.equal(active.vehicles.every((vehicle) => vehicle.status === "returned"), true);
  const originPressureReturned = state.towns[0].nonApprovingHouseCount;
  const hostPressureReturned = state.towns[1].nonApprovingHouseCount;
  stepEvacuations(state, 1);
  assert.equal(state.towns[0].nonApprovingHouseCount, originPressureReturned);
  assert.equal(state.towns[1].nonApprovingHouseCount, hostPressureReturned);
};

assertRoute();
assertSpawnQueueAndLock();
assertHeatDestruction();
assertArrivalPersistsAndReturnHome();
assertTerminalCellsDoNotDeadlock();
assertHostTownHoldingAndApprovalPressure();
console.log("Evacuation regression passed.");
