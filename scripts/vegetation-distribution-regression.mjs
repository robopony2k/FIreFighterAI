import assert from "node:assert/strict";
import { buildVegetationTerrainFields } from "../dist/systems/terrain/sim/vegetationTerrainFields.js";
import { computeTreeSuitability } from "../dist/systems/terrain/sim/treeSuitability.js";
import { getTerrainResponsiveVegetationStructure } from "../dist/systems/terrain/sim/vegetationStructure.js";
import { buildForestMask } from "../dist/mapgen/biome/ForestSpread.js";
import { vegetationFbmNoise } from "../dist/systems/terrain/utils/vegetationSeedHash.js";
import {
  buildFullResolutionTreeCoveragePlan,
  computeTreeBudgetScale,
  computeTreeDensityGradient,
  getTallTreeAttemptWeight,
  resolveTreeCandidateOffset
} from "../dist/systems/terrain/rendering/vegetation/treePlacementPlan.js";
import { decodeTerrainSeedCode } from "../dist/ui/terrainSeedCode.js";
import { MAP_SIZE_PRESETS } from "../dist/core/config.js";
import { createInitialState, TILE_TYPE_IDS } from "../dist/core/state.js";
import { RNG } from "../dist/core/rng.js";
import { generateMap } from "../dist/mapgen/index.js";

const hashArray = (values) => {
  let hash = 2166136261;
  for (const value of values) {
    const quantized = Math.round(Number(value) * 1_000_000);
    hash ^= quantized;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
};

const cols = 48;
const rows = 24;
const total = cols * rows;
const elevations = new Float32Array(total);
const moisture = new Float32Array(total).fill(0.56);
const waterDistance = new Uint16Array(total).fill(20);
const coastDistance = new Uint16Array(total).fill(20);
const valley = new Float32Array(total);
const runoff = new Float32Array(total).fill(0.05);
for (let y = 0; y < rows; y += 1) {
  for (let x = 0; x < cols; x += 1) {
    const idx = y * cols + x;
    const ridgeDistance = Math.abs(x - 21);
    elevations[idx] = 0.26 + Math.max(0, 1 - ridgeDistance / 12) * 0.42;
    if (x >= 24 && x <= 27) {
      valley[idx] = 0.72;
      runoff[idx] = 1.4;
      elevations[idx] -= 0.035;
    }
    if (x < 8) coastDistance[idx] = x;
  }
}

const buildFields = () => buildVegetationTerrainFields({
  cols,
  rows,
  elevations,
  baseMoisture: moisture,
  waterDistance,
  coastDistance,
  valley,
  runoff,
  prevailingWindDx: 1,
  prevailingWindDy: 0,
  prevailingWindStrength: 0.8
});
const fieldsA = buildFields();
const fieldsB = buildFields();
assert.equal(hashArray(fieldsA.moisture), hashArray(fieldsB.moisture), "terrain response must be deterministic");
assert.equal(hashArray(fieldsA.windExposure), hashArray(fieldsB.windExposure), "exposure must be deterministic");

const scoreAt = (x, y) => {
  const idx = y * cols + x;
  return computeTreeSuitability({
    seed: 2026,
    x,
    y,
    worldX: x * 10,
    worldY: y * 10,
    cellSizeM: 10,
    elevation: elevations[idx],
    slope: 0.05,
    slopeAngleDeg: 12,
    moisture: fieldsA.moisture[idx],
    valley: valley[idx],
    seaLevel: 0.1,
    waterDist: waterDistance[idx],
    highlandForestElevation: 0.82,
    vegetationDensity: 0.62,
    forestPatchiness: 0.48,
    windExposure: fieldsA.windExposure[idx],
    leeShelter: fieldsA.leeShelter[idx],
    curvature: fieldsA.curvature[idx],
    drainage: fieldsA.drainage[idx],
    coastExposure: fieldsA.coastExposure[idx],
    clusterScore: 0.58
  });
};

const windward = scoreAt(20, 12);
const sheltered = scoreAt(25, 12);
assert.ok(
  sheltered.siteQuality >= windward.siteQuality * 1.2,
  `sheltered site quality should exceed exposed ridge by 20% (${sheltered.siteQuality}/${windward.siteQuality})`
);
const ridgeStructure = getTerrainResponsiveVegetationStructure({
  worldSeed: 2026,
  type: "forest",
  ageYears: 4,
  x: 20,
  y: 12,
  siteQuality: windward.siteQuality
});
const gullyStructure = getTerrainResponsiveVegetationStructure({
  worldSeed: 2026,
  type: "forest",
  ageYears: 4,
  x: 25,
  y: 12,
  siteQuality: sheltered.siteQuality
});
assert.ok(gullyStructure.canopyCover >= ridgeStructure.canopyCover * 1.2, "gully canopy should exceed ridge canopy by 20%");
assert.ok(scoreAt(3, 12).siteQuality < scoreAt(14, 12).siteQuality, "coastal exposure should reduce site quality");

const steep = computeTreeSuitability({
  seed: 1, x: 0, y: 0, worldX: 0, worldY: 0, cellSizeM: 10,
  elevation: 0.5, slope: 0.5, slopeAngleDeg: 48, moisture: 0.8, valley: 0,
  seaLevel: 0.1, waterDist: 20, highlandForestElevation: 0.82,
  vegetationDensity: 0.62, forestPatchiness: 0.48
});
assert.ok(steep.treeProbability < 0.1, "steep terrain should nearly eliminate tree probability");

const forestCols = 64;
const forestRows = 64;
const forestTotal = forestCols * forestRows;
const makeForestContext = (seed) => {
  const treeProbabilityMap = new Float32Array(forestTotal);
  const treeDensityMap = new Float32Array(forestTotal);
  const vegetationClusterMap = new Float32Array(forestTotal);
  const suitability = new Float32Array(forestTotal);
  for (let y = 0; y < forestRows; y += 1) {
    for (let x = 0; x < forestCols; x += 1) {
      const idx = y * forestCols + x;
      const cluster = vegetationFbmNoise(x / 18, y / 18, seed + 31_013, 3);
      const clearing = x >= 28 && x <= 34 && y >= 28 && y <= 34;
      vegetationClusterMap[idx] = clearing ? 0 : cluster;
      treeProbabilityMap[idx] = clearing ? 0.04 : 0.48 + cluster * 0.42;
      treeDensityMap[idx] = clearing ? 0.02 : 0.42 + cluster * 0.5;
      suitability[idx] = clearing ? 0.08 : 0.46 + cluster * 0.44;
    }
  }
  return {
    suitability,
    ctx: {
      state: { seed, grid: { cols: forestCols, rows: forestRows, totalTiles: forestTotal } },
      settings: { vegetationDensity: 0.62 },
      oceanMask: new Uint8Array(forestTotal),
      riverMask: new Uint8Array(forestTotal),
      moistureMap: new Float32Array(forestTotal).fill(0.6),
      treeProbabilityMap,
      treeDensityMap,
      vegetationClusterMap
    }
  };
};
const fixtureA = makeForestContext(1337);
const fixtureB = makeForestContext(1337);
const fixtureC = makeForestContext(1338);
const maskA = buildForestMask(fixtureA.ctx, fixtureA.suitability);
const maskB = buildForestMask(fixtureB.ctx, fixtureB.suitability);
const maskC = buildForestMask(fixtureC.ctx, fixtureC.suitability);
assert.equal(hashArray(maskA), hashArray(maskB), "forest morphology must be deterministic");
assert.notEqual(hashArray(maskA), hashArray(maskC), "different seeds should change woodland morphology");
assert.equal(maskA[31 * forestCols + 31], 0, "the coherent central clearing should remain open");
const componentSizes = [];
const componentVisited = new Uint8Array(forestTotal);
const componentQueue = new Int32Array(forestTotal);
for (let start = 0; start < forestTotal; start += 1) {
  if (componentVisited[start] || maskA[start] === 0) continue;
  let head = 0;
  let tail = 0;
  componentVisited[start] = 1;
  componentQueue[tail++] = start;
  while (head < tail) {
    const idx = componentQueue[head++];
    const x = idx % forestCols;
    const y = Math.floor(idx / forestCols);
    const neighbors = [x > 0 ? idx - 1 : -1, x < forestCols - 1 ? idx + 1 : -1, y > 0 ? idx - forestCols : -1, y < forestRows - 1 ? idx + forestCols : -1];
    for (const next of neighbors) {
      if (next >= 0 && !componentVisited[next] && maskA[next] > 0) {
        componentVisited[next] = 1;
        componentQueue[tail++] = next;
      }
    }
  }
  componentSizes.push(tail);
}
assert.ok(componentSizes.every((size) => size >= 12), `forest components must be at least twelve tiles: ${componentSizes.join(",")}`);

const density = new Uint8Array(25);
density[2 * 5 + 2] = 4;
density[2 * 5 + 3] = 10;
const gradient = computeTreeDensityGradient(density, 5, 5, 2, 2);
assert.ok(gradient.x > 0.9, "edge gradient should point toward denser woodland");
const candidateA = resolveTreeCandidateOffset({ worldSeed: 42, tileX: 2, tileY: 2, attempt: 1, jitterRange: 0.42, densityGradient: gradient });
const candidateB = resolveTreeCandidateOffset({ worldSeed: 42, tileX: 2, tileY: 2, attempt: 1, jitterRange: 0.42, densityGradient: gradient });
assert.deepEqual(candidateA, candidateB, "render placement must be deterministic");
assert.ok(candidateA.x > -0.42 && candidateA.x <= 0.42, "candidate must remain within its tile jitter range");
assert.equal(computeTreeBudgetScale(40_000, 18_000), 0.432, "global budget scale should be deterministic");
assert.equal(getTallTreeAttemptWeight("grass"), 0, "grass structure must not emit tall-tree instances");
assert.ok(
  getTallTreeAttemptWeight("scrub") < getTallTreeAttemptWeight("forest") * 0.2,
  "scrub must remain visually subordinate to forest"
);

const coverageCols = 256;
const coverageRows = 256;
const coverageTotal = coverageCols * coverageRows;
const coverageTypes = new Uint8Array(coverageTotal).fill(TILE_TYPE_IDS.grass);
coverageTypes.fill(TILE_TYPE_IDS.forest, 0, 30_000);
const coverageOcclusion = new Uint8Array(coverageTotal);
coverageOcclusion[7] = 1;
const makeCoveragePlan = () => buildFullResolutionTreeCoveragePlan({
  cols: coverageCols,
  rows: coverageRows,
  worldSeed: 90210,
  tileTypes: coverageTypes,
  tileVegetationAge: new Float32Array(coverageTotal),
  tileCanopyCover: new Float32Array(coverageTotal),
  tileStemDensity: new Uint8Array(coverageTotal),
  occludedMask: coverageOcclusion,
  forestId: TILE_TYPE_IDS.forest,
  scrubId: TILE_TYPE_IDS.scrub,
  floodplainId: TILE_TYPE_IDS.floodplain,
  grassId: TILE_TYPE_IDS.grass,
  densityScale: 0.96,
  attemptCap: 2,
  modelInstanceBudget: 28_000
});
const coveragePlanA = makeCoveragePlan();
const coveragePlanB = makeCoveragePlan();
assert.deepEqual(coveragePlanA, coveragePlanB, "full-resolution forest coverage planning must be deterministic");
assert.equal(coveragePlanA.eligibleForestTiles, 29_999, "the structure footprint must be the only coverage exemption");
assert.equal(coveragePlanA.modelCandidates.length, 28_000, "high-detail forest models must retain the 28,000-instance ceiling");
assert.equal(coveragePlanA.modelCoveredForestTiles, 28_000);
assert.equal(coveragePlanA.fallbackCoveredForestTiles, 1_999);
assert.equal(coveragePlanA.uncoveredForestTiles, 0, "every eligible 256 forest tile must receive model or fallback geometry");
const mandatoryCoverageTiles = new Set(
  [...coveragePlanA.modelCandidates, ...coveragePlanA.fallbackCandidates]
    .filter((candidate) => candidate.requiredForestCoverage)
    .map((candidate) => candidate.tileIndex)
);
assert.equal(mandatoryCoverageTiles.size, coveragePlanA.eligibleForestTiles, "forest coverage candidates must not duplicate tiles");
assert.ok(
  [...coveragePlanA.modelCandidates, ...coveragePlanA.fallbackCandidates].every(
    (candidate) => candidate.vegetationType === "forest" && Math.abs(candidate.offsetX) <= 0.42 && Math.abs(candidate.offsetY) <= 0.42
  ),
  "coverage candidates must remain forest-owned and inside their tile"
);

const reportedShareCode = "MAP7-115-1001Y1J1E1S191Q1C0I1M0O0U1A0S180Y1M1A181Q0K1K12161C";
const decodedShareCode = decodeTerrainSeedCode(reportedShareCode);
assert.ok(decodedShareCode, "reported vegetation share code must decode");
const reportedSize = MAP_SIZE_PRESETS[decodedShareCode.mapSize];
assert.ok(reportedSize, "reported vegetation share code must resolve a map size");
const reportedState = createInitialState(decodedShareCode.seed, {
  cols: reportedSize,
  rows: reportedSize,
  totalTiles: reportedSize * reportedSize
});
let reportedSnapshot;
await generateMap(reportedState, new RNG(decodedShareCode.seed), undefined, decodedShareCode.terrain, {
  onPhase: (snapshot) => {
    reportedSnapshot = snapshot;
  },
  stopAfterPhase: "biome:classify"
});
assert.ok(reportedSnapshot, "reported vegetation share code must reach biome classification");

let reportedLand = 0;
let reportedForest = 0;
let reportedCoastLand = 0;
let reportedCoastForest = 0;
let reportedInlandLand = 0;
let reportedInlandForest = 0;
let reportedShelteredDrainageLand = 0;
let reportedShelteredDrainageForest = 0;
let reportedWindwardLand = 0;
let reportedWindwardForest = 0;
let reportedForestCandidates = 0;
let reportedOpenCandidates = 0;
for (let idx = 0; idx < reportedState.grid.totalTiles; idx += 1) {
  const tile = reportedState.tiles[idx];
  if (tile.type === "water") continue;
  reportedLand += 1;
  const isForest = tile.type === "forest";
  if (isForest) reportedForest += 1;
  const coastDistance = reportedState.tileCoastDistance[idx] ?? 0xffff;
  if (coastDistance <= 8) {
    reportedCoastLand += 1;
    if (isForest) reportedCoastForest += 1;
  }
  if (coastDistance > 20) {
    reportedInlandLand += 1;
    if (isForest) reportedInlandForest += 1;
  }
  const windExposure = reportedSnapshot.windExposure?.[idx] ?? 0;
  const leeShelter = reportedSnapshot.leeShelter?.[idx] ?? 0;
  const drainageValue = reportedSnapshot.drainage?.[idx] ?? 0;
  if (coastDistance > 20 && leeShelter >= 0.15 && drainageValue >= 0.22) {
    reportedShelteredDrainageLand += 1;
    if (isForest) reportedShelteredDrainageForest += 1;
  }
  if (windExposure >= 0.25) {
    reportedWindwardLand += 1;
    if (isForest) reportedWindwardForest += 1;
  }
  if (tile.type === "forest" || tile.type === "scrub" || tile.type === "grass" || tile.type === "floodplain") {
    const candidateWeight = getTallTreeAttemptWeight(tile.type);
    const estimatedCandidates =
      (tile.stemDensity ?? 0) * candidateWeight * (0.4 + (tile.canopyCover ?? 0) * 0.8);
    if (isForest) reportedForestCandidates += estimatedCandidates;
    else reportedOpenCandidates += estimatedCandidates;
  }
}
const reportedForestCoverage = reportedForest / Math.max(1, reportedLand);
const reportedCoastForestCoverage = reportedCoastForest / Math.max(1, reportedCoastLand);
const reportedInlandForestCoverage = reportedInlandForest / Math.max(1, reportedInlandLand);
const reportedShelteredDrainageCoverage =
  reportedShelteredDrainageForest / Math.max(1, reportedShelteredDrainageLand);
const reportedWindwardCoverage = reportedWindwardForest / Math.max(1, reportedWindwardLand);
const reportedForestCandidateShare =
  reportedForestCandidates / Math.max(1, reportedForestCandidates + reportedOpenCandidates);
console.log("[vegetation] reported morphology", {
  reportedForestCoverage,
  reportedCoastForestCoverage,
  reportedInlandForestCoverage,
  reportedShelteredDrainageLand,
  reportedShelteredDrainageCoverage,
  reportedWindwardLand,
  reportedWindwardCoverage,
  reportedForestCandidateShare
});
assert.ok(reportedForestCoverage >= 0.02, "reported map must contain readable coherent forest coverage");
assert.ok(reportedCoastForestCoverage <= 0.01, "the first eight coastal tiles must not form a forest ring");
assert.ok(reportedInlandForestCoverage >= 0.025, "reported map must establish inland forest");
if (reportedShelteredDrainageLand >= 16) {
  assert.ok(
    reportedShelteredDrainageCoverage >= 0.1,
    "inland sheltered drainage terrain must establish coherent woodland"
  );
  if (reportedWindwardLand >= 16) {
    assert.ok(
      reportedShelteredDrainageCoverage >= reportedWindwardCoverage * 4,
      "sheltered drainage woodland must materially exceed windward coverage"
    );
  }
}
assert.ok(reportedForestCandidateShare >= 0.85, "actual forest must dominate tall-tree render candidates");

console.log(JSON.stringify({
  fieldHash: hashArray(fieldsA.moisture),
  exposureHash: hashArray(fieldsA.windExposure),
  forestHash: hashArray(maskA),
  windwardSiteQuality: Number(windward.siteQuality.toFixed(4)),
  shelteredSiteQuality: Number(sheltered.siteQuality.toFixed(4)),
  ridgeCanopy: Number(ridgeStructure.canopyCover.toFixed(4)),
  gullyCanopy: Number(gullyStructure.canopyCover.toFixed(4)),
  reportedShareCode: {
    forestCoverage: Number(reportedForestCoverage.toFixed(4)),
    coastForestCoverage: Number(reportedCoastForestCoverage.toFixed(4)),
    inlandForestCoverage: Number(reportedInlandForestCoverage.toFixed(4)),
    shelteredDrainageCoverage: Number(reportedShelteredDrainageCoverage.toFixed(4)),
    windwardCoverage: Number(reportedWindwardCoverage.toFixed(4)),
    forestCandidateShare: Number(reportedForestCandidateShare.toFixed(4))
  }
}, null, 2));
