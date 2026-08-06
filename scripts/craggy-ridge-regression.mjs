import assert from "node:assert/strict";

import { RNG } from "../dist/core/rng.js";
import { createInitialState, TILE_TYPE_IDS } from "../dist/core/state.js";
import { generateMap } from "../dist/mapgen/index.js";
import { DEFAULT_MAP_GEN_SETTINGS } from "../dist/mapgen/settings.js";
import { buildSampleHeightMap } from "../dist/render/threeTestTerrain.js";
import {
  buildMountainTerrainMaskField,
  sampleMountainTerrainMaskAtTile
} from "../dist/render/terrain/textures/mountainTerrainVisuals.js";
import { applyCraggyRidgeRelief } from "../dist/systems/terrain/sim/craggyRidgeRelief.js";

const COLS = 128;
const ROWS = 128;
const TOTAL = COLS * ROWS;
const SEED = 1337;

const buildFixture = () => {
  const elevations = new Float32Array(TOTAL);
  const ridgeMask = new Float32Array(TOTAL);
  const interiorMask = new Float32Array(TOTAL);
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const idx = y * COLS + x;
      const across = y - 64 - Math.sin(x / 18) * 3;
      const along = Math.abs(x - 64);
      elevations[idx] = 0.4 + 0.28 * Math.exp(-(across * across) / 320) * Math.exp(-(along * along) / 5200);
      ridgeMask[idx] = Math.exp(-(across * across) / 30) * Math.exp(-(along * along) / 6000);
      interiorMask[idx] = Math.max(0, 1 - Math.hypot(x - 64, y - 64) / 80);
    }
  }
  return { elevations, ridgeMask, interiorMask };
};

const runFixture = (archetype, seed = SEED) => {
  const fixture = buildFixture();
  const beforeElevations = Float32Array.from(fixture.elevations);
  const beforeRidgeMask = Float32Array.from(fixture.ridgeMask);
  const result = applyCraggyRidgeRelief({
    seed,
    cols: COLS,
    rows: ROWS,
    settings: {
      terrainArchetype: archetype,
      relief: 0.9,
      ruggedness: 0.9,
      maxHeight: 0.8
    },
    ...fixture
  });
  return { ...fixture, beforeElevations, beforeRidgeMask, result };
};

const hashFloatArray = (values) => {
  let hash = 2166136261;
  for (let i = 0; i < values.length; i += 1) {
    const quantized = Math.floor((values[i] ?? 0) * 1_000_000);
    hash = Math.imul(hash ^ (quantized & 0xff), 16777619) >>> 0;
    hash = Math.imul(hash ^ ((quantized >>> 8) & 0xff), 16777619) >>> 0;
    hash = Math.imul(hash ^ ((quantized >>> 16) & 0xff), 16777619) >>> 0;
    hash = Math.imul(hash ^ ((quantized >>> 24) & 0xff), 16777619) >>> 0;
  }
  return hash >>> 0;
};

const summarizeFootprint = (upliftMap) => {
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let maxUplift = 0;
  for (let idx = 0; idx < upliftMap.length; idx += 1) {
    const uplift = upliftMap[idx] ?? 0;
    if (uplift <= 1e-5) continue;
    count += 1;
    sumX += idx % COLS;
    sumY += Math.floor(idx / COLS);
    maxUplift = Math.max(maxUplift, uplift);
  }
  const meanX = sumX / Math.max(1, count);
  const meanY = sumY / Math.max(1, count);
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (let idx = 0; idx < upliftMap.length; idx += 1) {
    if ((upliftMap[idx] ?? 0) <= 1e-5) continue;
    const dx = idx % COLS - meanX;
    const dy = Math.floor(idx / COLS) - meanY;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  const trace = xx + yy;
  const determinant = xx * yy - xy * xy;
  const discriminant = Math.sqrt(Math.max(0, trace * trace * 0.25 - determinant));
  const major = trace * 0.5 + discriminant;
  const minor = trace * 0.5 - discriminant;
  return {
    count,
    maxUplift,
    axisRatio: major / Math.max(1e-9, minor)
  };
};

const first = runFixture("MASSIF");
const repeat = runFixture("MASSIF");
const differentSeed = runFixture("MASSIF", SEED + 1);
const spine = runFixture("LONG_SPINE");
const shelf = runFixture("SHELF");
const neutral = runFixture("NONE");
const firstSummary = summarizeFootprint(first.result.upliftMap);
let maxCardinalUpliftDelta = 0;
for (let y = 0; y < ROWS; y += 1) {
  for (let x = 0; x < COLS; x += 1) {
    const idx = y * COLS + x;
    if (x < COLS - 1) {
      maxCardinalUpliftDelta = Math.max(
        maxCardinalUpliftDelta,
        Math.abs((first.result.upliftMap[idx] ?? 0) - (first.result.upliftMap[idx + 1] ?? 0))
      );
    }
    if (y < ROWS - 1) {
      maxCardinalUpliftDelta = Math.max(
        maxCardinalUpliftDelta,
        Math.abs((first.result.upliftMap[idx] ?? 0) - (first.result.upliftMap[idx + COLS] ?? 0))
      );
    }
  }
}

assert.ok(first.result.formationCount >= 1 && first.result.formationCount <= 3, "Massif should emit one to three formations");
assert.ok(spine.result.formationCount >= 1 && spine.result.formationCount <= 3, "Long Spine should emit one to three formations");
assert.equal(first.result.affectedTileCount, firstSummary.count, "affected count should match the authoritative uplift map");
assert.ok(firstSummary.count / TOTAL >= 0.005 && firstSummary.count / TOTAL <= 0.05, "crag coverage should stay occasional");
assert.ok(firstSummary.maxUplift >= 0.012 && firstSummary.maxUplift <= 0.04 + 1e-7, "uplift should remain within the authored envelope");
assert.ok(maxCardinalUpliftDelta <= 0.025, "crag shaping should not introduce one-cell elevation spikes");
assert.ok(firstSummary.axisRatio >= 2.5, `formations should remain ridge-aligned; axisRatio=${firstSummary.axisRatio.toFixed(3)}`);
assert.equal(hashFloatArray(first.elevations), hashFloatArray(repeat.elevations), "same seed should reproduce elevations exactly");
assert.equal(hashFloatArray(first.result.upliftMap), hashFloatArray(repeat.result.upliftMap), "same seed should reproduce the crag mask exactly");
assert.notEqual(hashFloatArray(first.result.upliftMap), hashFloatArray(differentSeed.result.upliftMap), "different seeds should vary formations");

for (const inactive of [shelf, neutral]) {
  assert.equal(inactive.result.formationCount, 0, "inactive archetypes should not emit formations");
  assert.equal(inactive.result.affectedTileCount, 0, "inactive archetypes should not affect terrain");
  assert.deepEqual(inactive.elevations, inactive.beforeElevations, "inactive archetypes should preserve elevation byte-for-byte");
  assert.deepEqual(inactive.ridgeMask, inactive.beforeRidgeMask, "inactive archetypes should preserve ridge stress byte-for-byte");
}

for (const step of [1, 2, 3, 4]) {
  const sampleCols = Math.floor((COLS - 1) / step) + 1;
  const sampleRows = Math.floor((ROWS - 1) / step) + 1;
  const cragHeights = buildSampleHeightMap(
    { cols: COLS, rows: ROWS, elevations: first.elevations },
    sampleCols,
    sampleRows,
    step,
    TILE_TYPE_IDS.water
  );
  const baselineHeights = buildSampleHeightMap(
    { cols: COLS, rows: ROWS, elevations: first.beforeElevations },
    sampleCols,
    sampleRows,
    step,
    TILE_TYPE_IDS.water
  );
  let maxSampledUplift = 0;
  for (let i = 0; i < cragHeights.length; i += 1) {
    maxSampledUplift = Math.max(maxSampledUplift, (cragHeights[i] ?? 0) - (baselineHeights[i] ?? 0));
  }
  assert.ok(
    maxSampledUplift >= 0.018,
    `strategic terrain stride ${step} should retain peak-to-saddle relief; max=${maxSampledUplift.toFixed(6)}`
  );
}

const strongestCragIndex = first.result.upliftMap.reduce(
  (bestIndex, uplift, index, values) => uplift > (values[bestIndex] ?? 0) ? index : bestIndex,
  0
);
const mountainField = buildMountainTerrainMaskField({
  sample: {
    cols: COLS,
    rows: ROWS,
    worldSeed: SEED
  },
  sampleCols: COLS,
  sampleRows: ROWS,
  step: 1,
  heightScale: 20,
  sampleHeights: first.elevations,
  sampleTypes: new Uint8Array(TOTAL).fill(TILE_TYPE_IDS.rocky),
  riverRatio: null,
  oceanRatio: null,
  sampledRiverCoverage: null,
  sampledLakeCoverage: null
});
const strongestCragMaterial = sampleMountainTerrainMaskAtTile(
  mountainField,
  strongestCragIndex % COLS,
  Math.floor(strongestCragIndex / COLS)
);
assert.ok(strongestCragMaterial.rockExposure > 0.05, "a confirmed crag tile should expose renderer-derived mountain-rock diagnostics");
for (const value of Object.values(strongestCragMaterial)) {
  assert.ok(value >= 0 && value <= 1, "mountain material diagnostic channels should remain normalized");
}

const generatedGrid = { cols: 64, rows: 64, totalTiles: 64 * 64 };
const generatedState = createInitialState(SEED, generatedGrid);
let elevationSnapshot = null;
await generateMap(
  generatedState,
  new RNG(SEED),
  undefined,
  { ...DEFAULT_MAP_GEN_SETTINGS, terrainArchetype: "MASSIF" },
  {
    stopAfterPhase: "terrain:elevation",
    onPhase: (snapshot) => {
      if (snapshot.phase === "terrain:elevation") elevationSnapshot = snapshot;
    }
  }
);
assert.ok(elevationSnapshot?.cragUplift, "elevation snapshots should retain crag provenance");
assert.deepEqual(generatedState.tileCragUplift, elevationSnapshot.cragUplift, "world and preview diagnostics should share crag provenance");
assert.ok(generatedState.tileCragUplift.some((uplift) => uplift > 1e-5), "generated Massif state should contain inspectable crag tiles");

console.log("Craggy ridge regression passed.", {
  formationCount: first.result.formationCount,
  affectedTileCount: firstSummary.count,
  coverage: Number((firstSummary.count / TOTAL).toFixed(4)),
  maxUplift: Number(firstSummary.maxUplift.toFixed(6)),
  axisRatio: Number(firstSummary.axisRatio.toFixed(3)),
  rockExposure: Number(strongestCragMaterial.rockExposure.toFixed(3))
});
