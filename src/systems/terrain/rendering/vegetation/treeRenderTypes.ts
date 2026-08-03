import type * as THREE from "three";
import type { TreeType } from "../../../../core/types.js";

export type TreeRenderMeshTemplate = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  impostorCaptureMaterial?: THREE.Material | THREE.Material[];
  baseMatrix: THREE.Matrix4;
};

export type TreeRenderVariant = {
  meshes: TreeRenderMeshTemplate[];
  height: number;
  baseOffset: number;
};

export type TreeRenderAssets = Record<TreeType, TreeRenderVariant[]>;

export type TreeSeasonVisualConfig = {
  enabled: boolean;
  uniforms: {
    uRisk01: { value: number };
    uSeasonT01: { value: number };
    uWorldSeed: { value: number };
  };
  phaseShiftMax: number;
  rateJitter: number;
  autumnHueJitter: number;
};

export type TreeImpostorFrame = {
  baseFrame: number;
  frameCount: number;
  worldSpan: number;
  baseOffsetY: number;
};

export type TreeImpostorAtlas = {
  colorTexture: THREE.Texture;
  roleTexture: THREE.Texture;
  atlasSize: number;
  gridSize: number;
  frameCount: number;
  getFrame: (treeType: TreeType, variantIndex: number) => TreeImpostorFrame | null;
  dispose: () => void;
};

export type TreeLodMode = "auto" | "models" | "impostors";

export type TreeLodStats = {
  mode: TreeLodMode;
  totalChunks: number;
  modelChunks: number;
  impostorChunks: number;
  modelInstances: number;
  impostorInstances: number;
  transitionCount: number;
  impostorDrawCount: number;
};

export type TreeLodController = {
  update: (camera: THREE.PerspectiveCamera, viewportHeightCssPx: number) => boolean;
  setMode: (mode: TreeLodMode) => boolean;
  getMode: () => TreeLodMode;
  getStats: () => TreeLodStats;
  dispose: () => void;
};

export type TreeImpostorInstance = {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotation: number;
  treeType: TreeType;
  variantIndex: number;
  tileIndex: number;
  tileX: number;
  tileY: number;
  sourceHeight: number;
};

export type TreeBurnMeshRole = "leaf" | "trunk" | "mixed";

export type TreeBurnMeshState = {
  mesh: THREE.InstancedMesh;
  role: TreeBurnMeshRole;
  baseMatrix: THREE.Matrix4;
  tileIndices: Uint32Array;
  tileX: Uint16Array;
  tileY: Uint16Array;
  baseX: Float32Array;
  baseY: Float32Array;
  baseZ: Float32Array;
  baseRotation: Float32Array;
  baseScale: Float32Array;
  scalePivotY: Float32Array;
  fuelReference: Float32Array;
  burnProgress: Float32Array;
  burnQ: Uint8Array;
  visibilityQ: Uint8Array;
  cropTopAttr: THREE.InstancedBufferAttribute | null;
  cropMinY: number;
  cropMaxY: number;
};
