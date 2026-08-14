import * as THREE from "three";

export const isSharedTreeImpostorTexture = (texture: THREE.Texture | null | undefined): boolean =>
  texture?.userData?.treeImpostorSharedTexture === true;

export const disposeTreeImpostorMeshResources = (mesh: THREE.InstancedMesh): void => {
  mesh.removeFromParent();
  mesh.geometry.dispose();
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  materials.forEach((material) => material.dispose());
};

export const disposeTerrainVegetationRoot = (root: THREE.Group): void => {
  root.removeFromParent();
  const geometries = new Set<THREE.BufferGeometry>();
  const ownedMaterials = new Set<THREE.Material>();
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    geometries.add(child.geometry);
    if (child.userData.terrainVegetationOwnsMaterial !== true) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => ownedMaterials.add(material));
  });
  geometries.forEach((geometry) => geometry.dispose());
  ownedMaterials.forEach((material) => material.dispose());
  root.clear();
};
