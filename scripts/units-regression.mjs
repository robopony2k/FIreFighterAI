import assert from "node:assert/strict";

import { RNG } from "../dist/core/rng.js";
import { createEffectsState } from "../dist/core/effectsState.js";
import { createInputState } from "../dist/core/inputState.js";
import { createInitialState, syncTileSoA } from "../dist/core/state.js";
import { applyFuel } from "../dist/core/tiles.js";
import { handleMapFormationDragCommand, handleMapRetaskTileCommand } from "../dist/sim/input/mapTileActions.js";
import { stepSim } from "../dist/sim/index.js";
import { getTruckCrewDeploymentRoles } from "../dist/systems/units/sim/crewReadiness.js";
import { updateTruckWater } from "../dist/systems/units/sim/unitWater.js";
import {
  applyCommandIntentToSelection,
  applyExtinguishStep,
  applyUnitHazards,
  assignFormationTargets,
  assignRosterCrew,
  createFormationTarget,
  createUnit,
  deployUnit,
  ensureDefaultSquads,
  prepareExtinguish,
  recallUnits,
  resolveFormationProjection,
  seedStartingRoster,
  selectCommandUnit,
  setCrewFormation,
  setTruckCrewMode,
  setUnitTarget,
  syncCommandUnits,
  syncProgressionUnitStats,
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
const getNozzleUnits = (state, truck) =>
  getTruckCrewDeploymentRoles(state, truck).hoseOperators.map((assignment) => assignment.unit);

const addRuntimeCrew = (state, rng, truck, x = truck.x, y = truck.y) => {
  const crew = createUnit(state, "firefighter", rng, null);
  crew.x = x;
  crew.y = y;
  crew.prevX = x;
  crew.prevY = y;
  crew.assignedTruckId = truck.id;
  crew.commandUnitId = truck.commandUnitId;
  crew.carrierId = null;
  crew.path = [];
  crew.pathIndex = 0;
  state.units.push(crew);
  truck.crewIds.push(crew.id);
  return crew;
};

const stationCrewAtTruck = (state, truck, carried = false) => {
  getCrew(state, truck).forEach((member) => {
    member.x = truck.x;
    member.y = truck.y;
    member.prevX = truck.x;
    member.prevY = truck.y;
    member.carrierId = carried ? truck.id : null;
    member.path = [];
    member.pathIndex = 0;
    member.attackTarget = null;
    member.sprayTarget = null;
  });
  truck.passengerIds = carried ? getCrew(state, truck).map((member) => member.id) : [];
};

const stopCrewAtCurrentPositions = (state, truck) => {
  getCrew(state, truck).forEach((member) => {
    member.path = [];
    member.pathIndex = 0;
  });
};

const seedSuppressionTarget = (state, x = 6, y = 5) => {
  const targetIndex = y * state.grid.cols + x;
  state.tiles[targetIndex].fire = 0.8;
  state.tiles[targetIndex].heat = 1.4;
  state.tileFire[targetIndex] = 0.8;
  state.tileHeat[targetIndex] = 1.4;
  return targetIndex;
};

const makeCommandIntent = ({
  placementMode = "move",
  fireTask = "suppress",
  target = { kind: "point", point: { x: 5, y: 5 } },
  formation = "line",
  behaviourMode = "balanced"
} = {}) => ({
  type: placementMode,
  placementMode,
  fireTask,
  target,
  formation,
  behaviourMode
});

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

const testFiveCommandUnitSlotsAndSelection = () => {
  const { state, rng } = buildState(2012);
  for (let index = 0; index < 25; index += 1) {
    const truck = createUnit(state, "truck", rng, null);
    truck.x = 1.5 + (index % 10);
    truck.y = 1.5 + Math.floor(index / 10);
    truck.prevX = truck.x;
    truck.prevY = truck.y;
    state.units.push(truck);
  }
  syncCommandUnits(state);
  assert.equal(state.commandUnits.length, 5, "twenty-five deployed trucks should create five command-unit squads");
  assert.deepEqual(
    state.commandUnits.map((commandUnit) => commandUnit.name),
    ["Alpha", "Bravo", "Charlie", "Delta", "Echo"],
    "five command-unit slots should use stable squad callsigns"
  );
  const fifthSquad = state.commandUnits[4];
  assert.ok(fifthSquad, "fifth squad should exist");
  selectCommandUnit(state, fifthSquad.id);
  assert.deepEqual(state.selectedCommandUnitIds, [fifthSquad.id], "fifth squad should be directly selectable");
  assert.deepEqual(state.selectedUnitIds, fifthSquad.truckIds, "fifth squad selection should mirror its truck ids");
  assert.equal(state.commandUnits[5], undefined, "command-unit grouping should not create a sixth squad slot");
};

const testUpgradedHighSpeedMovementConsumesFullRouteBudget = () => {
  const { state, truck } = buildDeployedTruckState(2010);
  const rosterTruck = state.roster.find((unit) => unit.id === truck.rosterId);
  assert.ok(rosterTruck, "deployed truck should have a roster source");
  state.progression.resolved.unitSpeedMultiplier = 4;
  syncProgressionUnitStats(state);
  truck.x = 1.5;
  truck.y = 1.5;
  truck.prevX = truck.x;
  truck.prevY = truck.y;
  truck.path = [
    { x: 2, y: 1 },
    { x: 3, y: 1 },
    { x: 4, y: 1 },
    { x: 5, y: 1 }
  ];
  truck.pathIndex = 0;
  stepUnits(state, 0.25);
  assert.equal(truck.prevX, 1.5, "render interpolation should start from the step-start truck position");
  assert.equal(truck.prevY, 1.5, "render interpolation should preserve the step-start truck row");
  assert.equal(truck.pathIndex, truck.path.length, "upgraded trucks should consume multiple route waypoints per step");
  assert.equal(truck.x, 5.5, "upgraded trucks should finish the reachable route instead of stalling one tile at a time");
  assert.equal(getCrew(state, truck).every((unit) => unit.carrierId === truck.id && unit.x === truck.x), true, "boarded crew should stay synced to upgraded truck motion");
};

const testActiveFireMovementUsesEffectiveMovementDelta = () => {
  const { state, rng, truck } = buildDeployedTruckState(2011);
  state.paused = false;
  state.fireActivityState = "burning";
  state.fireBoundsActive = true;
  state.lastActiveFires = 1;
  truck.x = 1.5;
  truck.y = 1.5;
  truck.prevX = truck.x;
  truck.prevY = truck.y;
  truck.path = [
    { x: 2, y: 1 },
    { x: 3, y: 1 },
    { x: 4, y: 1 },
    { x: 5, y: 1 },
    { x: 6, y: 1 }
  ];
  truck.pathIndex = 0;
  stepSim(state, createEffectsState(), rng, 0.5, { unitDelta: 1.5 });
  assert.equal(truck.prevX, 1.5, "active-fire movement should preserve the step-start interpolation anchor");
  assert.equal(truck.prevY, 1.5, "active-fire movement should preserve the step-start interpolation row");
  assert.equal(truck.pathIndex, truck.path.length, "active-fire caps should not limit truck movement to the lower fire step");
  assert.equal(truck.x, 6.5, "truck movement should use the effective movement delta during active fire work");
  assert.equal(
    getCrew(state, truck).every((unit) => unit.carrierId === truck.id && unit.x === truck.x),
    true,
    "boarded crew should stay synced to active-fire truck motion"
  );
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
  applyCommandIntentToSelection(state, makeCommandIntent({
    placementMode: "move",
    fireTask: "hold_fire",
    formation: "line",
    behaviourMode: "balanced",
    target: { kind: "line", start: { x: 4, y: 5 }, end: { x: 8, y: 5 } }
  }));
  stepUnits(state, 0.1);
  assert.equal(state.commandUnits[0].currentIntent?.formation, "line", "command intent should keep requested formation");
  assert.equal(state.commandUnits[0].currentIntent?.placementMode, "move", "command intent should keep placement mode");
  assert.equal(state.commandUnits[0].currentIntent?.fireTask, "hold_fire", "command intent should keep fire task");
  assert.equal(truck.currentStatus === "moving" || truck.currentStatus === "holding", true, "command should update truck status");
};

const testProjectedFormationTargets = () => {
  const eastLine = createFormationTarget({
    anchor: { x: 6, y: 6 },
    cursor: { x: 10, y: 6 },
    formation: "line",
    count: 3
  });
  assert.equal(eastLine.kind, "formation", "dragged formation should create a formation command target");
  assert.equal(eastLine.widthTiles, 8, "drag distance should control projected formation width");
  const eastLineProjection = resolveFormationProjection(eastLine, "line", 3);
  assert.deepEqual(
    eastLineProjection.slots.map((slot) => Math.round(slot.x)),
    [6, 6, 6],
    "east-facing line should keep slots centered on the anchor x"
  );
  assert.deepEqual(
    eastLineProjection.slots.map((slot) => Math.round(slot.y)),
    [2, 6, 10],
    "east-facing line should spread across the perpendicular axis"
  );

  const eastWedge = resolveFormationProjection(eastLine, "wedge", 3);
  const southTarget = createFormationTarget({
    anchor: { x: 6, y: 6 },
    cursor: { x: 6, y: 10 },
    formation: "wedge",
    count: 3
  });
  const southWedge = resolveFormationProjection(southTarget, "wedge", 3);
  assert.notDeepEqual(
    eastWedge.slots.map((slot) => `${Math.round(slot.x)},${Math.round(slot.y)}`),
    southWedge.slots.map((slot) => `${Math.round(slot.x)},${Math.round(slot.y)}`),
    "wedge slot projection should rotate with facing"
  );

  const eastArc = resolveFormationProjection(eastLine, "arc", 4);
  const southArc = resolveFormationProjection(southTarget, "arc", 4);
  assert.notDeepEqual(
    eastArc.slots.map((slot) => `${Math.round(slot.x)},${Math.round(slot.y)}`),
    southArc.slots.map((slot) => `${Math.round(slot.x)},${Math.round(slot.y)}`),
    "arc slot projection should rotate with facing"
  );
};

const testMapActionsCommitProjectedTargets = () => {
  const { state, rng, truck } = buildDeployedTruckState(2013);
  selectCommandUnit(state, state.commandUnits[0].id);
  const inputState = createInputState();
  handleMapRetaskTileCommand({ state, inputState, tile: { x: 6, y: 6 } });
  assert.equal(
    state.commandUnits[0].currentIntent?.target.kind,
    "point",
    "short right-click retask should keep point target behavior"
  );

  const projection = createFormationTarget({
    anchor: { x: 5, y: 5 },
    cursor: { x: 9, y: 5 },
    formation: "line",
    count: 1
  });
  handleMapFormationDragCommand({
    state,
    rng,
    inputState,
    start: { x: 5, y: 5 },
    end: { x: 9, y: 5 },
    projection
  });
  assert.equal(
    state.commandUnits[0].currentIntent?.target.kind,
    "formation",
    "held right-click drag should commit a projected formation target"
  );
  assert.equal(truck.truckOverrideIntent, null, "command-unit formation order should not create truck overrides");
};

const testPendingSquadDispatchProjection = () => {
  const { state, rng } = buildState(2014);
  seedStartingRoster(state, rng);
  ensureDefaultSquads(state);
  const squad = state.squads[0];
  assert.ok(squad, "default HQ squad should exist");
  const inputState = createInputState();
  inputState.pendingSquadDispatchId = squad.id;
  inputState.dispatchFormation = "line";
  const projection = createFormationTarget({
    anchor: { x: 5, y: 5 },
    cursor: { x: 9, y: 5 },
    formation: "line",
    count: Math.max(1, squad.truckRosterIds.length)
  });
  handleMapFormationDragCommand({
    state,
    rng,
    inputState,
    start: { x: 5, y: 5 },
    end: { x: 9, y: 5 },
    projection
  });
  const commandUnit = state.commandUnits.find((entry) => entry.squadId === squad.id);
  assert.ok(commandUnit, "projected dispatch should field the pending squad");
  assert.equal(inputState.pendingSquadDispatchId, null, "successful projected dispatch should clear pending squad state");
  assert.equal(commandUnit.currentIntent?.target.kind, "formation", "projected dispatch should commit a formation target");
};

const testSuppressionWaterSpendAndRefill = () => {
  const { state, truck } = buildDeployedTruckState(2004);
  setTruckCrewMode(state, truck.id, "deployed", { silent: true, immediate: true });
  const nozzle = getNozzleUnits(state, truck)[0];
  assert.ok(nozzle, "deployed truck should have a nozzle operator");
  nozzle.x = 5.5;
  nozzle.y = 5.5;
  truck.x = 5.5;
  truck.y = 5.5;
  const targetIndex = seedSuppressionTarget(state);
  nozzle.sprayTarget = { x: 6.5, y: 5.5 };
  const waterBefore = truck.water;
  applyExtinguishStep(state, 1);
  assert.equal(truck.water < waterBefore, true, "crew suppression should spend truck water");
  assert.equal(state.tileSuppressionWetness[targetIndex] > 0, true, "suppression should wet the target tile");

  truck.water = 0;
  truck.x = state.basePoint.x + 0.5;
  truck.y = state.basePoint.y + 0.5;
  truck.path = [];
  truck.pathIndex = 0;
  nozzle.sprayTarget = null;
  stepUnits(state, 1);
  assert.equal(truck.water > 0, true, "truck should refill while stopped on base");
};

const testTownWaterTowerRefillSource = () => {
  const { state, rng, truck } = buildDeployedTruckState(2024);
  const tower = {
    id: 1,
    typeId: "town-water-tower",
    townId: 0,
    x: 5,
    y: 5,
    capacity: 100,
    water: 12,
    serviceRadius: 3.25,
    active: true,
    builtCareerDay: 0
  };
  state.waterTowers = [tower];
  state.nextWaterTowerId = 2;
  truck.x = 5.5;
  truck.y = 5.5;
  truck.prevX = truck.x;
  truck.prevY = truck.y;
  truck.path = [];
  truck.pathIndex = 0;
  truck.water = 0;

  updateTruckWater(state, truck, 1);
  const firstRefill = Math.min(truck.waterRefillRate, 12);
  assert.equal(truck.water, firstRefill, "stopped trucks should refill from nearby water towers");
  assert.equal(tower.water, 12 - firstRefill, "tower reservoirs should drain by the transferred amount");

  tower.water = 100;
  truck.water = truck.waterCapacity - 2;
  updateTruckWater(state, truck, 1);
  assert.equal(truck.water, truck.waterCapacity, "tower refill should clamp to truck capacity");
  assert.equal(tower.water, 98, "tower drain should clamp to the truck deficit");

  truck.x = 10.5;
  truck.y = 10.5;
  truck.water = 0;
  updateTruckWater(state, truck, 1);
  assert.equal(truck.water, 0, "trucks outside tower service radius should not refill from towers");

  truck.x = 5.5;
  truck.y = 5.5;
  truck.path = [{ x: 6, y: 5 }];
  truck.pathIndex = 0;
  tower.water = 100;
  updateTruckWater(state, truck, 1);
  assert.equal(truck.water, 0, "moving trucks should not draw from tower reservoirs");

  truck.path = [];
  truck.pathIndex = 0;
  truck.water = 5;
  const crew = addRuntimeCrew(state, rng, truck, 5.5, 5.5);
  crew.sprayTarget = { x: 6.5, y: 5.5 };
  tower.water = 100;
  updateTruckWater(state, truck, 1);
  assert.equal(truck.water, 5, "actively spraying truck groups should not refill from towers");
  assert.equal(tower.water, 100, "active spraying should not drain a tower reservoir");
};

const testTruckDoesNotSprayDirectly = () => {
  const { state, rng, truck } = buildDeployedTruckState(2015);
  truck.x = 2.5;
  truck.y = 5.5;
  truck.sprayTarget = { x: 6.5, y: 5.5 };
  seedSuppressionTarget(state);
  const effects = createEffectsState();
  prepareExtinguish(state, effects, rng);
  assert.equal(truck.sprayTarget, null, "prepareExtinguish should clear truck spray targets");
  assert.equal(
    effects.waterStreams.some((stream) => stream.sourceUnitId === truck.id),
    false,
    "trucks should never emit water streams directly"
  );
};

const testCrewThresholdsAndHoseSlots = () => {
  const { state, rng, truck } = buildDeployedTruckState(2016);
  truck.x = 2.5;
  truck.y = 5.5;
  truck.prevX = truck.x;
  truck.prevY = truck.y;
  const crew = getCrew(state, truck);
  const stationCrew = () => {
    getCrew(state, truck).forEach((member) => {
      member.x = 2.5;
      member.y = 5.5;
      member.prevX = member.x;
      member.prevY = member.y;
      member.carrierId = null;
      member.path = [];
      member.pathIndex = 0;
    });
  };
  stationCrew();
  setTruckCrewMode(state, truck.id, "deployed", { silent: true, immediate: true });
  stopCrewAtCurrentPositions(state, truck);
  seedSuppressionTarget(state, 6, 5);
  seedSuppressionTarget(state, 6, 6);

  let effects = createEffectsState();
  prepareExtinguish(state, effects, rng);
  assert.equal(effects.waterStreams.length, 1, "two crew should operate one hose by default");
  let roles = getTruckCrewDeploymentRoles(state, truck);
  assert.equal(roles.driver?.unit.carrierId, truck.id, "two-crew deployment should keep the driver hidden in the truck");
  assert.equal(roles.pumpOperator, null, "two-crew deployment should not invent a pump-side support firefighter");
  assert.equal(roles.hoseOperators.length, 1, "two-crew deployment should assign one nozzle operator");
  assert.equal(roles.hoseOperators[0].unit.carrierId, null, "two-crew nozzle operator should be visible");
  assert.equal(roles.driver?.unit.sprayTarget, null, "hidden driver should not receive a spray target");

  const extraA = addRuntimeCrew(state, rng, truck, 2.5, 6.5);
  stationCrew();
  setTruckCrewMode(state, truck.id, "deployed", { silent: true, immediate: true });
  stopCrewAtCurrentPositions(state, truck);
  effects = createEffectsState();
  prepareExtinguish(state, effects, rng);
  assert.equal(effects.waterStreams.length, 1, "three crew should still operate one hose by default");
  roles = getTruckCrewDeploymentRoles(state, truck);
  assert.equal(roles.pumpOperator?.unit.carrierId, null, "third crew should deploy as pump-side support");
  assert.equal(roles.pumpOperator?.unit.sprayTarget, null, "pump-side support should not spray");

  const extraB = addRuntimeCrew(state, rng, truck, 2.5, 4.5);
  stationCrew();
  setTruckCrewMode(state, truck.id, "deployed", { silent: true, immediate: true });
  stopCrewAtCurrentPositions(state, truck);
  effects = createEffectsState();
  prepareExtinguish(state, effects, rng);
  assert.equal(effects.waterStreams.length, 1, "four crew should still operate one hose before the second-hose unlock");
  roles = getTruckCrewDeploymentRoles(state, truck);
  assert.equal(roles.assistants.length, 1, "fourth crew should be support before the second-hose unlock");
  assert.equal(roles.assistants.every((assignment) => assignment.unit.sprayTarget === null), true, "support crew should not spray");
  getCrew(state, truck).forEach((member) => {
    member.sprayTarget = null;
  });
  const supportMember = roles.pumpOperator?.unit;
  assert.ok(supportMember, "four-crew deployment should include pump-side support");
  supportMember.sprayTarget = { x: 6.5, y: 5.5 };
  const waterBeforeSupportCheck = truck.water;
  applyExtinguishStep(state, 1);
  assert.equal(truck.water, waterBeforeSupportCheck, "support crew should not spend truck water");
  assert.equal(supportMember.sprayTarget, null, "support crew should have invalid spray targets cleared");

  state.progression.resolved.truckHoseSlotBonus = 1;
  effects = createEffectsState();
  prepareExtinguish(state, effects, rng);
  assert.equal(effects.waterStreams.length, 2, "four crew plus Dual Line Operations should operate two hoses");
  roles = getTruckCrewDeploymentRoles(state, truck);
  assert.equal(roles.hoseOperators.length, 2, "four crew plus Dual Line Operations should assign two nozzle operators");

  const rangeBefore = crew[0].hoseRange;
  const extraC = addRuntimeCrew(state, rng, truck, 3.5, 5.5);
  stationCrew();
  setTruckCrewMode(state, truck.id, "deployed", { silent: true, immediate: true });
  stopCrewAtCurrentPositions(state, truck);
  effects = createEffectsState();
  prepareExtinguish(state, effects, rng);
  assert.equal(effects.waterStreams.length, 2, "five crew should keep the unlocked two-hose cap");
  roles = getTruckCrewDeploymentRoles(state, truck);
  assert.equal(roles.assistants.length, 1, "fifth crew should support existing hose work rather than add a third stream");
  assert.equal(
    [extraA, extraB, extraC].every((member) => member.assignedTruckId === truck.id),
    true,
    "extra runtime crew should remain assigned to the truck"
  );
  assert.equal(crew[0].hoseRange, rangeBefore, "crew-size range boosts should be runtime-derived, not mutate base stats");
};

const testUnderCrewedMovementAndSuppression = () => {
  const { state, rng, truck } = buildDeployedTruckState(2017);
  const crew = getCrew(state, truck);
  crew.forEach((member) => {
    member.carrierId = null;
    member.assignedTruckId = null;
  });
  truck.crewIds = [];
  truck.passengerIds = [];
  truck.x = 1.5;
  truck.y = 1.5;
  setUnitTarget(state, truck, 4, 1, true, { silent: true });
  stepUnits(state, 1);
  assert.equal(truck.x, 1.5, "zero-crew trucks should not move");
  assert(truck.currentAlerts.includes("driver_missing"), "zero-crew trucks should report missing driver");

  const driver = crew[0];
  assert.ok(driver, "test truck should have a reusable crew unit");
  driver.assignedTruckId = truck.id;
  driver.carrierId = truck.id;
  driver.x = truck.x;
  driver.y = truck.y;
  truck.crewIds = [driver.id];
  truck.passengerIds = [driver.id];
  stepUnits(state, 1);
  assert.equal(truck.x > 1.5, true, "one-crew trucks should be able to drive");

  setTruckCrewMode(state, truck.id, "deployed", { silent: true, immediate: true });
  driver.x = 5.5;
  driver.y = 5.5;
  driver.path = [];
  driver.pathIndex = 0;
  truck.x = 5.5;
  truck.y = 5.5;
  seedSuppressionTarget(state);
  const effects = createEffectsState();
  prepareExtinguish(state, effects, rng);
  assert.equal(effects.waterStreams.length, 0, "one-crew trucks should not operate a hose");
};

const testBoardingAndDisembarkDelays = () => {
  const { state, rng, truck } = buildDeployedTruckState(2018);
  const crew = getCrew(state, truck);
  setTruckCrewMode(state, truck.id, "deployed", { silent: true, immediate: true });
  truck.x = 1.5;
  truck.y = 1.5;
  crew.forEach((member, index) => {
    member.carrierId = null;
    member.x = 3.5 + index;
    member.y = 1.5;
    member.path = [];
    member.pathIndex = 0;
  });
  setUnitTarget(state, truck, 8, 1, true, { silent: true });
  stepUnits(state, 0.25);
  assert.equal(truck.x, 1.5, "movement orders should wait while crew boards");
  assert.equal(truck.crewMode, "boarding", "movement orders should start a boarding transition");
  for (let i = 0; i < 20 && truck.x <= 1.5; i += 1) {
    stepUnits(state, 0.5);
  }
  assert.equal(truck.x > 1.5, true, "truck should move after crew finishes boarding");

  truck.x = 2.5;
  truck.y = 5.5;
  truck.prevX = truck.x;
  truck.prevY = truck.y;
  truck.path = [];
  truck.pathIndex = 0;
  crew.forEach((member) => {
    member.carrierId = truck.id;
    member.x = truck.x;
    member.y = truck.y;
    member.path = [];
    member.pathIndex = 0;
  });
  truck.passengerIds = crew.map((member) => member.id);
  seedSuppressionTarget(state);
  setTruckCrewMode(state, truck.id, "deployed", { silent: true });
  let effects = createEffectsState();
  prepareExtinguish(state, effects, rng);
  assert.equal(effects.waterStreams.length, 0, "crew should not spray while disembarking");
  for (let i = 0; i < 20; i += 1) {
    stepUnits(state, 0.25);
  }
  effects = createEffectsState();
  prepareExtinguish(state, effects, rng);
  assert.equal(effects.waterStreams.length > 0, true, "crew should spray after disembarking and reaching hose positions");
};

const testFireTasksDoNotMoveTrucks = () => {
  const { state, truck } = buildDeployedTruckState(2019);
  selectCommandUnit(state, state.commandUnits[0].id);
  truck.x = 5.5;
  truck.y = 5.5;
  truck.prevX = truck.x;
  truck.prevY = truck.y;
  truck.path = [];
  truck.pathIndex = 0;
  truck.target = null;
  setTruckCrewMode(state, truck.id, "deployed", { silent: true, immediate: true });
  stationCrewAtTruck(state, truck);
  seedSuppressionTarget(state, 6, 5);

  for (const fireTask of ["suppress", "contain", "backburn"]) {
    truck.target = null;
    truck.path = [];
    truck.pathIndex = 0;
    applyCommandIntentToSelection(
      state,
      makeCommandIntent({
        placementMode: "deploy",
        fireTask,
        target:
          fireTask === "backburn"
            ? { kind: "area", start: { x: 4, y: 4 }, end: { x: 5, y: 5 } }
            : { kind: "point", point: { x: 5, y: 5 } },
        formation: fireTask === "backburn" ? "area" : "line"
      })
    );
    stepUnits(state, 0.1);
    assert.equal(truck.target, null, `${fireTask} task should not assign truck movement when already placed`);
    assert.equal(truck.path.length, 0, `${fireTask} task should not create a truck path when already placed`);
  }
};

const testCommandMoveAndDeployOwnership = () => {
  const { state, truck } = buildDeployedTruckState(2020);
  selectCommandUnit(state, state.commandUnits[0].id);
  setTruckCrewMode(state, truck.id, "deployed", { silent: true, immediate: true });
  truck.x = 1.5;
  truck.y = 1.5;
  truck.prevX = truck.x;
  truck.prevY = truck.y;
  stationCrewAtTruck(state, truck);
  applyCommandIntentToSelection(
    state,
    makeCommandIntent({
      placementMode: "move",
      fireTask: "hold_fire",
      target: { kind: "point", point: { x: 8, y: 1 } }
    })
  );
  stepUnits(state, 0.25);
  assert.equal(truck.x, 1.5, "move command should wait for deployed crew to board");
  assert.equal(truck.crewMode, "boarding", "move command should start boarding before truck movement");
  for (let i = 0; i < 30 && truck.x < 8.5; i += 1) {
    stepUnits(state, 0.5);
  }
  assert.equal(truck.crewMode, "boarded", "move command should leave crew boarded after arrival");
  assert.equal(getCrew(state, truck).every((member) => member.carrierId === truck.id), true, "move command should keep crew on the truck");

  seedSuppressionTarget(state, 9, 1);
  applyCommandIntentToSelection(
    state,
    makeCommandIntent({
      placementMode: "deploy",
      fireTask: "suppress",
      target: { kind: "point", point: { x: 8, y: 1 } }
    })
  );
  for (let i = 0; i < 30 && truck.crewMode !== "deployed"; i += 1) {
    stepUnits(state, 0.25);
  }
  assert.equal(truck.crewMode, "deployed", "deploy command should disembark crew after the truck reaches its player placement");
};

const testDeployAtCurrentPositionDisembarksCrew = () => {
  const { state, truck } = buildDeployedTruckState(2023);
  selectCommandUnit(state, state.commandUnits[0].id);
  truck.x = 5.5;
  truck.y = 5.5;
  truck.prevX = truck.x;
  truck.prevY = truck.y;
  truck.path = [];
  truck.pathIndex = 0;
  stationCrewAtTruck(state, truck, true);
  truck.crewMode = "boarded";
  truck.crewAction = null;
  seedSuppressionTarget(state, 6, 5);
  applyCommandIntentToSelection(
    state,
    makeCommandIntent({
      placementMode: "deploy",
      fireTask: "suppress",
      target: { kind: "point", point: { x: 5, y: 5 } }
    })
  );
  stepUnits(state, 0.1);
  assert.equal(truck.crewMode, "disembarking", "deploy at the current position should start disembarking immediately");
  for (let i = 0; i < 20 && truck.crewMode !== "deployed"; i += 1) {
    stepUnits(state, 0.25);
  }
  assert.equal(truck.crewMode, "deployed", "deploy at the current position should finish with deployed crew");
  const roles = getTruckCrewDeploymentRoles(state, truck);
  assert.equal(roles.driver?.unit.carrierId, truck.id, "deployed driver should remain hidden in the truck");
  assert.equal(roles.visibleCrew.every((assignment) => assignment.unit.carrierId === null), true, "visible deployed roles should leave the truck");
};

const testStanceDoesNotRepositionPlacedTruck = () => {
  const { state, truck } = buildDeployedTruckState(2021);
  selectCommandUnit(state, state.commandUnits[0].id);
  truck.x = 5.5;
  truck.y = 5.5;
  truck.prevX = truck.x;
  truck.prevY = truck.y;
  truck.path = [];
  truck.pathIndex = 0;
  truck.target = null;
  setTruckCrewMode(state, truck.id, "deployed", { silent: true, immediate: true });
  stationCrewAtTruck(state, truck);
  seedSuppressionTarget(state, 6, 5);
  applyCommandIntentToSelection(
    state,
    makeCommandIntent({
      placementMode: "deploy",
      fireTask: "suppress",
      behaviourMode: "defensive",
      target: { kind: "point", point: { x: 5, y: 5 } }
    })
  );
  stepUnits(state, 0.1);
  assert.equal(truck.target, null, "defensive stance should not reposition a safe placed truck");
  assert.equal(truck.crewMode, "deployed", "defensive stance should not reboard a safe placed truck");

  const truckIndex = Math.floor(truck.y) * state.grid.cols + Math.floor(truck.x);
  state.tileFire[truckIndex] = 0.4;
  state.tileHeat[truckIndex] = 0.6;
  stepUnits(state, 0.1);
  assert.equal(truck.currentStatus, "retreating", "defensive stance may retreat only when the truck tile is unsafe");
  assert.notEqual(truck.target, null, "unsafe defensive retreat should assign a truck movement target");
};

const testOutOfRangeSuppressionRequiresPlayerPlacement = () => {
  const { state, rng, truck } = buildDeployedTruckState(2022);
  selectCommandUnit(state, state.commandUnits[0].id);
  truck.x = 1.5;
  truck.y = 1.5;
  truck.prevX = truck.x;
  truck.prevY = truck.y;
  truck.path = [];
  truck.pathIndex = 0;
  truck.target = null;
  setTruckCrewMode(state, truck.id, "deployed", { silent: true, immediate: true });
  stationCrewAtTruck(state, truck);
  seedSuppressionTarget(state, 11, 11);
  applyCommandIntentToSelection(
    state,
    makeCommandIntent({
      placementMode: "deploy",
      fireTask: "suppress",
      target: { kind: "point", point: { x: 1, y: 1 } }
    })
  );
  stepUnits(state, 0.1);
  const effects = createEffectsState();
  prepareExtinguish(state, effects, rng);
  assert.equal(truck.target, null, "out-of-range suppression should not move the truck automatically");
  assert.equal(effects.waterStreams.length, 0, "out-of-range suppression should not create hose streams");
  assert(truck.currentAlerts.includes("out_of_range"), "out-of-range suppression should report an out-of-range alert");
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
testFiveCommandUnitSlotsAndSelection();
testUpgradedHighSpeedMovementConsumesFullRouteBudget();
testActiveFireMovementUsesEffectiveMovementDelta();
testFormationAndCommandTargets();
testProjectedFormationTargets();
testMapActionsCommitProjectedTargets();
testPendingSquadDispatchProjection();
testSuppressionWaterSpendAndRefill();
testTownWaterTowerRefillSource();
testTruckDoesNotSprayDirectly();
testCrewThresholdsAndHoseSlots();
testUnderCrewedMovementAndSuppression();
testBoardingAndDisembarkDelays();
testFireTasksDoNotMoveTrucks();
testCommandMoveAndDeployOwnership();
testDeployAtCurrentPositionDisembarksCrew();
testStanceDoesNotRepositionPlacedTruck();
testOutOfRangeSuppressionRequiresPlayerPlacement();
testHazardsAndRecallCleanup();
testRosterAssignment();

console.log("units regression passed");
