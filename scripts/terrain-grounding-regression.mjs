import assert from "node:assert/strict";

import { prepareTerrainRenderSurface } from "../dist/render/threeTestTerrain.js";

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

console.log(
  `Terrain grounding regression passed roundTrip=${maxRoundTripError.toExponential(2)} height=${maxHeightError.toExponential(2)} legacyError=${maxLegacyHeightError.toFixed(3)}`
);
