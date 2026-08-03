import * as THREE from "three";
import { TreeType } from "../../../../core/types.js";
import { finalizeInstancedMeshBounds, partitionTerrainInstances } from "../terrainRenderChunks.js";
import { createTreeImpostorMaterial } from "./treeImpostorMaterial.js";
import { disposeTreeImpostorMeshResources } from "./treeRenderResourceDisposal.js";
import type {
  TreeBurnMeshState,
  TreeImpostorAtlas,
  TreeImpostorInstance,
  TreeLodController,
  TreeLodMode,
  TreeLodStats,
  TreeSeasonVisualConfig
} from "./treeRenderTypes.js";

export const TREE_IMPOSTOR_ENTER_PX = 18;
export const TREE_IMPOSTOR_EXIT_PX = 24;

const TREE_TYPE_INDEX: Record<TreeType, number> = {
  [TreeType.Pine]: 0,
  [TreeType.Oak]: 1,
  [TreeType.Maple]: 2,
  [TreeType.Birch]: 3,
  [TreeType.Elm]: 4,
  [TreeType.Scrub]: 5
};

type TreeLodChunk = {
  key: string;
  fullMeshes: THREE.InstancedMesh[];
  impostorMesh: THREE.InstancedMesh;
  center: THREE.Vector3;
  maxTreeHeight: number;
  instanceCount: number;
  impostorActive: boolean;
};

export type TreeLodBuildResult = {
  controller: TreeLodController;
  burnStates: TreeBurnMeshState[];
};

const noise01 = (value: number): number => {
  const x = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

const setChunkRepresentation = (chunk: TreeLodChunk, impostorActive: boolean): boolean => {
  if (chunk.impostorActive === impostorActive) return false;
  chunk.impostorActive = impostorActive;
  chunk.impostorMesh.visible = impostorActive;
  chunk.fullMeshes.forEach((mesh) => {
    mesh.visible = !impostorActive;
  });
  return true;
};

const projectedHeightPx = (
  chunk: TreeLodChunk,
  camera: THREE.PerspectiveCamera,
  viewportHeightCssPx: number,
  viewCenter: THREE.Vector3
): number => {
  viewCenter.copy(chunk.center).applyMatrix4(camera.matrixWorldInverse);
  const depth = -viewCenter.z;
  if (depth <= camera.near) return Number.POSITIVE_INFINITY;
  const projectionScale = Math.max(1, viewportHeightCssPx) * 0.5 * camera.projectionMatrix.elements[5];
  return (chunk.maxTreeHeight * projectionScale) / depth;
};

export const buildTreeLod = (options: {
  root: THREE.Group;
  instances: readonly TreeImpostorInstance[];
  fullMeshesByChunk: ReadonlyMap<string, THREE.InstancedMesh[]>;
  atlas: TreeImpostorAtlas;
  seasonVisual?: TreeSeasonVisualConfig;
  tileFuel?: Float32Array;
  initialMode?: TreeLodMode;
}): TreeLodBuildResult | null => {
  if (options.instances.length === 0) return null;
  const chunks: TreeLodChunk[] = [];
  const burnStates: TreeBurnMeshState[] = [];
  const sharedMaterial = createTreeImpostorMaterial(options.atlas, options.seasonVisual);
  const dummy = new THREE.Object3D();
  const white = new THREE.Color(1, 1, 1);

  partitionTerrainInstances(options.instances, (instance) => ({ x: instance.tileX, y: instance.tileY })).forEach(({ key, instances }) => {
    const valid = instances.filter((instance) => options.atlas.getFrame(instance.treeType, instance.variantIndex));
    if (valid.length !== instances.length || valid.length === 0) return;
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.translate(0, 0.5, 0);
    const frameBase = new Float32Array(valid.length);
    const treeRotation = new Float32Array(valid.length);
    const treeType = new Float32Array(valid.length);
    const seasonPhaseOffset = new Float32Array(valid.length);
    const seasonRateJitter = new Float32Array(valid.length);
    const leafDropBias = new Float32Array(valid.length);
    const autumnHueBias = new Float32Array(valid.length);
    const tileIndices = new Uint32Array(valid.length);
    const tileX = new Uint16Array(valid.length);
    const tileY = new Uint16Array(valid.length);
    const baseX = new Float32Array(valid.length);
    const baseY = new Float32Array(valid.length);
    const baseZ = new Float32Array(valid.length);
    const baseRotation = new Float32Array(valid.length);
    const baseScale = new Float32Array(valid.length);
    const scalePivotY = new Float32Array(valid.length);
    const fuelReference = new Float32Array(valid.length);
    const center = new THREE.Vector3();
    let maxTreeHeight = 0;

    const mesh = new THREE.InstancedMesh(geometry, sharedMaterial, valid.length);
    mesh.name = `terrain-tree-impostor-${key}`;
    mesh.userData.terrainChunkKey = key;
    mesh.userData.treeImpostor = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    valid.forEach((instance, index) => {
      const frame = options.atlas.getFrame(instance.treeType, instance.variantIndex)!;
      const spanScale = frame.worldSpan * instance.scale;
      const impostorY = instance.y + frame.baseOffsetY * instance.scale;
      dummy.position.set(instance.x, impostorY, instance.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(spanScale, spanScale, spanScale);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      mesh.setColorAt(index, white);
      frameBase[index] = frame.baseFrame;
      treeRotation[index] = instance.rotation;
      treeType[index] = TREE_TYPE_INDEX[instance.treeType];
      const seed = instance.tileIndex * 17.17 + instance.variantIndex * 31.7 + TREE_TYPE_INDEX[instance.treeType] * 53.1;
      seasonPhaseOffset[index] = (noise01(seed) * 2 - 1) * (options.seasonVisual?.phaseShiftMax ?? 0);
      seasonRateJitter[index] = (noise01(seed + 1.37) * 2 - 1) * (options.seasonVisual?.rateJitter ?? 0);
      leafDropBias[index] = (noise01(seed + 2.91) * 2 - 1) * 0.22;
      autumnHueBias[index] = (noise01(seed + 4.13) * 2 - 1) * (options.seasonVisual?.autumnHueJitter ?? 0);
      tileIndices[index] = instance.tileIndex;
      tileX[index] = instance.tileX;
      tileY[index] = instance.tileY;
      baseX[index] = instance.x;
      baseY[index] = impostorY;
      baseZ[index] = instance.z;
      baseRotation[index] = 0;
      baseScale[index] = spanScale;
      scalePivotY[index] = instance.sourceHeight * instance.scale * 0.46;
      fuelReference[index] = Math.max(0.02, options.tileFuel?.[instance.tileIndex] ?? 1);
      center.x += instance.x;
      center.y += instance.y + instance.sourceHeight * instance.scale * 0.5;
      center.z += instance.z;
      maxTreeHeight = Math.max(maxTreeHeight, instance.sourceHeight * instance.scale);
    });
    geometry.setAttribute("aFrameBase", new THREE.InstancedBufferAttribute(frameBase, 1));
    geometry.setAttribute("aTreeRotation", new THREE.InstancedBufferAttribute(treeRotation, 1));
    geometry.setAttribute("aTreeType", new THREE.InstancedBufferAttribute(treeType, 1));
    geometry.setAttribute("aSeasonPhaseOffset", new THREE.InstancedBufferAttribute(seasonPhaseOffset, 1));
    geometry.setAttribute("aSeasonRateJitter", new THREE.InstancedBufferAttribute(seasonRateJitter, 1));
    geometry.setAttribute("aLeafDropBias", new THREE.InstancedBufferAttribute(leafDropBias, 1));
    geometry.setAttribute("aAutumnHueBias", new THREE.InstancedBufferAttribute(autumnHueBias, 1));
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor.needsUpdate = true;
    }
    finalizeInstancedMeshBounds(mesh);
    mesh.visible = false;
    options.root.add(mesh);
    center.multiplyScalar(1 / valid.length);
    chunks.push({
      key,
      fullMeshes: options.fullMeshesByChunk.get(key) ?? [],
      impostorMesh: mesh,
      center,
      maxTreeHeight: Math.max(0.1, maxTreeHeight),
      instanceCount: valid.length,
      impostorActive: false
    });
    burnStates.push({
      mesh,
      role: "mixed",
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
      burnProgress: new Float32Array(valid.length),
      burnQ: new Uint8Array(valid.length),
      visibilityQ: new Uint8Array(valid.length).fill(255),
      cropTopAttr: null,
      cropMinY: 0,
      cropMaxY: 1
    });
  });

  if (chunks.length === 0) {
    sharedMaterial.dispose();
    return null;
  }
  let mode: TreeLodMode = options.initialMode ?? "auto";
  let transitionCount = 0;
  const viewCenter = new THREE.Vector3();
  const viewProjection = new THREE.Matrix4();
  const frustum = new THREE.Frustum();
  const worldSphere = new THREE.Sphere();
  const lastCameraState = new Float64Array(33);
  let hasCameraState = false;
  let latestCamera: THREE.PerspectiveCamera | null = null;
  let latestViewportHeight = 1;
  let visibleImpostorDrawCount = 0;
  let disposed = false;
  const cameraStateChanged = (camera: THREE.PerspectiveCamera, viewportHeightCssPx: number): boolean => {
    camera.updateMatrixWorld();
    const world = camera.matrixWorld.elements;
    const projection = camera.projectionMatrix.elements;
    let changed = !hasCameraState || lastCameraState[32] !== viewportHeightCssPx;
    for (let index = 0; index < 16; index += 1) {
      if (lastCameraState[index] !== world[index] || lastCameraState[index + 16] !== projection[index]) {
        changed = true;
      }
      lastCameraState[index] = world[index];
      lastCameraState[index + 16] = projection[index];
    }
    lastCameraState[32] = viewportHeightCssPx;
    hasCameraState = true;
    return changed;
  };
  const applyMode = (camera?: THREE.PerspectiveCamera, viewportHeightCssPx = 1): boolean => {
    if (disposed) return false;
    if (camera && !cameraStateChanged(camera, viewportHeightCssPx)) return false;
    if (camera) {
      options.root.updateWorldMatrix(true, true);
      viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(viewProjection);
    }
    let changed = false;
    chunks.forEach((chunk) => {
      let useImpostor = chunk.impostorActive;
      if (mode === "models") useImpostor = false;
      else if (mode === "impostors") useImpostor = true;
      else if (camera) {
        const bounds = chunk.impostorMesh.boundingSphere;
        const chunkIntersectsView = !bounds || frustum.intersectsSphere(
          worldSphere.copy(bounds).applyMatrix4(chunk.impostorMesh.matrixWorld)
        );
        if (!chunkIntersectsView) {
          useImpostor = true;
        } else {
          const pixels = projectedHeightPx(chunk, camera, viewportHeightCssPx, viewCenter);
          useImpostor = chunk.impostorActive ? pixels < TREE_IMPOSTOR_EXIT_PX : pixels <= TREE_IMPOSTOR_ENTER_PX;
        }
      }
      if (setChunkRepresentation(chunk, useImpostor)) {
        changed = true;
        transitionCount += 1;
      }
    });
    if (camera) {
      visibleImpostorDrawCount = 0;
      chunks.forEach((chunk) => {
        if (!chunk.impostorActive || !chunk.impostorMesh.boundingSphere) return;
        worldSphere.copy(chunk.impostorMesh.boundingSphere).applyMatrix4(chunk.impostorMesh.matrixWorld);
        if (frustum.intersectsSphere(worldSphere)) visibleImpostorDrawCount += 1;
      });
    }
    return changed;
  };
  const getStats = (): TreeLodStats => {
    let modelChunks = 0;
    let impostorChunks = 0;
    let modelInstances = 0;
    let impostorInstances = 0;
    chunks.forEach((chunk) => {
      if (chunk.impostorActive) {
        impostorChunks += 1;
        impostorInstances += chunk.instanceCount;
      } else {
        modelChunks += 1;
        modelInstances += chunk.instanceCount;
      }
    });
    return {
      mode,
      totalChunks: chunks.length,
      modelChunks,
      impostorChunks,
      modelInstances,
      impostorInstances,
      transitionCount,
      impostorDrawCount: visibleImpostorDrawCount
    };
  };
  const controller: TreeLodController = {
    update: (camera, viewportHeightCssPx) => {
      latestCamera = camera;
      latestViewportHeight = viewportHeightCssPx;
      return applyMode(camera, viewportHeightCssPx);
    },
    setMode: (nextMode) => {
      if (mode === nextMode) return false;
      mode = nextMode;
      hasCameraState = false;
      return applyMode(latestCamera ?? undefined, latestViewportHeight);
    },
    getMode: () => mode,
    getStats,
    dispose: () => {
      disposed = true;
      chunks.forEach((chunk) => disposeTreeImpostorMeshResources(chunk.impostorMesh));
      chunks.length = 0;
    }
  };
  if (mode !== "auto") applyMode();
  return { controller, burnStates };
};
