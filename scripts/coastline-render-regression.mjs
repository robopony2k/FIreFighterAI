import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  COAST_CLASS_BEACH,
  COAST_CLASS_CLIFF,
  COAST_CLASS_NONE,
  COAST_CLASS_SHELF_WATER,
  TILE_TYPE_IDS
} from "../dist/core/state.js";
import {
  resolveCoastalSeabedColor,
  SUBMERGED_SHELF_DISTANCE_MAX
} from "../dist/systems/terrain/rendering/coastalSeabedColor.js";
import { buildShoreTransitionData } from "../dist/render/terrain/water/shoreTransition.js";
import {
  OCEAN_SHELF_ALPHA_FLOOR,
  OCEAN_SHELF_ALPHA_FLOOR_ROUGH
} from "../dist/render/water/ocean/oceanSurfaceShader.js";
import { buildTerrainSurfaceColorField } from "../dist/render/terrain/textures/terrainSurfaceColorField.js";
import { buildTileTexture, computeWaterLevel } from "../dist/render/threeTestTerrain.js";

const BASE_SIZE = 28;
const strides = [1, 2, 3, 4];

const authoritativeSeaLevel = 0.5081713795661926;
const waterLevelSample = {
  cols: 3,
  rows: 2,
  elevations: Float32Array.from([0.42, 0.484, 0.5075, 0.31, 0.46, 0.7]),
  tileTypes: Uint8Array.from([
    TILE_TYPE_IDS.water,
    TILE_TYPE_IDS.water,
    TILE_TYPE_IDS.water,
    TILE_TYPE_IDS.water,
    TILE_TYPE_IDS.water,
    TILE_TYPE_IDS.grass
  ]),
  oceanMask: Uint8Array.from([1, 1, 1, 0, 1, 0]),
  riverMask: Uint8Array.from([0, 0, 0, 1, 0, 0]),
  seaLevel: new Float32Array(6).fill(authoritativeSeaLevel)
};
const resolvedAuthoritativeLevel = computeWaterLevel(
  waterLevelSample,
  TILE_TYPE_IDS.water,
  waterLevelSample.oceanMask,
  waterLevelSample.riverMask
);
assert.ok(resolvedAuthoritativeLevel !== null, "authoritative ocean sample must resolve a water level");
assert.ok(
  Math.abs(resolvedAuthoritativeLevel - waterLevelSample.seaLevel[0]) <= Number.EPSILON,
  "ocean rendering must use Water's authoritative sea level instead of estimating it from seabed elevations"
);
const legacyEstimatedLevel = computeWaterLevel(
  { ...waterLevelSample, seaLevel: undefined },
  TILE_TYPE_IDS.water,
  waterLevelSample.oceanMask,
  waterLevelSample.riverMask
);
assert.ok(legacyEstimatedLevel !== null, "legacy samples without sea-level metadata must retain a render fallback");
assert.notEqual(
  legacyEstimatedLevel,
  resolvedAuthoritativeLevel,
  "the compatibility estimator must not override an available authoritative sea-level field"
);

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

  const coastDistanceAt = (worldX, worldY, water) => {
    let best = Number.POSITIVE_INFINITY;
    for (let y = 0; y < BASE_SIZE; y += 1) {
      for (let x = 0; x < BASE_SIZE; x += 1) {
        if (fixture.isWater(x, y) === water) continue;
        best = Math.min(best, Math.abs(worldX - x) + Math.abs(worldY - y));
      }
    }
    return Number.isFinite(best) ? best : 0;
  };

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const idx = y * cols + x;
      const worldX = Math.min(BASE_SIZE - 1, x * stride);
      const worldY = Math.min(BASE_SIZE - 1, y * stride);
      const water = fixture.isWater(worldX, worldY);
      const coastDistance = coastDistanceAt(worldX, worldY, water);
      oceanSupportMask[idx] = water ? 1 : 0;
      oceanRatio[idx] = water ? 1 : 0;
      heightRelativeToWater[idx] = water
        ? -0.035 - ((worldX + worldY) % 3) * 0.008
        : fixture.cliff ? 0.72 : 0.045 + ((worldX * 3 + worldY) % 4) * 0.01;
      coastClass[idx] = water
        ? coastDistance <= SUBMERGED_SHELF_DISTANCE_MAX ? COAST_CLASS_SHELF_WATER : COAST_CLASS_NONE
        : coastDistance <= 3 ? fixture.cliff ? COAST_CLASS_CLIFF : COAST_CLASS_BEACH : COAST_CLASS_NONE;
      shelfWeight[idx] = coastClass[idx] === COAST_CLASS_SHELF_WATER ? 0.85 : 0;
      beachWeight[idx] = coastClass[idx] === COAST_CLASS_BEACH ? 0.92 : 0;
      cliffWeight[idx] = coastClass[idx] === COAST_CLASS_CLIFF ? 1 : 0;
      if (coastClass[idx] === COAST_CLASS_BEACH) {
        assert.equal(water, false, `${fixture.name}:${stride} rendered beach metadata must remain land`);
        assert.ok(coastDistance <= 3, `${fixture.name}:${stride} dry beach must stay within three source tiles`);
      }
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

const beachColor = [0.72, 0.66, 0.47];
const rockyColor = [0.42, 0.42, 0.4];
const waterColor = [0.1, 0.28, 0.44];
const innerShelfColor = resolveCoastalSeabedColor({
  coastClass: COAST_CLASS_SHELF_WATER,
  coastDistance: 1,
  beachColor,
  rockyColor,
  waterColor
});
const outerShelfColor = resolveCoastalSeabedColor({
  coastClass: COAST_CLASS_SHELF_WATER,
  coastDistance: SUBMERGED_SHELF_DISTANCE_MAX,
  beachColor,
  rockyColor,
  waterColor
});
const deepSeabedColor = resolveCoastalSeabedColor({
  coastClass: COAST_CLASS_NONE,
  coastDistance: 0,
  beachColor,
  rockyColor,
  waterColor
});
assert.notDeepEqual(innerShelfColor, beachColor, "inner shelf must not reuse the dry-beach color");
assert.ok(outerShelfColor[0] < innerShelfColor[0], "shelf sand must darken away from land");
assert.ok(outerShelfColor[2] > outerShelfColor[0], "outer shelf must read cooler than dry sand");
assert.ok(
  deepSeabedColor[2] - deepSeabedColor[0] > outerShelfColor[2] - outerShelfColor[0],
  "deep seabed must continue toward the water palette"
);

const size = 8;
const total = size * size;
const waterRatio = new Float32Array(total);
const oceanRatio = new Float32Array(total);
const riverRatio = new Float32Array(total);
const sampleTypes = new Uint8Array(total);
const sampleCoastClass = new Uint8Array(total);
const sampleCoastDistance = new Uint16Array(total);
for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    const idx = y * size + x;
    const water = x >= 3 || y === 0;
    sampleTypes[idx] = water ? TILE_TYPE_IDS.water : TILE_TYPE_IDS.beach;
    waterRatio[idx] = water ? 1 : 0;
    oceanRatio[idx] = water ? 1 : 0;
    sampleCoastClass[idx] = water ? COAST_CLASS_SHELF_WATER : COAST_CLASS_BEACH;
    sampleCoastDistance[idx] = water ? Math.min(6, Math.max(1, x - 2)) : Math.max(1, 3 - x);
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
  "legacy",
  { sampleCoastClass, sampleCoastDistance }
);
const textureData = texture.image.data;
for (let i = 3; i < textureData.length; i += 4) {
  assert.equal(textureData[i], 255, `terrain texel ${Math.floor(i / 4)} must remain an opaque seabed`);
}
const legacyPixel = (x, y) => {
  const offset = ((size - 1 - y) * size + x) * 4;
  return [textureData[offset], textureData[offset + 1], textureData[offset + 2]];
};
const legacyDryBeach = legacyPixel(2, 4);
const legacyInnerShelf = legacyPixel(3, 4);
assert.ok(
  legacyInnerShelf[2] - legacyInnerShelf[0] > legacyDryBeach[2] - legacyDryBeach[0],
  "legacy terrain texture must distinguish submerged shelf from dry beach"
);

const refinedColors = buildTerrainSurfaceColorField({
  sample: { cols: size, rows: size, worldSeed: 10 },
  sampleCols: size,
  sampleRows: size,
  step: 1,
  grassId: TILE_TYPE_IDS.grass,
  scrubId: TILE_TYPE_IDS.scrub,
  floodplainId: TILE_TYPE_IDS.floodplain,
  beachId: TILE_TYPE_IDS.beach,
  forestId: TILE_TYPE_IDS.forest,
  waterId: TILE_TYPE_IDS.water,
  roadId: TILE_TYPE_IDS.road,
  heightScale: 10,
  sampleHeights: new Float32Array(total).fill(0.3),
  sampleTypes,
  sampleCoastClass,
  sampleCoastDistance,
  riverRatio,
  oceanRatio,
  sampledErosionWear: null,
  sampledRiverCoverage: null,
  sampledLakeCoverage: null,
  riverStepStrength: null,
  debugTypeColors: false,
  deps: {
    palette,
    forestToneBase: { r: 47, g: 93, b: 49 },
    forestTintById: [],
    waterAlphaMinRatio: 0.1,
    riverRatioMin: 0.2,
    stepRockyTintMax: 0.28
  }
});
const refinedPixel = (x, y) => {
  const offset = (y * size + x) * 3;
  return [refinedColors[offset], refinedColors[offset + 1], refinedColors[offset + 2]];
};
const refinedDryBeach = refinedPixel(2, 4);
const refinedInnerShelf = refinedPixel(3, 4);
assert.ok(
  refinedInnerShelf[2] - refinedInnerShelf[0] > refinedDryBeach[2] - refinedDryBeach[0],
  "refined terrain colors must distinguish submerged shelf from dry beach"
);
texture.dispose();

const shaderPath = fileURLToPath(new URL("../src/render/water/ocean/oceanSurfaceShader.ts", import.meta.url));
const shaderSource = await readFile(shaderPath, "utf8");
assert.equal(OCEAN_SHELF_ALPHA_FLOOR, 0.62, "calm authoritative shelf water must remain visibly covered");
assert.equal(OCEAN_SHELF_ALPHA_FLOOR_ROUGH, 0.7, "rough authoritative shelf water must gain coverage");
assert.match(shaderSource, /shorelineSdf = sdf > 0\.0 \? sdf - organicInset : sdf;/, "shader must preserve signed shoreline distance");
assert.match(shaderSource, /openOceanCoverage/, "shader must force complete open-ocean coverage");
assert.match(shaderSource, /authoritativeShelfCoverage/, "shader must keep authoritative shelf water visibly covered");
assert.match(shaderSource, /step\(0\.0, shorelineSdf\)/, "shelf alpha floor must be gated to positive seaward distance");
assert.match(shaderSource, /float shelfAlphaFloor = mix/, "shelf coverage must respond to ocean weather context");
assert.match(shaderSource, /readableShallowTint/, "authoritative shallows must receive a readable blue-green tint");
assert.match(shaderSource, /breakerGate/, "shore foam must retain an intermittent breaker gate");
assert.match(shaderSource, /float breakerLine =/, "seaward breakers must retain a directly visible foam contribution");
assert.match(shaderSource, /float landwardCoastMask = transitionLandSide;/, "swash must consume the already-filtered landward fade without suppressing it twice");
assert.match(shaderSource, /shoreRenderSdf = shorelineSdf \+ shorelineAdvance;/, "positive shoreline advance must move the rendered edge landward");
assert.doesNotMatch(shaderSource, /landwardCoastMask = transitionLandSide \* transitionOverlap/, "swash eligibility must not be squared in the ocean shader");
assert.match(shaderSource, /max\(seawardCoastMask \* 0\.72, landwardCoastMask \* 0\.52\)/, "surf must preserve separate seaward and beach-gated masks");
assert.match(shaderSource, /sampleSmoothShoreSdf/, "shader must filter the signed shoreline field without adding mesh density");
assert.doesNotMatch(shaderSource, /float shorelineSdf = max\(0\.0, vShorelineSdf\);/, "shader must not collapse land-side shoreline distance");

console.log(`Coastline render regression passed: fixtures=${fixtures.length} strides=${strides.join(",")} opaqueTexels=${total}`);
