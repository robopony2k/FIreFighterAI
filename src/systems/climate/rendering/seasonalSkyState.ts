import * as THREE from "three";
import {
  EQUINOX_AZIMUTH_DEG,
  sampleSeasonalSunTrajectory
} from "./seasonalSunTrajectory.js";
import {
  sampleSeasonalAtmosphereVisualState,
  type AtmosphereRgb,
  type SeasonalAtmosphereVisualState
} from "./seasonalAtmosphereVisualState.js";
import {
  sampleSeasonalWeatherVisualState,
  type SeasonalWeatherVisualState
} from "./seasonalWeatherVisualState.js";
import {
  sampleSeasonalCloudDensity,
  type SeasonalCloudFieldSample
} from "./seasonalCloudField.js";
import { sampleSeasonalCloudAdvection } from "./seasonalCloudAdvection.js";
import {
  sampleSeasonalCloudProfile,
  type SeasonalCloudProfile
} from "./seasonalCloudProfile.js";

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const wrap01 = (value: number): number => ((value % 1) + 1) % 1;
const degToRad = (degrees: number): number => degrees * (Math.PI / 180);
type RGB = AtmosphereRgb;
const rgb = (r: number, g: number, b: number): RGB => ({ r, g, b });
const mixRgb = (a: RGB, b: RGB, t: number): RGB => ({
  r: lerp(a.r, b.r, t),
  g: lerp(a.g, b.g, t),
  b: lerp(a.b, b.b, t)
});

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
  cloudLayerScaleNear: 1.64,
  cloudLayerScaleFar: 0.88,
  cloudLayerDriftNear: 0.032,
  cloudLayerDriftFar: 0.0165,
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
  cloudProfile: SeasonalCloudProfile;
};

const computeSunOcclusion = (
  sunDirection: THREE.Vector3,
  cloudState: SeasonalCloudFieldSample,
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
  for (let index = 0; index < samples.length; index += 1) {
    const weight = weights[index] ?? 0;
    total += sampleSeasonalCloudDensity(samples[index], cloudState) * weight;
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
  const azimuthRad = degToRad(sunAzimuthDeg);
  const elevationRad = degToRad(sunElevationDeg);
  const horizontal = Math.cos(elevationRad);
  const sunDirection = new THREE.Vector3(
    horizontal * Math.cos(azimuthRad),
    Math.sin(elevationRad),
    horizontal * Math.sin(azimuthRad)
  ).normalize();
  const cloudCoverage = atmosphere.cloudCoverage01;
  const advection = sampleSeasonalCloudAdvection({
    careerDay: input.careerDay,
    weatherSeed: weather.weatherSeed,
    worldSeed: input.worldSeed,
    nearDriftPerDay: config.cloudLayerDriftNear,
    farDriftPerDay: config.cloudLayerDriftFar
  });
  const cloudNearOffset = new THREE.Vector2(advection.nearX, advection.nearY);
  const cloudFarOffset = new THREE.Vector2(advection.farX, advection.farY);
  const cloudTimeDays = advection.morphTimeDays;
  const cloudProfile = sampleSeasonalCloudProfile({
    seasonT01,
    stormIntensity01: weather.stormIntensity01
  });
  const cloudField: SeasonalCloudFieldSample = {
    cloudCoverage,
    cloudSoftness01: atmosphere.cloudSoftness01,
    cloudDensity01: atmosphere.cloudDensity01,
    cloudNearScale: config.cloudLayerScaleNear,
    cloudFarScale: config.cloudLayerScaleFar,
    cloudNearOffset,
    cloudFarOffset,
    stormIntensity01: weather.stormIntensity01,
    cloudTimeDays,
    cloudProfile
  };
  const sunOcclusion01 = computeSunOcclusion(sunDirection, cloudField, config);
  const overcastStrength = clamp01(
    cloudCoverage * 0.38 + atmosphere.wetSky01 * 0.22 + atmosphere.stormMood01 * 0.22
  );
  const sunColor = mixRgb(
    mixRgb(rgb(244, 242, 236), rgb(255, 229, 184), summer01),
    rgb(232, 238, 244),
    overcastStrength * 0.24 + winter01 * 0.08
  );
  const sunVisibility = clamp(1 - sunOcclusion01 * config.sunOcclusionLightReduction, 0.14, 1);
  const sunIntensity = clamp(
    lerp(config.sunIntensityWinter, config.sunIntensitySummer, summer01) * sunVisibility,
    0.45,
    1.3
  );
  const glareIntensity = clamp(
    lerp(config.glareIntensityWinter, config.glareIntensitySummer, summer01) *
      (1 - sunOcclusion01 * config.sunOcclusionGlareReduction),
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
    skyTopColor: atmosphere.skyTopColor,
    skyHorizonColor: atmosphere.skyHorizonColor,
    cloudNearColor: atmosphere.cloudBrightColor,
    cloudFarColor: atmosphere.cloudShadowColor,
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
    cloudTimeDays,
    stormIntensity01: weather.stormIntensity01,
    clearSky01: atmosphere.clearSky01,
    wetSky01: atmosphere.wetSky01,
    stormMood01: atmosphere.stormMood01,
    oceanShallowColor: atmosphere.oceanShallowColor,
    oceanDeepColor: atmosphere.oceanDeepColor,
    weatherSeed: weather.weatherSeed,
    cloudProfile
  };
};

export const SEASONAL_SKY_BASELINE = {
  equinoxAzimuthDeg: EQUINOX_AZIMUTH_DEG
} as const;
