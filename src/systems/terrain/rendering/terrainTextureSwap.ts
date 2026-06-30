import * as THREE from "three";

export const TERRAIN_TEXTURE_DISPOSAL_DELAY_FRAMES = 1;

export type PendingTerrainTextureDisposal = {
  texture: THREE.Texture;
  framesRemaining: number;
};

type TerrainMaterialWithMap = THREE.Material & { map?: THREE.Texture | null };

export const assignTerrainTextureMap = (
  material: THREE.Material | THREE.Material[],
  nextMap: THREE.Texture | null
): THREE.Texture[] => {
  const previousMaps = new Set<THREE.Texture>();
  const applyMap = (entry: THREE.Material): void => {
    const textured = entry as TerrainMaterialWithMap;
    const previousMap = textured.map ?? null;
    if (previousMap && previousMap !== nextMap) {
      previousMaps.add(previousMap);
    }
    if (previousMap !== nextMap) {
      textured.map = nextMap;
      entry.needsUpdate = true;
    }
  };

  if (Array.isArray(material)) {
    material.forEach((entry) => applyMap(entry));
  } else {
    applyMap(material);
  }
  return Array.from(previousMaps);
};

export const queueTerrainTextureDisposals = (
  queue: PendingTerrainTextureDisposal[],
  textures: THREE.Texture[],
  frameDelay = TERRAIN_TEXTURE_DISPOSAL_DELAY_FRAMES
): void => {
  const framesRemaining = Math.max(1, Math.floor(frameDelay));
  const uniqueTextures = new Set(textures);
  for (const texture of uniqueTextures) {
    const existing = queue.find((entry) => entry.texture === texture);
    if (existing) {
      existing.framesRemaining = Math.max(existing.framesRemaining, framesRemaining);
    } else {
      queue.push({ texture, framesRemaining });
    }
  }
};

export const flushTerrainTextureDisposals = (queue: PendingTerrainTextureDisposal[]): void => {
  for (let i = queue.length - 1; i >= 0; i -= 1) {
    const entry = queue[i]!;
    entry.framesRemaining -= 1;
    if (entry.framesRemaining > 0) {
      continue;
    }
    entry.texture.dispose();
    queue.splice(i, 1);
  }
};

export const disposeQueuedTerrainTextures = (queue: PendingTerrainTextureDisposal[]): void => {
  for (const entry of queue.splice(0)) {
    entry.texture.dispose();
  }
};
