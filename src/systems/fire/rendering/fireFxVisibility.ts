import * as THREE from "three";

import type { FireFxTerrainSize } from "./fireFxTypes.js";

export type FireFxVisibilityStats = {
  candidateTiles: number;
  visibleTiles: number;
  culledTiles: number;
  frontCorridorsTested: number;
  frontCorridorsCulled: number;
  frontCorridorsEmitted: number;
  instancesCulledByVisibility: number;
  smokeParticlesCulledByVisibility: number;
};

export type FireFxVisibilityContext = {
  stats: FireFxVisibilityStats;
  isSphereVisible: (x: number, y: number, z: number, radius: number) => boolean;
  isTileVisible: (tileX: number, tileY: number, radiusScale?: number) => boolean;
};

export const createFireFxVisibilityStats = (): FireFxVisibilityStats => ({
  candidateTiles: 0,
  visibleTiles: 0,
  culledTiles: 0,
  frontCorridorsTested: 0,
  frontCorridorsCulled: 0,
  frontCorridorsEmitted: 0,
  instancesCulledByVisibility: 0,
  smokeParticlesCulledByVisibility: 0
});

export const createFireFxVisibilityContext = (
  camera: THREE.Camera,
  terrainSize: FireFxTerrainSize,
  cols: number,
  rows: number,
  tileSpan: number,
  heightScale: number
): FireFxVisibilityContext => {
  const viewProjection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(viewProjection);
  const sphere = new THREE.Sphere();
  const center = new THREE.Vector3();
  const cameraPosition = new THREE.Vector3();
  camera.getWorldPosition(cameraPosition);
  const stats = createFireFxVisibilityStats();
  const tileRadius = Math.max(tileSpan * 6.5, heightScale * 0.32);
  const tileCenterY = Math.max(tileSpan * 1.3, heightScale * 0.38);
  const nearCameraCullBypassDistance = Math.max(tileSpan * 18, heightScale * 0.75);

  const intersectsExpandedSphere = (x: number, y: number, z: number, radius: number): boolean => {
    center.set(x, y, z);
    const safeRadius = Math.max(tileSpan * 2.5, radius);
    if (center.distanceTo(cameraPosition) <= safeRadius + nearCameraCullBypassDistance) {
      return true;
    }
    sphere.center.copy(center);
    sphere.radius = safeRadius;
    return frustum.intersectsSphere(sphere);
  };

  return {
    stats,
    isSphereVisible: (x: number, y: number, z: number, radius: number): boolean => {
      return intersectsExpandedSphere(x, y, z, radius + tileSpan * 4);
    },
    isTileVisible: (tileX: number, tileY: number, radiusScale = 1): boolean => {
      const x = ((tileX + 0.5) / Math.max(1, cols) - 0.5) * terrainSize.width;
      const z = ((tileY + 0.5) / Math.max(1, rows) - 0.5) * terrainSize.depth;
      return intersectsExpandedSphere(x, tileCenterY, z, tileRadius * Math.max(1, radiusScale));
    }
  };
};
