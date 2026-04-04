import * as THREE from "three";
import { buildDistanceField } from "../shared/distanceField.js";

export type WaterSampleRatios = {
  water: Float32Array;
  ocean: Float32Array;
  river: Float32Array;
};

const WATER_ALPHA_MIN_RATIO = 0.1;
const RIVER_RATIO_MIN = 0.2;
const WATER_ALPHA_POWER = 0.85;
const RIVER_BANK_MAX_DISTANCE = 5;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const noiseAt = (value: number): number => {
  const s = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};

const createDataTexture = (
  data: Uint8Array,
  width: number,
  height: number,
  magFilter: THREE.MagnificationTextureFilter,
  minFilter: THREE.MinificationTextureFilter
): THREE.DataTexture => {
  const flipped = new Uint8Array(data.length);
  const rowStride = width * 4;
  for (let y = 0; y < height; y += 1) {
    const src = y * rowStride;
    const dst = (height - 1 - y) * rowStride;
    flipped.set(data.subarray(src, src + rowStride), dst);
  }
  const texture = new THREE.DataTexture(flipped, width, height, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.magFilter = magFilter;
  texture.minFilter = minFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.generateMipmaps = false;
  return texture;
};

export const buildWaterSupportMapTexture = (
  sampleCols: number,
  sampleRows: number,
  supportMask: Uint8Array
): THREE.DataTexture => {
  const data = new Uint8Array(sampleCols * sampleRows * 4);
  for (let i = 0; i < supportMask.length; i += 1) {
    const v = supportMask[i] ? 255 : 0;
    const base = i * 4;
    data[base] = v;
    data[base + 1] = v;
    data[base + 2] = v;
    data[base + 3] = 255;
  }
  return createDataTexture(data, sampleCols, sampleRows, THREE.NearestFilter, THREE.NearestFilter);
};

export const buildRiverBankMapTexture = (
  sampleCols: number,
  sampleRows: number,
  supportMask: Uint8Array,
  riverRatio: Float32Array
): THREE.DataTexture => {
  const total = sampleCols * sampleRows;
  const riverSupport = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) {
    riverSupport[i] = supportMask[i] && (riverRatio[i] ?? 0) >= RIVER_RATIO_MIN ? 1 : 0;
  }
  const distToRiver = buildDistanceField(riverSupport, sampleCols, sampleRows, 1);
  const distToNonRiver = buildDistanceField(riverSupport, sampleCols, sampleRows, 0);
  const data = new Uint8Array(total * 4);
  for (let i = 0; i < total; i += 1) {
    const inside = riverSupport[i] > 0;
    const distInside = distToNonRiver[i] >= 0 ? distToNonRiver[i] : RIVER_BANK_MAX_DISTANCE;
    const distOutside = distToRiver[i] >= 0 ? distToRiver[i] : RIVER_BANK_MAX_DISTANCE;
    const signed = inside ? distInside : -distOutside;
    const normalized = clamp(signed / RIVER_BANK_MAX_DISTANCE, -1, 1);
    const encoded = Math.round((normalized * 0.5 + 0.5) * 255);
    const base = i * 4;
    data[base] = encoded;
    data[base + 1] = encoded;
    data[base + 2] = encoded;
    data[base + 3] = 255;
  }
  return createDataTexture(data, sampleCols, sampleRows, THREE.LinearFilter, THREE.LinearFilter);
};

export const buildRiverFlowTexture = (
  sampleHeights: Float32Array,
  sampleTypes: Uint8Array,
  sampleCols: number,
  sampleRows: number,
  waterId: number,
  riverRatio: Float32Array
): THREE.DataTexture => {
  const total = sampleCols * sampleRows;
  const data = new Uint8Array(total * 4);
  const sampleHeight = (x: number, y: number): number => {
    const clampedX = clamp(x, 0, sampleCols - 1);
    const clampedY = clamp(y, 0, sampleRows - 1);
    return sampleHeights[clampedY * sampleCols + clampedX] ?? 0;
  };
  for (let i = 0; i < total; i += 1) {
    const base = i * 4;
    const riverStrength = clamp(riverRatio[i] ?? 0, 0, 1);
    if (sampleTypes[i] !== waterId || riverStrength <= 0.02) {
      data[base] = 128;
      data[base + 1] = 128;
      data[base + 2] = 0;
      data[base + 3] = 0;
      continue;
    }
    const x = i % sampleCols;
    const y = Math.floor(i / sampleCols);
    const center = sampleHeight(x, y);
    let dirX = 0;
    let dirY = 0;
    let bestDrop = 0;
    const neighbors = [
      { x: x - 1, y, dx: -1, dy: 0 },
      { x: x + 1, y, dx: 1, dy: 0 },
      { x, y: y - 1, dx: 0, dy: -1 },
      { x, y: y + 1, dx: 0, dy: 1 }
    ];
    neighbors.forEach((neighbor) => {
      if (neighbor.x < 0 || neighbor.y < 0 || neighbor.x >= sampleCols || neighbor.y >= sampleRows) {
        return;
      }
      const nIdx = neighbor.y * sampleCols + neighbor.x;
      if (sampleTypes[nIdx] !== waterId) {
        return;
      }
      const drop = center - sampleHeights[nIdx];
      if (drop > bestDrop) {
        bestDrop = drop;
        dirX = neighbor.dx;
        dirY = neighbor.dy;
      }
    });
    const gradX = sampleHeight(x - 1, y) - sampleHeight(x + 1, y);
    const gradY = sampleHeight(x, y - 1) - sampleHeight(x, y + 1);
    if (bestDrop <= 0.0001) {
      dirX = gradX;
      dirY = gradY;
    }
    let len = Math.hypot(dirX, dirY);
    if (len <= 0.0001) {
      const n = noiseAt(i * 0.37 + 1.7) * Math.PI * 2;
      dirX = Math.cos(n);
      dirY = Math.sin(n);
      len = 1;
    }
    dirX /= len;
    dirY /= len;
    const speed = clamp(bestDrop * 22 + Math.hypot(gradX, gradY) * 4, 0, 1);
    data[base] = Math.round((dirX * 0.5 + 0.5) * 255);
    data[base + 1] = Math.round((dirY * 0.5 + 0.5) * 255);
    data[base + 2] = Math.round(speed * 255);
    data[base + 3] = Math.round(riverStrength * 255);
  }
  return createDataTexture(data, sampleCols, sampleRows, THREE.LinearFilter, THREE.LinearFilter);
};

export const buildRapidMapTexture = (
  waterHeights: Float32Array,
  sampleCols: number,
  sampleRows: number,
  ratios: WaterSampleRatios,
  riverStepStrength?: Float32Array
): THREE.DataTexture => {
  const total = sampleCols * sampleRows;
  const data = new Uint8Array(total * 4);
  for (let i = 0; i < total; i += 1) {
    const base = i * 4;
    const water = clamp(ratios.water[i] ?? 0, 0, 1);
    const river = clamp(ratios.river[i] ?? 0, 0, 1);
    if (water < WATER_ALPHA_MIN_RATIO || river <= 0.01) {
      data[base] = 0;
      data[base + 1] = 0;
      data[base + 2] = 0;
      data[base + 3] = 0;
      continue;
    }
    const rawStep = riverStepStrength ? riverStepStrength[i] : 0;
    const step = Number.isFinite(rawStep) ? clamp(rawStep as number, 0, 1) : 0;
    const x = i % sampleCols;
    const y = Math.floor(i / sampleCols);
    const left = x > 0 ? waterHeights[i - 1] : waterHeights[i];
    const right = x < sampleCols - 1 ? waterHeights[i + 1] : waterHeights[i];
    const up = y > 0 ? waterHeights[i - sampleCols] : waterHeights[i];
    const down = y < sampleRows - 1 ? waterHeights[i + sampleCols] : waterHeights[i];
    const grad = Math.hypot(right - left, down - up);
    const flow = clamp(grad * 7.5, 0, 1);
    const rapid = clamp(step * 0.72 + flow * 0.58 + river * 0.24, 0, 1);
    const ramp = clamp((water - WATER_ALPHA_MIN_RATIO) / (1 - WATER_ALPHA_MIN_RATIO), 0, 1);
    const alpha = Math.pow(ramp, WATER_ALPHA_POWER);
    data[base] = Math.round(step * 255);
    data[base + 1] = Math.round(flow * 255);
    data[base + 2] = Math.round(river * 255);
    data[base + 3] = Math.round(clamp(alpha * rapid, 0, 1) * 255);
  }
  return createDataTexture(data, sampleCols, sampleRows, THREE.LinearFilter, THREE.LinearFilter);
};
