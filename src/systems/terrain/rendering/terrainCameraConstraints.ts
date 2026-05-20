import * as THREE from "three";

export type TerrainCameraConstraintSurface = {
  cols: number;
  rows: number;
  heightScale: number;
  heightAtTileCoord: (tileX: number, tileY: number) => number;
  toWorldX: (tileX: number) => number;
  toWorldZ: (tileY: number) => number;
};

export type TerrainCameraConstraintOptions = {
  targetGroundClearance?: number;
  cameraGroundClearance?: number;
};

const DEFAULT_TARGET_GROUND_CLEARANCE = 0.04;
const DEFAULT_CAMERA_GROUND_CLEARANCE = 0.35;
const targetDelta = new THREE.Vector3();

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const getAxisBounds = (start: number, end: number): { min: number; max: number } => ({
  min: Math.min(start, end),
  max: Math.max(start, end)
});

const worldToTile = (worldValue: number, start: number, end: number, tileCount: number): number => {
  const span = end - start;
  if (Math.abs(span) <= 0.0001) {
    return 0;
  }
  const normalized = clamp((worldValue - start) / span, 0, 1);
  return normalized * Math.max(1, tileCount);
};

const sampleTerrainHeightWorld = (
  surface: TerrainCameraConstraintSurface,
  worldX: number,
  worldZ: number
): number => {
  const tileX = worldToTile(worldX, surface.toWorldX(0), surface.toWorldX(surface.cols), surface.cols);
  const tileY = worldToTile(worldZ, surface.toWorldZ(0), surface.toWorldZ(surface.rows), surface.rows);
  return surface.heightAtTileCoord(tileX, tileY) * surface.heightScale;
};

export const constrainCameraToTerrain = (
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  surface: TerrainCameraConstraintSurface,
  options: TerrainCameraConstraintOptions = {}
): boolean => {
  const targetGroundClearance = options.targetGroundClearance ?? DEFAULT_TARGET_GROUND_CLEARANCE;
  const cameraGroundClearance = options.cameraGroundClearance ?? DEFAULT_CAMERA_GROUND_CLEARANCE;
  const xBounds = getAxisBounds(surface.toWorldX(0), surface.toWorldX(surface.cols));
  const zBounds = getAxisBounds(surface.toWorldZ(0), surface.toWorldZ(surface.rows));
  const nextTargetX = clamp(target.x, xBounds.min, xBounds.max);
  const nextTargetZ = clamp(target.z, zBounds.min, zBounds.max);
  const nextTargetY = sampleTerrainHeightWorld(surface, nextTargetX, nextTargetZ) + targetGroundClearance;
  targetDelta.set(
    nextTargetX - target.x,
    nextTargetY - target.y,
    nextTargetZ - target.z
  );
  let changed = targetDelta.lengthSq() > 1e-10;

  if (changed) {
    target.add(targetDelta);
    camera.position.add(targetDelta);
  }

  const cameraGroundY = sampleTerrainHeightWorld(surface, camera.position.x, camera.position.z) + cameraGroundClearance;
  if (camera.position.y < cameraGroundY) {
    camera.position.y = cameraGroundY;
    changed = true;
  }

  if (changed) {
    camera.lookAt(target);
  }

  return changed;
};
