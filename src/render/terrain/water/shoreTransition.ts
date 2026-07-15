import * as THREE from "three";
import {
  COAST_CLASS_NONE,
  COAST_CLASS_SHELF_WATER
} from "../../../core/state.js";
import { buildDistanceField } from "../shared/distanceField.js";

export type ShoreTransitionData = {
  landwardFade: Float32Array;
  seawardFade: Float32Array;
  overlapMask: Float32Array;
  signedDistance: Float32Array;
};

type ShoreTransitionCoastData = {
  beachWeight?: Float32Array;
  cliffWeight?: Float32Array;
  shelfWeight?: Float32Array;
};

type ShoreTransitionBuildOptions = {
  sampleCols: number;
  sampleRows: number;
  oceanSupportMask: Uint8Array;
  sampleCoastClass: Uint8Array | undefined;
  coastData: ShoreTransitionCoastData;
  shoreTerrainHeightRelativeToWater: Float32Array;
  oceanRatio: Float32Array;
};

const SHORE_TRANSITION_LAND_REACH = 1.25;
const SHORE_TRANSITION_SEA_REACH = 2.25;
const SHORE_TRANSITION_CLIFF_FADE_START = 0.2;
const SHORE_TRANSITION_CLIFF_FADE_END = 0.55;
const SHORE_TRANSITION_HEIGHT_FADE_START = 0.1;
const SHORE_TRANSITION_HEIGHT_FADE_END = 0.45;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  if (edge0 === edge1) {
    return x < edge0 ? 0 : 1;
  }
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
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

export const buildShoreTransitionData = ({
  sampleCols,
  sampleRows,
  oceanSupportMask,
  sampleCoastClass,
  coastData,
  shoreTerrainHeightRelativeToWater,
  oceanRatio
}: ShoreTransitionBuildOptions): ShoreTransitionData => {
  const total = sampleCols * sampleRows;
  const landwardFade = new Float32Array(total);
  const seawardFade = new Float32Array(total);
  const overlapMask = new Float32Array(total);
  const signedDistance = new Float32Array(total);
  let hasOceanSupport = false;
  for (let i = 0; i < total; i += 1) {
    if (oceanSupportMask[i] > 0) {
      hasOceanSupport = true;
      break;
    }
  }
  if (!hasOceanSupport) {
    return { landwardFade, seawardFade, overlapMask, signedDistance };
  }

  const distToWater = buildDistanceField(oceanSupportMask, sampleCols, sampleRows, 1);
  const distToLand = buildDistanceField(oceanSupportMask, sampleCols, sampleRows, 0);
  for (let i = 0; i < total; i += 1) {
    const x = i % sampleCols;
    const y = Math.floor(i / sampleCols);
    const isWater = oceanSupportMask[i] > 0;
    const waterDist = distToWater[i] >= 0 ? distToWater[i] : sampleCols + sampleRows;
    const landDist = distToLand[i] >= 0 ? distToLand[i] : sampleCols + sampleRows;
    const maskDistance = isWater ? Math.max(0.5, landDist - 0.5) : -Math.max(0.5, waterDist - 0.5);
    const terrainDelta = shoreTerrainHeightRelativeToWater[i] ?? 0;
    let localHeightGradient = 0;
    const sampleNeighbor = (nx: number, ny: number): void => {
      if (nx < 0 || ny < 0 || nx >= sampleCols || ny >= sampleRows) {
        return;
      }
      localHeightGradient = Math.max(
        localHeightGradient,
        Math.abs((shoreTerrainHeightRelativeToWater[ny * sampleCols + nx] ?? terrainDelta) - terrainDelta)
      );
    };
    sampleNeighbor(x - 1, y);
    sampleNeighbor(x + 1, y);
    sampleNeighbor(x, y - 1);
    sampleNeighbor(x, y + 1);
    const terrainSideConsistent = isWater ? terrainDelta <= 0.03 : terrainDelta >= -0.01;
    const terrainDistance = -terrainDelta / Math.max(0.004, localHeightGradient);
    const terrainBlend = terrainSideConsistent
      ? smoothstep(0.004, 0.035, localHeightGradient) *
        (1 - smoothstep(0.75, 2.0, Math.abs(maskDistance)))
      : 0;
    const d = maskDistance * (1 - terrainBlend) +
      clamp(terrainDistance, isWater ? 0.04 : -2.25, isWater ? 2.25 : -0.04) * terrainBlend;
    const coastClass = sampleCoastClass?.[i] ?? COAST_CLASS_NONE;
    const baseEligibility = clamp(
      (coastData.beachWeight?.[i] ?? 0) +
        (coastData.shelfWeight?.[i] ?? 0) * 0.75 +
        (coastClass === COAST_CLASS_SHELF_WATER ? 0.35 : 0),
      0,
      1
    ) * (1 - smoothstep(SHORE_TRANSITION_CLIFF_FADE_START, SHORE_TRANSITION_CLIFF_FADE_END, coastData.cliffWeight?.[i] ?? 0));
    const heightMask = 1 - smoothstep(
      SHORE_TRANSITION_HEIGHT_FADE_START,
      SHORE_TRANSITION_HEIGHT_FADE_END,
      Math.max(0, shoreTerrainHeightRelativeToWater[i] ?? 0)
    );
    const oceanPresence = clamp(oceanRatio[i] ?? 0, 0, 1);
    const waterSideEligibility =
      baseEligibility * (1 - oceanPresence) + Math.max(baseEligibility, oceanPresence) * oceanPresence;

    landwardFade[i] =
      !isWater
        ? baseEligibility *
          heightMask *
          Math.max(0, 1 - smoothstep(0.0, SHORE_TRANSITION_LAND_REACH, -d))
        : 0;
    seawardFade[i] =
      isWater
        ? waterSideEligibility *
          Math.max(0, 1 - smoothstep(0.0, SHORE_TRANSITION_SEA_REACH, d))
        : 0;
    overlapMask[i] = baseEligibility * heightMask;
    signedDistance[i] = d;
  }

  return { landwardFade, seawardFade, overlapMask, signedDistance };
};

export const buildShoreTransitionMapTexture = (
  sampleCols: number,
  sampleRows: number,
  shoreTransition: ShoreTransitionData
): THREE.DataTexture => {
  const total = sampleCols * sampleRows;
  const maxDistance = Math.max(SHORE_TRANSITION_LAND_REACH, SHORE_TRANSITION_SEA_REACH);
  const data = new Uint8Array(total * 4);
  for (let i = 0; i < total; i += 1) {
    const base = i * 4;
    data[base] = Math.round(clamp(shoreTransition.seawardFade[i] ?? 0, 0, 1) * 255);
    data[base + 1] = Math.round(clamp(shoreTransition.landwardFade[i] ?? 0, 0, 1) * 255);
    data[base + 2] = Math.round(clamp(shoreTransition.overlapMask[i] ?? 0, 0, 1) * 255);
    const normalizedDistance = clamp((shoreTransition.signedDistance[i] ?? 0) / maxDistance, -1, 1);
    data[base + 3] = Math.round((normalizedDistance * 0.5 + 0.5) * 255);
  }
  return createDataTexture(data, sampleCols, sampleRows, THREE.LinearFilter, THREE.LinearFilter);
};
