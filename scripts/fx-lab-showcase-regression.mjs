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
import {
  buildGrassChebyshevDistanceField,
  decodePackedGrassHeight,
  packGrassVolumeField
} from "../dist/systems/terrain/rendering/vegetation/grassVolumeField.js";
import { packGrassVolumePropertyField } from "../dist/systems/terrain/rendering/vegetation/grassVolumePropertyField.js";
import {
  resolveCampaignGrassDryness,
  resolveCampaignGrassSeasonGrowth
} from "../dist/systems/terrain/rendering/vegetation/grassSeasonShader.js";
import { createProceduralScrubFallbackGeometry } from "../dist/systems/terrain/rendering/vegetation/proceduralScrubFallbackGeometry.js";
import {
  GRASS_VOLUME_NOISE_FIELD_MAX_SIZE,
  GRASS_VOLUME_NOISE_FIELD_MIN_SIZE,
  GRASS_VOLUME_WIND_TIME_SCALE,
  grassVolumeVariationFieldFragmentShader,
  grassVolumeWindFieldFragmentShader
} from "../dist/systems/terrain/rendering/vegetation/grassVolumeNoiseFields.js";
import {
  GRASS_VOLUME_MAX_INTEGRATION_STEP,
  GRASS_VOLUME_MAX_MARCH_SPAN_CELLS,
  GRASS_VOLUME_MIN_SHELL_SAMPLES,
  GRASS_VOLUME_TERRAIN_DEPTH_TOLERANCE_CELLS,
  grassVolumeMarchingShader
} from "../dist/systems/terrain/rendering/vegetation/grassVolumeMarchingShader.js";
import {
  DEFAULT_GRASS_VOLUME_CONTROLS,
  GRASS_VOLUME_AGE_CYCLE_SECONDS,
  GRASS_VOLUME_DISTANT_MARCH_STEPS,
  GRASS_VOLUME_CLUMP_DETAIL_MIN_PIXELS,
  GRASS_VOLUME_FINE_DETAIL_MIN_PIXELS,
  GRASS_VOLUME_MAX_LENGTH,
  GRASS_VOLUME_MARCH_STEPS,
  GRASS_VOLUME_MID_MARCH_STEPS,
  GRASS_VOLUME_WIND_BEND_SCALE,
  grassVolumeFragmentShader,
  normalizeGrassVolumeControls,
  resolveGrassVolumeDryness
} from "../dist/systems/terrain/rendering/vegetation/grassVolumeShader.js";
import { grassVolumeCompositeFragmentShader } from "../dist/systems/terrain/rendering/vegetation/grassVolumeCompositeShader.js";
import { GRASS_VOLUME_RENDER_SCALE } from "../dist/systems/terrain/rendering/vegetation/grassVolumePass.js";
import {
  GRASS_PCG_MARCH_STEPS,
  grassPcgBladeFragmentShader
} from "../dist/systems/terrain/rendering/vegetation/grassPcgBladeShader.js";
import {
  buildFxLabOverrides,
  cloneDefaultFireFxDebugControls,
  cloneDefaultGrassVolumeControls,
  cloneDefaultOceanWaterDebugControls,
  cloneDefaultTerrainWaterDebugControls,
  cloneDefaultWaterFxDebugControls
} from "../dist/render/fxLab/controls.js";
import {
  resolveFireTruckEmergencyLightFlashState,
  shouldActivateFireTruckEmergencyLights
} from "../dist/systems/units/rendering/fireTruckEmergencyLights.js";

const grid = { cols: FX_LAB_SHOWCASE_SIZE, rows: FX_LAB_SHOWCASE_SIZE, totalTiles: FX_LAB_SHOWCASE_SIZE ** 2 };
const createWorld = () => createInitialState(18032026, grid);
const world = createWorld();
const map = createFxLabShowcaseMap(world);

const grassFieldInput = {
  sampleCols: 2,
  sampleRows: 2,
  sampleHeights: Float32Array.from([0.1, 0.45, 0.8, 0.25]),
  sampleTypes: Uint8Array.from([
    TILE_TYPE_IDS.grass,
    TILE_TYPE_IDS.water,
    TILE_TYPE_IDS.grass,
    TILE_TYPE_IDS.road
  ]),
  grassTypeId: TILE_TYPE_IDS.grass,
  heightScale: 10,
  width: 12,
  depth: 12
};
const packedGrassField = packGrassVolumeField(grassFieldInput);
const repackedGrassField = packGrassVolumeField(grassFieldInput);
assert.deepEqual(packedGrassField.data, repackedGrassField.data, "grass field packing must be deterministic");
assert.deepEqual(
  Array.from(packedGrassField.data.filter((_, index) => index % 4 === 2)),
  [255, 0, 255, 0],
  "only authoritative grass samples may enable volume coverage"
);
assert.deepEqual(
  Array.from(packedGrassField.data.filter((_, index) => index % 4 === 3)),
  [0, 1, 0, 1],
  "the packed alpha channel must carry conservative distance to grass"
);
const gameplayGrassProperties = packGrassVolumePropertyField({
  sourceCols: 2,
  sourceRows: 2,
  sampleCols: 2,
  sampleRows: 2,
  sampleStep: 1,
  sampleTypes: grassFieldInput.sampleTypes,
  tileTypes: grassFieldInput.sampleTypes,
  tileFuel: Float32Array.from([0.3, 0, 0.15, 0]),
  tileMoisture: Float32Array.from([0.2, 1, 0.75, 0.4]),
  grassTypeId: TILE_TYPE_IDS.grass,
  grassFuelReference: 0.3
});
assert.deepEqual(
  Array.from(gameplayGrassProperties),
  [255, 204, 0, 255, 0, 0, 0, 255, 128, 64, 0, 255, 0, 0, 0, 255],
  "campaign grass properties must encode fuel-relative length and one-minus-moisture dryness only on grass"
);
assert.equal(resolveCampaignGrassSeasonGrowth(0), 0.55, "winter grass must retain the shortest seasonal growth envelope");
assert.equal(resolveCampaignGrassSeasonGrowth(0.25), 0.86, "spring grass must visibly regrow");
assert.equal(resolveCampaignGrassSeasonGrowth(0.5), 1, "summer grass must reach its fuel-limited height");
assert.equal(resolveCampaignGrassSeasonGrowth(0.75), 0.78, "autumn grass must recede from its summer height");
assert.ok(Math.abs(resolveCampaignGrassDryness(0.2, 0.8) - 0.632) < 1e-6, "global climate dryness must dominate static local moisture like terrain colour");
const scrubFallbackGeometry = createProceduralScrubFallbackGeometry();
assert.ok((scrubFallbackGeometry.getAttribute("position")?.count ?? 0) >= 48, "scrub fallback must be a multi-lobe shrub rather than one placeholder solid");
scrubFallbackGeometry.dispose();
const sparseGrassDistances = buildGrassChebyshevDistanceField(
  Uint8Array.from([
    0, 0, 0, 0, 0,
    0, 0, 0, 0, 0,
    0, 0, TILE_TYPE_IDS.grass, 0, 0,
    0, 0, 0, 0, 0,
    0, 0, 0, 0, 0
  ]),
  5,
  5,
  TILE_TYPE_IDS.grass
);
assert.equal(sparseGrassDistances[2 * 5 + 2], 0, "grass cells must have zero skip distance");
assert.equal(sparseGrassDistances[0], 2, "diagonal distance must be conservative Chebyshev distance");
assert.equal(sparseGrassDistances[2 * 5], 2, "axial distance must match the nearest grass cell");
for (let index = 0; index < grassFieldInput.sampleHeights.length; index += 1) {
  const offset = index * 4;
  const decoded = decodePackedGrassHeight(
    packedGrassField.data[offset],
    packedGrassField.data[offset + 1],
    packedGrassField.minHeight,
    packedGrassField.maxHeight
  );
  assert.ok(
    Math.abs(decoded - grassFieldInput.sampleHeights[index] * grassFieldInput.heightScale) < 0.001,
    `packed grass height ${index} lost excessive precision`
  );
}
const clampedGrassControls = normalizeGrassVolumeControls({
  dryness: 2,
  grassLength: -1,
  density: 5,
  windResponse: 4,
  windSpeed: -2,
  debugView: "bad"
});
assert.equal(clampedGrassControls.dryness, 1);
assert.equal(clampedGrassControls.grassLength, 0.08);
assert.equal(clampedGrassControls.density, 1);
assert.equal(clampedGrassControls.windResponse, 1);
assert.equal(clampedGrassControls.windSpeed, 0);
assert.equal(clampedGrassControls.debugView, "final");
assert.equal(clampedGrassControls.variant, "volume-clumps");
assert.equal(normalizeGrassVolumeControls({ variant: "pcg-sdf" }).variant, "pcg-sdf");
assert.equal(normalizeGrassVolumeControls({ grassLength: 1 }).grassLength, 0.6);
assert.equal(normalizeGrassVolumeControls({ windSpeed: 4 }).windSpeed, 2);
assert.equal(normalizeGrassVolumeControls({ debugView: "sample-spacing" }).debugView, "sample-spacing");
const cyclingGrassControls = normalizeGrassVolumeControls({ ...DEFAULT_GRASS_VOLUME_CONTROLS, autoAge: true });
assert.equal(resolveGrassVolumeDryness(cyclingGrassControls, 0), 0);
assert.equal(resolveGrassVolumeDryness(cyclingGrassControls, GRASS_VOLUME_AGE_CYCLE_SECONDS * 0.5), 0.5);
assert.equal(resolveGrassVolumeDryness(cyclingGrassControls, GRASS_VOLUME_AGE_CYCLE_SECONDS), 0);
assert.equal(GRASS_VOLUME_MARCH_STEPS, 96);
assert.equal(GRASS_VOLUME_MID_MARCH_STEPS, 64);
assert.equal(GRASS_VOLUME_DISTANT_MARCH_STEPS, 40);
assert.equal(GRASS_VOLUME_RENDER_SCALE, 0.6);
assert.equal(GRASS_PCG_MARCH_STEPS, 64);
assert.equal(GRASS_VOLUME_WIND_TIME_SCALE, 0.35);
assert.equal(GRASS_VOLUME_WIND_BEND_SCALE, 0.34);
assert.equal(GRASS_VOLUME_CLUMP_DETAIL_MIN_PIXELS, 2);
assert.equal(GRASS_VOLUME_FINE_DETAIL_MIN_PIXELS, 8);
assert.equal(GRASS_VOLUME_MAX_LENGTH, 0.6);
assert.equal(GRASS_VOLUME_MAX_INTEGRATION_STEP, 0.065);
assert.equal(GRASS_VOLUME_MIN_SHELL_SAMPLES, 4);
assert.equal(GRASS_VOLUME_TERRAIN_DEPTH_TOLERANCE_CELLS, 0.08);
assert.equal(GRASS_VOLUME_MAX_MARCH_SPAN_CELLS, 4);
assert.match(grassVolumeFragmentShader, /#define GRASS_MARCH_STEPS 96/);
assert.match(grassVolumeFragmentShader, /sceneDepth >= 0\.999999[\s\S]*gl_FragColor = vec4\(0\.0\)[\s\S]*vec3 farWorld/, "volume grass must reject sky rays before terrain-plane evaluation");
assert.match(grassVolumeFragmentShader, /farDistance = min\(farDistance, sceneDistance\)/);
assert.match(grassVolumeFragmentShader, /sampleGrassDistanceCells/, "grass rays must skip conservatively across non-grass terrain");
assert.match(grassVolumeFragmentShader, /float sampleGrassCoverage[\s\S]*hardOwnership[\s\S]*if \(hardOwnership < 0\.5\) return 0\.0/, "non-grass cells must retain strict zero ownership");
assert.match(grassVolumeFragmentShader, /filteredOwnership[\s\S]*smoothstep\(0\.50, 0\.96, filteredOwnership\)/, "grass coverage must feather inward from hard tile junctions");
assert.match(grassVolumeFragmentShader, /projectedGrassPixels/, "sub-pixel grass must fade before expensive blade work");
assert.match(grassVolumeFragmentShader, /marchDistance \+= max\(stepLength, emptyWorldDistance\)/);
assert.doesNotMatch(grassVolumeFragmentShader, /float fbm\(/, "per-step raymarching must not recompute FBM fields");
assert.match(grassVolumeFragmentShader, /float stepCeiling[\s\S]*64\.0[\s\S]*40\.0/, "grass must retain the aggressive 96/64/40 projected-size ceilings");
assert.match(grassVolumeFragmentShader, /float sampleTerrainHeight[\s\S]*return decodeHeight\(texture2D/, "packed terrain height must use continuous hardware-bilinear interpolation");
assert.doesNotMatch(grassVolumeFragmentShader, /sampleTerrainPlane|terrainPlane/, "terrain planes must not be extrapolated across multiple cells");
assert.match(grassVolumeFragmentShader, /float terrainHeight = sampleTerrainHeight\(fieldUv\)/, "occupied march samples must follow their actual terrain height");
assert.match(grassVolumeFragmentShader, /sceneMatchesTerrain[\s\S]*terrainDepthTolerance\(\)[\s\S]*if \(!sceneMatchesTerrain \|\| referenceMask < 0\.5\)/, "volume rays must be anchored to visible authoritative grass terrain");
assert.match(grassVolumeMarchingShader, /sampleTerrainGradient[\s\S]*heightLeft[\s\S]*heightRight[\s\S]*heightDown[\s\S]*heightUp/, "terrain anchoring must use a central-difference gradient");
assert.match(grassVolumeMarchingShader, /canopyPathLength[\s\S]*1\.15[\s\S]*uFieldCellWorldSize \* 0\.05[\s\S]*uFieldCellWorldSize \* 4\.0/, "the terrain-anchored interval must retain bounded curvature and grazing padding");
assert.match(grassVolumeFragmentShader, /marchSpan = terrainAnchoredMarchSpan[\s\S]*nearDistance = max\(nearDistance, farDistance - marchSpan\)/, "marching must backtrack only through the terrain-anchored canopy interval");
assert.match(grassVolumeMarchingShader, /ceil\(marchSpan \/ 0\.065\)[\s\S]*4\.0[\s\S]*stepCeiling/, "adaptive sampling must use prototype-scale spacing within the existing ceilings");
assert.match(grassVolumeFragmentShader, /integrationLength = min\(stepLength, 0\.065\)[\s\S]*localDensity \* integrationLength \* 3\.6/, "one undersampled hit must never integrate as a world-spanning slab");
assert.match(grassVolumeFragmentShader, /vec4 rayProps = grassProperties\(referenceXZ\)[\s\S]*for \(int stepIndex/, "wind and properties must be cached once per ray");
assert.match(grassVolumeFragmentShader, /projectedGrassPixels > 8\.0[\s\S]*rawFineNoise/, "sub-pixel fine noise must be omitted before it can form moire");
assert.match(grassVolumeFragmentShader, /detailStrength < 0\.001[\s\S]*return 0\.72/, "distant blade structure must resolve to stable density");
assert.match(grassVolumeWindFieldFragmentShader, /visualTime = uTime \* 0\.35/, "grass wind must remain smooth but intentionally slow");
assert.match(grassVolumeWindFieldFragmentShader, /smoothstep\(0\.35, 0\.92, gustWave\)/, "grass gusts must include deterministic calm intervals");
assert.match(grassVolumeCompositeFragmentShader, /vec4 grassLayer = texture2D\(uGrassLayer, vUv\)/, "reduced grass must use stable hardware-bilinear reconstruction");
assert.doesNotMatch(grassVolumeCompositeFragmentShader, /depthWeight|uvA|uvB/, "direction-switching reconstruction must not reintroduce camera-motion shimmer");
assert.doesNotMatch(grassVolumeFragmentShader, /sampleColour = sampleColour \/|pow\(sampleColour/, "volume grass must remain linear until final compositing");
assert.doesNotMatch(grassPcgBladeFragmentShader, /colour = colour \/|pow\(colour/, "PCG grass must remain linear until final compositing");
assert.match(grassVolumeCompositeFragmentShader, /#include <tonemapping_fragment>[\s\S]*#include <colorspace_fragment>/, "the combined scene and grass layer must be display-transformed exactly once");
assert.match(grassVolumeFragmentShader, /localGrassHeight = grassHeight \* edgeCoverage[\s\S]*localDensity = density \* edgeCoverage/, "grass height and density must collapse inside hard coverage boundaries");
assert.match(grassVolumeFragmentShader, /executedSteps \+= 1\.0[\s\S]*work = executedSteps \/ max\(stepCeiling, 1\.0\)[\s\S]*vec4\(debugHeat\(work\) \* hasGrassWork, hasGrassWork\)/, "march-work diagnostics must report executed terrain-backed work");
assert.match(grassVolumeFragmentShader, /uDebugView > 3\.5[\s\S]*spacingRatio = stepLength \/ 0\.065/, "sample-spacing diagnostics must expose under-resolved grazing rays");
assert.match(grassPcgBladeFragmentShader, /uint pcg_hash[\s\S]*float hash21[\s\S]*float hash31/, "the alternate grass must retain the supplied PCG hash construction");
assert.match(grassPcgBladeFragmentShader, /#define PCG_GRASS_MARCH_STEPS 64/);
assert.match(grassPcgBladeFragmentShader, /sceneDepth >= 0\.999999[\s\S]*outColour = vec4\(0\.0\)[\s\S]*vec3 farWorld/, "PCG grass must reject sky rays before marching");
assert.match(grassPcgBladeFragmentShader, /farDistance = min\(farDistance, sceneDistance\)/, "PCG grass must stop at authoritative scene depth");
assert.match(grassPcgBladeFragmentShader, /sampleGrassMask[\s\S]*mapGrass[\s\S]*evaluateBlade/, "PCG blades must remain confined to the packed terrain field");
assert.match(grassPcgBladeFragmentShader, /float mapDistance = 0\.04[\s\S]*return mapDistance/, "PCG map must use one initialized return for strict ANGLE compilers");
assert.doesNotMatch(grassPcgBladeFragmentShader, /inout vec4 properties|inout vec4 wind/, "PCG map must not expose ANGLE-prone vec4 output parameters");
assert.match(grassPcgBladeFragmentShader, /canopy boundary is an entry guide[\s\S]*mapDistance = max\(0\.012/, "the canopy entry plane must not become a visible sheet");
assert.doesNotMatch(grassPcgBladeFragmentShader, /800\.0/, "the synthetic 800-step loop must not enter FX Lab");
assert.equal(GRASS_VOLUME_NOISE_FIELD_MIN_SIZE, 128);
assert.equal(GRASS_VOLUME_NOISE_FIELD_MAX_SIZE, 256);
assert.match(grassVolumeWindFieldFragmentShader, /float fbm\(/, "the cached wind prepass must preserve procedural variation");
assert.match(grassVolumeVariationFieldFragmentShader, /densityField/, "the static cache must retain density variation");
const grassOverrides = buildFxLabOverrides(
  cloneDefaultFireFxDebugControls(),
  cloneDefaultWaterFxDebugControls(),
  cloneDefaultTerrainWaterDebugControls(),
  cloneDefaultOceanWaterDebugControls(),
  normalizeGrassVolumeControls({ ...cloneDefaultGrassVolumeControls(), dryness: 0.9 })
);
assert.deepEqual(grassOverrides.grass, { dryness: 0.9 }, "grass tuning must export through the FX Lab payload");

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
const blueEmergencyFlash = resolveFireTruckEmergencyLightFlashState(0.064);
const redEmergencyFlash = resolveFireTruckEmergencyLightFlashState(0.464);
const emergencyFlashGap = resolveFireTruckEmergencyLightFlashState(0.32);
assert.equal(blueEmergencyFlash.blueIntensity, 1, "the first emergency-light bank must reach full intensity");
assert.equal(blueEmergencyFlash.redIntensity, 0, "the red bank must remain dark during the blue flash");
assert.equal(redEmergencyFlash.redIntensity, 1, "the alternating emergency-light bank must reach full intensity");
assert.equal(redEmergencyFlash.blueIntensity, 0, "the blue bank must remain dark during the red flash");
assert.deepEqual(emergencyFlashGap, { blueIntensity: 0, redIntensity: 0 }, "the pattern must retain a readable dark gap");
assert.equal(
  shouldActivateFireTruckEmergencyLights({ simTimeMode: "incident", fireActivityState: "burning" }),
  true,
  "confirmed active incidents must activate campaign firetruck lights"
);
assert.equal(
  shouldActivateFireTruckEmergencyLights({ simTimeMode: "strategic", fireActivityState: "burning" }),
  false,
  "undetected strategic fires must not activate response lights"
);
assert.equal(
  shouldActivateFireTruckEmergencyLights({ simTimeMode: "incident", fireActivityState: "idle" }),
  false,
  "resolved incidents must deactivate response lights"
);
const fxLabControllerSource = await readFile(
  fileURLToPath(new URL("../src/render/fxLab/controller.ts", import.meta.url)),
  "utf8"
);
const fxLabPanelSource = await readFile(
  fileURLToPath(new URL("../src/render/fxLab/panel.ts", import.meta.url)),
  "utf8"
);
const fxLabControlsSource = await readFile(
  fileURLToPath(new URL("../src/render/fxLab/controls.ts", import.meta.url)),
  "utf8"
);
const fxLabScenariosSource = await readFile(
  fileURLToPath(new URL("../src/render/fxLab/scenarios.ts", import.meta.url)),
  "utf8"
);
const threeTestUnitsSource = await readFile(
  fileURLToPath(new URL("../src/render/threeTestUnits.ts", import.meta.url)),
  "utf8"
);
const fireTruckEmergencyLightsSource = await readFile(
  fileURLToPath(new URL("../src/systems/units/rendering/fireTruckEmergencyLights.ts", import.meta.url)),
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
const grassVolumePassSource = await readFile(
  fileURLToPath(new URL("../src/systems/terrain/rendering/vegetation/grassVolumePass.ts", import.meta.url)),
  "utf8"
);
const grassVolumeFieldSource = await readFile(
  fileURLToPath(new URL("../src/systems/terrain/rendering/vegetation/grassVolumeField.ts", import.meta.url)),
  "utf8"
);
const grassVolumePropertyFieldSource = await readFile(
  fileURLToPath(new URL("../src/systems/terrain/rendering/vegetation/grassVolumePropertyField.ts", import.meta.url)),
  "utf8"
);
const threeTestSource = await readFile(
  fileURLToPath(new URL("../src/render/threeTest.ts", import.meta.url)),
  "utf8"
);
const runtimeSettingsSource = await readFile(
  fileURLToPath(new URL("../src/persistence/runtimeSettings.ts", import.meta.url)),
  "utf8"
);
const titleScreenSource = await readFile(
  fileURLToPath(new URL("../src/ui/titleScreen.ts", import.meta.url)),
  "utf8"
);
const terrainRendererSource = await readFile(
  fileURLToPath(new URL("../src/render/threeTestTerrain.ts", import.meta.url)),
  "utf8"
);
const coreConfigSource = await readFile(
  fileURLToPath(new URL("../src/core/config.ts", import.meta.url)),
  "utf8"
);
assert.match(fxLabControllerSource, /setOceanSurfaceContext\(resolveOceanSurfaceContext\(/, "FX Lab must feed weather into the ocean shader");
assert.match(fxLabControllerSource, /rainIntensity01: rainActive \? rainIntensity : 0/, "non-rain FX Lab modes must not inherit storm wave energy");
assert.match(fxLabControllerSource, /buildTreeImpostorAtlas\(renderer, treeAssets\)/, "FX Lab must use the shared runtime tree atlas path");
assert.match(fxLabPanelSource, /Force Models/, "FX Lab must expose the full-model comparison mode");
assert.match(fxLabPanelSource, /Force Impostors/, "FX Lab must expose the impostor comparison mode");
assert.match(fxLabPanelSource, /Grass Fidelity/, "FX Lab must expose dedicated grass controls");
assert.match(fxLabScenariosSource, /id: "emergency-lights"[\s\S]*label: "Emergency Lights"/, "FX Lab must expose the emergency-light prototype scenario");
assert.match(fxLabControllerSource, /setEmergencyLightsOverride\(currentScenarioId === "emergency-lights"\)/, "FX Lab must retain its explicit emergency-light preview override");
assert.match(threeTestUnitsSource, /createFireTruckEmergencyLightLayer\(scene, MAX_TRUCK_INSTANCES\)/, "truck rendering must compose the isolated emergency-light layer");
assert.match(threeTestUnitsSource, /emergencyLightsOverride \?\? shouldActivateFireTruckEmergencyLights\(world\)/, "campaign truck rendering must derive lights from authoritative incident state");
assert.match(fireTruckEmergencyLightsSource, /LIGHT_BAR_FORWARD_OFFSET = 0\.22/, "the prototype light bar must sit over the forward cab roof");
assert.match(fireTruckEmergencyLightsSource, /LIGHT_BAR_GLOW_MIN_RADIUS = 0\.012[\s\S]*LIGHT_BAR_GLOW_RADIUS_RANGE = 0\.024/, "the model-aligned glow must remain bounded to the roof-light scale");
assert.match(fxLabControlsSource, /PCG SDF Blades/, "FX Lab must expose the alternate PCG grass renderer");
assert.match(fxLabControlsSource, /Wind Response[\s\S]*Wind Speed/, "FX Lab must expose independent grass wind diagnostics");
assert.match(fxLabControlsSource, /Sample Spacing/, "FX Lab must expose the terrain-anchored integration diagnostic");
assert.match(fxLabPanelSource, /GPU timing unavailable/, "FX Lab must report unavailable grass GPU timing honestly");
assert.match(fxLabControllerSource, /createGrassVolumePass\(renderer\)/, "FX Lab must own the isolated grass compositor");
assert.match(fxLabControllerSource, /currentScenarioId !== FX_LAB_GRASS_SCENARIO_ID/, "grass compositing must remain scenario-gated");
assert.match(grassVolumePassSource, /new THREE\.DepthTexture/, "grass compositing must use scene depth");
assert.match(grassVolumePassSource, /normal scene fallback active/, "unsupported grass rendering must retain the normal scene");
assert.match(grassVolumePassSource, /createGrassVolumeNoiseFields/, "grass FBM must be cached outside the raymarch");
assert.match(grassVolumePassSource, /noiseFields\.dispose\(\)/, "grass field caches must be disposed with the pass");
assert.match(grassVolumePassSource, /GRASS_VOLUME_RENDER_SCALE = 0\.60/, "grass raymarching must use the aggressive 60% linear scale");
assert.match(grassVolumePassSource, /terrain-anchored adaptive grass ready/, "the FX Lab status must identify the corrected adaptive profile");
assert.match(grassVolumeFieldSource, /texture\.minFilter = THREE\.LinearFilter[\s\S]*texture\.magFilter = THREE\.LinearFilter/, "exact packed field cell centres must remain filterable for portable texture access");
assert.match(grassVolumePassSource, /configureGrassTarget[\s\S]*texture\.minFilter = THREE\.LinearFilter[\s\S]*texture\.magFilter = THREE\.LinearFilter/, "the reduced grass layer must reconstruct with stable bilinear filtering");
assert.match(grassVolumePassSource, /state\.timeSeconds \* controls\.windSpeed/, "FX Lab time must remain authoritative while allowing wind motion to be frozen");
assert.match(grassVolumePassSource, /uWindResponse\.value = controls\.windResponse/, "wind response must be adjustable without rebuilding terrain");
assert.match(grassVolumePassSource, /grassTarget\?\.dispose\(\)/, "the reduced grass layer must be disposed with the pass");
assert.match(grassVolumePassSource, /glslVersion: THREE\.GLSL3/, "the PCG uint shader must compile through the WebGL2 GLSL3 path");
assert.match(grassVolumePassSource, /pcgBladeMaterial\.dispose\(\)/, "the alternate grass material must be disposed with the pass");
assert.match(grassVolumePassSource, /PCG SDF blades require WebGL2/, "unsupported PCG contexts must identify the volume fallback");
assert.match(grassVolumeFragmentShader, /uUseGameplayProperties > 0\.5[\s\S]*gameplay\.r[\s\S]*gameplay\.g/, "campaign grass must use packed fuel and dryness instead of FX Lab ageing controls");
assert.match(grassVolumeFragmentShader, /gameplayGrid[\s\S]*\(gameplayGrid \+ 0\.5\) \/ uFieldSize/, "campaign properties must align with packed terrain texel centres");
assert.match(grassVolumeFragmentShader, /seasonalFuelLoad = fuelLoad \* campaignGrassSeasonGrowth\(uSeasonT01\)/, "campaign grass height must combine fuel load with the interpolated season");
assert.match(grassVolumeFragmentShader, /campaignGrassDryness\(gameplay\.g\)/, "campaign grass colour must combine local and global dryness");
assert.match(grassVolumePropertyFieldSource, /fuelSum \/ grassCount \/ fuelReference/, "campaign grass length must derive from authoritative fuel load");
assert.match(grassVolumePropertyFieldSource, /1 - clamp01\(input\.tileMoisture/, "campaign grass colour must derive from authoritative tile dryness");
assert.match(grassVolumePassSource, /gameplayPropertyField\?\.update\(input\)/, "dynamic fuel updates must reuse a stable gameplay property texture");
assert.match(runtimeSettingsSource, /volumetricgrass: false/, "campaign volumetric grass must remain opt-in by default");
assert.match(titleScreenSource, /title: "Vegetation"[\s\S]*keys: \["volumetricgrass"\]/, "the main graphics settings must expose the grass toggle");
assert.match(threeTestSource, /renderWorldSceneWithOptionalGrass[\s\S]*grassVolumePass\.render[\s\S]*postPipeline\.render\(renderWorldSceneWithOptionalGrass\)/, "campaign grass must composite before the existing post pipeline");
assert.match(threeTestSource, /seasonT01: environmentCurrent\.seasonT01[\s\S]*climateDryness: getRenderClimateDryness\(world\)/, "campaign grass must receive smooth season phase and authoritative climate dryness");
assert.match(threeTestSource, /isFireVisualOnlyTerrainUpdateIntent[\s\S]*syncCampaignGrassFields\(nextSample, lastTerrainSurface, false\)/, "fire fuel changes must refresh grass properties without rebuilding terrain geometry");
assert.match(threeTestSource, /grassVolumePass\.resize\(\)[\s\S]*grassVolumePass\.dispose\(\)/, "campaign grass resources must follow renderer lifecycle ownership");
assert.doesNotMatch(terrainRendererSource, /applyGrassDetailFx|ENABLE_GRASS_DETAIL_FX/, "campaign terrain must not retain the obsolete grass patch");
assert.match(terrainRendererSource, /createProceduralScrubFallbackGeometry\(\)[\s\S]*color: 0xffffff/, "budget fallback scrub must use clustered geometry with one non-crushing instance tint");
assert.doesNotMatch(coreConfigSource, /ENABLE_GRASS_DETAIL_FX/, "campaign configuration must not expose the retired grass flag");
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
