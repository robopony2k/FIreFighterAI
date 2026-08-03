import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { TreeType } from "../dist/core/types.js";
import {
  TERRAIN_RENDER_CHUNK_TILE_SPAN,
  finalizeInstancedMeshBounds,
  partitionTerrainInstances
} from "../dist/systems/terrain/rendering/terrainRenderChunks.js";
import { buildSparseRoadOverlayGeometry } from "../dist/systems/terrain/rendering/sparseRoadOverlayGeometry.js";
import {
  ROAD_EDGE_E,
  ROAD_EDGE_W,
  resolveAuthoritativeRoadEdgeMask
} from "../dist/render/terrain/shared/roadTopology.js";
import { TerrainShadowBlendController } from "../dist/systems/terrain/rendering/terrainShadowBlendController.js";
import {
  ROAD_HIGH_CONTRAST_COLOR_HEX,
  TERRAIN_ROAD_VISUAL_USER_DATA,
  setTerrainRoadHighContrast
} from "../dist/render/terrain/roads/roadHighContrast.js";
import {
  SEASONAL_CLOUD_MARCH_STEPS
} from "../dist/systems/climate/rendering/seasonalCloudField.js";
import {
  seasonalSkyFragmentShader
} from "../dist/systems/climate/rendering/seasonalCloudShader.js";
import {
  DISTANT_OCEAN_SEGMENT_WORLD_SIZE,
  buildDistantOceanBackdropLayout
} from "../dist/render/water/ocean/distantOceanBackdropGeometry.js";
import {
  MDXYZX_QUALITY_PROFILES,
  MDXYZX_MAX_RAYMARCH_STEPS,
  MDXYZX_NORMAL_WAVE_ITERATIONS,
  MDXYZX_RAYMARCH_WAVE_ITERATIONS
} from "../dist/render/water/ocean/mdXyzxWaveCoreShader.js";
import {
  MDXYZX_MACRO_AMPLITUDE_SCALE,
  MDXYZX_MACRO_BLEND_FOOTPRINT_END,
  MDXYZX_MACRO_BLEND_FOOTPRINT_START,
  MDXYZX_MACRO_DOMAIN_SCALE,
  MDXYZX_MAX_FAR_NORMAL_CALM
} from "../dist/render/water/ocean/mdXyzxProductionRaymarchShader.js";
import {
  createSeasonalSkyDome
} from "../dist/systems/climate/rendering/seasonalSkyDome.js";
import {
  TREE_IMPOSTOR_AZIMUTH_COUNT,
  buildTreeImpostorFrameLayout
} from "../dist/systems/terrain/rendering/vegetation/treeImpostorAtlas.js";
import {
  TREE_IMPOSTOR_ENTER_PX,
  TREE_IMPOSTOR_EXIT_PX,
  buildTreeLod
} from "../dist/systems/terrain/rendering/vegetation/treeLodController.js";
import { createTreeBurnController } from "../dist/render/terrain/vegetation/treeBurnController.js";

const instances = [
  { tileX: 0, tileY: 0 },
  { tileX: TERRAIN_RENDER_CHUNK_TILE_SPAN - 1, tileY: 1 },
  { tileX: TERRAIN_RENDER_CHUNK_TILE_SPAN, tileY: 1 },
  { tileX: 2, tileY: TERRAIN_RENDER_CHUNK_TILE_SPAN }
];
const chunks = partitionTerrainInstances(instances, (instance) => ({ x: instance.tileX, y: instance.tileY }));
assert.equal(chunks.length, 3, "instances should be partitioned at the 64-tile boundary");
assert.equal(chunks[0].instances.length, 2, "same-chunk instances should remain batched");

const boundedMesh = new THREE.InstancedMesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshBasicMaterial(),
  2
);
const transform = new THREE.Matrix4();
boundedMesh.setMatrixAt(0, transform.makeTranslation(-5, 0, 0));
boundedMesh.setMatrixAt(1, transform.makeTranslation(5, 0, 0));
finalizeInstancedMeshBounds(boundedMesh);
assert.equal(boundedMesh.frustumCulled, true, "chunk meshes should use normal frustum culling");
assert.ok((boundedMesh.boundingSphere?.radius ?? 0) >= 5, "chunk bounds should include every instance");

const treeVariantCounts = {
  [TreeType.Pine]: 3,
  [TreeType.Oak]: 3,
  [TreeType.Maple]: 3,
  [TreeType.Birch]: 3,
  [TreeType.Elm]: 1,
  [TreeType.Scrub]: 3
};
const treeAssets = Object.fromEntries(
  Object.entries(treeVariantCounts).map(([treeType, count]) => [
    treeType,
    Array.from({ length: count }, (_, index) => ({ meshes: [], height: 1.5 + index * 0.1, baseOffset: 0 }))
  ])
);
const atlasLayout = buildTreeImpostorFrameLayout(treeAssets);
assert.equal(atlasLayout.length, 16, "atlas layout should include every loaded tree variant");
const occupiedAtlasFrames = new Set();
atlasLayout.forEach((entry) => {
  assert.equal(entry.frame.frameCount, TREE_IMPOSTOR_AZIMUTH_COUNT, "every tree variant should own four azimuths");
  for (let view = 0; view < entry.frame.frameCount; view += 1) {
    const frame = entry.frame.baseFrame + view;
    assert.equal(occupiedAtlasFrames.has(frame), false, `atlas frame ${frame} must not overlap`);
    occupiedAtlasFrames.add(frame);
  }
});
assert.equal(occupiedAtlasFrames.size, 64, "the supported tree asset set should deterministically fill 64 atlas cells");
assert.equal(TREE_IMPOSTOR_ENTER_PX, 18);
assert.equal(TREE_IMPOSTOR_EXIT_PX, 24);

const treeRoot = new THREE.Group();
const fullTreeMesh = new THREE.InstancedMesh(
  new THREE.BoxGeometry(1, 2, 1),
  new THREE.MeshBasicMaterial(),
  1
);
treeRoot.add(fullTreeMesh);
const colorAtlasTexture = new THREE.Texture();
const roleAtlasTexture = new THREE.Texture();
colorAtlasTexture.userData.treeImpostorSharedTexture = true;
roleAtlasTexture.userData.treeImpostorSharedTexture = true;
let atlasTextureDisposed = false;
colorAtlasTexture.addEventListener("dispose", () => { atlasTextureDisposed = true; });
const treeAtlas = {
  colorTexture: colorAtlasTexture,
  roleTexture: roleAtlasTexture,
  atlasSize: 1024,
  gridSize: 8,
  frameCount: 64,
  getFrame: () => ({ baseFrame: 0, frameCount: 4, worldSpan: 2, baseOffsetY: 0 }),
  dispose: () => {
    colorAtlasTexture.dispose();
    roleAtlasTexture.dispose();
  }
};
const seasonVisual = {
  enabled: true,
  uniforms: {
    uRisk01: { value: 0.4 },
    uSeasonT01: { value: 0.2 },
    uWorldSeed: { value: 1 }
  },
  phaseShiftMax: 0.08,
  rateJitter: 0.035,
  autumnHueJitter: 0.22
};
const fallbackRoot = new THREE.Group();
const fallbackFullMesh = new THREE.InstancedMesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshBasicMaterial(),
  1
);
fallbackRoot.add(fallbackFullMesh);
assert.equal(buildTreeLod({
  root: fallbackRoot,
  instances: [{
    x: 0, y: 0, z: 0, scale: 1, rotation: 0, treeType: TreeType.Pine,
    variantIndex: 0, tileIndex: 0, tileX: 0, tileY: 0, sourceHeight: 2
  }],
  fullMeshesByChunk: new Map([["0,0", [fallbackFullMesh]]]),
  atlas: { ...treeAtlas, getFrame: () => null }
}), null, "an incomplete atlas should preserve the full-model path");
assert.equal(fallbackFullMesh.visible, true);
const lodBuild = buildTreeLod({
  root: treeRoot,
  instances: [{
    x: 0, y: 0, z: 0, scale: 1, rotation: 0, treeType: TreeType.Pine,
    variantIndex: 0, tileIndex: 0, tileX: 0, tileY: 0, sourceHeight: 2
  }],
  fullMeshesByChunk: new Map([["0,0", [fullTreeMesh]]]),
  atlas: treeAtlas,
  seasonVisual,
  tileFuel: new Float32Array([1])
});
assert.ok(lodBuild, "loaded tree assets and an atlas should create a tree LOD controller");
const lodCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
lodCamera.position.set(0, 1, 200);
lodCamera.lookAt(0, 1, 0);
assert.equal(lodBuild.controller.update(lodCamera, 1000), true, "far chunks should enter impostor mode");
assert.equal(lodBuild.controller.getStats().impostorChunks, 1);
assert.equal(lodBuild.controller.getStats().impostorDrawCount, 1, "effective far-tree draws should count visible impostor chunks");
assert.equal(fullTreeMesh.visible, false, "a chunk must hide full models while its impostor is active");
const transitionCountAtFar = lodBuild.controller.getStats().transitionCount;
assert.equal(lodBuild.controller.update(lodCamera, 1000), false, "an unchanged camera must not re-evaluate LOD");
assert.equal(lodBuild.controller.getStats().transitionCount, transitionCountAtFar);
lodCamera.position.z = 100;
lodCamera.lookAt(0, 1, 0);
lodBuild.controller.update(lodCamera, 1000);
assert.equal(lodBuild.controller.getStats().impostorChunks, 1, "18-24 px hysteresis should retain the current impostor");
lodCamera.position.z = 50;
lodCamera.lookAt(0, 1, 0);
lodBuild.controller.update(lodCamera, 1000);
assert.equal(lodBuild.controller.getStats().modelChunks, 1, "chunks above 24 px should return to full models");
assert.equal(fullTreeMesh.visible, true);
lodCamera.position.set(0, 1, 10);
lodCamera.lookAt(0, 1, 20);
lodBuild.controller.update(lodCamera, 1000);
assert.equal(lodBuild.controller.getStats().impostorChunks, 1, "behind-camera chunks should not retain full shadow-casting models");
assert.equal(lodBuild.controller.getStats().impostorDrawCount, 0, "behind-camera impostors should be rejected by the view frustum");
lodBuild.controller.setMode("impostors");
assert.equal(lodBuild.controller.getMode(), "impostors");
assert.equal(lodBuild.controller.getStats().impostorChunks, 1, "forced impostors should provide an A/B comparison path");
assert.equal(lodBuild.controller.setMode("models"), true);
assert.equal(lodBuild.controller.getStats().modelChunks, 1, "forced models should provide the fallback comparison path");
assert.equal(lodBuild.burnStates.length, 1, "impostors should register a mixed tree burn state");
const impostorMaterial = lodBuild.burnStates[0].mesh.material;
assert.ok(impostorMaterial instanceof THREE.ShaderMaterial);
assert.ok(
  impostorMaterial.uniforms.fogColor &&
    impostorMaterial.uniforms.fogNear &&
    impostorMaterial.uniforms.fogFar &&
    impostorMaterial.uniforms.fogDensity,
  "fog-enabled tree impostors must provide Three's complete fog uniform set"
);
seasonVisual.uniforms.uSeasonT01.value = 0.8;
assert.equal(impostorMaterial.uniforms.uSeasonT01.value, 0.8, "season changes should reach hidden impostors");
const impostorBurnState = lodBuild.burnStates[0];
const modelBurnState = {
  ...impostorBurnState,
  mesh: fullTreeMesh,
  baseScale: new Float32Array([1]),
  scalePivotY: new Float32Array([0.9]),
  burnProgress: new Float32Array(1),
  burnQ: new Uint8Array(1),
  visibilityQ: new Uint8Array([255])
};
const burnController = createTreeBurnController([modelBurnState, impostorBurnState], 255, new Map());
burnController.update(1000, {
  lastActiveFires: 1,
  fireBoundsActive: true,
  fireMinX: 0,
  fireMaxX: 0,
  fireMinY: 0,
  fireMaxY: 0,
  tileFire: new Float32Array([0.8]),
  tileFuel: new Float32Array([0.4]),
  tileHeat: new Float32Array([0.8]),
  tileTypeId: new Uint8Array([0]),
  fireSettings: { heatCap: 1 }
});
assert.equal(modelBurnState.burnQ[0], impostorBurnState.burnQ[0], "visible and hidden tree representations should receive matching burn progress");
assert.ok(impostorBurnState.burnQ[0] > 0, "a hidden impostor should still receive burn updates");
lodBuild.controller.dispose();
assert.equal(atlasTextureDisposed, false, "terrain LOD disposal must not destroy controller-owned atlas textures");
treeAtlas.dispose();
assert.equal(atlasTextureDisposed, true, "the atlas owner should dispose shared atlas textures on teardown");

const fullRoadGeometry = new THREE.PlaneGeometry(4, 4, 4, 4);
fullRoadGeometry.rotateX(-Math.PI / 2);
const tileTypes = new Uint8Array(16);
tileTypes[5] = 7;
const sparseRoadGeometry = buildSparseRoadOverlayGeometry(
  fullRoadGeometry,
  { cols: 4, rows: 4, tileTypes },
  7,
  8,
  0
);
assert.ok(sparseRoadGeometry, "a road-bearing sample should produce overlay geometry");
assert.ok(
  sparseRoadGeometry.getAttribute("position").count < fullRoadGeometry.toNonIndexed().getAttribute("position").count,
  "sparse road geometry should contain fewer vertices than the full terrain plane"
);
assert.equal(
  buildSparseRoadOverlayGeometry(fullRoadGeometry, { cols: 4, rows: 4, tileTypes: new Uint8Array(16) }, 7, 8),
  null,
  "a road-free sample should not create an overlay draw"
);

const authoritativeTileTypes = new Uint8Array(16);
authoritativeTileTypes[5] = 7;
authoritativeTileTypes[6] = 7;
const authoritativeRoadEdges = new Uint8Array(16);
assert.equal(
  buildSparseRoadOverlayGeometry(
    fullRoadGeometry,
    { cols: 4, rows: 4, tileTypes: authoritativeTileTypes, roadEdges: authoritativeRoadEdges },
    7,
    8,
    0
  ),
  null,
  "zero-edge ordinary road remnants should not allocate overlay geometry"
);
authoritativeRoadEdges[5] = ROAD_EDGE_E;
authoritativeRoadEdges[6] = ROAD_EDGE_W;
assert.ok(
  buildSparseRoadOverlayGeometry(
    fullRoadGeometry,
    { cols: 4, rows: 4, tileTypes: authoritativeTileTypes, roadEdges: authoritativeRoadEdges },
    7,
    8,
    0
  ),
  "authoritatively connected road tiles should remain renderable"
);
authoritativeTileTypes[6] = 0;
assert.equal(
  resolveAuthoritativeRoadEdgeMask(
    authoritativeRoadEdges,
    4,
    4,
    1,
    1,
    (x, y) => authoritativeTileTypes[y * 4 + x] === 7
  ),
  0,
  "authoritative masks should sanitize removed neighbors without reconstructing adjacency"
);
const baseOnlyTypes = new Uint8Array(16);
baseOnlyTypes[5] = 8;
assert.ok(
  buildSparseRoadOverlayGeometry(
    fullRoadGeometry,
    { cols: 4, rows: 4, tileTypes: baseOnlyTypes, roadEdges: new Uint8Array(16) },
    7,
    8,
    0
  ),
  "base tiles should remain in sparse road coverage without road edges"
);
const bridgeOnlyMask = new Uint8Array(16);
bridgeOnlyMask[5] = 1;
assert.ok(
  buildSparseRoadOverlayGeometry(
    fullRoadGeometry,
    {
      cols: 4,
      rows: 4,
      tileTypes: new Uint8Array(16),
      roadEdges: new Uint8Array(16),
      roadBridgeMask: bridgeOnlyMask
    },
    7,
    8,
    0
  ),
  "bridge tiles should remain in sparse road coverage without ordinary road edges"
);

const roadVisualTerrain = new THREE.Group();
const roadVisualRoot = new THREE.Group();
roadVisualRoot.userData[TERRAIN_ROAD_VISUAL_USER_DATA] = "overlay";
const originalRoadTexture = new THREE.Texture();
const texturedRoadMaterial = new THREE.MeshStandardMaterial({
  color: 0x778899,
  emissive: 0x010203,
  emissiveIntensity: 0.35,
  map: originalRoadTexture,
  toneMapped: true
});
const solidRoadMaterial = new THREE.MeshStandardMaterial({
  color: 0x334455,
  emissive: 0x040506,
  emissiveIntensity: 0.2,
  toneMapped: true
});
roadVisualRoot.add(
  new THREE.Mesh(new THREE.PlaneGeometry(1, 1), texturedRoadMaterial),
  new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), solidRoadMaterial)
);
roadVisualTerrain.add(roadVisualRoot);
assert.equal(setTerrainRoadHighContrast(roadVisualTerrain, true), 2, "road contrast should update every road material");
assert.equal(texturedRoadMaterial.color.getHex(), 0xffffff, "textured roads should preserve their texture color range");
assert.equal(texturedRoadMaterial.emissive.getHex(), ROAD_HIGH_CONTRAST_COLOR_HEX);
assert.equal(texturedRoadMaterial.emissiveMap, originalRoadTexture);
assert.equal(solidRoadMaterial.color.getHex(), ROAD_HIGH_CONTRAST_COLOR_HEX);
assert.equal(solidRoadMaterial.toneMapped, false);
assert.equal(setTerrainRoadHighContrast(roadVisualTerrain, false), 2, "road contrast should restore every road material");
assert.equal(texturedRoadMaterial.color.getHex(), 0x778899);
assert.equal(texturedRoadMaterial.emissive.getHex(), 0x010203);
assert.equal(texturedRoadMaterial.emissiveIntensity, 0.35);
assert.equal(texturedRoadMaterial.emissiveMap, null);
assert.equal(texturedRoadMaterial.toneMapped, true);
assert.equal(solidRoadMaterial.color.getHex(), 0x334455);
assert.equal(solidRoadMaterial.emissive.getHex(), 0x040506);
assert.equal(solidRoadMaterial.emissiveIntensity, 0.2);
const rebuiltRoadVisualRoot = new THREE.Group();
rebuiltRoadVisualRoot.userData[TERRAIN_ROAD_VISUAL_USER_DATA] = "deck";
const rebuiltRoadMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });
rebuiltRoadVisualRoot.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), rebuiltRoadMaterial));
roadVisualTerrain.clear();
roadVisualTerrain.add(rebuiltRoadVisualRoot);
assert.equal(
  setTerrainRoadHighContrast(roadVisualTerrain, true),
  1,
  "road contrast should apply to newly rebuilt road visuals"
);
assert.equal(rebuiltRoadMaterial.color.getHex(), ROAD_HIGH_CONTRAST_COLOR_HEX);

const shadowController = new TerrainShadowBlendController({
  mapSize: 2048,
  viewPadding: 1.08,
  heightPadding: 1.28,
  minExtent: 12,
  maxTerrainRatio: 0.45,
  extentEpsilon: 0.35,
  farEpsilon: 1,
  directionStepDeg: 0.65,
  blendDurationMs: 760,
  minimumSteadyHoldMs: 1200
});
const shadowInput = {
  timeMs: 0,
  sunDirection: new THREE.Vector3(0.6, 0.72, 0.34).normalize(),
  focusPoint: new THREE.Vector3(),
  cameraDistance: 30,
  cameraFovDeg: 45,
  cameraAspect: 16 / 9,
  terrainSize: { width: 256, depth: 256 },
  cameraInteracting: false
};
const initialShadowState = shadowController.update(shadowInput);
assert.equal(initialShadowState.blendActive, false);
assert.equal(initialShadowState.activeLightCount, 1, "steady-state lighting should expose one shadow light");
const blendingShadowState = shadowController.update({
  ...shadowInput,
  timeMs: 1200,
  sunDirection: new THREE.Vector3(-0.2, 0.9, 0.35).normalize()
});
assert.equal(blendingShadowState.blendActive, true);
assert.equal(blendingShadowState.activeLightCount, 2, "shadow transitions should retain both lights");
const completedShadowState = shadowController.update({
  ...shadowInput,
  timeMs: 2000,
  sunDirection: new THREE.Vector3(-0.2, 0.9, 0.35).normalize()
});
assert.equal(completedShadowState.blendActive, false);
assert.equal(completedShadowState.activeLightCount, 1, "completed transitions should return to one light");
const heldShadowState = shadowController.update({
  ...shadowInput,
  timeMs: 2010,
  sunDirection: new THREE.Vector3(-0.65, 0.7, -0.25).normalize()
});
assert.equal(heldShadowState.blendActive, false, "rapid sun changes should be coalesced during the one-light hold");
assert.equal(heldShadowState.activeLightCount, 1, "the hold should prevent continuous two-light rendering");
const coalescedShadowState = shadowController.update({
  ...shadowInput,
  timeMs: 3200,
  sunDirection: new THREE.Vector3(-0.65, 0.7, -0.25).normalize()
});
assert.equal(coalescedShadowState.blendActive, true, "the latest sun direction should blend after the hold");
assert.equal(coalescedShadowState.activeLightCount, 2);

const campaignOceanBackdrop = buildDistantOceanBackdropLayout({
  width: 256,
  depth: 256,
  sampleCols: 256,
  sampleRows: 256
});
assert.equal(DISTANT_OCEAN_SEGMENT_WORLD_SIZE, 220);
assert.equal(campaignOceanBackdrop.strips.length, 4, "the distant ocean should remain a four-strip backdrop");
assert.equal(campaignOceanBackdrop.triangleCount, 1_456, "the supported campaign backdrop must retain its coarse carrier budget");
assert.ok(
  campaignOceanBackdrop.triangleCount <= 2_000,
  `the 256x256 distant ocean must stay coarse (received ${campaignOceanBackdrop.triangleCount} triangles)`
);
campaignOceanBackdrop.strips.forEach((strip) => {
  assert.ok(strip.segmentsX >= 1 && strip.segmentsY >= 1, `${strip.edge} must retain valid geometry`);
  assert.ok(strip.width >= 256 || strip.depth >= 256, `${strip.edge} must cover the authored terrain edge`);
});

const oceanShaderSource = await readFile(
  fileURLToPath(new URL("../src/render/water/ocean/oceanSurfaceShader.ts", import.meta.url)),
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
const oceanContextSource = await readFile(
  fileURLToPath(new URL("../src/render/water/ocean/oceanSurfaceContext.ts", import.meta.url)),
  "utf8"
);
const seasonalSkyDomeSource = await readFile(
  fileURLToPath(new URL("../src/systems/climate/rendering/seasonalSkyDome.ts", import.meta.url)),
  "utf8"
);
const seasonalSkyStateSource = await readFile(
  fileURLToPath(new URL("../src/systems/climate/rendering/seasonalSkyState.ts", import.meta.url)),
  "utf8"
);
const seasonalCloudAdvectionSource = await readFile(
  fileURLToPath(new URL("../src/systems/climate/rendering/seasonalCloudAdvection.ts", import.meta.url)),
  "utf8"
);
const webglContextSource = await readFile(
  fileURLToPath(new URL("../src/render/webglContext.ts", import.meta.url)),
  "utf8"
);
const seasonalCloudVolumeSource = await readFile(
  fileURLToPath(new URL("../src/systems/climate/rendering/seasonalCloudVolume.ts", import.meta.url)),
  "utf8"
);
const seasonalCloudProfileSource = await readFile(
  fileURLToPath(new URL("../src/systems/climate/rendering/seasonalCloudProfile.ts", import.meta.url)),
  "utf8"
);
const threeTestSource = await readFile(
  fileURLToPath(new URL("../src/render/threeTest.ts", import.meta.url)),
  "utf8"
);
assert.equal((oceanShaderSource.match(/uniform sampler2D/g) ?? []).length, 11, "contextual surf must not add ocean texture samplers");
assert.match(oceanShaderSource, /return 8\.0;/, "fast water quality must retain eight broad wave iterations");
assert.match(oceanShaderSource, /breakerGate/, "fast water quality must retain the SDF breaker band");
assert.equal(MDXYZX_RAYMARCH_WAVE_ITERATIONS, 12);
assert.equal(MDXYZX_NORMAL_WAVE_ITERATIONS, 36);
assert.equal(MDXYZX_MAX_RAYMARCH_STEPS, 96);
assert.deepEqual(MDXYZX_QUALITY_PROFILES, {
  fast: { raymarchWaveIterations: 8, normalWaveIterations: 18, maxRaymarchSteps: 48 },
  balanced: { raymarchWaveIterations: 10, normalWaveIterations: 27, maxRaymarchSteps: 72 },
  high: { raymarchWaveIterations: 12, normalWaveIterations: 36, maxRaymarchSteps: 96 }
});
assert.equal(MDXYZX_MACRO_DOMAIN_SCALE, 0.22);
assert.equal(MDXYZX_MACRO_AMPLITUDE_SCALE, 1.8);
assert.equal(MDXYZX_MACRO_BLEND_FOOTPRINT_START, 0.28);
assert.equal(MDXYZX_MACRO_BLEND_FOOTPRINT_END, 1.35);
assert.equal(MDXYZX_MAX_FAR_NORMAL_CALM, 0.28);
assert.ok(1 - MDXYZX_MAX_FAR_NORMAL_CALM >= 0.7, "strategic ocean must retain bounded broad normal variance");
assert.match(
  mdXyzxWaveCoreSource,
  /length\(position\) \* 0\.1[\s\S]*position \+= direction \* wave\.y[\s\S]*frequency \*= 1\.18[\s\S]*timeMultiplier \*= 1\.07/,
  "production and reference oceans must share the actual MdXyzX dragged-wave sequence"
);
assert.match(
  mdXyzxProductionRaymarchSource,
  /mdXyzxFootprintIterationLimit[\s\S]*log\(1\.18\)[\s\S]*mdXyzxRaymarchWater[\s\S]*mdXyzxCalculateNormal/,
  "the production adapter must reconstruct a hit and filter the source octave progression by pixel footprint"
);
assert.match(
  mdXyzxProductionRaymarchSource,
  /mdXyzxCalculateMacroNormal[\s\S]*mdXyzxGetWaves[\s\S]*macroIterations[\s\S]*mix\(detailNormal, macroNormal, hit\.macroBlend\)/,
  "strategic ocean must replace filtered detail with a low-iteration slope from the same MdXyzX function"
);
assert.match(
  mdXyzxProductionRaymarchSource,
  /hit\.normalCalm =[\s\S]*smoothstep\(1\.35, 5\.5, pixelFootprint\)[\s\S]*MDXYZX_MAX_FAR_NORMAL_CALM/,
  "normal calming must be footprint-driven and bounded independently from wave filtering"
);
assert.doesNotMatch(
  mdXyzxProductionRaymarchSource,
  /distanceSmoothing|sqrt\(max\(0\.0, hitDistance\) \* 0\.01\)/,
  "camera distance must not force every strategic-ocean normal fully vertical"
);
assert.match(
  oceanShaderSource,
  /dFdx\(vWorldPos\.xz\)[\s\S]*pixelFootprint/,
  "the ocean raymarch limit must derive its footprint from fragment derivatives"
);
assert.match(
  oceanShaderSource,
  /openOceanRaymarchMix[\s\S]*raymarchMix[\s\S]*mdXyzxTraceProductionOcean[\s\S]*mix\(coastalN, raymarchedOceanN, resolvedRaymarchMix\)/,
  "authored coastal water must blend continuously into the raymarched open-ocean tier"
);
assert.match(
  oceanShaderSource,
  /u_oceanRaymarchDebugView[\s\S]*oceanHit\.height[\s\S]*oceanHit\.distance[\s\S]*oceanHit\.stepCount[\s\S]*raymarchMix/,
  "the ocean shader must expose controlled hit, work, normal, and coastal-blend debug views"
);
assert.match(
  oceanShaderSource,
  /horizonCalm[\s\S]*min\(fresnel, 0\.58\)[\s\S]*calmHorizonReflection[\s\S]*horizonCalm \* 0\.32[\s\S]*glitter \*= mix\(1\.0, 0\.38, horizonCalm\)[\s\S]*specular \*= mix\(1\.0, 0\.52, horizonCalm\)/,
  "horizon lighting must remain bounded without erasing broad reflection and highlight variation"
);
assert.doesNotMatch(
  oceanShaderSource,
  /horizonBoost = 1\.0 \/ max/,
  "ocean atmosphere must not use an unbounded reciprocal horizon highlight"
);
assert.match(
  oceanShaderSource,
  /raymarchOpenWater[\s\S]*animated \*= 1\.0 - max\(clamp\(u_backdropMix/,
  "distant and open-ocean carriers must not expose coarse vertex displacement"
);
assert.doesNotMatch(oceanShaderSource, /proceduralOceanSpectrum|sampleProceduralOceanWaveHeight/);
assert.doesNotMatch(oceanContextSource, /from ["']three["']|new THREE\.|Texture|Mesh|requestAnimationFrame/, "ocean context policy must remain allocation-light and renderer-independent");

assert.equal(SEASONAL_CLOUD_MARCH_STEPS, 20, "volumetric seasonal clouds must cap the primary march at 20 slices");
assert.equal(
  (seasonalSkyFragmentShader.match(/uniform sampler2D/g) ?? []).length,
  2,
  "seasonal clouds must use one weather texture and one packed volume atlas"
);
assert.match(
  seasonalSkyFragmentShader,
  /for \(int i = 0; i < 20; i\+\+\)/,
  "seasonal clouds must retain the fixed 20-slice march"
);
assert.match(
  seasonalSkyFragmentShader,
  /if \(transmittance < 0\.04\)/,
  "opaque cloud rays must terminate early"
);
assert.match(
  seasonalSkyFragmentShader,
  /vec3 lightProbe[\s\S]*float lightDensity/,
  "occupied cloud slices must retain one bounded sunward density probe"
);
assert.doesNotMatch(
  seasonalSkyFragmentShader,
  /lightProbeNear|lightProbeFar/,
  "seasonal clouds must not restore the previous dual-probe lighting cost"
);
assert.match(
  seasonalSkyFragmentShader,
  /rotatedHorizontal/,
  "cloud footprints must use a rotated broad-scale field instead of screen-aligned repetition"
);
assert.match(
  seasonalSkyFragmentShader,
  /footprint \* verticalProfile \* \(body - edgeErosion\)/,
  "true volume density must remain gated by coherent cloud footprints"
);
assert.match(
  seasonalSkyFragmentShader,
  /weatherPacked[\s\S]*if \(footprint <= 0\.001\)[\s\S]*sampleCloudVolume/,
  "clear weather samples must return before the packed volume atlas is read"
);
assert.doesNotMatch(
  seasonalSkyFragmentShader,
  /localTop01/,
  "cloud silhouettes must not return to a heightfield-derived local top"
);
assert.match(
  seasonalSkyFragmentShader,
  /sampleCloudVolume\(vec3 position\)[\s\S]*lowSlice[\s\S]*highSlice/,
  "cloud density must interpolate adjacent atlas slices as a true 3D field"
);
assert.match(
  seasonalSkyFragmentShader,
  /cloudBase \/ rayY/,
  "view rays must enter a bounded cloud slab instead of painting density onto the dome"
);
assert.match(
  seasonalSkyFragmentShader,
  /density \* stepLength/,
  "cloud extinction must scale with distance travelled through the volume"
);
assert.match(
  seasonalSkyFragmentShader,
  /uCloudTimeDays \* 0\.035/,
  "simulation-derived weather time must gently warp internal cloud detail"
);
assert.doesNotMatch(
  seasonalSkyFragmentShader,
  /height01 \* 1\.08[\s\S]{0,120}uCloudTimeDays/,
  "simulation time must not slide the cloud field through its vertical axis"
);
assert.doesNotMatch(
  seasonalSkyStateSource,
  /windDir[XY].*driftDays|driftDays.*windDir[XY]/,
  "instantaneous wind must not reproject all accumulated cloud travel"
);
assert.match(
  seasonalCloudAdvectionSource,
  /prevailingWindAngleRad[\s\S]*seasonalOffset/,
  "cloud travel must follow the stable seeded prevailing and seasonal climate track"
);
assert.doesNotMatch(
  seasonalCloudAdvectionSource,
  /new THREE\.|Vector2|new Map|new Array|requestAnimationFrame|performance\.now/,
  "cloud advection must remain a pure allocation-light climate calculation"
);
assert.match(
  webglContextSource,
  /pixelStorei\(context\.UNPACK_FLIP_Y_WEBGL, false\)/,
  "reused WebGL contexts must clear flip-Y before Three initializes 3D fallback textures"
);
assert.match(
  webglContextSource,
  /pixelStorei\(context\.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false\)/,
  "reused WebGL contexts must clear premultiplied alpha before Three initializes 3D fallback textures"
);
assert.equal(
  (seasonalSkyDomeSource.match(/new THREE\.DataTexture/g) ?? []).length,
  2,
  "each seasonal sky dome must own separate weather and volume textures"
);
assert.match(
  seasonalCloudVolumeSource,
  /SEASONAL_CLOUD_VOLUME_ATLAS_BORDER = 1/,
  "the volume atlas must pad every slice to prevent cross-slice filtering"
);
assert.match(
  seasonalCloudVolumeSource,
  /sampleTileableWorley3d[\s\S]*perlinWorley[\s\S]*roundedBillow/,
  "the packed volume must provide Perlin-Worley bodies and rounded cellular billows"
);
assert.match(
  seasonalSkyFragmentShader,
  /uCloudBaseHeight[\s\S]*uCloudCumulus[\s\S]*uCloudShadowStrength/,
  "the shader must consume the shared seasonal morphology profile"
);
assert.doesNotMatch(
  seasonalCloudProfileSource,
  /from ["'](?:\.\.\/)*ui\//,
  "cloud morphology policy must remain inside the climate rendering boundary"
);
assert.doesNotMatch(
  seasonalSkyDomeSource,
  /Data3DTexture|sampler3D/,
  "the cloud volume must preserve the WebGL-compatible 2D atlas path"
);
assert.match(
  threeTestSource,
  /includesShadowRefresh[\s\S]*submittedTriangles - lastColorPassTriangles/,
  "renderer diagnostics must separate estimated shadow submissions from stable color-pass triangles"
);
assert.doesNotMatch(
  seasonalSkyDomeSource,
  /requestAnimationFrame|performance\.now/,
  "the seasonal sky dome must not create a wall-clock animation path"
);
const seasonalSkySetStateSource = seasonalSkyDomeSource.match(
  /const setState = \(state: SeasonalSkyState\): void => \{[\s\S]*?\n  \};/
)?.[0] ?? "";
assert.ok(seasonalSkySetStateSource.length > 0, "the sky dome must retain an explicit state update boundary");
assert.doesNotMatch(
  seasonalSkySetStateSource,
  /new |\.clone\(|\[\.\.\./,
  "seasonal sky state updates must remain allocation-free"
);
const seasonalSkyDome = createSeasonalSkyDome();
assert.ok(seasonalSkyDome.mesh instanceof THREE.Mesh, "seasonal clouds must remain one sky-dome draw");
const seasonalSkyMaterial = seasonalSkyDome.mesh.material;
assert.ok(seasonalSkyMaterial instanceof THREE.ShaderMaterial);
assert.ok(
  seasonalSkyMaterial.uniforms.uCloudNoiseTex.value instanceof THREE.DataTexture &&
    seasonalSkyMaterial.uniforms.uCloudVolumeTex.value instanceof THREE.DataTexture,
  "the sky material must bind both deterministic cloud textures"
);
seasonalSkyDome.dispose();

console.log("3D renderer performance regression passed.");
