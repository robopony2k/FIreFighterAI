import * as THREE from "three";

export const GRASS_VOLUME_NOISE_FIELD_MIN_SIZE = 128;
export const GRASS_VOLUME_NOISE_FIELD_MAX_SIZE = 256;
export const GRASS_VOLUME_WIND_VECTOR_RANGE = 1.25;
export const GRASS_VOLUME_WIND_TIME_SCALE = 0.35;

export type GrassVolumeNoiseFields = {
  setWorldSize: (width: number, depth: number) => void;
  update: (
    renderer: THREE.WebGLRenderer,
    timeSeconds: number,
    windX: number,
    windZ: number,
    windStrength: number
  ) => boolean;
  getWindTexture: () => THREE.Texture | null;
  getVariationTexture: () => THREE.Texture | null;
  getResolution: () => number;
  dispose: () => void;
};

const fullscreenVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const grassNoiseFunctions = `
  float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float noise21(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float result = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 5; i++) {
      result += noise21(p) * amplitude;
      p = mat2(1.62, 1.17, -1.17, 1.62) * p;
      amplitude *= 0.5;
    }
    return result;
  }
`;

export const grassVolumeWindFieldFragmentShader = `
  precision highp float;
  uniform vec2 uWorldSize;
  uniform vec2 uWindDirection;
  uniform float uWindStrength;
  uniform float uTime;
  varying vec2 vUv;
  ${grassNoiseFunctions}

  void main() {
    vec2 worldXZ = (vUv - 0.5) * uWorldSize;
    float visualTime = uTime * ${GRASS_VOLUME_WIND_TIME_SCALE.toFixed(2)};
    vec2 baseDirection = normalize(uWindDirection + vec2(0.0001));
    vec2 tangent = vec2(-baseDirection.y, baseDirection.x);
    float alongWind = dot(worldXZ, baseDirection);
    float acrossWind = dot(worldXZ, tangent);
    float broadDistortion = fbm(worldXZ * 0.075 - baseDirection * visualTime * 0.08);
    float gustWave = sin(alongWind * 0.30 - visualTime * 1.25 + broadDistortion * 4.0 + sin(acrossWind * 0.08) * 0.8);
    float gust = smoothstep(0.35, 0.92, gustWave);
    float turbulence = fbm(worldXZ * 0.42 - baseDirection * visualTime * 0.35);
    float directionVariation = (fbm(worldXZ * 0.10 + visualTime * 0.025) - 0.5) * 0.34;
    float s = sin(directionVariation);
    float c = cos(directionVariation);
    vec2 direction = mat2(c, -s, s, c) * baseDirection;
    float magnitude = (0.25 + gust * 0.38 + turbulence * 0.10) * mix(0.35, 1.15, clamp(uWindStrength, 0.0, 1.0));
    vec2 windVector = direction * magnitude;
    gl_FragColor = vec4(
      clamp(windVector / ${GRASS_VOLUME_WIND_VECTOR_RANGE.toFixed(2)} * 0.5 + 0.5, 0.0, 1.0),
      gust,
      turbulence
    );
  }
`;

export const grassVolumeVariationFieldFragmentShader = `
  precision highp float;
  uniform vec2 uWorldSize;
  varying vec2 vUv;
  ${grassNoiseFunctions}

  void main() {
    vec2 worldXZ = (vUv - 0.5) * uWorldSize;
    float fuelVariation = fbm(worldXZ * 0.10 + vec2(12.0, 5.0));
    float localFuel = fbm(worldXZ * 0.32 - vec2(3.0, 8.0));
    float drynessVariation = fbm(worldXZ * 0.075 + vec2(-8.0, 14.0));
    float densityField = smoothstep(0.24, 0.76, fbm(worldXZ * 0.19 + vec2(21.0, -4.0)));
    gl_FragColor = vec4(fuelVariation, localFuel, drynessVariation, densityField);
  }
`;

const resolveFieldResolution = (width: number, depth: number): number => {
  const span = Math.max(1, width, depth);
  let resolution = 1;
  while (resolution < span) resolution *= 2;
  return Math.max(GRASS_VOLUME_NOISE_FIELD_MIN_SIZE, Math.min(GRASS_VOLUME_NOISE_FIELD_MAX_SIZE, resolution));
};

const createNoiseTarget = (resolution: number, name: string): THREE.WebGLRenderTarget => {
  const target = new THREE.WebGLRenderTarget(resolution, resolution, {
    depthBuffer: false,
    stencilBuffer: false,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat
  });
  target.texture.name = name;
  target.texture.colorSpace = THREE.NoColorSpace;
  target.texture.minFilter = THREE.LinearFilter;
  target.texture.magFilter = THREE.LinearFilter;
  target.texture.wrapS = THREE.ClampToEdgeWrapping;
  target.texture.wrapT = THREE.ClampToEdgeWrapping;
  target.texture.generateMipmaps = false;
  return target;
};

export const createGrassVolumeNoiseFields = (): GrassVolumeNoiseFields => {
  const worldSize = new THREE.Vector2(1, 1);
  const windUniforms = {
    uWorldSize: { value: worldSize },
    uWindDirection: { value: new THREE.Vector2(1, 0) },
    uWindStrength: { value: 0.7 },
    uTime: { value: 0 }
  };
  const variationUniforms = {
    uWorldSize: { value: worldSize }
  };
  const windMaterial = new THREE.ShaderMaterial({
    uniforms: windUniforms,
    vertexShader: fullscreenVertexShader,
    fragmentShader: grassVolumeWindFieldFragmentShader,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  });
  const variationMaterial = new THREE.ShaderMaterial({
    uniforms: variationUniforms,
    vertexShader: fullscreenVertexShader,
    fragmentShader: grassVolumeVariationFieldFragmentShader,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  });
  const geometry = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geometry, windMaterial);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  scene.add(mesh);
  let windTarget: THREE.WebGLRenderTarget | null = null;
  let variationTarget: THREE.WebGLRenderTarget | null = null;
  let resolution = GRASS_VOLUME_NOISE_FIELD_MIN_SIZE;
  let variationDirty = true;
  let failed = false;

  const disposeTargets = (): void => {
    windTarget?.dispose();
    variationTarget?.dispose();
    windTarget = null;
    variationTarget = null;
  };

  const ensureTargets = (): boolean => {
    if (failed) return false;
    if (windTarget?.width === resolution && variationTarget?.width === resolution) return true;
    disposeTargets();
    try {
      windTarget = createNoiseTarget(resolution, "grass-volume-wind-field");
      variationTarget = createNoiseTarget(resolution, "grass-volume-variation-field");
      variationDirty = true;
      return true;
    } catch (error) {
      failed = true;
      console.warn("[grassVolume] Noise-field target allocation failed.", error);
      return false;
    }
  };

  return {
    setWorldSize: (width, depth) => {
      const safeWidth = Math.max(1e-5, width);
      const safeDepth = Math.max(1e-5, depth);
      const nextResolution = resolveFieldResolution(safeWidth, safeDepth);
      if (worldSize.x !== safeWidth || worldSize.y !== safeDepth) variationDirty = true;
      worldSize.set(safeWidth, safeDepth);
      if (resolution !== nextResolution) {
        resolution = nextResolution;
        disposeTargets();
        variationDirty = true;
      }
    },
    update: (renderer, timeSeconds, windX, windZ, windStrength) => {
      if (!ensureTargets() || !windTarget || !variationTarget) return false;
      windUniforms.uTime.value = Math.max(0, timeSeconds);
      windUniforms.uWindDirection.value.set(windX, windZ).normalize();
      windUniforms.uWindStrength.value = Math.max(0, Math.min(1, windStrength));
      const previousTarget = renderer.getRenderTarget();
      try {
        if (variationDirty) {
          mesh.material = variationMaterial;
          renderer.setRenderTarget(variationTarget);
          renderer.render(scene, camera);
          variationDirty = false;
        }
        mesh.material = windMaterial;
        renderer.setRenderTarget(windTarget);
        renderer.render(scene, camera);
        return true;
      } catch (error) {
        failed = true;
        console.warn("[grassVolume] Noise-field rendering failed.", error);
        return false;
      } finally {
        renderer.setRenderTarget(previousTarget);
      }
    },
    getWindTexture: () => windTarget?.texture ?? null,
    getVariationTexture: () => variationTarget?.texture ?? null,
    getResolution: () => resolution,
    dispose: () => {
      disposeTargets();
      geometry.dispose();
      windMaterial.dispose();
      variationMaterial.dispose();
    }
  };
};
