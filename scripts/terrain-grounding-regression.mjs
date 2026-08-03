import assert from "node:assert/strict";

import { buildTerrainMesh, prepareTerrainRenderSurface } from "../dist/render/threeTestTerrain.js";
import { resolveTreeGrounding } from "../dist/systems/terrain/rendering/vegetation/treeGrounding.js";

const cols = 16;
const rows = 14;
const elevations = new Array(cols * rows);
for (let y = 0; y < rows; y += 1) {
  for (let x = 0; x < cols; x += 1) {
    elevations[y * cols + x] = 0.08 + x * 0.035 + y * 0.052;
  }
}

const surface = prepareTerrainRenderSurface({
  cols,
  rows,
  elevations,
  heightScaleMultiplier: 1
});

const assertClose = (actual, expected, tolerance, message) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: actual=${actual.toFixed(8)} expected=${expected.toFixed(8)} tolerance=${tolerance}`
  );
};

const sampleCoords = [
  [0, 0],
  [0.5, 0.5],
  [3.25, 2.75],
  [7.5, 6.5],
  [cols - 1.5, rows - 1.25],
  [cols - 1, rows - 1]
];

let maxRoundTripError = 0;
let maxHeightError = 0;
let maxLegacyHeightError = 0;

for (const [tileX, tileY] of sampleCoords) {
  const worldX = surface.toRenderedWorldX(tileX);
  const worldZ = surface.toRenderedWorldZ(tileY);
  const roundTripX = surface.renderedWorldToTileX(worldX);
  const roundTripY = surface.renderedWorldToTileY(worldZ);
  const roundTripError = Math.max(Math.abs(roundTripX - tileX), Math.abs(roundTripY - tileY));
  maxRoundTripError = Math.max(maxRoundTripError, roundTripError);
  assertClose(roundTripX, tileX, 1e-9, `round-trip x for ${tileX},${tileY}`);
  assertClose(roundTripY, tileY, 1e-9, `round-trip y for ${tileX},${tileY}`);

  const tileHeight = surface.heightAtTileCoord(tileX, tileY) * surface.heightScale;
  const worldHeight = surface.heightAtRenderedWorldPosition(worldX, worldZ);
  const heightError = Math.abs(worldHeight - tileHeight);
  maxHeightError = Math.max(maxHeightError, heightError);
  assertClose(worldHeight, tileHeight, 1e-9, `rendered-world height for ${tileX},${tileY}`);

  const legacyWorldX = surface.toWorldX(tileX);
  const legacyWorldZ = surface.toWorldZ(tileY);
  const legacyWorldHeight = surface.heightAtRenderedWorldPosition(legacyWorldX, legacyWorldZ);
  maxLegacyHeightError = Math.max(maxLegacyHeightError, Math.abs(legacyWorldHeight - tileHeight));
}

assert.ok(
  maxLegacyHeightError > 0.05,
  `steep synthetic slope should expose a visible legacy transform height error; max=${maxLegacyHeightError.toFixed(4)}`
);

const treePlacements = [
  { tileX: 3.5, tileY: 4.5, jitterX: -0.34, jitterY: 0.29 },
  { tileX: 7.5, tileY: 6.5, jitterX: 0.38, jitterY: -0.31 },
  { tileX: cols - 1.2, tileY: rows - 1.1, jitterX: 0.48, jitterY: 0.42 }
];

let maxTreeLegacyHeightError = 0;
let maxTreeCoarseHeightError = 0;
for (const placement of treePlacements) {
  const requestedTileX = placement.tileX + placement.jitterX;
  const requestedTileY = placement.tileY + placement.jitterY;
  const expectedTileX = Math.max(0, Math.min(cols - 1, requestedTileX));
  const expectedTileY = Math.max(0, Math.min(rows - 1, requestedTileY));
  const grounded = resolveTreeGrounding(surface, requestedTileX, requestedTileY);

  assertClose(grounded.tileX, expectedTileX, 1e-9, "tree grounding tile x");
  assertClose(grounded.tileY, expectedTileY, 1e-9, "tree grounding tile y");
  assertClose(grounded.x, surface.toRenderedWorldX(expectedTileX), 1e-9, "tree grounding world x");
  assertClose(grounded.z, surface.toRenderedWorldZ(expectedTileY), 1e-9, "tree grounding world z");
  assertClose(
    grounded.y,
    surface.heightAtTileCoord(expectedTileX, expectedTileY) * surface.heightScale,
    1e-9,
    "tree grounding world y"
  );
  assertClose(
    surface.renderedWorldToTileX(grounded.x),
    expectedTileX,
    1e-9,
    "grounded tree x round trip"
  );
  assertClose(
    surface.renderedWorldToTileY(grounded.z),
    expectedTileY,
    1e-9,
    "grounded tree y round trip"
  );

  const legacyWorldX = surface.toWorldX(expectedTileX);
  const legacyWorldZ = surface.toWorldZ(expectedTileY);
  const legacyHeight = surface.heightAtRenderedWorldPosition(legacyWorldX, legacyWorldZ);
  maxTreeLegacyHeightError = Math.max(maxTreeLegacyHeightError, Math.abs(grounded.y - legacyHeight));

  const coarseTileX = Math.floor(placement.tileX);
  const coarseTileY = Math.floor(placement.tileY);
  const coarseHeight = surface.heightAtTileCoord(coarseTileX, coarseTileY) * surface.heightScale;
  maxTreeCoarseHeightError = Math.max(maxTreeCoarseHeightError, Math.abs(grounded.y - coarseHeight));
}

assert.ok(
  maxTreeLegacyHeightError > 0.05,
  `tree grounding should reject the legacy world transform; max=${maxTreeLegacyHeightError.toFixed(4)}`
);
assert.ok(
  maxTreeCoarseHeightError > 0.05,
  `tree grounding should sample after center/jitter offsets; max=${maxTreeCoarseHeightError.toFixed(4)}`
);

const tileCount = cols * rows;
const vegetationSurface = prepareTerrainRenderSurface({
  cols,
  rows,
  elevations: Float32Array.from(elevations),
  fullResolution: true,
  debugTypeColors: true,
  tileTypes: new Uint8Array(tileCount).fill(2),
  treeTypes: new Uint8Array(tileCount),
  tileVegetationAge: new Float32Array(tileCount).fill(5),
  tileCanopyCover: new Float32Array(tileCount).fill(1),
  tileStemDensity: new Uint8Array(tileCount).fill(12),
  worldSeed: 19
});
const vegetationMesh = buildTerrainMesh(vegetationSurface, null, null, null).mesh;
let groundedModelCount = 0;
let maxModelGroundingError = 0;
vegetationMesh.traverse((child) => {
  if (!child.isInstancedMesh || !child.name.startsWith("terrain-tree-fallback-trunk-")) {
    return;
  }
  const matrices = child.instanceMatrix.array;
  for (let instanceIndex = 0; instanceIndex < child.count; instanceIndex += 1) {
    const matrixOffset = instanceIndex * 16;
    const worldX = matrices[matrixOffset + 12];
    const trunkCenterY = matrices[matrixOffset + 13];
    const worldZ = matrices[matrixOffset + 14];
    const trunkHeight = Math.hypot(
      matrices[matrixOffset + 4],
      matrices[matrixOffset + 5],
      matrices[matrixOffset + 6]
    );
    const instanceBaseY = trunkCenterY - trunkHeight * 0.5;
    const expectedGroundY = vegetationSurface.heightAtRenderedWorldPosition(worldX, worldZ);
    maxModelGroundingError = Math.max(maxModelGroundingError, Math.abs(instanceBaseY - expectedGroundY));
    groundedModelCount += 1;
  }
});
assert.ok(groundedModelCount > 0, "production terrain batching should emit grounded fallback tree models");
assert.ok(
  maxModelGroundingError <= 1e-5,
  `batched tree model bases should match terrain at their rendered X/Z; max=${maxModelGroundingError.toExponential(2)}`
);

console.log(
  `Terrain grounding regression passed roundTrip=${maxRoundTripError.toExponential(2)} height=${maxHeightError.toExponential(2)} legacyError=${maxLegacyHeightError.toFixed(3)} treeLegacyError=${maxTreeLegacyHeightError.toFixed(3)} treeCoarseError=${maxTreeCoarseHeightError.toFixed(3)} modelGroundError=${maxModelGroundingError.toExponential(2)} models=${groundedModelCount}`
);
