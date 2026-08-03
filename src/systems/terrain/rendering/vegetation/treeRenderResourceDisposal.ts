import * as THREE from "three";

export const isSharedTreeImpostorTexture = (texture: THREE.Texture | null | undefined): boolean =>
  texture?.userData?.treeImpostorSharedTexture === true;

export const disposeTreeImpostorMeshResources = (mesh: THREE.InstancedMesh): void => {
  mesh.removeFromParent();
  mesh.geometry.dispose();
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  materials.forEach((material) => material.dispose());
};

