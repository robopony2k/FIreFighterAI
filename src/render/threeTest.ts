import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HEIGHT_SCALE, TILE_COLOR_RGB, TILE_SIZE } from "../core/config.js";
import { TILE_ID_TO_TYPE, TILE_TYPE_IDS } from "../core/state.js";
import { registerPbrSpecularGlossiness } from "./gltfSpecGloss.js";

export type TerrainSample = {
  cols: number;
  rows: number;
  elevations: Float32Array;
  tileTypes?: Uint8Array;
  debugTypeColors?: boolean;
};

type TreeMeshTemplate = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  baseMatrix: THREE.Matrix4;
};

type TreeVariant = {
  meshes: TreeMeshTemplate[];
  height: number;
  baseOffset: number;
};

type TreeAssets = {
  forest: TreeVariant[];
  light: TreeVariant[];
};

type HouseVariant = {
  meshes: TreeMeshTemplate[];
  height: number;
  baseOffset: number;
  size: THREE.Vector3;
  theme: "brick" | "wood";
};

type HouseAssets = {
  variants: HouseVariant[];
};

type FirestationAsset = {
  meshes: TreeMeshTemplate[];
  height: number;
  baseOffset: number;
  size: THREE.Vector3;
};

type TreeInstance = {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotation: number;
  variantSet: "forest" | "light";
  variantIndex: number;
};

type HouseSpot = {
  x: number;
  y: number;
  z: number;
  footprint: number;
  rotation: number;
  seed: number;
  groundMin: number;
  groundMax: number;
};

export type ThreeTestController = {
  start: () => void;
  stop: () => void;
  resize: () => void;
  setTerrain: (sample: TerrainSample) => void;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const TERRAIN_HEIGHT_EXAGGERATION = 1.35;
const TERRAIN_HEIGHT_SCALE = (HEIGHT_SCALE / TILE_SIZE) * TERRAIN_HEIGHT_EXAGGERATION;
const HEIGHT_SAMPLE_PEAK_WEIGHT = 0.65;
const WATER_ALPHA_MIN_RATIO = 0.1;
const WATER_ALPHA_POWER = 0.85;
const TREE_SCALE_BASE = 0.75;
const TREE_SCALE_STEP_GAIN = 0.06;
const TREE_SCALE_STEP_CAP = 0.4;
const TREE_HEIGHT_FACTOR = 1.8;
const SUN_DIR = (() => {
  const x = 0.55;
  const y = 0.78;
  const z = 0.32;
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len };
})();

const TREE_MODEL_PATHS = {
  forest: [
    "assets/3d/GLTF/Green/Green_A.glb",
    "assets/3d/GLTF/Green/Green_B.glb",
    "assets/3d/GLTF/Green/Green_C.glb",
    "assets/3d/GLTF/Green/Green_D.glb",
    "assets/3d/GLTF/Green/Green_E.glb",
    "assets/3d/GLTF/Green/Green_F.glb",
    "assets/3d/GLTF/Green/Green_G.glb",
    "assets/3d/GLTF/Green/Green_H.glb",
    "assets/3d/GLTF/Green/Green_I.glb",
    "assets/3d/GLTF/Green/Green_J.glb"
  ],
  light: [
    "assets/3d/GLTF/Birch/Birch_A.glb",
    "assets/3d/GLTF/Birch/Birch_B.glb",
    "assets/3d/GLTF/Birch/Birch_C.glb",
    "assets/3d/GLTF/Birch/Birch_D.glb",
    "assets/3d/GLTF/Birch/Birch_E.glb",
    "assets/3d/GLTF/Birch/Birch_F.glb",
    "assets/3d/GLTF/Birch/Birch_G.glb",
    "assets/3d/GLTF/Birch/Birch_H.glb",
    "assets/3d/GLTF/Birch/Birch_I.glb",
    "assets/3d/GLTF/Birch/Birch_J.glb"
  ]
} as const;

const createGLTFLoader = (): GLTFLoader => registerPbrSpecularGlossiness(new GLTFLoader());

const HOUSE_MODEL_PATHS = [
  "assets/3d/GLTF/Houses/ModularBrickStructures.glb",
  "assets/3d/GLTF/Houses/ModularWoodenStructures.glb"
];
const FIRESTATION_MODEL_PATH = "assets/3d/GLTF/Firestation/Classic Fire Station.glb";

let treeAssetsCache: TreeAssets | null = null;
let treeAssetsPromise: Promise<TreeAssets> | null = null;
let houseAssetsCache: HouseAssets | null = null;
let houseAssetsPromise: Promise<HouseAssets> | null = null;
let firestationAssetCache: FirestationAsset | null = null;
let firestationAssetPromise: Promise<FirestationAsset | null> | null = null;

const buildPalette = (): number[][] =>
  TILE_ID_TO_TYPE.map((tileType) => {
    const rgb = TILE_COLOR_RGB[tileType];
    return [rgb.r / 255, rgb.g / 255, rgb.b / 255];
  });

const noiseAt = (value: number): number => {
  const s = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};

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

const pickHouseRotation = (
  tileX: number,
  tileY: number,
  cols: number,
  rows: number,
  tileTypes: Uint8Array,
  roadId: number,
  baseId: number,
  seed: number
): number => {
  const isRoadLike = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) {
      return false;
    }
    const typeId = tileTypes[y * cols + x];
    return typeId === roadId || typeId === baseId;
  };
  const roadEW = isRoadLike(tileX - 1, tileY) || isRoadLike(tileX + 1, tileY);
  const roadNS = isRoadLike(tileX, tileY - 1) || isRoadLike(tileX, tileY + 1);
  const flip = noiseAt(seed + 21.4) < 0.5 ? 0 : Math.PI;
  if (roadEW && !roadNS) {
    return flip;
  }
  if (roadNS && !roadEW) {
    return Math.PI / 2 + flip;
  }
  return noiseAt(seed + 9.1) < 0.5 ? 0 : Math.PI / 2;
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
        const meshes: TreeMeshTemplate[] = [];
        scene.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const geometry = child.geometry.clone();
            geometry.userData.treeAsset = true;
            const material = Array.isArray(child.material)
              ? child.material.map((mat) => {
                  const clone = mat.clone();
                  clone.userData.treeAsset = true;
                  return clone;
                })
              : (() => {
                  const clone = child.material.clone();
                  clone.userData.treeAsset = true;
                  return clone;
                })();
            meshes.push({
              geometry,
              material,
              baseMatrix: child.matrixWorld.clone()
            });
          }
        });
        resolve({ meshes, height, baseOffset });
      },
      undefined,
      (error) => reject(error)
    );
  });

const loadTreeAssets = (): Promise<TreeAssets> => {
  if (treeAssetsCache) {
    return Promise.resolve(treeAssetsCache);
  }
  if (treeAssetsPromise) {
    return treeAssetsPromise;
  }
  const loader = createGLTFLoader();
  const forest = TREE_MODEL_PATHS.forest.map((url) => loadTreeVariant(loader, url));
  const light = TREE_MODEL_PATHS.light.map((url) => loadTreeVariant(loader, url));
  treeAssetsPromise = Promise.all([Promise.all(forest), Promise.all(light)]).then(([forestModels, lightModels]) => {
    treeAssetsCache = {
      forest: forestModels,
      light: lightModels
    };
    return treeAssetsCache;
  });
  return treeAssetsPromise;
};

const cloneHouseMaterial = (material: THREE.Material): THREE.Material => {
  const mat = material.clone();
  mat.needsUpdate = true;
  return mat;
};

const buildVariantFromMeshes = (meshes: THREE.Mesh[], theme: "brick" | "wood"): HouseVariant | null => {
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
  const rootInv = new THREE.Matrix4().makeTranslation(
    -worldBounds.min.x,
    -worldBounds.min.y,
    -worldBounds.min.z
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
  const size = new THREE.Vector3();
  localBounds.getSize(size);
  const height = Math.max(0.01, size.y);
  const baseOffset = -localBounds.min.y;
  return { meshes: templates, height, baseOffset, size, theme };
};

const extractHouseVariantsByBuildKey = (scene: THREE.Object3D, theme: "brick" | "wood"): HouseVariant[] => {
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
  Array.from(groups.keys())
    .sort()
    .forEach((key) => {
      const meshes = groups.get(key);
      if (!meshes || meshes.length === 0) {
        return;
      }
      const variant = buildVariantFromMeshes(meshes, theme);
      if (variant) {
        variants.push(variant);
      }
    });
  return variants;
};

const extractHouseVariants = (scene: THREE.Object3D, theme: "brick" | "wood"): HouseVariant[] => {
  scene.updateMatrixWorld(true);
  const groupedVariants = extractHouseVariantsByBuildKey(scene, theme);
  if (groupedVariants.length > 0) {
    return groupedVariants;
  }
  const roots = scene.children.length > 0 ? scene.children : [scene];
  const candidates: {
    meshes: TreeMeshTemplate[];
    height: number;
    baseOffset: number;
    size: THREE.Vector3;
    footprint: number;
    meshCount: number;
    name: string;
  }[] = [];

  roots.forEach((root) => {
    const rootMatrix = root.matrixWorld.clone();
    const rootInv = rootMatrix.clone().invert();
    const meshes: TreeMeshTemplate[] = [];
    let firstMeshName = "";
    root.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (!firstMeshName && child.name) {
          firstMeshName = child.name;
        }
        const geometry = child.geometry.clone();
        geometry.userData.houseAsset = true;
        const material = Array.isArray(child.material)
          ? child.material.map((mat) => {
              const clone = cloneHouseMaterial(mat);
              clone.userData.houseAsset = true;
              return clone;
            })
          : (() => {
              const clone = cloneHouseMaterial(child.material);
              clone.userData.houseAsset = true;
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
      return;
    }
    const bounds = new THREE.Box3().setFromObject(root);
    bounds.applyMatrix4(rootInv);
    const size = new THREE.Vector3();
    bounds.getSize(size);
    const height = Math.max(0.01, size.y);
    const baseOffset = -bounds.min.y;
    const footprint = Math.max(0.0001, size.x * size.z);
    candidates.push({
      meshes,
      height,
      baseOffset,
      size,
      footprint,
      meshCount: meshes.length,
      name: (root.name || firstMeshName || "").toLowerCase()
    });
  });

  if (candidates.length === 0) {
    return [];
  }

  const includeName = /(house|building|structure|home|cottage|villa|cabin|hut)/i;
  const excludeName = /(wall|roof|door|window|chimney|pillar|beam|trim|stairs|floor|base|prop|fence|gate|balcony|frame)/i;
  const maxFootprint = Math.max(...candidates.map((candidate) => candidate.footprint));
  const maxHeight = Math.max(...candidates.map((candidate) => candidate.height));

  const filtered = candidates.filter((candidate) => {
    if (candidate.name && includeName.test(candidate.name)) {
      return true;
    }
    if (candidate.name && excludeName.test(candidate.name)) {
      return false;
    }
    const footprintRatio = maxFootprint > 0 ? candidate.footprint / maxFootprint : 0;
    const heightRatio = maxHeight > 0 ? candidate.height / maxHeight : 0;
    const meshEnough = candidate.meshCount >= 2;
    return (footprintRatio >= 0.35 && heightRatio >= 0.25 && meshEnough) || (footprintRatio >= 0.5 && meshEnough);
  });

  const picks = filtered.length > 0 ? filtered : candidates;
  return picks.map((candidate) => ({
    meshes: candidate.meshes,
    height: candidate.height,
    baseOffset: candidate.baseOffset,
    size: candidate.size,
    theme
  }));
};

const loadHouseAssets = (): Promise<HouseAssets> => {
  if (houseAssetsCache) {
    return Promise.resolve(houseAssetsCache);
  }
  if (houseAssetsPromise) {
    return houseAssetsPromise;
  }
  const loader = createGLTFLoader();
  const loads = HOUSE_MODEL_PATHS.map(
    (url) =>
      new Promise<HouseVariant[]>((resolve, reject) => {
        const theme = /brick/i.test(url) ? "brick" : "wood";
        loader.load(
          url,
          (gltf) => {
            const scenes =
              gltf.scenes && gltf.scenes.length > 0
                ? gltf.scenes
                : gltf.scene
                  ? [gltf.scene]
                  : [];
            const variants = scenes.flatMap((scene) => extractHouseVariants(scene, theme));
            resolve(variants);
          },
          undefined,
          (error) => reject(error)
        );
      })
  );
  houseAssetsPromise = Promise.all(loads).then((variantLists) => {
    const variants = variantLists.flat();
    houseAssetsCache = { variants };
    return houseAssetsCache;
  });
  return houseAssetsPromise;
};

const extractFirestationAsset = (scene: THREE.Object3D): FirestationAsset | null => {
  scene.updateMatrixWorld(true);
  const rootMatrix = scene.matrixWorld.clone();
  const rootInv = rootMatrix.clone().invert();
  const meshes: TreeMeshTemplate[] = [];
  scene.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const geometry = child.geometry.clone();
      geometry.userData.firestationAsset = true;
      const material = Array.isArray(child.material)
        ? child.material.map((mat) => {
            const clone = cloneHouseMaterial(mat);
            clone.userData.firestationAsset = true;
            return clone;
          })
        : (() => {
            const clone = cloneHouseMaterial(child.material);
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
  const size = new THREE.Vector3();
  bounds.getSize(size);
  const height = Math.max(0.01, size.y);
  const baseOffset = -bounds.min.y;
  return { meshes, height, baseOffset, size };
};

const loadFirestationAsset = (): Promise<FirestationAsset | null> => {
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

const buildSampleHeightMap = (
  sample: TerrainSample,
  sampleCols: number,
  sampleRows: number,
  step: number,
  waterId: number
): Float32Array => {
  const { cols, rows, elevations, tileTypes } = sample;
  const heights = new Float32Array(sampleCols * sampleRows);
  let offset = 0;
  for (let row = 0; row < sampleRows; row += 1) {
    const tileY = Math.min(rows - 1, row * step);
    for (let col = 0; col < sampleCols; col += 1) {
      const tileX = Math.min(cols - 1, col * step);
      const idx = tileY * cols + tileX;
      if (step <= 1) {
        heights[offset] = elevations[idx] ?? 0;
        offset += 1;
        continue;
      }
      const endX = Math.min(cols, tileX + step);
      const endY = Math.min(rows, tileY + step);
      let sum = 0;
      let count = 0;
      let maxHeight = 0;
      let waterCount = 0;
      let waterSum = 0;
      for (let y = tileY; y < endY; y += 1) {
        const rowBase = y * cols;
        for (let x = tileX; x < endX; x += 1) {
          const tileIdx = rowBase + x;
          const height = elevations[tileIdx] ?? 0;
          sum += height;
          count += 1;
          if (height > maxHeight) {
            maxHeight = height;
          }
          if (tileTypes && tileTypes[tileIdx] === waterId) {
            waterCount += 1;
            waterSum += height;
          }
        }
      }
      if (tileTypes && waterCount > count * 0.6) {
        heights[offset] = waterCount > 0 ? waterSum / waterCount : 0;
        offset += 1;
        continue;
      }
      const avg = count > 0 ? sum / count : 0;
      const blended = avg * (1 - HEIGHT_SAMPLE_PEAK_WEIGHT) + maxHeight * HEIGHT_SAMPLE_PEAK_WEIGHT;
      heights[offset] = clamp(blended, 0, 1);
      offset += 1;
    }
  }
  return heights;
};

const computeWaterLevel = (sample: TerrainSample, waterId: number): number | null => {
  const tileTypes = sample.tileTypes;
  if (!tileTypes) {
    return null;
  }
  const { elevations } = sample;
  const bins = 32;
  const counts = new Uint32Array(bins);
  const sums = new Float32Array(bins);
  let total = 0;
  for (let i = 0; i < elevations.length; i += 1) {
    if (tileTypes[i] !== waterId) {
      continue;
    }
    const height = clamp(elevations[i] ?? 0, 0, 1);
    const bin = Math.min(bins - 1, Math.floor(height * (bins - 1)));
    counts[bin] += 1;
    sums[bin] += height;
    total += 1;
  }
  if (total === 0) {
    return null;
  }
  if (total < 8) {
    const sum = sums.reduce((acc, value) => acc + value, 0);
    return sum / total;
  }
  const target = Math.max(1, Math.ceil(total * 0.25));
  let taken = 0;
  let sum = 0;
  let count = 0;
  for (let bin = bins - 1; bin >= 0; bin -= 1) {
    const binCount = counts[bin];
    if (binCount === 0) {
      continue;
    }
    const take = Math.min(binCount, target - taken);
    const avg = sums[bin] / binCount;
    sum += avg * take;
    count += take;
    taken += take;
    if (taken >= target) {
      break;
    }
  }
  return count > 0 ? sum / count : null;
};

const buildSampleTypeMap = (
  sample: TerrainSample,
  sampleCols: number,
  sampleRows: number,
  step: number,
  grassId: number,
  waterId: number,
  typeCount: number,
  priorityIds: number[]
): Uint8Array => {
  const { cols, rows, tileTypes } = sample;
  const types = new Uint8Array(sampleCols * sampleRows);
  const counts = new Uint16Array(typeCount);
  const priorityRank = new Int16Array(typeCount);
  priorityRank.fill(-1);
  priorityIds.forEach((id, index) => {
    if (id >= 0 && id < typeCount) {
      priorityRank[id] = index;
    }
  });
  let offset = 0;
  for (let row = 0; row < sampleRows; row += 1) {
    const tileY = Math.min(rows - 1, row * step);
    for (let col = 0; col < sampleCols; col += 1) {
      const tileX = Math.min(cols - 1, col * step);
      const endX = Math.min(cols, tileX + step);
      const endY = Math.min(rows, tileY + step);
      counts.fill(0);
      let maxType = grassId;
      let maxCount = 0;
      let waterCount = 0;
      let total = 0;
      let priorityType = -1;
      let priorityScore = Number.POSITIVE_INFINITY;
      for (let y = tileY; y < endY; y += 1) {
        const rowBase = y * cols;
        for (let x = tileX; x < endX; x += 1) {
          const idx = rowBase + x;
          const typeId = tileTypes ? tileTypes[idx] ?? grassId : grassId;
          const nextCount = (counts[typeId] += 1);
          if (nextCount > maxCount) {
            maxCount = nextCount;
            maxType = typeId;
          }
          const rank = priorityRank[typeId];
          if (rank >= 0 && rank < priorityScore) {
            priorityScore = rank;
            priorityType = typeId;
          }
          total += 1;
          if (typeId === waterId) {
            waterCount += 1;
          }
        }
      }
      if (total > 0 && waterCount === total) {
        types[offset] = waterId;
      } else if (priorityType >= 0) {
        types[offset] = priorityType;
      } else {
        types[offset] = maxType;
      }
      offset += 1;
    }
  }
  return types;
};

const buildWaterMaskTexture = (
  sample: TerrainSample,
  sampleCols: number,
  sampleRows: number,
  step: number,
  waterId: number
): THREE.DataTexture => {
  const { cols, rows, tileTypes } = sample;
  const data = new Uint8Array(sampleCols * sampleRows * 4);
  let offset = 0;
  for (let row = 0; row < sampleRows; row += 1) {
    const tileY = Math.min(rows - 1, row * step);
    for (let col = 0; col < sampleCols; col += 1) {
      const tileX = Math.min(cols - 1, col * step);
      const endX = Math.min(cols, tileX + step);
      const endY = Math.min(rows, tileY + step);
      let waterCount = 0;
      let total = 0;
      for (let y = tileY; y < endY; y += 1) {
        const rowBase = y * cols;
        for (let x = tileX; x < endX; x += 1) {
          const idx = rowBase + x;
          if (tileTypes && tileTypes[idx] === waterId) {
            waterCount += 1;
          }
          total += 1;
        }
      }
      const ratio = total > 0 ? waterCount / total : 0;
      const ramp = clamp((ratio - WATER_ALPHA_MIN_RATIO) / (1 - WATER_ALPHA_MIN_RATIO), 0, 1);
      const alpha = Math.round(Math.pow(ramp, WATER_ALPHA_POWER) * 255);
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = alpha;
      offset += 4;
    }
  }
  const texture = new THREE.DataTexture(data, sampleCols, sampleRows, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = true;
  texture.generateMipmaps = false;
  return texture;
};

const buildTileTexture = (
  sample: TerrainSample,
  sampleCols: number,
  sampleRows: number,
  step: number,
  palette: number[][],
  grassId: number,
  beachId: number,
  forestId: number,
  waterId: number,
  heightScale: number,
  sampleHeights: Float32Array,
  sampleTypes: Uint8Array,
  debugTypeColors: boolean
): THREE.DataTexture => {
  const { cols, rows } = sample;
  const data = new Uint8Array(sampleCols * sampleRows * 4);
  const heightAtSample = (x: number, y: number): number => {
    const clampedX = Math.max(0, Math.min(sampleCols - 1, x));
    const clampedY = Math.max(0, Math.min(sampleRows - 1, y));
    return sampleHeights[clampedY * sampleCols + clampedX] ?? 0;
  };
  let offset = 0;
  for (let row = 0; row < sampleRows; row += 1) {
    const tileY = Math.min(rows - 1, row * step);
    for (let col = 0; col < sampleCols; col += 1) {
      const tileX = Math.min(cols - 1, col * step);
      const idx = tileY * cols + tileX;
      const sampleIndex = row * sampleCols + col;
      const typeId = sampleTypes[sampleIndex] ?? grassId;
      let colorType = typeId;
      if (!debugTypeColors) {
        if (typeId === forestId) {
          colorType = grassId;
        } else if (typeId === waterId) {
          const hasLandNeighbor =
            row === 0 ||
            col === 0 ||
            row === sampleRows - 1 ||
            col === sampleCols - 1 ||
            sampleTypes[sampleIndex - 1] !== waterId ||
            sampleTypes[sampleIndex + 1] !== waterId ||
            sampleTypes[sampleIndex - sampleCols] !== waterId ||
            sampleTypes[sampleIndex + sampleCols] !== waterId;
          colorType = hasLandNeighbor ? beachId : waterId;
        }
      }
      const color = palette[colorType] ?? palette[grassId];
      const height = heightAtSample(col, row);
      const baseNoise = noiseAt(idx + 1);
      const fineNoise = (noiseAt(idx * 3.7 + 17.7) - 0.5) * 0.04;
      const heightTone = clamp(0.88 + height * 0.08, 0.72, 1.05);
      const noise = (baseNoise - 0.5) * 0.08;
      const heightLeft = heightAtSample(col - 1, row);
      const heightRight = heightAtSample(col + 1, row);
      const heightUp = heightAtSample(col, row - 1);
      const heightDown = heightAtSample(col, row + 1);
      const dx = (heightRight - heightLeft) * heightScale;
      const dz = (heightDown - heightUp) * heightScale;
      const nx = -dx;
      const ny = 2;
      const nz = -dz;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      const light =
        (nx / nLen) * SUN_DIR.x + (ny / nLen) * SUN_DIR.y + (nz / nLen) * SUN_DIR.z;
      const shade = clamp(0.68 + light * 0.32, 0.55, 1);
      const slope = Math.sqrt(dx * dx + dz * dz);
      const occlusion = clamp(1 - slope * 0.06, 0.7, 1);
      const tone = heightTone * shade * occlusion;
      const rawR = color[0];
      const rawG = color[1];
      const rawB = color[2];
      const r = clamp((debugTypeColors ? rawR : (rawR + noise) * tone + fineNoise), 0, 1) * 255;
      const g = clamp((debugTypeColors ? rawG : (rawG + noise) * tone + fineNoise), 0, 1) * 255;
      const b = clamp((debugTypeColors ? rawB : (rawB + noise) * tone + fineNoise), 0, 1) * 255;
      data[offset] = Math.round(r);
      data[offset + 1] = Math.round(g);
      data[offset + 2] = Math.round(b);
      data[offset + 3] = 255;
      offset += 4;
    }
  }
  const texture = new THREE.DataTexture(data, sampleCols, sampleRows, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = true;
  texture.generateMipmaps = false;
  return texture;
};

const buildTerrainMesh = (
  sample: TerrainSample,
  treeAssets: TreeAssets | null,
  houseAssets: HouseAssets | null,
  firestationAsset: FirestationAsset | null
): {
  mesh: THREE.Mesh;
  size: { width: number; depth: number };
  water?: {
    mask: THREE.DataTexture;
    level: number;
    sampleCols: number;
    sampleRows: number;
    width: number;
    depth: number;
  };
} => {
  const { cols, rows, elevations } = sample;
  const palette = buildPalette();
  const grassId = TILE_TYPE_IDS.grass;
  const scrubId = TILE_TYPE_IDS.scrub;
  const floodplainId = TILE_TYPE_IDS.floodplain;
  const forestId = TILE_TYPE_IDS.forest;
  const waterId = TILE_TYPE_IDS.water;
  const baseId = TILE_TYPE_IDS.base;
  const houseId = TILE_TYPE_IDS.house;
  const roadId = TILE_TYPE_IDS.road;
  const firebreakId = TILE_TYPE_IDS.firebreak;
  const maxDim = Math.max(cols, rows);
  const step = Math.max(1, Math.floor(maxDim / 256));
  const sampleCols = Math.floor((cols - 1) / step) + 1;
  const sampleRows = Math.floor((rows - 1) / step) + 1;
  const width = (sampleCols - 1) * step;
  const depth = (sampleRows - 1) * step;
  const sampleHeights = buildSampleHeightMap(sample, sampleCols, sampleRows, step, waterId);
  const waterLevel = computeWaterLevel(sample, waterId);
  const sampleTypes = buildSampleTypeMap(
    sample,
    sampleCols,
    sampleRows,
    step,
    grassId,
    waterId,
    TILE_ID_TO_TYPE.length,
    [baseId, houseId, roadId, firebreakId]
  );
  if (waterLevel !== null) {
    for (let i = 0; i < sampleHeights.length; i += 1) {
      if (sampleTypes[i] === waterId) {
        sampleHeights[i] = waterLevel;
      }
    }
  }
  const heightAtSample = (x: number, y: number): number => {
    const clampedX = Math.max(0, Math.min(sampleCols - 1, x));
    const clampedY = Math.max(0, Math.min(sampleRows - 1, y));
    return sampleHeights[clampedY * sampleCols + clampedX] ?? 0;
  };
  const heightAtTileCoord = (tileX: number, tileY: number): number => {
    const sx = clamp(tileX / step, 0, sampleCols - 1);
    const sy = clamp(tileY / step, 0, sampleRows - 1);
    const x0 = Math.floor(sx);
    const y0 = Math.floor(sy);
    const x1 = Math.min(sampleCols - 1, x0 + 1);
    const y1 = Math.min(sampleRows - 1, y0 + 1);
    const tx = sx - x0;
    const ty = sy - y0;
    const h00 = heightAtSample(x0, y0);
    const h10 = heightAtSample(x1, y0);
    const h01 = heightAtSample(x0, y1);
    const h11 = heightAtSample(x1, y1);
    const hx0 = h00 * (1 - tx) + h10 * tx;
    const hx1 = h01 * (1 - tx) + h11 * tx;
    return hx0 * (1 - ty) + hx1 * ty;
  };
  const heightAtTile = (tileX: number, tileY: number): number => {
    return heightAtTileCoord(tileX + 0.5, tileY + 0.5);
  };

  const geometry = new THREE.PlaneGeometry(width, depth, sampleCols - 1, sampleRows - 1);
  geometry.rotateX(-Math.PI / 2);

  const positions = geometry.attributes.position;
  const heightScale = TERRAIN_HEIGHT_SCALE;
  let minHeight = Number.POSITIVE_INFINITY;
  let maxHeight = Number.NEGATIVE_INFINITY;
  let waterHeightSum = 0;
  let waterCount = 0;
  let vertexIndex = 0;
  const treeInstances: TreeInstance[] = [];
  const hasTreeAssets = !!treeAssets && (treeAssets.forest.length > 0 || treeAssets.light.length > 0);
  for (let row = 0; row < sampleRows; row += 1) {
    const tileY = Math.min(rows - 1, row * step);
    for (let col = 0; col < sampleCols; col += 1) {
      const tileX = Math.min(cols - 1, col * step);
      const idx = tileY * cols + tileX;
      const height = sampleHeights[vertexIndex] ?? 0;
      const clampedHeight = clamp(height, -1, 1);
      const y = clampedHeight * heightScale;
      positions.setY(vertexIndex, y);
      minHeight = Math.min(minHeight, y);
      maxHeight = Math.max(maxHeight, y);
      const typeId = sampleTypes[vertexIndex] ?? grassId;
      if (typeId === waterId) {
        waterHeightSum += y;
        waterCount += 1;
      }
      const densityScale = Math.min(1.5, 1 + Math.max(0, step - 1) * 0.2);
      let treeChance = 0;
      if (typeId === forestId) {
        treeChance = 0.85 * densityScale;
      } else if (typeId === scrubId) {
        treeChance = 0.18 * densityScale;
      } else if (typeId === floodplainId) {
        treeChance = 0.12 * densityScale;
      } else if (typeId === grassId) {
        treeChance = 0.08 * densityScale;
      }
      if (hasTreeAssets && treeChance > 0 && noiseAt(idx + 5.1) < treeChance) {
        const baseScale = TREE_SCALE_BASE + Math.min(TREE_SCALE_STEP_CAP, Math.max(0, step - 1) * TREE_SCALE_STEP_GAIN);
        const jitterX = (noiseAt(idx + 0.27) - 0.5) * 0.6 * step;
        const jitterZ = (noiseAt(idx + 0.61) - 0.5) * 0.6 * step;
        const typeScale = typeId === forestId ? 1 : typeId === scrubId ? 0.75 : 0.6;
        const preferredSet = typeId === forestId ? "forest" : "light";
        const primary = preferredSet === "forest" ? treeAssets!.forest : treeAssets!.light;
        const fallback = preferredSet === "forest" ? treeAssets!.light : treeAssets!.forest;
        const variants = primary.length > 0 ? primary : fallback;
        const variantSet = primary.length > 0 ? preferredSet : preferredSet === "forest" ? "light" : "forest";
        if (variants.length > 0) {
          const variantIndex = Math.floor(noiseAt(idx + 9.7) * variants.length);
          const variant = variants[variantIndex] ?? variants[0];
          const targetHeight = baseScale * typeScale * TREE_HEIGHT_FACTOR;
          const scale = (targetHeight / variant.height) * (0.85 + noiseAt(idx + 7.9) * 0.3);
          const rotation = noiseAt(idx + 3.3) * Math.PI * 2;
          const x = (col / Math.max(1, sampleCols - 1) - 0.5) * width + jitterX;
          const z = (row / Math.max(1, sampleRows - 1) - 0.5) * depth + jitterZ;
          const treeY = y + variant.baseOffset * scale;
          treeInstances.push({ x, y: treeY, z, scale, rotation, variantSet, variantIndex });
        }
      }
      vertexIndex += 1;
    }
  }
  geometry.computeVertexNormals();

  const tileTexture = buildTileTexture(
    sample,
    sampleCols,
    sampleRows,
    step,
    palette,
    grassId,
    TILE_TYPE_IDS.beach,
    forestId,
    waterId,
    heightScale,
    sampleHeights,
    sampleTypes,
    sample.debugTypeColors ?? false
  );
  const material = new THREE.MeshStandardMaterial({
    map: tileTexture,
    roughness: 0.88,
    metalness: 0
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  if (treeAssets && treeInstances.length > 0) {
    const treeGroup = new THREE.Group();
    const dummy = new THREE.Object3D();
    const tempMatrix = new THREE.Matrix4();
    const addVariantInstances = (variantSet: "forest" | "light", variants: TreeVariant[]) => {
      const instances = treeInstances.filter((instance) => instance.variantSet === variantSet);
      if (instances.length === 0 || variants.length === 0) {
        return;
      }
      const buckets = variants.map(() => [] as TreeInstance[]);
      instances.forEach((instance) => {
        const index = Math.min(variants.length - 1, Math.max(0, instance.variantIndex));
        buckets[index].push(instance);
      });
      variants.forEach((variant, variantIndex) => {
        const variantInstances = buckets[variantIndex];
        if (variantInstances.length === 0) {
          return;
        }
        variant.meshes.forEach((meshTemplate) => {
          const instanced = new THREE.InstancedMesh(
            meshTemplate.geometry,
            meshTemplate.material,
            variantInstances.length
          );
          instanced.castShadow = true;
          const baseMatrix = meshTemplate.baseMatrix;
          variantInstances.forEach((instance, i) => {
            dummy.position.set(instance.x, instance.y, instance.z);
            dummy.rotation.set(0, instance.rotation, 0);
            dummy.scale.set(instance.scale, instance.scale, instance.scale);
            dummy.updateMatrix();
            tempMatrix.copy(dummy.matrix).multiply(baseMatrix);
            instanced.setMatrixAt(i, tempMatrix);
          });
          instanced.instanceMatrix.needsUpdate = true;
          treeGroup.add(instanced);
        });
      });
    };
    addVariantInstances("forest", treeAssets.forest);
    addVariantInstances("light", treeAssets.light);
    mesh.add(treeGroup);
  }
  if (sample.tileTypes) {
    const tileTypes = sample.tileTypes;
    const baseTiles: { tileX: number; tileY: number; x: number; z: number; groundMin: number; groundMax: number }[] = [];
    const houseSpots: HouseSpot[] = [];
    for (let tileY = 0; tileY < rows; tileY += 1) {
      const rowBase = tileY * cols;
      for (let tileX = 0; tileX < cols; tileX += 1) {
        const typeId = tileTypes[rowBase + tileX];
        if (typeId !== baseId && typeId !== houseId) {
          continue;
        }
        const normX = (tileX + 0.5) / cols;
        const normZ = (tileY + 0.5) / rows;
        const x = (normX - 0.5) * width;
        const z = (normZ - 0.5) * depth;
        const height = heightAtTile(tileX, tileY) * heightScale;
        const right = Math.min(cols, tileX + 1);
        const bottom = Math.min(rows, tileY + 1);
        const h00 = heightAtTileCoord(tileX, tileY) * heightScale;
        const h10 = heightAtTileCoord(right, tileY) * heightScale;
        const h01 = heightAtTileCoord(tileX, bottom) * heightScale;
        const h11 = heightAtTileCoord(right, bottom) * heightScale;
        const groundMin = Math.min(h00, h10, h01, h11);
        const groundMax = Math.max(h00, h10, h01, h11);
        const jitter = noiseAt(rowBase + tileX + 13.7);
        if (typeId === baseId) {
          baseTiles.push({ tileX, tileY, x, z, groundMin, groundMax });
        } else {
          const footprint = 0.62 + jitter * 0.2;
          const seed = rowBase + tileX;
          const rotation = pickHouseRotation(tileX, tileY, cols, rows, tileTypes, roadId, baseId, seed);
          houseSpots.push({
            x,
            y: height,
            z,
            footprint,
            rotation,
            seed,
            groundMin,
            groundMax
          });
        }
      }
    }
    const buildingGeometry = new THREE.BoxGeometry(1, 1, 1);
    const baseMaterial = new THREE.MeshStandardMaterial({ color: 0xa0a7ad, roughness: 0.75, metalness: 0.1 });
    const houseMaterial = new THREE.MeshStandardMaterial({ color: 0xc19a66, roughness: 0.8, metalness: 0.08 });
    const foundationMaterial = new THREE.MeshStandardMaterial({
      color: 0x4b4036,
      roughness: 0.95,
      metalness: 0
    });
    const dummy = new THREE.Object3D();
    if (baseTiles.length > 0) {
      const minTileX = Math.min(...baseTiles.map((tile) => tile.tileX));
      const maxTileX = Math.max(...baseTiles.map((tile) => tile.tileX));
      const minTileY = Math.min(...baseTiles.map((tile) => tile.tileY));
      const maxTileY = Math.max(...baseTiles.map((tile) => tile.tileY));
      const centerTileX = (minTileX + maxTileX) / 2 + 0.5;
      const centerTileY = (minTileY + maxTileY) / 2 + 0.5;
      const centerX = (centerTileX / cols - 0.5) * width;
      const centerZ = (centerTileY / rows - 0.5) * depth;
      const baseFootprintX = Math.max(1, maxTileX - minTileX + 1);
      const baseFootprintZ = Math.max(1, maxTileY - minTileY + 1);
      const groundMin = Math.min(...baseTiles.map((tile) => tile.groundMin));
      const groundMax = Math.max(...baseTiles.map((tile) => tile.groundMax));
      const rotation = baseFootprintX >= baseFootprintZ ? 0 : Math.PI / 2;

      if (firestationAsset && firestationAsset.meshes.length > 0) {
        const footprintTarget = Math.max(baseFootprintX, baseFootprintZ) * 0.85;
        const assetFootprint = Math.max(firestationAsset.size.x, firestationAsset.size.z);
        const scale = footprintTarget / Math.max(0.01, assetFootprint);
        const foundationTop = groundMax + 0.01;
        const baseY = foundationTop + firestationAsset.baseOffset * scale;
        const baseGroup = new THREE.Group();
        const tempMatrix = new THREE.Matrix4();
        firestationAsset.meshes.forEach((meshTemplate) => {
          const instanced = new THREE.InstancedMesh(meshTemplate.geometry, meshTemplate.material, 1);
          instanced.castShadow = true;
          instanced.receiveShadow = true;
          dummy.position.set(centerX, baseY, centerZ);
          dummy.rotation.set(0, rotation, 0);
          dummy.scale.set(scale, scale, scale);
          dummy.updateMatrix();
          tempMatrix.copy(dummy.matrix).multiply(meshTemplate.baseMatrix);
          instanced.setMatrixAt(0, tempMatrix);
          instanced.instanceMatrix.needsUpdate = true;
          baseGroup.add(instanced);
        });
        mesh.add(baseGroup);
      } else {
        const baseMesh = new THREE.InstancedMesh(buildingGeometry, baseMaterial, baseTiles.length);
        baseMesh.castShadow = true;
        baseMesh.receiveShadow = true;
        baseTiles.forEach((tile, i) => {
          const blockHeight = 0.65 + noiseAt(tile.tileY * cols + tile.tileX + 6.2) * 0.25;
          dummy.position.set(tile.x, tile.groundMax + blockHeight * 0.5 + 0.01, tile.z);
          dummy.scale.set(0.9, blockHeight, 0.9);
          dummy.updateMatrix();
          baseMesh.setMatrixAt(i, dummy.matrix);
        });
        baseMesh.instanceMatrix.needsUpdate = true;
        mesh.add(baseMesh);
      }

      const baseFoundation = new THREE.InstancedMesh(buildingGeometry, foundationMaterial, 1);
      const foundationTop = groundMax + 0.01;
      const foundationBottom = groundMin - 0.01;
      const foundationHeight = Math.max(0.02, foundationTop - foundationBottom);
      dummy.position.set(centerX, (foundationTop + foundationBottom) * 0.5, centerZ);
      dummy.rotation.set(0, rotation, 0);
      dummy.scale.set(baseFootprintX * 1.05, foundationHeight, baseFootprintZ * 1.05);
      dummy.updateMatrix();
      baseFoundation.setMatrixAt(0, dummy.matrix);
      baseFoundation.instanceMatrix.needsUpdate = true;
      mesh.add(baseFoundation);
    }
    if (houseSpots.length > 0) {
      if (houseAssets && houseAssets.variants.length > 0) {
        const variants = houseAssets.variants;
        const buckets = variants.map(() => [] as HouseSpot[]);
        houseSpots.forEach((spot) => {
          const index = Math.floor(noiseAt(spot.seed + 6.1) * variants.length);
          buckets[Math.min(variants.length - 1, Math.max(0, index))].push(spot);
        });
        const houseGroup = new THREE.Group();
        const foundationGroup = new THREE.Group();
        const tempMatrix = new THREE.Matrix4();
        const tileScale = 1 / TILE_SIZE;
        variants.forEach((variant, index) => {
          const variantSpots = buckets[index];
          if (variantSpots.length === 0) {
            return;
          }
          const footprintX = Math.max(0.01, variant.size.x) * tileScale;
          const footprintZ = Math.max(0.01, variant.size.z) * tileScale;
          variant.meshes.forEach((meshTemplate) => {
            const instanced = new THREE.InstancedMesh(
              meshTemplate.geometry,
              meshTemplate.material,
              variantSpots.length
            );
            instanced.castShadow = true;
            instanced.receiveShadow = true;
            variantSpots.forEach((spot, i) => {
              const foundationTop = spot.groundMax + 0.01;
              const y = foundationTop + variant.baseOffset * tileScale;
              dummy.position.set(spot.x, y, spot.z);
              dummy.rotation.set(0, spot.rotation, 0);
              dummy.scale.set(tileScale, tileScale, tileScale);
              dummy.updateMatrix();
              tempMatrix.copy(dummy.matrix).multiply(meshTemplate.baseMatrix);
              instanced.setMatrixAt(i, tempMatrix);
            });
            instanced.instanceMatrix.needsUpdate = true;
            houseGroup.add(instanced);
          });
          const foundationMesh = new THREE.InstancedMesh(buildingGeometry, foundationMaterial, variantSpots.length);
          foundationMesh.castShadow = true;
          foundationMesh.receiveShadow = true;
          variantSpots.forEach((spot, i) => {
            const foundationTop = spot.groundMax + 0.01;
            const foundationBottom = spot.groundMin - 0.01;
            const height = Math.max(0.015, foundationTop - foundationBottom);
            const y = (foundationTop + foundationBottom) * 0.5;
            dummy.position.set(spot.x, y, spot.z);
            dummy.rotation.set(0, spot.rotation, 0);
            dummy.scale.set(footprintX * 1.05, height, footprintZ * 1.05);
            dummy.updateMatrix();
            foundationMesh.setMatrixAt(i, dummy.matrix);
          });
          foundationMesh.instanceMatrix.needsUpdate = true;
          foundationGroup.add(foundationMesh);
        });
        mesh.add(houseGroup);
        mesh.add(foundationGroup);
      } else {
        const houseMesh = new THREE.InstancedMesh(buildingGeometry, houseMaterial, houseSpots.length);
        houseMesh.castShadow = true;
        houseMesh.receiveShadow = true;
        houseSpots.forEach((spot, i) => {
          const blockHeight = 0.45 + noiseAt(spot.seed + 4.6) * 0.3;
          const foundationTop = spot.groundMax + 0.01;
          dummy.position.set(spot.x, foundationTop + blockHeight * 0.5, spot.z);
          dummy.scale.set(spot.footprint, blockHeight, spot.footprint);
          dummy.updateMatrix();
          houseMesh.setMatrixAt(i, dummy.matrix);
        });
        houseMesh.instanceMatrix.needsUpdate = true;
        mesh.add(houseMesh);
        const foundationMesh = new THREE.InstancedMesh(buildingGeometry, foundationMaterial, houseSpots.length);
        foundationMesh.castShadow = true;
        foundationMesh.receiveShadow = true;
        houseSpots.forEach((spot, i) => {
          const foundationTop = spot.groundMax + 0.01;
          const foundationBottom = spot.groundMin - 0.01;
          const height = Math.max(0.015, foundationTop - foundationBottom);
          const y = (foundationTop + foundationBottom) * 0.5;
          const scale = spot.footprint * 1.05;
          dummy.position.set(spot.x, y, spot.z);
          dummy.rotation.set(0, spot.rotation, 0);
          dummy.scale.set(scale, height, scale);
          dummy.updateMatrix();
          foundationMesh.setMatrixAt(i, dummy.matrix);
        });
        foundationMesh.instanceMatrix.needsUpdate = true;
        mesh.add(foundationMesh);
      }
    }
  }
  mesh.position.y = -0.75 + (minHeight + maxHeight) * -0.15;
  const hasWater = waterLevel !== null || waterCount > 0;
  const waterPlaneLevel = waterLevel !== null ? waterLevel * heightScale : waterCount > 0 ? waterHeightSum / waterCount : 0;
  const water =
    hasWater
      ? {
          mask: buildWaterMaskTexture(sample, sampleCols, sampleRows, step, waterId),
          level: waterPlaneLevel,
          sampleCols,
          sampleRows,
          width,
          depth
        }
      : undefined;
  return { mesh, size: { width, depth }, water };
};

type WaterUniforms = {
  u_time: { value: number };
  u_mask: { value: THREE.Texture };
  u_color: { value: THREE.Color };
  u_deepColor: { value: THREE.Color };
  u_opacity: { value: number };
  u_waveScale: { value: number };
  u_normalMap1?: { value: THREE.Texture };
  u_normalMap2?: { value: THREE.Texture };
  u_scroll1?: { value: THREE.Vector2 };
  u_scroll2?: { value: THREE.Vector2 };
  u_normalScale?: { value: number };
  u_normalStrength?: { value: number };
  u_shininess?: { value: number };
  u_lightDir: { value: THREE.Vector3 };
  u_specular: { value: number };
};

type WaterCapUniforms = {
  u_mask: { value: THREE.Texture };
  u_color: { value: THREE.Color };
  u_opacity: { value: number };
};

export const createThreeTest = (canvas: HTMLCanvasElement): ThreeTestController => {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio ?? 1, 2));
  renderer.setClearColor(0x0c0d11, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const horizonColor = 0xffdab9;
  const zenithColor = 0x87ceeb;
  const gradientCanvas = document.createElement("canvas");
  gradientCanvas.width = 2;
  gradientCanvas.height = 256;
  const context = gradientCanvas.getContext("2d")!;
  const gradient = context.createLinearGradient(0, 0, 0, gradientCanvas.height);
  gradient.addColorStop(0, new THREE.Color(zenithColor).getStyle());
  gradient.addColorStop(0.45, new THREE.Color(zenithColor).getStyle());
  gradient.addColorStop(0.55, new THREE.Color(horizonColor).getStyle());
  gradient.addColorStop(1, new THREE.Color(horizonColor).getStyle());
  context.fillStyle = gradient;
  context.fillRect(0, 0, gradientCanvas.width, gradientCanvas.height);
  const texture = new THREE.CanvasTexture(gradientCanvas);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  scene.background = texture;

  // Fog disabled: removed because it caused whiteout/edge artefacts.

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(2.6, 2.2, 3.4);
  camera.lookAt(0, 0, 0);

  const hemisphere = new THREE.HemisphereLight(zenithColor, 0x4d433b, 0.65);
  scene.add(hemisphere);
  const ambient = new THREE.AmbientLight(0xffffff, 0.25);
  scene.add(ambient);
  const keyLight = new THREE.DirectionalLight(0xffe6c2, 0.95);
  keyLight.position.set(4, 5, 2);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.width = 1024;
  keyLight.shadow.mapSize.height = 1024;
  keyLight.shadow.bias = -0.00035;
  keyLight.shadow.normalBias = 0.02;
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0x88a9c9, 0.35);
  fillLight.position.set(-4, 2.5, -2);
  scene.add(fillLight);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.minDistance = 3;
  controls.maxDistance = 120;
  controls.target.set(0, 0, 0);

  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xd34b2a, roughness: 0.55, metalness: 0.2 })
  );
  cube.castShadow = true;
  scene.add(cube);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 6),
    new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.9;
  ground.receiveShadow = true;
  scene.add(ground);

  let terrainMesh: THREE.Mesh | null = null;
  let waterMesh: THREE.Mesh | null = null;
  let waterCapMesh: THREE.Mesh | null = null;
  let waterUniforms: WaterUniforms | null = null;
  let waterCapUniforms: WaterCapUniforms | null = null;
  let waterMask: THREE.Texture | null = null;
  let treeAssets: TreeAssets | null = treeAssetsCache;
  let houseAssets: HouseAssets | null = houseAssetsCache;
  let firestationAsset: FirestationAsset | null = firestationAssetCache;
  let lastSample: TerrainSample | null = null;

  let raf = 0;
  let running = false;

  const resize = (): void => {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  const renderFrame = (time: number): void => {
    if (!running) {
      return;
    }
    cube.rotation.y = time * 0.0006;
    cube.rotation.x = time * 0.00035;
    if (waterUniforms) {
      waterUniforms.u_time.value = time * 0.001;
    }
    controls.update();
    renderer.render(scene, camera);
    raf = window.requestAnimationFrame(renderFrame);
  };

  const start = (): void => {
    if (running) {
      return;
    }
    running = true;
    controls.enabled = true;
    resize();
    raf = window.requestAnimationFrame(renderFrame);
  };

  const stop = (): void => {
    running = false;
    controls.enabled = false;
    if (raf) {
      window.cancelAnimationFrame(raf);
    }
  };

  const updateCameraForSize = (size: number): void => {
    const distance = Math.max(8, size * 0.6);
    camera.near = 0.1;
    camera.far = Math.max(200, distance * 6);
    // Fog disabled: keep camera frustum and lighting adjustments only.
    camera.position.set(distance * 0.65, distance * 0.55, distance * 0.65);
    controls.minDistance = Math.max(3, distance * 0.15);
    controls.maxDistance = Math.max(120, distance * 4);
    controls.target.set(0, 0, 0);
    keyLight.position.set(distance * 0.45, distance * 0.85, distance * 0.35);
    if (waterUniforms) {
      waterUniforms.u_lightDir.value.copy(keyLight.position).normalize();
    }
    const shadowCam = keyLight.shadow.camera as THREE.OrthographicCamera;
    const shadowExtent = Math.max(10, size * 0.7);
    shadowCam.left = -shadowExtent;
    shadowCam.right = shadowExtent;
    shadowCam.top = shadowExtent;
    shadowCam.bottom = -shadowExtent;
    shadowCam.near = 0.1;
    shadowCam.far = Math.max(200, distance * 5);
    shadowCam.updateProjectionMatrix();
    camera.updateProjectionMatrix();
    controls.update();
  };

  const setTerrain = (sample: TerrainSample): void => {
    lastSample = sample;
    if (terrainMesh) {
      scene.remove(terrainMesh);
      terrainMesh.geometry.dispose();
      if (Array.isArray(terrainMesh.material)) {
        terrainMesh.material.forEach((material) => {
          const textured = material as THREE.Material & { map?: THREE.Texture | null };
          if (textured.map) {
            textured.map.dispose();
          }
          material.dispose();
        });
      } else {
        const textured = terrainMesh.material as THREE.Material & { map?: THREE.Texture | null };
        if (textured.map) {
          textured.map.dispose();
        }
        terrainMesh.material.dispose();
      }
      terrainMesh = null;
    }
    if (waterMesh) {
      scene.remove(waterMesh);
      waterMesh.geometry.dispose();
      const material = waterMesh.material;
      if (Array.isArray(material)) {
        material.forEach((mat) => mat.dispose());
      } else {
        material.dispose();
      }
      waterMesh = null;
      waterUniforms = null;
    }
    if (waterCapMesh) {
      scene.remove(waterCapMesh);
      waterCapMesh.geometry.dispose();
      const material = waterCapMesh.material;
      if (Array.isArray(material)) {
        material.forEach((mat) => mat.dispose());
      } else {
        material.dispose();
      }
      waterCapMesh = null;
      waterCapUniforms = null;
    }
    if (waterMask) {
      waterMask.dispose();
      waterMask = null;
    }
    if (sample.cols <= 1 || sample.rows <= 1 || sample.elevations.length === 0) {
      ground.visible = true;
      return;
    }
  const { mesh, size, water } = buildTerrainMesh(sample, treeAssets, houseAssets, firestationAsset);
    terrainMesh = mesh;
    scene.add(terrainMesh);
    ground.visible = false;

    const maxSize = Math.max(size.width, size.depth);
    updateCameraForSize(maxSize);

    if (water) {
      waterMask = water.mask;
      const waterGeometry = new THREE.PlaneGeometry(
        water.width,
        water.depth,
        Math.max(1, water.sampleCols - 1),
        Math.max(1, water.sampleRows - 1)
      );
      waterGeometry.rotateX(-Math.PI / 2);
      // create small neutral normal textures as safe defaults (can be replaced with better maps)
      const makeNeutralNormal = () => {
        const size = 2;
        const data = new Uint8Array(size * size * 3);
        for (let i = 0; i < size * size; i++) {
          data[i * 3 + 0] = 128; // R
          data[i * 3 + 1] = 128; // G
          data[i * 3 + 2] = 255; // B (pointing up)
        }
        const tex = new THREE.DataTexture(data, size, size, THREE.RGBFormat);
        tex.needsUpdate = true;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.minFilter = THREE.LinearMipMapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        return tex;
      };
      const defaultNormal1 = makeNeutralNormal();
      const defaultNormal2 = makeNeutralNormal();

      waterUniforms = {
        u_time: { value: 0 },
<<<<<<< HEAD
<<<<<<< HEAD
<<<<<<< HEAD
        u_mask: { value: water.mask },
        u_color: { value: new THREE.Color(0x3b7f9c) },
        u_deepColor: { value: new THREE.Color(0x143449) },
        u_opacity: { value: 0.68 },
=======
        u_mask: { value: waterMask },
        u_color: { value: new THREE.Color(0x1f6fb2) },
        u_deepColor: { value: new THREE.Color(0x0b2a45) },
        u_opacity: { value: 0.88 },
>>>>>>> 6611271 (water shader)
=======
=======
>>>>>>> cd3f1e3 (3d assets and map generation controls)
        u_mask: { value: waterMask },
        u_color: { value: new THREE.Color(0x1f6fb2) },
        u_deepColor: { value: new THREE.Color(0x0b2a45) },
        u_opacity: { value: 0.78 },
<<<<<<< HEAD
>>>>>>> cd3f1e3 (3d assets and map generation controls)
=======
>>>>>>> cd3f1e3 (3d assets and map generation controls)
        u_waveScale: { value: 0.28 },
        u_normalMap1: { value: defaultNormal1 },
        u_normalMap2: { value: defaultNormal2 },
        u_scroll1: { value: new THREE.Vector2(0.02, 0.01) },
        u_scroll2: { value: new THREE.Vector2(-0.015, 0.018) },
        u_normalScale: { value: 0.08 },
        u_normalStrength: { value: 0.8 },
        u_shininess: { value: 40.0 },
        u_lightDir: { value: keyLight.position.clone().normalize() },
        u_specular: { value: 0.6 }
      } as unknown as WaterUniforms;

      // If the user has provided normal maps in assets/textures, load and assign them.
      const loader = new THREE.TextureLoader();
      const maxAniso = renderer.capabilities.getMaxAnisotropy();
      loader.load('assets/textures/water1.png', (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.minFilter = THREE.LinearMipMapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.anisotropy = maxAniso;
        (waterUniforms as any).u_normalMap1.value = tex;
      });
      loader.load('assets/textures/water2.png', (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.minFilter = THREE.LinearMipMapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.anisotropy = maxAniso;
        (waterUniforms as any).u_normalMap2.value = tex;
      });

      const waterMaterial = new THREE.ShaderMaterial({
        uniforms: waterUniforms as any,
        transparent: true,
        depthWrite: false,
<<<<<<< HEAD
        vertexShader: `
          varying vec2 vUv;
          varying vec3 vWorldPos;
          uniform float u_time;
          uniform float u_waveScale;
          void main() {
            vUv = uv;
            vec3 pos = position;
            float wave = sin((pos.x * 0.16 + u_time * 0.55)) * 0.2
              + sin((pos.z * 0.22 - u_time * 0.42)) * 0.16;
            pos.y += wave * u_waveScale;
            vec4 worldPos = modelMatrix * vec4(pos, 1.0);
            vWorldPos = worldPos.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPos;
          }
        `,
        fragmentShader: `
          varying vec2 vUv;
          varying vec3 vWorldPos;
          uniform sampler2D u_mask;
          uniform vec3 u_color;
          uniform vec3 u_deepColor;
          uniform float u_opacity;
          uniform float u_time;
          uniform float u_waveScale;
          uniform vec3 u_lightDir;
          uniform float u_specular;
          void main() {
            float mask = texture2D(u_mask, vUv).a;
            if (mask < 0.02) discard;
            float wave = sin((vWorldPos.x + vWorldPos.z) * 0.2 + u_time * 0.7);
            float ripple = wave * 0.035;
            vec3 viewDir = normalize(cameraPosition - vWorldPos);
            float waveX = cos((vWorldPos.x * 0.16 + u_time * 0.55)) * 0.16;
            float waveZ = cos((vWorldPos.z * 0.22 - u_time * 0.42)) * 0.22;
            vec3 normal = normalize(vec3(-waveX * u_waveScale, 1.0, -waveZ * u_waveScale));
            vec3 lightDir = normalize(u_lightDir);
            float diffuse = max(dot(normal, lightDir), 0.0);
            float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 3.0);
            vec3 halfDir = normalize(lightDir + viewDir);
            float spec = pow(max(dot(normal, halfDir), 0.0), 40.0) * u_specular;
            vec3 color = mix(u_deepColor, u_color, 0.6 + ripple + diffuse * 0.08);
            float edge = smoothstep(0.0, 0.65, 1.0 - mask);
            float foamNoise = sin((vWorldPos.x + u_time * 0.25) * 1.4) * sin((vWorldPos.z - u_time * 0.18) * 1.1);
            foamNoise = foamNoise * 0.5 + 0.5;
            float foam = edge * (0.55 + foamNoise * 0.75);
            vec3 foamColor = vec3(0.9, 0.96, 1.0);
            color = mix(color, foamColor, foam * 0.55);
            color += fresnel * 0.16 + spec;
            gl_FragColor = vec4(color, u_opacity * mask);
          }
        `
=======
            vertexShader: `
              varying vec2 vUv;
              varying vec3 vWorldPos;
              uniform float u_time;
              void main() {
                vUv = uv;
                vec4 worldPos = modelMatrix * vec4(position, 1.0);
                vWorldPos = worldPos.xyz;
                gl_Position = projectionMatrix * viewMatrix * worldPos;
              }
            `,
            fragmentShader: `
              varying vec2 vUv;
              varying vec3 vWorldPos;
              uniform sampler2D u_mask;
              uniform vec3 u_color; // shallow/surface color
              uniform vec3 u_deepColor; // deep offshore color
              uniform float u_opacity;
              uniform float u_time;
              uniform float u_waveScale;
              uniform float u_normalScale;
              uniform float u_normalStrength;
              uniform float u_shininess;
              uniform vec3 u_lightDir;
              uniform float u_specular;
              uniform sampler2D u_normalMap1;
              uniform sampler2D u_normalMap2;
              uniform vec2 u_scroll1;
              uniform vec2 u_scroll2;
              void main() {
                float mask = texture2D(u_mask, vUv).a;
                if (mask < 0.02) discard;
                // sample two scrolling normal maps in world-space XZ
                vec2 worldUv = vWorldPos.xz * u_waveScale;
                vec2 uv1 = worldUv + u_scroll1 * u_time;
                vec2 uv2 = worldUv + u_scroll2 * u_time;
                vec3 nm1 = texture2D(u_normalMap1, uv1).xyz * 2.0 - 1.0;
                vec3 nm2 = texture2D(u_normalMap2, uv2).xyz * 2.0 - 1.0;
                vec3 nmap = normalize(mix(nm1, nm2, 0.5));
                // convert sampled tangent-like normal into a simple world-space perturbation
                vec3 n = normalize(vec3(nmap.x * u_normalScale * u_normalStrength, 1.0, nmap.y * u_normalScale * u_normalStrength));
                vec3 viewDir = normalize(cameraPosition - vWorldPos);
                vec3 lightDir = normalize(u_lightDir);
                // diffuse
                float diffuse = max(dot(n, lightDir), 0.0);
                // specular (Blinn-Phong)
                vec3 halfDir = normalize(lightDir + viewDir);
                float spec = pow(max(dot(n, halfDir), 0.0), max(1.0, u_shininess)) * u_specular;
                // fresnel rim
                float fresnel = pow(1.0 - max(dot(viewDir, n), 0.0), 3.0);
                // depth-like tint using mask as proxy for proximity to shore
                float depthFactor = pow(clamp(mask, 0.0, 1.0), 1.2);
                vec3 baseColor = mix(u_color, u_deepColor, depthFactor);
                // shoreline foam and brightness
                float shore = smoothstep(0.0, 0.85, 1.0 - mask);
                float foamNoise = sin((vWorldPos.x + u_time * 0.25) * 1.4) * sin((vWorldPos.z - u_time * 0.18) * 1.1);
                foamNoise = foamNoise * 0.5 + 0.5;
                float foam = shore * (0.45 + foamNoise * 0.6);
                vec3 foamColor = vec3(0.9, 0.96, 1.0);
                vec3 color = mix(baseColor, foamColor, clamp(foam, 0.0, 1.0) * 0.6);
                // combine lighting
                color = color * (0.6 + diffuse * 0.4) + (fresnel * 0.12 + spec);
                gl_FragColor = vec4(color, u_opacity * mask);
              }
            `
>>>>>>> 6611271 (water shader)
      });
      waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);
      waterMesh.position.y = mesh.position.y + water.level + 0.08;
      waterMesh.renderOrder = 2;
      waterMesh.receiveShadow = false;
      scene.add(waterMesh);

      const capGeometry = new THREE.PlaneGeometry(water.width, water.depth, 1, 1);
      capGeometry.rotateX(-Math.PI / 2);
      waterCapUniforms = {
        u_mask: { value: waterMask },
        u_color: { value: new THREE.Color(0x3a6f8d) },
        u_opacity: { value: 0.2 }
      };
      const capMaterial = new THREE.ShaderMaterial({
        uniforms: waterCapUniforms,
        transparent: true,
        depthWrite: false,
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec2 vUv;
          uniform sampler2D u_mask;
          uniform vec3 u_color;
          uniform float u_opacity;
          void main() {
            float mask = texture2D(u_mask, vUv).a;
            if (mask < 0.02) discard;
            gl_FragColor = vec4(u_color, u_opacity * mask);
          }
        `
      });
      waterCapMesh = new THREE.Mesh(capGeometry, capMaterial);
      waterCapMesh.position.y = mesh.position.y + water.level + 0.12;
      waterCapMesh.renderOrder = 3;
      scene.add(waterCapMesh);
    }
  };

  void loadTreeAssets()
    .then((assets) => {
      treeAssets = assets;
      if (lastSample) {
        setTerrain(lastSample);
      }
    })
    .catch((error) => {
      console.warn("Failed to load tree models.", error);
    });

  void loadHouseAssets()
    .then((assets) => {
      houseAssets = assets;
      if (lastSample) {
        setTerrain(lastSample);
      }
    })
    .catch((error) => {
      console.warn("Failed to load house models.", error);
    });

  void loadFirestationAsset()
    .then((asset) => {
      firestationAsset = asset;
      if (lastSample) {
        setTerrain(lastSample);
      }
    })
    .catch((error) => {
      console.warn("Failed to load firestation model.", error);
    });

  return { start, stop, resize, setTerrain };
};
