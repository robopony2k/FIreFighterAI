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
import {
  DEFAULT_OCEAN_WATER_DEBUG_CONTROLS,
  normalizeOceanWaterDebugControls
} from "../dist/render/oceanWaterDebug.js";
import {
  MDXYZX_MAX_RAYMARCH_STEPS,
  MDXYZX_NORMAL_WAVE_ITERATIONS,
  MDXYZX_RAYMARCH_WAVE_ITERATIONS,
  MDXYZX_REFERENCE_MODES,
  normalizeMdXyzxReferenceMode
} from "../dist/render/water/ocean/mdXyzxReferenceShader.js";

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
assert.equal(DEFAULT_OCEAN_WATER_DEBUG_CONTROLS.raymarchDebugView, 0, "ocean diagnostics must default off");
assert.equal(
  normalizeOceanWaterDebugControls({ raymarchDebugView: 4.6 }).raymarchDebugView,
  5,
  "the ocean diagnostic selector must normalize to a valid integral shader mode"
);
const fxLabControllerSource = await readFile(
  fileURLToPath(new URL("../src/render/fxLab/controller.ts", import.meta.url)),
  "utf8"
);
const fxLabPanelSource = await readFile(
  fileURLToPath(new URL("../src/render/fxLab/panel.ts", import.meta.url)),
  "utf8"
);
const mdXyzxReferenceSource = await readFile(
  fileURLToPath(new URL("../src/render/water/ocean/mdXyzxReferenceShader.ts", import.meta.url)),
  "utf8"
);
const mdXyzxWaveCoreSource = await readFile(
  fileURLToPath(new URL("../src/render/water/ocean/mdXyzxWaveCoreShader.ts", import.meta.url)),
  "utf8"
);
const mdXyzxProductionRaymarchSource = await readFile(
  fileURLToPath(new URL("../src/render/water/ocean/mdXyzxProductionRaymarchShader.ts", import.meta.url)),
  "utf8"
);
const oceanReferenceComparisonSource = await readFile(
  fileURLToPath(new URL("../src/render/fxLab/oceanReferenceComparison.ts", import.meta.url)),
  "utf8"
);
const productionOceanShaderSource = await readFile(
  fileURLToPath(new URL("../src/render/water/ocean/oceanSurfaceShader.ts", import.meta.url)),
  "utf8"
);
assert.match(fxLabControllerSource, /setOceanSurfaceContext\(resolveOceanSurfaceContext\(/, "FX Lab must feed weather into the ocean shader");
assert.match(fxLabControllerSource, /rainIntensity01: rainActive \? rainIntensity : 0/, "non-rain FX Lab modes must not inherit storm wave energy");
assert.match(fxLabControllerSource, /buildTreeImpostorAtlas\(renderer, treeAssets\)/, "FX Lab must use the shared runtime tree atlas path");
assert.match(fxLabPanelSource, /Force Models/, "FX Lab must expose the full-model comparison mode");
assert.match(fxLabPanelSource, /Force Impostors/, "FX Lab must expose the impostor comparison mode");
assert.match(fxLabPanelSource, /Production Raymarch Debug/, "FX Lab must expose production raymarch diagnostics");
assert.match(fxLabPanelSource, /raymarchDebugView/, "FX Lab must bind the production raymarch view selector");
assert.equal(MDXYZX_RAYMARCH_WAVE_ITERATIONS, 12, "the reference raymarch must retain 12 wave iterations");
assert.equal(MDXYZX_NORMAL_WAVE_ITERATIONS, 36, "the reference normal must retain 36 wave iterations");
assert.equal(MDXYZX_MAX_RAYMARCH_STEPS, 96, "the reference baseline must retain its bounded raymarch safety cap");
assert.deepEqual(MDXYZX_REFERENCE_MODES.map((mode) => mode.value), [0, 1, 2, 3, 4, 5, 6, 7]);
assert.equal(normalizeMdXyzxReferenceMode(8.7), 7);
assert.match(
  mdXyzxWaveCoreSource,
  /mdXyzxWavedx[\s\S]*mdXyzxGetDrivenWaves[\s\S]*length\(position\) \* 0\.1[\s\S]*position \+= direction \* wave\.y[\s\S]*frequency \*= 1\.18[\s\S]*timeMultiplier \*= 1\.07[\s\S]*mdXyzxGetWaves/,
  "the isolated reference must retain the MdXyzX dragged-wave construction"
);
assert.doesNotMatch(
  mdXyzxReferenceSource,
  /mdXyzxGetProductionWaves|mdXyzxRaymarchProductionWater|mdXyzxCalculateProductionNormal/,
  "the isolated reference must not opt into production wind-phase adapters"
);
assert.match(
  `${mdXyzxWaveCoreSource}\n${mdXyzxReferenceSource}`,
  /mdXyzxIntersectWaterPlane[\s\S]*mdXyzxRaymarchWater[\s\S]*waterHitPosition[\s\S]*mdXyzxCalculateNormal[\s\S]*distanceSmoothing[\s\S]*fresnel/,
  "the reference must reconstruct and shade a raymarched water hit rather than a flat carrier normal"
);
assert.match(
  oceanReferenceComparisonSource,
  /new THREE\.WebGLRenderTarget[\s\S]*mode === 2[\s\S]*u_gameTexture[\s\S]*comparisonTarget\?\.dispose/,
  "split comparison must use and dispose an isolated game-scene render target"
);
assert.match(fxLabControllerSource, /createFxLabOceanReferenceComparison\(\)/);
assert.match(fxLabControllerSource, /setOceanReferenceMode[\s\S]*getOceanReferenceMode/);
assert.match(fxLabPanelSource, /MdXyzX Reference Baseline/);
assert.match(mdXyzxReferenceSource, /Split: Reference \/ Game/);
assert.match(
  mdXyzxProductionRaymarchSource,
  /mdXyzxWaveCoreShader[\s\S]*mdXyzxTraceProductionOcean/,
  "production must consume the same verified MdXyzX core as the isolated reference"
);
assert.match(
  mdXyzxProductionRaymarchSource,
  /mdXyzxCalculateMacroNormal[\s\S]*macroBlend[\s\S]*normalCalm/,
  "production diagnostics must retain strategic-scale MdXyzX slope and bounded normal-calming state"
);
assert.match(
  productionOceanShaderSource,
  /mdXyzxProductionRaymarchShader[\s\S]*mdXyzxTraceProductionOcean/,
  "the campaign ocean must use the approved raymarched surface reconstruction"
);

console.log("FX Lab showcase regression passed.");
