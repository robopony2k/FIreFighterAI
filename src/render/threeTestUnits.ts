import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { TILE_TYPE_IDS, type WorldState } from "../core/state.js";
import { buildSampleHeightMap, getTerrainHeightScale, getTerrainStep, type TerrainSample } from "./threeTestTerrain.js";
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
const FIREFIGHTER_MODEL_GROUND_OFFSET = 0.03;
const TRUCK_NORMAL_SAMPLE_TILES = 0.24;
const TRUCK_SELECTION_RING_INNER_RADIUS = 0.32;
const TRUCK_SELECTION_RING_OUTER_RADIUS = 0.4;
const TRUCK_SELECTION_RING_Y_OFFSET = 0.04;
const MAX_TRUCK_INSTANCES = 512;
const MAX_FIREFIGHTER_INSTANCES = 1024;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const bilerp = (h00: number, h10: number, h01: number, h11: number, tx: number, ty: number): number => {
  const hx0 = h00 * (1 - tx) + h10 * tx;
  const hx1 = h01 * (1 - tx) + h11 * tx;
  return hx0 * (1 - ty) + hx1 * ty;
};

const sampleHeight = (sample: TerrainSample, tileX: number, tileY: number): number => {
  const cols = Math.max(1, sample.cols);
  const rows = Math.max(1, sample.rows);
  const x = clamp(tileX - 0.5, 0, cols - 1);
  const y = clamp(tileY - 0.5, 0, rows - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(cols - 1, x0 + 1);
  const y1 = Math.min(rows - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const idx00 = y0 * cols + x0;
  const idx10 = y0 * cols + x1;
  const idx01 = y1 * cols + x0;
  const idx11 = y1 * cols + x1;
  const h00 = sample.elevations[idx00] ?? 0;
  const h10 = sample.elevations[idx10] ?? h00;
  const h01 = sample.elevations[idx01] ?? h00;
  const h11 = sample.elevations[idx11] ?? h00;
  return bilerp(h00, h10, h01, h11, tx, ty);
};

const toWorldX = (tileX: number, cols: number, width: number): number => (tileX / Math.max(1, cols) - 0.5) * width;
const toWorldZ = (tileY: number, rows: number, depth: number): number => (tileY / Math.max(1, rows) - 0.5) * depth;

export type ThreeTestUnitsLayer = {
  update: (
    world: WorldState,
    sample: TerrainSample | null,
    terrainSize: { width: number; depth: number } | null,
    interpolationAlpha: number
  ) => void;
  dispose: () => void;
};

type UnitModelTemplate = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  baseMatrix: THREE.Matrix4;
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
  const firefighterModelMeshes: Array<{ mesh: THREE.InstancedMesh; baseMatrix: THREE.Matrix4 }> = [];
  let useFirefighterModel = false;
  let firefighterModelScale = 1;
  let firefighterModelLift = 0.17 + UNIT_BASE_Y_OFFSET;
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
      templates.push({ geometry, material, baseMatrix });
    });
    if (templates.length <= 0) {
      return null;
    }
    const size = new THREE.Vector3();
    worldBounds.getSize(size);
    return { templates, size };
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
      const extracted = extractModelTemplates(gltf.scene);
      if (!extracted) {
        return;
      }
      clearFirefighterModelMeshes();
      firefighterModelScale = FIREFIGHTER_MODEL_TARGET_HEIGHT / Math.max(0.01, extracted.size.y);
      firefighterModelLift = FIREFIGHTER_MODEL_GROUND_OFFSET + UNIT_BASE_Y_OFFSET;
      extracted.templates.forEach((template) => {
        const mesh = new THREE.InstancedMesh(template.geometry, template.material, MAX_FIREFIGHTER_INSTANCES);
        mesh.count = 0;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        scene.add(mesh);
        firefighterModelMeshes.push({
          mesh,
          baseMatrix: template.baseMatrix
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

  const truckMatrix = new THREE.Matrix4();
  const firefighterMatrix = new THREE.Matrix4();
  const truckPos = new THREE.Vector3();
  const firefighterPos = new THREE.Vector3();
  const truckQuat = new THREE.Quaternion();
  const firefighterQuat = new THREE.Quaternion();
  const truckScale = new THREE.Vector3(1, 1, 1);
  const firefighterScale = new THREE.Vector3(1, 1, 1);
  const worldUp = new THREE.Vector3(0, 1, 0);
  const worldForward = new THREE.Vector3(0, 0, 1);
  const truckModelYawOffsetQuat = new THREE.Quaternion().setFromAxisAngle(worldUp, TRUCK_MODEL_YAW_OFFSET);
  const firefighterModelYawOffsetQuat = new THREE.Quaternion().setFromAxisAngle(worldUp, FIREFIGHTER_MODEL_YAW_OFFSET);
  const surfaceNormal = new THREE.Vector3();
  const surfaceForward = new THREE.Vector3();
  const surfaceRight = new THREE.Vector3();
  const projectedForward = new THREE.Vector3();
  const truckBasis = new THREE.Matrix4();
  const truckTemplateMatrix = new THREE.Matrix4();
  const firefighterTemplateMatrix = new THREE.Matrix4();
  const truckSelectionMatrix = new THREE.Matrix4();
  const truckSelectionPos = new THREE.Vector3();
  const truckSelectionQuat = new THREE.Quaternion();
  const truckSelectionScale = new THREE.Vector3(1, 1, 1);
  const lastYawByUnitId = new Map<number, number>();
  const lastForwardByUnitId = new Map<number, THREE.Vector3>();
  let cachedSurfaceHeights: Float32Array | null = null;
  let cachedSurfaceCols = 0;
  let cachedSurfaceRows = 0;
  let cachedSurfaceStep = 1;
  let cachedSurfaceElevationsRef: Float32Array | null = null;
  let cachedSurfaceTileTypesRef: Uint8Array | undefined;

  const ensureRenderedSurfaceCache = (
    sample: TerrainSample
  ): { heights: Float32Array | null; cols: number; rows: number; step: number } => {
    const step = getTerrainStep(Math.max(sample.cols, sample.rows), sample.fullResolution ?? false);
    const sampleCols = Math.floor((sample.cols - 1) / step) + 1;
    const sampleRows = Math.floor((sample.rows - 1) / step) + 1;
    const needsRebuild =
      !cachedSurfaceHeights ||
      cachedSurfaceCols !== sampleCols ||
      cachedSurfaceRows !== sampleRows ||
      cachedSurfaceStep !== step ||
      cachedSurfaceElevationsRef !== sample.elevations ||
      cachedSurfaceTileTypesRef !== sample.tileTypes;
    if (needsRebuild) {
      cachedSurfaceHeights = buildSampleHeightMap(sample, sampleCols, sampleRows, step, TILE_TYPE_IDS.water);
      cachedSurfaceCols = sampleCols;
      cachedSurfaceRows = sampleRows;
      cachedSurfaceStep = step;
      cachedSurfaceElevationsRef = sample.elevations;
      cachedSurfaceTileTypesRef = sample.tileTypes;
    }
    return {
      heights: cachedSurfaceHeights,
      cols: cachedSurfaceCols,
      rows: cachedSurfaceRows,
      step: cachedSurfaceStep
    };
  };

  const sampleRenderedHeight = (
    surface: { heights: Float32Array | null; cols: number; rows: number; step: number },
    sample: TerrainSample,
    tileX: number,
    tileY: number
  ): number => {
    if (!surface.heights || surface.step <= 1 || surface.cols <= 1 || surface.rows <= 1) {
      return sampleHeight(sample, tileX, tileY);
    }
    const sx = clamp((tileX - 0.5) / surface.step, 0, surface.cols - 1);
    const sy = clamp((tileY - 0.5) / surface.step, 0, surface.rows - 1);
    const x0 = Math.floor(sx);
    const y0 = Math.floor(sy);
    const x1 = Math.min(surface.cols - 1, x0 + 1);
    const y1 = Math.min(surface.rows - 1, y0 + 1);
    const tx = sx - x0;
    const ty = sy - y0;
    const idx00 = y0 * surface.cols + x0;
    const idx10 = y0 * surface.cols + x1;
    const idx01 = y1 * surface.cols + x0;
    const idx11 = y1 * surface.cols + x1;
    const h00 = surface.heights[idx00] ?? 0;
    const h10 = surface.heights[idx10] ?? h00;
    const h01 = surface.heights[idx01] ?? h00;
    const h11 = surface.heights[idx11] ?? h00;
    return bilerp(h00, h10, h01, h11, tx, ty);
  };

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

  const resolveYaw = (unit: WorldState["units"][number], x: number, y: number): number => {
    let targetX: number | null = null;
    let targetY: number | null = null;
    if (unit.kind === "firefighter" && unit.sprayTarget) {
      const sprayRange = unit.hoseRange + Math.max(0.35, unit.radius * 0.35);
      const sprayDist = Math.hypot(unit.sprayTarget.x - x, unit.sprayTarget.y - y);
      if (sprayDist <= sprayRange || unit.pathIndex >= unit.path.length) {
        targetX = unit.sprayTarget.x;
        targetY = unit.sprayTarget.y;
      }
    }
    if (targetX === null && targetY === null && unit.pathIndex < unit.path.length) {
      const waypoint = unit.path[unit.pathIndex];
      targetX = waypoint.x + 0.5;
      targetY = waypoint.y + 0.5;
    } else if (targetX === null && targetY === null && unit.target) {
      targetX = unit.target.x + 0.5;
      targetY = unit.target.y + 0.5;
    } else if (targetX === null && targetY === null && unit.kind === "firefighter" && unit.attackTarget) {
      targetX = unit.attackTarget.x;
      targetY = unit.attackTarget.y;
    } else {
      const motionX = unit.x - unit.prevX;
      const motionY = unit.y - unit.prevY;
      if (motionX * motionX + motionY * motionY > 1e-8) {
        targetX = x + motionX;
        targetY = y + motionY;
      }
    }
    if (targetX === null || targetY === null) {
      return lastYawByUnitId.get(unit.id) ?? 0;
    }
    const dirX = targetX - x;
    const dirY = targetY - y;
    if (dirX * dirX + dirY * dirY <= 1e-8) {
      return lastYawByUnitId.get(unit.id) ?? 0;
    }
    const yaw = Math.atan2(dirX, dirY);
    lastYawByUnitId.set(unit.id, yaw);
    return yaw;
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
    sample: TerrainSample | null,
    terrainSize: { width: number; depth: number } | null,
    interpolationAlpha: number
  ): void => {
    if (!sample || !terrainSize || world.units.length === 0) {
      truckMesh.count = 0;
      truckSelectionMesh.count = 0;
      truckModelMeshes.forEach(({ mesh }) => {
        mesh.count = 0;
      });
      firefighterMesh.count = 0;
      firefighterModelMeshes.forEach(({ mesh }) => {
        mesh.count = 0;
      });
      lastYawByUnitId.clear();
      lastForwardByUnitId.clear();
      return;
    }

    const cols = Math.max(1, sample.cols);
    const rows = Math.max(1, sample.rows);
    const heightScale = getTerrainHeightScale(cols, rows);
    const renderedSurface = ensureRenderedSurfaceCache(sample);
    const normalSampleOffset = Math.max(TRUCK_NORMAL_SAMPLE_TILES, renderedSurface.step * 0.35);
    const sampleHeightAt = (tileX: number, tileY: number): number =>
      sampleRenderedHeight(renderedSurface, sample, tileX, tileY);
    let truckCount = 0;
    let selectedTruckCount = 0;
    let firefighterCount = 0;
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
      const wx = toWorldX(interpolated.x, cols, terrainSize.width);
      const wz = toWorldZ(interpolated.y, rows, terrainSize.depth);
      const wy = sampleHeightAt(interpolated.x, interpolated.y) * heightScale;
      const yaw = resolveYaw(unit, interpolated.x, interpolated.y);

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
          truckPos.set(wx, wy, wz).addScaledVector(surfaceNormal, truckModelLift);
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
          truckPos.set(wx, wy, wz).addScaledVector(surfaceNormal, 0.11 + UNIT_BASE_Y_OFFSET);
          truckScale.set(1, 1, 1);
          truckMatrix.compose(truckPos, truckQuat, truckScale);
          truckMesh.setMatrixAt(truckCount, truckMatrix);
          truckMesh.setColorAt(truckCount, unit.selected ? TRUCK_SELECTED_COLOR : TRUCK_BASE_COLOR);
        }
        if (unit.selected && selectedTruckCount < MAX_TRUCK_INSTANCES) {
          truckSelectionPos.set(wx, wy, wz).addScaledVector(surfaceNormal, TRUCK_SELECTION_RING_Y_OFFSET);
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
      if (useFirefighterModel && firefighterModelMeshes.length > 0) {
        firefighterPos.set(wx, wy + firefighterModelLift, wz);
        firefighterQuat.setFromAxisAngle(worldUp, yaw);
        firefighterQuat.multiply(firefighterModelYawOffsetQuat);
        firefighterScale.setScalar(firefighterModelScale);
        firefighterMatrix.compose(firefighterPos, firefighterQuat, firefighterScale);
        const tint = unit.selected ? FIREFIGHTER_MODEL_SELECTED_TINT : FIREFIGHTER_MODEL_BASE_TINT;
        firefighterModelMeshes.forEach(({ mesh, baseMatrix }) => {
          firefighterTemplateMatrix.copy(firefighterMatrix).multiply(baseMatrix);
          mesh.setMatrixAt(firefighterCount, firefighterTemplateMatrix);
          mesh.setColorAt(firefighterCount, tint);
        });
      } else {
        firefighterPos.set(wx, wy + 0.17 + UNIT_BASE_Y_OFFSET, wz);
        firefighterQuat.setFromAxisAngle(worldUp, yaw);
        firefighterScale.set(1, 1, 1);
        firefighterMatrix.compose(firefighterPos, firefighterQuat, firefighterScale);
        firefighterMesh.setMatrixAt(firefighterCount, firefighterMatrix);
        firefighterMesh.setColorAt(
          firefighterCount,
          unit.selected ? FIREFIGHTER_SELECTED_COLOR : FIREFIGHTER_BASE_COLOR
        );
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
  };

  const dispose = (): void => {
    disposed = true;
    clearTruckModelMeshes();
    clearFirefighterModelMeshes();
    scene.remove(truckMesh);
    scene.remove(truckSelectionMesh);
    scene.remove(firefighterMesh);
    truckGeometry.dispose();
    truckMaterial.dispose();
    truckSelectionRingGeometry.dispose();
    truckSelectionRingMaterial.dispose();
    firefighterGeometry.dispose();
    firefighterMaterial.dispose();
  };

  return { update, dispose };
};
