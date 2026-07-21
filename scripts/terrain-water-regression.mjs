import assert from "node:assert/strict";

import { TILE_TYPE_IDS } from "../dist/core/state.js";
import {
  buildInlandWaterRenderSurface
} from "../dist/systems/terrain/rendering/inlandWaterRenderSurface.js";
import {
  buildInlandWaterfallMeshData,
  buildInlandWaterTerrainSkirtQuad,
  insetInlandWaterTerrainUv,
  splitInlandWaterSurfaceAtWaterfalls,
  weldInlandWaterTerrainSkirtEdges
} from "../dist/systems/terrain/rendering/inlandWaterMeshBuilder.js";
import {
  buildBoundaryEdgesFromIndexedContour,
  buildCutoutConformingRiverContourMesh,
  buildRiverRenderDomain
} from "../dist/render/terrain/water/riverRenderDomain.js";

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
  const sampleCols = Math.floor((cols - 1) / step) + 1;
  const sampleRows = Math.floor((rows - 1) / step) + 1;
  const terrainHeights = new Float32Array(sampleCols * sampleRows);
  for (let y = 0; y < sampleRows; y += 1) {
    for (let x = 0; x < sampleCols; x += 1) terrainHeights[y * sampleCols + x] = 0.3 + x * 0.003 + y * 0.004;
  }
  const width = (sampleCols - 1) * step;
  const depth = (sampleRows - 1) * step;
  const inland = buildInlandWaterRenderSurface({
    cols, rows, width, depth, heightScale,
    terrainSampleCols: sampleCols,
    terrainSampleRows: sampleRows,
    terrainHeights,
    riverMask, lakeMask, oceanMask, riverSurface, riverBed, riverStepStrength, lakeSurface,
    waterfallSourceMask: sourceMask,
    waterfallTarget: targetMap
  });
  return { inland, riverMask, lakeMask, oceanMask, riverSurface, tileTypes, width, depth };
};

let cases = 0;
const insetUv = insetInlandWaterTerrainUv([0.5, 0.5], [0.25, 0.75], 0.4);
close(insetUv[0], 0.4, 1e-9, "skirt UV insets toward retained terrain x");
close(insetUv[1], 0.6, 1e-9, "skirt UV insets toward retained terrain y");
const weldedSkirtEdges = weldInlandWaterTerrainSkirtEdges([
  { ax: 0, ay: 0, topA: 3, uA: 0.1, vA: 0.5, bx: 1, by: 0, topB: 2, uB: 0.4, vB: 0.5 },
  { ax: 1 + 1e-6, ay: 0, topA: 4, uA: 0.6, vA: 0.5, bx: 2, by: 0, topB: 5, uB: 0.9, vB: 0.5 }
]);
assert.equal(weldedSkirtEdges.length, 2, "connected skirt retains both perimeter segments");
const endpointNearestOne = (edge) => Math.abs(edge.ax - 1) <= Math.abs(edge.bx - 1)
  ? { top: edge.topA, u: edge.uA }
  : { top: edge.topB, u: edge.uB };
const weldedJointA = endpointNearestOne(weldedSkirtEdges[0]);
const weldedJointB = endpointNearestOne(weldedSkirtEdges[1]);
close(weldedJointA.top, weldedJointB.top, 1e-9, "connected skirt shares joint height");
close(weldedJointA.u, weldedJointB.u, 1e-9, "connected skirt shares retained-terrain UV");
const skirtQuad = buildInlandWaterTerrainSkirtQuad({
  worldAx: 0, worldAz: 0, worldBx: 2, worldBz: 0,
  topA: 3, topB: 4, bottomA: 1, bottomB: 1,
  uvA: [0.2, 0.7], uvB: [0.4, 0.7]
});
assert.equal(skirtQuad.positions.length, 36, "skirt emits opposing faces");
assert.equal(skirtQuad.uvs.length, 24, "double-sided retained-terrain UV count");
assert.deepEqual(skirtQuad.uvs.slice(0, 6), [0.2, 0.7, 0.4, 0.7, 0.4, 0.7], "skirt inherits retained terrain endpoint UVs");
const triangleNormalZ = (positions, offset) => {
  const ax = positions[offset + 3] - positions[offset];
  const ay = positions[offset + 4] - positions[offset + 1];
  const bx = positions[offset + 6] - positions[offset];
  const by = positions[offset + 7] - positions[offset + 1];
  return ax * by - ay * bx;
};
assert.ok(
  triangleNormalZ(skirtQuad.positions, 0) * triangleNormalZ(skirtQuad.positions, 18) < 0,
  "skirt contains opposing visible windings"
);
const syntheticContour = {
  cols: 2,
  rows: 2,
  baseSupport: new Uint8Array(4),
  renderSupport: new Uint8Array(4),
  vertexField: new Float32Array(9),
  contourVertices: new Float32Array([0, 0, 2, 0, 2, 2, 0, 2]),
  contourIndices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  boundaryEdges: new Float32Array([0, 0, 2, 0, 2, 0, 2, 2, 2, 2, 0, 2, 0, 2, 0, 0]),
  cutoutBoundaryEdges: new Float32Array([0, 0, 1, 0, 1, 0, 2, 0, 2, 0, 2, 2, 2, 2, 0, 2, 0, 2, 0, 0]),
  distanceToBank: new Int16Array(4)
};
const conforming = buildCutoutConformingRiverContourMesh(syntheticContour);
const conformingBoundary = buildBoundaryEdgesFromIndexedContour(conforming.vertices, conforming.indices);
const boundaryPointKeys = new Set();
for (let i = 0; i + 3 < conformingBoundary.length; i += 4) {
  boundaryPointKeys.add(`${conformingBoundary[i].toFixed(5)},${conformingBoundary[i + 1].toFixed(5)}`);
  boundaryPointKeys.add(`${conformingBoundary[i + 2].toFixed(5)},${conformingBoundary[i + 3].toFixed(5)}`);
}
assert.ok(boundaryPointKeys.has("1.00000,0.00000"), "water topology inserts terrain cutout endpoint");
assert.ok(conforming.indices.length > syntheticContour.contourIndices.length, "affected water triangle is retriangulated");
for (const fixture of fixtures) {
  for (const step of [1, 2, 3, 4]) {
    const built = buildFixture(fixture, step);
    if (fixture.name === "empty-water") {
      assert.equal(built.inland, undefined, `empty fixture step ${step}`);
      cases += 1;
      continue;
    }
    const inland = built.inland;
    assert.ok(inland, `${fixture.name} step ${step} should build inland water`);
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
        close(inland.surfaceWorldY[i], normalized * heightScale, 1e-4, `${fixture.name} world height`);
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
        flowDir: [1, 0, 1, 0, 1, 0], flowSpeed: [1, 1, 1], rapid: [0, 0, 0], lakeFactor: [0, 0, 0]
      }, [span], 0);
      assert.equal(split.indices.length, 0, `${fixture.name} no triangle crosses lip`);
    }
    cases += 1;
  }
}

console.log(`Terrain inland-water regression passed cases=${cases}`);
