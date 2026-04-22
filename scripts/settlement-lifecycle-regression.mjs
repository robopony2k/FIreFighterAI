import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const distImport = (segments) => pathToFileURL(path.join(repoRoot, "dist", ...segments)).href;

const { createInitialState, syncTileSoA } = await import(distImport(["core", "state.js"]));
const {
  findBestRoadReferenceForPlot,
  pickHouseRotationFromRoadMask
} = await import(distImport(["core", "roadAlignment.js"]));
const {
  placeHouse,
  destroyHouse
} = await import(distImport(["core", "towns.js"]));
const { PHASES } = await import(distImport(["core", "time.js"]));
const { RNG } = await import(distImport(["core", "rng.js"]));
const { hash2D } = await import(distImport(["mapgen", "noise.js"]));
const {
  backfillRoadEdgesFromAdjacency,
  carveRoad,
  clearRoadEdges,
  collectRoadTiles,
  findNearestRoadTile,
  pruneRoadDiagonalStubs
} = await import(distImport(["mapgen", "roads.js"]));
const { stepTownConstructionSchedule } = await import(
  distImport(["systems", "settlements", "sim", "townConstruction.js"])
);
const { reserveTownExpansionLot, rebuildGrowthContext, simulateTownGrowthYears, tryDensifyTownHousing } = await import(
  distImport(["systems", "settlements", "sim", "townGrowth.js"])
);
const { buildRenderTerrainSample } = await import(distImport(["render", "simView.js"]));
const {
  BUILDING_RUIN_PERSISTENCE_DAYS
} = await import(distImport(["systems", "settlements", "constants", "settlementConstants.js"]));
const {
  getBuildingLifecycleStageFromId,
  getBuildingLifecycleStageId
} = await import(distImport(["systems", "settlements", "sim", "buildingLifecycle.js"]));
const { pickHouseFootprint } = await import(distImport(["core", "houseFootprints.js"]));

const SIMULATION_YEAR_DAYS = PHASES.reduce((sum, phase) => sum + phase.duration, 0);

const buildTile = (type = "grass", overrides = {}) => ({
  type,
  fuel: type === "road" ? 0 : 0.55,
  fire: 0,
  isBase: false,
  elevation: 0.22,
  heat: 0,
  ignitionPoint: 0.8,
  burnRate: 0.7,
  heatOutput: 1,
  spreadBoost: 1,
  heatTransferCap: 5,
  heatRetention: type === "bare" ? 0.45 : 0.95,
  windFactor: type === "bare" || type === "road" ? 0 : 0.35,
  moisture: 0.62,
  waterDist: 8,
  vegetationAgeYears: type === "forest" ? 8 : 1.2,
  canopy: 0,
  canopyCover: 0,
  stemDensity: 0,
  dominantTreeType: null,
  treeType: null,
  houseValue: 0,
  houseResidents: 0,
  houseDestroyed: false,
  ashAge: 0,
  ...overrides
});

const syncCalendar = (state) => {
  state.year = Math.max(1, Math.floor(state.careerDay / SIMULATION_YEAR_DAYS) + 1);
  let remaining = ((state.careerDay % SIMULATION_YEAR_DAYS) + SIMULATION_YEAR_DAYS) % SIMULATION_YEAR_DAYS;
  for (const phase of PHASES) {
    if (remaining < phase.duration) {
      state.phase = phase.id;
      state.phaseDay = remaining;
      return;
    }
    remaining -= phase.duration;
  }
  state.phase = PHASES[PHASES.length - 1].id;
  state.phaseDay = PHASES[PHASES.length - 1].duration - 1;
};

const createRuntimeSettlementRoadAdapter = () => ({
  carveRoad: (nextState, start, end, options = {}) => {
    const routeSeed =
      (nextState.seed ^
        Math.imul(start.x + 1, 73856093) ^
        Math.imul(start.y + 1, 19349663) ^
        Math.imul(end.x + 1, 83492791) ^
        Math.imul(end.y + 1, 2971215073 >>> 0)) >>>
      0;
    return carveRoad(nextState, new RNG(routeSeed), start, end, options);
  },
  collectRoadTiles,
  findNearestRoadTile,
  clearRoadEdges,
  backfillRoadEdgesFromAdjacency,
  pruneRoadDiagonalStubs
});

const initialTownCooldownDays = (seed, townId, x, y) =>
  Math.floor(hash2D(x + townId * 17, y + townId * 31, seed ^ 0x51f15a1d) * 19);

const buildTown = (seed, id, name, x, y, roadY) => ({
  id,
  name,
  x,
  y,
  cx: x,
  cy: y,
  radius: 6,
  industryProfile: "general",
  streetArchetype: "main_street",
  growthFrontiers: [
    { x: x + 5, y: roadY, dx: 1, dy: 0, active: true, branchType: "primary" },
    { x: x - 5, y: roadY, dx: -1, dy: 0, active: true, branchType: "primary" }
  ],
  growthSeedYear: 0,
  simulatedGrowthYears: 0,
  houseCount: 0,
  housesLost: 0,
  alertPosture: 0,
  alertCooldownDays: 0,
  nonApprovingHouseCount: 0,
  approval: 0.82,
  evacState: "none",
  evacProgress: 0,
  lastPostureChangeDay: 0,
  desiredHouseDelta: 0,
  lastSeasonHouseDelta: 0,
  growthPressure: 0,
  recoveryPressure: 0,
  buildStartCooldownDays: initialTownCooldownDays(seed, id, x, y),
  activeBuildCap: 1,
  buildStartSerial: 0
});

const buildBaseWorld = (seed = 90210, townCount = 2) => {
  const grid = { cols: 18, rows: 16, totalTiles: 18 * 16 };
  const state = createInitialState(seed, grid);
  state.tiles = Array.from({ length: grid.totalTiles }, () => buildTile("grass"));
  for (let x = 2; x <= 15; x += 1) {
    state.tiles[4 * grid.cols + x] = buildTile("road", { fuel: 0 });
    state.tiles[11 * grid.cols + x] = buildTile("road", { fuel: 0 });
  }
  state.towns = [
    buildTown(seed, 0, "Northbank", 7, 4, 4),
    buildTown(seed, 1, "Southbank", 10, 11, 11)
  ].slice(0, townCount);
  placeHouse(state, 3 * grid.cols + 4, 0, 0.5);
  placeHouse(state, 3 * grid.cols + 10, 0, 0.5);
  if (townCount > 1) {
    placeHouse(state, 10 * grid.cols + 5, 1, 0.5);
    placeHouse(state, 10 * grid.cols + 12, 1, 0.5);
  }
  backfillRoadEdgesFromAdjacency(state);
  syncTileSoA(state);
  syncCalendar(state);
  return state;
};

const buildExpansionReadyWorld = (seed = 90210) => {
  const grid = { cols: 18, rows: 16, totalTiles: 18 * 16 };
  const state = createInitialState(seed, grid);
  state.tiles = Array.from({ length: grid.totalTiles }, () => buildTile("grass"));
  for (let x = 2; x <= 15; x += 1) {
    state.tiles[4 * grid.cols + x] = buildTile("road", { fuel: 0 });
    state.tiles[11 * grid.cols + x] = buildTile("road", { fuel: 0 });
  }
  state.towns = [
    buildTown(seed, 0, "Northbank", 7, 4, 4),
    buildTown(seed, 1, "Southbank", 10, 11, 11)
  ];
  backfillRoadEdgesFromAdjacency(state);
  syncTileSoA(state);
  syncCalendar(state);
  return state;
};

const advanceConstructionDays = (state, days) => {
  const adapter = createRuntimeSettlementRoadAdapter();
  for (let day = 0; day < days; day += 1) {
    state.careerDay += 1;
    syncCalendar(state);
    stepTownConstructionSchedule(state, adapter, 1);
  }
};

const buildTreeTypes = (state) => new Uint8Array(state.grid.totalTiles);

const snapshotConstructionState = (state) => ({
  structureRevision: state.structureRevision,
  towns: state.towns.map((town) => ({
    id: town.id,
    growthPressure: town.growthPressure,
    recoveryPressure: town.recoveryPressure,
    cooldown: Number(town.buildStartCooldownDays.toFixed(2)),
    cap: town.activeBuildCap,
    serial: town.buildStartSerial,
    houses: town.houseCount,
    posture: town.alertPosture
  })),
  lots: state.buildingLots.map((lot) => ({
    id: lot.id,
    townId: lot.townId,
    kind: lot.kind,
    anchorIndex: lot.anchorIndex,
    stage: lot.stage,
    progress: Number(lot.stageProgressDays.toFixed(2))
  })),
  ruined: state.tiles
    .map((tile, idx) => (tile.type === "house" && tile.houseDestroyed ? idx : -1))
    .filter((idx) => idx >= 0)
});

const runDeterminismAndStaggerCase = () => {
  const left = buildExpansionReadyWorld(90210);
  const right = buildExpansionReadyWorld(90210);
  left.townGrowthAppliedYear = left.year;
  right.townGrowthAppliedYear = right.year;
  left.towns.forEach((town) => {
    town.growthPressure = 2;
  });
  right.towns.forEach((town) => {
    town.growthPressure = 2;
  });
  const initialCooldowns = left.towns.map((town) => town.buildStartCooldownDays);
  const leftTrace = [];
  const rightTrace = [];
  const leftFirstReadyDay = new Map();
  const rightFirstReadyDay = new Map();

  for (let day = 0; day < 30; day += 1) {
    advanceConstructionDays(left, 1);
    advanceConstructionDays(right, 1);
    leftTrace.push(snapshotConstructionState(left));
    rightTrace.push(snapshotConstructionState(right));
    left.towns.forEach((town) => {
      if (!leftFirstReadyDay.has(town.id) && town.buildStartCooldownDays <= 0) {
        leftFirstReadyDay.set(town.id, day + 1);
      }
    });
    right.towns.forEach((town) => {
      if (!rightFirstReadyDay.has(town.id) && town.buildStartCooldownDays <= 0) {
        rightFirstReadyDay.set(town.id, day + 1);
      }
    });
  }

  assert.deepEqual(leftTrace, rightTrace, "settlement scheduler diverged for identical seed/time inputs");
  assert.equal(initialCooldowns[0] !== initialCooldowns[1], true, "towns should receive staggered seeded cooldowns");
  assert.notEqual(leftFirstReadyDay.get(0), leftFirstReadyDay.get(1), "town cooldowns reached build-ready state in lockstep");

  return {
    startDays: [leftFirstReadyDay.get(0), leftFirstReadyDay.get(1)],
    finalLots: left.buildingLots.length
  };
};

const runRuinPersistenceAndRebuildCase = () => {
  const state = buildBaseWorld(4141, 1);
  const ruinedIndex = 3 * state.grid.cols + 4;
  state.townGrowthAppliedYear = state.year;
  state.towns[0].buildStartCooldownDays = 0;
  state.towns[0].growthPressure = 0;
  state.towns[0].recoveryPressure = 0;
  assert.ok(destroyHouse(state, ruinedIndex), "failed to destroy house for rebuild regression");
  state.towns[0].housesLost += 1;
  state.tiles[ruinedIndex].houseDestroyedAtDay = 0;
  syncTileSoA(state);

  advanceConstructionDays(state, BUILDING_RUIN_PERSISTENCE_DAYS - 1);
  assert.equal(state.tiles[ruinedIndex].type, "house", "ruins cleared too early");
  assert.equal(state.tiles[ruinedIndex].houseDestroyed, true, "ruins should remain visible during persistence window");
  assert.equal(state.buildingLots.length, 0, "rebuild started before ruin persistence elapsed");

  advanceConstructionDays(state, 1);
  assert.equal(state.buildingLots.length, 1, "rebuild did not start when ruins became eligible");
  assert.equal(state.buildingLots[0].kind, "rebuild", "eligible ruin should create a rebuild lot");
  assert.equal(state.buildingLots[0].stage, "cleared_lot", "rebuild should start from cleared lot stage");

  const sampleCleared = buildRenderTerrainSample(state, buildTreeTypes(state), false, false);
  assert.equal(
    getBuildingLifecycleStageFromId(sampleCleared.buildingLots[0].stageId),
    "cleared_lot",
    "render sample should expose cleared lot stage"
  );

  advanceConstructionDays(state, 22);
  assert.equal(state.buildingLots.length, 0, "rebuild should complete after staged durations");
  assert.equal(state.tiles[ruinedIndex].type, "house", "completed rebuild should restore house tile");
  assert.equal(state.tiles[ruinedIndex].houseDestroyed, false, "completed rebuild should not remain destroyed");

  const completedSample = buildRenderTerrainSample(state, buildTreeTypes(state), false, false);
  assert.equal(
    getBuildingLifecycleStageFromId(completedSample.houseLifecycleStages[ruinedIndex] ?? getBuildingLifecycleStageId("roofed")),
    "roofed",
    "completed rebuild should render as roofed"
  );

  return {
    rebuiltIndex: ruinedIndex,
    structureRevision: state.structureRevision
  };
};

const runAlertSuppressionCase = () => {
  const state = buildBaseWorld(5151, 1);
  const anchorIndex = 3 * state.grid.cols + 10;
  state.townGrowthAppliedYear = state.year;
  state.buildingLots = [
    {
      id: 1,
      townId: 0,
      kind: "expansion",
      anchorIndex,
      styleSeed: anchorIndex,
      stage: "frame",
      stageProgressDays: 0,
      startedDay: 0,
      houseValue: 180,
      houseResidents: 3
    }
  ];
  state.nextBuildingLotId = 2;
  state.towns[0].buildStartCooldownDays = 1;
  state.towns[0].growthPressure = 2;
  state.towns[0].alertPosture = 2;

  advanceConstructionDays(state, 1);
  assert.equal(Number(state.buildingLots[0].stageProgressDays.toFixed(2)), 0.5, "moderate alert should halve build progress");
  assert.equal(Number(state.towns[0].buildStartCooldownDays.toFixed(2)), 0.5, "moderate alert should halve cooldown drain");

  state.towns[0].alertPosture = 3;
  const pausedProgress = state.buildingLots[0].stageProgressDays;
  const pausedLots = state.buildingLots.length;
  advanceConstructionDays(state, 1);
  assert.equal(state.buildingLots[0].stageProgressDays, pausedProgress, "high alert should pause active construction");
  assert.equal(state.buildingLots.length, pausedLots, "high alert should block new starts");

  state.towns[0].alertPosture = 0;
  advanceConstructionDays(state, 1);
  assert.ok(state.buildingLots[0].stageProgressDays > pausedProgress, "construction should resume after alert drops");

  return {
    resumedProgress: state.buildingLots[0].stageProgressDays
  };
};

const runRecoveryPriorityCase = () => {
  const state = buildBaseWorld(6161, 1);
  const ruinedIndex = 3 * state.grid.cols + 4;
  state.townGrowthAppliedYear = state.year;
  state.towns[0].buildStartCooldownDays = 0;
  state.towns[0].growthPressure = 3;
  state.towns[0].activeBuildCap = 2;
  assert.ok(destroyHouse(state, ruinedIndex), "failed to seed ruined house for recovery-priority case");
  state.towns[0].housesLost += 1;
  state.tiles[ruinedIndex].houseDestroyedAtDay = -BUILDING_RUIN_PERSISTENCE_DAYS;

  advanceConstructionDays(state, 1);
  assert.equal(state.buildingLots.length, 1, "expected one lot to start");
  assert.equal(state.buildingLots[0].kind, "rebuild", "rebuild should take priority over expansion");
  assert.equal(state.towns[0].growthPressure, 3, "growth pressure should not be consumed before recovery starts");

  return {
    firstLotKind: state.buildingLots[0].kind
  };
};

const runIdleRevisionCase = () => {
  const state = buildBaseWorld(7171, 1);
  state.townGrowthAppliedYear = state.year;
  state.towns[0].growthPressure = 0;
  state.towns[0].recoveryPressure = 0;
  state.towns[0].buildStartCooldownDays = 5;
  const startRevision = state.structureRevision;
  advanceConstructionDays(state, 10);
  assert.equal(state.structureRevision, startRevision, "idle days should not change structure revision");
  return { startRevision, endRevision: state.structureRevision };
};

const runCompactGrowthBranchingCase = () => {
  const grid = { cols: 20, rows: 20, totalTiles: 20 * 20 };
  const state = createInitialState(9191, grid);
  state.tiles = Array.from({ length: grid.totalTiles }, () => buildTile("grass"));
  for (let x = 4; x <= 15; x += 1) {
    state.tiles[10 * grid.cols + x] = buildTile("road", { fuel: 0 });
  }
  const town = buildTown(9191, 0, "Gridley", 10, 10, 10);
  town.streetArchetype = "crossroads";
  town.growthFrontiers = [
    { x: 14, y: 10, dx: 1, dy: 0, active: true, branchType: "primary" },
    { x: 6, y: 10, dx: -1, dy: 0, active: true, branchType: "primary" }
  ];
  state.towns = [town];
  backfillRoadEdgesFromAdjacency(state);
  syncTileSoA(state);
  simulateTownGrowthYears(state, createRuntimeSettlementRoadAdapter(), 4);
  syncTileSoA(state);

  const isRoadLike = (x, y) => {
    if (x < 0 || y < 0 || x >= state.grid.cols || y >= state.grid.rows) {
      return false;
    }
    const idx = y * state.grid.cols + x;
    const tile = state.tiles[idx];
    return !!tile && (tile.type === "road" || tile.type === "base" || (state.tileRoadBridge[idx] ?? 0) > 0);
  };
  const getRoadDegree = (x, y) => {
    const idx = y * state.grid.cols + x;
    let mask = state.tileRoadEdges[idx] ?? 0;
    if (mask === 0) {
      if (isRoadLike(x, y - 1)) mask |= 1 << 0;
      if (isRoadLike(x + 1, y)) mask |= 1 << 1;
      if (isRoadLike(x, y + 1)) mask |= 1 << 2;
      if (isRoadLike(x - 1, y)) mask |= 1 << 3;
    }
    let degree = 0;
    for (let bit = mask; bit !== 0; bit &= bit - 1) {
      degree += 1;
    }
    return degree;
  };

  const localRoads = [];
  let minX = town.x;
  let maxX = town.x;
  let minY = town.y;
  let maxY = town.y;
  for (let y = 4; y <= 16; y += 1) {
    for (let x = 4; x <= 16; x += 1) {
      if (!isRoadLike(x, y)) {
        continue;
      }
      localRoads.push({ x, y });
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }

  const offAxisRoads = localRoads.filter((point) => point.y !== 10).length;
  const junctions = localRoads.filter((point) => getRoadDegree(point.x, point.y) >= 3).length;
  const aspect = Math.max(maxX - minX + 1, maxY - minY + 1) / Math.max(1, Math.min(maxX - minX + 1, maxY - minY + 1));

  assert.ok(offAxisRoads > 0, "compact town growth should add roads off the original main street axis");
  assert.ok(junctions > 0, "compact town growth should create at least one 3-way road node");
  assert.ok(aspect <= 2.85, `compact town growth stayed too elongated (${aspect.toFixed(2)})`);

  return {
    offAxisRoads,
    junctions,
    aspect: Number(aspect.toFixed(2))
  };
};

const runDiagonalFrontageCase = () => {
  const grid = { cols: 20, rows: 20, totalTiles: 20 * 20 };
  const state = createInitialState(9393, grid);
  state.tiles = Array.from({ length: grid.totalTiles }, () => buildTile("grass"));
  for (let step = 5; step <= 14; step += 1) {
    state.tiles[step * grid.cols + step] = buildTile("road", { fuel: 0 });
  }
  const town = buildTown(9393, 0, "Angleton", 10, 10, 10);
  town.streetArchetype = "main_street";
  town.growthFrontiers = [
    { x: 14, y: 14, dx: 1, dy: 1, active: true, branchType: "primary" },
    { x: 5, y: 5, dx: -1, dy: -1, active: true, branchType: "primary" }
  ];
  state.towns = [town];
  placeHouse(state, 11 * grid.cols + 9, 0, 0.5);
  backfillRoadEdgesFromAdjacency(state);
  syncTileSoA(state);

  const isRoadLike = (x, y) => {
    if (x < 0 || y < 0 || x >= grid.cols || y >= grid.rows) {
      return false;
    }
    const idx = y * grid.cols + x;
    const tile = state.tiles[idx];
    return !!tile && (tile.type === "road" || tile.type === "base" || (state.tileRoadBridge[idx] ?? 0) > 0);
  };
  const alignedReference = findBestRoadReferenceForPlot(
    9,
    11,
    isRoadLike,
    (x, y) => {
      if (x < 0 || y < 0 || x >= grid.cols || y >= grid.rows) {
        return 0;
      }
      return state.tileRoadEdges[y * grid.cols + x] ?? 0;
    }
  );
  assert.ok(alignedReference?.matchesFrontage, "diagonal road plots should resolve a matched frontage source");

  const rotation = pickHouseRotationFromRoadMask(alignedReference.roadMask, 0x9f31);
  const axis = ((rotation % Math.PI) + Math.PI) % Math.PI;
  assert.ok(Math.abs(axis - Math.PI * 0.25) < 1e-6, "diagonal frontage house should align to the road axis");

  const context = rebuildGrowthContext(state);
  const lot = reserveTownExpansionLot(state, state.towns[0], context, createRuntimeSettlementRoadAdapter(), 1);
  assert.ok(lot, "diagonal frontage town should still reserve a visible expansion lot");
  const tileX = lot.anchorIndex % grid.cols;
  const tileY = Math.floor(lot.anchorIndex / grid.cols);

  return {
    anchor: `${tileX},${tileY}`,
    road: `${alignedReference.roadX},${alignedReference.roadY}`,
    axis: Number(axis.toFixed(2))
  };
};

const runCompactDensificationCase = () => {
  const grid = { cols: 20, rows: 20, totalTiles: 20 * 20 };
  const state = createInitialState(9292, grid);
  state.tiles = Array.from({ length: grid.totalTiles }, () => buildTile("grass"));
  for (let x = 5; x <= 15; x += 1) {
    state.tiles[10 * grid.cols + x] = buildTile("road", { fuel: 0 });
  }
  for (let y = 5; y <= 15; y += 1) {
    state.tiles[y * grid.cols + 10] = buildTile("road", { fuel: 0 });
  }
  const town = buildTown(9292, 0, "Stonecross", 10, 10, 10);
  town.streetArchetype = "crossroads";
  town.growthFrontiers = [
    { x: 19, y: 10, dx: 1, dy: 0, active: true, branchType: "primary" },
    { x: 1, y: 10, dx: -1, dy: 0, active: true, branchType: "primary" },
    { x: 10, y: 19, dx: 0, dy: 1, active: true, branchType: "secondary" },
    { x: 10, y: 1, dx: 0, dy: -1, active: true, branchType: "secondary" }
  ];
  state.towns = [town];
  [
    8 * grid.cols + 9,
    8 * grid.cols + 11,
    9 * grid.cols + 8,
    9 * grid.cols + 12,
    12 * grid.cols + 9,
    12 * grid.cols + 11
  ].forEach((idx) => {
    placeHouse(state, idx, 0, 0.5);
  });
  backfillRoadEdgesFromAdjacency(state);
  syncTileSoA(state);

  const beforePopulation = state.totalPopulation;
  const beforeHouseCount = state.towns[0].houseCount;
  const beforeDenseCount = state.tiles.filter(
    (tile) => tile.type === "house" && tile.buildingClass && tile.buildingClass !== "residential_low"
  ).length;

  assert.ok(tryDensifyTownHousing(state, state.towns[0]), "compact town should densify when its road radius is capped");

  const afterDenseCount = state.tiles.filter(
    (tile) => tile.type === "house" && tile.buildingClass && tile.buildingClass !== "residential_low"
  ).length;
  assert.equal(state.towns[0].houseCount, beforeHouseCount, "densification should not change house count");
  assert.ok(state.totalPopulation > beforePopulation, "densification should raise resident capacity");
  assert.ok(afterDenseCount > beforeDenseCount, "densification should upgrade at least one house class");

  return {
    populationGain: state.totalPopulation - beforePopulation,
    denseCount: afterDenseCount
  };
};

const runStyleContinuityCase = () => {
  const state = buildBaseWorld(8182, 1);
  const anchorIndex = 2 * state.grid.cols + 7;
  const styleSeed = 987654321;
  state.townGrowthAppliedYear = state.year;
  state.buildingLots = [
    {
      id: 1,
      townId: 0,
      kind: "expansion",
      anchorIndex,
      styleSeed,
      stage: "enclosed",
      stageProgressDays: 5,
      startedDay: 0,
      houseValue: 210,
      houseResidents: 4
    }
  ];
  state.nextBuildingLotId = 2;
  state.towns[0].growthPressure = 0;
  state.towns[0].buildStartCooldownDays = 99;

  const activeSample = buildRenderTerrainSample(state, buildTreeTypes(state), false, false);
  assert.equal(activeSample.buildingLots[0]?.styleSeed, styleSeed, "active lot should expose its persisted style seed");

  advanceConstructionDays(state, 1);
  assert.equal(state.buildingLots.length, 0, "style continuity case should complete the enclosed lot");
  assert.equal(state.tiles[anchorIndex].houseStyleSeed, styleSeed, "completed house should persist the lot style seed");

  const completedSample = buildRenderTerrainSample(state, buildTreeTypes(state), false, false);
  assert.equal(
    completedSample.houseStyleSeeds?.[anchorIndex],
    styleSeed >>> 0,
    "render sample should carry the persisted style seed for completed houses"
  );
  assert.equal(
    pickHouseFootprint(completedSample.houseStyleSeeds?.[anchorIndex] ?? 0).name,
    pickHouseFootprint(styleSeed).name,
    "completed house should resolve the same footprint family as its construction lot"
  );

  return { styleSeed };
};

const runMapgenStartupCompletesStockCase = () => {
  const state = buildExpansionReadyWorld(8181);
  const adapter = createRuntimeSettlementRoadAdapter();
  simulateTownGrowthYears(state, adapter, 3);
  syncTileSoA(state);

  const houseIndexes = state.tiles
    .map((tile, idx) => (tile.type === "house" ? idx : -1))
    .filter((idx) => idx >= 0);
  assert.ok(houseIndexes.length > 0, "expected pre-growth mapgen to place at least one house");

  const sample = buildRenderTerrainSample(state, buildTreeTypes(state), false, false);
  for (const idx of houseIndexes) {
    assert.equal(
      getBuildingLifecycleStageFromId(sample.houseLifecycleStages[idx] ?? getBuildingLifecycleStageId("roofed")),
      "roofed",
      "pre-generated startup houses should render as completed stock"
    );
  }
  assert.equal(sample.buildingLots.length, 0, "mapgen startup stock should not create active runtime lots");

  return { houseCount: houseIndexes.length };
};

const determinism = runDeterminismAndStaggerCase();
const rebuild = runRuinPersistenceAndRebuildCase();
const alert = runAlertSuppressionCase();
const recovery = runRecoveryPriorityCase();
const idle = runIdleRevisionCase();
const compact = runCompactGrowthBranchingCase();
const diagonal = runDiagonalFrontageCase();
const densification = runCompactDensificationCase();
const startup = runMapgenStartupCompletesStockCase();
const style = runStyleContinuityCase();

console.log(
  [
    `[settlement] staggeredStartDays=${determinism.startDays.join("/")}`,
    `rebuildIndex=${rebuild.rebuiltIndex}`,
    `alertResumeProgress=${alert.resumedProgress.toFixed(2)}`,
    `priority=${recovery.firstLotKind}`,
    `idleRevision=${idle.startRevision}->${idle.endRevision}`,
    `compactRoads=${compact.offAxisRoads}`,
    `compactJunctions=${compact.junctions}`,
    `compactAspect=${compact.aspect.toFixed(2)}`,
    `diagonalAnchor=${diagonal.anchor}`,
    `diagonalRoad=${diagonal.road}`,
    `compactDenseGain=${densification.populationGain}`,
    `startupHouses=${startup.houseCount}`,
    `styleSeed=${style.styleSeed}`
  ].join(" ")
);
