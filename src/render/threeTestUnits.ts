import * as THREE from "three";
import type { WorldState } from "../core/state.js";
import { getTerrainHeightScale, type TerrainSample } from "./threeTestTerrain.js";

const TRUCK_BASE_COLOR = new THREE.Color(0xc0462c);
const TRUCK_SELECTED_COLOR = new THREE.Color(0xffd166);
const FIREFIGHTER_BASE_COLOR = new THREE.Color(0xf0b33b);
const FIREFIGHTER_SELECTED_COLOR = new THREE.Color(0xffef99);
const UNIT_BASE_Y_OFFSET = 0.02;
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
    terrainSize: { width: number; depth: number } | null
  ) => void;
  dispose: () => void;
};

export const createThreeTestUnitsLayer = (scene: THREE.Scene): ThreeTestUnitsLayer => {
  const truckGeometry = new THREE.BoxGeometry(0.38, 0.18, 0.64);
  const truckMaterial = new THREE.MeshStandardMaterial({
    color: TRUCK_BASE_COLOR,
    roughness: 0.72,
    metalness: 0.04,
    vertexColors: true
  });
  const truckMesh = new THREE.InstancedMesh(truckGeometry, truckMaterial, MAX_TRUCK_INSTANCES);
  truckMesh.count = 0;
  truckMesh.frustumCulled = false;
  scene.add(truckMesh);

  const firefighterGeometry = new THREE.CylinderGeometry(0.08, 0.1, 0.34, 6);
  const firefighterMaterial = new THREE.MeshStandardMaterial({
    color: FIREFIGHTER_BASE_COLOR,
    roughness: 0.78,
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
  const yawAxis = new THREE.Vector3(0, 1, 0);

  const update = (
    world: WorldState,
    sample: TerrainSample | null,
    terrainSize: { width: number; depth: number } | null
  ): void => {
    if (!sample || !terrainSize || world.units.length === 0) {
      truckMesh.count = 0;
      firefighterMesh.count = 0;
      return;
    }

    const cols = Math.max(1, sample.cols);
    const rows = Math.max(1, sample.rows);
    const heightScale = getTerrainHeightScale(cols, rows);
    let truckCount = 0;
    let firefighterCount = 0;

    for (let i = 0; i < world.units.length; i += 1) {
      const unit = world.units[i];
      if (!unit) {
        continue;
      }
      if (unit.kind === "firefighter" && unit.carrierId !== null) {
        continue;
      }
      const wx = toWorldX(unit.x, cols, terrainSize.width);
      const wz = toWorldZ(unit.y, rows, terrainSize.depth);
      const wy = sampleHeight(sample, unit.x, unit.y) * heightScale;
      const targetX = unit.target ? unit.target.x + 0.5 : null;
      const targetY = unit.target ? unit.target.y + 0.5 : null;
      const yaw =
        targetX !== null && targetY !== null ? Math.atan2(targetX - unit.x, targetY - unit.y) : 0;

      if (unit.kind === "truck") {
        if (truckCount >= MAX_TRUCK_INSTANCES) {
          continue;
        }
        truckPos.set(wx, wy + 0.11 + UNIT_BASE_Y_OFFSET, wz);
        truckQuat.setFromAxisAngle(yawAxis, yaw);
        truckMatrix.compose(truckPos, truckQuat, truckScale);
        truckMesh.setMatrixAt(truckCount, truckMatrix);
        truckMesh.setColorAt(truckCount, unit.selected ? TRUCK_SELECTED_COLOR : TRUCK_BASE_COLOR);
        truckCount += 1;
        continue;
      }

      if (firefighterCount >= MAX_FIREFIGHTER_INSTANCES) {
        continue;
      }
      firefighterPos.set(wx, wy + 0.17 + UNIT_BASE_Y_OFFSET, wz);
      firefighterQuat.setFromAxisAngle(yawAxis, yaw);
      firefighterMatrix.compose(firefighterPos, firefighterQuat, firefighterScale);
      firefighterMesh.setMatrixAt(firefighterCount, firefighterMatrix);
      firefighterMesh.setColorAt(
        firefighterCount,
        unit.selected ? FIREFIGHTER_SELECTED_COLOR : FIREFIGHTER_BASE_COLOR
      );
      firefighterCount += 1;
    }

    truckMesh.count = truckCount;
    firefighterMesh.count = firefighterCount;
    truckMesh.instanceMatrix.needsUpdate = true;
    firefighterMesh.instanceMatrix.needsUpdate = true;
    if (truckMesh.instanceColor) {
      truckMesh.instanceColor.needsUpdate = true;
    }
    if (firefighterMesh.instanceColor) {
      firefighterMesh.instanceColor.needsUpdate = true;
    }
  };

  const dispose = (): void => {
    scene.remove(truckMesh);
    scene.remove(firefighterMesh);
    truckGeometry.dispose();
    truckMaterial.dispose();
    firefighterGeometry.dispose();
    firefighterMaterial.dispose();
  };

  return { update, dispose };
};
