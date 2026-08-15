import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

type ScrubLobe = {
  radius: number;
  position: [number, number, number];
  scale: [number, number, number];
  rotationY: number;
};

const SCRUB_LOBES: readonly ScrubLobe[] = [
  { radius: 0.22, position: [0, 0.17, 0], scale: [1, 0.78, 0.9], rotationY: 0.18 },
  { radius: 0.17, position: [-0.17, 0.11, 0.02], scale: [0.88, 0.68, 0.82], rotationY: -0.52 },
  { radius: 0.18, position: [0.16, 0.12, -0.03], scale: [0.92, 0.72, 0.8], rotationY: 0.71 },
  { radius: 0.15, position: [0.02, 0.1, 0.15], scale: [0.84, 0.62, 0.76], rotationY: 1.07 }
];

/** A compact multi-lobe shrub used only after the native scrub-model budget is exhausted. */
export const createProceduralScrubFallbackGeometry = (): THREE.BufferGeometry => {
  const lobes = SCRUB_LOBES.map((lobe) => {
    const geometry = new THREE.IcosahedronGeometry(lobe.radius, 0);
    const transform = new THREE.Matrix4().compose(
      new THREE.Vector3(...lobe.position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, lobe.rotationY, 0)),
      new THREE.Vector3(...lobe.scale)
    );
    geometry.applyMatrix4(transform);
    return geometry;
  });
  const merged = mergeGeometries(lobes, false);
  lobes.forEach((geometry) => geometry.dispose());
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
};
