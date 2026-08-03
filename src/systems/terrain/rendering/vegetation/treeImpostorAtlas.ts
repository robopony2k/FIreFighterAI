import * as THREE from "three";
import { TreeType } from "../../../../core/types.js";
import type {
  TreeImpostorAtlas,
  TreeImpostorFrame,
  TreeRenderAssets,
  TreeRenderMeshTemplate,
  TreeRenderVariant
} from "./treeRenderTypes.js";

export const TREE_IMPOSTOR_ATLAS_SIZE = 1024;
export const TREE_IMPOSTOR_ATLAS_GRID = 8;
export const TREE_IMPOSTOR_AZIMUTH_COUNT = 4;

const TREE_TYPE_ORDER: readonly TreeType[] = [
  TreeType.Pine,
  TreeType.Oak,
  TreeType.Maple,
  TreeType.Birch,
  TreeType.Elm,
  TreeType.Scrub
];

type CaptureEntry = {
  key: string;
  variant: TreeRenderVariant;
  frame: TreeImpostorFrame;
};

export type TreeImpostorFrameLayoutEntry = {
  treeType: TreeType;
  variantIndex: number;
  variant: TreeRenderVariant;
  frame: TreeImpostorFrame;
};

const getFrameKey = (treeType: TreeType, variantIndex: number): string => `${treeType}:${variantIndex}`;

export const buildTreeImpostorFrameLayout = (
  assets: TreeRenderAssets
): TreeImpostorFrameLayoutEntry[] => {
  let nextFrame = 0;
  const entries: TreeImpostorFrameLayoutEntry[] = [];
  TREE_TYPE_ORDER.forEach((treeType) => {
    (assets[treeType] ?? []).forEach((variant, variantIndex) => {
      const span = Math.max(0.5, variant.height * 1.12);
      entries.push({
        treeType,
        variantIndex,
        variant,
        frame: {
          baseFrame: nextFrame,
          frameCount: TREE_IMPOSTOR_AZIMUTH_COUNT,
          worldSpan: span,
          baseOffsetY: -(span - variant.height) * 0.5
        }
      });
      nextFrame += TREE_IMPOSTOR_AZIMUTH_COUNT;
    });
  });
  if (nextFrame > TREE_IMPOSTOR_ATLAS_GRID * TREE_IMPOSTOR_ATLAS_GRID) {
    throw new Error(`Tree impostor atlas needs ${nextFrame} frames but only ${TREE_IMPOSTOR_ATLAS_GRID ** 2} are available.`);
  }
  return entries;
};

const getTemplateRoleColor = (template: TreeRenderMeshTemplate): THREE.Color => {
  const materials = Array.isArray(template.material) ? template.material : [template.material];
  const leafCount = materials.filter((material) => material.userData?.treeLeafHint === true).length;
  if (leafCount >= materials.length && materials.length > 0) return new THREE.Color(0, 1, 0);
  if (leafCount > 0) return new THREE.Color(0, 0, 1);
  return materials.length <= 1 ? new THREE.Color(0, 0, 1) : new THREE.Color(1, 0, 0);
};

const createVariantScene = (
  variant: TreeRenderVariant,
  roleMask: boolean
): { scene: THREE.Scene; bounds: THREE.Box3; disposableMaterials: THREE.Material[] } => {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  const disposableMaterials: THREE.Material[] = [];
  variant.meshes.forEach((template) => {
    let material: THREE.Material | THREE.Material[] = template.impostorCaptureMaterial ?? template.material;
    if (roleMask) {
      const maskMaterial = new THREE.MeshBasicMaterial({
        color: getTemplateRoleColor(template),
        side: THREE.DoubleSide,
        toneMapped: false
      });
      disposableMaterials.push(maskMaterial);
      material = maskMaterial;
    }
    const mesh = new THREE.Mesh(template.geometry, material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(template.baseMatrix);
    root.add(mesh);
  });
  scene.add(root);
  if (!roleMask) {
    scene.add(new THREE.HemisphereLight(0xdbe9ff, 0x514638, 1.5));
    const key = new THREE.DirectionalLight(0xffebc9, 2.2);
    key.position.set(3, 5, 4);
    scene.add(key);
  }
  root.updateMatrixWorld(true);
  return { scene, bounds: new THREE.Box3().setFromObject(root), disposableMaterials };
};

const createAtlasTarget = (name: string, colorSpace: THREE.ColorSpace): THREE.WebGLRenderTarget => {
  const target = new THREE.WebGLRenderTarget(TREE_IMPOSTOR_ATLAS_SIZE, TREE_IMPOSTOR_ATLAS_SIZE, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: true,
    stencilBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false
  });
  target.texture.name = name;
  target.texture.colorSpace = colorSpace;
  target.texture.userData.treeImpostorSharedTexture = true;
  return target;
};

export const buildTreeImpostorAtlas = (
  renderer: THREE.WebGLRenderer,
  assets: TreeRenderAssets
): TreeImpostorAtlas => {
  const entries: CaptureEntry[] = [];
  const frameByKey = new Map<string, TreeImpostorFrame>();
  const layout = buildTreeImpostorFrameLayout(assets);
  layout.forEach(({ treeType, variantIndex, variant, frame }) => {
    const key = getFrameKey(treeType, variantIndex);
    entries.push({ key, variant, frame });
    frameByKey.set(key, frame);
  });
  const nextFrame = layout.reduce((count, entry) => count + entry.frame.frameCount, 0);

  const colorTarget = createAtlasTarget("tree-impostor-color", THREE.SRGBColorSpace);
  const roleTarget = createAtlasTarget("tree-impostor-role", THREE.NoColorSpace);
  const previousTarget = renderer.getRenderTarget();
  const previousCubeFace = renderer.getActiveCubeFace();
  const previousMipmapLevel = renderer.getActiveMipmapLevel();
  const previousViewport = renderer.getViewport(new THREE.Vector4());
  const previousScissor = renderer.getScissor(new THREE.Vector4());
  const previousScissorTest = renderer.getScissorTest();
  const previousAutoClear = renderer.autoClear;
  const previousXrEnabled = renderer.xr.enabled;
  const previousClearColor = renderer.getClearColor(new THREE.Color());
  const previousClearAlpha = renderer.getClearAlpha();
  const cellSize = TREE_IMPOSTOR_ATLAS_SIZE / TREE_IMPOSTOR_ATLAS_GRID;
  const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.01, 50);
  const targetPoint = new THREE.Vector3();

  const renderAtlas = (target: THREE.WebGLRenderTarget, roleMask: boolean): void => {
    renderer.setRenderTarget(target);
    renderer.setViewport(0, 0, TREE_IMPOSTOR_ATLAS_SIZE, TREE_IMPOSTOR_ATLAS_SIZE);
    renderer.setScissorTest(false);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.setScissorTest(true);
    entries.forEach((entry) => {
      const capture = createVariantScene(entry.variant, roleMask);
      const size = capture.bounds.getSize(new THREE.Vector3());
      const center = capture.bounds.getCenter(new THREE.Vector3());
      const span = Math.max(entry.frame.worldSpan, size.x * 1.12, size.z * 1.12);
      entry.frame.worldSpan = span;
      entry.frame.baseOffsetY = -(span - size.y) * 0.5;
      camera.left = -span * 0.5;
      camera.right = span * 0.5;
      camera.top = span * 0.5;
      camera.bottom = -span * 0.5;
      camera.updateProjectionMatrix();
      for (let view = 0; view < TREE_IMPOSTOR_AZIMUTH_COUNT; view += 1) {
        const frameIndex = entry.frame.baseFrame + view;
        const col = frameIndex % TREE_IMPOSTOR_ATLAS_GRID;
        const row = Math.floor(frameIndex / TREE_IMPOSTOR_ATLAS_GRID);
        const angle = view * Math.PI * 0.5;
        const distance = Math.max(4, span * 3);
        targetPoint.set(center.x, capture.bounds.min.y + size.y * 0.5, center.z);
        camera.position.set(
          targetPoint.x + Math.sin(angle) * distance,
          targetPoint.y + distance * 0.22,
          targetPoint.z + Math.cos(angle) * distance
        );
        camera.lookAt(targetPoint);
        camera.updateMatrixWorld(true);
        renderer.setViewport(col * cellSize, row * cellSize, cellSize, cellSize);
        renderer.setScissor(col * cellSize, row * cellSize, cellSize, cellSize);
        renderer.clear(true, true, true);
        renderer.render(capture.scene, camera);
      }
      capture.disposableMaterials.forEach((material) => material.dispose());
    });
  };

  try {
    renderer.autoClear = true;
    renderer.xr.enabled = false;
    renderAtlas(colorTarget, false);
    renderAtlas(roleTarget, true);
  } catch (error) {
    colorTarget.dispose();
    roleTarget.dispose();
    throw error;
  } finally {
    renderer.setRenderTarget(previousTarget, previousCubeFace, previousMipmapLevel);
    renderer.setViewport(previousViewport);
    renderer.setScissor(previousScissor);
    renderer.setScissorTest(previousScissorTest);
    renderer.setClearColor(previousClearColor, previousClearAlpha);
    renderer.autoClear = previousAutoClear;
    renderer.xr.enabled = previousXrEnabled;
  }

  return {
    colorTexture: colorTarget.texture,
    roleTexture: roleTarget.texture,
    atlasSize: TREE_IMPOSTOR_ATLAS_SIZE,
    gridSize: TREE_IMPOSTOR_ATLAS_GRID,
    frameCount: nextFrame,
    getFrame: (treeType, variantIndex) => frameByKey.get(getFrameKey(treeType, variantIndex)) ?? null,
    dispose: () => {
      colorTarget.dispose();
      roleTarget.dispose();
    }
  };
};
