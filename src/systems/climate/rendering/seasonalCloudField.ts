import * as THREE from "three";
import { sampleSeasonalCloudVolume } from "./seasonalCloudVolume.js";

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

const createSeasonalCloudNoiseData = (): SeasonalCloudNoiseData => {
  const size = SEASONAL_CLOUD_NOISE_SIZE;
  const data = new Uint8Array(size * size * SEASONAL_CLOUD_NOISE_CHANNELS);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const broad0 = sampleTileableValueNoise(u, v, 4, 0.17);
      const broad1 = sampleTileableValueNoise(u, v, 8, 1.31);
      const medium = sampleTileableValueNoise(u, v, 16, 2.73);
      const fine = sampleTileableValueNoise(u, v, 32, 4.19);
      const billow = 1 - Math.abs(broad1 * 2 - 1);
      const erosion = 1 - Math.abs(medium * 2 - 1);
      const index = (y * size + x) * SEASONAL_CLOUD_NOISE_CHANNELS;
      data[index] = Math.round(clamp01(broad0 * 0.68 + broad1 * 0.32) * 255);
      data[index + 1] = Math.round(clamp01(billow * 0.76 + broad0 * 0.24) * 255);
      data[index + 2] = Math.round(clamp01(medium * 0.64 + fine * 0.36) * 255);
      data[index + 3] = Math.round(clamp01(erosion * 0.58 + fine * 0.42) * 255);
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

const sampleCloudDensityAtPosition = (
  worldX: number,
  worldY: number,
  worldZ: number,
  cloudBase: number,
  cloudTop: number,
  cloudState: SeasonalCloudFieldSample
): number => {
  const height01 = clamp01((worldY - cloudBase) / Math.max(0.0001, cloudTop - cloudBase));
  const scale = lerp(cloudState.cloudNearScale, cloudState.cloudFarScale, height01);
  const offsetX =
    lerp(cloudState.cloudNearOffset.x, cloudState.cloudFarOffset.x, height01) + (height01 - 0.5) * 0.17;
  const offsetY =
    lerp(cloudState.cloudNearOffset.y, cloudState.cloudFarOffset.y, height01) - (height01 - 0.5) * 0.13;
  const rotatedX = worldX * 0.8 + worldZ * 0.6;
  const rotatedZ = -worldX * 0.6 + worldZ * 0.8;
  const weatherU = rotatedX * scale * 0.032 + offsetX * 0.44;
  const weatherV = rotatedZ * scale * 0.032 + offsetY * 0.44;
  const weatherBroad = sampleNoiseChannel(weatherU, weatherV, 0);
  const weatherBillow = sampleNoiseChannel(weatherU, weatherV, 1);
  const morphPhase = cloudState.cloudTimeDays * 0.0015;
  const morphX = Math.sin(morphPhase + worldY * 0.7) * 0.11;
  const morphZ = Math.cos(morphPhase * 0.83 - worldY * 0.6) * 0.11;
  const volumeX = rotatedX * scale * 0.105 + offsetX * 0.82 + morphX;
  const volumeY =
    height01 * 0.72 +
    cloudState.cloudTimeDays * 0.0012 +
    offsetX * 0.11 -
    offsetY * 0.07;
  const volumeZ = rotatedZ * scale * 0.105 + offsetY * 0.82 + morphZ;
  const volumeBroad = sampleSeasonalCloudVolume(volumeX, volumeY, volumeZ, 0);
  const volumeBillow = sampleSeasonalCloudVolume(volumeX, volumeY, volumeZ, 1);
  const volumeDetail = sampleSeasonalCloudVolume(volumeX, volumeY, volumeZ, 2);
  const erosionDetail = sampleSeasonalCloudVolume(volumeX, volumeY, volumeZ, 3);
  const storm01 = clamp01(cloudState.stormIntensity01);
  const coverage = clamp01(cloudState.cloudCoverage + storm01 * 0.16);
  const coverageThreshold = 0.795 - 0.3 * Math.pow(coverage, 1.5);
  const footprintShape = weatherBroad * 0.78 + weatherBillow * 0.22;
  const footprint = smoothstep(
    coverageThreshold - 0.035,
    coverageThreshold + 0.075,
    footprintShape
  );
  const localBase01 = (volumeDetail - 0.5) * 0.025;
  const verticalProfile =
    smoothstep(localBase01, localBase01 + 0.07, height01) *
    (1 - smoothstep(lerp(0.68, 0.78, storm01), 1, height01));
  const crown = 1 - Math.abs(height01 * 2 - 1);
  const volumeShape =
    volumeBroad * 0.56 +
    volumeBillow * 0.34 +
    volumeDetail * 0.1 +
    crown * lerp(0.18, 0.1, storm01);
  const bodyThreshold = lerp(0.63, 0.51, storm01);
  const bodySoftness = lerp(0.055, 0.095, clamp01(cloudState.cloudSoftness01));
  const body = smoothstep(
    bodyThreshold - bodySoftness,
    bodyThreshold + bodySoftness,
    volumeShape
  );
  const edgeErosion =
    Math.max(0, erosionDetail - lerp(0.46, 0.62, storm01)) *
    lerp(0.32, 0.1, storm01) *
    (1 - volumeBroad * 0.55);
  const localDensityScale =
    lerp(0.9, 1.3, clamp01(cloudState.cloudDensity01)) *
    lerp(1.22, 1, coverage) *
    lerp(1, 1.3, storm01);
  return clamp01(
    Math.max(
      0,
      footprint * body * verticalProfile -
        edgeErosion * footprint * (1 - body * 0.45)
    ) *
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
  const storm01 = clamp01(cloudState.stormIntensity01);
  const cloudBase = lerp(1.82, 1.22, storm01);
  const cloudTop = lerp(3.82, 2.72, storm01);
  const horizon01 = 1 - clamp01(dirY);
  const rayStart = cloudBase / Math.max(0.035, dirY);
  const rayEnd = Math.min(
    cloudTop / Math.max(0.035, dirY),
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
