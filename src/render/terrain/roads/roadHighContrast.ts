import * as THREE from "three";

export const TERRAIN_ROAD_VISUAL_USER_DATA = "terrainRoadVisual";
export const ROAD_HIGH_CONTRAST_COLOR_HEX = 0xfff200;

const ROAD_HIGH_CONTRAST_ORIGINAL_USER_DATA = "roadHighContrastOriginal";

type RoadHighContrastOriginalMaterial = {
  colorHex: number;
  emissiveHex: number;
  emissiveIntensity: number;
  emissiveMap: THREE.Texture | null;
  toneMapped: boolean;
};

const setMaterialHighContrast = (material: THREE.Material, enabled: boolean): boolean => {
  if (!(material instanceof THREE.MeshStandardMaterial)) {
    return false;
  }
  const stored = material.userData[ROAD_HIGH_CONTRAST_ORIGINAL_USER_DATA] as
    | RoadHighContrastOriginalMaterial
    | undefined;
  if (!enabled) {
    if (!stored) {
      return false;
    }
    material.color.setHex(stored.colorHex);
    material.emissive.setHex(stored.emissiveHex);
    material.emissiveIntensity = stored.emissiveIntensity;
    material.emissiveMap = stored.emissiveMap;
    material.toneMapped = stored.toneMapped;
    delete material.userData[ROAD_HIGH_CONTRAST_ORIGINAL_USER_DATA];
    material.needsUpdate = true;
    return true;
  }
  if (!stored) {
    material.userData[ROAD_HIGH_CONTRAST_ORIGINAL_USER_DATA] = {
      colorHex: material.color.getHex(),
      emissiveHex: material.emissive.getHex(),
      emissiveIntensity: material.emissiveIntensity,
      emissiveMap: material.emissiveMap,
      toneMapped: material.toneMapped
    } satisfies RoadHighContrastOriginalMaterial;
  }
  material.color.setHex(material.map ? 0xffffff : ROAD_HIGH_CONTRAST_COLOR_HEX);
  material.emissive.setHex(ROAD_HIGH_CONTRAST_COLOR_HEX);
  material.emissiveIntensity = 3;
  material.emissiveMap = material.map;
  material.toneMapped = false;
  material.needsUpdate = true;
  return true;
};

export const setTerrainRoadHighContrast = (terrainRoot: THREE.Object3D, enabled: boolean): number => {
  let changedMaterialCount = 0;
  const roadVisualRoots = terrainRoot.children.filter(
    (child) => typeof child.userData?.[TERRAIN_ROAD_VISUAL_USER_DATA] === "string"
  );
  for (let i = 0; i < roadVisualRoots.length; i += 1) {
    roadVisualRoots[i]!.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) {
        return;
      }
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (let materialIndex = 0; materialIndex < materials.length; materialIndex += 1) {
        if (setMaterialHighContrast(materials[materialIndex]!, enabled)) {
          changedMaterialCount += 1;
        }
      }
    });
  }
  return changedMaterialCount;
};
