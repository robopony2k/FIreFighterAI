import * as THREE from "three";
import { sampleSeasonalCloudVolume } from "./seasonalCloudVolume.js";
import type { SeasonalCloudProfile } from "./seasonalCloudProfile.js";

export const SEASONAL_CLOUD_NOISE_SIZE = 128;
export const SEASONAL_CLOUD_NOISE_CHANNELS = 4;
export const SEASONAL_CLOUD_MARCH_STEPS = 20;

export type SeasonalCloudNoiseData = {
  data: Uint8Array;
  size: number;
};

export type SeasonalCloudFieldSample = {
  cloudCoverage: number;
  cloudSoftness01: number;
  cloudDensity01: number;
  cloudNearScale: number;
  cloudFarScale: number;
  cloudNearOffset: THREE.Vector2;
  cloudFarOffset: THREE.Vector2;
  stormIntensity01: number;
  cloudTimeDays: number;
  cloudProfile: SeasonalCloudProfile;
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const wrap01 = (value: number): number => ((value % 1) + 1) % 1;
const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

const hashNoiseLattice = (x: number, y: number, salt: number): number => {
  const value = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453123;
  return value - Math.floor(value);
};

const sampleTileableValueNoise = (u: number, v: number, frequency: number, salt: number): number => {
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
  const v00 = hashNoiseLattice(x0 % frequency, y0 % frequency, salt);
  const v10 = hashNoiseLattice(x1, y0 % frequency, salt);
  const v01 = hashNoiseLattice(x0 % frequency, y1, salt);
  const v11 = hashNoiseLattice(x1, y1, salt);
  return lerp(lerp(v00, v10, sx), lerp(v01, v11, sx), sy);
};

const sampleTileableWorley = (
  u: number,
  v: number,
  frequency: number,
  salt: number
): { core: number; growth: number } => {
  const x = wrap01(u) * frequency;
  const y = wrap01(v) * frequency;
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  let nearestDistanceSq = Number.POSITIVE_INFINITY;
  let nearestGrowth = 0.5;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const unwrappedX = cellX + dx;
      const unwrappedY = cellY + dy;
      const wrappedX = (unwrappedX + frequency) % frequency;
      const wrappedY = (unwrappedY + frequency) % frequency;
      const featureX = unwrappedX + hashNoiseLattice(wrappedX, wrappedY, salt);
      const featureY = unwrappedY + hashNoiseLattice(wrappedX, wrappedY, salt + 1.91);
      const distanceSq = (x - featureX) ** 2 + (y - featureY) ** 2;
      if (distanceSq < nearestDistanceSq) {
        nearestDistanceSq = distanceSq;
        nearestGrowth = hashNoiseLattice(wrappedX, wrappedY, salt + 4.37);
      }
    }
  }
  return {
    core: clamp01(1 - Math.sqrt(nearestDistanceSq) / 1.02),
    growth: nearestGrowth
  };
};

const createSeasonalCloudNoiseData = (): SeasonalCloudNoiseData => {
  const size = SEASONAL_CLOUD_NOISE_SIZE;
  const data = new Uint8Array(size * size * SEASONAL_CLOUD_NOISE_CHANNELS);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const warpX = sampleTileableValueNoise(u, v, 4, 2.73);
      const warpY = sampleTileableValueNoise(u, v, 4, 4.19);
      const warpedU = u + (warpX - 0.5) * 0.14;
      const warpedV = v + (warpY - 0.5) * 0.14;
      const cellular = sampleTileableWorley(warpedU, warpedV, 4, 0.17);
      const broad = sampleTileableValueNoise(warpedU, warpedV, 3, 1.31);
      const weatherSystem = sampleTileableValueNoise(warpedU, warpedV, 2, 6.83);
      const clusterStrength = smoothstep(
        0.2,
        0.8,
        weatherSystem * 0.7 + broad * 0.3
      );
      const footprint = clamp01(
        cellular.core * lerp(0.48, 1.16, clusterStrength) + broad * 0.08
      );
      const growth = clamp01(
        cellular.growth * 0.48 + cellular.core * 0.27 + weatherSystem * 0.25
      );
      const index = (y * size + x) * SEASONAL_CLOUD_NOISE_CHANNELS;
      data[index] = Math.round(footprint * 255);
      data[index + 1] = Math.round(growth * 255);
      data[index + 2] = Math.round(warpX * 255);
      data[index + 3] = Math.round(warpY * 255);
    }
  }
  return { data, size };
};

export const SEASONAL_CLOUD_NOISE = createSeasonalCloudNoiseData();

const sampleNoiseChannel = (u: number, v: number, channel: number): number => {
  const { data, size } = SEASONAL_CLOUD_NOISE;
  const x = wrap01(u) * size;
  const y = wrap01(v) * size;
  const x0 = Math.floor(x) % size;
  const y0 = Math.floor(y) % size;
  const x1 = (x0 + 1) % size;
  const y1 = (y0 + 1) % size;
  const tx = x - Math.floor(x);
  const ty = y - Math.floor(y);
  const stride = SEASONAL_CLOUD_NOISE_CHANNELS;
  const v00 = (data[(y0 * size + x0) * stride + channel] ?? 0) / 255;
  const v10 = (data[(y0 * size + x1) * stride + channel] ?? 0) / 255;
  const v01 = (data[(y1 * size + x0) * stride + channel] ?? 0) / 255;
  const v11 = (data[(y1 * size + x1) * stride + channel] ?? 0) / 255;
  return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty);
};

export const sampleSeasonalCloudWeather = (
  u: number,
  v: number,
  channel: number
): number => sampleNoiseChannel(u, v, channel);

const sampleCloudDensityAtPosition = (
  worldX: number,
  worldY: number,
  worldZ: number,
  cloudBase: number,
  cloudTop: number,
  cloudState: SeasonalCloudFieldSample
): number => {
  const height01 = clamp01((worldY - cloudBase) / Math.max(0.0001, cloudTop - cloudBase));
  const profile = cloudState.cloudProfile;
  const scale = cloudState.cloudNearScale;
  const offsetX = cloudState.cloudNearOffset.x;
  const offsetY = cloudState.cloudNearOffset.y;
  const rotatedX = worldX * 0.8 + worldZ * 0.6;
  const rotatedZ = -worldX * 0.6 + worldZ * 0.8;
  const weatherU = rotatedX * scale * 0.021 * profile.footprintScale + offsetX * 0.36;
  const weatherV = rotatedZ * scale * 0.021 * profile.footprintScale + offsetY * 0.36;
  const weatherFootprint = sampleNoiseChannel(weatherU, weatherV, 0);
  const weatherGrowth = sampleNoiseChannel(weatherU, weatherV, 1);
  const weatherWarpX = sampleNoiseChannel(weatherU, weatherV, 2) - 0.5;
  const weatherWarpZ = sampleNoiseChannel(weatherU, weatherV, 3) - 0.5;
  const coverage = clamp01(cloudState.cloudCoverage);
  const coverageThreshold =
    0.85 -
    0.3 * smoothstep(0, 0.8, coverage) +
    profile.footprintThresholdBias;
  const middleBulge = Math.sin(height01 * Math.PI);
  const cumulusContraction =
    profile.cumulus01 *
    (Math.max(0, height01 - 0.16) * 0.16 - middleBulge * 0.035);
  const stratiformContraction =
    (1 - profile.cumulus01) * Math.max(0, height01 - 0.72) * 0.075;
  const growthLift = profile.cumulus01 * (weatherGrowth - 0.5) * height01 * 0.11;
  const heightAdjustedFootprint =
    weatherFootprint - cumulusContraction - stratiformContraction + growthLift;
  const footprint = smoothstep(
    coverageThreshold - 0.045,
    coverageThreshold + 0.065,
    heightAdjustedFootprint
  );
  if (footprint <= 0.001) {
    return 0;
  }

  const morphPhase = cloudState.cloudTimeDays * 0.035;
  const morphX = Math.sin(morphPhase + weatherWarpZ * 4.1) * 0.045;
  const morphZ = Math.cos(morphPhase * 0.83 - weatherWarpX * 3.7) * 0.045;
  const volumeFrequency = 0.15 * profile.volumeScale;
  const volumeX =
    rotatedX * scale * volumeFrequency +
    offsetX * 0.74 +
    weatherWarpX * 0.28 +
    morphX;
  const volumeY =
    height01 * 1.08 +
    weatherWarpZ * 0.16;
  const volumeZ =
    rotatedZ * scale * volumeFrequency +
    offsetY * 0.74 +
    weatherWarpZ * 0.28 +
    morphZ;
  const volumeBroad = sampleSeasonalCloudVolume(volumeX, volumeY, volumeZ, 0);
  const volumeBillow = sampleSeasonalCloudVolume(volumeX, volumeY, volumeZ, 1);
  const mediumErosion = sampleSeasonalCloudVolume(volumeX, volumeY, volumeZ, 2);
  const fineErosion = sampleSeasonalCloudVolume(volumeX, volumeY, volumeZ, 3);
  const baseRamp = smoothstep(0, lerp(0.09, 0.055, profile.cumulus01), height01);
  const stratiformTop = 1 - smoothstep(0.72 + weatherGrowth * 0.08, 1, height01);
  const cumulusTop = 1 - smoothstep(0.68 + weatherGrowth * 0.2, 1, height01);
  const verticalProfile = baseRamp * lerp(stratiformTop, cumulusTop, profile.cumulus01);
  const volumeShape =
    volumeBroad * 0.62 +
    volumeBillow * 0.38 +
    middleBulge * lerp(0.08, 0.17, profile.cumulus01);
  const bodyThreshold = lerp(0.5, 0.56, profile.cumulus01);
  const bodySoftness = lerp(0.045, 0.085, clamp01(cloudState.cloudSoftness01));
  const body = smoothstep(
    bodyThreshold - bodySoftness,
    bodyThreshold + bodySoftness,
    volumeShape
  );
  const edgeExposure = 1 - smoothstep(0.18, 0.78, body);
  const edgeErosion =
    (1 - (mediumErosion * 0.68 + fineErosion * 0.32)) *
    edgeExposure *
    profile.erosionStrength *
    lerp(0.18, 0.34, profile.cumulus01);
  const localDensityScale =
    lerp(1.02, 1.46, clamp01(cloudState.cloudDensity01)) *
    lerp(1.28, 1, coverage) *
    lerp(1.12, 1, profile.cumulus01);
  return clamp01(
    Math.max(0, footprint * verticalProfile * (body - edgeErosion)) *
      localDensityScale
  );
};

export const sampleSeasonalCloudDensity = (
  direction: THREE.Vector3,
  cloudState: SeasonalCloudFieldSample
): number => {
  const inverseLength = 1 / Math.max(0.0001, direction.length());
  const dirX = direction.x * inverseLength;
  const dirY = direction.y * inverseLength;
  const dirZ = direction.z * inverseLength;
  if (dirY <= 0.012) {
    return 0;
  }
  const cloudBase = cloudState.cloudProfile.baseHeight;
  const cloudTop = cloudState.cloudProfile.topHeight;
  const horizon01 = 1 - clamp01(dirY);
  const rayStart = cloudBase / dirY;
  const rayEnd = Math.min(
    cloudTop / dirY,
    rayStart + lerp(8, 22, horizon01)
  );
  let transmittance = 1;
  const sampleCount = 10;
  const stepLength = (rayEnd - rayStart) / sampleCount;
  for (let index = 0; index < sampleCount; index += 1) {
    const rayDistance = rayStart + (index + 0.5) * stepLength;
    const density = sampleCloudDensityAtPosition(
      dirX * rayDistance,
      dirY * rayDistance,
      dirZ * rayDistance,
      cloudBase,
      cloudTop,
      cloudState
    );
    const sliceAlpha = 1 - Math.exp(-density * stepLength * 1.35);
    transmittance *= 1 - sliceAlpha;
  }
  return clamp01(1 - transmittance);
};
