import * as THREE from "three";
import { mixRgb, scaleRgb, type RGB } from "./color.js";

const TAU = Math.PI * 2;
const PI = Math.PI;
const SUMMER_MIDPOINT_T01 = 0.625;
const EQUINOX_AZIMUTH_DEG = -100;
const SEASONAL_AZIMUTH_DRIFT_DEG = 15;
const DAYLIGHT_AZIMUTH_SWEEP_DEG = 54;
const SUMMER_PEAK_ELEVATION_DEG = 52;
const WINTER_PEAK_ELEVATION_DEG = 34;
const SUMMER_FLOOR_ELEVATION_DEG = 18;
const WINTER_FLOOR_ELEVATION_DEG = 12;
const SKY_NOISE_SIZE = 128;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const wrap01 = (value: number): number => ((value % 1) + 1) % 1;
const smoothstep = (edge0: number, edge1: number, x: number): number => {
  if (edge0 === edge1) {
    return x < edge0 ? 0 : 1;
  }
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
const degToRad = (degrees: number): number => degrees * (Math.PI / 180);
const rgb = (r: number, g: number, b: number): RGB => ({ r, g, b });

type SeasonWeights = {
  winter: number;
  spring: number;
  summer: number;
  autumn: number;
};

export type SeasonalSkyConfig = {
  summerCloudCoverage: number;
  winterCloudCoverage: number;
  cloudLayerScaleNear: number;
  cloudLayerScaleFar: number;
  cloudLayerDriftNear: number;
  cloudLayerDriftFar: number;
  sunIntensitySummer: number;
  sunIntensityWinter: number;
  glareIntensitySummer: number;
  glareIntensityWinter: number;
  hazeStrengthSummer: number;
  hazeStrengthWinter: number;
  ambientSoftnessSummer: number;
  ambientSoftnessWinter: number;
  shadowContrastSummer: number;
  shadowContrastWinter: number;
  dayArcDaysPerCycle: number;
  sunOcclusionSampleRadius: number;
  sunOcclusionLightReduction: number;
  sunOcclusionGlareReduction: number;
  sunOcclusionShadowSoftening: number;
};

export const SEASONAL_SKY_CONFIG: SeasonalSkyConfig = {
  summerCloudCoverage: 0.28,
  winterCloudCoverage: 0.72,
  cloudLayerScaleNear: 1.75,
  cloudLayerScaleFar: 0.96,
  cloudLayerDriftNear: 0.0105,
  cloudLayerDriftFar: 0.0054,
  sunIntensitySummer: 1.16,
  sunIntensityWinter: 0.76,
  glareIntensitySummer: 0.16,
  glareIntensityWinter: 0.07,
  hazeStrengthSummer: 0.05,
  hazeStrengthWinter: 0.11,
  ambientSoftnessSummer: 0.16,
  ambientSoftnessWinter: 0.4,
  shadowContrastSummer: 0.96,
  shadowContrastWinter: 0.54,
  dayArcDaysPerCycle: 240,
  sunOcclusionSampleRadius: 0.032,
  sunOcclusionLightReduction: 0.42,
  sunOcclusionGlareReduction: 0.76,
  sunOcclusionShadowSoftening: 0.48
};

export type SeasonalSkyInput = {
  seasonT01: number;
  risk01: number;
  careerDay: number;
  windDx: number;
  windDy: number;
  windStrength: number;
  timeSpeedValue: number;
};

export type SeasonalSkyState = {
  sunDirection: THREE.Vector3;
  sunColor: RGB;
  sunIntensity: number;
  sunVisibility: number;
  skyTopColor: RGB;
  skyHorizonColor: RGB;
  cloudNearColor: RGB;
  cloudFarColor: RGB;
  cloudCoverage: number;
  cloudNearScale: number;
  cloudFarScale: number;
  cloudNearOffset: THREE.Vector2;
  cloudFarOffset: THREE.Vector2;
  sunOcclusion01: number;
  glareIntensity: number;
  hazeStrength: number;
  ambientSoftness: number;
  shadowContrast: number;
  overcastStrength: number;
  summer01: number;
  winter01: number;
  sunAzimuthDeg: number;
  sunElevationDeg: number;
};

export type SeasonalSkyDome = {
  mesh: THREE.Mesh;
  setState: (state: SeasonalSkyState) => void;
  syncToCamera: (camera: THREE.Camera) => void;
  dispose: () => void;
};

type SkyNoiseResources = {
  data: Uint8Array;
  size: number;
  texture: THREE.DataTexture;
};

type CloudFieldSample = Pick<
  SeasonalSkyState,
  "cloudCoverage" | "cloudNearScale" | "cloudFarScale" | "cloudNearOffset" | "cloudFarOffset"
>;

const blendSeason = (winter: RGB, spring: RGB, summer: RGB, autumn: RGB, weights: SeasonWeights): RGB => {
  const total = Math.max(0.0001, weights.winter + weights.spring + weights.summer + weights.autumn);
  const wn = weights.winter / total;
  const sp = weights.spring / total;
  const su = weights.summer / total;
  const au = weights.autumn / total;
  return {
    r: winter.r * wn + spring.r * sp + summer.r * su + autumn.r * au,
    g: winter.g * wn + spring.g * sp + summer.g * su + autumn.g * au,
    b: winter.b * wn + spring.b * sp + summer.b * su + autumn.b * au
  };
};

const getSeasonWeights = (seasonT01: number): SeasonWeights => {
  const t = wrap01(seasonT01);
  const spring = smoothstep(0.18, 0.28, t) * (1 - smoothstep(0.42, 0.52, t));
  const summer = smoothstep(0.42, 0.52, t) * (1 - smoothstep(0.66, 0.76, t));
  const autumn = smoothstep(0.62, 0.7, t) * (1 - smoothstep(0.9, 0.98, t));
  const winterA = 1 - smoothstep(0.08, 0.18, t);
  const winterB = smoothstep(0.88, 0.96, t);
  return {
    winter: clamp(winterA + winterB, 0, 1),
    spring,
    summer,
    autumn
  };
};

const toThreeColor = (color: RGB): THREE.Color =>
  new THREE.Color().setRGB(color.r / 255, color.g / 255, color.b / 255, THREE.SRGBColorSpace);

const hashNoiseLattice = (x: number, y: number): number => {
  const value = Math.sin(x * 127.1 + y * 311.7 + 74.7) * 43758.5453123;
  return value - Math.floor(value);
};

const sampleTileableValueNoise = (u: number, v: number, frequency: number): number => {
  const x = wrap01(u) * frequency;
  const y = wrap01(v) * frequency;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = (x0 + 1) % frequency;
  const y1 = (y0 + 1) % frequency;
  const tx = x - x0;
  const ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const v00 = hashNoiseLattice(x0 % frequency, y0 % frequency);
  const v10 = hashNoiseLattice(x1, y0 % frequency);
  const v01 = hashNoiseLattice(x0 % frequency, y1);
  const v11 = hashNoiseLattice(x1, y1);
  const a = lerp(v00, v10, sx);
  const b = lerp(v01, v11, sx);
  return lerp(a, b, sy);
};

const createSkyNoiseResources = (): SkyNoiseResources => {
  const data = new Uint8Array(SKY_NOISE_SIZE * SKY_NOISE_SIZE);
  for (let y = 0; y < SKY_NOISE_SIZE; y += 1) {
    for (let x = 0; x < SKY_NOISE_SIZE; x += 1) {
      const u = x / SKY_NOISE_SIZE;
      const v = y / SKY_NOISE_SIZE;
      const octave0 = sampleTileableValueNoise(u, v, 4);
      const octave1 = sampleTileableValueNoise(u, v, 8);
      const octave2 = sampleTileableValueNoise(u, v, 16);
      const octave3 = sampleTileableValueNoise(u, v, 32);
      const billow = 1 - Math.abs(octave0 * 2 - 1);
      const detail = octave1 * 0.46 + octave2 * 0.34 + octave3 * 0.2;
      const value = clamp01(Math.pow(octave0 * 0.42 + billow * 0.28 + detail * 0.3, 0.92));
      data[y * SKY_NOISE_SIZE + x] = Math.round(value * 255);
    }
  }
  const texture = new THREE.DataTexture(data, SKY_NOISE_SIZE, SKY_NOISE_SIZE, THREE.RedFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return {
    data,
    size: SKY_NOISE_SIZE,
    texture
  };
};

const SKY_NOISE = createSkyNoiseResources();

const wrapUnit = (value: number): number => {
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
};

const sampleNoise = (u: number, v: number): number => {
  const x = wrapUnit(u) * SKY_NOISE.size;
  const y = wrapUnit(v) * SKY_NOISE.size;
  const x0 = Math.floor(x) % SKY_NOISE.size;
  const y0 = Math.floor(y) % SKY_NOISE.size;
  const x1 = (x0 + 1) % SKY_NOISE.size;
  const y1 = (y0 + 1) % SKY_NOISE.size;
  const tx = x - Math.floor(x);
  const ty = y - Math.floor(y);
  const idx00 = y0 * SKY_NOISE.size + x0;
  const idx10 = y0 * SKY_NOISE.size + x1;
  const idx01 = y1 * SKY_NOISE.size + x0;
  const idx11 = y1 * SKY_NOISE.size + x1;
  const v00 = (SKY_NOISE.data[idx00] ?? 0) / 255;
  const v10 = (SKY_NOISE.data[idx10] ?? 0) / 255;
  const v01 = (SKY_NOISE.data[idx01] ?? 0) / 255;
  const v11 = (SKY_NOISE.data[idx11] ?? 0) / 255;
  const a = lerp(v00, v10, tx);
  const b = lerp(v01, v11, tx);
  return lerp(a, b, ty);
};

// Cloud sampling stays in direction space so the same field can cover the full sky
// without horizon seams or longitude wrap artefacts.
const sampleDirectionalNoise = (direction: THREE.Vector3, scale: number, offset: THREE.Vector2): number => {
  const dir = direction.clone().normalize();
  const sampleA = sampleNoise(
    (dir.x * 0.78 + dir.z * 0.62) * scale + offset.x,
    (dir.z * 0.74 - dir.x * 0.34) * scale + offset.y
  );
  const sampleB = sampleNoise(
    (dir.x * 0.58 + dir.y * 0.71) * (scale * 0.86) - offset.y * 0.79 + 0.17,
    (dir.y * 0.76 - dir.x * 0.49) * (scale * 0.86) + offset.x * 0.73 + 0.31
  );
  const sampleC = sampleNoise(
    (dir.z * 0.69 - dir.y * 0.43) * (scale * 1.14) + offset.x * 0.61 - 0.27,
    (dir.y * 0.64 + dir.z * 0.57) * (scale * 1.14) + offset.y * 0.67 + 0.41
  );
  return clamp01(sampleA * 0.52 + sampleB * 0.28 + sampleC * 0.2);
};

const sampleCloudLayer = (
  direction: THREE.Vector3,
  scale: number,
  offset: THREE.Vector2,
  coverage: number,
  softness: number
): number => {
  const warp = sampleDirectionalNoise(
    direction,
    scale * 0.42,
    new THREE.Vector2(offset.x * 0.37 + 0.19, offset.y * 0.37 - 0.23)
  );
  const warpDetail = sampleDirectionalNoise(
    direction,
    scale * 0.76,
    new THREE.Vector2(-offset.y * 0.21 + 0.73, offset.x * 0.21 + 0.41)
  );
  const warpedOffset = new THREE.Vector2(
    offset.x + (warp - 0.5) * 0.38,
    offset.y + (warpDetail - 0.5) * 0.26
  );
  const base = sampleDirectionalNoise(direction, scale, warpedOffset);
  const detail = sampleDirectionalNoise(
    direction,
    scale * 1.87,
    new THREE.Vector2(warpedOffset.x * 1.31 - 0.17, warpedOffset.y * 1.31 + 0.29)
  );
  const billow = sampleDirectionalNoise(
    direction,
    scale * 0.58,
    new THREE.Vector2(offset.x * 0.57 + 0.51, offset.y * 0.57 - 0.37)
  );
  const shape = clamp01(Math.pow(base * 0.58 + detail * 0.24 + billow * 0.18, 1.18));
  const threshold = lerp(0.71, 0.47, clamp01(coverage));
  const density = smoothstep(threshold - softness, threshold + softness, shape);
  return clamp01(density * (0.72 + base * 0.36));
};

const sampleCombinedCloudDensity = (direction: THREE.Vector3, cloudState: CloudFieldSample): number => {
  const farDensity = sampleCloudLayer(
    direction,
    cloudState.cloudFarScale,
    cloudState.cloudFarOffset,
    clamp01(cloudState.cloudCoverage * 0.82),
    0.11
  );
  const nearDensity = sampleCloudLayer(
    direction,
    cloudState.cloudNearScale,
    cloudState.cloudNearOffset,
    clamp01(cloudState.cloudCoverage * 1.08),
    0.085
  );
  return clamp01(farDensity * 0.44 + nearDensity * 0.64);
};

const computeSunOcclusion = (
  sunDirection: THREE.Vector3,
  cloudState: CloudFieldSample,
  config: SeasonalSkyConfig
): number => {
  const up = new THREE.Vector3(0, 1, 0);
  const tangent = new THREE.Vector3().crossVectors(up, sunDirection);
  if (tangent.lengthSq() <= 1e-6) {
    tangent.set(1, 0, 0);
  } else {
    tangent.normalize();
  }
  const bitangent = new THREE.Vector3().crossVectors(sunDirection, tangent).normalize();
  const radius = config.sunOcclusionSampleRadius * lerp(1.08, 0.72, clamp01(sunDirection.y));
  const weights = [0.38, 0.155, 0.155, 0.155, 0.155];
  const samples = [
    sunDirection,
    sunDirection.clone().addScaledVector(tangent, radius).normalize(),
    sunDirection.clone().addScaledVector(tangent, -radius).normalize(),
    sunDirection.clone().addScaledVector(bitangent, radius).normalize(),
    sunDirection.clone().addScaledVector(bitangent, -radius).normalize()
  ];
  let total = 0;
  let weightSum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const weight = weights[i] ?? 0;
    total += sampleCombinedCloudDensity(samples[i], cloudState) * weight;
    weightSum += weight;
  }
  return clamp01(total / Math.max(0.0001, weightSum));
};

export const buildSeasonalSkyState = (
  input: SeasonalSkyInput,
  config: SeasonalSkyConfig = SEASONAL_SKY_CONFIG
): SeasonalSkyState => {
  const seasonT01 = wrap01(input.seasonT01);
  const season = getSeasonWeights(seasonT01);
  const annualBand = Math.cos((seasonT01 - SUMMER_MIDPOINT_T01) * TAU);
  const summer01 = clamp01((annualBand + 1) * 0.5);
  const winter01 = clamp01(1 - summer01);
  const risk01 = clamp01(input.risk01);

  // The sun follows a daylight-only arc derived from career day, then the season biases
  // its azimuth/elevation so the same direction can drive the sky disc and scene lighting.
  const dayPhase = wrap01(input.careerDay / Math.max(1, config.dayArcDaysPerCycle));
  const daylight01 = Math.sin(dayPhase * Math.PI);
  const seasonalPeakElevation = lerp(WINTER_PEAK_ELEVATION_DEG, SUMMER_PEAK_ELEVATION_DEG, summer01);
  const elevationFloor = lerp(WINTER_FLOOR_ELEVATION_DEG, SUMMER_FLOOR_ELEVATION_DEG, summer01);
  const sunElevationDeg = clamp(
    elevationFloor + Math.pow(clamp01(daylight01), 0.82) * (seasonalPeakElevation - elevationFloor),
    WINTER_FLOOR_ELEVATION_DEG,
    SUMMER_PEAK_ELEVATION_DEG
  );
  const sunAzimuthDeg =
    EQUINOX_AZIMUTH_DEG +
    annualBand * SEASONAL_AZIMUTH_DRIFT_DEG +
    (dayPhase - 0.5) * DAYLIGHT_AZIMUTH_SWEEP_DEG;
  const azimuthRad = degToRad(sunAzimuthDeg);
  const elevationRad = degToRad(sunElevationDeg);
  const horizontal = Math.cos(elevationRad);
  const sunDirection = new THREE.Vector3(
    horizontal * Math.cos(azimuthRad),
    Math.sin(elevationRad),
    horizontal * Math.sin(azimuthRad)
  ).normalize();

  const baseSkyTop = blendSeason(
    rgb(144, 154, 174),
    rgb(132, 170, 214),
    rgb(124, 180, 232),
    rgb(150, 142, 162),
    season
  );
  const baseSkyHorizon = blendSeason(
    rgb(202, 206, 216),
    rgb(220, 208, 178),
    rgb(228, 200, 154),
    rgb(220, 188, 150),
    season
  );
  const baseSun = blendSeason(
    rgb(244, 242, 236),
    rgb(255, 237, 210),
    rgb(255, 229, 184),
    rgb(248, 219, 182),
    season
  );
  const baseCloud = blendSeason(
    rgb(220, 224, 230),
    rgb(236, 234, 230),
    rgb(248, 244, 234),
    rgb(230, 220, 208),
    season
  );

  // Seasonal blending stays continuous by mixing coverage and palette inputs from the
  // wrapped season weights instead of hard-switching between summer and winter presets.
  const cloudCoverage = clamp(
    lerp(config.winterCloudCoverage, config.summerCloudCoverage, summer01) + (0.5 - risk01) * 0.08 + winter01 * 0.03,
    0.12,
    0.9
  );
  const speed01 = clamp01(Math.log2(Math.max(1, input.timeSpeedValue) + 1) / Math.log2(81));
  const windLen = Math.hypot(input.windDx, input.windDy);
  const windDirX = windLen > 1e-5 ? input.windDx / windLen : 0;
  const windDirY = windLen > 1e-5 ? input.windDy / windLen : 0;
  const driftDays = input.careerDay * (0.78 + speed01 * 0.22);

  // Cloud drift is keyed from authoritative wind and career day, so pauses stop motion
  // and faster sim speeds advance the same field more quickly without extra sim logic.
  const cloudNearOffset = new THREE.Vector2(
    windDirX * input.windStrength * driftDays * config.cloudLayerDriftNear,
    windDirY * input.windStrength * driftDays * config.cloudLayerDriftNear
  );
  const cloudFarOffset = new THREE.Vector2(
    windDirX * input.windStrength * driftDays * config.cloudLayerDriftFar + 0.19,
    windDirY * input.windStrength * driftDays * config.cloudLayerDriftFar - 0.11
  );

  const cloudField: CloudFieldSample = {
    cloudCoverage,
    cloudNearScale: config.cloudLayerScaleNear,
    cloudFarScale: config.cloudLayerScaleFar,
    cloudNearOffset,
    cloudFarOffset
  };
  // Cloud occlusion samples the same layered field around the sun direction so direct
  // light and glare soften when a cloud bank crosses the visible solar disc.
  const sunOcclusion01 = computeSunOcclusion(sunDirection, cloudField, config);
  const overcastStrength = clamp01(cloudCoverage * 0.64 + winter01 * 0.18);
  const skyTopColor = mixRgb(baseSkyTop, rgb(156, 166, 178), overcastStrength * 0.28);
  const skyHorizonColor = mixRgb(baseSkyHorizon, rgb(196, 200, 204), overcastStrength * 0.32);
  const sunColor = mixRgb(baseSun, rgb(242, 244, 246), overcastStrength * 0.22 + winter01 * 0.08);
  const cloudFarColor = mixRgb(baseCloud, skyTopColor, 0.06 + overcastStrength * 0.12);
  const cloudNearColor = mixRgb(scaleRgb(baseCloud, 1.06), skyHorizonColor, 0.08 + overcastStrength * 0.18);
  const sunVisibility = clamp(1 - sunOcclusion01 * config.sunOcclusionLightReduction, 0.14, 1);
  const sunIntensityBase = lerp(config.sunIntensityWinter, config.sunIntensitySummer, summer01);
  const sunIntensity = clamp(sunIntensityBase * sunVisibility, 0.45, 1.3);
  const glareIntensityBase = lerp(config.glareIntensityWinter, config.glareIntensitySummer, summer01);
  const glareIntensity = clamp(
    glareIntensityBase * (1 - sunOcclusion01 * config.sunOcclusionGlareReduction),
    0.01,
    0.24
  );
  const hazeStrength = clamp(
    lerp(config.hazeStrengthWinter, config.hazeStrengthSummer, summer01) + overcastStrength * 0.02,
    0.02,
    0.18
  );
  const ambientSoftness = clamp(
    lerp(config.ambientSoftnessWinter, config.ambientSoftnessSummer, summer01) + overcastStrength * 0.14,
    0.08,
    0.72
  );
  const shadowContrast = clamp(
    lerp(config.shadowContrastWinter, config.shadowContrastSummer, summer01) *
      (1 - sunOcclusion01 * config.sunOcclusionShadowSoftening),
    0.2,
    1
  );

  return {
    sunDirection,
    sunColor,
    sunIntensity,
    sunVisibility,
    skyTopColor,
    skyHorizonColor,
    cloudNearColor,
    cloudFarColor,
    cloudCoverage,
    cloudNearScale: config.cloudLayerScaleNear,
    cloudFarScale: config.cloudLayerScaleFar,
    cloudNearOffset,
    cloudFarOffset,
    sunOcclusion01,
    glareIntensity,
    hazeStrength,
    ambientSoftness,
    shadowContrast,
    overcastStrength,
    summer01,
    winter01,
    sunAzimuthDeg,
    sunElevationDeg
  };
};

const skyVertexShader = `
  varying vec3 vSkyDir;

  void main() {
    vSkyDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFragmentShader = `
  uniform sampler2D uNoiseTex;
  uniform vec3 uSkyTopColor;
  uniform vec3 uSkyHorizonColor;
  uniform vec3 uSunColor;
  uniform vec3 uCloudNearColor;
  uniform vec3 uCloudFarColor;
  uniform vec3 uSunDirection;
  uniform vec2 uCloudNearOffset;
  uniform vec2 uCloudFarOffset;
  uniform float uCloudNearScale;
  uniform float uCloudFarScale;
  uniform float uCloudCoverage;
  uniform float uOvercastStrength;
  uniform float uSunVisibility;
  uniform float uHazeStrength;

  varying vec3 vSkyDir;

  float sampleNoise(vec2 uv) {
    return texture2D(uNoiseTex, fract(uv)).r;
  }

  float sampleDirectionalNoise(vec3 dir, float scale, vec2 offset) {
    vec3 d = normalize(dir);
    float sampleA = sampleNoise(vec2(
      (d.x * 0.78 + d.z * 0.62) * scale + offset.x,
      (d.z * 0.74 - d.x * 0.34) * scale + offset.y
    ));
    float sampleB = sampleNoise(vec2(
      (d.x * 0.58 + d.y * 0.71) * (scale * 0.86) - offset.y * 0.79 + 0.17,
      (d.y * 0.76 - d.x * 0.49) * (scale * 0.86) + offset.x * 0.73 + 0.31
    ));
    float sampleC = sampleNoise(vec2(
      (d.z * 0.69 - d.y * 0.43) * (scale * 1.14) + offset.x * 0.61 - 0.27,
      (d.y * 0.64 + d.z * 0.57) * (scale * 1.14) + offset.y * 0.67 + 0.41
    ));
    return clamp(sampleA * 0.52 + sampleB * 0.28 + sampleC * 0.2, 0.0, 1.0);
  }

  float sampleLayer(vec3 dir, float scale, vec2 offset, float coverage, float softness) {
    float warp = sampleDirectionalNoise(dir, scale * 0.42, offset * 0.37 + vec2(0.19, -0.23));
    float warpDetail = sampleDirectionalNoise(dir, scale * 0.76, vec2(-offset.y * 0.21 + 0.73, offset.x * 0.21 + 0.41));
    vec2 warpedOffset = offset + vec2((warp - 0.5) * 0.38, (warpDetail - 0.5) * 0.26);
    float base = sampleDirectionalNoise(dir, scale, warpedOffset);
    float detail = sampleDirectionalNoise(dir, scale * 1.87, warpedOffset * 1.31 + vec2(-0.17, 0.29));
    float billow = sampleDirectionalNoise(dir, scale * 0.58, offset * 0.57 + vec2(0.51, -0.37));
    float shape = clamp(pow(base * 0.58 + detail * 0.24 + billow * 0.18, 1.18), 0.0, 1.0);
    float threshold = mix(0.71, 0.47, clamp(coverage, 0.0, 1.0));
    float density = smoothstep(threshold - softness, threshold + softness, shape);
    return clamp(density * (0.72 + base * 0.36), 0.0, 1.0);
  }

  void main() {
    vec3 dir = normalize(vSkyDir);
    float skyT = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 baseSky = mix(uSkyHorizonColor, uSkyTopColor, pow(skyT, 0.6));
    float horizonMask = smoothstep(0.2, 1.0, 1.0 - clamp(dir.y, -0.3, 1.0));
    float farDensity = sampleLayer(dir, uCloudFarScale, uCloudFarOffset, uCloudCoverage * 0.82, 0.11);
    float nearDensity = sampleLayer(dir, uCloudNearScale, uCloudNearOffset, min(1.0, uCloudCoverage * 1.08), 0.085);
    farDensity *= mix(0.86, 1.12, horizonMask);
    nearDensity *= mix(0.84, 1.2, horizonMask);
    float cloudAlpha = clamp(farDensity * 0.54 + nearDensity * 0.74, 0.0, 0.96);
    float sunDot = max(dot(dir, normalize(uSunDirection)), 0.0);
    float glow = pow(sunDot, mix(12.0, 6.0, uOvercastStrength));
    float disc = smoothstep(0.9945, 0.9989, sunDot);
    vec3 sunColor = uSunColor * uSunVisibility;
    vec3 skyWithSun = baseSky + sunColor * (glow * 0.48 + disc * 1.35);
    float nearMix = clamp(nearDensity / max(0.001, nearDensity + farDensity), 0.0, 1.0);
    vec3 cloudBase = mix(uCloudFarColor, uCloudNearColor, nearMix);
    float cloudBody = clamp(farDensity * 0.48 + nearDensity * 0.72, 0.0, 1.0);
    float cloudHighlight = pow(clamp(1.0 - cloudBody, 0.0, 1.0), 1.6);
    vec3 cloudShadowColor = mix(uSkyTopColor, uCloudFarColor, 0.42);
    vec3 cloudColor = mix(cloudShadowColor, cloudBase, 0.5 + cloudHighlight * 0.5);
    vec3 color = mix(skyWithSun, cloudColor, cloudAlpha);
    color += sunColor * glow * (1.0 - cloudAlpha * 0.78) * (0.14 + (1.0 - uOvercastStrength) * 0.2);
    float haze = smoothstep(-0.14, 0.12, dir.y) * uHazeStrength;
    color = mix(color, mix(uSkyHorizonColor, cloudColor, 0.16), haze * 0.72);
    gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const createSeasonalSkyDome = (): SeasonalSkyDome => {
  const uniforms = {
    uNoiseTex: { value: SKY_NOISE.texture },
    uSkyTopColor: { value: toThreeColor(rgb(82, 126, 180)) },
    uSkyHorizonColor: { value: toThreeColor(rgb(235, 206, 148)) },
    uSunColor: { value: toThreeColor(rgb(255, 229, 184)) },
    uCloudNearColor: { value: toThreeColor(rgb(243, 241, 232)) },
    uCloudFarColor: { value: toThreeColor(rgb(210, 214, 222)) },
    uSunDirection: { value: new THREE.Vector3(0.6, 0.7, 0.25).normalize() },
    uCloudNearOffset: { value: new THREE.Vector2(0, 0) },
    uCloudFarOffset: { value: new THREE.Vector2(0.19, -0.11) },
    uCloudNearScale: { value: SEASONAL_SKY_CONFIG.cloudLayerScaleNear },
    uCloudFarScale: { value: SEASONAL_SKY_CONFIG.cloudLayerScaleFar },
    uCloudCoverage: { value: SEASONAL_SKY_CONFIG.summerCloudCoverage },
    uOvercastStrength: { value: 0.2 },
    uSunVisibility: { value: 1 },
    uHazeStrength: { value: SEASONAL_SKY_CONFIG.hazeStrengthSummer }
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: skyVertexShader,
    fragmentShader: skyFragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false
  });
  const geometry = new THREE.SphereGeometry(1, 48, 28);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.setScalar(96);
  mesh.renderOrder = -100;
  mesh.frustumCulled = false;

  const setState = (state: SeasonalSkyState): void => {
    uniforms.uSkyTopColor.value.copy(toThreeColor(state.skyTopColor));
    uniforms.uSkyHorizonColor.value.copy(toThreeColor(state.skyHorizonColor));
    uniforms.uSunColor.value.copy(toThreeColor(state.sunColor));
    uniforms.uCloudNearColor.value.copy(toThreeColor(state.cloudNearColor));
    uniforms.uCloudFarColor.value.copy(toThreeColor(state.cloudFarColor));
    uniforms.uSunDirection.value.copy(state.sunDirection);
    uniforms.uCloudNearOffset.value.copy(state.cloudNearOffset);
    uniforms.uCloudFarOffset.value.copy(state.cloudFarOffset);
    uniforms.uCloudNearScale.value = state.cloudNearScale;
    uniforms.uCloudFarScale.value = state.cloudFarScale;
    uniforms.uCloudCoverage.value = state.cloudCoverage;
    uniforms.uOvercastStrength.value = state.overcastStrength;
    uniforms.uSunVisibility.value = state.sunVisibility;
    uniforms.uHazeStrength.value = state.hazeStrength;
  };

  const syncToCamera = (camera: THREE.Camera): void => {
    mesh.position.copy(camera.position);
    if ("far" in camera && typeof camera.far === "number" && Number.isFinite(camera.far)) {
      mesh.scale.setScalar(Math.max(48, camera.far * 0.88));
    }
  };

  const dispose = (): void => {
    geometry.dispose();
    material.dispose();
  };

  return {
    mesh,
    setState,
    syncToCamera,
    dispose
  };
};

export const SEASONAL_SKY_BASELINE = {
  equinoxAzimuthDeg: EQUINOX_AZIMUTH_DEG,
  dayArcDaysPerCycle: SEASONAL_SKY_CONFIG.dayArcDaysPerCycle
} as const;
