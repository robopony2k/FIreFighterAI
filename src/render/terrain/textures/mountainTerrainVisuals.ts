import * as THREE from "three";
import { TILE_TYPE_IDS } from "../../../core/state.js";

export type MountainTerrainMaskSample = {
  cols: number;
  rows: number;
  tileMoisture?: Float32Array;
  rockExposure?: Float32Array;
  structureMask?: Uint8Array;
  tileTownId?: Int16Array;
  climateDryness?: number;
  worldSeed?: number;
};

export type BuildMountainTerrainMaskTextureOptions = {
  sample: MountainTerrainMaskSample;
  sampleCols: number;
  sampleRows: number;
  step: number;
  heightScale: number;
  sampleHeights: Float32Array;
  sampleTypes: Uint8Array;
  riverRatio: Float32Array | null;
  oceanRatio: Float32Array | null;
  sampledRiverCoverage: Float32Array | null;
  sampledLakeCoverage: Float32Array | null | undefined;
};

export type MountainTerrainVisualMetrics = {
  rockExposure: number;
  ridge: number;
  gully: number;
  highland: number;
};

export type MountainTerrainMaskField = {
  data: Uint8Array;
  sampleCols: number;
  sampleRows: number;
  step: number;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  if (edge0 === edge1) {
    return x < edge0 ? 0 : 1;
  }
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

const hash2d = (x: number, y: number, seed: number): number => {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return s - Math.floor(s);
};

const sampleValueNoise = (tileX: number, tileY: number, scaleTiles: number, seed: number): number => {
  const x = tileX / Math.max(1, scaleTiles);
  const y = tileY / Math.max(1, scaleTiles);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const n00 = hash2d(x0, y0, seed);
  const n10 = hash2d(x0 + 1, y0, seed);
  const n01 = hash2d(x0, y0 + 1, seed);
  const n11 = hash2d(x0 + 1, y0 + 1, seed);
  const nx0 = n00 * (1 - sx) + n10 * sx;
  const nx1 = n01 * (1 - sx) + n11 * sx;
  return nx0 * (1 - sy) + nx1 * sy;
};

export const isMountainTerrainProtectedType = (typeId: number): boolean =>
  typeId === TILE_TYPE_IDS.water ||
  typeId === TILE_TYPE_IDS.road ||
  typeId === TILE_TYPE_IDS.base ||
  typeId === TILE_TYPE_IDS.house ||
  typeId === TILE_TYPE_IDS.firebreak ||
  typeId === TILE_TYPE_IDS.ash;

export const hasTownOrStructureInSampleBlock = (
  cols: number,
  rows: number,
  tileX: number,
  tileY: number,
  step: number,
  structureMask?: Uint8Array,
  tileTownId?: Int16Array
): boolean => {
  if (!structureMask && !tileTownId) {
    return false;
  }
  const endX = Math.min(cols, tileX + Math.max(1, step));
  const endY = Math.min(rows, tileY + Math.max(1, step));
  for (let y = tileY; y < endY; y += 1) {
    const rowBase = y * cols;
    for (let x = tileX; x < endX; x += 1) {
      const idx = rowBase + x;
      if ((structureMask?.[idx] ?? 0) > 0 || (tileTownId?.[idx] ?? -1) >= 0) {
        return true;
      }
    }
  }
  return false;
};

const heightAtSample = (sampleHeights: Float32Array, sampleCols: number, sampleRows: number, x: number, y: number): number => {
  const clampedX = Math.max(0, Math.min(sampleCols - 1, x));
  const clampedY = Math.max(0, Math.min(sampleRows - 1, y));
  return sampleHeights[clampedY * sampleCols + clampedX] ?? 0;
};

export const createMountainTerrainMaskTexture = (field: MountainTerrainMaskField): THREE.DataTexture => {
  const { data, sampleCols, sampleRows } = field;
  const flipped = new Uint8Array(data.length);
  const rowStride = sampleCols * 4;
  for (let y = 0; y < sampleRows; y += 1) {
    const src = y * rowStride;
    const dst = (sampleRows - 1 - y) * rowStride;
    flipped.set(data.subarray(src, src + rowStride), dst);
  }
  const texture = new THREE.DataTexture(flipped, sampleCols, sampleRows, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.generateMipmaps = false;
  return texture;
};

export const sampleMountainTerrainMaskAtTile = (
  field: MountainTerrainMaskField,
  tileX: number,
  tileY: number
): MountainTerrainVisualMetrics => {
  const col = Math.max(0, Math.min(field.sampleCols - 1, Math.round(tileX / Math.max(1, field.step))));
  const row = Math.max(0, Math.min(field.sampleRows - 1, Math.round(tileY / Math.max(1, field.step))));
  const base = (row * field.sampleCols + col) * 4;
  return {
    rockExposure: (field.data[base] ?? 0) / 255,
    ridge: (field.data[base + 1] ?? 0) / 255,
    gully: (field.data[base + 2] ?? 0) / 255,
    highland: (field.data[base + 3] ?? 0) / 255
  };
};

export const buildMountainTerrainMaskField = (
  options: BuildMountainTerrainMaskTextureOptions
): MountainTerrainMaskField => {
  const {
    sample,
    sampleCols,
    sampleRows,
    step,
    heightScale,
    sampleHeights,
    sampleTypes,
    riverRatio,
    oceanRatio,
    sampledRiverCoverage,
    sampledLakeCoverage
  } = options;
  const { cols, rows } = sample;
  const worldSeed = Math.floor(sample.worldSeed ?? 0);
  const climateDryness = clamp(sample.climateDryness ?? 0.35, 0, 1);
  const data = new Uint8Array(sampleCols * sampleRows * 4);

  let minHeight = Number.POSITIVE_INFINITY;
  let maxHeight = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < sampleHeights.length; i += 1) {
    const height = sampleHeights[i] ?? 0;
    minHeight = Math.min(minHeight, height);
    maxHeight = Math.max(maxHeight, height);
  }
  if (!Number.isFinite(minHeight) || !Number.isFinite(maxHeight)) {
    minHeight = 0;
    maxHeight = 1;
  }
  const invHeightRange = 1 / Math.max(0.001, maxHeight - minHeight);

  for (let row = 0; row < sampleRows; row += 1) {
    const tileY = Math.min(rows - 1, row * step);
    for (let col = 0; col < sampleCols; col += 1) {
      const tileX = Math.min(cols - 1, col * step);
      const sampleIndex = row * sampleCols + col;
      const typeId = sampleTypes[sampleIndex] ?? TILE_TYPE_IDS.grass;
      const localRiverRatio = clamp(riverRatio?.[sampleIndex] ?? 0, 0, 1);
      const localOceanRatio = clamp(oceanRatio?.[sampleIndex] ?? 0, 0, 1);
      const localRiverCoverage = clamp(sampledRiverCoverage?.[sampleIndex] ?? localRiverRatio, 0, 1);
      const localLakeCoverage = clamp(sampledLakeCoverage?.[sampleIndex] ?? 0, 0, 1);
      const protectedSample =
        isMountainTerrainProtectedType(typeId) ||
        localRiverCoverage >= 0.03 ||
        localRiverRatio >= 0.03 ||
        localOceanRatio >= 0.08 ||
        localLakeCoverage >= 0.03 ||
        hasTownOrStructureInSampleBlock(
          cols,
          rows,
          tileX,
          tileY,
          step,
          sample.structureMask,
          sample.tileTownId
        );

      let rockExposure = 0;
      let ridge = 0;
      let gully = 0;
      let highland = 0;
      if (!protectedSample) {
        const idx = tileY * cols + tileX;
        const height = heightAtSample(sampleHeights, sampleCols, sampleRows, col, row);
        const heightLeft = heightAtSample(sampleHeights, sampleCols, sampleRows, col - 1, row);
        const heightRight = heightAtSample(sampleHeights, sampleCols, sampleRows, col + 1, row);
        const heightUp = heightAtSample(sampleHeights, sampleCols, sampleRows, col, row - 1);
        const heightDown = heightAtSample(sampleHeights, sampleCols, sampleRows, col, row + 1);
        const curvature = (heightLeft + heightRight + heightUp + heightDown) * 0.25 - height;
        const dx = (heightRight - heightLeft) * heightScale;
        const dz = (heightDown - heightUp) * heightScale;
        const slope = Math.sqrt(dx * dx + dz * dz);
        const bandNoise =
          (sampleValueNoise(tileX + 0.5, tileY + 0.5, 18, worldSeed + 401) - 0.5) * 0.12 +
          (sampleValueNoise(tileX + 0.5, tileY + 0.5, 7, worldSeed + 443) - 0.5) * 0.04;
        const height01 = clamp((height - minHeight) * invHeightRange + bandNoise, 0, 1);
        const localMoisture = clamp(sample.tileMoisture?.[idx] ?? 0.5, 0, 1);
        const dryness = clamp(climateDryness * 0.58 + (1 - localMoisture) * 0.42, 0, 1);
        const slopeMask = smoothstep(0.08, 0.34, slope);
        const cliffMask = smoothstep(0.22, 0.58, slope);
        const dryMask = smoothstep(0.36, 0.82, dryness);
        highland = smoothstep(0.5, 0.9, height01);
        const ridgeMask = smoothstep(0.002, 0.02, -curvature) * smoothstep(0.055, 0.26, slope);
        const gullyMask = smoothstep(0.002, 0.028, curvature) * smoothstep(0.04, 0.22, slope);
        const angularNoise =
          Math.abs(
            sampleValueNoise(tileX + 0.5, tileY + 0.5, 5, worldSeed + 617) -
            sampleValueNoise(tileX + 0.5, tileY + 0.5, 11, worldSeed + 659)
          );
        const chippedNoise = smoothstep(0.18, 0.58, angularNoise + slope * 0.42 + highland * 0.08);
        const morphologyExposure = clamp(sample.rockExposure?.[idx] ?? 0, 0, 1);
        const renderDetail = clamp(
          cliffMask * 0.42 +
          slopeMask * (0.1 + dryMask * 0.1) +
          ridgeMask * 0.18 +
          gullyMask * 0.18 +
          chippedNoise * 0.12,
          0,
          1
        );
        rockExposure = clamp(morphologyExposure * 0.86 + renderDetail * 0.14, 0, 1);
        ridge = ridgeMask * (0.48 + highland * 0.52);
        gully = gullyMask * (0.58 + highland * 0.42);
        const brokenRidge = chippedNoise * smoothstep(-0.01, 0.018, -curvature + angularNoise * 0.018);
        const brokenGully = chippedNoise * smoothstep(-0.008, 0.022, curvature + (1 - angularNoise) * 0.012);
        ridge = Math.max(ridge, brokenRidge * morphologyExposure * (0.32 + highland * 0.28));
        gully = Math.max(gully, brokenGully * morphologyExposure * (0.28 + highland * 0.24));
      }

      const base = sampleIndex * 4;
      data[base] = Math.round(clamp(rockExposure, 0, 1) * 255);
      data[base + 1] = Math.round(clamp(ridge, 0, 1) * 255);
      data[base + 2] = Math.round(clamp(gully, 0, 1) * 255);
      data[base + 3] = Math.round(clamp(highland, 0, 1) * 255);
    }
  }

  return { data, sampleCols, sampleRows, step };
};

export const buildMountainTerrainMaskTexture = (options: BuildMountainTerrainMaskTextureOptions): THREE.DataTexture =>
  createMountainTerrainMaskTexture(buildMountainTerrainMaskField(options));
