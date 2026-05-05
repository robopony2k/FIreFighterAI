import assert from "node:assert/strict";

import { RNG } from "../dist/core/rng.js";
import { createInitialState, syncTileSoA } from "../dist/core/state.js";
import { applyFuel } from "../dist/core/tiles.js";
import { TreeType } from "../dist/core/types.js";
import {
  FOREST_RECRUIT_AGE_YEARS,
  getVegetationAgeCapYears,
  getVegetationMaturity01,
  syncDerivedVegetationState
} from "../dist/core/vegetation.js";
import { stepGrowth } from "../dist/sim/growth.js";
import { shouldSyncThreeTestTerrain } from "../dist/app/threeTestTerrainSync.js";

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
      return buildTile("bare", { moisture: 0.9, waterDist: 18, elevation: 0.32 });
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

for (let step = 0; step < 12; step += 1) {
  stepGrowth(growthOnly.state, 30, growthOnly.rng);
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
assert.ok(
  shouldSyncThreeTestTerrain(growthPrevRevision, {
    terrainTypeRevision: growthOnly.state.terrainTypeRevision,
    vegetationRevision: growthOnly.state.vegetationRevision,
    structureRevision: growthOnly.state.structureRevision,
    debugTypeColors: false
  }),
  "vegetation-only revision change should trigger 3D terrain sync"
);
assert.ok(
  growthOnly.state.tileVegetationAge[growthOnly.targetIdx] >= growthTileAfter.vegetationAgeYears - 1e-6,
  "vegetation age SoA did not update"
);

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
    `vegetationRevision=${growthOnly.state.vegetationRevision}`
  ].join(" ")
);
