import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  COAST_CLASS_BEACH,
  COAST_CLASS_CLIFF,
  COAST_CLASS_SHELF_WATER,
  TILE_TYPE_IDS
} from "../dist/core/state.js";
import { buildShoreTransitionData } from "../dist/render/terrain/water/shoreTransition.js";
import { buildTileTexture } from "../dist/render/threeTestTerrain.js";

const BASE_SIZE = 28;
const strides = [1, 2, 3, 4];

const fixtures = [
  { name: "straight", isWater: (x) => x >= BASE_SIZE * 0.5 },
  { name: "diagonal", isWater: (x, y) => x + y >= BASE_SIZE - 1 },
  { name: "concave", isWater: (x, y) => x >= BASE_SIZE * 0.52 + Math.sin(y * 0.42) * 3.4 },
  {
    name: "headland",
    isWater: (x, y) => x >= BASE_SIZE * 0.56 - Math.max(0, 5 - Math.abs(y - BASE_SIZE * 0.5))
  },
  {
    name: "world-border",
    isWater: (x, y) => x < 4 || y < 4 || x >= BASE_SIZE - 4 || y >= BASE_SIZE - 4
  },
  { name: "cliff", cliff: true, isWater: (x, y) => x >= BASE_SIZE * 0.5 + Math.sin(y * 0.35) * 1.8 }
];

const buildFixture = (fixture, stride) => {
  const cols = Math.floor((BASE_SIZE - 1) / stride) + 1;
  const rows = cols;
  const total = cols * rows;
  const oceanSupportMask = new Uint8Array(total);
  const coastClass = new Uint8Array(total);
  const beachWeight = new Float32Array(total);
  const cliffWeight = new Float32Array(total);
  const shelfWeight = new Float32Array(total);
  const heightRelativeToWater = new Float32Array(total);
  const oceanRatio = new Float32Array(total);

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const idx = y * cols + x;
      const worldX = Math.min(BASE_SIZE - 1, x * stride);
      const worldY = Math.min(BASE_SIZE - 1, y * stride);
      const water = fixture.isWater(worldX, worldY);
      oceanSupportMask[idx] = water ? 1 : 0;
      oceanRatio[idx] = water ? 1 : 0;
      heightRelativeToWater[idx] = water
        ? -0.035 - ((worldX + worldY) % 3) * 0.008
        : fixture.cliff ? 0.72 : 0.045 + ((worldX * 3 + worldY) % 4) * 0.01;
      coastClass[idx] = water
        ? COAST_CLASS_SHELF_WATER
        : fixture.cliff ? COAST_CLASS_CLIFF : COAST_CLASS_BEACH;
      shelfWeight[idx] = water ? 0.85 : 0.25;
      beachWeight[idx] = fixture.cliff ? 0 : 0.92;
      cliffWeight[idx] = fixture.cliff ? 1 : 0;
    }
  }

  return {
    cols,
    rows,
    oceanSupportMask,
    coastClass,
    heightRelativeToWater,
    oceanRatio,
    transition: buildShoreTransitionData({
      sampleCols: cols,
      sampleRows: rows,
      oceanSupportMask,
      sampleCoastClass: coastClass,
      coastData: { beachWeight, cliffWeight, shelfWeight },
      shoreTerrainHeightRelativeToWater: heightRelativeToWater,
      oceanRatio
    })
  };
};

const assertContinuousBoundary = (fixture, stride) => {
  const built = buildFixture(fixture, stride);
  let boundaryPairs = 0;
  let landward = 0;
  let seaward = 0;
  for (let y = 0; y < built.rows; y += 1) {
    for (let x = 0; x < built.cols; x += 1) {
      const idx = y * built.cols + x;
      landward = Math.max(landward, built.transition.landwardFade[idx] ?? 0);
      seaward = Math.max(seaward, built.transition.seawardFade[idx] ?? 0);
      for (const [nx, ny] of [[x + 1, y], [x, y + 1]]) {
        if (nx >= built.cols || ny >= built.rows) continue;
        const nIdx = ny * built.cols + nx;
        if (built.oceanSupportMask[idx] === built.oceanSupportMask[nIdx]) continue;
        boundaryPairs += 1;
        const waterIdx = built.oceanSupportMask[idx] ? idx : nIdx;
        const landIdx = waterIdx === idx ? nIdx : idx;
        const waterDistance = built.transition.signedDistance[waterIdx];
        const landDistance = built.transition.signedDistance[landIdx];
        assert.ok(waterDistance > 0, `${fixture.name}:${stride} water distance must stay positive`);
        assert.ok(landDistance < 0, `${fixture.name}:${stride} land distance must stay negative`);
        const crossing = -landDistance / (waterDistance - landDistance);
        assert.ok(crossing > 0 && crossing < 1, `${fixture.name}:${stride} crossing must remain inside the cell edge`);
      }
    }
  }
  assert.ok(boundaryPairs > 0, `${fixture.name}:${stride} should contain a shoreline`);
  assert.ok(seaward > 0, `${fixture.name}:${stride} should expose seaward transition coverage`);
  if (fixture.cliff) {
    assert.equal(landward, 0, `${fixture.name}:${stride} cliffs must suppress landward swash`);
  } else {
    assert.ok(landward > 0, `${fixture.name}:${stride} beaches should permit landward swash`);
  }
};

for (const fixture of fixtures) {
  for (const stride of strides) {
    assertContinuousBoundary(fixture, stride);
  }
}

const size = 8;
const total = size * size;
const waterRatio = new Float32Array(total);
const oceanRatio = new Float32Array(total);
const riverRatio = new Float32Array(total);
const sampleTypes = new Uint8Array(total);
for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    const idx = y * size + x;
    const water = x >= 3 || y === 0;
    sampleTypes[idx] = water ? TILE_TYPE_IDS.water : TILE_TYPE_IDS.beach;
    waterRatio[idx] = water ? 1 : 0;
    oceanRatio[idx] = water ? 1 : 0;
  }
}
const maxTileId = Math.max(...Object.values(TILE_TYPE_IDS));
const palette = Array.from({ length: maxTileId + 1 }, () => [0.42, 0.48, 0.36]);
palette[TILE_TYPE_IDS.water] = [0.1, 0.28, 0.44];
palette[TILE_TYPE_IDS.beach] = [0.72, 0.66, 0.47];
const texture = buildTileTexture(
  { cols: size, rows: size },
  size,
  size,
  1,
  palette,
  TILE_TYPE_IDS.grass,
  TILE_TYPE_IDS.scrub,
  TILE_TYPE_IDS.floodplain,
  TILE_TYPE_IDS.beach,
  TILE_TYPE_IDS.forest,
  TILE_TYPE_IDS.water,
  TILE_TYPE_IDS.road,
  10,
  new Float32Array(total).fill(0.3),
  sampleTypes,
  waterRatio,
  oceanRatio,
  riverRatio,
  null,
  null,
  null,
  null,
  false,
  "legacy"
);
const textureData = texture.image.data;
for (let i = 3; i < textureData.length; i += 4) {
  assert.equal(textureData[i], 255, `terrain texel ${Math.floor(i / 4)} must remain an opaque seabed`);
}
texture.dispose();

const shaderPath = fileURLToPath(new URL("../src/render/water/ocean/oceanSurfaceShader.ts", import.meta.url));
const shaderSource = await readFile(shaderPath, "utf8");
assert.match(shaderSource, /shorelineSdf = sdf > 0\.0 \? sdf - organicInset : sdf;/, "shader must preserve signed shoreline distance");
assert.match(shaderSource, /openOceanCoverage/, "shader must force complete open-ocean coverage");
assert.match(shaderSource, /sampleSmoothShoreSdf/, "shader must filter the signed shoreline field without adding mesh density");
assert.doesNotMatch(shaderSource, /float shorelineSdf = max\(0\.0, vShorelineSdf\);/, "shader must not collapse land-side shoreline distance");

console.log(`Coastline render regression passed: fixtures=${fixtures.length} strides=${strides.join(",")} opaqueTexels=${total}`);
