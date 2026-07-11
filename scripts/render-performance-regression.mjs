import assert from "node:assert/strict";
import * as THREE from "three";
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

console.log("3D renderer performance regression passed.");
