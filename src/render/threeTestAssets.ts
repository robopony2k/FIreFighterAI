import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { TILE_COLOR_RGB } from "../core/config.js";
import { TreeType } from "../core/types.js";
import { registerPbrSpecularGlossiness } from "./gltfSpecGloss.js";

type RGB = { r: number; g: number; b: number };

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const mixRgb = (a: RGB, b: RGB, t: number): RGB => ({
  r: a.r + (b.r - a.r) * t,
  g: a.g + (b.g - a.g) * t,
  b: a.b + (b.b - a.b) * t
});
const lighten = (color: RGB, amount: number): RGB => mixRgb(color, { r: 255, g: 255, b: 255 }, clamp(amount, 0, 1));
const darken = (color: RGB, amount: number): RGB => mixRgb(color, { r: 0, g: 0, b: 0 }, clamp(amount, 0, 1));

export type TreeMeshTemplate = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  baseMatrix: THREE.Matrix4;
};

export type TreeVariant = {
  meshes: TreeMeshTemplate[];
  height: number;
  baseOffset: number;
};

export type TreeAssets = Record<TreeType, TreeVariant[]>;

export type HouseVariant = {
  meshes: TreeMeshTemplate[];
  height: number;
  baseOffset: number;
  size: THREE.Vector3;
  theme: "brick" | "wood";
  source: string;
  buildKey?: string | null;
};

export type HouseAssets = {
  variants: HouseVariant[];
};

export type FirestationAsset = {
  meshes: TreeMeshTemplate[];
  height: number;
  baseOffset: number;
  size: THREE.Vector3;
};

type SeasonPreset = {
  name: string;
  mix: number;
  tints: Record<TreeType, RGB>;
  leafPresence: Record<TreeType, number>;
};

const SEASON_PRESETS: SeasonPreset[] = [
  {
    name: "Spring",
    mix: 0.6,
    tints: {
      [TreeType.Pine]: { r: 46, g: 107, b: 74 },
      [TreeType.Oak]: { r: 111, g: 175, b: 92 },
      [TreeType.Maple]: { r: 106, g: 184, b: 94 },
      [TreeType.Birch]: { r: 139, g: 197, b: 106 },
      [TreeType.Elm]: { r: 107, g: 174, b: 102 },
      [TreeType.Scrub]: { r: 121, g: 168, b: 97 }
    },
    leafPresence: {
      [TreeType.Pine]: 1,
      [TreeType.Oak]: 1,
      [TreeType.Maple]: 1,
      [TreeType.Birch]: 1,
      [TreeType.Elm]: 1,
      [TreeType.Scrub]: 1
    }
  },
  {
    name: "Summer",
    mix: 0.6,
    tints: {
      [TreeType.Pine]: { r: 33, g: 90, b: 62 },
      [TreeType.Oak]: { r: 77, g: 139, b: 74 },
      [TreeType.Maple]: { r: 76, g: 147, b: 71 },
      [TreeType.Birch]: { r: 106, g: 169, b: 92 },
      [TreeType.Elm]: { r: 79, g: 143, b: 85 },
      [TreeType.Scrub]: { r: 92, g: 127, b: 75 }
    },
    leafPresence: {
      [TreeType.Pine]: 1,
      [TreeType.Oak]: 1,
      [TreeType.Maple]: 1,
      [TreeType.Birch]: 1,
      [TreeType.Elm]: 1,
      [TreeType.Scrub]: 1
    }
  },
  {
    name: "Autumn",
    mix: 0.65,
    tints: {
      [TreeType.Pine]: { r: 43, g: 90, b: 62 },
      [TreeType.Oak]: { r: 185, g: 130, b: 58 },
      [TreeType.Maple]: { r: 198, g: 74, b: 46 },
      [TreeType.Birch]: { r: 215, g: 176, b: 62 },
      [TreeType.Elm]: { r: 200, g: 160, b: 71 },
      [TreeType.Scrub]: { r: 154, g: 123, b: 60 }
    },
    leafPresence: {
      [TreeType.Pine]: 1,
      [TreeType.Oak]: 1,
      [TreeType.Maple]: 1,
      [TreeType.Birch]: 1,
      [TreeType.Elm]: 1,
      [TreeType.Scrub]: 0.9
    }
  },
  {
    name: "Winter",
    mix: 0.55,
    tints: {
      [TreeType.Pine]: { r: 31, g: 74, b: 55 },
      [TreeType.Oak]: { r: 120, g: 102, b: 78 },
      [TreeType.Maple]: { r: 118, g: 92, b: 78 },
      [TreeType.Birch]: { r: 136, g: 120, b: 86 },
      [TreeType.Elm]: { r: 122, g: 106, b: 80 },
      [TreeType.Scrub]: { r: 108, g: 106, b: 78 }
    },
    leafPresence: {
      [TreeType.Pine]: 1,
      [TreeType.Oak]: 0,
      [TreeType.Maple]: 0,
      [TreeType.Birch]: 0,
      [TreeType.Elm]: 0,
      [TreeType.Scrub]: 0.35
    }
  }
];

export const SEASON_COUNT = SEASON_PRESETS.length;

const isLeafName = (name?: string | null): boolean => {
  if (!name) {
    return false;
  }
  return /(leaf|leaves|foliage|canopy|needle|needles)/i.test(name);
};

const ensureTreeMaterialDefaults = (material: THREE.Material) => {
  const standard = material as THREE.MeshStandardMaterial;
  if (standard.userData.treeBaseColor === undefined && standard.color) {
    standard.userData.treeBaseColor = standard.color.clone();
  }
  if (standard.userData.treeBaseOpacity === undefined && typeof standard.opacity === "number") {
    standard.userData.treeBaseOpacity = standard.opacity;
  }
};

const applySeasonToMaterial = (
  material: THREE.Material,
  preset: SeasonPreset,
  treeType: TreeType,
  applyOpacity: boolean,
  forceTint: boolean
) => {
  const standard = material as THREE.MeshStandardMaterial;
  if (!standard.color) {
    return;
  }
  ensureTreeMaterialDefaults(standard);
  const baseColor = standard.userData.treeBaseColor as THREE.Color | undefined;
  const baseOpacity = standard.userData.treeBaseOpacity as number | undefined;
  if (!baseColor) {
    return;
  }
  const tint = preset.tints[treeType];
  const mix = preset.mix;
  const mixed = baseColor.clone();
  mixed.r = baseColor.r * (1 - mix) + (tint.r / 255) * mix;
  mixed.g = baseColor.g * (1 - mix) + (tint.g / 255) * mix;
  mixed.b = baseColor.b * (1 - mix) + (tint.b / 255) * mix;
  if (forceTint || standard.userData.treeLeafHint === true) {
    standard.color.copy(mixed);
  } else {
    standard.color.copy(baseColor);
  }
  if (applyOpacity && standard.userData.treeLeafHint === true && baseOpacity !== undefined) {
    const presence = preset.leafPresence[treeType] ?? 1;
    let nextOpacity = baseOpacity * presence;
    // Evergreen foliage should never disappear from seasonal opacity logic.
    // This also protects against asset edits that accidentally export pine leaf opacity near zero.
    if (treeType === TreeType.Pine) {
      nextOpacity = Math.max(baseOpacity, 0.99);
    }
    standard.opacity = clamp(nextOpacity, 0, 1);
    const usesAlphaCutout = (standard.alphaMap ?? null) !== null || standard.alphaTest > 0;
    if (!usesAlphaCutout && treeType === TreeType.Pine && standard.opacity >= 0.99) {
      standard.transparent = false;
    } else {
      standard.transparent = standard.opacity < 0.99 || standard.transparent;
    }
  } else if (baseOpacity !== undefined) {
    standard.opacity = baseOpacity;
  }
  standard.needsUpdate = true;
};

export const applySeasonToTreeAssets = (assets: TreeAssets, seasonIndex: number): void => {
  const preset = SEASON_PRESETS[Math.max(0, Math.min(SEASON_COUNT - 1, seasonIndex))];
  (Object.keys(assets) as TreeType[]).forEach((treeType) => {
    const variants = assets[treeType] ?? [];
    let hasLeafHint = false;
    variants.forEach((variant) => {
      variant.meshes.forEach((template) => {
        const materials = Array.isArray(template.material) ? template.material : [template.material];
        materials.forEach((material) => {
          if ((material as THREE.Material & { userData?: any }).userData?.treeLeafHint) {
            hasLeafHint = true;
          }
        });
      });
    });
    const forceTint = !hasLeafHint;
    variants.forEach((variant) => {
      variant.meshes.forEach((template) => {
        const materials = Array.isArray(template.material) ? template.material : [template.material];
        materials.forEach((material) => {
          applySeasonToMaterial(material, preset, treeType, true, forceTint);
        });
      });
    });
  });
};

export const TREE_MODEL_PATHS: Record<TreeType, string[]> = {
  [TreeType.Birch]: [
    "assets/3d/GLTF/Trees/Birch/Birch_001.glb",
    "assets/3d/GLTF/Trees/Birch/Birch_002.glb",
    "assets/3d/GLTF/Trees/Birch/Birch_003.glb"
  ],
  [TreeType.Maple]: [
    "assets/3d/GLTF/Trees/Maple/Maple_001.glb",
    "assets/3d/GLTF/Trees/Maple/Maple_002.glb",
    "assets/3d/GLTF/Trees/Maple/Maple_003.glb"
  ],
  [TreeType.Oak]: [
    "assets/3d/GLTF/Trees/Oak/Oak_001.glb",
    "assets/3d/GLTF/Trees/Oak/Oak_002.glb",
    "assets/3d/GLTF/Trees/Oak/Oak_003.glb"
  ],
  [TreeType.Pine]: [
    "assets/3d/GLTF/Trees/Pine/Pine_001.glb",
    "assets/3d/GLTF/Trees/Pine/Pine_002.glb",
    "assets/3d/GLTF/Trees/Pine/Pine_003.glb"
  ],
  [TreeType.Elm]: [
    "assets/3d/GLTF/Trees/Elm/Elm_001.glb"
  ],
  [TreeType.Scrub]: [
    "assets/3d/GLTF/Trees/Scrub/Scrub_001.glb",
    "assets/3d/GLTF/Trees/Scrub/Scrub_002.glb",
    "assets/3d/GLTF/Trees/Scrub/Scrub_003.glb"
  ]
};

const createGLTFLoader = (): GLTFLoader => registerPbrSpecularGlossiness(new GLTFLoader());

const HOUSE_MODEL_PATHS = [
  "assets/3d/GLTF/Houses/house_001.glb",
  "assets/3d/GLTF/Houses/house_002.glb",
  "assets/3d/GLTF/Houses/house_003.glb",
  "assets/3d/GLTF/Houses/house_004.glb",
  "assets/3d/GLTF/Houses/house_005.glb",
  "assets/3d/GLTF/Houses/house_006.glb",
  "assets/3d/GLTF/Houses/suburb_house__001.glb"
];
const FIRESTATION_MODEL_PATH = "assets/3d/GLTF/Firestation/Classic Fire Station.glb";

let treeAssetsCache: TreeAssets | null = null;
let treeAssetsPromise: Promise<TreeAssets> | null = null;
let houseAssetsCache: HouseAssets | null = null;
let houseAssetsPromise: Promise<HouseAssets> | null = null;
let firestationAssetCache: FirestationAsset | null = null;
let firestationAssetPromise: Promise<FirestationAsset | null> | null = null;

export const getTreeAssetsCache = (): TreeAssets | null => treeAssetsCache;
export const getHouseAssetsCache = (): HouseAssets | null => houseAssetsCache;
export const getFirestationAssetCache = (): FirestationAsset | null => firestationAssetCache;

const buildKeyPattern = /^Build_[^_]+/i;

const getBuildKey = (object: THREE.Object3D): string | null => {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current.name) {
      const match = current.name.match(buildKeyPattern);
      if (match) {
        return match[0];
      }
    }
    current = current.parent;
  }
  return null;
};

const loadTreeVariant = (loader: GLTFLoader, url: string): Promise<TreeVariant> =>
  new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        const scene = gltf.scene;
        scene.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(scene);
        const height = Math.max(0.01, bounds.max.y - bounds.min.y);
        const baseOffset = -bounds.min.y;
        const center = new THREE.Vector3();
        bounds.getCenter(center);
        const recenter = new THREE.Matrix4().makeTranslation(-center.x, baseOffset, -center.z);
        const meshes: TreeMeshTemplate[] = [];
        scene.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const geometry = child.geometry.clone();
            geometry.userData.treeAsset = true;
            const leafHint = isLeafName(child.name);
            const material = Array.isArray(child.material)
              ? child.material.map((mat) => {
                  const clone = mat.clone();
                  clone.userData.treeAsset = true;
                  if (leafHint || isLeafName(mat.name)) {
                    clone.userData.treeLeafHint = true;
                  }
                  return clone;
                })
              : (() => {
                  const clone = child.material.clone();
                  clone.userData.treeAsset = true;
                  if (leafHint || isLeafName(child.material.name)) {
                    clone.userData.treeLeafHint = true;
                  }
                  return clone;
                })();
            const baseMatrix = child.matrixWorld.clone();
            baseMatrix.premultiply(recenter);
            meshes.push({
              geometry,
              material,
              baseMatrix
            });
          }
        });
        resolve({ meshes, height, baseOffset: 0 });
      },
      undefined,
      (error) => reject(error)
    );
  });

export const loadTreeAssets = (): Promise<TreeAssets> => {
  if (treeAssetsCache) {
    return Promise.resolve(treeAssetsCache);
  }
  if (treeAssetsPromise) {
    return treeAssetsPromise;
  }
  const loader = createGLTFLoader();
  const entries = Object.entries(TREE_MODEL_PATHS) as [TreeType, string[]][];
  const loads = entries.map(([type, urls]) =>
    Promise.all(urls.map((url) => loadTreeVariant(loader, url))).then((models) => [type, models] as const)
  );
  treeAssetsPromise = Promise.all(loads).then((loaded) => {
    const assets = {} as TreeAssets;
    loaded.forEach(([type, models]) => {
      assets[type] = models;
    });
    treeAssetsCache = assets;
    return assets;
  });
  return treeAssetsPromise;
};

const cloneHouseMaterial = (material: THREE.Material): THREE.Material => {
  const mat = material.clone();
  mat.needsUpdate = true;
  return mat;
};

const buildVariantFromMeshes = (
  meshes: THREE.Mesh[],
  theme: "brick" | "wood",
  source: string,
  buildKey?: string | null
): HouseVariant | null => {
  if (meshes.length === 0) {
    return null;
  }
  const worldBounds = new THREE.Box3();
  let hasBounds = false;
  meshes.forEach((mesh) => {
    if (!mesh.geometry.boundingBox) {
      mesh.geometry.computeBoundingBox();
    }
    if (!mesh.geometry.boundingBox) {
      return;
    }
    const meshBounds = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
    if (!hasBounds) {
      worldBounds.copy(meshBounds);
      hasBounds = true;
    } else {
      worldBounds.union(meshBounds);
    }
  });
  if (!hasBounds) {
    return null;
  }
  const size = new THREE.Vector3();
  worldBounds.getSize(size);
  const center = new THREE.Vector3();
  worldBounds.getCenter(center);
  const rootInv = new THREE.Matrix4().makeTranslation(
    -center.x,
    -center.y,
    -center.z
  );
  const templates: TreeMeshTemplate[] = [];
  meshes.forEach((mesh) => {
    const geometry = mesh.geometry.clone();
    geometry.userData.houseAsset = true;
    const material = Array.isArray(mesh.material)
      ? mesh.material.map((mat) => {
          const clone = cloneHouseMaterial(mat);
          clone.userData.houseAsset = true;
          return clone;
        })
      : (() => {
          const clone = cloneHouseMaterial(mesh.material);
          clone.userData.houseAsset = true;
          return clone;
        })();
    const localMatrix = mesh.matrixWorld.clone().premultiply(rootInv);
    templates.push({
      geometry,
      material,
      baseMatrix: localMatrix
    });
  });
  const localBounds = worldBounds.clone().applyMatrix4(rootInv);
  const height = Math.max(0.01, size.y);
  const baseOffset = -localBounds.min.y;
  return { meshes: templates, height, baseOffset, size, theme, source, buildKey: buildKey ?? null };
};

const extractHouseVariantsByBuildKey = (
  scene: THREE.Object3D,
  theme: "brick" | "wood",
  source: string
): HouseVariant[] => {
  const groups = new Map<string, THREE.Mesh[]>();
  scene.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const key = getBuildKey(child);
      if (!key) {
        return;
      }
      const list = groups.get(key);
      if (list) {
        list.push(child);
      } else {
        groups.set(key, [child]);
      }
    }
  });
  if (groups.size === 0) {
    return [];
  }
  const variants: HouseVariant[] = [];
  groups.forEach((meshes, key) => {
    const variant = buildVariantFromMeshes(meshes, theme, source, key);
    if (variant) {
      variants.push(variant);
    }
  });
  return variants;
};

const extractHouseAssets = (scene: THREE.Object3D, theme: "brick" | "wood", source: string): HouseAssets => {
  const variants: HouseVariant[] = [];
  const byBuildKey = extractHouseVariantsByBuildKey(scene, theme, source);
  if (byBuildKey.length > 0) {
    variants.push(...byBuildKey);
  } else {
    const meshes: THREE.Mesh[] = [];
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        meshes.push(child);
      }
    });
    const variant = buildVariantFromMeshes(meshes, theme, source, null);
    if (variant) {
      variants.push(variant);
    }
  }
  return { variants };
};

export const loadHouseAssets = (): Promise<HouseAssets> => {
  if (houseAssetsCache) {
    return Promise.resolve(houseAssetsCache);
  }
  if (houseAssetsPromise) {
    return houseAssetsPromise;
  }
  const loader = createGLTFLoader();
  const loads = HOUSE_MODEL_PATHS.map((path) =>
    new Promise<HouseAssets>((resolve, reject) => {
      loader.load(
        path,
        (gltf) => {
          const isBrick = /brick/i.test(path);
          const theme: "brick" | "wood" = isBrick ? "brick" : "wood";
          resolve(extractHouseAssets(gltf.scene, theme, path));
        },
        undefined,
        (error) => reject(error)
      );
    })
  );
  houseAssetsPromise = Promise.all(loads).then((loaded) => {
    const variants: HouseVariant[] = [];
    loaded.forEach((asset) => {
      variants.push(...asset.variants);
    });
    const assets = { variants };
    houseAssetsCache = assets;
    return assets;
  });
  return houseAssetsPromise;
};

const extractFirestationAsset = (scene: THREE.Object3D): FirestationAsset | null => {
  scene.updateMatrixWorld(true);
  const meshes: TreeMeshTemplate[] = [];
  const rootInv = new THREE.Matrix4().copy(scene.matrixWorld).invert();
  scene.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const geometry = child.geometry.clone();
      geometry.userData.firestationAsset = true;
      const material = Array.isArray(child.material)
        ? child.material.map((mat) => {
            const clone = mat.clone();
            clone.userData.firestationAsset = true;
            return clone;
          })
        : (() => {
            const clone = child.material.clone();
            clone.userData.firestationAsset = true;
            return clone;
          })();
      const localMatrix = child.matrixWorld.clone().premultiply(rootInv);
      meshes.push({
        geometry,
        material,
        baseMatrix: localMatrix
      });
    }
  });
  if (meshes.length === 0) {
    return null;
  }
  const bounds = new THREE.Box3().setFromObject(scene);
  bounds.applyMatrix4(rootInv);
  const center = new THREE.Vector3();
  bounds.getCenter(center);
  const recenter = new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z);
  meshes.forEach((template) => {
    template.baseMatrix.premultiply(recenter);
  });
  const centeredBounds = bounds.clone().applyMatrix4(recenter);
  const size = new THREE.Vector3();
  centeredBounds.getSize(size);
  const height = Math.max(0.01, size.y);
  const baseOffset = -centeredBounds.min.y;
  return { meshes, height, baseOffset, size };
};

export const loadFirestationAsset = (): Promise<FirestationAsset | null> => {
  if (firestationAssetCache) {
    return Promise.resolve(firestationAssetCache);
  }
  if (firestationAssetPromise) {
    return firestationAssetPromise;
  }
  const loader = createGLTFLoader();
  firestationAssetPromise = new Promise<FirestationAsset | null>((resolve, reject) => {
    loader.load(
      FIRESTATION_MODEL_PATH,
      (gltf) => {
        const asset = extractFirestationAsset(gltf.scene);
        firestationAssetCache = asset;
        resolve(asset);
      },
      undefined,
      (error) => reject(error)
    );
  });
  return firestationAssetPromise;
};
