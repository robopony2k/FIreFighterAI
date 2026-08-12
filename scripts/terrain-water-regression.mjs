import assert from "node:assert/strict";

import { MAP_SIZE_PRESETS } from "../dist/core/config.js";
import { RNG } from "../dist/core/rng.js";
import { createInitialState, TILE_TYPE_IDS } from "../dist/core/state.js";
import { generateMap } from "../dist/mapgen/index.js";
import { getTerrainHeightScaleMultiplier } from "../dist/mapgen/terrainProfile.js";
import { buildRenderTerrainSample } from "../dist/render/simView.js";
import { decodeTerrainSeedCode } from "../dist/ui/terrainSeedCode.js";
import {
  buildTerrainMesh,
  prepareTerrainRenderSurface
} from "../dist/render/threeTestTerrain.js";
import {
  buildInlandWaterfallMeshData,
  splitInlandWaterSurfaceAtWaterfalls
} from "../dist/systems/terrain/rendering/inlandWaterMeshBuilder.js";
import {
  buildInlandWaterTerrainSeam,
  buildInlandWaterTerrainSkirtMesh,
  findNearestInlandWaterTerrainSeamSegment,
  findInlandWaterTerrainSeamVertex,
  getInlandWaterTerrainSeamVerticesAlongEdge,
  INLAND_WATER_GUARD_OVERLAP_CELLS,
  sampleInlandWaterEdgeMotionFactor
} from "../dist/systems/terrain/rendering/inlandWaterTerrainSeam.js";
import {
  buildInlandWaterTerrainCutoutDomain,
  findInlandWaterContourSegment
} from "../dist/systems/terrain/rendering/inlandWaterTerrainCutout.js";
import { INLAND_WATER_CALM_BANK_STATIC_FOAM } from "../dist/render/threeTestRiverWaterHelper.js";
import { MOUNTAIN_ROCK_VERTEX_RELIEF_SCALE } from "../dist/render/terrain/textures/mountainRockMaterial.js";
import {
  buildBoundaryEdgesFromIndexedContour,
  buildCutoutConformingRiverContourMesh,
  buildRiverRenderDomain
} from "../dist/render/terrain/water/riverRenderDomain.js";
import { buildRiverChannelCoverageField } from "../dist/render/terrain/water/riverChannelCoverage.js";
import {
  EPHEMERAL_CREEK_SEASON_WETNESS,
  EPHEMERAL_CREEK_TERRAIN_LIFT_WORLD,
  buildEphemeralCreekRibbonMesh,
  resolveEphemeralCreekWetness
} from "../dist/render/terrain/water/ephemeralCreekRibbonMesh.js";
import {
  buildChannelRibbonTopology,
  sampleChannelReceiverSegment
} from "../dist/render/terrain/water/channelRibbonCenterline.js";
import {
  buildRiverRibbonScalarField,
  hasRiverRibbonMetadata
} from "../dist/render/terrain/water/riverRibbonField.js";
import { buildRiverChannelCoverageMapTexture } from "../dist/render/terrain/water/waterTextures.js";
import {
  applyRiverMouthOceanOverlap,
  isRiverMouthOpeningSegment
} from "../dist/systems/terrain/rendering/riverMouthRenderTransition.js";

const cols = 12;
const rows = 10;
const heightScale = 24;
const idx = (x, y) => y * cols + x;
const fixtures = [
  { name: "straight", river: [[5, 1], [5, 2], [5, 3], [5, 4], [5, 5], [5, 6], [5, 7], [5, 8]] },
  { name: "diagonal", river: [[2, 1], [3, 2], [4, 3], [5, 4], [6, 5], [7, 6], [8, 7]] },
  { name: "meandering", river: [[2, 1], [2, 2], [3, 3], [4, 3], [5, 4], [5, 5], [6, 6], [7, 6], [8, 7]] },
  { name: "lake-inlet", river: [[5, 1], [5, 2], [5, 3]], lake: [[4, 4], [5, 4], [4, 5], [5, 5]] },
  { name: "lake-outlet", lake: [[4, 2], [5, 2], [4, 3], [5, 3]], river: [[5, 4], [5, 5], [5, 6], [5, 7]] },
  { name: "mid-river-waterfall", river: [[5, 1], [5, 2], [5, 3], [5, 4], [5, 5], [5, 6], [5, 7]], waterfall: [[5, 3], [5, 4]] },
  { name: "lake-outlet-waterfall", lake: [[4, 2], [5, 2], [4, 3], [5, 3]], river: [[5, 4], [5, 5], [5, 6]], waterfall: [[5, 3], [5, 4]] },
  { name: "river-mouth", river: [[5, 4], [5, 5], [5, 6], [5, 7]], ocean: [[5, 8], [4, 8], [6, 8]] },
  { name: "empty-water", river: [] }
];

const close = (actual, expected, tolerance, message) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
};

for (const [season, t] of [["winter", 0], ["spring", 0.35], ["summer", 0.58], ["autumn", 0.8]]) {
  close(
    resolveEphemeralCreekWetness(t),
    EPHEMERAL_CREEK_SEASON_WETNESS[season],
    1e-6,
    `${season} ephemeral creek wetness follows the map season blend`
  );
}

const ribbonCols = 5;
const ribbonRows = 5;
const ribbonTotal = ribbonCols * ribbonRows;
const ribbonClass = new Uint8Array(ribbonTotal);
const ribbonWidth = new Float32Array(ribbonTotal);
const ribbonDownstream = new Int32Array(ribbonTotal).fill(-1);
for (const [index, channelClass, width, downstream] of [
  [0, 2, 0.45, 6],
  [2, 2, 0.45, 6],
  [6, 2, 0.65, 11],
  [11, 3, 0.9, 16],
  [16, 3, 1.2, 21]
]) {
  ribbonClass[index] = channelClass;
  ribbonWidth[index] = width;
  ribbonDownstream[index] = downstream;
}
const ribbonField = buildRiverRibbonScalarField({
  cols: ribbonCols,
  rows: ribbonRows,
  channelClass: ribbonClass,
  channelWidth: ribbonWidth,
  channelDownstream: ribbonDownstream
});
assert.ok(ribbonField, "branching receiver graph creates a permanent ribbon field");
assert.equal(
  hasRiverRibbonMetadata({
    total: ribbonTotal,
    channelClass: ribbonClass,
    channelWidth: ribbonWidth,
    channelDownstream: ribbonDownstream
  }),
  true,
  "published receiver links opt supported samples into ribbon rendering"
);
assert.equal(
  hasRiverRibbonMetadata({
    total: ribbonTotal,
    channelClass: new Uint8Array(ribbonTotal),
    channelWidth: new Float32Array(ribbonTotal),
    channelDownstream: new Int32Array(ribbonTotal)
  }),
  false,
  "zero-filled compatibility arrays retain the legacy raster contour fallback"
);
const ribbonSample = (x, y) =>
  ribbonField.values[Math.round(y * ribbonField.scale) * (ribbonField.cellsX + 1) + Math.round(x * ribbonField.scale)];
assert.ok(ribbonSample(1, 1) > 0.5, "direct diagonal receiver link is covered between source cell centres");
assert.ok(ribbonSample(1.5, 2.5) > 0.5, "receiver-derived trunk remains continuous through convergence");
const coveredRibbonSamplesAtY = (y) => {
  const sampleY = Math.round(y * ribbonField.scale);
  let count = 0;
  for (let sampleX = 0; sampleX <= ribbonField.cellsX; sampleX += 1) {
    if (ribbonField.values[sampleY * (ribbonField.cellsX + 1) + sampleX] > 0.5) count += 1;
  }
  return count;
};
assert.ok(
  coveredRibbonSamplesAtY(3.5) > coveredRibbonSamplesAtY(1.5),
  "downstream ribbon widens with flow"
);

const ephemeralClass = Uint8Array.from(ribbonClass, (value) => value > 0 ? 1 : 0);
const ephemeralMesh = buildEphemeralCreekRibbonMesh({
  cols: ribbonCols,
  rows: ribbonRows,
  width: 50,
  depth: 50,
  heightScale: 20,
  elevations: new Float32Array(ribbonTotal).fill(0.4),
  channelClass: ephemeralClass,
  channelWidth: ribbonWidth,
  channelDownstream: ribbonDownstream
});
assert.ok(ephemeralMesh?.indices.length, "ephemeral receiver links create a separate terrain-draped ribbon mesh");
assert.ok(
  EPHEMERAL_CREEK_TERRAIN_LIFT_WORLD < 0.008,
  "ephemeral creek stays below the normal road-deck lift where both follow a contour"
);
assert.ok(ephemeralMesh.internalSharedSectionCount > 0, "continuous branches share internal strip sections");
assert.ok(
  ephemeralMesh.positions.length / 3 < ephemeralMesh.indices.length,
  "continuous ephemeral strips reuse vertices instead of overlapping independent segment quads"
);
assert.equal(ephemeralMesh.opacityFactor.length, ephemeralMesh.positions.length / 3);
close(ephemeralMesh.positions[0], ephemeralMesh.positions[3], 1e-7, "headwater left edge tapers to its centre");
close(ephemeralMesh.positions[2], ephemeralMesh.positions[5], 1e-7, "headwater left edge Z tapers to its centre");
close(ephemeralMesh.positions[6], ephemeralMesh.positions[3], 1e-7, "headwater right edge tapers to its centre");
close(ephemeralMesh.positions[8], ephemeralMesh.positions[5], 1e-7, "headwater right edge Z tapers to its centre");
assert.deepEqual(
  buildEphemeralCreekRibbonMesh({
    cols: ribbonCols,
    rows: ribbonRows,
    width: 50,
    depth: 50,
    heightScale: 20,
    elevations: new Float32Array(ribbonTotal).fill(0.4),
    channelClass: ephemeralClass,
    channelWidth: ribbonWidth,
    channelDownstream: ribbonDownstream
  }),
  ephemeralMesh,
  "continuous ephemeral ribbon geometry is bit-identical"
);

const transitionClass = new Uint8Array([1, 1, 2]);
const transitionMesh = buildEphemeralCreekRibbonMesh({
  cols: 3,
  rows: 1,
  width: 30,
  depth: 10,
  heightScale: 20,
  elevations: new Float32Array([0.4, 0.5, 0.6]),
  channelClass: transitionClass,
  channelWidth: new Float32Array([0.2, 0.35, 0.6]),
  channelDownstream: new Int32Array([1, 2, -1])
});
assert.ok(transitionMesh, "ephemeral-to-stream transition creates a creek strip");
assert.equal(Math.min(...transitionMesh.opacityFactor), 0, "creek fades completely beneath permanent water");
assert.ok(Math.max(...transitionMesh.opacityFactor) > 0.99, "upstream creek remains fully visible");
const transitionHeights = [];
for (let index = 1; index < transitionMesh.positions.length; index += 9) {
  transitionHeights.push(transitionMesh.positions[index]);
}
assert.ok(
  new Set(transitionHeights.map((height) => height.toFixed(4))).size > 3,
  "subdivided creek sections resample changing terrain height"
);

const curvedClass = new Uint8Array(16);
const curvedDownstream = new Int32Array(16).fill(-1);
for (const [source, target] of [[1, 5], [5, 6], [6, 10]]) {
  curvedClass[source] = 1;
  curvedClass[target] = 1;
  curvedDownstream[source] = target;
}
const curvedTopology = buildChannelRibbonTopology({
  cols: 4,
  rows: 4,
  channelClass: curvedClass,
  channelDownstream: curvedDownstream
});
const curvedSegment = sampleChannelReceiverSegment({
  cols: 4,
  rows: 4,
  channelClass: curvedClass,
  channelDownstream: curvedDownstream,
  topology: curvedTopology,
  source: 5,
  elevations: new Float32Array(16).fill(0.4)
});
assert.ok(curvedSegment.length >= 5, "receiver link is subdivided for terrain-conforming ribbon sampling");
assert.ok(
  curvedSegment.slice(1, -1).some((point) => Math.abs(point.y - 1.5) > 1e-4),
  "receiver corner follows a bounded curve instead of one straight cell-centre chord"
);

const contourArea = (domain) => {
  let area = 0;
  for (let i = 0; i < domain.contourIndices.length; i += 3) {
    const a = domain.contourIndices[i] * 2;
    const b = domain.contourIndices[i + 1] * 2;
    const c = domain.contourIndices[i + 2] * 2;
    const ax = domain.contourVertices[a];
    const ay = domain.contourVertices[a + 1];
    const bx = domain.contourVertices[b];
    const by = domain.contourVertices[b + 1];
    const cx = domain.contourVertices[c];
    const cy = domain.contourVertices[c + 1];
    area += Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) * 0.5;
  }
  return area;
};

const buildStraightHierarchyDomain = (width) => {
  const domainCols = 8;
  const domainRows = 5;
  const total = domainCols * domainRows;
  const riverMask = new Uint8Array(total);
  const riverChannelWidth = new Float32Array(total);
  const riverSurface = new Float32Array(total).fill(Number.NaN);
  const tileTypes = new Uint8Array(total).fill(TILE_TYPE_IDS.grass);
  for (let x = 1; x <= 6; x += 1) {
    const index = 2 * domainCols + x;
    riverMask[index] = 1;
    riverChannelWidth[index] = width;
    riverSurface[index] = 0.3;
    tileTypes[index] = TILE_TYPE_IDS.water;
  }
  return buildRiverRenderDomain({
    cols: domainCols,
    rows: domainRows,
    elevations: new Float32Array(total).fill(0.31),
    tileTypes,
    riverMask,
    riverChannelWidth,
    riverSurface
  }, TILE_TYPE_IDS.water);
};

const hiddenHierarchyDomain = buildStraightHierarchyDomain(0);
const narrowHierarchyDomain = buildStraightHierarchyDomain(0.24);
const wideHierarchyDomain = buildStraightHierarchyDomain(1.24);
assert.ok(hiddenHierarchyDomain, "authoritative river cutout remains present for visually hidden drainage");
assert.ok(narrowHierarchyDomain, "ephemeral channel produces a contour");
assert.ok(wideHierarchyDomain, "major river produces a contour");
close(contourArea(hiddenHierarchyDomain), contourArea(narrowHierarchyDomain), 1e-9, "channel width preserves terrain cutout");
close(contourArea(narrowHierarchyDomain), contourArea(wideHierarchyDomain), 1e-9, "major-river width preserves terrain cutout");

const buildStraightCoverage = (width) => {
  const coverageCols = 8;
  const coverageRows = 5;
  const riverMask = new Uint8Array(coverageCols * coverageRows);
  const riverChannelWidth = new Float32Array(coverageCols * coverageRows);
  for (let x = 1; x <= 6; x += 1) {
    const index = 2 * coverageCols + x;
    riverMask[index] = 1;
    riverChannelWidth[index] = width;
  }
  return buildRiverChannelCoverageField({
    cols: coverageCols,
    rows: coverageRows,
    riverMask,
    riverChannelWidth
  });
};
const hiddenCoverage = buildStraightCoverage(0);
const narrowCoverage = buildStraightCoverage(0.24);
const wideCoverage = buildStraightCoverage(1.24);
const coverageArea = (field) => field.data.reduce((sum, value) => sum + value / 255, 0);
assert.equal(coverageArea(hiddenCoverage), 0, "zero-width headwater drainage has no visible water coverage");
assert.ok(
  coverageArea(wideCoverage) > coverageArea(narrowCoverage) * 2.5,
  "flow-derived width materially increases visible downstream water coverage"
);
for (let x = 1; x <= 6; x += 1) {
  const center = (2 * 2 + 1) * narrowCoverage.width + (2 * x + 1);
  assert.ok(narrowCoverage.data[center] > 0, "orthogonally routed creek coverage remains connected");
}

const buildFixture = (fixture, step) => {
  const total = cols * rows;
  const riverMask = new Uint8Array(total);
  const lakeMask = new Uint16Array(total);
  const oceanMask = new Uint8Array(total);
  const riverSurface = new Float32Array(total).fill(Number.NaN);
  const riverBed = new Float32Array(total).fill(Number.NaN);
  const riverStepStrength = new Float32Array(total);
  const lakeSurface = new Float32Array(total).fill(Number.NaN);
  const sourceMask = new Uint8Array(total);
  const targetMap = new Int32Array(total).fill(-1);
  const tileTypes = new Uint8Array(total).fill(TILE_TYPE_IDS.grass);
  for (const [x, y] of fixture.river ?? []) {
    const i = idx(x, y);
    riverMask[i] = 1;
    riverSurface[i] = 0.64 - y * 0.008;
    riverBed[i] = riverSurface[i] - 0.012;
    tileTypes[i] = TILE_TYPE_IDS.water;
  }
  for (const [x, y] of fixture.lake ?? []) {
    const i = idx(x, y);
    lakeMask[i] = 1;
    lakeSurface[i] = 0.61;
    tileTypes[i] = TILE_TYPE_IDS.water;
  }
  for (const [x, y] of fixture.ocean ?? []) {
    oceanMask[idx(x, y)] = 1;
    tileTypes[idx(x, y)] = TILE_TYPE_IDS.water;
  }
  if (fixture.name === "lake-inlet") riverSurface[idx(5, 3)] = 0.61;
  if (fixture.name === "lake-outlet") riverSurface[idx(5, 4)] = 0.61;
  if (fixture.waterfall) {
    const [[sx, sy], [tx, ty]] = fixture.waterfall;
    const source = idx(sx, sy);
    const target = idx(tx, ty);
    sourceMask[source] = 1;
    targetMap[source] = target;
    if (lakeMask[source]) lakeSurface[source] = 0.64;
    else riverSurface[source] = 0.64;
    riverSurface[target] = 0.55;
  }
  if (fixture.name !== "empty-water") {
    sourceMask[idx(1, 8)] = 1;
    targetMap[idx(1, 8)] = idx(2, 8);
  }
  const terrainHeights = new Float32Array(total);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) terrainHeights[y * cols + x] = 0.3 + x * 0.003 + y * 0.004;
  }
  const sample = {
    cols,
    rows,
    elevations: terrainHeights,
    heightScaleMultiplier: heightScale / 18,
    tileTypes,
    riverMask,
    lakeMask,
    oceanMask,
    riverSurface,
    riverBed,
    riverStepStrength,
    lakeSurface,
    waterfallSourceMask: sourceMask,
    waterfallTarget: targetMap,
    debugTypeColors: true,
    debugRenderOptions: { terrainSampleStrideOverride: step }
  };
  const terrainSurface = prepareTerrainRenderSurface(sample);
  const terrainResult = buildTerrainMesh(terrainSurface, null, null, null);
  const inland = terrainResult.water?.inland?.surface;
  return {
    inland, terrainResult, riverMask, lakeMask, oceanMask, riverSurface, tileTypes,
    width: terrainSurface.width, depth: terrainSurface.depth
  };
};

let cases = 0;
const steepBoundarySamples = [
  { ax: 0, ay: 0, terrainTopA: 9, uA: 0, vA: 0, bx: 1, by: 0, terrainTopB: 5, uB: 0.5, vB: 0, sourceContourSegmentId: 0, sourceTerrainTriangleId: 0, openToOcean: false },
  { ax: 1, ay: 0, terrainTopA: 5, uA: 0.5, vA: 0, bx: 2, by: 0, terrainTopB: 1, uB: 1, vB: 0, sourceContourSegmentId: 1, sourceTerrainTriangleId: 1, openToOcean: false },
  { ax: 2, ay: 0, terrainTopA: 1, uA: 1, vA: 0, bx: 2, by: 2, terrainTopB: 3, uB: 1, vB: 1, sourceContourSegmentId: 2, sourceTerrainTriangleId: 2, openToOcean: false },
  { ax: 2, ay: 2, terrainTopA: 3, uA: 1, vA: 1, bx: 0, by: 2, terrainTopB: 3, uB: 0, vB: 1, sourceContourSegmentId: 3, sourceTerrainTriangleId: 3, openToOcean: false },
  { ax: 0, ay: 2, terrainTopA: 3, uA: 0, vA: 1, bx: 0, by: 0, terrainTopB: 9, uB: 0, vB: 0, sourceContourSegmentId: 4, sourceTerrainTriangleId: 4, openToOcean: false }
];
const splitSquareWaterSegments = [
  { id: 0, sourceA: 0, sourceB: 1, ax: 0, ay: 0, bx: 1, by: 0, waterwardX: 0, waterwardY: 1 },
  { id: 1, sourceA: 1, sourceB: 2, ax: 1, ay: 0, bx: 2, by: 0, waterwardX: 0, waterwardY: 1 },
  { id: 2, sourceA: 2, sourceB: 3, ax: 2, ay: 0, bx: 2, by: 2, waterwardX: -1, waterwardY: 0 },
  { id: 3, sourceA: 3, sourceB: 4, ax: 2, ay: 2, bx: 0, by: 2, waterwardX: 0, waterwardY: -1 },
  { id: 4, sourceA: 4, sourceB: 0, ax: 0, ay: 2, bx: 0, by: 0, waterwardX: 1, waterwardY: 0 }
];
const splitSquareWaterBoundary = new Float32Array([
  0, 0, 1, 0, 1, 0, 2, 0, 2, 0, 2, 2, 2, 2, 0, 2, 0, 2, 0, 0
]);
const seam = buildInlandWaterTerrainSeam({
  boundarySamples: steepBoundarySamples,
  waterBoundarySegments: splitSquareWaterSegments,
  heightScale: 24,
  waterSurfaceLiftWorld: 0,
  sampleWaterWorldYAtEdge: () => 8
});
assert.ok(seam, "canonical seam builds for steep mixed-height lake fixture");
assert.equal(seam.vertexIdByQuantizedKey.size, seam.vertices.length, "canonical seam indexes every vertex once");
assert.ok(seam.vertexBuckets.size > 0, "canonical seam exposes spatial vertex buckets");
assert.deepEqual(
  getInlandWaterTerrainSeamVerticesAlongEdge(seam, 0, 0, 2, 0).map((vertex) => [vertex.edgeX, vertex.edgeY]),
  [[0, 0], [1, 0], [2, 0]],
  "bucketed along-edge lookup retains ordered canonical seam vertices"
);
assert.equal(seam.diagnostics.unmatchedWaterVertexCount, 0, "all full-resolution water vertices match terrain seam");
assert.equal(seam.diagnostics.tJunctionCount, 0, "canonical seam removes T-junctions");
assert.equal(seam.diagnostics.unexpectedOpenEndCount, 0, "closed lake seam has degree two");
assert.equal(seam.components.length, 1, "closed lake remains one component");
assert.equal(seam.components[0].closed, true, "lake seam component is closed");
const steepMidpoint = findInlandWaterTerrainSeamVertex(seam, 1, 0);
assert.ok(steepMidpoint, "intermediate lake boundary vertex is retained");
close(steepMidpoint.rawTerrainTopWorldY, 5, 1e-9, "steep seam retains interpolated terrain height");
close(steepMidpoint.terrainTopWorldY, 8 + seam.overlapWorld, 1e-9, "steep seam lifts terrain closure above water");
close(steepMidpoint.skirtBottomWorldY, 8 - seam.overlapWorld, 1e-9, "skirt bottom overlaps below water");
assert.equal(seam.diagnostics.waterAboveSeamMax, 0, "water never exceeds canonical seam top");
assert.ok(seam.diagnostics.seamLiftMax > 3, "steep render-only seam lift is diagnosed");
close(sampleInlandWaterEdgeMotionFactor(seam, 1, 0), 0, 1e-9, "closed bank displacement is exactly zero");
close(sampleInlandWaterEdgeMotionFactor(seam, 1, 1), 1, 1e-9, "water displacement reaches full strength one cell inland");
const skirtMesh = buildInlandWaterTerrainSkirtMesh(seam, (x) => x, (y) => y);
assert.equal(skirtMesh.indices.length, seam.segments.length * 24, "every closed segment emits skirt faces plus a submerged guard strip");
assert.equal(
  skirtMesh.positions.length,
  seam.vertices.length * 6 + seam.segments.length * 12,
  "guard strips extend the shared skirt joints without another mesh"
);
const firstGuardPositionOffset = seam.vertices.length * 6;
for (let offset = firstGuardPositionOffset + 1; offset < skirtMesh.positions.length; offset += 3) {
  assert.ok(skirtMesh.positions[offset] < 8, "every guard-strip vertex remains below authoritative water");
}
close(
  skirtMesh.positions[firstGuardPositionOffset + 8],
  INLAND_WATER_GUARD_OVERLAP_CELLS,
  1e-9,
  "guard strip follows the contour-derived waterward direction"
);
assert.ok(
  seam.diagnostics.guardOverlapMin >= INLAND_WATER_GUARD_OVERLAP_CELLS - 1e-9,
  "closed lake guard overlaps water by the configured minimum"
);
const mouthSeam = buildInlandWaterTerrainSeam({
  boundarySamples: steepBoundarySamples.map((sample, index) => ({ ...sample, openToOcean: index === 3 })),
  waterBoundarySegments: splitSquareWaterSegments,
  heightScale: 24,
  waterSurfaceLiftWorld: 0,
  sampleWaterWorldYAtEdge: () => 8
});
assert.ok(mouthSeam, "river-mouth seam builds");
const mouthSkirtMesh = buildInlandWaterTerrainSkirtMesh(mouthSeam, (x) => x, (y) => y);
const mouthOpeningSegmentCount = mouthSeam.segments.filter((segment) => segment.openToOcean).length;
assert.ok(mouthOpeningSegmentCount > 0, "river-mouth opening is marked on canonical segments");
assert.equal(mouthSeam.components.length, 1, "river-mouth closure remains one component");
assert.equal(mouthSeam.components[0].closed, false, "river-mouth closure is an intentional open chain");
assert.equal(mouthSeam.diagnostics.unexpectedOpenEndCount, 0, "river-mouth endpoints are intentional");
assert.equal(
  mouthSkirtMesh.indices.length,
  (mouthSeam.segments.length - mouthOpeningSegmentCount) * 24,
  "neither skirt nor guard geometry crosses a river-mouth opening"
);
close(sampleInlandWaterEdgeMotionFactor(mouthSeam, 1, 2), 1, 1e-9, "river-mouth opening keeps the ocean hand-off motion path");
const syntheticContour = {
  cols: 2,
  rows: 2,
  baseSupport: new Uint8Array(4),
  renderSupport: new Uint8Array(4),
  vertexField: new Float32Array(9),
  contourVertices: new Float32Array([0, 0, 2, 0, 2, 2, 0, 2]),
  contourIndices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  boundaryEdges: new Float32Array([0, 0, 2, 0, 2, 0, 2, 2, 2, 2, 0, 2, 0, 2, 0, 0]),
  terrainSeam: seam,
  distanceToBank: new Int16Array(4)
};
const syntheticCutoutDomain = buildInlandWaterTerrainCutoutDomain({
  contourVertices: syntheticContour.contourVertices,
  contourIndices: syntheticContour.contourIndices,
  cols: syntheticContour.cols,
  rows: syntheticContour.rows
});
assert.ok(syntheticCutoutDomain.boundarySegmentBuckets.size > 0, "cutout domain indexes boundary segments spatially");
assert.equal(
  findInlandWaterContourSegment(syntheticCutoutDomain, 0, 0, 1, 0)?.id,
  0,
  "bucketed contour lookup preserves deterministic segment selection"
);
const conforming = buildCutoutConformingRiverContourMesh(syntheticContour);
const conformingBoundary = buildBoundaryEdgesFromIndexedContour(conforming.vertices, conforming.indices);
const boundaryPointKeys = new Set();
for (let i = 0; i + 3 < conformingBoundary.length; i += 4) {
  boundaryPointKeys.add(`${conformingBoundary[i].toFixed(5)},${conformingBoundary[i + 1].toFixed(5)}`);
  boundaryPointKeys.add(`${conformingBoundary[i + 2].toFixed(5)},${conformingBoundary[i + 3].toFixed(5)}`);
}
assert.ok(boundaryPointKeys.has("1.00000,0.00000"), "water topology inserts terrain cutout endpoint");
assert.ok(conforming.indices.length > syntheticContour.contourIndices.length, "affected water triangle is retriangulated");
assert.equal(conformingBoundary.length, seam.boundaryEdges.length, "water and terrain use identical boundary segmentation");
for (let i = 0; i + 3 < seam.boundaryEdges.length; i += 4) {
  const a = `${seam.boundaryEdges[i].toFixed(5)},${seam.boundaryEdges[i + 1].toFixed(5)}`;
  const b = `${seam.boundaryEdges[i + 2].toFixed(5)},${seam.boundaryEdges[i + 3].toFixed(5)}`;
  let matched = false;
  for (let edge = 0; edge + 3 < conformingBoundary.length; edge += 4) {
    const c = `${conformingBoundary[edge].toFixed(5)},${conformingBoundary[edge + 1].toFixed(5)}`;
    const d = `${conformingBoundary[edge + 2].toFixed(5)},${conformingBoundary[edge + 3].toFixed(5)}`;
    if ((a === c && b === d) || (a === d && b === c)) matched = true;
  }
  assert.equal(matched, true, `canonical seam segment ${a}|${b} appears in water topology`);
}
for (const fixture of fixtures) {
  for (const step of [1, 2, 3, 4]) {
      const built = buildFixture(fixture, step);
    if (fixture.name === "empty-water") {
      assert.equal(built.inland, undefined, `empty fixture step ${step}`);
      built.terrainResult.mesh.geometry.dispose();
      cases += 1;
      continue;
    }
    const inland = built.inland;
    assert.ok(inland, `${fixture.name} step ${step} should build inland water`);
    const productionSeam = inland.terrainSeam;
    assert.ok(productionSeam, `${fixture.name} step ${step} production mesh builds a seam`);
    assert.equal(productionSeam.diagnostics.originalBoundaryDisplacementMax, 0, `${fixture.name} step ${step} immutable contour`);
    assert.equal(productionSeam.diagnostics.unmatchedWaterVertexCount, 0, `${fixture.name} step ${step} unmatched vertices`);
    assert.equal(productionSeam.diagnostics.tJunctionCount, 0, `${fixture.name} step ${step} T-junctions`);
    assert.equal(productionSeam.diagnostics.unexpectedOpenEndCount, 0, `${fixture.name} step ${step} unexpected open ends`);
    assert.equal(productionSeam.diagnostics.degenerateBoundaryTriangleCount, 0, `${fixture.name} step ${step} degenerate boundary triangles`);
    assert.equal(inland.diagnostics.segmentXzErrorMax, 0, `${fixture.name} step ${step} shared segmentation`);
    assert.equal(inland.diagnostics.skirtJointGapMax, 0, `${fixture.name} step ${step} skirt joints`);
    assert.equal(inland.diagnostics.waterAboveSeamMax, 0, `${fixture.name} step ${step} height ordering`);
    assert.ok(productionSeam.segments.length > 0, `${fixture.name} step ${step} non-default production diagnostics`);
    const edgeMotion = built.terrainResult.water?.inland?.mesh.edgeMotionFactor;
    assert.ok(edgeMotion && edgeMotion.some((value) => value === 0), `${fixture.name} step ${step} bank motion reaches zero`);
    assert.equal(inland.diagnostics.terrainWaterXzErrorMax, 0);
    assert.equal(inland.diagnostics.orphanMarkerCount, 1);
    for (const edgeX of [0, 1.25, cols * 0.5, cols]) {
      close(inland.worldToEdgeX(inland.edgeToWorldX(edgeX)), edgeX, 1e-5, `${fixture.name} x transform`);
    }
    for (const edgeY of [0, 1.75, rows * 0.5, rows]) {
      close(inland.worldToEdgeY(inland.edgeToWorldZ(edgeY)), edgeY, 1e-5, `${fixture.name} z transform`);
    }
    for (let i = 0; i < inland.support.length; i += 1) {
      assert.equal(inland.support[i] > 0 && built.oceanMask[i] > 0, false, `${fixture.name} ocean excluded`);
      if (!inland.support[i]) continue;
      const normalized = built.lakeMask[i] ? 0.61 : built.riverSurface[i];
      if (!fixture.waterfall || i !== idx(fixture.waterfall[0][0], fixture.waterfall[0][1])) {
        close(inland.surfaceWorldY[i], normalized * inland.heightScale, 1e-4, `${fixture.name} world height`);
      }
    }
    const domain = buildRiverRenderDomain({
      cols, rows, elevations: new Float32Array(cols * rows).fill(0.3),
      tileTypes: built.tileTypes,
      riverMask: built.riverMask,
      lakeMask: built.lakeMask,
      riverSurface: built.riverSurface,
      inlandWater: inland
    }, TILE_TYPE_IDS.water);
    assert.ok(domain, `${fixture.name} contour`);
    if (fixture.name === "river-mouth") {
      const mouth = idx(5, 7);
      const upstream = idx(5, 6);
      assert.equal(inland.riverMouthMask[mouth], 1, `river-mouth step ${step} terminal cell`);
      close(inland.riverMouthBlend[mouth], 1, 1e-9, `river-mouth step ${step} terminal blend`);
      close(inland.riverMouthBlend[upstream], 0.35, 1e-6, `river-mouth step ${step} upstream blend`);
      assert.equal(inland.oceanOverlapMask[mouth], 1, `river-mouth step ${step} ocean overlap`);
      assert.equal(built.oceanMask[mouth], 0, `river-mouth step ${step} authoritative ocean unchanged`);
      assert.ok(
        isRiverMouthOpeningSegment(5, 8, 6, 8, inland.riverMouthOpeningEdges),
        `river-mouth step ${step} opening edge`
      );
      let contourReachesOcean = false;
      for (let edge = 0; edge + 3 < domain.boundaryEdges.length; edge += 4) {
        if (
          isRiverMouthOpeningSegment(
            domain.boundaryEdges[edge],
            domain.boundaryEdges[edge + 1],
            domain.boundaryEdges[edge + 2],
            domain.boundaryEdges[edge + 3],
            inland.riverMouthOpeningEdges
          )
        ) {
          contourReachesOcean = true;
          break;
        }
      }
      assert.equal(contourReachesOcean, true, `river-mouth step ${step} contour reaches shared ocean edge`);
    }
    for (let i = 0; i + 3 < domain.boundaryEdges.length; i += 4) {
      const ax = domain.boundaryEdges[i];
      const ay = domain.boundaryEdges[i + 1];
      const bx = domain.boundaryEdges[i + 2];
      const by = domain.boundaryEdges[i + 3];
      assert.ok(Number.isFinite(inland.sampleWaterWorldYAtEdge(ax, ay)), `${fixture.name} uncovered boundary A`);
      assert.ok(Number.isFinite(inland.sampleWaterWorldYAtEdge(bx, by)), `${fixture.name} uncovered boundary B`);
    }
    if (fixture.waterfall) {
      assert.equal(inland.waterfalls.length, 1, `${fixture.name} waterfall span`);
      const span = inland.waterfalls[0];
      const curtain = buildInlandWaterfallMeshData(inland.waterfalls, 0);
      assert.equal(curtain.waterfallIndices.length, 6);
      close(curtain.waterfallPositions[1], span.topWorldY, 1e-4, `${fixture.name} curtain top`);
      close(curtain.waterfallPositions[7], span.bottomWorldY, 1e-4, `${fixture.name} curtain bottom`);
      close(span.dropWorld, span.topWorldY - span.bottomWorldY, 1e-4, `${fixture.name} final drop`);
      const source = idx(fixture.waterfall[0][0], fixture.waterfall[0][1]);
      const target = idx(fixture.waterfall[1][0], fixture.waterfall[1][1]);
      const expectedX = (inland.cellCenterToWorldX(source % cols) + inland.cellCenterToWorldX(target % cols)) * 0.5;
      const expectedZ = (inland.cellCenterToWorldZ(Math.floor(source / cols)) + inland.cellCenterToWorldZ(Math.floor(target / cols))) * 0.5;
      close(span.centerWorldX, expectedX, 1e-5, `${fixture.name} lip x`);
      close(span.centerWorldZ, expectedZ, 1e-5, `${fixture.name} lip z`);
      const split = splitInlandWaterSurfaceAtWaterfalls({
        positions: [span.centerWorldX - span.flowWorldX, 0, span.centerWorldZ - span.flowWorldZ, span.centerWorldX + span.flowWorldX, 0, span.centerWorldZ + span.flowWorldZ, span.leftWorldX, 0, span.leftWorldZ],
        uvs: [0, 0, 1, 0, 0, 1], indices: [0, 1, 2], bankDist: [1, 1, 1],
        flowDir: [1, 0, 1, 0, 1, 0], flowSpeed: [1, 1, 1], rapid: [0, 0, 0], lakeFactor: [0, 0, 0],
        riverMouthBlend: [0, 0, 0], edgeMotionFactor: [1, 1, 1]
      }, [span], 0);
      assert.equal(split.indices.length, 0, `${fixture.name} no triangle crosses lip`);
    }
    built.terrainResult.mesh.geometry.dispose();
    cases += 1;
  }
}

const CAPTURED_CHANNEL_SHARE_CODE = "MAP7-35R80P-3102J2S161P1K1G1E0U2S142A1K2G1W0Y1M1A181Q0K1K12161C";
const capturedChannelRecipe = decodeTerrainSeedCode(CAPTURED_CHANNEL_SHARE_CODE);
assert.ok(capturedChannelRecipe, "captured channel-hierarchy share code decodes");
const capturedChannelSize = MAP_SIZE_PRESETS[capturedChannelRecipe.mapSize];
const capturedChannelGrid = {
  cols: capturedChannelSize,
  rows: capturedChannelSize,
  totalTiles: capturedChannelSize * capturedChannelSize
};
const capturedChannelState = createInitialState(capturedChannelRecipe.seed, capturedChannelGrid);
await generateMap(capturedChannelState, new RNG(capturedChannelRecipe.seed), undefined, capturedChannelRecipe.terrain, {
  stopAfterPhase: "hydro:rivers",
  onPhase: () => {}
});
let capturedPermanentCells = 0;
let capturedLakeCells = 0;
let capturedMouths = 0;
let capturedFlowMouths = 0;
let capturedHeadwaters = 0;
const capturedUpstreamCounts = new Uint16Array(capturedChannelGrid.totalTiles);
for (let index = 0; index < capturedChannelGrid.totalTiles; index += 1) {
  if (capturedChannelState.tileRiverMask[index] > 0) capturedPermanentCells += 1;
  if (capturedChannelState.tileLakeMask[index] > 0) capturedLakeCells += 1;
  const target = capturedChannelState.tileRiverChannelDownstream[index];
  if (target >= 0 && capturedChannelState.tileRiverChannelClass[target] > 0) capturedUpstreamCounts[target] += 1;
  if (
    capturedChannelState.tileRiverChannelClass[index] >= 2 &&
    target >= 0 &&
    capturedChannelState.tileOceanMask[target] > 0
  ) {
    capturedFlowMouths += 1;
  }
  if (capturedChannelState.tileRiverMask[index] > 0) {
    const x = index % capturedChannelGrid.cols;
    const y = Math.floor(index / capturedChannelGrid.cols);
    let touchesOcean = false;
    for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= capturedChannelGrid.cols || ny >= capturedChannelGrid.rows) continue;
        if (capturedChannelState.tileOceanMask[ny * capturedChannelGrid.cols + nx] > 0) {
          touchesOcean = true;
          break;
        }
    }
    if (touchesOcean) capturedMouths += 1;
  }
}
for (let index = 0; index < capturedChannelGrid.totalTiles; index += 1) {
  if (capturedChannelState.tileRiverChannelClass[index] > 0 && capturedUpstreamCounts[index] === 0) {
    capturedHeadwaters += 1;
  }
}
assert.ok(
  capturedPermanentCells >= 2_500 && capturedPermanentCells <= 2_850,
  `captured fixture permanent river growth stays bounded (${capturedPermanentCells} cells)`
);
assert.equal(capturedLakeCells, 809, "captured fixture preserves the established lake footprint");
assert.equal(capturedMouths, 28, "anchored tributaries do not multiply coastal mouths");
console.log(
  `[terrain-water-channels] permanent=${capturedPermanentCells} lakes=${capturedLakeCells} ` +
    `mouth-cells=${capturedMouths} flow-mouths=${capturedFlowMouths} flow-heads=${capturedHeadwaters}`
);
const capturedChannelCoverage = buildRiverChannelCoverageField({
  cols: capturedChannelGrid.cols,
  rows: capturedChannelGrid.rows,
  riverMask: capturedChannelState.tileRiverMask,
  riverChannelWidth: capturedChannelState.tileRiverChannelWidth,
  lakeMask: capturedChannelState.tileLakeMask
});
const capturedChannelTexture = buildRiverChannelCoverageMapTexture(
  capturedChannelCoverage.data,
  capturedChannelCoverage.width,
  capturedChannelCoverage.height
);
const capturedChannelPixels = capturedChannelTexture.image.data;
let capturedAlignedCenters = 0;
let capturedVisibleCenters = 0;
for (let y = 0; y < capturedChannelGrid.rows; y += 1) {
  for (let x = 0; x < capturedChannelGrid.cols; x += 1) {
    const index = y * capturedChannelGrid.cols + x;
    if (capturedChannelState.tileRiverMask[index] === 0 || capturedChannelState.tileRiverChannelWidth[index] <= 0) continue;
    capturedVisibleCenters += 1;
    const sampleX = x * 2 + 1;
    const sampleY = y * 2 + 1;
    if (capturedChannelPixels[(sampleY * capturedChannelCoverage.width + sampleX) * 4] > 127) {
      capturedAlignedCenters += 1;
    }
  }
}
assert.ok(
  capturedAlignedCenters / capturedVisibleCenters >= 0.9,
  `captured channel coverage must upload without vertical mirroring (${capturedAlignedCenters}/${capturedVisibleCenters} aligned)`
);
capturedChannelTexture.dispose();

const REPORTED_SHARE_CODE = "MAP7-115-2202R2S1W1M152B0R1G2R2C1X1N1J140Y1M1A181Q0K1K12161C";
const decoded = decodeTerrainSeedCode(REPORTED_SHARE_CODE);
assert.ok(decoded, "reported inland-water share code decodes");
const productionSize = MAP_SIZE_PRESETS[decoded.mapSize];
assert.ok(productionSize, "reported inland-water map size resolves");
const productionGrid = {
  cols: productionSize,
  rows: productionSize,
  totalTiles: productionSize * productionSize
};
const productionState = createInitialState(decoded.seed, productionGrid);
await generateMap(productionState, new RNG(decoded.seed), undefined, decoded.terrain, {
  stopAfterPhase: "hydro:rivers",
  onPhase: () => {}
});
const productionHeightMultiplier = getTerrainHeightScaleMultiplier(decoded.terrain, decoded.mapSize);
const productionSample = buildRenderTerrainSample(
  productionState,
  new Uint8Array(productionGrid.totalTiles),
  true,
  false,
  false,
  true,
  productionHeightMultiplier
);
assert.equal(productionSample.riverChannelClass.length, productionGrid.totalTiles);
assert.equal(productionSample.riverChannelWidth.length, productionGrid.totalTiles);
assert.equal(productionSample.riverChannelDownstream.length, productionGrid.totalTiles);
let visibleChannelTiles = 0;
const productionChannelWidths = [];
for (let index = 0; index < productionGrid.totalTiles; index += 1) {
  const channelClass = productionSample.riverChannelClass[index];
  if (productionSample.lakeMask[index] > 0) {
    assert.equal(channelClass, 0, "lake cells are represented by the unchanged lake contour, not flow nodes");
    continue;
  }
  if (channelClass === 1) {
    assert.equal(productionSample.riverMask[index], 0, "ephemeral creeks remain traversable non-water terrain");
    assert.notEqual(productionSample.tileTypes[index], TILE_TYPE_IDS.water, "ephemeral creeks do not change gameplay tile type");
  } else if (channelClass >= 2) {
    assert.equal(productionSample.riverMask[index], 1, "streams and rivers remain authoritative gameplay water");
  }
  if (channelClass >= 2 && productionSample.riverChannelWidth[index] > 0) {
    visibleChannelTiles += 1;
    productionChannelWidths.push(productionSample.riverChannelWidth[index]);
  }
}
assert.ok(visibleChannelTiles > 0, "production map publishes visible flow-derived channel widths");
productionChannelWidths.sort((left, right) => left - right);
const productionMedianChannelWidth = productionChannelWidths[Math.floor(productionChannelWidths.length * 0.5)] ?? 0;
assert.ok(
  productionMedianChannelWidth >= 0.45,
  `production river hierarchy must not collapse its median visible channel below strategic readability (${productionMedianChannelWidth.toFixed(3)} cells)`
);
const productionSurface = prepareTerrainRenderSurface(productionSample);
const productionResult = buildTerrainMesh(productionSurface, null, null, null);
assert.ok(productionResult.water?.inland?.mesh.channelCoverageMap, "production river mesh carries channel coverage texture");
const productionCoverageMap = productionResult.water.inland.mesh.channelCoverageMap;
const productionCoveragePixels = productionCoverageMap.image.data;
assert.equal(productionResult.water.inland.mesh.usesFlowRibbon, true, "production water uses receiver-derived ribbon geometry");
assert.equal(productionCoverageMap.image.width, 1, "ribbon geometry no longer depends on fixed cell-coverage expansion");
assert.equal(productionCoverageMap.image.height, 1, "ribbon geometry uses uniform full material coverage");
assert.equal(productionCoveragePixels[0], 255, "ribbon material does not expose the retired dark bed fill");
const productionCutoutTelemetry = productionResult.telemetry.cutout;
assert.ok(productionCutoutTelemetry, "reported share code records cutout performance telemetry");
assert.ok(
  productionCutoutTelemetry.timingsMs.total < 30_000,
  `supported full-resolution cutout must avoid quadratic startup work (${productionCutoutTelemetry.timingsMs.total.toFixed(2)}ms)`
);
console.log(
  `[terrain-water-perf] cutout=${productionCutoutTelemetry.timingsMs.total.toFixed(2)}ms ` +
    `clip=${productionCutoutTelemetry.timingsMs.clipping.toFixed(2)}ms ` +
    `conform=${productionCutoutTelemetry.timingsMs.conformance.toFixed(2)}ms ` +
    `source=${productionCutoutTelemetry.counts.sourceTriangles} output=${productionCutoutTelemetry.counts.outputTriangles}`
);
const productionInland = productionResult.water?.inland?.surface;
const productionSeam = productionInland?.terrainSeam;
// MAP7 no longer promises that a historical terrain seed contains authored inland water.
// The deterministic synthetic fixtures above remain the authoritative cutout coverage.
if (productionInland && productionSeam) {
assert.equal(productionSurface.step, 1, "reported share code uses full-resolution terrain rendering");
assert.equal(productionSeam.diagnostics.originalBoundaryDisplacementMax, 0, "reported contour vertices never move in XZ");
assert.equal(productionSeam.diagnostics.maximumPreConformanceError, 0, "reported pre-conformance displacement is truthful and zero");
assert.equal(productionSeam.diagnostics.unmatchedWaterVertexCount, 0, "reported share code has no unmatched seam vertices");
assert.equal(productionSeam.diagnostics.tJunctionCount, 0, "reported share code has no T-junctions");
assert.equal(productionSeam.diagnostics.unexpectedOpenEndCount, 0, "reported share code has no unexpected open ends");
assert.equal(productionSeam.diagnostics.degenerateBoundaryTriangleCount, 0, "reported share code has no degenerate boundary triangles");
assert.equal(productionInland.diagnostics.segmentXzErrorMax, 0, "reported terrain and water share exact split segmentation");
assert.equal(productionInland.diagnostics.skirtJointGapMax, 0, "reported share code has no skirt joint gaps");
assert.equal(productionInland.diagnostics.waterAboveSeamMax, 0, "reported water remains below the terrain closure");
assert.ok(
  productionSeam.vertices.every((vertex) => vertex.skirtBottomWorldY < vertex.waterWorldY),
  "reported skirt bottoms remain below water"
);
for (const [name, x, y] of [["reported lake", 136, 137], ["former global mismatch", 130, 119]]) {
  const probe = findNearestInlandWaterTerrainSeamSegment(productionSeam, x + 0.5, y + 0.5);
  assert.ok(probe, `${name} resolves a seam segment`);
  const a = productionSeam.vertices[probe.segment.a];
  const b = productionSeam.vertices[probe.segment.b];
  assert.equal(Math.max(a.forcedDisplacementCells, b.forcedDisplacementCells), 0, `${name} has no forced XZ displacement`);
  assert.ok(a.sourceTerrainTriangleIds.length + b.sourceTerrainTriangleIds.length > 0, `${name} records terrain-intersection provenance`);
}
const productionDomain = buildRiverRenderDomain({
  cols: productionGrid.cols,
  rows: productionGrid.rows,
  elevations: productionSample.elevations,
  tileTypes: productionSample.tileTypes,
  riverMask: productionSample.riverMask,
  oceanMask: productionSample.oceanMask,
  lakeMask: productionSample.lakeMask,
  riverSurface: productionSample.riverSurface,
  riverChannelClass: productionSample.riverChannelClass,
  riverChannelWidth: productionSample.riverChannelWidth,
  riverChannelDownstream: productionSample.riverChannelDownstream,
  inlandWater: productionInland
}, TILE_TYPE_IDS.water);
assert.ok(productionDomain, "reported share code contour rebuilds for immutability verification");
productionDomain.terrainSeam = productionSeam;
const productionConforming = buildCutoutConformingRiverContourMesh(productionDomain);
for (let index = 0; index < productionDomain.contourVertices.length; index += 1) {
  assert.equal(
    productionConforming.vertices[index],
    productionDomain.contourVertices[index],
    `reported original contour coordinate ${index} is immutable`
  );
}
assert.equal(INLAND_WATER_CALM_BANK_STATIC_FOAM, 0, "calm banks have no continuous static white foam rim");
assert.ok(
  productionResult.water?.inland?.mesh.rapid.some((value) => value > 0),
  "rapid foam inputs remain present"
);
const productionSkirt = buildInlandWaterTerrainSkirtMesh(
  productionSeam,
  productionInland.edgeToWorldX,
  productionInland.edgeToWorldZ
);
assert.equal(
  productionSkirt.indices.length,
  productionSeam.segments.filter((segment) => !segment.openToOcean).length * 24,
  "reported river-mouth openings receive neither skirt nor guard geometry"
);
assert.ok(
  productionSeam.diagnostics.guardOverlapMin >= 0,
  "reported share code keeps ribbon seam guard overlap finite and non-negative"
);
const productionTerrainGeometry = productionResult.mesh.geometry;
const productionOwner = productionTerrainGeometry.getAttribute("inlandWaterOwner");
const productionPosition = productionTerrainGeometry.getAttribute("position");
const productionNormal = productionTerrainGeometry.getAttribute("normal");
const productionUv = productionTerrainGeometry.getAttribute("uv");
assert.ok(productionOwner, "production terrain carries seam ownership");
assert.equal(MOUNTAIN_ROCK_VERTEX_RELIEF_SCALE, 0, "T-junction terrain receives no geometric rock morphing");
const seamWorldKeys = new Set(productionSeam.vertices.map((vertex) =>
  `${Math.round(productionInland.edgeToWorldX(vertex.edgeX) * 10000)},${Math.round(productionInland.edgeToWorldZ(vertex.edgeY) * 10000)}`
));
let matchedTerrainSeamVertices = 0;
const sharedTerrainNormals = new Map();
for (let index = 0; index < productionPosition.count; index += 1) {
  const owner = productionOwner.getX(index);
  if (owner > 0.5) continue;
  const seamKey = `${Math.round(productionPosition.getX(index) * 10000)},${Math.round(productionPosition.getZ(index) * 10000)}`;
  if (seamWorldKeys.has(seamKey)) {
    matchedTerrainSeamVertices += 1;
  }
  const positionKey = `${seamKey},${Math.round(productionPosition.getY(index) * 10000)}`;
  const vertexInputs = {
    normal: [productionNormal.getX(index), productionNormal.getY(index), productionNormal.getZ(index)],
    uv: [productionUv.getX(index), productionUv.getY(index)]
  };
  const priorInputs = sharedTerrainNormals.get(positionKey);
  if (priorInputs) {
    close(vertexInputs.normal[0], priorInputs.normal[0], 1e-6, "duplicated terrain vertices share normal x");
    close(vertexInputs.normal[1], priorInputs.normal[1], 1e-6, "duplicated terrain vertices share normal y");
    close(vertexInputs.normal[2], priorInputs.normal[2], 1e-6, "duplicated terrain vertices share normal z");
    close(vertexInputs.uv[0], priorInputs.uv[0], 1e-6, "duplicated terrain vertices share shader UV x");
    close(vertexInputs.uv[1], priorInputs.uv[1], 1e-6, "duplicated terrain vertices share shader UV y");
  } else {
    sharedTerrainNormals.set(positionKey, vertexInputs);
  }
}
assert.ok(matchedTerrainSeamVertices > 0, "production terrain exposes canonical seam vertices for relief isolation");

const terrainEdgeUse = new Map();
const positionKeyAt = (index) => `${Math.round(productionPosition.getX(index) * 10000)},${Math.round(productionPosition.getY(index) * 10000)},${Math.round(productionPosition.getZ(index) * 10000)}`;
for (let triangle = 0; triangle + 2 < productionPosition.count; triangle += 3) {
  if (productionOwner.getX(triangle) > 0.5) continue;
  for (const [a, b] of [[triangle, triangle + 1], [triangle + 1, triangle + 2], [triangle + 2, triangle]]) {
    const aKey = positionKeyAt(a);
    const bKey = positionKeyAt(b);
    const key = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
    const edge = terrainEdgeUse.get(key) ?? { count: 0, a, b };
    edge.count += 1;
    terrainEdgeUse.set(key, edge);
  }
}
let minTerrainX = Number.POSITIVE_INFINITY;
let maxTerrainX = Number.NEGATIVE_INFINITY;
let minTerrainZ = Number.POSITIVE_INFINITY;
let maxTerrainZ = Number.NEGATIVE_INFINITY;
for (let index = 0; index < productionPosition.count; index += 1) {
  minTerrainX = Math.min(minTerrainX, productionPosition.getX(index));
  maxTerrainX = Math.max(maxTerrainX, productionPosition.getX(index));
  minTerrainZ = Math.min(minTerrainZ, productionPosition.getZ(index));
  maxTerrainZ = Math.max(maxTerrainZ, productionPosition.getZ(index));
}
const unexpectedInteriorEdges = [];
for (const edge of terrainEdgeUse.values()) {
  if (edge.count !== 1) continue;
  const ax = productionPosition.getX(edge.a);
  const az = productionPosition.getZ(edge.a);
  const bx = productionPosition.getX(edge.b);
  const ay = productionPosition.getY(edge.a);
  const by = productionPosition.getY(edge.b);
  const bz = productionPosition.getZ(edge.b);
  if (Math.hypot(bx - ax, by - ay, bz - az) < 1e-4) continue;
  const onMapBoundary = [ax, bx].every((x) => Math.abs(x - minTerrainX) < 1e-4 || Math.abs(x - maxTerrainX) < 1e-4)
    || [az, bz].every((z) => Math.abs(z - minTerrainZ) < 1e-4 || Math.abs(z - maxTerrainZ) < 1e-4);
  const seamProbe = findNearestInlandWaterTerrainSeamSegment(
    productionSeam,
    productionInland.worldToEdgeX((ax + bx) * 0.5),
    productionInland.worldToEdgeY((az + bz) * 0.5)
  );
  if (!onMapBoundary && (!seamProbe || seamProbe.distance > 1e-3)) {
    unexpectedInteriorEdges.push({ ax, ay, az, bx, by, bz });
  }
}
const pointLineDistance = (point, edge) => {
  const dx = edge.bx - edge.ax;
  const dy = edge.by - edge.ay;
  const dz = edge.bz - edge.az;
  const lengthSq = dx * dx + dy * dy + dz * dz;
  const t = lengthSq > 1e-12
    ? ((point.x - edge.ax) * dx + (point.y - edge.ay) * dy + (point.z - edge.az) * dz) / lengthSq
    : 0;
  return {
    t,
    distance: Math.hypot(point.x - (edge.ax + dx * t), point.y - (edge.ay + dy * t), point.z - (edge.az + dz * t))
  };
};
let uncoveredInteriorEdgeCount = 0;
const uncoveredInteriorEdges = [];
for (let edgeIndex = 0; edgeIndex < unexpectedInteriorEdges.length; edgeIndex += 1) {
  const edge = unexpectedInteriorEdges[edgeIndex];
  const intervals = [];
  for (let candidateIndex = 0; candidateIndex < unexpectedInteriorEdges.length; candidateIndex += 1) {
    if (candidateIndex === edgeIndex) continue;
    const candidate = unexpectedInteriorEdges[candidateIndex];
    const a = pointLineDistance({ x: candidate.ax, y: candidate.ay, z: candidate.az }, edge);
    const b = pointLineDistance({ x: candidate.bx, y: candidate.by, z: candidate.bz }, edge);
    if (a.distance > 1e-3 || b.distance > 1e-3) continue;
    const start = Math.max(0, Math.min(a.t, b.t));
    const end = Math.min(1, Math.max(a.t, b.t));
    if (end > start + 1e-6) intervals.push([start, end]);
  }
  intervals.sort((left, right) => left[0] - right[0]);
  let coveredTo = 0;
  for (const [start, end] of intervals) {
    if (start > coveredTo + 1e-3) break;
    coveredTo = Math.max(coveredTo, end);
  }
  if (coveredTo < 1 - 1e-3) {
    uncoveredInteriorEdgeCount += 1;
    uncoveredInteriorEdges.push({ ...edge, coveredTo });
  }
}
assert.ok(unexpectedInteriorEdges.length > 0, "production fixture exercises retained-terrain T-junction segmentation");
const rejectedTerrainFoldCount = productionTerrainGeometry.userData.inlandWaterRejectedTerrainFoldCount ?? 0;
const rejectedTerrainFoldAreaMax = productionTerrainGeometry.userData.inlandWaterRejectedTerrainFoldAreaMax ?? Number.POSITIVE_INFINITY;
assert.ok(
  Number.isInteger(rejectedTerrainFoldCount) && rejectedTerrainFoldCount >= 0,
  "production fixture reports a valid rejected terrain-fold count"
);
assert.ok(
  uncoveredInteriorEdgeCount <= rejectedTerrainFoldCount * 3,
  `every residual one-sided edge belongs to a rejected terrain fold: `
  + `${uncoveredInteriorEdgeCount}/${rejectedTerrainFoldCount * 3} `
  + `${JSON.stringify(uncoveredInteriorEdges.slice(0, 12))}`
);
assert.ok(
  rejectedTerrainFoldAreaMax <= 5e-9,
  "any rejected terrain folds enclose no raster-scale XZ area"
);
cases += 1;
}
productionResult.mesh.geometry.dispose();

const overlapWater = new Float32Array(4);
const overlapOcean = new Float32Array(4);
const overlapSupport = new Uint8Array(4);
const overlapSurfAttenuation = new Float32Array(4).fill(0.8);
applyRiverMouthOceanOverlap(
  Float32Array.from([0, 1, 0.0625, 0]),
  overlapWater,
  overlapOcean,
  overlapSupport,
  overlapSurfAttenuation
);
assert.deepEqual(Array.from(overlapSupport), [0, 1, 1, 0], "mouth overlap extends only render support");
close(overlapOcean[1], 1, 1e-9, "terminal mouth renders at ocean level");
close(overlapOcean[2], 0.35, 1e-6, "sampled partial mouth coverage receives a visible support floor");
close(overlapSurfAttenuation[1], 0, 1e-9, "mouth overlap does not inherit a false beach attenuation");

console.log(`Terrain inland-water regression passed cases=${cases}`);
