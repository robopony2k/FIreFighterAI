import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createInitialState, TILE_TYPE_IDS } from "../dist/core/state.js";
import { TREE_TYPE_IDS } from "../dist/core/types.js";
import {
  applyFxLabTerrainStamp,
  createFxLabShowcaseMap,
  FX_LAB_SHOWCASE_SIZE,
  replaceFxLabEditableMap
} from "../dist/render/fxLab/showcaseMap.js";
import {
  createFxLabMapPreset,
  formatFxLabMapPreset,
  parseFxLabMapPreset
} from "../dist/render/fxLab/showcaseMapPreset.js";
import { resolveOceanSurfaceContext } from "../dist/render/water/ocean/oceanSurfaceContext.js";

const grid = { cols: FX_LAB_SHOWCASE_SIZE, rows: FX_LAB_SHOWCASE_SIZE, totalTiles: FX_LAB_SHOWCASE_SIZE ** 2 };
const createWorld = () => createInitialState(18032026, grid);
const world = createWorld();
const map = createFxLabShowcaseMap(world);

const hashArrays = (...arrays) => {
  let hash = 2166136261;
  for (const array of arrays) {
    for (const value of array) {
      const normalized = Number.isFinite(value) ? Math.round(value * 100000) : 0x7fffffff;
      hash ^= normalized;
      hash = Math.imul(hash, 16777619);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

assert.equal(hashArrays(world.tileElevation, world.tileTypeId, world.tileRiverMask, world.tileOceanMask, world.tileLakeMask), "fd7c6b71");
for (const id of Object.values(TILE_TYPE_IDS)) assert.ok(world.tileTypeId.includes(id), `canonical map missing tile type ${id}`);
assert.ok(map.protectedMask.some((value) => value > 0), "protected feature mask is empty");
assert.equal(world.tileOceanMask[2 * grid.cols + 36], 1, "stable deep-ocean landmark moved");
assert.equal(world.tileLakeMask[57 * grid.cols + 51], 1, "stable upland-lake landmark moved");
assert.equal(world.tileRoadBridge[44 * grid.cols + 47], 1, "stable bridge landmark moved");

let previousSurface = Number.POSITIVE_INFINITY;
for (let y = 53; y >= 15; y -= 1) {
  const surfaces = [];
  for (let x = 0; x < grid.cols; x += 1) {
    const idx = y * grid.cols + x;
    if (world.tileRiverMask[idx]) {
      assert.equal(world.tileOceanMask[idx], 0, `river overlaps ocean at ${x},${y}`);
      surfaces.push(world.tileRiverSurface[idx]);
    }
  }
  assert.ok(surfaces.length > 0, `river corridor missing at row ${y}`);
  const surface = Math.max(...surfaces);
  assert.ok(surface <= previousSurface + 1e-6, `river rises downstream at row ${y}`);
  previousSurface = surface;
}

for (const stamp of ["raise", "lower", "flatten", "grass", "scrub", "forest", "rocky", "bare", "ash", "clearing"]) {
  const stampWorld = createWorld();
  const stampMap = createFxLabShowcaseMap(stampWorld);
  const before = stampWorld.tileElevation[36 * grid.cols + 20];
  const result = applyFxLabTerrainStamp(stampWorld, stampMap, stamp, 20.5, 36.5, 2);
  assert.ok(result.changed > 0, `${stamp} changed no editable tiles`);
  if (stamp === "raise") assert.ok(stampWorld.tileElevation[36 * grid.cols + 20] > before);
  if (stamp === "lower") assert.ok(stampWorld.tileElevation[36 * grid.cols + 20] < before);
  if (stamp === "forest") {
    const idx = 36 * grid.cols + 20;
    assert.equal(stampWorld.tileTypeId[idx], TILE_TYPE_IDS.forest);
    assert.ok(stampWorld.tileFuel[idx] > 0.9 && stampWorld.tileCanopyCover[idx] > 0.8);
  }
}

const protectedIdx = 2 * grid.cols + 36;
const protectedElevation = world.tileElevation[protectedIdx];
const clipped = applyFxLabTerrainStamp(world, map, "raise", 36.5, 2.5, 4);
assert.ok(clipped.protected > 0);
assert.equal(world.tileElevation[protectedIdx], protectedElevation);

const preset = createFxLabMapPreset(world, map);
const canonicalWorld = createWorld();
const canonicalMap = createFxLabShowcaseMap(canonicalWorld);
const parsed = parseFxLabMapPreset(formatFxLabMapPreset(preset), createFxLabMapPreset(canonicalWorld, canonicalMap), map.protectedMask);
assert.deepEqual(parsed, preset);
replaceFxLabEditableMap(world, map, parsed.elevations, parsed.tileTypes, parsed.treeTypes);
for (const mutation of [
  { schemaVersion: 2 },
  { cols: 71 },
  { elevations: preset.elevations.slice(1) },
  { tileTypes: preset.tileTypes.map((value, index) => index === 1000 ? 255 : value) },
  { treeTypes: preset.treeTypes.map((value, index) => index === 1000 ? Math.max(...Object.values(TREE_TYPE_IDS)) + 1 : value) },
  { elevations: preset.elevations.map((value, index) => index === protectedIdx ? value + 0.01 : value) }
]) {
  assert.throws(() => parseFxLabMapPreset(JSON.stringify({ ...preset, ...mutation }), preset, map.protectedMask));
}

const clearOcean = resolveOceanSurfaceContext({ windDx: 0.7, windDy: -0.3, windStrength01: 0.55, rainIntensity01: 0 });
const rainEventOcean = resolveOceanSurfaceContext({ windDx: 0.7, windDy: -0.3, windStrength01: 0.55, rainIntensity01: 0.8 });
assert.ok(rainEventOcean.waveEnergy01 > clearOcean.waveEnergy01, "FX Lab rain event must strengthen ocean waves");
assert.ok(rainEventOcean.foamEnergy01 > clearOcean.foamEnergy01, "FX Lab rain event must strengthen shoreline foam");
assert.ok(rainEventOcean.shallowClarity01 < clearOcean.shallowClarity01, "FX Lab rain event must reduce shallow clarity");
const fxLabControllerSource = await readFile(
  fileURLToPath(new URL("../src/render/fxLab/controller.ts", import.meta.url)),
  "utf8"
);
assert.match(fxLabControllerSource, /setOceanSurfaceContext\(resolveOceanSurfaceContext\(/, "FX Lab must feed weather into the ocean shader");
assert.match(fxLabControllerSource, /rainIntensity01: rainActive \? rainIntensity : 0/, "non-rain FX Lab modes must not inherit storm wave energy");

console.log("FX Lab showcase regression passed.");
