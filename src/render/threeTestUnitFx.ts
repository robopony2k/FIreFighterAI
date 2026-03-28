import * as THREE from "three";
import type { EffectsState } from "../core/effectsState.js";
import type { WorldState } from "../core/state.js";
import type { WaterSprayMode } from "../core/types.js";
import {
  FIREFIGHTER_MODEL_ROOT_Y_OFFSET,
  createFirefighterVisualState,
  updateFirefighterVisualState,
  writeFirefighterGripWorldPosition
} from "./firefighterVisuals.js";
import { approachAngleExp, resolveDesiredUnitYaw } from "./unitAimVisuals.js";
import { getTerrainHeightScale, type TerrainSample } from "./threeTestTerrain.js";

const MAX_HOSE_SEGMENTS = 1024;
const MAX_WATER_PARTICLES = 4096;
const MAX_WATER_STREAMS = 768;
const MAX_WATER_IMPACTS = MAX_WATER_STREAMS * 3;
const HOSE_BASE_Y = 0.08;
const HOSE_RADIUS = 0.017;
const HOSE_COLOR = new THREE.Color(0xffffff);
const WATER_CORE_COLOR = new THREE.Color(0xf4fcff);
const WATER_EDGE_COLOR = new THREE.Color(0x8fe1ff);
const WATER_MIST_COLOR = new THREE.Color(0xe6f8ff);
const WATER_JET_CORE_COLOR = new THREE.Color(0xffffff);
const WATER_JET_EDGE_COLOR = new THREE.Color(0xa5ebff);
const WATER_STREAM_BODY_CORE_COLOR = new THREE.Color(0xf3fcff);
const WATER_STREAM_BODY_EDGE_COLOR = new THREE.Color(0x8fe1ff);
const WATER_SHELL_CORE_COLOR = new THREE.Color(0xf8fdff);
const WATER_SHELL_EDGE_COLOR = new THREE.Color(0xb2edff);
const WATER_IMPACT_CORE_COLOR = new THREE.Color(0xf5fcff);
const WATER_IMPACT_EDGE_COLOR = new THREE.Color(0x8edcff);
const TAU = Math.PI * 2;
const DEFAULT_FIREFIGHTER_TURN_RESPONSE = 18;
const ENGAGED_FIREFIGHTER_TURN_RESPONSE = 10.5;
const STREAM_NOZZLE_RESPONSE = 12.5;
const STREAM_TIP_RESPONSE = 7.2;
const STREAM_LENGTH_RESPONSE = 11;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const fract = (value: number): number => value - Math.floor(value);
const expFactor = (rate: number, dtSeconds: number): number =>
  1 - Math.exp(-Math.max(0, rate) * Math.max(0, dtSeconds));
const approachExp = (current: number, target: number, rate: number, dtSeconds: number): number =>
  current + (target - current) * expFactor(rate, dtSeconds);
const approachUnitVectorExp = (
  current: THREE.Vector3,
  target: THREE.Vector3,
  rate: number,
  dtSeconds: number
): THREE.Vector3 => {
  current.lerp(target, expFactor(rate, dtSeconds));
  if (current.lengthSq() <= 1e-8) {
    current.copy(target);
  } else {
    current.normalize();
  }
  return current;
};

const bilerp = (h00: number, h10: number, h01: number, h11: number, tx: number, ty: number): number => {
  const hx0 = h00 * (1 - tx) + h10 * tx;
  const hx1 = h01 * (1 - tx) + h11 * tx;
  return hx0 * (1 - ty) + hx1 * ty;
};

const sampleHeight = (sample: TerrainSample, tileX: number, tileY: number): number => {
  const cols = Math.max(1, sample.cols);
  const rows = Math.max(1, sample.rows);
  const x = clamp(tileX - 0.5, 0, cols - 1);
  const y = clamp(tileY - 0.5, 0, rows - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(cols - 1, x0 + 1);
  const y1 = Math.min(rows - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const idx00 = y0 * cols + x0;
  const idx10 = y0 * cols + x1;
  const idx01 = y1 * cols + x0;
  const idx11 = y1 * cols + x1;
  const h00 = sample.elevations[idx00] ?? 0;
  const h10 = sample.elevations[idx10] ?? h00;
  const h01 = sample.elevations[idx01] ?? h00;
  const h11 = sample.elevations[idx11] ?? h00;
  return bilerp(h00, h10, h01, h11, tx, ty);
};

const toWorldX = (tileX: number, cols: number, width: number): number => (tileX / Math.max(1, cols) - 0.5) * width;
const toWorldZ = (tileY: number, rows: number, depth: number): number => (tileY / Math.max(1, rows) - 0.5) * depth;
const toTileX = (worldX: number, cols: number, width: number): number => (worldX / Math.max(0.0001, width) + 0.5) * cols;
const toTileY = (worldZ: number, rows: number, depth: number): number => (worldZ / Math.max(0.0001, depth) + 0.5) * rows;
const sampleWorldHeight = (
  sample: TerrainSample,
  terrainSize: { width: number; depth: number },
  cols: number,
  rows: number,
  heightScale: number,
  worldX: number,
  worldZ: number
): number => sampleHeight(sample, toTileX(worldX, cols, terrainSize.width), toTileY(worldZ, rows, terrainSize.depth)) * heightScale;

const sprayModeToValue = (mode?: WaterSprayMode): number => {
  if (mode === "precision") {
    return 0;
  }
  if (mode === "suppression") {
    return 2;
  }
  return 1;
};

const defaultVolumeForMode = (modeValue: number): number => {
  if (modeValue <= 0.5) {
    return 0.9;
  }
  if (modeValue >= 1.5) {
    return 0.55;
  }
  return 0.75;
};

const defaultPulseForMode = (modeValue: number): number => {
  if (modeValue <= 0.5) {
    return 8.2;
  }
  if (modeValue >= 1.5) {
    return 4.8;
  }
  return 6.3;
};

const waterVertexShader = `
  precision highp float;
  attribute float aAlpha;
  attribute float aSize;
  attribute float aMode;
  attribute float aVolume;
  attribute float aSeed;
  attribute float aPulseHz;
  attribute float aAge01;
  uniform float uTimeSec;
  varying float vAlpha;
  varying float vMode;
  varying float vVolume;
  varying float vSeed;
  varying float vPulse;
  varying float vAge01;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float dist = max(1.0, -mvPosition.z);
    float mode01 = clamp(aMode * 0.5, 0.0, 1.0);
    float pulse = 0.74 + 0.26 * sin(uTimeSec * (aPulseHz + mode01 * 0.8) + aSeed * 31.4159);
    float volumeScale = mix(0.74, 1.05, clamp(aVolume, 0.0, 1.0));
    float age01 = clamp(aAge01, 0.0, 1.0);
    float grow01 = smoothstep(0.02, 0.72, age01);
    float ageFade = (1.0 - smoothstep(0.62, 1.0, age01)) * mix(0.62, 1.0, grow01);
    float sizeScale = mix(0.74, 1.02, mode01);
    float pointSize = aSize * (134.0 / dist) * pulse * volumeScale * sizeScale * mix(0.54, 1.85, grow01);
    gl_PointSize = max(2.0, pointSize);
    gl_Position = projectionMatrix * mvPosition;
    vAlpha = clamp(aAlpha, 0.0, 1.0) * ageFade * mix(1.02, 0.8, mode01);
    vMode = clamp(aMode, 0.0, 2.0);
    vVolume = clamp(aVolume, 0.0, 1.0);
    vSeed = aSeed;
    vPulse = pulse;
    vAge01 = age01;
  }
`;

const waterFragmentShader = `
  precision highp float;
  uniform vec3 uCoreColor;
  uniform vec3 uEdgeColor;
  uniform vec3 uMistColor;
  uniform float uTimeSec;
  varying float vAlpha;
  varying float vMode;
  varying float vVolume;
  varying float vSeed;
  varying float vPulse;
  varying float vAge01;

  float hash(vec2 p) {
    p = fract(p * vec2(0.3183099, 0.3678794) + vec2(vSeed, vSeed * 1.73));
    p += dot(p, p + 17.13);
    return fract(p.x * p.y * 39.71);
  }

  void main() {
    float mode01 = clamp(vMode * 0.5, 0.0, 1.0);
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    uv.x *= mix(0.88, 1.14, mode01);
    float radial = length(uv);
    float shell = 1.0 - smoothstep(0.36, 1.0, radial);
    if (shell <= 0.001) {
      discard;
    }
    float core = 1.0 - smoothstep(0.0, mix(0.26, 0.46, mode01), radial);
    float outer = 1.0 - smoothstep(0.46, 1.04, radial);
    float noise = hash(gl_PointCoord * vec2(13.7, 17.9) + vec2(vSeed * 41.3, uTimeSec * 0.75 + vSeed));
    float breakup = mix(0.82, 0.58, mode01);
    float mist = smoothstep(mix(0.58, 0.32, mode01), 1.0, noise + outer * breakup);
    float pulseGlow = 0.78 + vPulse * 0.34;
    float volumeBoost = mix(0.82, 1.08, vVolume);
    float lifeFade = (1.0 - smoothstep(0.58, 1.0, vAge01)) * mix(0.68, 1.0, smoothstep(0.04, 0.68, vAge01));
    float alpha = vAlpha * outer * pulseGlow * volumeBoost * lifeFade;
    alpha *= mix(0.98, 0.86, mode01);
    alpha *= mix(0.68, 1.02, shell);
    alpha = clamp(alpha * 1.14, 0.0, 1.0);
    if (alpha <= 0.01) {
      discard;
    }

    vec3 color = mix(uEdgeColor, uCoreColor, clamp(core * 0.84 + outer * 0.16, 0.0, 1.0));
    color = mix(color, uMistColor, mist * 0.48);
    color += vec3(0.08, 0.11, 0.14) * outer * (0.28 + vVolume * 0.2);
    gl_FragColor = vec4(color, alpha);
  }
`;

const waterJetCoreVertexShader = `
  precision highp float;
  uniform float uTimeSec;
  attribute float aMode;
  attribute float aVolume;
  attribute float aSeed;
  attribute float aIntensity;
  attribute float aNozzleRatio;
  varying float vAlong;
  varying float vRadial;
  varying float vMode;
  varying float vVolume;
  varying float vSeed;
  varying float vIntensity;
  varying float vWrap;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  void main() {
    float along = clamp(position.y + 0.5, 0.0, 1.0);
    float mode01 = clamp(aMode * 0.5, 0.0, 1.0);
    float intensity = clamp(aIntensity, 0.0, 1.0);
    float nozzleRatio = clamp(aNozzleRatio, 0.02, 1.0);
    vec3 localPos = position;
    float growth = pow(smoothstep(0.0, 0.92, along), 0.88);
    float tipBloom = smoothstep(0.54, 1.0, along);
    float taper = 1.0 - smoothstep(0.96, 1.0, along) * 0.08;
    float ripple = sin(along * mix(10.0, 6.2, mode01) - uTimeSec * mix(11.0, 7.2, mode01) + aSeed * 31.4159);
    float sway = sin(along * 4.8 - uTimeSec * 3.2 + aSeed * 19.1);
    float targetWidth = mix(0.66, 0.92, mode01);
    float widthProfile = mix(nozzleRatio, targetWidth, growth) * taper;
    widthProfile *= mix(0.98, 1.08, pow(tipBloom, 0.82) * mix(0.4, 0.8, mode01));
    widthProfile *= mix(0.98, 1.12, clamp(aVolume, 0.0, 1.0));
    widthProfile *= mix(0.9, 1.0, intensity);
    widthProfile *= 1.0 + ripple * 0.005 * smoothstep(0.22, 0.9, along);
    localPos.xz *= widthProfile;
    localPos.x += ripple * 0.002 * smoothstep(0.28, 0.94, along);
    localPos.z += sway * 0.0018 * smoothstep(0.36, 1.0, along);
    vAlong = along;
    vRadial = clamp(length(position.xz), 0.0, 1.0);
    vMode = clamp(aMode, 0.0, 2.0);
    vVolume = clamp(aVolume, 0.0, 1.0);
    vSeed = aSeed;
    vIntensity = intensity;
    vec4 worldPos = modelMatrix * instanceMatrix * vec4(localPos, 1.0);
    vWrap = uv.x;
    vWorldPos = worldPos.xyz;
    vWorldNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const waterJetCoreFragmentShader = `
  precision highp float;
  uniform float uTimeSec;
  uniform vec3 uCoreColor;
  uniform vec3 uEdgeColor;
  varying float vAlong;
  varying float vRadial;
  varying float vMode;
  varying float vVolume;
  varying float vSeed;
  varying float vIntensity;
  varying float vWrap;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123 + vSeed * 17.0);
  }

  void main() {
    float mode01 = clamp(vMode * 0.5, 0.0, 1.0);
    float intensity = clamp(vIntensity, 0.0, 1.0);
    float entryFade = smoothstep(0.0, 0.05, vAlong);
    float exitFade = 1.0 - smoothstep(0.985, 1.0, vAlong) * 0.18;
    float tipBloom = smoothstep(0.68, 0.98, vAlong);
    float body = entryFade * exitFade;
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    vec3 worldNormal = normalize(vWorldNormal);
    float fresnel = pow(1.0 - abs(dot(worldNormal, viewDir)), 1.15);
    float streak = 0.78 + 0.22 * sin(vAlong * mix(20.0, 13.0, mode01) - uTimeSec * mix(13.0, 8.2, mode01) + vWrap * 6.28318 * 1.25 + vSeed * 23.0);
    float noise = hash(vec2(vAlong * 14.0 + uTimeSec * 0.8, vSeed * 7.3));
    float breakup = smoothstep(0.82, 1.0, noise + vAlong * 0.24);
    float alpha = body;
    alpha *= mix(0.34, 0.46, clamp(vVolume, 0.0, 1.0));
    alpha *= mix(0.26, 0.48, intensity);
    alpha *= mix(0.9, 0.98, mode01);
    alpha *= mix(0.92, 1.02, streak);
    alpha *= 1.0 - breakup * 0.08;
    alpha *= 0.92 + noise * 0.04;
    alpha *= 0.84 + fresnel * 0.12;
    alpha *= 0.96 + tipBloom * mix(0.08, 0.14, mode01);
    alpha = clamp(alpha * 0.56, 0.0, 0.42);
    if (alpha <= 0.01) {
      discard;
    }
    vec3 color = mix(uEdgeColor, uCoreColor, 0.52 + intensity * 0.08);
    color = mix(color, vec3(0.9, 0.97, 1.0), tipBloom * 0.1);
    gl_FragColor = vec4(color, alpha);
  }
`;

const waterMistVertexShader = `
  precision highp float;
  uniform float uTimeSec;
  attribute float aMode;
  attribute float aVolume;
  attribute float aSeed;
  attribute float aIntensity;
  attribute float aNozzleRatio;
  varying float vAlong;
  varying float vRadial;
  varying float vMode;
  varying float vVolume;
  varying float vSeed;
  varying float vIntensity;
  varying float vWrap;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  void main() {
    float along = clamp(position.y + 0.5, 0.0, 1.0);
    float mode01 = clamp(aMode * 0.5, 0.0, 1.0);
    float nozzleRatio = clamp(aNozzleRatio, 0.02, 1.0);
    vec3 localPos = position;
    float growth = smoothstep(0.0, 0.84, along);
    float tipBloom = smoothstep(0.68, 1.0, along);
    float sourceWidth = nozzleRatio;
    float targetWidth = mix(0.76, 1.28, mode01);
    float widthProfile = mix(sourceWidth, targetWidth, pow(growth, 0.72));
    widthProfile *= 1.0 + tipBloom * mix(0.1, 0.28, mode01);
    widthProfile *= mix(0.98, 1.12, clamp(aVolume, 0.0, 1.0));
    float ripple = sin(along * mix(7.0, 5.1, mode01) - uTimeSec * mix(6.8, 4.7, mode01) + aSeed * 27.0);
    localPos.xz *= widthProfile * (1.0 + ripple * 0.008 * growth);
    localPos.x += ripple * 0.003 * growth;
    vAlong = along;
    vRadial = clamp(length(position.xz), 0.0, 1.0);
    vMode = clamp(aMode, 0.0, 2.0);
    vVolume = clamp(aVolume, 0.0, 1.0);
    vSeed = aSeed;
    vIntensity = clamp(aIntensity, 0.0, 1.0);
    vec4 worldPos = modelMatrix * instanceMatrix * vec4(localPos, 1.0);
    vWrap = uv.x;
    vWorldPos = worldPos.xyz;
    vWorldNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const waterMistFragmentShader = `
  precision highp float;
  uniform float uTimeSec;
  uniform vec3 uCoreColor;
  uniform vec3 uEdgeColor;
  varying float vAlong;
  varying float vRadial;
  varying float vMode;
  varying float vVolume;
  varying float vSeed;
  varying float vIntensity;
  varying float vWrap;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(97.1, 281.7))) * 43758.5453123 + vSeed * 11.0);
  }

  void main() {
    float mode01 = clamp(vMode * 0.5, 0.0, 1.0);
    float entryFade = 1.0;
    float exitFade = 1.0 - smoothstep(0.985, 1.0, vAlong) * 0.2;
    float tipBloom = smoothstep(0.7, 0.98, vAlong);
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    vec3 worldNormal = normalize(vWorldNormal);
    float fresnel = pow(1.0 - abs(dot(worldNormal, viewDir)), 1.4);
    float flow = 0.84 + 0.16 * sin(vAlong * mix(9.0, 6.4, mode01) - uTimeSec * mix(7.2, 4.9, mode01) + vWrap * 6.28318 * 1.6 + vSeed * 19.0);
    float noise = hash(vec2(vAlong * 6.4 + uTimeSec * 0.24, vWrap * 17.0 + vSeed * 5.2));
    float feather = 0.9 + noise * 0.1;
    float alpha = entryFade * exitFade * feather;
    alpha *= mix(0.18, 0.28, clamp(vVolume, 0.0, 1.0));
    alpha *= mix(0.38, 0.62, clamp(vIntensity, 0.0, 1.0));
    alpha *= mix(0.9, 1.0, mode01);
    alpha *= 0.38 + fresnel * 0.22;
    alpha *= flow;
    alpha *= 0.96 + tipBloom * mix(0.16, 0.28, mode01);
    alpha = clamp(alpha * (0.74 + tipBloom * 0.14), 0.0, 1.0);
    if (alpha <= 0.01) {
      discard;
    }
    vec3 color = mix(uEdgeColor, uCoreColor, 0.44 + fresnel * 0.2 + tipBloom * 0.08);
    color = mix(color, vec3(0.9, 0.97, 1.0), tipBloom * 0.18);
    gl_FragColor = vec4(color, alpha);
  }
`;

const waterStreamBodyVertexShader = `
  precision highp float;
  uniform float uTimeSec;
  attribute float aMode;
  attribute float aVolume;
  attribute float aSeed;
  attribute float aIntensity;
  attribute float aNozzleRatio;
  varying float vAlong;
  varying float vMode;
  varying float vVolume;
  varying float vSeed;
  varying float vIntensity;
  varying float vWrap;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  void main() {
    float along = clamp(position.y + 0.5, 0.0, 1.0);
    float mode01 = clamp(aMode * 0.5, 0.0, 1.0);
    float intensity = clamp(aIntensity, 0.0, 1.0);
    float nozzleRatio = clamp(aNozzleRatio, 0.02, 1.0);
    vec3 localPos = position;
    float growth = pow(smoothstep(0.0, 0.94, along), 0.86);
    float tipBloom = smoothstep(0.72, 1.0, along);
    float pulse = 1.0 + sin(along * mix(8.0, 5.6, mode01) - uTimeSec * mix(4.4, 3.0, mode01) + aSeed * 27.0) * 0.015;
    float widthProfile = mix(nozzleRatio, 1.0, growth);
    widthProfile *= pulse;
    widthProfile *= mix(0.98, 1.02, intensity);
    widthProfile *= 1.0 + tipBloom * mix(0.02, 0.05, mode01);
    localPos.xz *= widthProfile;
    vAlong = along;
    vMode = clamp(aMode, 0.0, 2.0);
    vVolume = clamp(aVolume, 0.0, 1.0);
    vSeed = aSeed;
    vIntensity = intensity;
    vec4 worldPos = modelMatrix * instanceMatrix * vec4(localPos, 1.0);
    vWrap = uv.x;
    vWorldPos = worldPos.xyz;
    vWorldNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const waterStreamBodyFragmentShader = `
  precision highp float;
  uniform float uTimeSec;
  uniform vec3 uCoreColor;
  uniform vec3 uEdgeColor;
  varying float vAlong;
  varying float vMode;
  varying float vVolume;
  varying float vSeed;
  varying float vIntensity;
  varying float vWrap;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(117.1, 271.7))) * 43758.5453123 + vSeed * 23.0);
  }

  void main() {
    float mode01 = clamp(vMode * 0.5, 0.0, 1.0);
    float entryFade = smoothstep(0.0, 0.02, vAlong);
    float exitFade = 1.0 - smoothstep(0.96, 1.05, vAlong);
    float flow = 0.9 + 0.1 * sin(vAlong * mix(10.0, 7.0, mode01) - uTimeSec * mix(5.2, 3.6, mode01) + vWrap * 6.28318 * 2.0 + vSeed * 17.0);
    float ring = 0.94 + 0.06 * sin(vWrap * 6.28318 * 3.0 + vAlong * 4.6 + uTimeSec * 1.2 + vSeed * 13.0);
    float noise = hash(vec2(vAlong * 7.6 + uTimeSec * 0.16, vWrap * 13.0 + vSeed * 2.9));
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    vec3 worldNormal = normalize(vWorldNormal);
    float facing = 0.92 + 0.08 * (1.0 - abs(dot(worldNormal, viewDir)));
    float alpha = entryFade * exitFade;
    alpha *= mix(0.44, 0.62, clamp(vVolume, 0.0, 1.0));
    alpha *= mix(0.72, 1.0, clamp(vIntensity, 0.0, 1.0));
    alpha *= mix(0.94, 1.02, mode01);
    alpha *= flow;
    alpha *= ring;
    alpha *= facing;
    alpha *= 0.96 + noise * 0.04;
    alpha = clamp(alpha, 0.0, 0.82);
    if (alpha <= 0.01) {
      discard;
    }
    float tipGlow = smoothstep(0.7, 1.0, vAlong);
    vec3 color = mix(uEdgeColor, uCoreColor, 0.58 + flow * 0.18 + tipGlow * 0.08);
    color = mix(color, vec3(0.94, 0.99, 1.0), tipGlow * 0.12);
    gl_FragColor = vec4(color, alpha);
  }
`;

const waterImpactVertexShader = `
  precision highp float;
  attribute float aAlpha;
  attribute float aSize;
  attribute float aMode;
  attribute float aSeed;
  uniform float uTimeSec;
  varying float vAlpha;
  varying float vMode;
  varying float vSeed;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float dist = max(1.0, -mvPosition.z);
    float pulse = 0.9 + 0.1 * sin(uTimeSec * 5.4 + aSeed * 31.4159);
    gl_PointSize = max(6.0, aSize * (176.0 / dist) * pulse);
    gl_Position = projectionMatrix * mvPosition;
    vAlpha = clamp(aAlpha, 0.0, 1.0);
    vMode = clamp(aMode, 0.0, 2.0);
    vSeed = aSeed;
  }
`;

const waterImpactFragmentShader = `
  precision highp float;
  uniform vec3 uCoreColor;
  uniform vec3 uEdgeColor;
  uniform float uTimeSec;
  varying float vAlpha;
  varying float vMode;
  varying float vSeed;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(133.1, 271.7))) * 43758.5453123 + vSeed * 13.0);
  }

  void main() {
    float mode01 = clamp(vMode * 0.5, 0.0, 1.0);
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float radial = length(uv);
    float body = 1.0 - smoothstep(0.2, 1.0, radial);
    float ring = smoothstep(0.18, 0.56, radial) * (1.0 - smoothstep(0.7, 1.0, radial));
    float noise = hash(gl_PointCoord * vec2(9.1, 13.7) + vec2(vSeed * 17.0, uTimeSec * 0.5));
    float spokes = 0.7 + 0.3 * sin(atan(uv.y, uv.x) * mix(4.0, 6.0, mode01) + uTimeSec * 2.4 + vSeed * 17.0);
    float alpha = body * (0.45 + ring * 0.65 * spokes);
    alpha *= mix(0.6, 0.96, noise);
    alpha *= vAlpha;
    alpha = clamp(alpha, 0.0, 1.0);
    if (alpha <= 0.01) {
      discard;
    }
    vec3 color = mix(uEdgeColor, uCoreColor, 1.0 - smoothstep(0.0, 0.38, radial));
    color += vec3(ring * 0.1);
    gl_FragColor = vec4(color, alpha);
  }
`;

type SprayStreamAggregate = {
  sourceX: number;
  sourceY: number;
  sourceZ: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  mode: number;
  volume: number;
  intensity: number;
  seed: number;
};

type SprayStreamVisualState = {
  direction: THREE.Vector3;
  nozzleDirection: THREE.Vector3;
  tipDirection: THREE.Vector3;
  sourceX: number;
  sourceY: number;
  sourceZ: number;
  length: number;
  tipX: number;
  tipY: number;
  tipZ: number;
  coreRadius: number;
  mistRadius: number;
  impactRadius: number;
  mode: number;
  volume: number;
  intensity: number;
  flow: number;
  seed: number;
};

const writeStreamCurveControlPoint = (
  visual: SprayStreamVisualState,
  target: THREE.Vector3
): THREE.Vector3 => {
  const controlRatio = visual.mode <= 0.5 ? 0.46 : visual.mode >= 1.5 ? 0.38 : 0.42;
  const controlDistance = visual.length * controlRatio;
  return target.set(
    visual.sourceX + visual.nozzleDirection.x * controlDistance,
    visual.sourceY + visual.nozzleDirection.y * controlDistance,
    visual.sourceZ + visual.nozzleDirection.z * controlDistance
  );
};

const sampleStreamCurvePoint = (
  visual: SprayStreamVisualState,
  along01: number,
  controlPoint: THREE.Vector3,
  target: THREE.Vector3
): THREE.Vector3 => {
  const t = clamp(along01, 0, 1);
  const invT = 1 - t;
  return target.set(
    invT * invT * visual.sourceX + 2 * invT * t * controlPoint.x + t * t * visual.tipX,
    invT * invT * visual.sourceY + 2 * invT * t * controlPoint.y + t * t * visual.tipY,
    invT * invT * visual.sourceZ + 2 * invT * t * controlPoint.z + t * t * visual.tipZ
  );
};

const sampleStreamCurveTangent = (
  visual: SprayStreamVisualState,
  along01: number,
  controlPoint: THREE.Vector3,
  target: THREE.Vector3
): THREE.Vector3 => {
  const t = clamp(along01, 0, 1);
  const invT = 1 - t;
  target.set(
    2 * invT * (controlPoint.x - visual.sourceX) + 2 * t * (visual.tipX - controlPoint.x),
    2 * invT * (controlPoint.y - visual.sourceY) + 2 * t * (visual.tipY - controlPoint.y),
    2 * invT * (controlPoint.z - visual.sourceZ) + 2 * t * (visual.tipZ - controlPoint.z)
  );
  if (target.lengthSq() <= 1e-8) {
    target.copy(visual.tipDirection);
  } else {
    target.normalize();
  }
  return target;
};

export type WaterFxDebugControls = {
  streamBodyWidthScale: number;
  streamBodyOpacityScale: number;
  coreRadiusScale: number;
  mistRadiusScale: number;
  impactRadiusScale: number;
  breakupAlphaScale: number;
  breakupSizeScale: number;
  pulseRateScale: number;
  precisionVolumeScale: number;
  balancedVolumeScale: number;
  suppressionVolumeScale: number;
  precisionResponseScale: number;
  balancedResponseScale: number;
  suppressionResponseScale: number;
  showStreamBody: boolean;
  showJetCore: boolean;
  showMistShell: boolean;
  showBreakup: boolean;
  showImpact: boolean;
};

export type WaterFxDebugSnapshot = {
  streamCount: number;
  particleCount: number;
  hoseSegments: number;
  streamBodyCount: number;
  jetCoreCount: number;
  mistShellCount: number;
  impactCount: number;
  breakupCount: number;
};

export const DEFAULT_WATER_FX_DEBUG_CONTROLS: WaterFxDebugControls = {
  streamBodyWidthScale: 1.71,
  streamBodyOpacityScale: 0.25,
  coreRadiusScale: 1.06,
  mistRadiusScale: 0.96,
  impactRadiusScale: 1.15,
  breakupAlphaScale: 0.58,
  breakupSizeScale: 2.5,
  pulseRateScale: 3,
  precisionVolumeScale: 2,
  balancedVolumeScale: 2,
  suppressionVolumeScale: 2,
  precisionResponseScale: 2,
  balancedResponseScale: 2,
  suppressionResponseScale: 2,
  showStreamBody: true,
  showJetCore: true,
  showMistShell: true,
  showBreakup: true,
  showImpact: true
};

export const normalizeWaterFxDebugControls = (
  controls: Partial<WaterFxDebugControls> | undefined
): WaterFxDebugControls => ({
  streamBodyWidthScale: clamp(
    controls?.streamBodyWidthScale ?? DEFAULT_WATER_FX_DEBUG_CONTROLS.streamBodyWidthScale,
    0.5,
    2.5
  ),
  streamBodyOpacityScale: clamp(
    controls?.streamBodyOpacityScale ?? DEFAULT_WATER_FX_DEBUG_CONTROLS.streamBodyOpacityScale,
    0.25,
    2.5
  ),
  coreRadiusScale: clamp(controls?.coreRadiusScale ?? DEFAULT_WATER_FX_DEBUG_CONTROLS.coreRadiusScale, 0.35, 2.5),
  mistRadiusScale: clamp(controls?.mistRadiusScale ?? DEFAULT_WATER_FX_DEBUG_CONTROLS.mistRadiusScale, 0.35, 2.5),
  impactRadiusScale: clamp(
    controls?.impactRadiusScale ?? DEFAULT_WATER_FX_DEBUG_CONTROLS.impactRadiusScale,
    0.35,
    2.5
  ),
  breakupAlphaScale: clamp(
    controls?.breakupAlphaScale ?? DEFAULT_WATER_FX_DEBUG_CONTROLS.breakupAlphaScale,
    0.2,
    3
  ),
  breakupSizeScale: clamp(controls?.breakupSizeScale ?? DEFAULT_WATER_FX_DEBUG_CONTROLS.breakupSizeScale, 0.35, 2.5),
  pulseRateScale: clamp(controls?.pulseRateScale ?? DEFAULT_WATER_FX_DEBUG_CONTROLS.pulseRateScale, 0.25, 3),
  precisionVolumeScale: clamp(
    controls?.precisionVolumeScale ?? DEFAULT_WATER_FX_DEBUG_CONTROLS.precisionVolumeScale,
    0.25,
    2
  ),
  balancedVolumeScale: clamp(
    controls?.balancedVolumeScale ?? DEFAULT_WATER_FX_DEBUG_CONTROLS.balancedVolumeScale,
    0.25,
    2
  ),
  suppressionVolumeScale: clamp(
    controls?.suppressionVolumeScale ?? DEFAULT_WATER_FX_DEBUG_CONTROLS.suppressionVolumeScale,
    0.25,
    2
  ),
  precisionResponseScale: clamp(
    controls?.precisionResponseScale ?? DEFAULT_WATER_FX_DEBUG_CONTROLS.precisionResponseScale,
    0.25,
    2
  ),
  balancedResponseScale: clamp(
    controls?.balancedResponseScale ?? DEFAULT_WATER_FX_DEBUG_CONTROLS.balancedResponseScale,
    0.25,
    2
  ),
  suppressionResponseScale: clamp(
    controls?.suppressionResponseScale ?? DEFAULT_WATER_FX_DEBUG_CONTROLS.suppressionResponseScale,
    0.25,
    2
  ),
  showStreamBody: controls?.showStreamBody ?? DEFAULT_WATER_FX_DEBUG_CONTROLS.showStreamBody,
  showJetCore: controls?.showJetCore ?? DEFAULT_WATER_FX_DEBUG_CONTROLS.showJetCore,
  showMistShell: controls?.showMistShell ?? DEFAULT_WATER_FX_DEBUG_CONTROLS.showMistShell,
  showBreakup: controls?.showBreakup ?? DEFAULT_WATER_FX_DEBUG_CONTROLS.showBreakup,
  showImpact: controls?.showImpact ?? DEFAULT_WATER_FX_DEBUG_CONTROLS.showImpact
});

export type ThreeTestUnitFxLayer = {
  update: (
    world: WorldState,
    effects: EffectsState | null,
    sample: TerrainSample | null,
    terrainSize: { width: number; depth: number } | null,
    interpolationAlpha: number,
    timeMs: number
  ) => void;
  setDebugControls: (controls: Partial<WaterFxDebugControls>) => void;
  getDebugControls: () => WaterFxDebugControls;
  getDebugSnapshot: () => WaterFxDebugSnapshot;
  dispose: () => void;
};

export const createThreeTestUnitFxLayer = (scene: THREE.Scene): ThreeTestUnitFxLayer => {
  let debugControls = normalizeWaterFxDebugControls(undefined);
  let debugSnapshot: WaterFxDebugSnapshot = {
    streamCount: 0,
    particleCount: 0,
    hoseSegments: 0,
    streamBodyCount: 0,
    jetCoreCount: 0,
    mistShellCount: 0,
    impactCount: 0,
    breakupCount: 0
  };
  const hoseGeometry = new THREE.CylinderGeometry(HOSE_RADIUS, HOSE_RADIUS, 1, 6, 1, true);
  const hoseMaterial = new THREE.MeshStandardMaterial({
    color: HOSE_COLOR,
    emissive: new THREE.Color(0x1a1a1a),
    emissiveIntensity: 0.35,
    roughness: 0.68,
    metalness: 0.04,
    transparent: true,
    opacity: 0.94,
    depthWrite: false
  });
  const hoses = new THREE.InstancedMesh(hoseGeometry, hoseMaterial, MAX_HOSE_SEGMENTS);
  hoses.count = 0;
  hoses.frustumCulled = false;
  scene.add(hoses);
  const hoseMatrix = new THREE.Matrix4();
  const hoseMidpoint = new THREE.Vector3();
  const hoseDirection = new THREE.Vector3();
  const hoseQuaternion = new THREE.Quaternion();
  const hoseScale = new THREE.Vector3(1, 1, 1);
  const hoseUpAxis = new THREE.Vector3(0, 1, 0);

  const waterPositions = new Float32Array(MAX_WATER_PARTICLES * 3);
  const waterAlpha = new Float32Array(MAX_WATER_PARTICLES);
  const waterSize = new Float32Array(MAX_WATER_PARTICLES);
  const waterMode = new Float32Array(MAX_WATER_PARTICLES);
  const waterVolume = new Float32Array(MAX_WATER_PARTICLES);
  const waterSeed = new Float32Array(MAX_WATER_PARTICLES);
  const waterPulseHz = new Float32Array(MAX_WATER_PARTICLES);
  const waterAge01 = new Float32Array(MAX_WATER_PARTICLES);
  const waterGeometry = new THREE.BufferGeometry();
  const waterPosAttr = new THREE.BufferAttribute(waterPositions, 3);
  const waterAlphaAttr = new THREE.BufferAttribute(waterAlpha, 1);
  const waterSizeAttr = new THREE.BufferAttribute(waterSize, 1);
  const waterModeAttr = new THREE.BufferAttribute(waterMode, 1);
  const waterVolumeAttr = new THREE.BufferAttribute(waterVolume, 1);
  const waterSeedAttr = new THREE.BufferAttribute(waterSeed, 1);
  const waterPulseAttr = new THREE.BufferAttribute(waterPulseHz, 1);
  const waterAgeAttr = new THREE.BufferAttribute(waterAge01, 1);
  waterPosAttr.setUsage(THREE.DynamicDrawUsage);
  waterAlphaAttr.setUsage(THREE.DynamicDrawUsage);
  waterSizeAttr.setUsage(THREE.DynamicDrawUsage);
  waterModeAttr.setUsage(THREE.DynamicDrawUsage);
  waterVolumeAttr.setUsage(THREE.DynamicDrawUsage);
  waterSeedAttr.setUsage(THREE.DynamicDrawUsage);
  waterPulseAttr.setUsage(THREE.DynamicDrawUsage);
  waterAgeAttr.setUsage(THREE.DynamicDrawUsage);
  waterGeometry.setAttribute("position", waterPosAttr);
  waterGeometry.setAttribute("aAlpha", waterAlphaAttr);
  waterGeometry.setAttribute("aSize", waterSizeAttr);
  waterGeometry.setAttribute("aMode", waterModeAttr);
  waterGeometry.setAttribute("aVolume", waterVolumeAttr);
  waterGeometry.setAttribute("aSeed", waterSeedAttr);
  waterGeometry.setAttribute("aPulseHz", waterPulseAttr);
  waterGeometry.setAttribute("aAge01", waterAgeAttr);
  waterGeometry.setDrawRange(0, 0);
  const waterMaterial = new THREE.ShaderMaterial({
    vertexShader: waterVertexShader,
    fragmentShader: waterFragmentShader,
    uniforms: {
      uCoreColor: { value: WATER_CORE_COLOR.clone() },
      uEdgeColor: { value: WATER_EDGE_COLOR.clone() },
      uMistColor: { value: WATER_MIST_COLOR.clone() },
      uTimeSec: { value: 0 }
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false
  });
  const waterPoints = new THREE.Points(waterGeometry, waterMaterial);
  waterPoints.frustumCulled = false;
  waterPoints.renderOrder = 10;
  scene.add(waterPoints);
  const createTubeBuffers = (): {
    geometry: THREE.CylinderGeometry;
    modeAttr: THREE.InstancedBufferAttribute;
    volumeAttr: THREE.InstancedBufferAttribute;
    seedAttr: THREE.InstancedBufferAttribute;
    intensityAttr: THREE.InstancedBufferAttribute;
    nozzleRatioAttr: THREE.InstancedBufferAttribute;
  } => {
    const geometry = new THREE.CylinderGeometry(1, 1, 1, 18, 12, true);
    const modeAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_WATER_STREAMS), 1);
    const volumeAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_WATER_STREAMS), 1);
    const seedAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_WATER_STREAMS), 1);
    const intensityAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_WATER_STREAMS), 1);
    const nozzleRatioAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_WATER_STREAMS), 1);
    modeAttr.setUsage(THREE.DynamicDrawUsage);
    volumeAttr.setUsage(THREE.DynamicDrawUsage);
    seedAttr.setUsage(THREE.DynamicDrawUsage);
    intensityAttr.setUsage(THREE.DynamicDrawUsage);
    nozzleRatioAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("aMode", modeAttr);
    geometry.setAttribute("aVolume", volumeAttr);
    geometry.setAttribute("aSeed", seedAttr);
    geometry.setAttribute("aIntensity", intensityAttr);
    geometry.setAttribute("aNozzleRatio", nozzleRatioAttr);
    return { geometry, modeAttr, volumeAttr, seedAttr, intensityAttr, nozzleRatioAttr };
  };

  const createStreamBodyBuffers = (): {
    geometry: THREE.CylinderGeometry;
    modeAttr: THREE.InstancedBufferAttribute;
    volumeAttr: THREE.InstancedBufferAttribute;
    seedAttr: THREE.InstancedBufferAttribute;
    intensityAttr: THREE.InstancedBufferAttribute;
    nozzleRatioAttr: THREE.InstancedBufferAttribute;
  } => {
    const geometry = new THREE.CylinderGeometry(1, 0.42, 1, 22, 14, false);
    const modeAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_WATER_STREAMS), 1);
    const volumeAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_WATER_STREAMS), 1);
    const seedAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_WATER_STREAMS), 1);
    const intensityAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_WATER_STREAMS), 1);
    const nozzleRatioAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_WATER_STREAMS), 1);
    modeAttr.setUsage(THREE.DynamicDrawUsage);
    volumeAttr.setUsage(THREE.DynamicDrawUsage);
    seedAttr.setUsage(THREE.DynamicDrawUsage);
    intensityAttr.setUsage(THREE.DynamicDrawUsage);
    nozzleRatioAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("aMode", modeAttr);
    geometry.setAttribute("aVolume", volumeAttr);
    geometry.setAttribute("aSeed", seedAttr);
    geometry.setAttribute("aIntensity", intensityAttr);
    geometry.setAttribute("aNozzleRatio", nozzleRatioAttr);
    return { geometry, modeAttr, volumeAttr, seedAttr, intensityAttr, nozzleRatioAttr };
  };

  const jetCoreBuffers = createTubeBuffers();
  const mistShellBuffers = createTubeBuffers();
  const streamBodyBuffers = createStreamBodyBuffers();
  const jetCoreMaterial = new THREE.ShaderMaterial({
    vertexShader: waterJetCoreVertexShader,
    fragmentShader: waterJetCoreFragmentShader,
    uniforms: {
      uTimeSec: { value: 0 },
      uCoreColor: { value: WATER_JET_CORE_COLOR.clone() },
      uEdgeColor: { value: WATER_JET_EDGE_COLOR.clone() }
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.FrontSide,
    blending: THREE.NormalBlending,
    toneMapped: false
  });
  const streamBodyMaterial = new THREE.ShaderMaterial({
    vertexShader: waterStreamBodyVertexShader,
    fragmentShader: waterStreamBodyFragmentShader,
    uniforms: {
      uTimeSec: { value: 0 },
      uCoreColor: { value: WATER_STREAM_BODY_CORE_COLOR.clone() },
      uEdgeColor: { value: WATER_STREAM_BODY_EDGE_COLOR.clone() }
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.FrontSide,
    blending: THREE.NormalBlending,
    toneMapped: false
  });
  const mistShellMaterial = new THREE.ShaderMaterial({
    vertexShader: waterMistVertexShader,
    fragmentShader: waterMistFragmentShader,
    uniforms: {
      uTimeSec: { value: 0 },
      uCoreColor: { value: WATER_SHELL_CORE_COLOR.clone() },
      uEdgeColor: { value: WATER_SHELL_EDGE_COLOR.clone() }
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.FrontSide,
    blending: THREE.NormalBlending,
    toneMapped: false
  });
  const jetCores = new THREE.InstancedMesh(jetCoreBuffers.geometry, jetCoreMaterial, MAX_WATER_STREAMS);
  jetCores.count = 0;
  jetCores.frustumCulled = false;
  jetCores.renderOrder = 13.2;
  scene.add(jetCores);
  const streamBodies = new THREE.InstancedMesh(streamBodyBuffers.geometry, streamBodyMaterial, MAX_WATER_STREAMS);
  streamBodies.count = 0;
  streamBodies.frustumCulled = false;
  streamBodies.renderOrder = 13;
  scene.add(streamBodies);
  const mistShells = new THREE.InstancedMesh(mistShellBuffers.geometry, mistShellMaterial, MAX_WATER_STREAMS);
  mistShells.count = 0;
  mistShells.frustumCulled = false;
  mistShells.renderOrder = 12.4;
  scene.add(mistShells);

  const impactPositions = new Float32Array(MAX_WATER_IMPACTS * 3);
  const impactAlpha = new Float32Array(MAX_WATER_IMPACTS);
  const impactSize = new Float32Array(MAX_WATER_IMPACTS);
  const impactMode = new Float32Array(MAX_WATER_IMPACTS);
  const impactSeed = new Float32Array(MAX_WATER_IMPACTS);
  const impactGeometry = new THREE.BufferGeometry();
  const impactPosAttr = new THREE.BufferAttribute(impactPositions, 3);
  const impactAlphaAttr = new THREE.BufferAttribute(impactAlpha, 1);
  const impactSizeAttr = new THREE.BufferAttribute(impactSize, 1);
  const impactModeAttr = new THREE.BufferAttribute(impactMode, 1);
  const impactSeedAttr = new THREE.BufferAttribute(impactSeed, 1);
  impactPosAttr.setUsage(THREE.DynamicDrawUsage);
  impactAlphaAttr.setUsage(THREE.DynamicDrawUsage);
  impactSizeAttr.setUsage(THREE.DynamicDrawUsage);
  impactModeAttr.setUsage(THREE.DynamicDrawUsage);
  impactSeedAttr.setUsage(THREE.DynamicDrawUsage);
  impactGeometry.setAttribute("position", impactPosAttr);
  impactGeometry.setAttribute("aAlpha", impactAlphaAttr);
  impactGeometry.setAttribute("aSize", impactSizeAttr);
  impactGeometry.setAttribute("aMode", impactModeAttr);
  impactGeometry.setAttribute("aSeed", impactSeedAttr);
  impactGeometry.setDrawRange(0, 0);
  const impactMaterial = new THREE.ShaderMaterial({
    vertexShader: waterImpactVertexShader,
    fragmentShader: waterImpactFragmentShader,
    uniforms: {
      uTimeSec: { value: 0 },
      uCoreColor: { value: WATER_IMPACT_CORE_COLOR.clone() },
      uEdgeColor: { value: WATER_IMPACT_EDGE_COLOR.clone() }
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false
  });
  const impactPoints = new THREE.Points(impactGeometry, impactMaterial);
  impactPoints.frustumCulled = false;
  impactPoints.renderOrder = 11;
  scene.add(impactPoints);

  const sprayMatrix = new THREE.Matrix4();
  const sprayMidpoint = new THREE.Vector3();
  const sprayQuaternion = new THREE.Quaternion();
  const sprayScale = new THREE.Vector3(1, 1, 1);
  const streamTargetDirection = new THREE.Vector3();
  const streamTargetPoint = new THREE.Vector3();
  const streamBaseDirection = new THREE.Vector3();
  const swayAxisA = new THREE.Vector3();
  const swayAxisB = new THREE.Vector3();
  const swayTargetPoint = new THREE.Vector3();
  const streamCurveControlPoint = new THREE.Vector3();
  const streamCurvePoint = new THREE.Vector3();
  const streamCurveTangent = new THREE.Vector3();
  const swayFallbackAxis = new THREE.Vector3(1, 0, 0);
  const fallbackStreamDirection = new THREE.Vector3(0, -0.04, 1).normalize();
  const sprayVisualBySourceId = new Map<number, SprayStreamVisualState>();
  const lastFirefighterYawByUnitId = new Map<number, number>();
  let lastUpdateTimeMs: number | null = null;
  const getModeVolumeScale = (modeValue: number): number => {
    if (modeValue <= 0.5) {
      return debugControls.precisionVolumeScale;
    }
    if (modeValue >= 1.5) {
      return debugControls.suppressionVolumeScale;
    }
    return debugControls.balancedVolumeScale;
  };
  const getModeResponseScale = (modeValue: number): number => {
    if (modeValue <= 0.5) {
      return debugControls.precisionResponseScale;
    }
    if (modeValue >= 1.5) {
      return debugControls.suppressionResponseScale;
    }
    return debugControls.balancedResponseScale;
  };

  const update = (
    world: WorldState,
    effects: EffectsState | null,
    sample: TerrainSample | null,
    terrainSize: { width: number; depth: number } | null,
    interpolationAlpha: number,
    timeMs: number
  ): void => {
    const timeSec = timeMs * 0.001;
    waterMaterial.uniforms.uTimeSec.value = timeSec;
    jetCoreMaterial.uniforms.uTimeSec.value = timeSec;
    streamBodyMaterial.uniforms.uTimeSec.value = timeSec;
    mistShellMaterial.uniforms.uTimeSec.value = timeSec;
    impactMaterial.uniforms.uTimeSec.value = timeSec;
    const deltaSeconds =
      lastUpdateTimeMs === null ? 1 / 60 : clamp((timeMs - lastUpdateTimeMs) * 0.001, 1 / 240, 0.12);
    lastUpdateTimeMs = timeMs;
    if (!sample || !terrainSize) {
      hoses.count = 0;
      waterGeometry.setDrawRange(0, 0);
      jetCores.count = 0;
      streamBodies.count = 0;
      mistShells.count = 0;
      impactGeometry.setDrawRange(0, 0);
      sprayVisualBySourceId.clear();
      lastFirefighterYawByUnitId.clear();
      lastUpdateTimeMs = null;
      debugSnapshot = {
        streamCount: 0,
        particleCount: 0,
        hoseSegments: 0,
        streamBodyCount: 0,
        jetCoreCount: 0,
        mistShellCount: 0,
        impactCount: 0,
        breakupCount: 0
      };
      return;
    }

    const cols = Math.max(1, sample.cols);
    const rows = Math.max(1, sample.rows);
    const heightScale = getTerrainHeightScale(cols, rows, sample.heightScaleMultiplier ?? 1);
    const worldPerTileX = terrainSize.width / cols;
    const worldPerTileZ = terrainSize.depth / rows;
    const worldPerTile = (worldPerTileX + worldPerTileZ) * 0.5;

    const resolveInterpolatedPosition = (
      unit: WorldState["units"][number]
    ): { x: number; y: number } => {
      const alpha = clamp(interpolationAlpha, 0, 1);
      return {
        x: unit.prevX + (unit.x - unit.prevX) * alpha,
        y: unit.prevY + (unit.y - unit.prevY) * alpha
      };
    };
    const resolveFirefighterYaw = (
      unit: WorldState["units"][number],
      x: number,
      y: number
    ): number => {
      const fallbackYaw = lastFirefighterYawByUnitId.get(unit.id) ?? 0;
      const desiredYaw = resolveDesiredUnitYaw(unit, x, y, fallbackYaw);
      if (!lastFirefighterYawByUnitId.has(unit.id)) {
        lastFirefighterYawByUnitId.set(unit.id, desiredYaw);
        return desiredYaw;
      }
      const engaged = unit.sprayTarget !== null || unit.attackTarget !== null;
      const response = engaged ? ENGAGED_FIREFIGHTER_TURN_RESPONSE : DEFAULT_FIREFIGHTER_TURN_RESPONSE;
      const yaw = approachAngleExp(fallbackYaw, desiredYaw, response, deltaSeconds);
      lastFirefighterYawByUnitId.set(unit.id, yaw);
      return yaw;
    };

    const trucks = new Map<number, { unit: WorldState["units"][number]; x: number; y: number }>();
    const nozzleByUnitId = new Map<number, { x: number; y: number; z: number }>();
    const firefighterPose = createFirefighterVisualState();
    const firefighterRoot = new THREE.Vector3();
    const firefighterNozzle = new THREE.Vector3();
    const activeFirefighterIds = new Set<number>();
    for (let i = 0; i < world.units.length; i += 1) {
      const unit = world.units[i];
      if (!unit) {
        continue;
      }
      const unitTile = resolveInterpolatedPosition(unit);
      if (unit.kind === "truck") {
        trucks.set(unit.id, { unit, x: unitTile.x, y: unitTile.y });
      }
      if (unit.kind === "firefighter" && unit.carrierId === null) {
        activeFirefighterIds.add(unit.id);
        const yaw = resolveFirefighterYaw(unit, unitTile.x, unitTile.y);
        firefighterRoot.set(
          toWorldX(unitTile.x, cols, terrainSize.width),
          sampleHeight(sample, unitTile.x, unitTile.y) * heightScale + FIREFIGHTER_MODEL_ROOT_Y_OFFSET,
          toWorldZ(unitTile.y, rows, terrainSize.depth)
        );
        updateFirefighterVisualState(unit, timeSec, firefighterPose);
        writeFirefighterGripWorldPosition(firefighterRoot, yaw, firefighterPose, firefighterNozzle);
        nozzleByUnitId.set(unit.id, {
          x: firefighterNozzle.x,
          y: firefighterNozzle.y,
          z: firefighterNozzle.z
        });
      } else {
        const nozzleX = toWorldX(unitTile.x, cols, terrainSize.width);
        const nozzleZ = toWorldZ(unitTile.y, rows, terrainSize.depth);
        const nozzleY =
          sampleHeight(sample, unitTile.x, unitTile.y) * heightScale +
          (unit.kind === "truck" ? HOSE_BASE_Y + 0.13 : HOSE_BASE_Y + 0.2);
        nozzleByUnitId.set(unit.id, { x: nozzleX, y: nozzleY, z: nozzleZ });
      }
    }
    Array.from(lastFirefighterYawByUnitId.keys()).forEach((unitId) => {
      if (!activeFirefighterIds.has(unitId)) {
        lastFirefighterYawByUnitId.delete(unitId);
      }
    });

    let hoseSegments = 0;
    for (let i = 0; i < world.units.length; i += 1) {
      const unit = world.units[i];
      if (!unit || unit.kind !== "firefighter" || unit.assignedTruckId === null) {
        continue;
      }
      const truckRef = trucks.get(unit.assignedTruckId) ?? null;
      if (!truckRef || truckRef.unit.crewMode === "boarded" || unit.carrierId === truckRef.unit.id) {
        continue;
      }
      if (hoseSegments >= MAX_HOSE_SEGMENTS) {
        break;
      }
      const truckX = toWorldX(truckRef.x, cols, terrainSize.width);
      const truckZ = toWorldZ(truckRef.y, rows, terrainSize.depth);
      const truckY = sampleHeight(sample, truckRef.x, truckRef.y) * heightScale + HOSE_BASE_Y + 0.11;
      const crewSource = nozzleByUnitId.get(unit.id) ?? null;
      if (!crewSource) {
        continue;
      }

      hoseDirection.set(crewSource.x - truckX, crewSource.y - truckY, crewSource.z - truckZ);
      const hoseLength = hoseDirection.length();
      if (hoseLength <= 0.0001) {
        continue;
      }
      hoseDirection.multiplyScalar(1 / hoseLength);
      hoseMidpoint.set(
        (truckX + crewSource.x) * 0.5,
        (truckY + crewSource.y) * 0.5,
        (truckZ + crewSource.z) * 0.5
      );
      hoseQuaternion.setFromUnitVectors(hoseUpAxis, hoseDirection);
      hoseScale.set(1, hoseLength, 1);
      hoseMatrix.compose(hoseMidpoint, hoseQuaternion, hoseScale);
      hoses.setMatrixAt(hoseSegments, hoseMatrix);
      hoseSegments += 1;
    }
    hoses.count = hoseSegments;
    hoses.instanceMatrix.needsUpdate = true;

    const streamFx = effects?.waterStreams ?? null;
    const spray = effects?.waterParticles ?? null;
    const particleCount = Math.min(MAX_WATER_PARTICLES, spray?.length ?? 0);
    const streamBySource = new Map<number, SprayStreamAggregate>();
    const streamCount = Math.min(MAX_WATER_STREAMS, streamFx?.length ?? 0);
    for (let i = 0; i < streamCount; i += 1) {
      const stream = streamFx![i];
      const sourceId = stream.sourceUnitId;
      const source = nozzleByUnitId.get(sourceId) ?? null;
      const modeValue = sprayModeToValue(stream.mode);
      const precisionMode = modeValue <= 0.5;
      const suppressionMode = modeValue >= 1.5;
      const modeVolumeScale = getModeVolumeScale(modeValue);
      const targetX = toWorldX(stream.targetX, cols, terrainSize.width);
      const targetZ = toWorldZ(stream.targetY, rows, terrainSize.depth);
      const targetY =
        sampleHeight(sample, stream.targetX, stream.targetY) * heightScale +
        (precisionMode ? 0.05 : suppressionMode ? 0.02 : 0.035);
      streamBySource.set(sourceId, {
        sourceX: source?.x ?? toWorldX(stream.sourceX, cols, terrainSize.width),
        sourceY:
          source?.y ??
          sampleHeight(sample, stream.sourceX, stream.sourceY) * heightScale +
            HOSE_BASE_Y +
            0.18,
        sourceZ: source?.z ?? toWorldZ(stream.sourceY, rows, terrainSize.depth),
        targetX,
        targetY,
        targetZ,
        mode: modeValue,
        volume: clamp(stream.volume * modeVolumeScale, 0, 1),
        intensity: clamp(stream.intensity, 0, 1),
        seed: (sourceId * 0.61803398875) % 1
      });
    }

    const activeSourceIds = new Set<number>();
    streamBySource.forEach((_value, sourceId) => activeSourceIds.add(sourceId));
    sprayVisualBySourceId.forEach((_value, sourceId) => activeSourceIds.add(sourceId));

    let streamBodyCount = 0;
    let jetCoreCount = 0;
    let mistShellCount = 0;
    let impactCount = 0;
    activeSourceIds.forEach((sourceId) => {
      if (
        streamBodyCount >= MAX_WATER_STREAMS &&
        jetCoreCount >= MAX_WATER_STREAMS &&
        mistShellCount >= MAX_WATER_STREAMS &&
        impactCount >= MAX_WATER_IMPACTS
      ) {
        return;
      }
      const aggregate = streamBySource.get(sourceId) ?? null;
      const source = nozzleByUnitId.get(sourceId) ?? null;
      let visual = sprayVisualBySourceId.get(sourceId) ?? null;
      if (!visual) {
        if (!aggregate) {
          return;
        }
        streamTargetPoint.set(
          aggregate.targetX - aggregate.sourceX,
          aggregate.targetY - aggregate.sourceY,
          aggregate.targetZ - aggregate.sourceZ
        );
        if (streamTargetPoint.lengthSq() <= 1e-8) {
          streamTargetDirection.copy(fallbackStreamDirection);
        } else {
          streamTargetDirection.copy(streamTargetPoint).normalize();
        }
        visual = {
          direction: streamTargetDirection.clone(),
          nozzleDirection: streamTargetDirection.clone(),
          tipDirection: streamTargetDirection.clone(),
          sourceX: aggregate.sourceX,
          sourceY: aggregate.sourceY,
          sourceZ: aggregate.sourceZ,
          length: worldPerTile * 1.2,
          tipX: aggregate.targetX,
          tipY: aggregate.targetY,
          tipZ: aggregate.targetZ,
          coreRadius: worldPerTile * 0.14,
          mistRadius: worldPerTile * 0.28,
          impactRadius: worldPerTile * 0.18,
          mode: aggregate.mode,
          volume: aggregate.volume,
          intensity: 0,
          flow: 0,
          seed: aggregate.seed
        };
        sprayVisualBySourceId.set(sourceId, visual);
      }

      if (source) {
        visual.sourceX = source.x;
        visual.sourceY = source.y;
        visual.sourceZ = source.z;
      } else if (aggregate) {
        visual.sourceX = aggregate.sourceX;
        visual.sourceY = aggregate.sourceY;
        visual.sourceZ = aggregate.sourceZ;
      }

      if (aggregate) {
        const precisionMode = aggregate.mode <= 0.5;
        const suppressionMode = aggregate.mode >= 1.5;
        const modeResponseScale = getModeResponseScale(aggregate.mode);
        const sprayEnvelopeBase =
          worldPerTile *
          (precisionMode ? 0.26 : suppressionMode ? 0.68 : 0.43) *
          (precisionMode ? 0.92 : suppressionMode ? 1.08 : 0.98 + aggregate.volume * 0.3);
        const targetMistRadius = Math.max(
          worldPerTile * (precisionMode ? 0.22 : suppressionMode ? 0.46 : 0.32),
          sprayEnvelopeBase * debugControls.mistRadiusScale
        );
        const targetCoreRadius = Math.max(
          worldPerTile * 0.12,
          sprayEnvelopeBase * (precisionMode ? 0.46 : suppressionMode ? 0.4 : 0.43) * debugControls.coreRadiusScale
        );
        const targetImpactRadius = Math.max(
          worldPerTile * (precisionMode ? 0.08 : suppressionMode ? 0.3 : 0.16) * debugControls.impactRadiusScale,
          targetMistRadius * (precisionMode ? 0.9 : suppressionMode ? 1.48 : 1.12) * debugControls.impactRadiusScale
        );
        streamTargetPoint.set(
          aggregate.targetX - visual.sourceX,
          aggregate.targetY - visual.sourceY,
          aggregate.targetZ - visual.sourceZ
        );
        const targetLength = Math.max(0.0001, streamTargetPoint.length());
        streamTargetDirection.copy(streamTargetPoint).multiplyScalar(1 / targetLength);
        approachUnitVectorExp(visual.nozzleDirection, streamTargetDirection, STREAM_NOZZLE_RESPONSE, deltaSeconds);
        approachUnitVectorExp(visual.tipDirection, streamTargetDirection, STREAM_TIP_RESPONSE, deltaSeconds);
        visual.length = approachExp(visual.length, targetLength, STREAM_LENGTH_RESPONSE, deltaSeconds);
        visual.mode = approachExp(visual.mode, aggregate.mode, 18, deltaSeconds);
        visual.volume = approachExp(visual.volume, aggregate.volume, 16, deltaSeconds);
        visual.flow = approachExp(
          visual.flow,
          clamp(aggregate.intensity * modeResponseScale * 1.15, 0, 1) > 0.01
            ? clamp(aggregate.intensity * modeResponseScale * 1.15, 0, 1)
            : 0,
          9.5,
          deltaSeconds
        );
        visual.intensity = approachExp(
          visual.intensity,
          clamp(Math.max(aggregate.intensity, 0.92) * modeResponseScale, 0, 1),
          aggregate.intensity * modeResponseScale >= visual.intensity ? 12 : 5.4,
          deltaSeconds
        );
        visual.coreRadius = approachExp(
          visual.coreRadius,
          targetCoreRadius,
          18,
          deltaSeconds
        );
        visual.mistRadius = approachExp(
          visual.mistRadius,
          targetMistRadius,
          16,
          deltaSeconds
        );
        visual.impactRadius = approachExp(
          visual.impactRadius,
          targetImpactRadius,
          14,
          deltaSeconds
        );
        visual.seed = aggregate.seed;
      } else {
        visual.flow = approachExp(visual.flow, 0, 3.6, deltaSeconds);
        visual.intensity = approachExp(visual.intensity, 0, 5.2, deltaSeconds);
        visual.coreRadius = approachExp(
          visual.coreRadius,
          Math.max(worldPerTile * 0.1, visual.coreRadius * 0.98),
          4.6,
          deltaSeconds
        );
        visual.mistRadius = approachExp(
          visual.mistRadius,
          Math.max(worldPerTile * 0.2, visual.mistRadius * 0.98),
          4.2,
          deltaSeconds
        );
        visual.impactRadius = approachExp(
          visual.impactRadius,
          Math.max(worldPerTile * 0.1, visual.impactRadius * 0.96),
          4,
          deltaSeconds
        );
      }

      visual.tipX = visual.sourceX + visual.tipDirection.x * visual.length;
      visual.tipY = visual.sourceY + visual.tipDirection.y * visual.length;
      visual.tipZ = visual.sourceZ + visual.tipDirection.z * visual.length;
      streamTargetPoint.set(visual.tipX - visual.sourceX, visual.tipY - visual.sourceY, visual.tipZ - visual.sourceZ);
      if (streamTargetPoint.lengthSq() <= 1e-8) {
        visual.direction.copy(visual.tipDirection);
      } else {
        visual.direction.copy(streamTargetPoint).normalize();
      }

      if (!source && !aggregate && visual.intensity <= 0.015 && visual.flow <= 0.015) {
        sprayVisualBySourceId.delete(sourceId);
        return;
      }

      const renderFlow = clamp(visual.flow, 0, 1);
      const renderIntensity = clamp(visual.intensity, 0, 1);
      const bodyStrength = clamp((0.62 + renderIntensity * 0.38) * Math.pow(renderFlow, 0.78), 0, 1);
      const coreStrength = clamp((0.16 + renderIntensity * 0.34) * Math.pow(renderFlow, 0.9), 0, 1);
      const shellStrength = clamp((0.08 + renderIntensity * 0.18) * Math.pow(renderFlow, 1.08), 0, 1);
      if (bodyStrength <= 0.015 || visual.length <= 0.0001) {
        if (!aggregate) {
          sprayVisualBySourceId.delete(sourceId);
        }
        return;
      }

      const precisionModeVisual = visual.mode <= 0.5;
      const suppressionModeVisual = visual.mode >= 1.5;
      const coneEnvelopeRadius = Math.max(
        visual.mistRadius,
        visual.coreRadius * (precisionModeVisual ? 1.9 : suppressionModeVisual ? 2.4 : 2.1)
      );
      const coneLengthTrim = Math.min(
        visual.length * (precisionModeVisual ? 0.03 : suppressionModeVisual ? 0.18 : 0.1),
        Math.max(
          worldPerTile * (precisionModeVisual ? 0.03 : suppressionModeVisual ? 0.12 : 0.07),
          coneEnvelopeRadius * (precisionModeVisual ? 0.08 : suppressionModeVisual ? 0.34 : 0.18)
        )
      );
      const terminalBlend = Math.min(
        visual.length * 0.04,
        Math.max(
          worldPerTile * 0.04,
          coneEnvelopeRadius * (precisionModeVisual ? 0.05 : suppressionModeVisual ? 0.025 : 0.035)
        )
      );
      const shellLength = Math.max(worldPerTile * 0.45, visual.length - coneLengthTrim + terminalBlend);
      const bodyBackoff = Math.max(
        worldPerTile * (precisionModeVisual ? 0.02 : suppressionModeVisual ? 0.08 : 0.05),
        coneEnvelopeRadius * (precisionModeVisual ? 0.04 : suppressionModeVisual ? 0.12 : 0.08)
      );
      const bodyLength = Math.max(worldPerTile * 0.35, shellLength - bodyBackoff);
      const bodyRadius =
        coneEnvelopeRadius *
        (precisionModeVisual ? 0.52 : suppressionModeVisual ? 0.92 : 0.66) *
        debugControls.streamBodyWidthScale;
      const mistRenderRadius = Math.max(
        coneEnvelopeRadius * (precisionModeVisual ? 0.78 : suppressionModeVisual ? 0.98 : 0.88),
        bodyRadius * (precisionModeVisual ? 1.025 : suppressionModeVisual ? 1.04 : 1.03)
      );
      writeStreamCurveControlPoint(visual, streamCurveControlPoint);
      const sharedNozzleRadius = HOSE_RADIUS * (precisionModeVisual ? 1.18 : suppressionModeVisual ? 1.42 : 1.28);
      const bodyNozzleRatio = clamp(sharedNozzleRadius / Math.max(bodyRadius * 0.42, 0.0001), 0.02, 1);
      if (debugControls.showStreamBody && streamBodyCount < MAX_WATER_STREAMS) {
        sprayMidpoint.set(
          visual.sourceX + visual.direction.x * bodyLength * 0.5,
          visual.sourceY + visual.direction.y * bodyLength * 0.5,
          visual.sourceZ + visual.direction.z * bodyLength * 0.5
        );
        sprayQuaternion.setFromUnitVectors(hoseUpAxis, visual.direction);
        sprayScale.set(bodyRadius, bodyLength, bodyRadius);
        sprayMatrix.compose(sprayMidpoint, sprayQuaternion, sprayScale);
        streamBodies.setMatrixAt(streamBodyCount, sprayMatrix);
        streamBodyBuffers.modeAttr.setX(streamBodyCount, clamp(visual.mode, 0, 2));
        streamBodyBuffers.volumeAttr.setX(streamBodyCount, clamp(visual.volume, 0, 1));
        streamBodyBuffers.seedAttr.setX(streamBodyCount, visual.seed);
        streamBodyBuffers.intensityAttr.setX(
          streamBodyCount,
          clamp(bodyStrength * debugControls.streamBodyOpacityScale, 0, 1)
        );
        streamBodyBuffers.nozzleRatioAttr.setX(streamBodyCount, bodyNozzleRatio);
        streamBodyCount += 1;
      }

      if (debugControls.showJetCore && jetCoreCount < MAX_WATER_STREAMS) {
        const coreLength = visual.length;
        const coreNozzleRatio = clamp(HOSE_RADIUS / Math.max(visual.coreRadius, 0.0001), 0.04, 1);
        sprayMidpoint.set(
          visual.sourceX + visual.direction.x * coreLength * 0.5,
          visual.sourceY + visual.direction.y * coreLength * 0.5,
          visual.sourceZ + visual.direction.z * coreLength * 0.5
        );
        sprayQuaternion.setFromUnitVectors(hoseUpAxis, visual.direction);
        sprayScale.set(visual.coreRadius, coreLength, visual.coreRadius);
        sprayMatrix.compose(sprayMidpoint, sprayQuaternion, sprayScale);
        jetCores.setMatrixAt(jetCoreCount, sprayMatrix);
        jetCoreBuffers.modeAttr.setX(jetCoreCount, clamp(visual.mode, 0, 2));
        jetCoreBuffers.volumeAttr.setX(jetCoreCount, clamp(visual.volume, 0, 1));
        jetCoreBuffers.seedAttr.setX(jetCoreCount, visual.seed);
        jetCoreBuffers.intensityAttr.setX(jetCoreCount, coreStrength);
        jetCoreBuffers.nozzleRatioAttr.setX(jetCoreCount, coreNozzleRatio);
        jetCoreCount += 1;
      }

      if (debugControls.showMistShell && mistShellCount < MAX_WATER_STREAMS) {
        const mistNozzleRatio = clamp(sharedNozzleRadius / Math.max(mistRenderRadius, 0.0001), 0.04, 1);
        sprayMidpoint.set(
          visual.sourceX + visual.direction.x * shellLength * 0.5,
          visual.sourceY + visual.direction.y * shellLength * 0.5,
          visual.sourceZ + visual.direction.z * shellLength * 0.5
        );
        sprayQuaternion.setFromUnitVectors(hoseUpAxis, visual.direction);
        sprayScale.set(mistRenderRadius, shellLength, mistRenderRadius);
        sprayMatrix.compose(sprayMidpoint, sprayQuaternion, sprayScale);
        mistShells.setMatrixAt(mistShellCount, sprayMatrix);
        mistShellBuffers.modeAttr.setX(mistShellCount, clamp(visual.mode, 0, 2));
        mistShellBuffers.volumeAttr.setX(mistShellCount, clamp(visual.volume, 0, 1));
        mistShellBuffers.seedAttr.setX(mistShellCount, visual.seed + 0.37);
        mistShellBuffers.intensityAttr.setX(
          mistShellCount,
          shellStrength * (visual.mode <= 0.5 ? 0.48 : visual.mode >= 1.5 ? 0.96 : 0.72)
        );
        mistShellBuffers.nozzleRatioAttr.setX(mistShellCount, mistNozzleRatio);
        mistShellCount += 1;
      }

      if (debugControls.showImpact && impactCount < MAX_WATER_IMPACTS && renderFlow > 0.16) {
        const impactAnchorDistance = Math.max(
          0,
          Math.min(visual.length, shellLength - Math.max(worldPerTile * 0.04, mistRenderRadius * 0.04))
        );
        const impactAlong01 = clamp(impactAnchorDistance / Math.max(visual.length, 0.0001), 0, 1);
        sampleStreamCurvePoint(visual, impactAlong01, streamCurveControlPoint, streamCurvePoint);
        sampleStreamCurveTangent(visual, impactAlong01, streamCurveControlPoint, streamCurveTangent);
        const impactCenterX = streamCurvePoint.x;
        const impactCenterZ = streamCurvePoint.z;
        const impactTerrainY =
          sampleWorldHeight(sample, terrainSize, cols, rows, heightScale, impactCenterX, impactCenterZ) + 0.03;
        const impactCenterY = Math.max(impactTerrainY, streamCurvePoint.y);
        const impactFootprintRadius = Math.max(
          visual.impactRadius,
          bodyRadius * (precisionModeVisual ? 0.96 : suppressionModeVisual ? 1.08 : 1),
          mistRenderRadius * (precisionModeVisual ? 0.88 : suppressionModeVisual ? 0.96 : 0.92)
        );
        const impactBaseAlpha = clamp(
          renderIntensity *
            Math.pow(renderFlow, 1.7) *
            (visual.mode <= 0.5 ? 0.22 : visual.mode >= 1.5 ? 0.7 : 0.42),
          0,
          1
        );
        const impactBaseSize = clamp((impactFootprintRadius / Math.max(worldPerTile, 0.0001)) * 34, 12, 60);
        swayAxisA.crossVectors(streamCurveTangent, hoseUpAxis);
        if (swayAxisA.lengthSq() <= 0.000001) {
          swayAxisA.copy(swayFallbackAxis);
        } else {
          swayAxisA.normalize();
        }
        const impactLateralOffset = impactFootprintRadius * (precisionModeVisual ? 0.34 : suppressionModeVisual ? 0.58 : 0.46);
        const impactSamples: ReadonlyArray<{ offset: number; alphaScale: number; sizeScale: number; seedOffset: number }> =
          precisionModeVisual
            ? [
                { offset: 0, alphaScale: 1, sizeScale: 1, seedOffset: 0 },
                { offset: 0.8, alphaScale: 0.52, sizeScale: 0.72, seedOffset: 0.17 },
                { offset: -0.8, alphaScale: 0.52, sizeScale: 0.72, seedOffset: 0.31 }
              ]
            : suppressionModeVisual
              ? [
                  { offset: 0, alphaScale: 1, sizeScale: 1, seedOffset: 0 },
                  { offset: 1, alphaScale: 0.72, sizeScale: 0.86, seedOffset: 0.17 },
                  { offset: -1, alphaScale: 0.72, sizeScale: 0.86, seedOffset: 0.31 }
                ]
              : [
                  { offset: 0, alphaScale: 1, sizeScale: 1, seedOffset: 0 },
                  { offset: 0.92, alphaScale: 0.62, sizeScale: 0.8, seedOffset: 0.17 },
                  { offset: -0.92, alphaScale: 0.62, sizeScale: 0.8, seedOffset: 0.31 }
                ];
        for (let impactIdx = 0; impactIdx < impactSamples.length && impactCount < MAX_WATER_IMPACTS; impactIdx += 1) {
          const sampleDef = impactSamples[impactIdx]!;
          const impactOffset = impactCount * 3;
          impactPositions[impactOffset] = impactCenterX + swayAxisA.x * impactLateralOffset * sampleDef.offset;
          impactPositions[impactOffset + 1] = impactCenterY;
          impactPositions[impactOffset + 2] = impactCenterZ + swayAxisA.z * impactLateralOffset * sampleDef.offset;
          impactAlpha[impactCount] = clamp(impactBaseAlpha * sampleDef.alphaScale, 0, 1);
          impactSize[impactCount] = clamp(impactBaseSize * sampleDef.sizeScale, 10, 60);
          impactMode[impactCount] = clamp(visual.mode, 0, 2);
          impactSeed[impactCount] = fract(visual.seed + sampleDef.seedOffset);
          impactCount += 1;
        }
      }
    });
    streamBodies.count = streamBodyCount;
    streamBodies.instanceMatrix.needsUpdate = true;
    streamBodyBuffers.modeAttr.needsUpdate = true;
    streamBodyBuffers.volumeAttr.needsUpdate = true;
    streamBodyBuffers.seedAttr.needsUpdate = true;
    streamBodyBuffers.intensityAttr.needsUpdate = true;
    streamBodyBuffers.nozzleRatioAttr.needsUpdate = true;
    jetCores.count = jetCoreCount;
    jetCores.instanceMatrix.needsUpdate = true;
    jetCoreBuffers.modeAttr.needsUpdate = true;
    jetCoreBuffers.volumeAttr.needsUpdate = true;
    jetCoreBuffers.seedAttr.needsUpdate = true;
    jetCoreBuffers.intensityAttr.needsUpdate = true;
    jetCoreBuffers.nozzleRatioAttr.needsUpdate = true;
    mistShells.count = mistShellCount;
    mistShells.instanceMatrix.needsUpdate = true;
    mistShellBuffers.modeAttr.needsUpdate = true;
    mistShellBuffers.volumeAttr.needsUpdate = true;
    mistShellBuffers.seedAttr.needsUpdate = true;
    mistShellBuffers.intensityAttr.needsUpdate = true;
    mistShellBuffers.nozzleRatioAttr.needsUpdate = true;
    impactGeometry.setDrawRange(0, Math.min(impactCount, impactPosAttr.count));
    impactPosAttr.needsUpdate = true;
    impactAlphaAttr.needsUpdate = true;
    impactSizeAttr.needsUpdate = true;
    impactModeAttr.needsUpdate = true;
    impactSeedAttr.needsUpdate = true;

    let breakupCount = 0;
    const appendBreakupPoint = (
      wx: number,
      wy: number,
      wz: number,
      alpha: number,
      size: number,
      modeValue: number,
      volume: number,
      seed: number,
      pulseHz: number,
      age01: number
    ): boolean => {
      if (breakupCount >= MAX_WATER_PARTICLES) {
        return false;
      }
      const posOffset = breakupCount * 3;
      waterPositions[posOffset] = wx;
      waterPositions[posOffset + 1] = wy;
      waterPositions[posOffset + 2] = wz;
      waterAlpha[breakupCount] = clamp(alpha, 0, 1);
      waterSize[breakupCount] = clamp(size, 0.7, 5.2);
      waterMode[breakupCount] = clamp(modeValue, 0, 2);
      waterVolume[breakupCount] = clamp(volume, 0, 1);
      waterSeed[breakupCount] = seed;
      waterPulseHz[breakupCount] = Math.max(2, Math.min(12, pulseHz));
      waterAge01[breakupCount] = clamp(age01, 0, 1);
      breakupCount += 1;
      return true;
    };

    for (let i = 0; debugControls.showBreakup && i < particleCount && breakupCount < MAX_WATER_PARTICLES; i += 1) {
      const particle = spray![i];
      const sourceId = particle.spraySourceId;
      if (typeof sourceId !== "number") {
        continue;
      }
      const visual = sprayVisualBySourceId.get(sourceId);
      if (!visual) {
        continue;
      }
      const renderFlow = clamp(visual.flow, 0, 1);
      const renderIntensity = clamp(visual.intensity, 0, 1);
      if (renderIntensity <= 0.08 || renderFlow <= 0.22) {
        continue;
      }
      const modeValue = sprayModeToValue(particle.sprayMode);
      const volume = clamp(particle.sprayVolume ?? defaultVolumeForMode(modeValue), 0, 1);
      const wx = toWorldX(particle.x, cols, terrainSize.width);
      const wz = toWorldZ(particle.y, rows, terrainSize.depth);
      const particleAlpha = clamp(particle.alpha, 0, 1);
      const particleLife01 =
        particle.maxLife > 0
          ? clamp(1 - particle.life / particle.maxLife, 0, 1)
          : clamp(1 - particle.alpha, 0, 1);
      const distFromSource = Math.hypot(wx - visual.sourceX, wz - visual.sourceZ);
      const distToTip = Math.hypot(wx - visual.tipX, wz - visual.tipZ);
      const breakupStart = visual.length * (modeValue <= 0.5 ? 0.84 : modeValue >= 1.5 ? 0.78 : 0.8);
      const tailInfluence = clamp(
        (distFromSource - breakupStart) / Math.max(visual.length * 0.18, worldPerTile * 0.24),
        0,
        1
      );
      const tipInfluence = 1 - clamp(distToTip / Math.max(visual.impactRadius * 1.7, worldPerTile * 0.3), 0, 1);
      const breakupInfluence = Math.max(tailInfluence * 0.28, Math.pow(tipInfluence, 0.82));
      if (breakupInfluence <= 0.02 || particleLife01 < 0.32) {
        continue;
      }
      writeStreamCurveControlPoint(visual, streamCurveControlPoint);
      sampleStreamCurvePoint(
        visual,
        clamp(distFromSource / Math.max(visual.length, 0.0001), 0, 1),
        streamCurveControlPoint,
        streamCurvePoint
      );
      const expectedY = streamCurvePoint.y;
      const terrainY = sampleWorldHeight(sample, terrainSize, cols, rows, heightScale, wx, wz) + 0.03;
      const wy = Math.max(terrainY, expectedY - worldPerTile * 0.04);
      const drawAlpha = clamp(
        particleAlpha *
          breakupInfluence *
          Math.pow(renderFlow, 1.85) *
          (0.05 + renderIntensity * 0.08) *
          (0.6 + volume * 0.12) *
          debugControls.breakupAlphaScale,
        0,
        1
      );
      if (drawAlpha <= 0.02) {
        continue;
      }
      const modeSizeScale = modeValue <= 0.5 ? 0.86 : modeValue >= 1.5 ? 1.02 : 0.94;
      appendBreakupPoint(
        wx,
        wy,
        wz,
        drawAlpha,
        particle.size *
          0.12 *
          modeSizeScale *
          (0.62 + volume * 0.14) *
          (0.72 + breakupInfluence * 0.22) *
          debugControls.breakupSizeScale,
        modeValue,
        volume,
        Number.isFinite(particle.spraySeed) ? particle.spraySeed! : (i * 0.61803398875) % 1,
        Number.isFinite(particle.sprayPulseHz)
          ? particle.sprayPulseHz! * debugControls.pulseRateScale
          : defaultPulseForMode(modeValue) * debugControls.pulseRateScale,
        particleLife01
      );
    }

    if (debugControls.showBreakup && breakupCount < MAX_WATER_PARTICLES) {
      sprayVisualBySourceId.forEach((visual) => {
        if (breakupCount >= MAX_WATER_PARTICLES) {
          return;
        }
        const renderFlow = clamp(visual.flow, 0, 1);
        const renderIntensity = clamp(visual.intensity, 0, 1);
        if (renderIntensity <= 0.08 || renderFlow <= 0.2 || visual.length <= 0.0001) {
          return;
        }

        const modeValue = clamp(visual.mode, 0, 2);
        const volume = clamp(visual.volume, 0, 1);
        const suppressionMode = modeValue >= 1.5;
        const precisionMode = modeValue <= 0.5;
        writeStreamCurveControlPoint(visual, streamCurveControlPoint);

        const sheetCount = precisionMode ? 16 : suppressionMode ? 36 : 24;
        const sheetSpeed = precisionMode ? 1.7 : suppressionMode ? 1.02 : 1.34;
        for (let j = 0; j < sheetCount && breakupCount < MAX_WATER_PARTICLES; j += 1) {
          const seed = fract(visual.seed * 0.91 + j * 0.61803398875);
          const seedA = fract(seed * 1.73 + 0.17);
          const seedB = fract(seed * 2.41 + 0.43);
          const seedC = fract(seed * 3.19 + 0.71);
          const progress = fract(timeSec * sheetSpeed + j / Math.max(1, sheetCount) + seedA * 0.24);
          const along = 0.08 + Math.pow(progress, suppressionMode ? 1.14 : precisionMode ? 0.88 : 0.98) * 0.86;
          const cone01 = Math.pow(along, suppressionMode ? 1.06 : precisionMode ? 1.34 : 1.18);
          const widthEnvelope = THREE.MathUtils.lerp(
            HOSE_RADIUS * (precisionMode ? 1.04 : suppressionMode ? 1.34 : 1.18),
            visual.mistRadius * (precisionMode ? 0.34 : suppressionMode ? 1.04 : 0.66),
            cone01
          );
          const shellBias = THREE.MathUtils.lerp(
            0.08,
            suppressionMode ? 0.84 : precisionMode ? 0.48 : 0.68,
            cone01
          );
          const angle = TAU * fract(seedB + j * 0.173);
          const radial = widthEnvelope * (shellBias + seedC * (1 - shellBias));
          const lateralA = Math.cos(angle) * radial;
          const lateralB = Math.sin(angle) * radial * (precisionMode ? 0.3 : suppressionMode ? 0.78 : 0.52);
          sampleStreamCurvePoint(visual, along, streamCurveControlPoint, streamCurvePoint);
          sampleStreamCurveTangent(visual, along, streamCurveControlPoint, streamBaseDirection);
          swayAxisA.crossVectors(streamBaseDirection, hoseUpAxis);
          if (swayAxisA.lengthSq() <= 0.000001) {
            swayAxisA.copy(swayFallbackAxis);
          } else {
            swayAxisA.normalize();
          }
          swayAxisB.crossVectors(swayAxisA, streamBaseDirection);
          if (swayAxisB.lengthSq() <= 0.000001) {
            swayAxisB.copy(hoseUpAxis);
          } else {
            swayAxisB.normalize();
          }
          swayTargetPoint.set(
            streamCurvePoint.x + swayAxisA.x * lateralA + swayAxisB.x * lateralB,
            streamCurvePoint.y + swayAxisA.y * lateralA + swayAxisB.y * lateralB,
            streamCurvePoint.z + swayAxisA.z * lateralA + swayAxisB.z * lateralB
          );
          const terrainY =
            sampleWorldHeight(sample, terrainSize, cols, rows, heightScale, swayTargetPoint.x, swayTargetPoint.z) + 0.03;
          const pointY = Math.max(terrainY, swayTargetPoint.y);
          const drawAlpha =
            (0.05 + renderIntensity * 0.07) *
            (0.44 + Math.pow(along, 0.72) * 0.56) *
            (0.62 + volume * 0.18) *
            debugControls.breakupAlphaScale;
          appendBreakupPoint(
            swayTargetPoint.x,
            pointY,
            swayTargetPoint.z,
            drawAlpha,
            (1.0 + seedA * 1.2 + widthEnvelope / Math.max(worldPerTile, 0.0001) * 0.24) * debugControls.breakupSizeScale,
            modeValue,
            volume,
            seed,
            defaultPulseForMode(modeValue) * debugControls.pulseRateScale * (precisionMode ? 1.18 + seedB * 0.3 : suppressionMode ? 0.96 + seedB * 0.22 : 1.06 + seedB * 0.26),
            0.42 + seedC * 0.44
          );
        }

        const tipCount = precisionMode ? 18 : suppressionMode ? 40 : 28;
        sampleStreamCurveTangent(visual, 0.96, streamCurveControlPoint, streamBaseDirection);
        swayAxisA.crossVectors(streamBaseDirection, hoseUpAxis);
        if (swayAxisA.lengthSq() <= 0.000001) {
          swayAxisA.copy(swayFallbackAxis);
        } else {
          swayAxisA.normalize();
        }
        swayAxisB.crossVectors(swayAxisA, streamBaseDirection);
        if (swayAxisB.lengthSq() <= 0.000001) {
          swayAxisB.copy(hoseUpAxis);
        } else {
          swayAxisB.normalize();
        }
        for (let j = 0; j < tipCount && breakupCount < MAX_WATER_PARTICLES; j += 1) {
          const seed = fract(visual.seed * 1.37 + j * 0.754877666);
          const seedA = fract(seed * 1.61 + 0.27);
          const seedB = fract(seed * 2.77 + 0.49);
          const seedC = fract(seed * 3.31 + 0.08);
          const burstSpeed = precisionMode ? 1.86 : suppressionMode ? 1.18 : 1.46;
          const burstAge = fract(timeSec * burstSpeed + seedC * 0.93 + j / Math.max(1, tipCount) * 0.37);
          const burst01 = Math.pow(burstAge, suppressionMode ? 0.78 : precisionMode ? 0.92 : 0.84);
          const angle = TAU * seedA;
          const radial =
            visual.impactRadius *
            burst01 *
            (precisionMode ? 0.28 + seedB * 0.72 : suppressionMode ? 0.4 + seedB * 1.2 : 0.34 + seedB * 0.94);
          const forward =
            visual.impactRadius *
              burst01 *
              (precisionMode ? 0.18 + seedC * 0.32 : suppressionMode ? 0.28 + seedC * 0.82 : 0.22 + seedC * 0.56) +
            worldPerTile * 0.04;
          const upward = visual.impactRadius * burst01 * (precisionMode ? 0.08 : suppressionMode ? 0.16 : 0.12);
          swayTargetPoint.set(
            visual.tipX + streamBaseDirection.x * forward + swayAxisA.x * Math.cos(angle) * radial + swayAxisB.x * Math.sin(angle) * radial * 0.72,
            visual.tipY + streamBaseDirection.y * forward + swayAxisA.y * Math.cos(angle) * radial + swayAxisB.y * Math.sin(angle) * radial * 0.72 + upward,
            visual.tipZ + streamBaseDirection.z * forward + swayAxisA.z * Math.cos(angle) * radial + swayAxisB.z * Math.sin(angle) * radial * 0.72
          );
          const terrainY =
            sampleWorldHeight(sample, terrainSize, cols, rows, heightScale, swayTargetPoint.x, swayTargetPoint.z) + 0.03;
          const pointY = Math.max(terrainY, swayTargetPoint.y);
          appendBreakupPoint(
            swayTargetPoint.x,
            pointY,
            swayTargetPoint.z,
            (precisionMode ? 0.1 : suppressionMode ? 0.16 : 0.12 + renderIntensity * 0.08) *
              (1.0 - burstAge) *
              (0.74 + volume * 0.22) *
              debugControls.breakupAlphaScale,
            (1.4 + seedC * 1.8 + visual.impactRadius / Math.max(worldPerTile, 0.0001) * 0.18) *
              (0.92 + burstAge * 2.1) *
              debugControls.breakupSizeScale,
            modeValue,
            volume,
            seed,
            defaultPulseForMode(modeValue) *
              debugControls.pulseRateScale *
              (precisionMode ? 0.94 + seedB * 0.14 : suppressionMode ? 0.82 + seedB * 0.16 : 0.88 + seedB * 0.15),
            burstAge
          );
        }
      });
    }
    waterGeometry.setDrawRange(0, Math.min(breakupCount, waterPosAttr.count));
    waterPosAttr.needsUpdate = true;
    waterAlphaAttr.needsUpdate = true;
    waterSizeAttr.needsUpdate = true;
    waterModeAttr.needsUpdate = true;
    waterVolumeAttr.needsUpdate = true;
    waterSeedAttr.needsUpdate = true;
    waterPulseAttr.needsUpdate = true;
    waterAgeAttr.needsUpdate = true;
    debugSnapshot = {
      streamCount,
      particleCount,
      hoseSegments,
      streamBodyCount,
      jetCoreCount,
      mistShellCount,
      impactCount,
      breakupCount
    };
  };

  const dispose = (): void => {
    scene.remove(hoses);
    scene.remove(waterPoints);
    scene.remove(jetCores);
    scene.remove(streamBodies);
    scene.remove(mistShells);
    scene.remove(impactPoints);
    hoseGeometry.dispose();
    hoseMaterial.dispose();
    waterGeometry.dispose();
    waterMaterial.dispose();
    jetCoreBuffers.geometry.dispose();
    streamBodyBuffers.geometry.dispose();
    mistShellBuffers.geometry.dispose();
    jetCoreMaterial.dispose();
    streamBodyMaterial.dispose();
    mistShellMaterial.dispose();
    impactGeometry.dispose();
    impactMaterial.dispose();
  };

  const setDebugControls = (controls: Partial<WaterFxDebugControls>): void => {
    if (Object.keys(controls).length === 0) {
      return;
    }
    debugControls = normalizeWaterFxDebugControls({ ...debugControls, ...controls });
  };

  const getDebugControls = (): WaterFxDebugControls => ({ ...debugControls });

  const getDebugSnapshot = (): WaterFxDebugSnapshot => ({ ...debugSnapshot });

  return { update, setDebugControls, getDebugControls, getDebugSnapshot, dispose };
};
