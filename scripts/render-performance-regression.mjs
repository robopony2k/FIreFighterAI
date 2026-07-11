import assert from "node:assert/strict";
import * as THREE from "three";
import {
  TERRAIN_RENDER_CHUNK_TILE_SPAN,
  finalizeInstancedMeshBounds,
  partitionTerrainInstances
} from "../dist/systems/terrain/rendering/terrainRenderChunks.js";
import { buildSparseRoadOverlayGeometry } from "../dist/systems/terrain/rendering/sparseRoadOverlayGeometry.js";
import { TerrainShadowBlendController } from "../dist/systems/terrain/rendering/terrainShadowBlendController.js";

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
