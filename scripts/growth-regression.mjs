import assert from "node:assert/strict";

import { RNG } from "../dist/core/rng.js";
import { createInitialState, syncTileSoA, TILE_TYPE_IDS } from "../dist/core/state.js";
import { applyFuel } from "../dist/core/tiles.js";
import { TreeType } from "../dist/core/types.js";
import {
  FOREST_RECRUIT_AGE_YEARS,
  getVegetationAgeCapYears,
  getVegetationMaturity01,
  syncDerivedVegetationState
} from "../dist/core/vegetation.js";
import { stepGrowth } from "../dist/sim/growth.js";
import { stepTownConstructionSchedule } from "../dist/systems/settlements/sim/townConstruction.js";
import {
  buildTileTexture,
  prepareTerrainRenderSurface,
  prepareTerrainRenderVisualSurface
} from "../dist/render/threeTestTerrain.js";
import {
  assignTerrainTextureMap,
  flushTerrainTextureDisposals,
  queueTerrainTextureDisposals
} from "../dist/systems/terrain/rendering/terrainTextureSwap.js";
import {
  analyzeTerrainTypeDiff,
  classifyTerrainVisualInvalidation,
  decideTerrainVisualSync,
  getTerrainVisualSyncUrgency,
  shouldRebuildThreeTestTreeTypeMap,
  shouldHoldSimulationForTerrainInvalidation,
  shouldSyncThreeTestTerrain
} from "../dist/app/threeTestTerrainSync.js";

const buildTile = (type, overrides = {}) => ({
  type,
  fuel: 0,
  fire: 0,
  isBase: false,
  elevation: 0.2,
  heat: 0,
  ignitionPoint: 0.8,
  burnRate: 0.7,
  heatOutput: 1,
  spreadBoost: 1,
  heatTransferCap: 5,
  heatRetention: type === "bare" ? 0.45 : 0.95,
  windFactor: type === "bare" ? 0 : 0.35,
  moisture: 0.72,
  waterDist: 8,
  vegetationAgeYears: 0,
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

const syncAll = (state, rng) => {
  for (let i = 0; i < state.tiles.length; i += 1) {
    const tile = state.tiles[i];
    const x = i % state.grid.cols;
    const y = Math.floor(i / state.grid.cols);
    if (tile.type === "grass" || tile.type === "scrub" || tile.type === "floodplain" || tile.type === "forest") {
      syncDerivedVegetationState(tile, state.seed, x, y);
    }
    applyFuel(tile, tile.moisture, rng);
  }
  syncTileSoA(state);
  state.simPerf.growthBlocksPerTick = state.fireBlockCount;
};

const buildGrowthOnlyState = () => {
  const seed = 1439;
  const grid = { cols: 7, rows: 7, totalTiles: 49 };
  const state = createInitialState(seed, grid);
  const rng = new RNG(seed ^ 0x9e3779b9);
  state.tiles = Array.from({ length: grid.totalTiles }, (_, index) => {
    const x = index % grid.cols;
    const y = Math.floor(index / grid.cols);
    const border = x === 0 || y === 0 || x === grid.cols - 1 || y === grid.rows - 1;
    if (border) {
      return buildTile("rocky", { moisture: 0.9, waterDist: 18, elevation: 0.32 });
    }
    const forestTile = buildTile("forest", {
      moisture: 0.68,
      waterDist: 7,
      elevation: 0.22,
      vegetationAgeYears: x === 3 && y === 3 ? 4 : 20,
      dominantTreeType: TreeType.Oak,
      treeType: TreeType.Oak
    });
    return forestTile;
  });
  syncAll(state, rng);
  return { state, rng, targetIdx: 3 + 3 * grid.cols };
};

const buildRecoveryState = () => {
  const seed = 2113;
  const grid = { cols: 9, rows: 9, totalTiles: 81 };
  const state = createInitialState(seed, grid);
  const rng = new RNG(seed ^ 0x85ebca6b);
  const center = 4 + 4 * grid.cols;
  state.tiles = Array.from({ length: grid.totalTiles }, (_, index) => {
    const x = index % grid.cols;
    const y = Math.floor(index / grid.cols);
    const border = x === 0 || y === 0 || x === grid.cols - 1 || y === grid.rows - 1;
    if (border) {
      return buildTile("bare", { moisture: 0.95, waterDist: 22, elevation: 0.35 });
    }
    if (index === center) {
      return buildTile("ash", { moisture: 0.86, waterDist: 4, elevation: 0.18, ashAge: 70 });
    }
    if (Math.abs(x - 4) <= 1 && Math.abs(y - 4) <= 1) {
      return buildTile("forest", {
        moisture: 0.83,
        waterDist: 4,
        elevation: 0.18,
        vegetationAgeYears: 24,
        dominantTreeType: TreeType.Oak,
        treeType: TreeType.Oak
      });
    }
    return buildTile("grass", {
      moisture: 0.7,
      waterDist: 7,
      elevation: 0.2,
      vegetationAgeYears: 1.2
    });
  });
  syncAll(state, rng);
  return { state, rng, center };
};

const buildLowBudgetCatchupState = () => {
  const seed = 3011;
  const grid = { cols: 16, rows: 16, totalTiles: 256 };
  const state = createInitialState(seed, grid);
  const rng = new RNG(seed ^ 0x9e3779b9);
  state.tiles = Array.from({ length: grid.totalTiles }, (_, index) => {
    const x = index % grid.cols;
    const y = Math.floor(index / grid.cols);
    return buildTile("forest", {
      moisture: 0.72,
      waterDist: 6 + ((x + y) % 5),
      elevation: 0.22,
      vegetationAgeYears: 0.35,
      dominantTreeType: TreeType.Oak,
      treeType: TreeType.Oak
    });
  });
  syncAll(state, rng);
  state.simPerf.growthBlocksPerTick = 1;
  return { state, rng };
};

const buildOpenRecruitState = () => {
  const seed = 4421;
  const grid = { cols: 9, rows: 9, totalTiles: 81 };
  const state = createInitialState(seed, grid);
  const rng = new RNG(seed ^ 0x7c15);
  const center = 4 + 4 * grid.cols;
  const target = 2 + 2 * grid.cols;
  state.tiles = Array.from({ length: grid.totalTiles }, (_, index) => {
    if (index === center) {
      return buildTile("forest", {
        moisture: 0.82,
        waterDist: 4,
        elevation: 0.18,
        vegetationAgeYears: 5,
        dominantTreeType: TreeType.Elm,
        treeType: TreeType.Elm
      });
    }
    return buildTile(index === target ? "bare" : "grass", {
      moisture: 0.86,
      waterDist: 4,
      elevation: 0.18,
      vegetationAgeYears: 0.8
    });
  });
  syncAll(state, rng);
  return { state, rng, target };
};

const buildRevisionBatchState = () => {
  const seed = 5521;
  const grid = { cols: 7, rows: 7, totalTiles: 49 };
  const state = createInitialState(seed, grid);
  const rng = new RNG(seed ^ 0xa53a);
  state.tiles = Array.from({ length: grid.totalTiles }, () =>
    buildTile("forest", {
      moisture: 0.72,
      waterDist: 7,
      elevation: 0.22,
      vegetationAgeYears: 0.35,
      dominantTreeType: TreeType.Oak,
      treeType: TreeType.Oak
    })
  );
  syncAll(state, rng);
  return { state, rng };
};

const buildSettlementConstructionState = (withReplayPath) => {
  const seed = withReplayPath ? 7103 : 7109;
  const grid = { cols: 7, rows: 7, totalTiles: 49 };
  const state = createInitialState(seed, grid);
  const rng = new RNG(seed ^ 0x91);
  state.tiles = Array.from({ length: grid.totalTiles }, () => buildTile("grass", { moisture: 0.66, waterDist: 7 }));
  syncAll(state, rng);
  state.careerDay = 91;
  state.phase = "growth";
  state.phaseIndex = 1;
  state.phaseDay = 1;
  state.year = 1;
  state.townGrowthAppliedYear = 1;
  state.towns = [
    {
      id: 0,
      name: "Replay",
      x: 3,
      y: 3,
      cx: 3,
      cy: 3,
      radius: 2,
      industryProfile: "general",
      streetArchetype: "main_street",
      growthFrontiers: [],
      growthSeedYear: 0,
      simulatedGrowthYears: 0,
      houseCount: 0,
      housesLost: 0,
      alertPosture: 0,
      alertCooldownDays: 0,
      nonApprovingHouseCount: 0,
      approval: 0.8,
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
      desiredHouseDelta: 1,
      lastSeasonHouseDelta: 0,
      growthPressure: 1,
      recoveryPressure: 0,
      buildStartCooldownDays: 0,
      activeBuildCap: 1,
      buildStartSerial: 0
    }
  ];
  const path = [
    { x: 1, y: 3 },
    { x: 2, y: 3 },
    { x: 3, y: 3 }
  ];
  state.plannedTownGrowth = {
    entries: [
      {
        townId: 0,
        anchorIndex: 3 + 3 * grid.cols,
        styleSeed: 123,
        houseValue: 180,
        houseResidents: 2,
        roadSegments: [
          {
            start: path[0],
            end: path[path.length - 1],
            path: withReplayPath ? path : undefined,
            bridgeTileIndices: withReplayPath ? [] : undefined
          }
        ],
        terrainEdits: [{ index: 3 + 3 * grid.cols, elevation: 0.95 }],
        plannedYear: 0,
        sequence: 0,
        status: "pending"
      }
    ],
    nextExpansionIndexByTown: [0],
    plannedYears: 1,
    consumedEntries: 0,
    skippedEntries: 0,
    runtimeFallbackReservations: 0
  };
  return state;
};

const createCountingRoadAdapter = () => {
  const counts = { replay: 0, search: 0, backfill: 0 };
  return {
    counts,
    adapter: {
      carveRoad: () => {
        counts.search += 1;
        return true;
      },
      carveRoadPath: () => {
        counts.replay += 1;
        return true;
      },
      collectRoadTiles: () => [],
      collectConnectedRoadNeighbors: () => [],
      findNearestRoadTile: () => ({ x: 0, y: 0 }),
      clearRoadEdges: () => {},
      backfillRoadEdgesFromAdjacency: () => {
        counts.backfill += 1;
      },
      pruneRoadDiagonalStubs: () => {}
    }
  };
};

const assertVegetationCaps = (state) => {
  for (const tile of state.tiles) {
    if (!(tile.type === "grass" || tile.type === "scrub" || tile.type === "floodplain" || tile.type === "forest")) {
      continue;
    }
    const cap = getVegetationAgeCapYears(tile.type);
    assert.ok(tile.vegetationAgeYears <= cap + 1e-6, `age cap exceeded for ${tile.type}`);
    assert.ok(getVegetationMaturity01(tile.type, tile.vegetationAgeYears) <= 1 + 1e-6, `maturity cap exceeded for ${tile.type}`);
  }
};

const makeTileTexturePalette = () => {
  const maxTileId = Math.max(...Object.values(TILE_TYPE_IDS));
  const palette = Array.from({ length: maxTileId + 1 }, () => [0.42, 0.48, 0.36]);
  palette[TILE_TYPE_IDS.water] = [0.1, 0.28, 0.44];
  palette[TILE_TYPE_IDS.grass] = [0.36, 0.52, 0.24];
  palette[TILE_TYPE_IDS.forest] = [0.18, 0.38, 0.18];
  palette[TILE_TYPE_IDS.ash] = [0.22, 0.22, 0.22];
  palette[TILE_TYPE_IDS.road] = [0.45, 0.39, 0.31];
  palette[TILE_TYPE_IDS.base] = [0.5, 0.48, 0.42];
  palette[TILE_TYPE_IDS.house] = [0.55, 0.42, 0.34];
  palette[TILE_TYPE_IDS.firebreak] = [0.58, 0.54, 0.42];
  palette[TILE_TYPE_IDS.beach] = [0.72, 0.66, 0.47];
  palette[TILE_TYPE_IDS.floodplain] = [0.33, 0.5, 0.31];
  palette[TILE_TYPE_IDS.scrub] = [0.43, 0.48, 0.26];
  palette[TILE_TYPE_IDS.rocky] = [0.42, 0.42, 0.4];
  palette[TILE_TYPE_IDS.bare] = [0.48, 0.43, 0.34];
  return palette;
};

const buildRegressionTileTexture = (sample, surface, palette, options) =>
  buildTileTexture(
    sample,
    surface.sampleCols,
    surface.sampleRows,
    surface.step,
    palette,
    TILE_TYPE_IDS.grass,
    TILE_TYPE_IDS.scrub,
    TILE_TYPE_IDS.floodplain,
    TILE_TYPE_IDS.beach,
    TILE_TYPE_IDS.forest,
    TILE_TYPE_IDS.water,
    TILE_TYPE_IDS.road,
    surface.heightScale,
    surface.sampleHeights,
    surface.sampleTypes,
    surface.waterRatios.water,
    surface.waterRatios.ocean,
    surface.waterRatios.river,
    surface.sampledErosionWear ?? null,
    surface.sampledRiverCoverage ?? null,
    surface.sampledLakeCoverage ?? null,
    surface.sampledRiverStepStrength ?? null,
    false,
    "legacy",
    options
  );

const growthOnly = buildGrowthOnlyState();
const growthPrevRevision = {
  terrainTypeRevision: growthOnly.state.terrainTypeRevision,
  vegetationRevision: growthOnly.state.vegetationRevision,
  structureRevision: growthOnly.state.structureRevision,
  debugTypeColors: false
};
const growthTileBefore = growthOnly.state.tiles[growthOnly.targetIdx];
const growthAgeBefore = growthTileBefore.vegetationAgeYears;
const growthCanopyBefore = growthTileBefore.canopyCover;
const growthStemBefore = growthTileBefore.stemDensity;
let growthTelemetryBlocks = 0;
let growthTelemetryTilesVisited = 0;
let growthTelemetryTilesChanged = 0;

for (let step = 0; step < 12; step += 1) {
  stepGrowth(growthOnly.state, 30, growthOnly.rng);
  growthTelemetryBlocks += growthOnly.state.simPerfGrowthBlocksProcessed;
  growthTelemetryTilesVisited += growthOnly.state.simPerfGrowthTilesVisited;
  growthTelemetryTilesChanged += growthOnly.state.simPerfGrowthTilesChanged;
}

const growthTileAfter = growthOnly.state.tiles[growthOnly.targetIdx];
assert.ok(growthTileAfter.vegetationAgeYears > growthAgeBefore, "young forest age did not increase");
assert.ok(growthTileAfter.canopyCover > growthCanopyBefore, "young forest canopy did not increase");
assert.ok(growthTileAfter.stemDensity >= growthStemBefore, "young forest stem density regressed");
assert.equal(
  growthOnly.state.terrainTypeRevision,
  growthPrevRevision.terrainTypeRevision,
  "pure forest growth should not change terrain type revision"
);
assert.ok(
  growthOnly.state.vegetationRevision > growthPrevRevision.vegetationRevision,
  "pure forest growth should bump vegetation revision"
);
assert.ok(growthTelemetryBlocks > 0, "growth telemetry should count processed blocks");
assert.ok(growthTelemetryTilesVisited > 0, "growth telemetry should count visited vegetation tiles");
assert.ok(growthTelemetryTilesChanged > 0, "growth telemetry should count changed vegetation tiles");
assert.ok(
  shouldSyncThreeTestTerrain(growthPrevRevision, {
    terrainTypeRevision: growthOnly.state.terrainTypeRevision,
    vegetationRevision: growthOnly.state.vegetationRevision,
    structureRevision: growthOnly.state.structureRevision,
    debugTypeColors: false
  }),
  "vegetation-only revision change should trigger 3D terrain sync"
);
const fastTimeVegetationDecision = decideTerrainVisualSync({
  previous: growthPrevRevision,
  next: {
    terrainTypeRevision: growthOnly.state.terrainTypeRevision,
    vegetationRevision: growthOnly.state.vegetationRevision,
    structureRevision: growthOnly.state.structureRevision,
    debugTypeColors: false
  },
  geometryTerrainChanged: false,
  activeFireTerrainPressure: false,
  nowMs: 1000,
  lastSyncMs: 0,
  cooldownMs: 0,
  fireVisualCooldownMs: 0,
  cameraInteracting: false
});
assert.equal(
  fastTimeVegetationDecision.shouldSync,
  true,
  "fast strategic time should no longer defer terrain sync solely because speed is high"
);
const cameraInteractionDecision = decideTerrainVisualSync({
  previous: growthPrevRevision,
  next: {
    terrainTypeRevision: growthOnly.state.terrainTypeRevision,
    vegetationRevision: growthOnly.state.vegetationRevision,
    structureRevision: growthOnly.state.structureRevision,
    debugTypeColors: false
  },
  geometryTerrainChanged: false,
  activeFireTerrainPressure: false,
  nowMs: 1000,
  lastSyncMs: 0,
  cooldownMs: 0,
  fireVisualCooldownMs: 0,
  cameraInteracting: true
});
assert.equal(cameraInteractionDecision.shouldSync, false, "camera interaction should still defer non-immediate terrain sync");
assert.equal(cameraInteractionDecision.deferredReason, 1, "camera interaction should keep its deferred reason");
const vegetationOnlyInvalidation = classifyTerrainVisualInvalidation({
  previous: { terrainTypeRevision: 4, vegetationRevision: 7, structureRevision: 2, debugTypeColors: false },
  next: { terrainTypeRevision: 4, vegetationRevision: 8, structureRevision: 2, debugTypeColors: false },
  geometryTerrainChanged: false,
  activeFireTerrainPressure: false
});
assert.equal(vegetationOnlyInvalidation.geometry, false, "vegetation-only growth should not force geometry rebuild");
assert.equal(vegetationOnlyInvalidation.surfaceColor, false, "vegetation-only growth should not require terrain surface-color work");
assert.equal(vegetationOnlyInvalidation.vegetation, true, "vegetation-only growth should still invalidate vegetation visuals");
assert.equal(vegetationOnlyInvalidation.dirtyTileBounds, undefined, "vegetation-only growth should not request tile texture updates");
assert.equal(
  shouldRebuildThreeTestTreeTypeMap(
    {
      cachedLength: growthOnly.state.grid.totalTiles,
      totalTiles: growthOnly.state.grid.totalTiles,
      cachedTerrainTypeRevision: 4,
      cachedVegetationRevision: 7
    },
    { terrainTypeRevision: 4, vegetationRevision: 8 }
  ),
  false,
  "vegetation-only maturity changes should not rebuild the tree type map"
);
const ashOnlyInvalidation = classifyTerrainVisualInvalidation({
  previous: { terrainTypeRevision: 4, vegetationRevision: 7, structureRevision: 2, debugTypeColors: false },
  next: { terrainTypeRevision: 5, vegetationRevision: 8, structureRevision: 2, debugTypeColors: false },
  geometryTerrainChanged: false,
  activeFireTerrainPressure: true
});
assert.equal(ashOnlyInvalidation.geometry, false, "ash-only terrain changes should not force geometry rebuild");
assert.equal(ashOnlyInvalidation.surfaceColor, true, "ash-only terrain changes should invalidate surface color");
assert.equal(ashOnlyInvalidation.vegetation, true, "ash-only vegetation cleanup should invalidate vegetation visuals");
assert.equal(ashOnlyInvalidation.fireVisual, true, "active fire visual terrain changes should be batchable");
assert.equal(getTerrainVisualSyncUrgency(ashOnlyInvalidation), "deferred", "active fire ash visuals should not hold simulation");
assert.equal(
  shouldHoldSimulationForTerrainInvalidation(ashOnlyInvalidation),
  false,
  "active fire ash visuals should not freeze simulation while texture work is batched"
);
const fireVisualOnlyDecision = decideTerrainVisualSync({
  previous: { terrainTypeRevision: 4, vegetationRevision: 7, structureRevision: 2, debugTypeColors: false },
  next: { terrainTypeRevision: 4, vegetationRevision: 7, structureRevision: 2, debugTypeColors: false },
  geometryTerrainChanged: false,
  activeFireTerrainPressure: true,
  activeFireVisualRefresh: true,
  nowMs: 1000,
  lastSyncMs: 0,
  cooldownMs: 0,
  fireVisualCooldownMs: 0,
  cameraInteracting: false
});
assert.equal(fireVisualOnlyDecision.shouldSync, false, "active fire visual pressure alone should not sync terrain");
assert.equal(fireVisualOnlyDecision.invalidation.fireVisual, false, "fire visual pressure alone should not invalidate terrain");
const structureInvalidation = classifyTerrainVisualInvalidation({
  previous: { terrainTypeRevision: 4, vegetationRevision: 7, structureRevision: 2, debugTypeColors: false },
  next: { terrainTypeRevision: 4, vegetationRevision: 7, structureRevision: 3, debugTypeColors: false },
  geometryTerrainChanged: false,
  activeFireTerrainPressure: true
});
assert.equal(structureInvalidation.structure, true, "structure changes should remain immediate terrain sync work");
assert.equal(structureInvalidation.fireVisual, false, "structure changes should not be treated as batchable fire visuals");
assert.equal(
  shouldHoldSimulationForTerrainInvalidation(structureInvalidation),
  true,
  "structure terrain sync work should still hold simulation until visual sync catches up"
);
const roadInvalidation = classifyTerrainVisualInvalidation({
  previous: { terrainTypeRevision: 4, vegetationRevision: 7, structureRevision: 2, debugTypeColors: false },
  next: { terrainTypeRevision: 5, vegetationRevision: 7, structureRevision: 2, debugTypeColors: false },
  geometryTerrainChanged: false,
  roadTerrainChanged: true,
  activeFireTerrainPressure: false
});
assert.equal(roadInvalidation.geometry, false, "road-only terrain changes should not force geometry rebuild");
assert.equal(roadInvalidation.roads, true, "road-only terrain changes should invalidate road visuals");
assert.equal(roadInvalidation.surfaceColor, true, "road-only terrain changes should still refresh surface color");
const roadDiffPrevious = new Uint8Array(25).fill(TILE_TYPE_IDS.grass);
const roadDiffNext = roadDiffPrevious.slice();
roadDiffNext[12] = TILE_TYPE_IDS.road;
const roadTypeDiff = analyzeTerrainTypeDiff(roadDiffPrevious, roadDiffNext, 5);
assert.equal(roadTypeDiff.terrainTypesChanged, true, "terrain type diff should detect road insertion");
assert.equal(roadTypeDiff.geometryTerrainChanged, false, "road insertion should not be geometry terrain work");
assert.equal(roadTypeDiff.roadTerrainChanged, true, "road insertion should be road visual work");
assert.deepEqual(
  roadTypeDiff.dirtyTileBounds,
  { minX: 2, minY: 2, maxX: 2, maxY: 2 },
  "road insertion should report tight dirty tile bounds"
);
const roadDirtyInvalidation = classifyTerrainVisualInvalidation({
  previous: { terrainTypeRevision: 4, vegetationRevision: 7, structureRevision: 2, debugTypeColors: false },
  next: { terrainTypeRevision: 5, vegetationRevision: 7, structureRevision: 2, debugTypeColors: false },
  geometryTerrainChanged: roadTypeDiff.geometryTerrainChanged,
  roadTerrainChanged: roadTypeDiff.roadTerrainChanged,
  waterOrCoastChanged: roadTypeDiff.waterOrCoastChanged,
  dirtyTileBounds: roadTypeDiff.dirtyTileBounds,
  activeFireTerrainPressure: false
});
assert.deepEqual(
  roadDirtyInvalidation.dirtyTileBounds,
  { minX: 2, minY: 2, maxX: 2, maxY: 2 },
  "road-only surface updates should preserve tight dirty tile bounds"
);
assert.ok(
  growthOnly.state.tileVegetationAge[growthOnly.targetIdx] >= growthTileAfter.vegetationAgeYears - 1e-6,
  "vegetation age SoA did not update"
);

const lowBudget = buildLowBudgetCatchupState();
const lowBudgetStartAge = Math.min(...lowBudget.state.tiles.map((tile) => tile.vegetationAgeYears));
for (let step = 0; step < lowBudget.state.fireBlockCount * 2; step += 1) {
  lowBudget.state.careerDay += 30;
  stepGrowth(lowBudget.state, 30, lowBudget.rng);
}
const lowBudgetEndAge = Math.min(...lowBudget.state.tiles.map((tile) => tile.vegetationAgeYears));
assert.ok(
  lowBudgetEndAge > lowBudgetStartAge + 0.4,
  `low block budget catch-up did not advance every block (${lowBudgetStartAge.toFixed(2)} -> ${lowBudgetEndAge.toFixed(2)})`
);

const openRecruit = buildOpenRecruitState();
for (let step = 0; step < 12; step += 1) {
  openRecruit.state.careerDay += 30;
  stepGrowth(openRecruit.state, 30, openRecruit.rng);
}
assert.equal(
  openRecruit.state.tiles[openRecruit.target].type,
  "forest",
  "suitable open/bare land should recruit into visible forest during quiet growth"
);

const revisionBatch = buildRevisionBatchState();
const revisionStart = revisionBatch.state.vegetationRevision;
for (let step = 0; step < 10; step += 1) {
  revisionBatch.state.careerDay += 1;
  stepGrowth(revisionBatch.state, 1, revisionBatch.rng);
}
assert.equal(
  revisionBatch.state.vegetationRevision,
  revisionStart,
  "small vegetation-only ticks should be batched instead of forcing terrain sync every day"
);
for (let step = 0; step < 30; step += 1) {
  revisionBatch.state.careerDay += 1;
  stepGrowth(revisionBatch.state, 1, revisionBatch.rng);
}
assert.ok(
  revisionBatch.state.vegetationRevision > revisionStart,
  "batched vegetation visuals should flush after enough growth days"
);

const terrainSignatureSample = (() => {
  const cols = 5;
  const rows = 5;
  const total = cols * rows;
  const elevations = new Float32Array(total).fill(0.25);
  elevations[0] = 0.12;
  const tileTypes = new Uint8Array(total).fill(TILE_TYPE_IDS.grass);
  tileTypes[0] = TILE_TYPE_IDS.water;
  const oceanMask = new Uint8Array(total);
  oceanMask[0] = 1;
  const baseSurface = prepareTerrainRenderSurface({ cols, rows, elevations, tileTypes, oceanMask, fastUpdate: true });
  const roadTypes = tileTypes.slice();
  roadTypes[12] = TILE_TYPE_IDS.road;
  const roadSurface = prepareTerrainRenderSurface({ cols, rows, elevations, tileTypes: roadTypes, oceanMask, fastUpdate: true });
  const houseTypes = tileTypes.slice();
  houseTypes[13] = TILE_TYPE_IDS.house;
  const structureSurface = prepareTerrainRenderSurface({ cols, rows, elevations, tileTypes: houseTypes, oceanMask, fastUpdate: true });
  const forestTypes = tileTypes.slice();
  forestTypes[14] = TILE_TYPE_IDS.forest;
  const vegetationSurface = prepareTerrainRenderSurface({ cols, rows, elevations, tileTypes: forestTypes, oceanMask, fastUpdate: true });
  const visualSurface = prepareTerrainRenderVisualSurface(
    { cols, rows, elevations, tileTypes: forestTypes, oceanMask, fastUpdate: true },
    baseSurface
  );
  assert.equal(roadSurface.geometrySignature, baseSurface.geometrySignature, "road-only visuals should not change terrain geometry signature");
  assert.equal(
    structureSurface.geometrySignature,
    baseSurface.geometrySignature,
    "structure-only visuals should not change terrain geometry signature"
  );
  assert.equal(
    vegetationSurface.geometrySignature,
    baseSurface.geometrySignature,
    "vegetation-only visuals should not change terrain geometry signature"
  );
  assert.ok(visualSurface, "vegetation-only visual terrain prep should reuse cached static terrain geometry");
  assert.equal(
    visualSurface.geometrySignature,
    baseSurface.geometrySignature,
    "visual-only terrain prep should preserve cached terrain geometry signature"
  );
  assert.equal(
    visualSurface.sampleHeights,
    baseSurface.sampleHeights,
    "visual-only terrain prep should reuse cached static height samples"
  );
  assert.notEqual(
    visualSurface.sampleTypes,
    baseSurface.sampleTypes,
    "visual-only terrain prep should refresh mutable visual tile classes"
  );
  const texturePalette = makeTileTexturePalette();
  const textureElevations = new Float32Array(total).fill(0.28);
  const textureTypes = new Uint8Array(total).fill(TILE_TYPE_IDS.grass);
  const textureBaseSample = { cols, rows, elevations: textureElevations, tileTypes: textureTypes, fastUpdate: true };
  const textureBaseSurface = prepareTerrainRenderSurface(textureBaseSample);
  const initialTexture = buildRegressionTileTexture(textureBaseSample, textureBaseSurface, texturePalette);
  const textureRoadTypes = textureTypes.slice();
  textureRoadTypes[12] = TILE_TYPE_IDS.road;
  const textureRoadSample = { cols, rows, elevations: textureElevations, tileTypes: textureRoadTypes, fastUpdate: true };
  const textureRoadSurface =
    prepareTerrainRenderVisualSurface(textureRoadSample, textureBaseSurface) ??
    prepareTerrainRenderSurface(textureRoadSample);
  const fullRoadTexture = buildRegressionTileTexture(textureRoadSample, textureRoadSurface, texturePalette);
  const partialRoadTexture = buildRegressionTileTexture(textureRoadSample, textureRoadSurface, texturePalette, {
    texture: initialTexture,
    dirtyTileBounds: { minX: 2, minY: 2, maxX: 2, maxY: 2 }
  });
  assert.equal(partialRoadTexture, initialTexture, "dirty tile texture update should reuse the existing DataTexture");
  assert.ok(initialTexture.updateRanges.length > 0, "dirty tile texture update should record row update ranges");
  assert.deepEqual(
    Array.from(initialTexture.image.data),
    Array.from(fullRoadTexture.image.data),
    "dirty tile texture update should match a full texture rebuild"
  );
  fullRoadTexture.dispose();
  initialTexture.dispose();

  const makeDisposableTexture = (label) => ({
    label,
    disposed: 0,
    dispose() {
      this.disposed += 1;
    }
  });
  const oldMap = makeDisposableTexture("old");
  const nextMap = makeDisposableTexture("next");
  const materialA = { map: oldMap, needsUpdate: false };
  const materialB = { map: oldMap, needsUpdate: false };
  const queuedDisposals = [];
  const previousMaps = assignTerrainTextureMap([materialA, materialB], nextMap);
  assert.equal(materialA.map, nextMap, "terrain texture swap should assign the new map to material A");
  assert.equal(materialB.map, nextMap, "terrain texture swap should assign the new map to material B");
  assert.equal(materialA.needsUpdate, true, "terrain texture swap should mark material A dirty");
  assert.equal(materialB.needsUpdate, true, "terrain texture swap should mark material B dirty");
  assert.equal(previousMaps.length, 1, "terrain texture swap should dedupe shared previous maps");
  assert.equal(previousMaps[0], oldMap, "terrain texture swap should return the previous map for deferred disposal");
  queueTerrainTextureDisposals(queuedDisposals, previousMaps, 2);
  queueTerrainTextureDisposals(queuedDisposals, previousMaps, 1);
  assert.equal(queuedDisposals.length, 1, "deferred terrain texture disposal should queue a map once");
  assert.equal(queuedDisposals[0].framesRemaining, 2, "deferred terrain texture disposal should keep the longest delay");
  flushTerrainTextureDisposals(queuedDisposals);
  assert.equal(oldMap.disposed, 0, "deferred terrain texture disposal should keep the old map through the first flush");
  assert.equal(queuedDisposals.length, 1, "deferred terrain texture disposal should remain queued before the delay elapses");
  flushTerrainTextureDisposals(queuedDisposals);
  assert.equal(oldMap.disposed, 1, "deferred terrain texture disposal should dispose after the configured delay");
  assert.equal(queuedDisposals.length, 0, "deferred terrain texture disposal should clear disposed maps");

  const baselineTexture = buildRegressionTileTexture(textureBaseSample, textureBaseSurface, texturePalette);
  const tileFuel = new Float32Array(total).fill(0);
  const tileFire = new Float32Array(total);
  const tileHeat = new Float32Array(total);
  tileFire[12] = 1;
  tileHeat[12] = 5;
  const textureFireSample = {
    ...textureBaseSample,
    tileFuel,
    tileFire,
    tileHeat,
    heatCap: 5
  };
  const skippedFireTexture = buildRegressionTileTexture(textureFireSample, textureBaseSurface, texturePalette, {
    includeDynamicFireScorch: false
  });
  assert.deepEqual(
    Array.from(skippedFireTexture.image.data),
    Array.from(baselineTexture.image.data),
    "dynamic fire scorch disabled should keep base terrain texture stable"
  );
  const scorchedFireTexture = buildRegressionTileTexture(textureFireSample, textureBaseSurface, texturePalette, {
    includeDynamicFireScorch: true
  });
  assert.notDeepEqual(
    Array.from(scorchedFireTexture.image.data),
    Array.from(baselineTexture.image.data),
    "dynamic fire scorch enabled should still support explicit ground scorch rendering"
  );
  baselineTexture.dispose();
  skippedFireTexture.dispose();
  scorchedFireTexture.dispose();
  return baseSurface.geometrySignature;
})();

const replayConstruction = buildSettlementConstructionState(true);
const replayElevationBefore = new Float32Array(replayConstruction.tileElevation);
const replayRoads = createCountingRoadAdapter();
stepTownConstructionSchedule(replayConstruction, replayRoads.adapter, 1, { maxEventDays: 4 });
assert.equal(replayRoads.counts.replay, 1, "planned expansion should replay recorded road paths");
assert.equal(replayRoads.counts.search, 0, "planned expansion with replay data should not run runtime road search");
assert.equal(replayConstruction.plannedTownGrowth.consumedEntries, 1, "planned expansion entry should be consumed");
assert.equal(replayConstruction.buildingLots.length, 1, "planned expansion should create a building lot");
assert.deepEqual(replayConstruction.tileElevation, replayElevationBefore, "runtime planned expansion must not mutate terrain elevation");
assert.ok(
  replayConstruction.settlementRuntimeTerrainEditAttempts > 0,
  "deprecated runtime terrain edits should be counted as no-op attempts"
);

const fallbackConstruction = buildSettlementConstructionState(false);
const fallbackElevationBefore = new Float32Array(fallbackConstruction.tileElevation);
const fallbackRoads = createCountingRoadAdapter();
stepTownConstructionSchedule(fallbackConstruction, fallbackRoads.adapter, 1, { maxEventDays: 4 });
assert.equal(fallbackRoads.counts.replay, 0, "legacy planned expansion without path should not call replay");
assert.equal(fallbackRoads.counts.search, 1, "legacy planned expansion without path should use runtime road search fallback");
assert.equal(fallbackConstruction.buildingLots.length, 1, "runtime road-search fallback should still create a building lot");
assert.deepEqual(fallbackConstruction.tileElevation, fallbackElevationBefore, "legacy runtime expansion must not mutate terrain elevation");

const recovery = buildRecoveryState();
let sawGrass = false;
let sawForest = false;
for (let step = 0; step < 144; step += 1) {
  stepGrowth(recovery.state, 10, recovery.rng);
  const centerTile = recovery.state.tiles[recovery.center];
  if (centerTile.type === "grass") {
    sawGrass = true;
  }
  if (sawGrass && centerTile.type === "forest") {
    sawForest = true;
    break;
  }
}

const recoveredTile = recovery.state.tiles[recovery.center];
assert.ok(sawGrass, "burned tile never recovered from ash to grass");
assert.ok(sawForest, "burned tile never recruited back into forest");
assert.equal(recoveredTile.type, "forest", "recovered center tile should end as forest");
assert.equal(recoveredTile.treeType, TreeType.Oak, "recovered forest should inherit a neighboring tree type");
assert.ok(
  recoveredTile.vegetationAgeYears >= FOREST_RECRUIT_AGE_YEARS
    && recoveredTile.vegetationAgeYears <= getVegetationAgeCapYears("forest"),
  "recovered forest age should stay within the capped recruit range"
);

assertVegetationCaps(growthOnly.state);
assertVegetationCaps(recovery.state);

console.log(
  [
    `[growth] youngForest age ${growthAgeBefore.toFixed(2)} -> ${growthTileAfter.vegetationAgeYears.toFixed(2)}`,
    `canopy ${growthCanopyBefore.toFixed(3)} -> ${growthTileAfter.canopyCover.toFixed(3)}`,
    `stem ${growthStemBefore} -> ${growthTileAfter.stemDensity}`,
    `centerType=${recoveredTile.type}`,
    `centerTree=${recoveredTile.treeType}`,
    `lowBudgetMinAge=${lowBudgetEndAge.toFixed(2)}`,
    `openRecruit=${openRecruit.state.tiles[openRecruit.target].type}`,
    `roadReplay=${replayRoads.counts.replay}`,
    `roadFallback=${fallbackRoads.counts.search}`,
    `terrainGeom=${terrainSignatureSample}`,
    `terrainEditNoop=${replayConstruction.settlementRuntimeTerrainEditAttempts + fallbackConstruction.settlementRuntimeTerrainEditAttempts}`,
    `vegetationRevision=${growthOnly.state.vegetationRevision}`
  ].join(" ")
);
