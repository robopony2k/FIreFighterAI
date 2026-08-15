import * as THREE from "three";
import type { TreeType } from "../../../../core/types.js";
import {
  finalizeInstancedMeshBounds,
  partitionTerrainInstances
} from "../terrainRenderChunks.js";
import { vegetationHash2D } from "../../utils/vegetationSeedHash.js";
import type {
  TreeBurnMeshRole,
  TreeBurnMeshState,
  TreeImpostorInstance,
  TreeSeasonVisualConfig
} from "./treeRenderTypes.js";

const FALLBACK_FUEL_EPSILON = 0.02;
const FALLBACK_LEAF_DROP_BIAS_MAX = 0.22;
const TRUNK_PIVOT_FACTOR = 0.06;
const CANOPY_PIVOT_FACTOR = 0.72;

export type ForestCoverageFallbackPalette = Record<TreeType, { r: number; g: number; b: number }>;

export type ForestCoverageFallbackBuild = {
  root: THREE.Group;
  burnStates: TreeBurnMeshState[];
  instances: number;
  drawCalls: number;
};

export type ForestCoverageFallbackOptions = {
  instances: readonly TreeImpostorInstance[];
  canopyPalette: ForestCoverageFallbackPalette;
  tileFuel?: ArrayLike<number>;
  worldSeed: number;
  seasonVisual?: TreeSeasonVisualConfig | null;
  prepareTrunkMaterial?: (material: THREE.MeshStandardMaterial) => void;
  prepareCanopyMaterial?: (material: THREE.MeshStandardMaterial) => void;
};

const attachSeasonAttributes = (
  geometry: THREE.BufferGeometry,
  instances: readonly TreeImpostorInstance[],
  worldSeed: number,
  seasonVisual: TreeSeasonVisualConfig | null | undefined
): void => {
  if (!seasonVisual?.enabled) return;
  const phase = new Float32Array(instances.length);
  const leafDrop = new Float32Array(instances.length);
  const autumnHue = new Float32Array(instances.length);
  instances.forEach((instance, index) => {
    const n0 = vegetationHash2D(instance.tileX, instance.tileY, worldSeed + 42_101);
    const n2 = vegetationHash2D(instance.tileX, instance.tileY, worldSeed + 42_107);
    const n3 = vegetationHash2D(instance.tileX, instance.tileY, worldSeed + 42_109);
    phase[index] = (n0 * 2 - 1) * seasonVisual.phaseShiftMax;
    leafDrop[index] = (n2 * 2 - 1) * FALLBACK_LEAF_DROP_BIAS_MAX;
    autumnHue[index] = (n3 * 2 - 1) * seasonVisual.autumnHueJitter;
  });
  geometry.setAttribute("aSeasonPhaseOffset", new THREE.InstancedBufferAttribute(phase, 1));
  geometry.setAttribute("aLeafDropBias", new THREE.InstancedBufferAttribute(leafDrop, 1));
  geometry.setAttribute("aAutumnHueBias", new THREE.InstancedBufferAttribute(autumnHue, 1));
};

const buildBurnState = (
  mesh: THREE.InstancedMesh,
  role: TreeBurnMeshRole,
  instances: readonly TreeImpostorInstance[],
  tileFuel: ArrayLike<number> | undefined,
  cropTopAttr: THREE.InstancedBufferAttribute | null,
  cropMinY: number,
  cropMaxY: number
): TreeBurnMeshState => {
  const count = instances.length;
  const tileIndices = new Uint32Array(count);
  const tileX = new Uint16Array(count);
  const tileY = new Uint16Array(count);
  const baseX = new Float32Array(count);
  const baseY = new Float32Array(count);
  const baseZ = new Float32Array(count);
  const baseRotation = new Float32Array(count);
  const baseScale = new Float32Array(count);
  const scalePivotY = new Float32Array(count);
  const fuelReference = new Float32Array(count);
  const dummy = new THREE.Object3D();
  instances.forEach((instance, index) => {
    tileIndices[index] = instance.tileIndex;
    tileX[index] = instance.tileX;
    tileY[index] = instance.tileY;
    baseX[index] = instance.x;
    baseY[index] = instance.y;
    baseZ[index] = instance.z;
    baseRotation[index] = instance.rotation;
    baseScale[index] = instance.scale;
    scalePivotY[index] = instance.scale * (role === "leaf" ? CANOPY_PIVOT_FACTOR : TRUNK_PIVOT_FACTOR);
    fuelReference[index] = Math.max(FALLBACK_FUEL_EPSILON, tileFuel?.[instance.tileIndex] ?? 1);
    dummy.position.set(instance.x, instance.y, instance.z);
    dummy.rotation.set(0, instance.rotation, 0);
    dummy.scale.setScalar(instance.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return {
    mesh,
    role,
    baseMatrix: new THREE.Matrix4(),
    tileIndices,
    tileX,
    tileY,
    baseX,
    baseY,
    baseZ,
    baseRotation,
    baseScale,
    scalePivotY,
    fuelReference,
    burnProgress: new Float32Array(count),
    burnQ: new Uint8Array(count),
    visibilityQ: new Uint8Array(count).fill(255),
    cropTopAttr,
    cropMinY,
    cropMaxY
  };
};

export const buildForestCoverageFallbackRenderer = (
  options: ForestCoverageFallbackOptions
): ForestCoverageFallbackBuild => {
  const root = new THREE.Group();
  root.name = "terrain-forest-coverage-fallback-root";
  if (options.instances.length === 0) {
    return { root, burnStates: [], instances: 0, drawCalls: 0 };
  }

  const trunkTemplate = new THREE.CylinderGeometry(0.07, 0.09, 0.44, 5);
  trunkTemplate.translate(0, 0.22, 0);
  const canopyTemplate = new THREE.IcosahedronGeometry(0.27, 1);
  canopyTemplate.scale(1, 1.38, 1);
  canopyTemplate.translate(0, 0.69, 0);
  const trunkMaterial = new THREE.MeshStandardMaterial({
    color: 0x5f4330,
    roughness: 0.94,
    metalness: 0.02,
    vertexColors: true
  });
  const canopyMaterial = new THREE.MeshStandardMaterial({
    color: 0x4d8f4e,
    roughness: 0.92,
    metalness: 0,
    vertexColors: true
  });
  canopyMaterial.userData.treeLeafHint = true;
  options.prepareTrunkMaterial?.(trunkMaterial);
  options.prepareCanopyMaterial?.(canopyMaterial);

  const burnStates: TreeBurnMeshState[] = [];
  const white = new THREE.Color(1, 1, 1);
  const canopyColor = new THREE.Color();
  const chunks = partitionTerrainInstances(options.instances, (instance) => ({
    x: instance.tileX,
    y: instance.tileY
  }));
  chunks.forEach(({ key, instances }) => {
    const trunkGeometry = trunkTemplate.clone();
    const canopyGeometry = canopyTemplate.clone();
    attachSeasonAttributes(trunkGeometry, instances, options.worldSeed, options.seasonVisual);
    attachSeasonAttributes(canopyGeometry, instances, options.worldSeed, options.seasonVisual);
    trunkGeometry.computeBoundingBox();
    canopyGeometry.computeBoundingBox();
    const trunkBounds = trunkGeometry.boundingBox;
    const trunkCrop = new THREE.InstancedBufferAttribute(new Float32Array(instances.length), 1);
    trunkCrop.setUsage(THREE.DynamicDrawUsage);
    trunkCrop.array.fill((trunkBounds?.max.y ?? 1) + 1);
    trunkGeometry.setAttribute("aCropTop", trunkCrop);

    const trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, instances.length);
    const canopyMesh = new THREE.InstancedMesh(canopyGeometry, canopyMaterial, instances.length);
    trunkMesh.name = `terrain-forest-coverage-fallback-trunk-${key}`;
    canopyMesh.name = `terrain-forest-coverage-fallback-canopy-${key}`;
    trunkMesh.userData.terrainChunkKey = key;
    canopyMesh.userData.terrainChunkKey = key;
    trunkMesh.userData.terrainVegetationOwnsMaterial = true;
    canopyMesh.userData.terrainVegetationOwnsMaterial = true;
    trunkMesh.castShadow = false;
    canopyMesh.castShadow = false;
    trunkMesh.receiveShadow = true;
    canopyMesh.receiveShadow = true;
    instances.forEach((instance, index) => {
      trunkMesh.setColorAt(index, white);
      const tint = options.canopyPalette[instance.treeType];
      canopyColor.setRGB((tint?.r ?? 77) / 255, (tint?.g ?? 143) / 255, (tint?.b ?? 78) / 255);
      canopyMesh.setColorAt(index, canopyColor);
    });
    const trunkState = buildBurnState(
      trunkMesh,
      "trunk",
      instances,
      options.tileFuel,
      trunkCrop,
      trunkBounds?.min.y ?? 0,
      trunkBounds?.max.y ?? 1
    );
    const canopyBounds = canopyGeometry.boundingBox;
    const canopyState = buildBurnState(
      canopyMesh,
      "leaf",
      instances,
      options.tileFuel,
      null,
      canopyBounds?.min.y ?? 0,
      canopyBounds?.max.y ?? 1
    );
    if (trunkMesh.instanceColor) trunkMesh.instanceColor.needsUpdate = true;
    if (canopyMesh.instanceColor) canopyMesh.instanceColor.needsUpdate = true;
    finalizeInstancedMeshBounds(trunkMesh);
    finalizeInstancedMeshBounds(canopyMesh);
    root.add(trunkMesh, canopyMesh);
    burnStates.push(trunkState, canopyState);
  });
  trunkTemplate.dispose();
  canopyTemplate.dispose();
  return {
    root,
    burnStates,
    instances: options.instances.length,
    drawCalls: chunks.length * 2
  };
};
