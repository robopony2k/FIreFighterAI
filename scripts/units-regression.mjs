import assert from "node:assert/strict";

import { RNG } from "../dist/core/rng.js";
import { createInitialState, syncTileSoA } from "../dist/core/state.js";
import { applyFuel } from "../dist/core/tiles.js";
import {
  applyCommandIntentToSelection,
  applyExtinguishStep,
  applyUnitHazards,
  assignFormationTargets,
  assignRosterCrew,
  deployUnit,
  recallUnits,
  seedStartingRoster,
  selectCommandUnit,
  setCrewFormation,
  setTruckCrewMode,
  setUnitTarget,
  stepUnits
} from "../dist/sim/units.js";

const createTile = (type = "grass", moisture = 0.2) => ({
  type,
  fuel: 0,
  fire: 0,
  isBase: false,
  elevation: 0.1,
  heat: 0,
  ignitionPoint: 0.8,
  burnRate: 0.7,
  heatOutput: 1,
  spreadBoost: 1,
  heatTransferCap: 5,
  heatRetention: 0.9,
  windFactor: 0.25,
  moisture,
  waterDist: 12,
  vegetationAgeYears: type === "forest" ? 20 : 2,
  canopy: type === "forest" ? 0.5 : 0.05,
  canopyCover: type === "forest" ? 0.5 : 0.05,
  stemDensity: type === "forest" ? 6 : 1,
  dominantTreeType: null,
  treeType: null,
  houseValue: 0,
  houseResidents: 0,
  houseDestroyed: false,
  ashAge: 0
});

const buildState = (seed = 132) => {
  const grid = { cols: 12, rows: 12, totalTiles: 144 };
  const state = createInitialState(seed, grid);
  const rng = new RNG(seed ^ 0x9e3779b9);
  state.tiles = Array.from({ length: grid.totalTiles }, () => {
    const tile = createTile("grass", 0.18);
    applyFuel(tile, tile.moisture, rng);
    return tile;
  });
  state.basePoint = { x: 1, y: 1 };
  state.tiles[state.basePoint.y * grid.cols + state.basePoint.x] = createTile("base", 0.5);
  state.phase = "maintenance";
  state.budget = 10000;
  syncTileSoA(state);
  return { state, rng };
};

const buildDeployedTruckState = (seed = 132) => {
  const { state, rng } = buildState(seed);
  seedStartingRoster(state, rng);
  const truckRoster = state.roster.find((unit) => unit.kind === "truck");
  assert.ok(truckRoster, "starting roster should include a truck");
  state.selectedRosterId = truckRoster.id;
  deployUnit(state, rng, "truck", 8, 8);
  const truck = state.units.find((unit) => unit.kind === "truck");
  assert.ok(truck, "deploying the roster truck should create a truck unit");
  return { state, rng, truck };
};

const getCrew = (state, truck) => truck.crewIds.map((id) => state.units.find((unit) => unit.id === id)).filter(Boolean);

const testStartingRosterAndDeployment = () => {
  const { state, truck } = buildDeployedTruckState(2001);
  const rosterTruck = state.roster.find((unit) => unit.kind === "truck");
  const rosterCrew = state.roster.filter((unit) => unit.kind === "firefighter");
  assert.equal(rosterCrew.length, 2, "starting roster should seed two firefighters");
  assert.equal(rosterTruck.crewIds.length, 2, "starting roster should assign both firefighters to the truck");
  assert.deepEqual(
    rosterCrew.map((unit) => unit.assignedTruckId),
    [rosterTruck.id, rosterTruck.id],
    "starting firefighters should point at their roster truck"
  );
  assert.equal(truck.crewIds.length, 2, "deploying a truck should deploy assigned crew");
  assert.equal(truck.passengerIds.length, 2, "assigned crew should start boarded on the deployed truck");
  assert.equal(getCrew(state, truck).every((unit) => unit.carrierId === truck.id), true, "crew should ride the truck");
  assert.equal(state.commandUnits.length, 1, "deployed truck should create one command unit");
  assert.equal(truck.commandUnitId, state.commandUnits[0].id, "truck should belong to the command unit");
};

const testCommandSelectionAndMovement = () => {
  const { state, truck } = buildDeployedTruckState(2002);
  selectCommandUnit(state, state.commandUnits[0].id);
  assert.deepEqual(state.selectedUnitIds, [truck.id], "command-unit selection should mirror selected truck ids");
  assert.equal(truck.selected, true, "selected command unit should mark its truck selected");
  setUnitTarget(state, truck, 9, 8, true, { silent: true });
  stepUnits(state, 0.25);
  assert.equal(truck.crewMode, "boarded", "manual truck move should keep crew boarded");
  assert.equal(getCrew(state, truck).every((unit) => unit.carrierId === truck.id), true, "boarded crew should follow carrier");
};

const testFormationAndCommandTargets = () => {
  const { state, truck } = buildDeployedTruckState(2003);
  setCrewFormation(state, truck.id, "wide");
  assert.equal(getCrew(state, truck).every((unit) => unit.formation === "wide"), true, "crew formation should update units");
  const rosterTruck = state.roster.find((unit) => unit.id === truck.rosterId);
  assert.equal(
    rosterTruck.crewIds.every((id) => state.roster.find((unit) => unit.id === id)?.formation === "wide"),
    true,
    "crew formation should persist to roster entries"
  );
  assignFormationTargets(state, [truck], { x: 3, y: 3 }, { x: 5, y: 3 });
  assert.deepEqual(truck.target, { x: 4, y: 3 }, "formation drag with one truck should assign midpoint target");
  selectCommandUnit(state, state.commandUnits[0].id);
  applyCommandIntentToSelection(state, {
    type: "move",
    formation: "line",
    behaviourMode: "balanced",
    target: { kind: "line", start: { x: 4, y: 5 }, end: { x: 8, y: 5 } }
  });
  stepUnits(state, 0.1);
  assert.equal(state.commandUnits[0].currentIntent?.formation, "line", "command intent should keep requested formation");
  assert.equal(truck.currentStatus === "moving" || truck.currentStatus === "holding", true, "command should update truck status");
};

const testSuppressionWaterSpendAndRefill = () => {
  const { state, truck } = buildDeployedTruckState(2004);
  setTruckCrewMode(state, truck.id, "deployed", { silent: true });
  const crew = getCrew(state, truck)[0];
  assert.ok(crew, "deployed truck should have a crew member");
  crew.x = 5.5;
  crew.y = 5.5;
  truck.x = 5.5;
  truck.y = 5.5;
  const targetIndex = 5 * state.grid.cols + 6;
  state.tiles[targetIndex].fire = 0.8;
  state.tiles[targetIndex].heat = 1.4;
  state.tileFire[targetIndex] = 0.8;
  state.tileHeat[targetIndex] = 1.4;
  crew.sprayTarget = { x: 6.5, y: 5.5 };
  const waterBefore = truck.water;
  applyExtinguishStep(state, 1);
  assert.equal(truck.water < waterBefore, true, "crew suppression should spend truck water");
  assert.equal(state.tileSuppressionWetness[targetIndex] > 0, true, "suppression should wet the target tile");

  truck.water = 0;
  truck.x = state.basePoint.x + 0.5;
  truck.y = state.basePoint.y + 0.5;
  truck.path = [];
  truck.pathIndex = 0;
  crew.sprayTarget = null;
  stepUnits(state, 1);
  assert.equal(truck.water > 0, true, "truck should refill while stopped on base");
};

const testHazardsAndRecallCleanup = () => {
  const { state, rng, truck } = buildDeployedTruckState(2005);
  selectCommandUnit(state, state.commandUnits[0].id);
  const hazardIndex = Math.floor(truck.y) * state.grid.cols + Math.floor(truck.x);
  state.tileFire[hazardIndex] = 1;
  applyUnitHazards(state, rng, 1000);
  assert.equal(state.units.some((unit) => unit.id === truck.id), false, "lethal fire should remove the truck unit");
  assert.equal(state.roster.find((unit) => unit.id === truck.rosterId)?.status, "lost", "lost truck should mark roster lost");
  assert.equal(state.selectedUnitIds.includes(truck.id), false, "lost selected truck should be cleared from selection");
  assert.equal(state.commandUnits.length, 0, "losing the only truck should clear command units");

  const recall = buildDeployedTruckState(2006).state;
  recallUnits(recall);
  assert.equal(recall.units.length, 0, "recall should remove deployed units");
  assert.equal(recall.roster.every((unit) => unit.status !== "deployed"), true, "recall should return deployed roster units");
  assert.equal(recall.commandUnits.length, 0, "recall should clear command units");
  assert.deepEqual(recall.selectedUnitIds, [], "recall should clear selected units");
};

const testRosterAssignment = () => {
  const { state, rng } = buildState(2007);
  seedStartingRoster(state, rng);
  const extraTruck = state.roster.find((unit) => unit.kind === "truck");
  const firefighter = state.roster.find((unit) => unit.kind === "firefighter");
  assert.ok(extraTruck && firefighter, "starting roster should include assignable units");
  firefighter.assignedTruckId = null;
  extraTruck.crewIds = [];
  assert.equal(assignRosterCrew(state, firefighter.id, extraTruck.id), true, "roster assignment should accept valid crew");
  assert.equal(firefighter.assignedTruckId, extraTruck.id, "assigned firefighter should point to truck");
  assert.deepEqual(extraTruck.crewIds, [firefighter.id], "assigned truck should list crew id");
};

testStartingRosterAndDeployment();
testCommandSelectionAndMovement();
testFormationAndCommandTargets();
testSuppressionWaterSpendAndRefill();
testHazardsAndRecallCleanup();
testRosterAssignment();

console.log("units regression passed");
