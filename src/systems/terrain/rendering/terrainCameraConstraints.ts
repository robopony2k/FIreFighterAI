import * as THREE from "three";

export type TerrainCameraConstraintSurface = {
  cols: number;
  rows: number;
  heightScale: number;
  heightAtTileCoord: (tileX: number, tileY: number) => number;
  toRenderedWorldX: (tileX: number) => number;
  toRenderedWorldZ: (tileY: number) => number;
  renderedWorldToTileX: (worldX: number) => number;
  renderedWorldToTileY: (worldZ: number) => number;
};

export type TerrainCameraConstraintOptions = {
  targetGroundClearance?: number;
  cameraGroundClearance?: number;
};

export type TerrainCameraFocusDistanceOptions = {
  preferredDistance: number;
  framingRadiusWorld: number;
  verticalFovDeg: number;
  aspect: number;
  minDistance: number;
  maxDistance: number;
  framingPadding?: number;
};

const DEFAULT_TARGET_GROUND_CLEARANCE = 0.04;
const DEFAULT_CAMERA_GROUND_CLEARANCE = 0.35;
const targetDelta = new THREE.Vector3();

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const getAxisBounds = (start: number, end: number): { min: number; max: number } => ({
  min: Math.min(start, end),
  max: Math.max(start, end)
});

const sampleTerrainHeightWorld = (
  surface: TerrainCameraConstraintSurface,
  worldX: number,
  worldZ: number
): number => {
  const tileX = surface.renderedWorldToTileX(worldX);
  const tileY = surface.renderedWorldToTileY(worldZ);
  return surface.heightAtTileCoord(tileX, tileY) * surface.heightScale;
};

export const resolveTerrainCameraFocusPoint = (
  surface: TerrainCameraConstraintSurface,
  tileX: number,
  tileY: number,
  targetGroundClearance = DEFAULT_TARGET_GROUND_CLEARANCE
): THREE.Vector3 => {
  const clampedTileX = clamp(tileX, 0, Math.max(0, surface.cols - 1));
  const clampedTileY = clamp(tileY, 0, Math.max(0, surface.rows - 1));
  const worldX = surface.toRenderedWorldX(clampedTileX);
  const worldZ = surface.toRenderedWorldZ(clampedTileY);
  const worldY = surface.heightAtTileCoord(clampedTileX, clampedTileY) * surface.heightScale;
  return new THREE.Vector3(worldX, worldY + targetGroundClearance, worldZ);
};

export const resolveAspectAwareFocusDistance = ({
  preferredDistance,
  framingRadiusWorld,
  verticalFovDeg,
  aspect,
  minDistance,
  maxDistance,
  framingPadding = 1.2
}: TerrainCameraFocusDistanceOptions): number => {
  const verticalFov = THREE.MathUtils.degToRad(clamp(verticalFovDeg, 1, 179));
  const safeAspect = Math.max(0.01, aspect);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov * 0.5) * safeAspect);
  const fitFov = Math.max(THREE.MathUtils.degToRad(1), Math.min(verticalFov, horizontalFov));
  const framingDistance =
    Math.max(0, framingRadiusWorld) * Math.max(1, framingPadding) /
    Math.max(0.01, Math.sin(fitFov * 0.5));
  return clamp(Math.max(preferredDistance, framingDistance), minDistance, maxDistance);
};

export const constrainCameraToTerrain = (
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  surface: TerrainCameraConstraintSurface,
  options: TerrainCameraConstraintOptions = {}
): boolean => {
  const targetGroundClearance = options.targetGroundClearance ?? DEFAULT_TARGET_GROUND_CLEARANCE;
  const cameraGroundClearance = options.cameraGroundClearance ?? DEFAULT_CAMERA_GROUND_CLEARANCE;
  const xBounds = getAxisBounds(surface.toRenderedWorldX(0), surface.toRenderedWorldX(surface.cols - 1));
  const zBounds = getAxisBounds(surface.toRenderedWorldZ(0), surface.toRenderedWorldZ(surface.rows - 1));
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
