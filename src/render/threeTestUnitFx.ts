import * as THREE from "three";
import type { EffectsState } from "../core/effectsState.js";
import type { WorldState } from "../core/state.js";
import type { WaterSprayMode } from "../core/types.js";
import { getTerrainHeightScale, type TerrainSample } from "./threeTestTerrain.js";

const MAX_HOSE_SEGMENTS = 1024;
const MAX_WATER_PARTICLES = 4096;
const MAX_WATER_STREAMS = 768;
const MAX_WATER_IMPACTS = MAX_WATER_STREAMS;
const HOSE_BASE_Y = 0.08;
const HOSE_RADIUS = 0.017;
const HOSE_COLOR = new THREE.Color(0xffffff);
const WATER_CORE_COLOR = new THREE.Color(0xf4fcff);
const WATER_EDGE_COLOR = new THREE.Color(0x6ecbff);
const WATER_MIST_COLOR = new THREE.Color(0xc2ebff);
const WATER_JET_CORE_COLOR = new THREE.Color(0xffffff);
const WATER_JET_EDGE_COLOR = new THREE.Color(0x78d8ff);
const WATER_SHELL_CORE_COLOR = new THREE.Color(0xeef8ff);
const WATER_SHELL_EDGE_COLOR = new THREE.Color(0x6ecfff);
const WATER_IMPACT_CORE_COLOR = new THREE.Color(0xf5fcff);
const WATER_IMPACT_EDGE_COLOR = new THREE.Color(0x8edcff);
const TAU = Math.PI * 2;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const expFactor = (rate: number, dtSeconds: number): number =>
  1 - Math.exp(-Math.max(0, rate) * Math.max(0, dtSeconds));
const approachExp = (current: number, target: number, rate: number, dtSeconds: number): number =>
  current + (target - current) * expFactor(rate, dtSeconds);

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
    float ageFade = smoothstep(0.18, 0.48, clamp(aAge01, 0.0, 1.0)) * (1.0 - smoothstep(0.84, 1.0, clamp(aAge01, 0.0, 1.0)));
    float sizeScale = mix(0.74, 1.02, mode01);
    float pointSize = aSize * (134.0 / dist) * pulse * volumeScale * sizeScale * mix(0.45, 1.0, ageFade);
    gl_PointSize = max(2.0, pointSize);
    gl_Position = projectionMatrix * mvPosition;
    vAlpha = clamp(aAlpha, 0.0, 1.0) * mix(1.02, 0.8, mode01);
    vMode = clamp(aMode, 0.0, 2.0);
    vVolume = clamp(aVolume, 0.0, 1.0);
    vSeed = aSeed;
    vPulse = pulse;
    vAge01 = clamp(aAge01, 0.0, 1.0);
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
    float pulseGlow = 0.72 + vPulse * 0.32;
    float volumeBoost = mix(0.68, 1.02, vVolume);
    float lifeFade = smoothstep(0.18, 0.5, vAge01) * (1.0 - smoothstep(0.84, 1.0, vAge01));
    float alpha = vAlpha * outer * pulseGlow * volumeBoost * lifeFade;
    alpha *= mix(0.88, 0.68, mode01);
    alpha *= mix(0.56, 0.92, shell);
    alpha = clamp(alpha, 0.0, 1.0);
    if (alpha <= 0.01) {
      discard;
    }

    vec3 color = mix(uEdgeColor, uCoreColor, core);
    color = mix(color, uMistColor, mist * 0.36);
    color += vec3(core * 0.1 * (0.4 + vVolume * 0.4));
    gl_FragColor = vec4(color * alpha, alpha);
  }
`;

const waterJetCoreVertexShader = `
  precision highp float;
  uniform float uTimeSec;
  attribute float aMode;
  attribute float aVolume;
  attribute float aSeed;
  attribute float aIntensity;
  varying float vAlong;
  varying float vRadial;
  varying float vMode;
  varying float vVolume;
  varying float vSeed;
  varying float vIntensity;
  void main() {
    float along = clamp(position.y + 0.5, 0.0, 1.0);
    float mode01 = clamp(aMode * 0.5, 0.0, 1.0);
    float intensity = clamp(aIntensity, 0.0, 1.0);
    vec3 localPos = position;
    float nozzleBody = mix(1.26, 1.0, smoothstep(0.0, 0.22, along));
    float tipFade = 1.0 - smoothstep(0.9, 1.0, along);
    float taper = 1.0 - smoothstep(0.74, 0.98, along) * 0.82;
    float ripple = sin(along * mix(12.0, 8.2, mode01) - uTimeSec * mix(15.0, 10.0, mode01) + aSeed * 31.4159);
    float sway = sin(along * 6.2 - uTimeSec * 4.6 + aSeed * 19.1);
    float widthProfile = nozzleBody * taper * mix(0.96, 1.04, tipFade);
    widthProfile *= mix(0.92, 1.06, clamp(aVolume, 0.0, 1.0));
    widthProfile *= mix(0.9, 1.06, intensity);
    widthProfile *= 1.0 + ripple * 0.018 * smoothstep(0.18, 0.92, along);
    localPos.xz *= widthProfile;
    localPos.x += ripple * 0.014 * smoothstep(0.22, 0.94, along);
    localPos.z += sway * 0.01 * smoothstep(0.28, 1.0, along);
    vAlong = along;
    vRadial = clamp(length(position.xz), 0.0, 1.0);
    vMode = clamp(aMode, 0.0, 2.0);
    vVolume = clamp(aVolume, 0.0, 1.0);
    vSeed = aSeed;
    vIntensity = intensity;
    vec4 worldPos = modelMatrix * instanceMatrix * vec4(localPos, 1.0);
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

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123 + vSeed * 17.0);
  }

  void main() {
    float mode01 = clamp(vMode * 0.5, 0.0, 1.0);
    float intensity = clamp(vIntensity, 0.0, 1.0);
    float entryFade = mix(0.82, 1.0, smoothstep(0.0, 0.05, vAlong));
    float exitFade = 1.0 - smoothstep(0.93, 1.0, vAlong);
    float body = entryFade * exitFade;
    float radialCore = 1.0 - smoothstep(0.0, mix(0.22, 0.28, mode01), vRadial);
    float radialBody = 1.0 - smoothstep(mix(0.4, 0.5, mode01), 1.0, vRadial);
    float streak = 0.66 + 0.34 * sin(vAlong * mix(22.0, 15.0, mode01) - uTimeSec * mix(16.0, 10.0, mode01) + vSeed * 23.0);
    float noise = hash(vec2(vAlong * 14.0 + uTimeSec * 0.8, vRadial * 9.8 + vSeed * 7.3));
    float breakup = smoothstep(0.78, 1.0, noise + vAlong * 0.2 + (1.0 - radialBody) * 0.1);
    float alpha = body * radialBody;
    alpha *= mix(0.94, 1.1, clamp(vVolume, 0.0, 1.0));
    alpha *= mix(0.72, 1.18, intensity);
    alpha *= mix(1.06, 0.96, mode01);
    alpha *= mix(0.94, 1.08, streak);
    alpha *= 1.16 - breakup * 0.1;
    alpha = clamp(alpha * 1.42, 0.0, 1.0);
    if (alpha <= 0.01) {
      discard;
    }
    vec3 color = mix(uEdgeColor, uCoreColor, radialCore);
    color += vec3(radialCore * 0.16 * (0.65 + intensity * 0.55));
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
  varying float vAlong;
  varying float vRadial;
  varying float vMode;
  varying float vVolume;
  varying float vSeed;
  varying float vIntensity;
  void main() {
    float along = clamp(position.y + 0.5, 0.0, 1.0);
    float mode01 = clamp(aMode * 0.5, 0.0, 1.0);
    vec3 localPos = position;
    float growth = smoothstep(0.02, 0.82, along);
    float taper = 1.0 - smoothstep(0.88, 1.0, along) * 0.32;
    float widthProfile = mix(0.42, mix(0.84, 1.12, mode01), growth) * taper;
    widthProfile *= mix(0.88, 1.18, clamp(aVolume, 0.0, 1.0));
    float ripple = sin(along * mix(10.0, 7.0, mode01) - uTimeSec * mix(11.0, 7.0, mode01) + aSeed * 27.0);
    float swirl = sin(along * 5.4 - uTimeSec * 3.8 + aSeed * 14.0);
    localPos.xz *= widthProfile * (1.0 + ripple * 0.045 * growth);
    localPos.x += ripple * 0.03 * growth;
    localPos.z += swirl * 0.026 * growth;
    vAlong = along;
    vRadial = clamp(length(position.xz), 0.0, 1.0);
    vMode = clamp(aMode, 0.0, 2.0);
    vVolume = clamp(aVolume, 0.0, 1.0);
    vSeed = aSeed;
    vIntensity = clamp(aIntensity, 0.0, 1.0);
    vec4 worldPos = modelMatrix * instanceMatrix * vec4(localPos, 1.0);
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

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(97.1, 281.7))) * 43758.5453123 + vSeed * 11.0);
  }

  void main() {
    float mode01 = clamp(vMode * 0.5, 0.0, 1.0);
    float entryFade = mix(0.5, 1.0, smoothstep(0.0, 0.1, vAlong));
    float exitFade = 1.0 - smoothstep(0.88, 1.0, vAlong);
    float shellInner = smoothstep(0.12, mix(0.34, 0.24, mode01), vRadial);
    float shellOuter = 1.0 - smoothstep(mix(0.84, 0.94, mode01), 1.0, vRadial);
    float shell = shellInner * shellOuter;
    float noise = hash(vec2(vAlong * 11.0 + uTimeSec * 0.55, vRadial * 13.0 + vSeed * 5.2));
    float feather = 1.0 - smoothstep(0.8, 1.0, noise + vAlong * 0.14);
    float alpha = entryFade * exitFade * shell * feather;
    alpha *= mix(0.3, 0.42, clamp(vVolume, 0.0, 1.0));
    alpha *= mix(0.56, 1.0, clamp(vIntensity, 0.0, 1.0));
    alpha *= mix(0.76, 1.08, mode01);
    alpha = clamp(alpha * 1.26, 0.0, 1.0);
    if (alpha <= 0.01) {
      discard;
    }
    vec3 color = mix(uEdgeColor, uCoreColor, 1.0 - vRadial);
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
    gl_FragColor = vec4(color * alpha, alpha);
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

export type ThreeTestUnitFxLayer = {
  update: (
    world: WorldState,
    effects: EffectsState | null,
    sample: TerrainSample | null,
    terrainSize: { width: number; depth: number } | null,
    interpolationAlpha: number,
    timeMs: number
  ) => void;
  dispose: () => void;
};

export const createThreeTestUnitFxLayer = (scene: THREE.Scene): ThreeTestUnitFxLayer => {
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
    blending: THREE.NormalBlending,
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
  } => {
    const geometry = new THREE.CylinderGeometry(1, 1, 1, 18, 12, true);
    const modeAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_WATER_STREAMS), 1);
    const volumeAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_WATER_STREAMS), 1);
    const seedAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_WATER_STREAMS), 1);
    const intensityAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_WATER_STREAMS), 1);
    modeAttr.setUsage(THREE.DynamicDrawUsage);
    volumeAttr.setUsage(THREE.DynamicDrawUsage);
    seedAttr.setUsage(THREE.DynamicDrawUsage);
    intensityAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("aMode", modeAttr);
    geometry.setAttribute("aVolume", volumeAttr);
    geometry.setAttribute("aSeed", seedAttr);
    geometry.setAttribute("aIntensity", intensityAttr);
    return { geometry, modeAttr, volumeAttr, seedAttr, intensityAttr };
  };

  const jetCoreBuffers = createTubeBuffers();
  const mistShellBuffers = createTubeBuffers();
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
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
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
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false
  });
  const jetCores = new THREE.InstancedMesh(jetCoreBuffers.geometry, jetCoreMaterial, MAX_WATER_STREAMS);
  jetCores.count = 0;
  jetCores.frustumCulled = false;
  jetCores.renderOrder = 13;
  scene.add(jetCores);
  const mistShells = new THREE.InstancedMesh(mistShellBuffers.geometry, mistShellMaterial, MAX_WATER_STREAMS);
  mistShells.count = 0;
  mistShells.frustumCulled = false;
  mistShells.renderOrder = 12;
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
  const swayFallbackAxis = new THREE.Vector3(1, 0, 0);
  const fallbackStreamDirection = new THREE.Vector3(0, -0.04, 1).normalize();
  const sprayVisualBySourceId = new Map<number, SprayStreamVisualState>();
  let lastUpdateTimeMs: number | null = null;

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
    mistShellMaterial.uniforms.uTimeSec.value = timeSec;
    impactMaterial.uniforms.uTimeSec.value = timeSec;
    const deltaSeconds =
      lastUpdateTimeMs === null ? 1 / 60 : clamp((timeMs - lastUpdateTimeMs) * 0.001, 1 / 240, 0.12);
    lastUpdateTimeMs = timeMs;
    if (!sample || !terrainSize) {
      hoses.count = 0;
      waterGeometry.setDrawRange(0, 0);
      jetCores.count = 0;
      mistShells.count = 0;
      impactGeometry.setDrawRange(0, 0);
      sprayVisualBySourceId.clear();
      return;
    }

    const cols = Math.max(1, sample.cols);
    const rows = Math.max(1, sample.rows);
    const heightScale = getTerrainHeightScale(cols, rows);
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

    const trucks = new Map<number, { unit: WorldState["units"][number]; x: number; y: number }>();
    const nozzleByUnitId = new Map<number, { x: number; y: number; z: number }>();
    for (let i = 0; i < world.units.length; i += 1) {
      const unit = world.units[i];
      if (!unit) {
        continue;
      }
      const unitTile = resolveInterpolatedPosition(unit);
      if (unit.kind === "truck") {
        trucks.set(unit.id, { unit, x: unitTile.x, y: unitTile.y });
      }
      const nozzleX = toWorldX(unitTile.x, cols, terrainSize.width);
      const nozzleZ = toWorldZ(unitTile.y, rows, terrainSize.depth);
      const nozzleY =
        sampleHeight(sample, unitTile.x, unitTile.y) * heightScale + (unit.kind === "truck" ? HOSE_BASE_Y + 0.13 : HOSE_BASE_Y + 0.2);
      nozzleByUnitId.set(unit.id, { x: nozzleX, y: nozzleY, z: nozzleZ });
    }

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
      const crewTile = resolveInterpolatedPosition(unit);
      const crewX = toWorldX(crewTile.x, cols, terrainSize.width);
      const crewZ = toWorldZ(crewTile.y, rows, terrainSize.depth);
      const crewY = sampleHeight(sample, crewTile.x, crewTile.y) * heightScale + HOSE_BASE_Y + 0.18;

      const truckX = toWorldX(truckRef.x, cols, terrainSize.width);
      const truckZ = toWorldZ(truckRef.y, rows, terrainSize.depth);
      const truckY = sampleHeight(sample, truckRef.x, truckRef.y) * heightScale + HOSE_BASE_Y + 0.11;

      hoseDirection.set(crewX - truckX, crewY - truckY, crewZ - truckZ);
      const hoseLength = hoseDirection.length();
      if (hoseLength <= 0.0001) {
        continue;
      }
      hoseDirection.multiplyScalar(1 / hoseLength);
      hoseMidpoint.set((truckX + crewX) * 0.5, (truckY + crewY) * 0.5, (truckZ + crewZ) * 0.5);
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
        volume: clamp(stream.volume, 0, 1),
        intensity: clamp(stream.intensity, 0, 1),
        seed: (sourceId * 0.61803398875) % 1
      });
    }

    const activeSourceIds = new Set<number>();
    streamBySource.forEach((_value, sourceId) => activeSourceIds.add(sourceId));
    sprayVisualBySourceId.forEach((_value, sourceId) => activeSourceIds.add(sourceId));

    let jetCoreCount = 0;
    let mistShellCount = 0;
    let impactCount = 0;
    activeSourceIds.forEach((sourceId) => {
      if (jetCoreCount >= MAX_WATER_STREAMS && mistShellCount >= MAX_WATER_STREAMS && impactCount >= MAX_WATER_IMPACTS) {
        return;
      }
      const aggregate = streamBySource.get(sourceId) ?? null;
      const source = nozzleByUnitId.get(sourceId) ?? null;
      let visual = sprayVisualBySourceId.get(sourceId) ?? null;
      if (!visual) {
        if (!aggregate) {
          return;
        }
        visual = {
          direction: fallbackStreamDirection.clone(),
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
        streamTargetPoint.set(
          aggregate.targetX - visual.sourceX,
          aggregate.targetY - visual.sourceY,
          aggregate.targetZ - visual.sourceZ
        );
        const targetLength = Math.max(0.0001, streamTargetPoint.length());
        streamTargetDirection.copy(streamTargetPoint).multiplyScalar(1 / targetLength);
        visual.direction.copy(streamTargetDirection);
        visual.length = targetLength;
        visual.tipX = aggregate.targetX;
        visual.tipY = aggregate.targetY;
        visual.tipZ = aggregate.targetZ;
        visual.mode = approachExp(visual.mode, aggregate.mode, 18, deltaSeconds);
        visual.volume = approachExp(visual.volume, aggregate.volume, 16, deltaSeconds);
        visual.flow = approachExp(visual.flow, aggregate.intensity > 0.01 ? 1 : 0, 9.5, deltaSeconds);
        visual.intensity = approachExp(
          visual.intensity,
          Math.max(aggregate.intensity, 0.92),
          aggregate.intensity >= visual.intensity ? 12 : 5.4,
          deltaSeconds
        );
        visual.coreRadius = approachExp(
          visual.coreRadius,
          Math.max(
            worldPerTile * 0.15,
            worldPerTile * (precisionMode ? 0.16 : suppressionMode ? 0.24 : 0.19) * (0.96 + aggregate.volume * 0.32)
          ),
          18,
          deltaSeconds
        );
        visual.mistRadius = approachExp(
          visual.mistRadius,
          Math.max(
            worldPerTile * 0.3,
            worldPerTile * (precisionMode ? 0.3 : suppressionMode ? 0.5 : 0.4) * (0.98 + aggregate.volume * 0.3)
          ),
          16,
          deltaSeconds
        );
        visual.impactRadius = approachExp(
          visual.impactRadius,
          Math.max(
            worldPerTile * (precisionMode ? 0.12 : suppressionMode ? 0.22 : 0.16),
            visual.mistRadius * (precisionMode ? 1.05 : suppressionMode ? 1.25 : 1.12)
          ),
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

      if (!source && !aggregate && visual.intensity <= 0.015 && visual.flow <= 0.015) {
        sprayVisualBySourceId.delete(sourceId);
        return;
      }

      const renderFlow = clamp(visual.flow, 0, 1);
      const renderIntensity = clamp(visual.intensity, 0, 1);
      const coreStrength = clamp((0.34 + renderIntensity * 0.66) * Math.pow(renderFlow, 0.82), 0, 1);
      const shellStrength = clamp((0.2 + renderIntensity * 0.8) * Math.pow(renderFlow, 1.02), 0, 1);
      if (coreStrength <= 0.015 || visual.length <= 0.0001) {
        if (!aggregate) {
          sprayVisualBySourceId.delete(sourceId);
        }
        return;
      }

      if (jetCoreCount < MAX_WATER_STREAMS) {
        const coreLength = visual.length;
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
        jetCoreCount += 1;
      }

      if (mistShellCount < MAX_WATER_STREAMS) {
        const shellLength = visual.length;
        sprayMidpoint.set(
          visual.sourceX + visual.direction.x * shellLength * 0.5,
          visual.sourceY + visual.direction.y * shellLength * 0.5,
          visual.sourceZ + visual.direction.z * shellLength * 0.5
        );
        sprayQuaternion.setFromUnitVectors(hoseUpAxis, visual.direction);
        sprayScale.set(visual.mistRadius, shellLength, visual.mistRadius);
        sprayMatrix.compose(sprayMidpoint, sprayQuaternion, sprayScale);
        mistShells.setMatrixAt(mistShellCount, sprayMatrix);
        mistShellBuffers.modeAttr.setX(mistShellCount, clamp(visual.mode, 0, 2));
        mistShellBuffers.volumeAttr.setX(mistShellCount, clamp(visual.volume, 0, 1));
        mistShellBuffers.seedAttr.setX(mistShellCount, visual.seed + 0.37);
        mistShellBuffers.intensityAttr.setX(mistShellCount, shellStrength);
        mistShellCount += 1;
      }

      if (impactCount < MAX_WATER_IMPACTS && renderFlow > 0.16) {
        const impactOffset = impactCount * 3;
        impactPositions[impactOffset] = visual.tipX;
        impactPositions[impactOffset + 1] = visual.tipY;
        impactPositions[impactOffset + 2] = visual.tipZ;
        impactAlpha[impactCount] = clamp(
          renderIntensity *
            Math.pow(renderFlow, 1.7) *
            (visual.mode <= 0.5 ? 0.32 : visual.mode >= 1.5 ? 0.54 : 0.42),
          0,
          1
        );
        impactSize[impactCount] = clamp((visual.impactRadius / Math.max(worldPerTile, 0.0001)) * 34, 12, 48);
        impactMode[impactCount] = clamp(visual.mode, 0, 2);
        impactSeed[impactCount] = visual.seed;
        impactCount += 1;
      }
    });
    jetCores.count = jetCoreCount;
    jetCores.instanceMatrix.needsUpdate = true;
    jetCoreBuffers.modeAttr.needsUpdate = true;
    jetCoreBuffers.volumeAttr.needsUpdate = true;
    jetCoreBuffers.seedAttr.needsUpdate = true;
    jetCoreBuffers.intensityAttr.needsUpdate = true;
    mistShells.count = mistShellCount;
    mistShells.instanceMatrix.needsUpdate = true;
    mistShellBuffers.modeAttr.needsUpdate = true;
    mistShellBuffers.volumeAttr.needsUpdate = true;
    mistShellBuffers.seedAttr.needsUpdate = true;
    mistShellBuffers.intensityAttr.needsUpdate = true;
    impactGeometry.setDrawRange(0, Math.min(impactCount, impactPosAttr.count));
    impactPosAttr.needsUpdate = true;
    impactAlphaAttr.needsUpdate = true;
    impactSizeAttr.needsUpdate = true;
    impactModeAttr.needsUpdate = true;
    impactSeedAttr.needsUpdate = true;

    let breakupCount = 0;
    for (let i = 0; i < particleCount && breakupCount < MAX_WATER_PARTICLES; i += 1) {
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
      const breakupStart = visual.length * 0.66;
      const tailInfluence = clamp(
        (distFromSource - breakupStart) / Math.max(visual.length * 0.26, worldPerTile * 0.35),
        0,
        1
      );
      const tipInfluence = 1 - clamp(distToTip / Math.max(visual.impactRadius * 1.7, worldPerTile * 0.3), 0, 1);
      const breakupInfluence = Math.max(tailInfluence, tipInfluence * 0.9);
      if (breakupInfluence <= 0.01 || particleLife01 < 0.24) {
        continue;
      }
      const expectedY = visual.sourceY + visual.direction.y * Math.min(visual.length, Math.max(0, distFromSource));
      const terrainY = sampleWorldHeight(sample, terrainSize, cols, rows, heightScale, wx, wz) + 0.03;
      const wy = Math.max(terrainY, expectedY - worldPerTile * 0.04);
      const drawAlpha = clamp(
        particleAlpha *
          breakupInfluence *
          Math.pow(renderFlow, 1.85) *
          (0.12 + renderIntensity * 0.18) *
          (0.68 + volume * 0.16),
        0,
        1
      );
      if (drawAlpha <= 0.02) {
        continue;
      }
      const modeSizeScale = modeValue <= 0.5 ? 0.86 : modeValue >= 1.5 ? 1.02 : 0.94;
      const posOffset = breakupCount * 3;
      waterPositions[posOffset] = wx;
      waterPositions[posOffset + 1] = wy;
      waterPositions[posOffset + 2] = wz;
      waterAlpha[breakupCount] = drawAlpha;
      waterSize[breakupCount] = clamp(
        particle.size * 0.16 * modeSizeScale * (0.68 + volume * 0.18) * (0.75 + breakupInfluence * 0.4),
        0.8,
        3.4
      );
      waterMode[breakupCount] = modeValue;
      waterVolume[breakupCount] = volume;
      waterSeed[breakupCount] = Number.isFinite(particle.spraySeed) ? particle.spraySeed! : (i * 0.61803398875) % 1;
      waterPulseHz[breakupCount] = Number.isFinite(particle.sprayPulseHz)
        ? Math.max(2, Math.min(12, particle.sprayPulseHz!))
        : defaultPulseForMode(modeValue);
      waterAge01[breakupCount] = particleLife01;
      breakupCount += 1;
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
  };

  const dispose = (): void => {
    scene.remove(hoses);
    scene.remove(waterPoints);
    scene.remove(jetCores);
    scene.remove(mistShells);
    scene.remove(impactPoints);
    hoseGeometry.dispose();
    hoseMaterial.dispose();
    waterGeometry.dispose();
    waterMaterial.dispose();
    jetCoreBuffers.geometry.dispose();
    mistShellBuffers.geometry.dispose();
    jetCoreMaterial.dispose();
    mistShellMaterial.dispose();
    impactGeometry.dispose();
    impactMaterial.dispose();
  };

  return { update, dispose };
};
