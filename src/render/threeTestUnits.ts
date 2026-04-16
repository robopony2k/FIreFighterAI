import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { WorldState } from "../core/state.js";
import {
  FIREFIGHTER_MODEL_ROOT_Y_OFFSET,
  classifyFirefighterModelPart,
  createFirefighterVisualState,
  resolveFirefighterPartPivot,
  updateFirefighterVisualState,
  writeFirefighterGripDirection,
  writeFirefighterGripWorldPosition,
  writeFirefighterPartPoseMatrix,
  type FirefighterModelPart
} from "./firefighterVisuals.js";
import type { TerrainRenderSurface } from "./threeTestTerrain.js";
import { resolveWaterStreamTrajectory } from "../systems/fire/rendering/waterStreamTrajectory.js";
import { approachAngleExp, resolveDesiredUnitYaw } from "./unitAimVisuals.js";
import { registerPbrSpecularGlossiness } from "./gltfSpecGloss.js";

const TRUCK_BASE_COLOR = new THREE.Color(0xe0311d);
const TRUCK_SELECTED_COLOR = new THREE.Color(0xff6e57);
const TRUCK_MODEL_BASE_TINT = new THREE.Color(0xffffff);
const TRUCK_MODEL_SELECTED_TINT = new THREE.Color(0xffd5c8);
const FIREFIGHTER_BASE_COLOR = new THREE.Color(0xffdf3a);
const FIREFIGHTER_SELECTED_COLOR = new THREE.Color(0xfff3a6);
const FIREFIGHTER_MODEL_BASE_TINT = new THREE.Color(0xffffff);
const FIREFIGHTER_MODEL_SELECTED_TINT = new THREE.Color(0xfff3a6);
const UNIT_BASE_Y_OFFSET = 0.02;
const TRUCK_MODEL_PATH = "assets/3d/GLTF/Vehicles/low_poly_fire_truck.glb";
const TRUCK_MODEL_TARGET_LENGTH = 0.64;
const TRUCK_MODEL_YAW_OFFSET = Math.PI * 0.5;
const TRUCK_MODEL_GROUND_OFFSET = 0.03;
const FIREFIGHTER_MODEL_PATH = "assets/3d/GLTF/units/low-poly_test_dummy..glb";
const FIREFIGHTER_MODEL_TARGET_HEIGHT = 0.34;
const FIREFIGHTER_MODEL_YAW_OFFSET = 0;
const FIREFIGHTER_NOZZLE_LENGTH = 0.08;
const FIREFIGHTER_NOZZLE_RADIUS = 0.011;
const TRUCK_NORMAL_SAMPLE_TILES = 0.24;
const TRUCK_SELECTION_RING_INNER_RADIUS = 0.32;
const TRUCK_SELECTION_RING_OUTER_RADIUS = 0.4;
const TRUCK_SELECTION_RING_Y_OFFSET = 0.04;
const MAX_TRUCK_INSTANCES = 512;
const MAX_FIREFIGHTER_INSTANCES = 1024;
const DEFAULT_UNIT_TURN_RESPONSE = 18;
const ENGAGED_FIREFIGHTER_TURN_RESPONSE = 10.5;
const ENGAGED_NOZZLE_RESPONSE = 12.5;
const IDLE_NOZZLE_RESPONSE = 18;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const expFactor = (rate: number, dtSeconds: number): number =>
  1 - Math.exp(-Math.max(0, rate) * Math.max(0, dtSeconds));
const resolveUnitSprayMode = (
  unit: WorldState["units"][number]
): "precision" | "balanced" | "suppression" => {
  if (unit.kind !== "firefighter") {
    return "balanced";
  }
  if (unit.formation === "narrow") {
    return "precision";
  }
  if (unit.formation === "wide") {
    return "suppression";
  }
  return "balanced";
};

export type ThreeTestUnitsLayer = {
  update: (
    world: WorldState,
    surface: TerrainRenderSurface | null,
    interpolationAlpha: number
  ) => void;
  dispose: () => void;
};

type UnitModelTemplate = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  baseMatrix: THREE.Matrix4;
  bounds: THREE.Box3;
  ancestorNames: string[];
};

export const createThreeTestUnitsLayer = (scene: THREE.Scene): ThreeTestUnitsLayer => {
  const truckGeometry = new THREE.BoxGeometry(0.38, 0.18, 0.64);
  const truckMaterial = new THREE.MeshStandardMaterial({
    color: TRUCK_BASE_COLOR,
    emissive: new THREE.Color(0x3a0904),
    emissiveIntensity: 0.3,
    roughness: 0.64,
    metalness: 0.05,
    vertexColors: true
  });
  const truckMesh = new THREE.InstancedMesh(truckGeometry, truckMaterial, MAX_TRUCK_INSTANCES);
  truckMesh.count = 0;
  truckMesh.frustumCulled = false;
  scene.add(truckMesh);
  const truckSelectionRingGeometry = new THREE.RingGeometry(
    TRUCK_SELECTION_RING_INNER_RADIUS,
    TRUCK_SELECTION_RING_OUTER_RADIUS,
    28
  );
  truckSelectionRingGeometry.rotateX(-Math.PI * 0.5);
  const truckSelectionRingMaterial = new THREE.MeshBasicMaterial({
    color: 0xfff1a8,
    transparent: true,
    opacity: 0.96,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const truckSelectionMesh = new THREE.InstancedMesh(
    truckSelectionRingGeometry,
    truckSelectionRingMaterial,
    MAX_TRUCK_INSTANCES
  );
  truckSelectionMesh.count = 0;
  truckSelectionMesh.frustumCulled = false;
  scene.add(truckSelectionMesh);
  const truckModelMeshes: Array<{ mesh: THREE.InstancedMesh; baseMatrix: THREE.Matrix4 }> = [];
  let useTruckModel = false;
  let truckModelScale = 1;
  let truckModelLift = 0.11 + UNIT_BASE_Y_OFFSET;
  const firefighterModelMeshes: Array<{
    mesh: THREE.InstancedMesh;
    baseMatrix: THREE.Matrix4;
    part: FirefighterModelPart;
    pivot: THREE.Vector3;
  }> = [];
  let useFirefighterModel = false;
  let firefighterModelScale = 1;
  let firefighterModelLift = FIREFIGHTER_MODEL_ROOT_Y_OFFSET;
  let disposed = false;

  const disposeMaterial = (material: THREE.Material | THREE.Material[]): void => {
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose());
      return;
    }
    material.dispose();
  };

  const clearTruckModelMeshes = (): void => {
    truckModelMeshes.forEach(({ mesh }) => {
      scene.remove(mesh);
      mesh.geometry.dispose();
      disposeMaterial(mesh.material);
    });
    truckModelMeshes.length = 0;
    useTruckModel = false;
  };

  const clearFirefighterModelMeshes = (): void => {
    firefighterModelMeshes.forEach(({ mesh }) => {
      scene.remove(mesh);
      mesh.geometry.dispose();
      disposeMaterial(mesh.material);
    });
    firefighterModelMeshes.length = 0;
    useFirefighterModel = false;
  };

  const extractModelTemplates = (root: THREE.Object3D): { templates: UnitModelTemplate[]; size: THREE.Vector3 } | null => {
    root.updateMatrixWorld(true);
    const worldBounds = new THREE.Box3().setFromObject(root);
    if (!Number.isFinite(worldBounds.min.x) || !Number.isFinite(worldBounds.max.x)) {
      return null;
    }
    const center = new THREE.Vector3();
    worldBounds.getCenter(center);
    const recenter = new THREE.Matrix4().makeTranslation(-center.x, -worldBounds.min.y, -center.z);
    const templates: UnitModelTemplate[] = [];
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) {
        return;
      }
      const geometry = child.geometry.clone();
      const material = Array.isArray(child.material)
        ? child.material.map((entry) => entry.clone())
        : child.material.clone();
      const baseMatrix = child.matrixWorld.clone().premultiply(recenter);
      geometry.computeBoundingBox();
      const bounds = geometry.boundingBox
        ? geometry.boundingBox.clone().applyMatrix4(baseMatrix)
        : new THREE.Box3().setFromObject(child).applyMatrix4(recenter);
      const ancestorNames: string[] = [];
      let parent: THREE.Object3D | null = child.parent;
      while (parent && parent !== root.parent) {
        if (parent.name) {
          ancestorNames.push(parent.name);
        }
        parent = parent.parent;
      }
      templates.push({ geometry, material, baseMatrix, bounds, ancestorNames });
    });
    if (templates.length <= 0) {
      return null;
    }
    const size = new THREE.Vector3();
    worldBounds.getSize(size);
    return { templates, size };
  };

  const extractFirefighterTemplates = (
    root: THREE.Object3D
  ): { templates: Array<UnitModelTemplate & { part: FirefighterModelPart; pivot: THREE.Vector3 }>; size: THREE.Vector3 } | null => {
    const extracted = extractModelTemplates(root);
    if (!extracted) {
      return null;
    }
    const partBounds = new Map<FirefighterModelPart, THREE.Box3>();
    const templates = extracted.templates.map((template) => {
      const part = classifyFirefighterModelPart(template.ancestorNames, template.bounds, extracted.size);
      const existingBounds = partBounds.get(part);
      if (existingBounds) {
        existingBounds.union(template.bounds);
      } else {
        partBounds.set(part, template.bounds.clone());
      }
      return {
        ...template,
        part,
        pivot: new THREE.Vector3()
      };
    });
    templates.forEach((template) => {
      const bounds = partBounds.get(template.part) ?? template.bounds;
      template.pivot.copy(resolveFirefighterPartPivot(template.part, bounds));
    });
    return { templates, size: extracted.size };
  };

  const loader = registerPbrSpecularGlossiness(new GLTFLoader());
  loader.load(
    TRUCK_MODEL_PATH,
    (gltf) => {
      if (disposed) {
        return;
      }
      const extracted = extractModelTemplates(gltf.scene);
      if (!extracted) {
        return;
      }
      clearTruckModelMeshes();
      const footprint = Math.max(extracted.size.x, extracted.size.z);
      truckModelScale = TRUCK_MODEL_TARGET_LENGTH / Math.max(0.01, footprint);
      truckModelLift = TRUCK_MODEL_GROUND_OFFSET + UNIT_BASE_Y_OFFSET;
      extracted.templates.forEach((template) => {
        const mesh = new THREE.InstancedMesh(template.geometry, template.material, MAX_TRUCK_INSTANCES);
        mesh.count = 0;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        scene.add(mesh);
        truckModelMeshes.push({
          mesh,
          baseMatrix: template.baseMatrix
        });
      });
      useTruckModel = truckModelMeshes.length > 0;
    },
    undefined,
    (error) => {
      console.warn("[threeTestUnits] Failed to load truck model, using placeholder.", error);
    }
  );

  loader.load(
    FIREFIGHTER_MODEL_PATH,
    (gltf) => {
      if (disposed) {
        return;
      }
      const extracted = extractFirefighterTemplates(gltf.scene);
      if (!extracted) {
        return;
      }
      clearFirefighterModelMeshes();
      firefighterModelScale = FIREFIGHTER_MODEL_TARGET_HEIGHT / Math.max(0.01, extracted.size.y);
      firefighterModelLift = FIREFIGHTER_MODEL_ROOT_Y_OFFSET;
      extracted.templates.forEach((template) => {
        const mesh = new THREE.InstancedMesh(template.geometry, template.material, MAX_FIREFIGHTER_INSTANCES);
        mesh.count = 0;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        scene.add(mesh);
        firefighterModelMeshes.push({
          mesh,
          baseMatrix: template.baseMatrix,
          part: template.part,
          pivot: template.pivot
        });
      });
      useFirefighterModel = firefighterModelMeshes.length > 0;
    },
    undefined,
    (error) => {
      console.warn("[threeTestUnits] Failed to load firefighter model, using placeholder.", error);
    }
  );

  const firefighterGeometry = new THREE.CylinderGeometry(0.08, 0.1, 0.34, 6);
  const firefighterMaterial = new THREE.MeshStandardMaterial({
    color: FIREFIGHTER_BASE_COLOR,
    emissive: new THREE.Color(0x4a4004),
    emissiveIntensity: 0.24,
    roughness: 0.7,
    metalness: 0.02,
    vertexColors: true
  });
  const firefighterMesh = new THREE.InstancedMesh(
    firefighterGeometry,
    firefighterMaterial,
    MAX_FIREFIGHTER_INSTANCES
  );
  firefighterMesh.count = 0;
  firefighterMesh.frustumCulled = false;
  scene.add(firefighterMesh);
  const firefighterNozzleGeometry = new THREE.CylinderGeometry(
    FIREFIGHTER_NOZZLE_RADIUS,
    FIREFIGHTER_NOZZLE_RADIUS * 1.18,
    FIREFIGHTER_NOZZLE_LENGTH,
    6
  );
  const firefighterNozzleMaterial = new THREE.MeshStandardMaterial({
    color: 0x242c34,
    emissive: new THREE.Color(0x0b1218),
    emissiveIntensity: 0.3,
    roughness: 0.38,
    metalness: 0.55
  });
  const firefighterNozzleMesh = new THREE.InstancedMesh(
    firefighterNozzleGeometry,
    firefighterNozzleMaterial,
    MAX_FIREFIGHTER_INSTANCES
  );
  firefighterNozzleMesh.count = 0;
  firefighterNozzleMesh.frustumCulled = false;
  scene.add(firefighterNozzleMesh);

  const truckMatrix = new THREE.Matrix4();
  const firefighterMatrix = new THREE.Matrix4();
  const firefighterNozzleMatrix = new THREE.Matrix4();
  const truckPos = new THREE.Vector3();
  const firefighterPos = new THREE.Vector3();
  const firefighterNozzlePos = new THREE.Vector3();
  const truckQuat = new THREE.Quaternion();
  const firefighterQuat = new THREE.Quaternion();
  const firefighterNozzleQuat = new THREE.Quaternion();
  const truckScale = new THREE.Vector3(1, 1, 1);
  const firefighterScale = new THREE.Vector3(1, 1, 1);
  const firefighterNozzleScale = new THREE.Vector3(1, 1, 1);
  const worldUp = new THREE.Vector3(0, 1, 0);
  const worldForward = new THREE.Vector3(0, 0, 1);
  const worldRight = new THREE.Vector3(1, 0, 0);
  const truckModelYawOffsetQuat = new THREE.Quaternion().setFromAxisAngle(worldUp, TRUCK_MODEL_YAW_OFFSET);
  const firefighterModelYawOffsetQuat = new THREE.Quaternion().setFromAxisAngle(worldUp, FIREFIGHTER_MODEL_YAW_OFFSET);
  const surfaceNormal = new THREE.Vector3();
  const surfaceForward = new THREE.Vector3();
  const surfaceRight = new THREE.Vector3();
  const projectedForward = new THREE.Vector3();
  const truckBasis = new THREE.Matrix4();
  const truckTemplateMatrix = new THREE.Matrix4();
  const firefighterTemplateMatrix = new THREE.Matrix4();
  const firefighterPartPoseMatrix = new THREE.Matrix4();
  const truckSelectionMatrix = new THREE.Matrix4();
  const truckSelectionPos = new THREE.Vector3();
  const truckSelectionQuat = new THREE.Quaternion();
  const truckSelectionScale = new THREE.Vector3(1, 1, 1);
  const firefighterNozzleDirection = new THREE.Vector3();
  const firefighterNozzleAim = new THREE.Vector3();
  const firefighterTrajectoryTarget = new THREE.Vector3();
  const firefighterDesiredNozzleDirection = new THREE.Vector3();
  const firefighterPose = createFirefighterVisualState();
  const lastYawByUnitId = new Map<number, number>();
  const lastForwardByUnitId = new Map<number, THREE.Vector3>();
  const lastNozzleDirectionByUnitId = new Map<number, THREE.Vector3>();
  let lastUpdateTimeMs: number | null = null;

  const resolveInterpolatedPosition = (
    unit: WorldState["units"][number],
    interpolationAlpha: number
  ): { x: number; y: number } => {
    const alpha = clamp(interpolationAlpha, 0, 1);
    return {
      x: unit.prevX + (unit.x - unit.prevX) * alpha,
      y: unit.prevY + (unit.y - unit.prevY) * alpha
    };
  };

  const resolveYaw = (
    unit: WorldState["units"][number],
    x: number,
    y: number,
    deltaSeconds: number
  ): number => {
    const fallbackYaw = lastYawByUnitId.get(unit.id) ?? 0;
    const desiredYaw = resolveDesiredUnitYaw(unit, x, y, fallbackYaw);
    if (!lastYawByUnitId.has(unit.id)) {
      lastYawByUnitId.set(unit.id, desiredYaw);
      return desiredYaw;
    }
    const engaged = unit.kind === "firefighter" && (unit.sprayTarget !== null || unit.attackTarget !== null);
    const response = engaged ? ENGAGED_FIREFIGHTER_TURN_RESPONSE : DEFAULT_UNIT_TURN_RESPONSE;
    const yaw = approachAngleExp(fallbackYaw, desiredYaw, response, deltaSeconds);
    lastYawByUnitId.set(unit.id, yaw);
    return yaw;
  };

  const resolveNozzleDirection = (
    unit: WorldState["units"][number],
    yaw: number,
    source: THREE.Vector3,
    pose: typeof firefighterPose,
    deltaSeconds: number,
    aimPoint: THREE.Vector3 | null
  ): THREE.Vector3 => {
    if (aimPoint) {
      firefighterDesiredNozzleDirection.copy(aimPoint).sub(source);
    } else {
      writeFirefighterGripDirection(yaw, pose.gripPitch, firefighterDesiredNozzleDirection);
    }
    if (firefighterDesiredNozzleDirection.lengthSq() <= 0.000001) {
      writeFirefighterGripDirection(yaw, pose.gripPitch, firefighterDesiredNozzleDirection);
    } else {
      firefighterDesiredNozzleDirection.normalize();
    }
    let smoothedDirection = lastNozzleDirectionByUnitId.get(unit.id) ?? null;
    if (!smoothedDirection) {
      smoothedDirection = firefighterDesiredNozzleDirection.clone();
      lastNozzleDirectionByUnitId.set(unit.id, smoothedDirection);
      return smoothedDirection;
    }
    const response = aimPoint ? ENGAGED_NOZZLE_RESPONSE : IDLE_NOZZLE_RESPONSE;
    smoothedDirection.lerp(firefighterDesiredNozzleDirection, expFactor(response, deltaSeconds));
    if (smoothedDirection.lengthSq() <= 0.000001) {
      smoothedDirection.copy(firefighterDesiredNozzleDirection);
    } else {
      smoothedDirection.normalize();
    }
    return smoothedDirection;
  };

  const sampleSurfaceNormal = (
    terrainSize: { width: number; depth: number },
    cols: number,
    rows: number,
    heightScale: number,
    x: number,
    y: number,
    sampleOffset: number,
    sampleHeightAt: (tileX: number, tileY: number) => number,
    target: THREE.Vector3
  ): THREE.Vector3 => {
    const offset = Math.max(0.05, sampleOffset);
    const leftHeight = sampleHeightAt(x - offset, y) * heightScale;
    const rightHeight = sampleHeightAt(x + offset, y) * heightScale;
    const downHeight = sampleHeightAt(x, y - offset) * heightScale;
    const upHeight = sampleHeightAt(x, y + offset) * heightScale;
    const worldDx = ((offset * 2) / Math.max(1, cols)) * terrainSize.width;
    const worldDz = ((offset * 2) / Math.max(1, rows)) * terrainSize.depth;
    const slopeX = (rightHeight - leftHeight) / Math.max(1e-5, worldDx);
    const slopeZ = (upHeight - downHeight) / Math.max(1e-5, worldDz);
    target.set(-slopeX, 1, -slopeZ);
    if (target.lengthSq() <= 1e-8) {
      target.copy(worldUp);
    } else {
      target.normalize();
    }
    if (target.y < 0) {
      target.multiplyScalar(-1);
    }
    return target;
  };

  const update = (
    world: WorldState,
    surface: TerrainRenderSurface | null,
    interpolationAlpha: number
  ): void => {
    if (!surface || world.units.length === 0) {
      truckMesh.count = 0;
      truckSelectionMesh.count = 0;
      truckModelMeshes.forEach(({ mesh }) => {
        mesh.count = 0;
      });
      firefighterMesh.count = 0;
      firefighterNozzleMesh.count = 0;
      firefighterModelMeshes.forEach(({ mesh }) => {
        mesh.count = 0;
      });
      lastYawByUnitId.clear();
      lastForwardByUnitId.clear();
      lastNozzleDirectionByUnitId.clear();
      lastUpdateTimeMs = null;
      return;
    }

    const cols = Math.max(1, surface.cols);
    const rows = Math.max(1, surface.rows);
    const terrainSize = surface.size;
    const heightScale = surface.heightScale;
    const normalSampleOffset = Math.max(TRUCK_NORMAL_SAMPLE_TILES, surface.step * 0.35);
    const sampleHeightAt = (tileX: number, tileY: number): number => surface.heightAtTileCoord(tileX, tileY);
    const timeMs = performance.now();
    const timeSec = timeMs * 0.001;
    const deltaSeconds =
      lastUpdateTimeMs === null ? 1 / 60 : clamp((timeMs - lastUpdateTimeMs) * 0.001, 1 / 240, 0.12);
    lastUpdateTimeMs = timeMs;
    let truckCount = 0;
    let selectedTruckCount = 0;
    let firefighterCount = 0;
    let firefighterNozzleCount = 0;
    const activeUnitIds = new Set<number>();

    for (let i = 0; i < world.units.length; i += 1) {
      const unit = world.units[i];
      if (!unit) {
        continue;
      }
      if (unit.kind === "firefighter" && unit.carrierId !== null) {
        continue;
      }
      activeUnitIds.add(unit.id);
      const interpolated = resolveInterpolatedPosition(unit, interpolationAlpha);
      const wx = surface.toWorldX(interpolated.x);
      const wz = surface.toWorldZ(interpolated.y);
      const wy = sampleHeightAt(interpolated.x, interpolated.y) * heightScale;
      const yaw = resolveYaw(unit, interpolated.x, interpolated.y, deltaSeconds);

      if (unit.kind === "truck") {
        if (truckCount >= MAX_TRUCK_INSTANCES) {
          continue;
        }
        sampleSurfaceNormal(
          terrainSize,
          cols,
          rows,
          heightScale,
          interpolated.x,
          interpolated.y,
          normalSampleOffset,
          sampleHeightAt,
          surfaceNormal
        );
        surfaceForward.set(Math.sin(yaw), 0, Math.cos(yaw));
        projectedForward.copy(surfaceForward).addScaledVector(surfaceNormal, -surfaceForward.dot(surfaceNormal));
        if (projectedForward.lengthSq() <= 1e-8) {
          const rememberedForward = lastForwardByUnitId.get(unit.id);
          if (rememberedForward) {
            projectedForward
              .copy(rememberedForward)
              .addScaledVector(surfaceNormal, -rememberedForward.dot(surfaceNormal));
          }
        }
        if (projectedForward.lengthSq() <= 1e-8) {
          projectedForward.copy(worldForward).addScaledVector(surfaceNormal, -worldForward.dot(surfaceNormal));
        }
        if (projectedForward.lengthSq() <= 1e-8) {
          projectedForward.set(1, 0, 0);
        } else {
          projectedForward.normalize();
        }
        const rememberedForward = lastForwardByUnitId.get(unit.id);
        if (rememberedForward) {
          rememberedForward.copy(projectedForward);
        } else {
          lastForwardByUnitId.set(unit.id, projectedForward.clone());
        }
        // Build a right-handed tangent frame on the terrain surface.
        // right = up x forward, then forward = right x up.
        surfaceRight.crossVectors(surfaceNormal, projectedForward);
        if (surfaceRight.lengthSq() <= 1e-8) {
          surfaceRight.set(1, 0, 0);
        } else {
          surfaceRight.normalize();
        }
        surfaceForward.crossVectors(surfaceRight, surfaceNormal).normalize();
        truckBasis.makeBasis(surfaceRight, surfaceNormal, surfaceForward);
        truckQuat.setFromRotationMatrix(truckBasis);
        if (useTruckModel && truckModelMeshes.length > 0) {
          // Keep the truck anchored to the sampled world position; only the visual lift should move upward.
          truckPos.set(wx, wy + truckModelLift, wz);
          truckQuat.multiply(truckModelYawOffsetQuat);
          truckScale.setScalar(truckModelScale);
          truckMatrix.compose(truckPos, truckQuat, truckScale);
          const tint = unit.selected ? TRUCK_MODEL_SELECTED_TINT : TRUCK_MODEL_BASE_TINT;
          truckModelMeshes.forEach(({ mesh, baseMatrix }) => {
            truckTemplateMatrix.copy(truckMatrix).multiply(baseMatrix);
            mesh.setMatrixAt(truckCount, truckTemplateMatrix);
            mesh.setColorAt(truckCount, tint);
          });
        } else {
          truckPos.set(wx, wy + 0.11 + UNIT_BASE_Y_OFFSET, wz);
          truckScale.set(1, 1, 1);
          truckMatrix.compose(truckPos, truckQuat, truckScale);
          truckMesh.setMatrixAt(truckCount, truckMatrix);
          truckMesh.setColorAt(truckCount, unit.selected ? TRUCK_SELECTED_COLOR : TRUCK_BASE_COLOR);
        }
        if (unit.selected && selectedTruckCount < MAX_TRUCK_INSTANCES) {
          truckSelectionPos.set(wx, wy + TRUCK_SELECTION_RING_Y_OFFSET, wz);
          truckSelectionQuat.setFromUnitVectors(worldUp, surfaceNormal);
          truckSelectionMatrix.compose(truckSelectionPos, truckSelectionQuat, truckSelectionScale);
          truckSelectionMesh.setMatrixAt(selectedTruckCount, truckSelectionMatrix);
          selectedTruckCount += 1;
        }
        truckCount += 1;
        continue;
      }

      if (firefighterCount >= MAX_FIREFIGHTER_INSTANCES) {
        continue;
      }
      updateFirefighterVisualState(unit, timeSec, firefighterPose);
      firefighterPos.set(wx, wy + firefighterModelLift + firefighterPose.bodyBob, wz);
      if (useFirefighterModel && firefighterModelMeshes.length > 0) {
        firefighterQuat.setFromAxisAngle(worldUp, yaw);
        firefighterQuat.multiply(firefighterModelYawOffsetQuat);
        firefighterScale.setScalar(firefighterModelScale);
        firefighterMatrix.compose(firefighterPos, firefighterQuat, firefighterScale);
        const tint = unit.selected ? FIREFIGHTER_MODEL_SELECTED_TINT : FIREFIGHTER_MODEL_BASE_TINT;
        firefighterModelMeshes.forEach(({ mesh, baseMatrix, part, pivot }) => {
          writeFirefighterPartPoseMatrix(part, pivot, firefighterPose, firefighterPartPoseMatrix);
          firefighterTemplateMatrix.copy(firefighterMatrix).multiply(firefighterPartPoseMatrix).multiply(baseMatrix);
          mesh.setMatrixAt(firefighterCount, firefighterTemplateMatrix);
          mesh.setColorAt(firefighterCount, tint);
        });
      } else {
        firefighterQuat.setFromAxisAngle(worldUp, yaw);
        firefighterNozzleDirection.copy(worldRight);
        firefighterNozzleQuat.setFromAxisAngle(firefighterNozzleDirection, firefighterPose.rootPitch);
        firefighterQuat.multiply(firefighterNozzleQuat);
        firefighterScale.set(1, 1, 1);
        firefighterNozzlePos.copy(firefighterPos).addScaledVector(worldUp, 0.14);
        firefighterMatrix.compose(firefighterNozzlePos, firefighterQuat, firefighterScale);
        firefighterMesh.setMatrixAt(firefighterCount, firefighterMatrix);
        firefighterMesh.setColorAt(
          firefighterCount,
          unit.selected ? FIREFIGHTER_SELECTED_COLOR : FIREFIGHTER_BASE_COLOR
        );
      }
      if (firefighterNozzleCount < MAX_FIREFIGHTER_INSTANCES && unit.assignedTruckId !== null) {
        writeFirefighterGripWorldPosition(firefighterPos, yaw, firefighterPose, firefighterNozzlePos);
        let aimPoint: THREE.Vector3 | null = null;
        if (unit.sprayTarget) {
          firefighterTrajectoryTarget.set(
            surface.toWorldX(unit.sprayTarget.x),
            sampleHeightAt(unit.sprayTarget.x, unit.sprayTarget.y) * heightScale + 0.05,
            surface.toWorldZ(unit.sprayTarget.y)
          );
          const sprayTrajectory = resolveWaterStreamTrajectory(
            surface,
            firefighterNozzlePos,
            firefighterTrajectoryTarget,
            resolveUnitSprayMode(unit)
          );
          firefighterNozzleAim.set(
            firefighterNozzlePos.x + sprayTrajectory.launchDirectionX,
            firefighterNozzlePos.y + sprayTrajectory.launchDirectionY,
            firefighterNozzlePos.z + sprayTrajectory.launchDirectionZ
          );
          aimPoint = firefighterNozzleAim;
        } else if (unit.attackTarget) {
          firefighterTrajectoryTarget.set(
            surface.toWorldX(unit.attackTarget.x),
            sampleHeightAt(unit.attackTarget.x, unit.attackTarget.y) * heightScale + 0.08,
            surface.toWorldZ(unit.attackTarget.y)
          );
          const attackTrajectory = resolveWaterStreamTrajectory(
            surface,
            firefighterNozzlePos,
            firefighterTrajectoryTarget,
            resolveUnitSprayMode(unit)
          );
          firefighterNozzleAim.set(
            firefighterNozzlePos.x + attackTrajectory.launchDirectionX,
            firefighterNozzlePos.y + attackTrajectory.launchDirectionY,
            firefighterNozzlePos.z + attackTrajectory.launchDirectionZ
          );
          aimPoint = firefighterNozzleAim;
        }
        firefighterNozzleDirection.copy(
          resolveNozzleDirection(unit, yaw, firefighterNozzlePos, firefighterPose, deltaSeconds, aimPoint)
        );
        firefighterNozzleQuat.setFromUnitVectors(worldUp, firefighterNozzleDirection);
        firefighterNozzleScale.set(1, 1, 1);
        firefighterNozzleMatrix.compose(firefighterNozzlePos, firefighterNozzleQuat, firefighterNozzleScale);
        firefighterNozzleMesh.setMatrixAt(firefighterNozzleCount, firefighterNozzleMatrix);
        firefighterNozzleCount += 1;
      }
      firefighterCount += 1;
    }

    Array.from(lastYawByUnitId.keys()).forEach((unitId) => {
      if (!activeUnitIds.has(unitId)) {
        lastYawByUnitId.delete(unitId);
      }
    });
    Array.from(lastForwardByUnitId.keys()).forEach((unitId) => {
      if (!activeUnitIds.has(unitId)) {
        lastForwardByUnitId.delete(unitId);
      }
    });
    Array.from(lastNozzleDirectionByUnitId.keys()).forEach((unitId) => {
      if (!activeUnitIds.has(unitId)) {
        lastNozzleDirectionByUnitId.delete(unitId);
      }
    });

    if (useTruckModel && truckModelMeshes.length > 0) {
      truckMesh.count = 0;
      truckModelMeshes.forEach(({ mesh }) => {
        mesh.count = truckCount;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) {
          mesh.instanceColor.needsUpdate = true;
        }
      });
    } else {
      truckMesh.count = truckCount;
      truckMesh.instanceMatrix.needsUpdate = true;
      if (truckMesh.instanceColor) {
        truckMesh.instanceColor.needsUpdate = true;
      }
    }
    truckSelectionMesh.count = selectedTruckCount;
    truckSelectionMesh.instanceMatrix.needsUpdate = true;
    if (useFirefighterModel && firefighterModelMeshes.length > 0) {
      firefighterMesh.count = 0;
      firefighterModelMeshes.forEach(({ mesh }) => {
        mesh.count = firefighterCount;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) {
          mesh.instanceColor.needsUpdate = true;
        }
      });
    } else {
      firefighterMesh.count = firefighterCount;
      firefighterMesh.instanceMatrix.needsUpdate = true;
      if (firefighterMesh.instanceColor) {
        firefighterMesh.instanceColor.needsUpdate = true;
      }
    }
    firefighterNozzleMesh.count = firefighterNozzleCount;
    firefighterNozzleMesh.instanceMatrix.needsUpdate = true;
  };

  const dispose = (): void => {
    disposed = true;
    clearTruckModelMeshes();
    clearFirefighterModelMeshes();
    scene.remove(truckMesh);
    scene.remove(truckSelectionMesh);
    scene.remove(firefighterMesh);
    scene.remove(firefighterNozzleMesh);
    truckGeometry.dispose();
    truckMaterial.dispose();
    truckSelectionRingGeometry.dispose();
    truckSelectionRingMaterial.dispose();
    firefighterGeometry.dispose();
    firefighterMaterial.dispose();
    firefighterNozzleGeometry.dispose();
    firefighterNozzleMaterial.dispose();
  };

  return { update, dispose };
};
