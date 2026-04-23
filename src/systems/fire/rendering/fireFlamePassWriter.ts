import * as THREE from "three";

import type { FireAnchorSource } from "./fireFxTypes.js";

export const FIRE_ANCHOR_DEBUG_COLORS: Record<FireAnchorSource, readonly [number, number, number]> = {
  tree: [0.24, 1.08, 0.34],
  structure: [0.24, 0.74, 1.08],
  terrainSurface: [1.16, 0.66, 0.12],
  rawFallback: [1.2, 0.2, 1.2]
};

const getFireAnchorDebugColor = (source: FireAnchorSource): readonly [number, number, number] =>
  FIRE_ANCHOR_DEBUG_COLORS[source];

const mixColorChannel = (base: number, target: number, alpha: number): number => base * (1 - alpha) + target * alpha;

export const applyAnchorDebugGlowTint = (
  source: FireAnchorSource,
  r: number,
  g: number,
  b: number,
  tintStrength: number
): readonly [number, number, number] => {
  if (tintStrength <= 0) {
    return [r, g, b] as const;
  }
  const peak = Math.max(1, r, g, b);
  const [debugR, debugG, debugB] = getFireAnchorDebugColor(source);
  return [
    mixColorChannel(r, debugR * peak, tintStrength),
    mixColorChannel(g, debugG * peak, tintStrength),
    mixColorChannel(b, debugB * peak, tintStrength)
  ] as const;
};

export const setFireDebugColor = (
  attr: THREE.InstancedBufferAttribute,
  index: number,
  source: FireAnchorSource
): void => {
  const [r, g, b] = getFireAnchorDebugColor(source);
  attr.setXYZ(index, r, g, b);
};

export const setGlowColor = (
  attr: THREE.InstancedBufferAttribute | null,
  index: number,
  source: FireAnchorSource,
  r: number,
  g: number,
  b: number,
  tintStrength: number
): void => {
  if (!attr) {
    return;
  }
  const [tintedR, tintedG, tintedB] = applyAnchorDebugGlowTint(source, r, g, b, tintStrength);
  attr.setXYZ(index, tintedR, tintedG, tintedB);
};

export const pushSparkPoint = (
  positions: Float32Array,
  colors: Float32Array,
  count: number,
  maxCount: number,
  x: number,
  y: number,
  z: number,
  r: number,
  g: number,
  b: number
): number => {
  if (count >= maxCount) {
    return count;
  }
  const base = count * 3;
  positions[base] = x;
  positions[base + 1] = y;
  positions[base + 2] = z;
  colors[base] = r;
  colors[base + 1] = g;
  colors[base + 2] = b;
  return count + 1;
};

export const setSparkStreakTransform = (
  billboard: THREE.Object3D,
  camera: THREE.Camera,
  scratchDirection: THREE.Vector3,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  dirX: number,
  dirY: number,
  dirZ: number
): void => {
  billboard.position.set(x, y, z);
  billboard.quaternion.copy(camera.quaternion);
  scratchDirection.set(dirX, dirY, dirZ);
  if (scratchDirection.lengthSq() > 0.000001) {
    scratchDirection.transformDirection(camera.matrixWorldInverse);
    const screenLen = Math.hypot(scratchDirection.x, scratchDirection.y);
    if (screenLen > 0.0001) {
      billboard.rotateZ(-Math.atan2(scratchDirection.x, scratchDirection.y));
    }
  }
  billboard.scale.set(width, height, width);
  billboard.updateMatrix();
};
