import * as THREE from "three";
import { mixRgb, type RGB } from "./color.js";
import {
  EQUINOX_AZIMUTH_DEG,
  sampleSeasonalSunTrajectory
} from "../systems/climate/rendering/seasonalSunTrajectory.js";
import {
  sampleSeasonalAtmosphereVisualState,
  type SeasonalAtmosphereVisualState
} from "../systems/climate/rendering/seasonalAtmosphereVisualState.js";
import {
  sampleSeasonalWeatherVisualState,
  type SeasonalWeatherVisualState
} from "../systems/climate/rendering/seasonalWeatherVisualState.js";

const TAU = Math.PI * 2;
const PI = Math.PI;
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

export type SeasonalSkyConfig = {
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
  sunOcclusionSampleRadius: number;
  sunOcclusionLightReduction: number;
  sunOcclusionGlareReduction: number;
  sunOcclusionShadowSoftening: number;
};

export const SEASONAL_SKY_CONFIG: SeasonalSkyConfig = {
  cloudLayerScaleNear: 1.75,
  cloudLayerScaleFar: 0.96,
  cloudLayerDriftNear: 0.0105,
  cloudLayerDriftFar: 0.0054,
  sunIntensitySummer: 1.16,
  sunIntensityWinter: 0.76,
  glareIntensitySummer: 0.16,
  glareIntensityWinter: 0.07,
  hazeStrengthSummer: 0.035,
  hazeStrengthWinter: 0.11,
  ambientSoftnessSummer: 0.16,
  ambientSoftnessWinter: 0.4,
  shadowContrastSummer: 0.96,
  shadowContrastWinter: 0.54,
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
  rainIntensity01?: number;
  rainSeed?: number;
  worldSeed?: number;
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
  cloudSoftness01: number;
  cloudDensity01: number;
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
  cloudTimeDays: number;
  stormIntensity01: number;
  clearSky01: number;
  wetSky01: number;
  stormMood01: number;
  oceanShallowColor: RGB;
  oceanDeepColor: RGB;
  weatherSeed: number;
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
  | "cloudCoverage"
  | "cloudSoftness01"
  | "cloudDensity01"
  | "cloudNearScale"
  | "cloudFarScale"
  | "cloudNearOffset"
  | "cloudFarOffset"
>;

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
  const softnessScale = lerp(0.72, 1.28, cloudState.cloudSoftness01);
  const farDensity = sampleCloudLayer(
    direction,
    cloudState.cloudFarScale,
    cloudState.cloudFarOffset,
    clamp01(cloudState.cloudCoverage * 0.7),
    0.09 * softnessScale
  );
  const nearDensity = sampleCloudLayer(
    direction,
    cloudState.cloudNearScale,
    cloudState.cloudNearOffset,
    clamp01(cloudState.cloudCoverage * 0.86),
    0.075 * softnessScale
  );
  return clamp01((farDensity * 0.36 + nearDensity * 0.54) * cloudState.cloudDensity01);
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
  const { sunAzimuthDeg, sunElevationDeg, summer01, winter01 } = sampleSeasonalSunTrajectory(seasonT01);
  const risk01 = clamp01(input.risk01);
  const weather: SeasonalWeatherVisualState = sampleSeasonalWeatherVisualState({
    careerDay: input.careerDay,
    seasonT01,
    rainIntensity01: input.rainIntensity01,
    rainSeed: input.rainSeed,
    worldSeed: input.worldSeed,
    windDx: input.windDx,
    windDy: input.windDy,
    windStrength: input.windStrength
  });
  const atmosphere: SeasonalAtmosphereVisualState = sampleSeasonalAtmosphereVisualState({
    seasonT01,
    risk01,
    rainIntensity01: input.rainIntensity01,
    wetSeason01: weather.wetSeason01,
    stormIntensity01: weather.stormIntensity01
  });

  // The sun follows a continuous stylized analemma driven only by wrapped year
  // position, so the sky dome and scene lighting stay continuous across seasons.
  const azimuthRad = degToRad(sunAzimuthDeg);
  const elevationRad = degToRad(sunElevationDeg);
  const horizontal = Math.cos(elevationRad);
  const sunDirection = new THREE.Vector3(
    horizontal * Math.cos(azimuthRad),
    Math.sin(elevationRad),
    horizontal * Math.sin(azimuthRad)
  ).normalize();

  const cloudCoverage = atmosphere.cloudCoverage01;
  const driftDays = weather.cloudTimeDays;

  // Cloud drift is keyed from authoritative wind and career day, so pauses stop motion.
  // Time-speed changes alone do not jump the cloud field.
  const cloudNearOffset = new THREE.Vector2(
    weather.windDirX * weather.windStrength01 * driftDays * config.cloudLayerDriftNear,
    weather.windDirY * weather.windStrength01 * driftDays * config.cloudLayerDriftNear
  );
  const cloudFarOffset = new THREE.Vector2(
    weather.windDirX * weather.windStrength01 * driftDays * config.cloudLayerDriftFar + 0.19,
    weather.windDirY * weather.windStrength01 * driftDays * config.cloudLayerDriftFar - 0.11
  );

  const cloudField: CloudFieldSample = {
    cloudCoverage,
    cloudSoftness01: atmosphere.cloudSoftness01,
    cloudDensity01: atmosphere.cloudDensity01,
    cloudNearScale: config.cloudLayerScaleNear,
    cloudFarScale: config.cloudLayerScaleFar,
    cloudNearOffset,
    cloudFarOffset
  };
  // Cloud occlusion samples the same layered field around the sun direction so direct
  // light and glare soften when a cloud bank crosses the visible solar disc.
  const sunOcclusion01 = computeSunOcclusion(sunDirection, cloudField, config);
  const overcastStrength = clamp01(cloudCoverage * 0.38 + atmosphere.wetSky01 * 0.22 + atmosphere.stormMood01 * 0.22);
  const sunColor = mixRgb(
    mixRgb(rgb(244, 242, 236), rgb(255, 229, 184), summer01),
    rgb(232, 238, 244),
    overcastStrength * 0.24 + winter01 * 0.08
  );
  const skyTopColor = atmosphere.skyTopColor;
  const skyHorizonColor = atmosphere.skyHorizonColor;
  const cloudFarColor = atmosphere.cloudShadowColor;
  const cloudNearColor = atmosphere.cloudBrightColor;
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
    cloudSoftness01: atmosphere.cloudSoftness01,
    cloudDensity01: atmosphere.cloudDensity01,
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
    sunElevationDeg,
    cloudTimeDays: weather.cloudTimeDays,
    stormIntensity01: weather.stormIntensity01,
    clearSky01: atmosphere.clearSky01,
    wetSky01: atmosphere.wetSky01,
    stormMood01: atmosphere.stormMood01,
    oceanShallowColor: atmosphere.oceanShallowColor,
    oceanDeepColor: atmosphere.oceanDeepColor,
    weatherSeed: weather.weatherSeed
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
  uniform float uCloudTimeDays;
  uniform float uStormIntensity;
  uniform float uCloudSoftness;
  uniform float uCloudDensity;

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
    float threshold = mix(0.63, 0.38, clamp(coverage, 0.0, 1.0));
    float density = smoothstep(threshold - softness, threshold + softness, shape);
    return clamp(density * (0.72 + base * 0.36), 0.0, 1.0);
  }

  float samplePlanarNoise(vec2 uv, float scale, vec2 offset) {
    vec2 p = uv * scale + offset;
    float octave0 = sampleNoise(p);
    float octave1 = sampleNoise(p * 1.93 + vec2(0.17, -0.29) - offset.yx * 0.17);
    float octave2 = sampleNoise(p * 3.71 + vec2(-0.43, 0.31) + offset * 0.09);
    float billow = 1.0 - abs(octave0 * 2.0 - 1.0);
    return clamp(octave0 * 0.52 + billow * 0.3 + octave1 * 0.14 + octave2 * 0.04, 0.0, 1.0);
  }

  float samplePlanarCloudLayer(vec3 dir, float layerLift, float scale, vec2 offset, float coverage, float softness) {
    float rayY = max(0.055, dir.y + layerLift);
    vec2 planeUv = dir.xz / rayY;
    planeUv *= 0.32;
    float warp = samplePlanarNoise(planeUv, scale * 0.28, offset * 0.32 + vec2(0.19, -0.23));
    float warpDetail = samplePlanarNoise(planeUv, scale * 0.48, vec2(-offset.y * 0.21 + 0.73, offset.x * 0.21 + 0.41));
    vec2 warpedUv = planeUv + vec2((warp - 0.5) * 0.22, (warpDetail - 0.5) * 0.16);
    float base = samplePlanarNoise(warpedUv, scale, offset);
    float detail = samplePlanarNoise(warpedUv, scale * 1.38, offset * 1.31 + vec2(-0.17, 0.29));
    float billow = samplePlanarNoise(warpedUv, scale * 0.46, offset * 0.57 + vec2(0.51, -0.37));
    float core = smoothstep(0.42, 0.76, base * 0.72 + billow * 0.28);
    float shape = clamp(pow(base * 0.64 + billow * 0.28 + detail * 0.08, 1.34), 0.0, 1.0);
    float threshold = mix(0.82, 0.45, clamp(coverage, 0.0, 1.0));
    float density = smoothstep(threshold, threshold + softness * mix(0.68, 1.26, uCloudSoftness), shape) * core;
    float skyMask = smoothstep(-0.04, 0.08, dir.y);
    return clamp(density * (0.74 + base * 0.34) * skyMask, 0.0, 1.0);
  }

  vec2 raymarchCloudLayer(vec3 dir, float horizonMask) {
    float coverage = clamp(uCloudCoverage + uStormIntensity * 0.16, 0.0, 1.0);
    float alpha = 0.0;
    float body = 0.0;
    float light = 0.0;
    float stepCount = 9.0;
    for (int i = 0; i < 9; i++) {
      float t = (float(i) + 0.5) / stepCount;
      vec2 shear = vec2(t * 0.19 + uCloudTimeDays * 0.0009, -t * 0.13 + uCloudTimeDays * 0.0006);
      float farDensity = samplePlanarCloudLayer(
        dir,
        0.18 + t * 0.12,
        uCloudFarScale * mix(0.92, 1.16, t),
        uCloudFarOffset + shear,
        coverage * mix(0.72, 0.96, t),
        mix(0.14, 0.09, t)
      );
      float nearDensity = samplePlanarCloudLayer(
        dir,
        0.08 + t * 0.1,
        uCloudNearScale * mix(0.88, 1.28, t),
        uCloudNearOffset - shear.yx * 0.72,
        min(1.0, coverage * mix(0.82, 1.22, t)),
        mix(0.12, 0.07, t)
      );
      float density = clamp(farDensity * 0.34 + nearDensity * 0.54, 0.0, 1.0) * uCloudDensity;
      density *= smoothstep(0.02, 0.2, dir.y + 0.14) * mix(0.82, 1.18, horizonMask);
      density = clamp(density * mix(0.86, 1.32, uStormIntensity), 0.0, 1.0);
      float sliceAlpha = density * mix(0.22, 0.36, uStormIntensity);
      alpha += (1.0 - alpha) * sliceAlpha;
      body += (1.0 - body) * density * 0.18;
      light += (1.0 - light) * density * mix(t, 1.0 - t * 0.35, uStormIntensity) * 0.24;
    }
    return vec2(clamp(alpha, 0.0, 0.98), clamp(body * 0.74 + light * 0.46, 0.0, 1.0));
  }

  void main() {
    vec3 dir = normalize(vSkyDir);
    float skyT = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 baseSky = mix(uSkyHorizonColor, uSkyTopColor, pow(skyT, 0.6));
    float horizonMask = smoothstep(0.2, 1.0, 1.0 - clamp(dir.y, -0.3, 1.0));
    float farDensity = samplePlanarCloudLayer(
      dir,
      0.24,
      uCloudFarScale * 0.92,
      uCloudFarOffset + vec2(uCloudTimeDays * 0.0007, -uCloudTimeDays * 0.0004),
      uCloudCoverage * 0.56 + uStormIntensity * 0.13,
      0.13
    ) * mix(0.94, 1.2, horizonMask);
    float nearDensity = samplePlanarCloudLayer(
      dir,
      0.12,
      uCloudNearScale,
      uCloudNearOffset + vec2(-uCloudTimeDays * 0.0003, uCloudTimeDays * 0.0005),
      min(1.0, uCloudCoverage * 0.74 + uStormIntensity * 0.18),
      0.1
    ) * mix(0.9, 1.24, horizonMask);
    float cloudPresence = mix(0.06, 1.0, smoothstep(0.24, 0.88, uCloudCoverage + uStormIntensity * 0.34));
    float planarCloudAlpha = clamp(farDensity * 0.36 + nearDensity * 0.58, 0.0, 0.92) * cloudPresence * uCloudDensity;
    vec2 cloudVolume = raymarchCloudLayer(dir, horizonMask);
    cloudVolume.x *= mix(0.18, 1.0, cloudPresence);
    cloudVolume.y *= mix(0.36, 1.0, cloudPresence);
    float cloudAlpha = clamp(max(cloudVolume.x, planarCloudAlpha * 0.82) + planarCloudAlpha * 0.16, 0.0, 0.96);
    float sunDot = max(dot(dir, normalize(uSunDirection)), 0.0);
    float glow = pow(sunDot, mix(12.0, 6.0, uOvercastStrength));
    float disc = smoothstep(0.9945, 0.9989, sunDot);
    vec3 sunColor = uSunColor * uSunVisibility;
    vec3 skyWithSun = baseSky + sunColor * (glow * 0.48 + disc * 1.35);
    float nearMix = clamp(cloudVolume.y + nearDensity * 0.42 + horizonMask * 0.18, 0.0, 1.0);
    vec3 cloudBase = mix(uCloudFarColor, uCloudNearColor, nearMix);
    float cloudBody = clamp(max(cloudVolume.y, planarCloudAlpha * 0.62), 0.0, 1.0);
    float cloudHighlight = pow(clamp(1.0 - cloudBody, 0.0, 1.0), 1.35);
    float stormMood = clamp(uStormIntensity * 0.72 + smoothstep(0.42, 0.88, uCloudCoverage) * 0.48, 0.0, 1.0);
    float contrast = clamp(0.12 + uCloudCoverage * 0.26 + stormMood * 0.38 + horizonMask * 0.1, 0.0, 0.82);
    vec3 cloudShadowColor = mix(vec3(0.78, 0.81, 0.84), vec3(0.34, 0.36, 0.4), stormMood);
    vec3 cloudBrightColor = mix(cloudBase, vec3(1.0, 0.99, 0.95), 0.44 - stormMood * 0.22);
    vec3 cloudMidColor = mix(cloudShadowColor, cloudBrightColor, 0.5 + cloudHighlight * 0.46);
    vec3 cloudColor = mix(cloudMidColor, mix(cloudMidColor, cloudBrightColor, 0.28), smoothstep(0.72, 0.98, sunDot));
    cloudColor = mix(cloudColor, cloudColor - vec3(0.1, 0.11, 0.12) * cloudBody, contrast * cloudBody);
    cloudColor = mix(cloudColor, cloudBrightColor, (1.0 - cloudBody) * 0.18);
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
    uCloudCoverage: { value: 0.06 },
    uOvercastStrength: { value: 0.2 },
    uSunVisibility: { value: 1 },
    uHazeStrength: { value: SEASONAL_SKY_CONFIG.hazeStrengthSummer },
    uCloudTimeDays: { value: 0 },
    uStormIntensity: { value: 0 },
    uCloudSoftness: { value: 0.8 },
    uCloudDensity: { value: 0.4 }
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
    uniforms.uCloudTimeDays.value = state.cloudTimeDays;
    uniforms.uStormIntensity.value = state.stormIntensity01;
    uniforms.uCloudSoftness.value = state.cloudSoftness01;
    uniforms.uCloudDensity.value = state.cloudDensity01;
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
  equinoxAzimuthDeg: EQUINOX_AZIMUTH_DEG
} as const;
