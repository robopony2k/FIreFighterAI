import * as THREE from "three";

export const FIRE_ANCHOR_DEBUG_TINT_STRENGTH = 0.82;
export const GLOW_ANCHOR_DEBUG_TINT_STRENGTH = 0.74;
export const SMOKE_OCCL_STRENGTH_ALPHA = 0.65;
export const SMOKE_OCCL_STRENGTH_EMISSIVE = 0.55;
export const EMISSIVE_CLAMP = 1.55;
export const EMISSIVE_KNEE = 1.25;

export const createRadialTexture = (
  size: number,
  stops: Array<{ stop: number; color: string }>
): THREE.CanvasTexture => {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas not supported");
  }
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  stops.forEach((entry) => {
    gradient.addColorStop(entry.stop, entry.color);
  });
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
};

export const createFireShaderMaterial = (
  vertexShader: string,
  fragmentShader: string,
  core: number,
  alphaScale: number
): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uCore: { value: core },
      uAlphaScale: { value: alphaScale },
      uWind: { value: new THREE.Vector2() },
      uDebugTintStrength: { value: 0 }
    },
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    toneMapped: false
  });
