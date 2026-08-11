import assert from "node:assert/strict";

import { DEFAULT_MAP_GEN_SETTINGS } from "../dist/mapgen/settings.js";
import { TILE_TYPE_IDS } from "../dist/core/state.js";
import {
  buildArchetypeUpliftPlan,
  sampleArchetypeUplift
} from "../dist/systems/terrain/sim/archetypeUpliftField.js";
import { runDrainageErosion } from "../dist/systems/terrain/sim/drainageErosion.js";
import { buildTerrainMorphologyFields } from "../dist/systems/terrain/sim/terrainMorphology.js";
import { buildMountainTerrainMaskField } from "../dist/render/terrain/textures/mountainTerrainVisuals.js";

const sum = (values) => values.reduce((total, value) => total + value, 0);
const max = (values) => values.reduce((result, value) => Math.max(result, value), Number.NEGATIVE_INFINITY);
const bytes = (values) => Buffer.from(values.buffer, values.byteOffset, values.byteLength);

const makeFixture = (cols, rows, archetype = "LONG_SPINE", seed = 9137) => {
  const settings = { ...DEFAULT_MAP_GEN_SETTINGS, terrainArchetype: archetype };
  const plan = buildArchetypeUpliftPlan(seed, settings);
  const elevations = new Float32Array(cols * rows);
  const uplift = new Float32Array(cols * rows);
  const oceanMask = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const idx = y * cols + x;
      const sample = sampleArchetypeUplift(plan, x / Math.max(1, cols - 1), y / Math.max(1, rows - 1));
      uplift[idx] = sample.uplift;
      elevations[idx] = 0.24 + sample.uplift * 0.22 - sample.basinPreference * 0.035 + x / cols * 0.006;
      if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) oceanMask[idx] = 1;
    }
  }
  return { settings, plan, uplift, elevations, oceanMask };
};

const runFixture = (fixture, cols, rows) => runDrainageErosion({
  cols,
  rows,
  elevations: fixture.elevations,
  oceanMask: fixture.oceanMask,
  seaLevel: 0.2,
  heightScale: 24,
  relief: fixture.settings.relief,
  ruggedness: fixture.settings.ruggedness,
  riverIntensity: fixture.settings.riverIntensity
});

const cols = 49;
const rows = 41;
const fixture = makeFixture(cols, rows);
const first = runFixture(fixture, cols, rows);
const repeat = runFixture(fixture, cols, rows);
for (const field of ["elevations", "receiver", "flowAccumulation", "incision", "deposition", "wear", "deposit"]) {
  assert.deepEqual(bytes(first[field]), bytes(repeat[field]), `${field} must replay byte-identically`);
}

for (let start = 0; start < first.receiver.length; start += 1) {
  const seen = new Set();
  let cursor = start;
  while (cursor >= 0) {
    assert.ok(!seen.has(cursor), `drainage receiver cycle at tile ${start}`);
    seen.add(cursor);
    cursor = first.receiver[cursor] ?? -1;
    assert.ok(seen.size <= first.receiver.length, "receiver traversal must terminate");
  }
}
assert.ok(first.flowAccumulation.some((value) => value > 0.5), "drainage must form accumulated flow paths");
assert.ok(max(first.incision) <= 0.0150001, "stream-power incision must respect the normalized cap");
assert.ok(max(first.deposition) <= 0.0080001, "transport deposition must respect its per-cell cap");
const sedimentError = Math.abs(sum(first.incision) - sum(first.deposition) - first.exportedSediment);
assert.ok(sedimentError <= 2e-5, `sediment accounting drifted by ${sedimentError}`);

const basinFixture = makeFixture(31, 31, "NONE", 2);
const basinIndex = 15 * 31 + 15;
basinFixture.elevations.fill(0.31);
for (let y = 11; y <= 19; y += 1) {
  for (let x = 11; x <= 19; x += 1) {
    const radius = Math.hypot(x - 15, y - 15);
    basinFixture.elevations[y * 31 + x] = 0.24 + Math.min(0.06, radius * 0.012);
  }
}
const basinBefore = basinFixture.elevations[basinIndex];
const basinResult = runFixture(basinFixture, 31, 31);
assert.equal(basinResult.incision[basinIndex], 0, "depression fills must not carve an uphill escape");
assert.ok(basinResult.elevations[basinIndex] >= basinBefore, "lake-prone basin floor must be preserved or receive sediment");

const streamFixture = makeFixture(41, 41, "NONE", 3);
for (let y = 0; y < 41; y += 1) {
  for (let x = 0; x < 41; x += 1) streamFixture.elevations[y * 41 + x] = 0.22 + x * 0.004;
}
const streamResult = runFixture(streamFixture, 41, 41);
const downstream = 20 * 41 + 12;
const upstream = 20 * 41 + 30;
assert.ok(streamResult.flowAccumulation[downstream] > streamResult.flowAccumulation[upstream], "downstream flow must accumulate runoff");
assert.ok(streamResult.incision[downstream] >= streamResult.incision[upstream], "equal-slope stream power must not decrease with accumulation");

const cliffFixture = makeFixture(25, 25, "NONE", 4);
cliffFixture.elevations.fill(0.23);
for (let y = 8; y <= 16; y += 1) for (let x = 8; x <= 16; x += 1) cliffFixture.elevations[y * 25 + x] = 0.83;
const cliffResult = runFixture(cliffFixture, 25, 25);
let maxSlope = 0;
for (let y = 0; y < 25; y += 1) {
  for (let x = 0; x < 25; x += 1) {
    const idx = y * 25 + x;
    if (x + 1 < 25) maxSlope = Math.max(maxSlope, Math.atan(Math.abs(cliffResult.elevations[idx] - cliffResult.elevations[idx + 1]) * 24) * 180 / Math.PI);
    if (y + 1 < 25) maxSlope = Math.max(maxSlope, Math.atan(Math.abs(cliffResult.elevations[idx] - cliffResult.elevations[idx + 25]) * 24) * 180 / Math.PI);
  }
}
assert.ok(maxSlope <= 60.05, `talus safety cap exceeded: ${maxSlope.toFixed(2)} degrees`);
assert.ok(new Set(Array.from(cliffResult.deposit, (value) => value.toFixed(4))).size > 2, "talus must create nonuniform footslope deposition");

for (const seed of [11, 9137, 77821]) {
  for (const size of [33, 65]) {
    const none = makeFixture(size, size, "NONE", seed);
    assert.equal(max(none.uplift), 0, "None archetype must add no uplift");
    const spine = makeFixture(size, size, "LONG_SPINE", seed);
    const massif = makeFixture(size, size, "MASSIF", seed);
    const twin = makeFixture(size, size, "TWIN_BAY", seed);
    const shelf = makeFixture(size, size, "SHELF", seed);
    const center = Math.floor(size / 2) * size + Math.floor(size / 2);
    assert.ok(massif.uplift[center] > 0.55, "Massif must retain concentrated central uplift");
    assert.ok(max(shelf.uplift) < max(massif.uplift) * 0.7, "Shelf uplift must remain low and broad");
    const twinStrongCells = Array.from(twin.uplift).filter((value) => value > 0.62).length;
    assert.ok(twinStrongCells > 2, "Twin Bay must retain paired strong uplands");
    const spineResult = runFixture(spine, size, size);
    const massifResult = runFixture(massif, size, size);
    const twinResult = runFixture(twin, size, size);
    const shelfResult = runFixture(shelf, size, size);
    assert.ok(max(spineResult.elevations) - 0.2 > 0.12, "Long Spine identity must survive erosion as broad high ground");
    assert.ok(massifResult.elevations[center] > 0.3, "Massif concentration must survive erosion");
    assert.ok(max(twinResult.elevations) > 0.34, "Twin Bay paired uplands must survive erosion");
    assert.ok(max(shelfResult.elevations) < max(massifResult.elevations), "Shelf must remain lower than Massif after erosion");
  }
}

const morphologyHeights = new Float32Array([
  0.2, 0.2, 0.2, 0.2, 0.2,
  0.2, 0.21, 0.23, 0.27, 0.33,
  0.2, 0.21, 0.23, 0.27, 0.33
]);
const morphology = buildTerrainMorphologyFields({ cols: 5, rows: 3, elevations: morphologyHeights, heightScale: 24 });
assert.ok(morphology.rockExposure[9] > morphology.rockExposure[7], "rock exposure must rise continuously with rendered steepness and relief");
const deposited = new Float32Array(15);
deposited[9] = 1;
const depositedMorphology = buildTerrainMorphologyFields({ cols: 5, rows: 3, elevations: morphologyHeights, heightScale: 24, erosionDeposit: deposited });
assert.ok(depositedMorphology.rockExposure[9] < morphology.rockExposure[9], "deposition must continuously suppress rock exposure");
const worn = new Float32Array(15);
worn[7] = 1;
const wornMorphology = buildTerrainMorphologyFields({ cols: 5, rows: 3, elevations: morphologyHeights, heightScale: 24, erosionWear: worn });
assert.ok(wornMorphology.rockExposure[7] > morphology.rockExposure[7], "incision wear must continuously increase rock exposure");
const translatedHeights = Float32Array.from(morphologyHeights, (value) => value + 0.25);
const translatedMorphology = buildTerrainMorphologyFields({ cols: 5, rows: 3, elevations: translatedHeights, heightScale: 24 });
for (let idx = 0; idx < morphology.rockExposure.length; idx += 1) {
  assert.ok(Math.abs(translatedMorphology.rockExposure[idx] - morphology.rockExposure[idx]) < 1e-6, "absolute mountain height must not create a rock-exposure discontinuity");
}
const visualTypes = new Uint8Array(15).fill(TILE_TYPE_IDS.grass);
const buildVisual = (types) => buildMountainTerrainMaskField({
  sample: { cols: 5, rows: 3, rockExposure: morphology.rockExposure },
  sampleCols: 5,
  sampleRows: 3,
  step: 1,
  heightScale: 24,
  sampleHeights: morphologyHeights,
  sampleTypes: types,
  riverRatio: null,
  oceanRatio: null,
  sampledRiverCoverage: null,
  sampledLakeCoverage: null
});
const grassVisual = buildVisual(visualTypes);
visualTypes[7] = TILE_TYPE_IDS.rocky;
const rockyVisual = buildVisual(visualTypes);
assert.equal(grassVisual.data[7 * 4], rockyVisual.data[7 * 4], "rock material strength must not jump at the final rocky tile boundary");

console.log("Terrain morphology regression passed.", {
  maxIncision: max(first.incision).toFixed(5),
  maxDeposition: max(first.deposition).toFixed(5),
  exportedSediment: first.exportedSediment.toFixed(5),
  maxSlope: maxSlope.toFixed(2)
});
