import * as THREE from "three";

const ROCK_TEXTURE_PATH = "assets/textures/rock_texture.png";

let cachedRockTexture: THREE.Texture | null = null;
let warnedRockTextureFailure = false;

export const getRockTextureAsset = (): THREE.Texture => {
  if (cachedRockTexture) {
    return cachedRockTexture;
  }

  const loader = new THREE.TextureLoader();
  const texture = loader.load(
    ROCK_TEXTURE_PATH,
    (loaded) => {
      loaded.wrapS = THREE.RepeatWrapping;
      loaded.wrapT = THREE.RepeatWrapping;
      loaded.colorSpace = THREE.NoColorSpace;
      loaded.magFilter = THREE.LinearFilter;
      loaded.minFilter = THREE.LinearMipmapLinearFilter;
      loaded.generateMipmaps = true;
      loaded.needsUpdate = true;
    },
    undefined,
    (error) => {
      if (!warnedRockTextureFailure) {
        warnedRockTextureFailure = true;
        console.warn(`[mountainRockMaterial] Failed to load ${ROCK_TEXTURE_PATH}; mountain rock detail will be reduced.`, error);
      }
    }
  );

  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  cachedRockTexture = texture;
  return texture;
};
