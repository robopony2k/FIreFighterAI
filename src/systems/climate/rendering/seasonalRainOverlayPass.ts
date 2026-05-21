import * as THREE from "three";
import { createFullscreenPass, fullscreenVertexShader, type FullscreenPass } from "../../../render/post/fullscreenPass.js";

export type SeasonalRainOverlayState = {
  enabled: boolean;
  intensity01: number;
  visualIntensity01: number;
  seed: number;
  timeSeconds: number;
  windScreenX?: number;
  windScreenY?: number;
  windStrength01?: number;
};

export type SeasonalRainOverlayPass = {
  resize: (width: number, height: number) => void;
  setState: (state: SeasonalRainOverlayState) => void;
  isActive: () => boolean;
  render: (
    renderer: THREE.WebGLRenderer,
    inputTexture: THREE.Texture,
    target: THREE.WebGLRenderTarget | null
  ) => void;
  dispose: () => void;
};

export type SeasonalRainWindInput = {
  dx: number;
  dy: number;
  strength: number;
};

export type SeasonalRainScreenWind = {
  x: number;
  y: number;
  strength01: number;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const clampSigned = (value: number): number => Math.max(-1, Math.min(1, value));
const windWorldDirection = new THREE.Vector3();
const cameraRight = new THREE.Vector3();
const cameraUp = new THREE.Vector3();
const cameraForward = new THREE.Vector3();

export const resolveSeasonalRainScreenWind = (
  camera: THREE.Camera,
  wind: SeasonalRainWindInput | null | undefined
): SeasonalRainScreenWind => {
  const strength01 = clamp01(wind?.strength ?? 0);
  const dx = wind?.dx ?? 0;
  const dy = wind?.dy ?? 0;
  const length = Math.hypot(dx, dy);
  if (length <= 0.0001 || strength01 <= 0.0001) {
    return { x: 0, y: 0, strength01: 0 };
  }
  windWorldDirection.set(dx / length, 0, dy / length);
  camera.updateMatrixWorld();
  camera.matrixWorld.extractBasis(cameraRight, cameraUp, cameraForward);
  return {
    x: clampSigned(windWorldDirection.dot(cameraRight)),
    y: clampSigned(windWorldDirection.dot(cameraUp)),
    strength01
  };
};

const rainFragmentShader = `
  uniform sampler2D uSceneTex;
  uniform vec2 uResolution;
  uniform vec2 uWindScreen;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uSeed;
  uniform float uWindStrength;

  varying vec2 vUv;

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031 + uSeed * 0.00017);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float stormNoise(vec2 p) {
    float n = valueNoise(p) * 0.58;
    n += valueNoise(p * 2.13 + 17.4) * 0.29;
    n += valueNoise(p * 4.07 - 9.6) * 0.13;
    return n;
  }

  float rainLayer(
    vec2 uv,
    float scale,
    float speed,
    float width,
    float salt,
    float slant,
    float speedScale,
    float density,
    float lengthMin,
    float lengthMax
  ) {
    vec2 p = uv;
    p.x += p.y * slant;
    p.y += uTime * speed * speedScale;
    p *= scale;
    vec2 cell = floor(p);
    vec2 local = fract(p);
    float rnd = hash12(cell + salt);
    float densityGate = smoothstep(1.0 - density, 1.0, rnd);
    float lane = abs(local.x - rnd);
    float streak = 1.0 - smoothstep(0.0, width, lane);
    float streakLength = mix(lengthMin, lengthMax, hash12(cell + salt * 1.71));
    float tail = smoothstep(0.02, 0.11, local.y);
    float head = 1.0 - smoothstep(streakLength, min(0.98, streakLength + 0.16), local.y);
    float shimmer = 0.62 + 0.38 * sin((local.y + rnd) * 18.0 - uTime * (5.0 + speed));
    return streak * tail * head * shimmer * densityGate * (0.35 + rnd * 0.9);
  }

  float lensRipple(vec2 uv) {
    vec2 q = uv * vec2(12.0, 8.0);
    float a = sin((q.x + q.y * 0.7) * 3.6 + uTime * 2.2 + uSeed * 0.002);
    float b = sin((q.x * 0.62 - q.y) * 5.1 - uTime * 1.65);
    return (a + b) * 0.5;
  }

  void main() {
    float intensity = clamp(uIntensity, 0.0, 1.0);
    vec2 uv = vUv;
    vec2 centered = uv - 0.5;
    float edge = smoothstep(0.25, 0.84, length(centered));
    vec2 ripple = vec2(lensRipple(uv + vec2(0.0, uTime * 0.015)), lensRipple(uv.yx + 7.3));
    uv += ripple * (0.0014 + edge * 0.0018) * intensity;

    vec3 color = texture2D(uSceneTex, uv).rgb;
    float aspect = max(0.5, uResolution.x / max(1.0, uResolution.y));
    vec2 rainUv = vec2(vUv.x * aspect, vUv.y);
    float windStrength = clamp(uWindStrength, 0.0, 1.0);
    float slant = clamp(uWindScreen.x * (0.18 + windStrength * 0.95), -1.15, 1.15);
    float verticalWind = clamp(uWindScreen.y * windStrength, -0.32, 0.32);
    float speedScale = 0.9 + windStrength * 0.38 + abs(verticalWind) * 0.22;
    vec2 windDir = length(uWindScreen) > 0.001 ? normalize(uWindScreen) : vec2(0.35, -0.94);
    vec2 stormUv = vUv * vec2(aspect, 1.0) * 2.15;
    stormUv += windDir * uTime * (0.028 + windStrength * 0.032);
    stormUv += vec2(uSeed * 0.00009, uSeed * 0.00013);
    float stormMask = smoothstep(0.35, 0.85, stormNoise(stormUv));
    float localIntensity = intensity * stormMask;
    rainUv.y += vUv.x * verticalWind * 0.08;
    float rain =
      rainLayer(rainUv, 34.0, 1.85, 0.013, 11.0, slant * 0.78, speedScale, 0.46 * stormMask, 0.28, 0.48) * 0.26 +
      rainLayer(rainUv + vec2(0.17, 0.0), 64.0, 3.55, 0.016, 37.0, slant, speedScale, 0.31 * stormMask, 0.22, 0.38) * 0.6 +
      rainLayer(rainUv + vec2(0.41, 0.0), 112.0, 6.45, 0.024, 71.0, slant * 1.18, speedScale, 0.1 * stormMask, 0.16, 0.3) * 0.96;
    rain = clamp(rain * localIntensity, 0.0, 1.0);

    float luminance = dot(color, vec3(0.299, 0.587, 0.114));
    float wetness = localIntensity;
    vec3 cool = mix(color, vec3(luminance) * vec3(0.76, 0.89, 1.1), 0.15 * wetness);
    vec3 dimmed = cool * (1.0 - 0.09 * wetness);
    vec3 streakColor = vec3(0.82, 0.92, 1.0) * (0.5 + luminance * 0.35);
    float sheenMask = smoothstep(0.32, 0.78, luminance) * smoothstep(0.28, 0.9, stormMask);
    float sheen = sheenMask * wetness * (0.018 + 0.024 * valueNoise(vUv * vec2(52.0, 31.0) + uTime * 0.18));
    vec3 finalColor = dimmed + streakColor * rain * (0.92 + 0.58 * wetness) + vec3(0.62, 0.75, 0.88) * sheen;

    float veil = smoothstep(0.0, 1.0, rain * 0.45 + wetness * 0.22);
    finalColor = mix(finalColor, vec3(0.58, 0.7, 0.8), veil * 0.12 * wetness);
    gl_FragColor = vec4(max(finalColor, vec3(0.0)), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const createSeasonalRainOverlayPass = (): SeasonalRainOverlayPass => {
  const uniforms = {
    uSceneTex: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uWindScreen: { value: new THREE.Vector2(0, 0) },
    uTime: { value: 0 },
    uIntensity: { value: 0 },
    uSeed: { value: 0 },
    uWindStrength: { value: 0 }
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: fullscreenVertexShader,
    fragmentShader: rainFragmentShader,
    depthWrite: false,
    depthTest: false,
    toneMapped: false
  });
  const pass: FullscreenPass = createFullscreenPass(material);

  return {
    resize: (width, height) => {
      uniforms.uResolution.value.set(Math.max(1, width), Math.max(1, height));
    },
    setState: (state) => {
      uniforms.uIntensity.value = state.enabled ? Math.max(0, Math.min(1, state.visualIntensity01)) : 0;
      uniforms.uTime.value = Math.max(0, state.timeSeconds);
      uniforms.uSeed.value = Number.isFinite(state.seed) ? state.seed : 0;
      const windScreenX =
        typeof state.windScreenX === "number" && Number.isFinite(state.windScreenX) ? state.windScreenX : 0;
      const windScreenY =
        typeof state.windScreenY === "number" && Number.isFinite(state.windScreenY) ? state.windScreenY : 0;
      const windStrength01 =
        typeof state.windStrength01 === "number" && Number.isFinite(state.windStrength01) ? state.windStrength01 : 0;
      uniforms.uWindScreen.value.set(
        Math.max(-1, Math.min(1, windScreenX)),
        Math.max(-1, Math.min(1, windScreenY))
      );
      uniforms.uWindStrength.value = Math.max(0, Math.min(1, windStrength01));
    },
    isActive: () => uniforms.uIntensity.value > 0.001,
    render: (renderer, inputTexture, target) => {
      uniforms.uSceneTex.value = inputTexture;
      pass.render(renderer, target);
    },
    dispose: () => {
      pass.dispose();
    }
  };
};
