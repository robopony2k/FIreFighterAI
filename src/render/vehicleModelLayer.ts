import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { registerPbrSpecularGlossiness } from "./gltfSpecGloss.js";
import type { TerrainRenderSurface } from "./threeTestTerrain.js";

export type VehicleModelLayerConfig = {
  name: string;
  modelPath: string;
  maxInstances: number;
  targetLength: number;
  yawOffset: number;
  modelGroundOffset: number;
  tintMaterialPattern?: RegExp;
  fallbackGeometry: THREE.BufferGeometry;
  fallbackMaterial: THREE.Material;
  fallbackLift: number;
  normalSampleTiles?: number;
};

export type VehicleModelInstance = {
  x: number;
  y: number;
  yaw: number;
  color: THREE.Color;
  modelColor?: THREE.Color;
  fallbackColor?: THREE.Color;
};

type VehicleModelTemplate = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  baseMatrix: THREE.Matrix4;
  receivesInstanceColor: boolean;
};

export type VehicleModelLayer = {
  update: (surface: TerrainRenderSurface | null, instances: VehicleModelInstance[]) => void;
  dispose: () => void;
};

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const WORLD_FORWARD = new THREE.Vector3(0, 0, 1);

const disposeMaterial = (material: THREE.Material | THREE.Material[]): void => {
  if (Array.isArray(material)) {
    material.forEach((entry) => entry.dispose());
    return;
  }
  material.dispose();
};

const cloneVehicleMaterial = (material: THREE.Material, tintable: boolean): THREE.Material => {
  const clone = material.clone();
  if (!tintable) {
    return clone;
  }
  const maybeTinted = clone as THREE.MeshStandardMaterial & {
    map?: THREE.Texture | null;
    color?: THREE.Color;
    vertexColors?: boolean;
  };
  if ("map" in maybeTinted) {
    maybeTinted.map = null;
  }
  if (maybeTinted.color) {
    maybeTinted.color.set(0xffffff);
  }
  if ("vertexColors" in maybeTinted) {
    maybeTinted.vertexColors = true;
  }
  clone.needsUpdate = true;
  return clone;
};

const extractVehicleModelTemplates = (
  root: THREE.Object3D,
  tintMaterialPattern?: RegExp
): { templates: VehicleModelTemplate[]; size: THREE.Vector3 } | null => {
  root.updateMatrixWorld(true);
  const worldBounds = new THREE.Box3().setFromObject(root);
  if (!Number.isFinite(worldBounds.min.x) || !Number.isFinite(worldBounds.max.x)) {
    return null;
  }
  const center = new THREE.Vector3();
  worldBounds.getCenter(center);
  const recenter = new THREE.Matrix4().makeTranslation(-center.x, -worldBounds.min.y, -center.z);
  const templates: VehicleModelTemplate[] = [];
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }
    const geometry = child.geometry.clone();
    const receivesInstanceColor = Array.isArray(child.material)
      ? child.material.some((entry) => !!tintMaterialPattern?.test(entry.name))
      : !!tintMaterialPattern?.test(child.material.name);
    const material = Array.isArray(child.material)
      ? child.material.map((entry) => cloneVehicleMaterial(entry, !!tintMaterialPattern?.test(entry.name)))
      : cloneVehicleMaterial(child.material, receivesInstanceColor);
    const baseMatrix = child.matrixWorld.clone().premultiply(recenter);
    templates.push({ geometry, material, baseMatrix, receivesInstanceColor });
  });
  if (templates.length === 0) {
    return null;
  }
  const size = new THREE.Vector3();
  worldBounds.getSize(size);
  return { templates, size };
};

export const createVehicleModelLayer = (
  scene: THREE.Scene,
  config: VehicleModelLayerConfig
): VehicleModelLayer => {
  const fallbackMesh = new THREE.InstancedMesh(
    config.fallbackGeometry,
    config.fallbackMaterial,
    config.maxInstances
  );
  fallbackMesh.count = 0;
  fallbackMesh.castShadow = true;
  fallbackMesh.receiveShadow = true;
  fallbackMesh.frustumCulled = false;
  fallbackMesh.name = `${config.name}-fallback`;
  scene.add(fallbackMesh);

  const modelMeshes: Array<{
    mesh: THREE.InstancedMesh;
    baseMatrix: THREE.Matrix4;
    receivesInstanceColor: boolean;
  }> = [];
  let modelScale = 1;
  let useModel = false;
  let disposed = false;

  const clearModelMeshes = (): void => {
    modelMeshes.forEach(({ mesh }) => {
      scene.remove(mesh);
      mesh.geometry.dispose();
      disposeMaterial(mesh.material);
    });
    modelMeshes.length = 0;
    useModel = false;
  };

  const loader = registerPbrSpecularGlossiness(new GLTFLoader());
  loader.load(
    config.modelPath,
    (gltf) => {
      if (disposed) {
        return;
      }
      const extracted = extractVehicleModelTemplates(gltf.scene, config.tintMaterialPattern);
      if (!extracted) {
        return;
      }
      clearModelMeshes();
      const footprint = Math.max(extracted.size.x, extracted.size.z);
      modelScale = config.targetLength / Math.max(0.01, footprint);
      extracted.templates.forEach((template) => {
        const mesh = new THREE.InstancedMesh(template.geometry, template.material, config.maxInstances);
        mesh.count = 0;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        mesh.name = `${config.name}-model`;
        scene.add(mesh);
        modelMeshes.push({ mesh, baseMatrix: template.baseMatrix, receivesInstanceColor: template.receivesInstanceColor });
      });
      useModel = modelMeshes.length > 0;
    },
    undefined,
    (error) => {
      console.warn(`[${config.name}] Failed to load vehicle model, using placeholder.`, error);
    }
  );

  const matrix = new THREE.Matrix4();
  const templateMatrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const yawOffsetQuat = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, config.yawOffset);
  const surfaceNormal = new THREE.Vector3();
  const surfaceForward = new THREE.Vector3();
  const surfaceRight = new THREE.Vector3();
  const projectedForward = new THREE.Vector3();
  const basis = new THREE.Matrix4();

  const sampleSurfaceNormal = (
    surface: TerrainRenderSurface,
    x: number,
    y: number,
    target: THREE.Vector3
  ): THREE.Vector3 => {
    const offset = Math.max(0.05, config.normalSampleTiles ?? Math.max(0.24, surface.step * 0.35));
    const leftHeight = surface.heightAtTileCoord(x - offset, y) * surface.heightScale;
    const rightHeight = surface.heightAtTileCoord(x + offset, y) * surface.heightScale;
    const downHeight = surface.heightAtTileCoord(x, y - offset) * surface.heightScale;
    const upHeight = surface.heightAtTileCoord(x, y + offset) * surface.heightScale;
    const worldDx = ((offset * 2) / Math.max(1, surface.cols)) * surface.size.width;
    const worldDz = ((offset * 2) / Math.max(1, surface.rows)) * surface.size.depth;
    target.set(
      -(rightHeight - leftHeight) / Math.max(1e-5, worldDx),
      1,
      -(upHeight - downHeight) / Math.max(1e-5, worldDz)
    );
    if (target.lengthSq() <= 1e-8) {
      target.copy(WORLD_UP);
    } else {
      target.normalize();
    }
    if (target.y < 0) {
      target.multiplyScalar(-1);
    }
    return target;
  };

  const writeVehicleMatrix = (
    surface: TerrainRenderSurface,
    instance: VehicleModelInstance,
    lift: number,
    instanceScale: number,
    output: THREE.Matrix4
  ): void => {
    const wx = surface.toWorldX(instance.x);
    const wz = surface.toWorldZ(instance.y);
    const wy = surface.heightAtTileCoord(instance.x, instance.y) * surface.heightScale;
    sampleSurfaceNormal(surface, instance.x, instance.y, surfaceNormal);
    surfaceForward.set(Math.sin(instance.yaw), 0, Math.cos(instance.yaw));
    projectedForward.copy(surfaceForward).addScaledVector(surfaceNormal, -surfaceForward.dot(surfaceNormal));
    if (projectedForward.lengthSq() <= 1e-8) {
      projectedForward.copy(WORLD_FORWARD).addScaledVector(surfaceNormal, -WORLD_FORWARD.dot(surfaceNormal));
    }
    if (projectedForward.lengthSq() <= 1e-8) {
      projectedForward.set(1, 0, 0);
    } else {
      projectedForward.normalize();
    }
    surfaceRight.crossVectors(surfaceNormal, projectedForward);
    if (surfaceRight.lengthSq() <= 1e-8) {
      surfaceRight.set(1, 0, 0);
    } else {
      surfaceRight.normalize();
    }
    surfaceForward.crossVectors(surfaceRight, surfaceNormal).normalize();
    basis.makeBasis(surfaceRight, surfaceNormal, surfaceForward);
    quaternion.setFromRotationMatrix(basis).multiply(yawOffsetQuat);
    position.set(wx, wy + lift, wz);
    scale.setScalar(instanceScale);
    output.compose(position, quaternion, scale);
  };

  const update = (surface: TerrainRenderSurface | null, instances: VehicleModelInstance[]): void => {
    if (!surface || instances.length === 0) {
      fallbackMesh.count = 0;
      modelMeshes.forEach(({ mesh }) => {
        mesh.count = 0;
      });
      return;
    }
    const count = Math.min(config.maxInstances, instances.length);
    if (useModel && modelMeshes.length > 0) {
      fallbackMesh.count = 0;
      for (let i = 0; i < count; i += 1) {
        writeVehicleMatrix(surface, instances[i]!, config.modelGroundOffset, modelScale, matrix);
        modelMeshes.forEach(({ mesh, baseMatrix, receivesInstanceColor }) => {
          templateMatrix.copy(matrix).multiply(baseMatrix);
          mesh.setMatrixAt(i, templateMatrix);
          if (receivesInstanceColor) {
            mesh.setColorAt(i, instances[i]!.modelColor ?? instances[i]!.color);
          }
        });
      }
      modelMeshes.forEach(({ mesh }) => {
        mesh.count = count;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) {
          mesh.instanceColor.needsUpdate = true;
        }
      });
      return;
    }

    modelMeshes.forEach(({ mesh }) => {
      mesh.count = 0;
    });
    for (let i = 0; i < count; i += 1) {
      writeVehicleMatrix(surface, instances[i]!, config.fallbackLift, 1, matrix);
      fallbackMesh.setMatrixAt(i, matrix);
      fallbackMesh.setColorAt(i, instances[i]!.fallbackColor ?? instances[i]!.color);
    }
    fallbackMesh.count = count;
    fallbackMesh.instanceMatrix.needsUpdate = true;
    if (fallbackMesh.instanceColor) {
      fallbackMesh.instanceColor.needsUpdate = true;
    }
  };

  const dispose = (): void => {
    disposed = true;
    clearModelMeshes();
    scene.remove(fallbackMesh);
    config.fallbackGeometry.dispose();
    config.fallbackMaterial.dispose();
  };

  return { update, dispose };
};
