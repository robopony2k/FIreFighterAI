import * as THREE from "three";
import { FUEL_PROFILES } from "../../../core/config.js";
import { COAST_CLASS_NONE, TILE_ID_TO_TYPE, TILE_TYPE_IDS } from "../../../core/state.js";
import { buildDistanceField } from "../shared/distanceField.js";

type Rgb = { r: number; g: number; b: number };

type TileTextureSample = {
  cols: number;
  rows: number;
  treeTypes?: Uint8Array;
  riverMask?: Uint8Array;
  tileMoisture?: Float32Array;
  climateDryness?: number;
  tileFuel?: Float32Array;
  tileFire?: Float32Array;
  tileHeat?: Float32Array;
  heatCap?: number;
};

type TileTextureBuildDeps = {
  forestToneBase: Rgb;
  forestTintById: ArrayLike<Rgb | undefined>;
  noiseAt: (value: number) => number;
  waterAlphaMinRatio: number;
  oceanBorderOpenWaterDistanceMin: number;
  oceanSurfaceShoreClipBand: number;
  oceanRatioMin: number;
  riverRatioMin: number;
  stepRockyTintMax: number;
  sunDir: { x: number; y: number; z: number };
};

const DRY_TINT_BY_TILE: Record<number, [number, number, number]> = {
  [TILE_TYPE_IDS.grass]: [0.72, 0.62, 0.34],
  [TILE_TYPE_IDS.scrub]: [0.68, 0.58, 0.32],
  [TILE_TYPE_IDS.floodplain]: [0.66, 0.61, 0.42],
  [TILE_TYPE_IDS.forest]: [0.48, 0.44, 0.28]
};

const WET_TINT_BY_TILE: Record<number, [number, number, number]> = {
  [TILE_TYPE_IDS.grass]: [0.38, 0.56, 0.32],
  [TILE_TYPE_IDS.scrub]: [0.42, 0.53, 0.33],
  [TILE_TYPE_IDS.floodplain]: [0.48, 0.6, 0.4],
  [TILE_TYPE_IDS.forest]: [0.33, 0.46, 0.31]
};

const SCORCH_WARM_TINT: [number, number, number] = [0.34, 0.25, 0.16];
const SCORCH_CHAR_TINT: [number, number, number] = [0.19, 0.18, 0.17];
const BASE_FUEL_BY_TILE_ID = TILE_ID_TO_TYPE.map((tileType) => Math.max(0, FUEL_PROFILES[tileType]?.baseFuel ?? 0));

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  if (edge0 === edge1) {
    return x < edge0 ? 0 : 1;
  }
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

export const sampleTouchesWorldBorder = (
  tileX: number,
  tileY: number,
  endX: number,
  endY: number,
  cols: number,
  rows: number
): boolean => tileX === 0 || tileY === 0 || endX === cols || endY === rows;

const createTexture = (data: Uint8Array, sampleCols: number, sampleRows: number): THREE.DataTexture => {
  const flipped = new Uint8Array(data.length);
  const rowStride = sampleCols * 4;
  for (let y = 0; y < sampleRows; y += 1) {
    const src = y * rowStride;
    const dst = (sampleRows - 1 - y) * rowStride;
    flipped.set(data.subarray(src, src + rowStride), dst);
  }
  const texture = new THREE.DataTexture(flipped, sampleCols, sampleRows, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.generateMipmaps = false;
  return texture;
};

export const buildTileTexture = (
  sample: TileTextureSample,
  sampleCols: number,
  sampleRows: number,
  step: number,
  palette: number[][],
  grassId: number,
  scrubId: number,
  floodplainId: number,
  beachId: number,
  forestId: number,
  waterId: number,
  roadId: number | null,
  heightScale: number,
  sampleHeights: Float32Array,
  sampleTypes: Uint8Array,
  sampleCoastClass: Uint8Array | undefined,
  waterRatio: Float32Array | null,
  oceanRatio: Float32Array | null,
  riverRatio: Float32Array | null,
  sampledRiverCoverage: Float32Array | null,
  riverStepStrength: Float32Array | null | undefined,
  debugTypeColors: boolean,
  deps: TileTextureBuildDeps
): THREE.DataTexture => {
  const { cols, rows } = sample;
  const treeTypes = sample.treeTypes;
  const riverMask = sample.riverMask;
  const tileMoisture = sample.tileMoisture;
  const climateDryness = clamp(sample.climateDryness ?? 0.35, 0, 1);
  const ashId = TILE_TYPE_IDS.ash;
  const distanceToLand = (() => {
    const total = sampleCols * sampleRows;
    const mapped = new Uint8Array(total);
    for (let i = 0; i < total; i += 1) {
      mapped[i] = sampleTypes[i] === waterId ? 1 : 0;
    }
    return buildDistanceField(mapped, sampleCols, sampleRows, 0);
  })();
  const data = new Uint8Array(sampleCols * sampleRows * 4);
  const getRoadGroundColor = (row: number, col: number): number[] => {
    if (roadId === null) {
      return palette[grassId] ?? [0, 0, 0];
    }
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let count = 0;
    const addNeighbor = (nRow: number, nCol: number) => {
      if (nRow < 0 || nCol < 0 || nRow >= sampleRows || nCol >= sampleCols) {
        return;
      }
      const t = sampleTypes[nRow * sampleCols + nCol];
      if (t === roadId) {
        return;
      }
      const source = t === waterId ? palette[grassId] : palette[t] ?? palette[grassId];
      if (!source) {
        return;
      }
      sumR += source[0];
      sumG += source[1];
      sumB += source[2];
      count += 1;
    };
    addNeighbor(row - 1, col);
    addNeighbor(row + 1, col);
    addNeighbor(row, col - 1);
    addNeighbor(row, col + 1);
    addNeighbor(row - 1, col - 1);
    addNeighbor(row - 1, col + 1);
    addNeighbor(row + 1, col - 1);
    addNeighbor(row + 1, col + 1);
    if (count === 0) {
      return palette[grassId] ?? [0, 0, 0];
    }
    return [sumR / count, sumG / count, sumB / count];
  };
  const heightAtSample = (x: number, y: number): number => {
    const clampedX = Math.max(0, Math.min(sampleCols - 1, x));
    const clampedY = Math.max(0, Math.min(sampleRows - 1, y));
    return sampleHeights[clampedY * sampleCols + clampedX] ?? 0;
  };
  let offset = 0;
  for (let row = 0; row < sampleRows; row += 1) {
    const tileY = Math.min(rows - 1, row * step);
    for (let col = 0; col < sampleCols; col += 1) {
      const tileX = Math.min(cols - 1, col * step);
      const endX = Math.min(cols, tileX + step);
      const endY = Math.min(rows, tileY + step);
      const idx = tileY * cols + tileX;
      const sampleIndex = row * sampleCols + col;
      const typeId = sampleTypes[sampleIndex] ?? grassId;
      const touchesWorldBorder = sampleTouchesWorldBorder(tileX, tileY, endX, endY, cols, rows);
      const localWaterRatio = waterRatio ? clamp(waterRatio[sampleIndex] ?? 0, 0, 1) : typeId === waterId ? 1 : 0;
      const localOceanRatio = oceanRatio ? clamp(oceanRatio[sampleIndex] ?? 0, 0, 1) : localWaterRatio;
      const localRiverRatio = riverRatio ? clamp(riverRatio[sampleIndex] ?? 0, 0, 1) : 0;
      const localRiverCoverage = sampledRiverCoverage ? clamp(sampledRiverCoverage[sampleIndex] ?? 0, 0, 1) : localRiverRatio;
      const coastalDistanceToLand = distanceToLand[sampleIndex] >= 0 ? distanceToLand[sampleIndex] : sampleCols + sampleRows;
      const coastClass = sampleCoastClass?.[sampleIndex] ?? COAST_CLASS_NONE;
      const riverMaskAtTile = riverMask ? riverMask[idx] > 0 : false;
      const riverMaskNearby = (() => {
        if (!riverMask) {
          return false;
        }
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            if (ox === 0 && oy === 0) {
              continue;
            }
            const nx = tileX + ox;
            const ny = tileY + oy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
              continue;
            }
            if (riverMask[ny * cols + nx] > 0) {
              return true;
            }
          }
        }
        return false;
      })();
      const rawStepStrength = riverStepStrength ? riverStepStrength[sampleIndex] : 0;
      const localStepStrength = Number.isFinite(rawStepStrength) ? clamp(rawStepStrength as number, 0, 1) : 0;
      const riverDominant =
        riverMaskAtTile ||
        localRiverCoverage >= 0.1 ||
        localRiverRatio >= Math.max(0.08, localOceanRatio * 0.7);
      let colorType = typeId;
      if (!debugTypeColors) {
        if (typeId === forestId) {
          colorType = grassId;
        } else if (typeId === beachId) {
          const riverBank =
            riverMaskAtTile ||
            riverMaskNearby ||
            localRiverCoverage >= 0.06 ||
            (localRiverRatio >= 0.03 &&
              localOceanRatio < Math.max(0.28, localRiverRatio * 1.25));
          if (riverBank) {
            colorType = grassId;
          }
        } else if (typeId === waterId) {
          const oceanShoreDominant = localOceanRatio >= Math.max(0.22, localRiverRatio * 1.35);
          const borderOpenOcean =
            touchesWorldBorder &&
            coastalDistanceToLand > deps.oceanBorderOpenWaterDistanceMin;
          const shoreUnderlayBand =
            touchesWorldBorder
              ? deps.oceanBorderOpenWaterDistanceMin
              : deps.oceanSurfaceShoreClipBand;
          const renderShoreUnderlay =
            oceanShoreDominant &&
            !borderOpenOcean &&
            coastalDistanceToLand <= shoreUnderlayBand &&
            (coastClass !== COAST_CLASS_NONE || localOceanRatio >= deps.oceanRatioMin);
          if (riverDominant) {
            colorType = floodplainId;
          } else {
            colorType = renderShoreUnderlay ? beachId : waterId;
          }
        }
      }
      let color = palette[colorType] ?? palette[grassId];
      if (!debugTypeColors && roadId !== null && typeId === roadId) {
        color = getRoadGroundColor(row, col);
      }
      if (!debugTypeColors && typeId === forestId) {
        const dominantId = treeTypes ? treeTypes[idx] : 255;
        const tint = deps.forestTintById[dominantId] ?? deps.forestToneBase;
        const tintColor: [number, number, number] = [tint.r / 255, tint.g / 255, tint.b / 255];
        const mixFactor = 0.55;
        color = [
          color[0] * (1 - mixFactor) + tintColor[0] * mixFactor,
          color[1] * (1 - mixFactor) + tintColor[1] * mixFactor,
          color[2] * (1 - mixFactor) + tintColor[2] * mixFactor
        ];
      }
      if (!debugTypeColors && typeId === ashId) {
        const ashNoise = deps.noiseAt(idx * 5.131 + 91.7);
        const ashCool = deps.noiseAt(idx * 1.977 + 13.4);
        const ashBase = 0.18 + ashNoise * 0.18;
        color = [
          ashBase * 0.95,
          ashBase * 0.93,
          ashBase * (1.0 + ashCool * 0.08)
        ];
      }
      if (!debugTypeColors && (typeId === grassId || typeId === scrubId || typeId === floodplainId || typeId === forestId)) {
        const localMoisture = tileMoisture ? clamp(tileMoisture[idx] ?? 0.5, 0, 1) : 0.5;
        const localDryness = 1 - localMoisture;
        const effectiveDryness = clamp(climateDryness * 0.72 + localDryness * 0.28, 0, 1);
        const dryTint = DRY_TINT_BY_TILE[typeId] ?? DRY_TINT_BY_TILE[grassId];
        const wetTint = WET_TINT_BY_TILE[typeId] ?? WET_TINT_BY_TILE[grassId];
        const dryWeight =
          (typeId === grassId ? 0.58 : typeId === scrubId ? 0.62 : typeId === floodplainId ? 0.34 : 0.26) *
          effectiveDryness;
        const wetWeight =
          (typeId === floodplainId ? 0.18 : 0.08) * (1 - effectiveDryness);
        color = [
          color[0] * (1 - dryWeight) + dryTint[0] * dryWeight,
          color[1] * (1 - dryWeight) + dryTint[1] * dryWeight,
          color[2] * (1 - dryWeight) + dryTint[2] * dryWeight
        ];
        if (wetWeight > 0.0001) {
          color = [
            color[0] * (1 - wetWeight) + wetTint[0] * wetWeight,
            color[1] * (1 - wetWeight) + wetTint[1] * wetWeight,
            color[2] * (1 - wetWeight) + wetTint[2] * wetWeight
          ];
        }
      }
      if (!debugTypeColors && sample.tileFuel && (typeId === grassId || typeId === scrubId || typeId === floodplainId || typeId === forestId)) {
        const baseFuel = BASE_FUEL_BY_TILE_ID[typeId] ?? 0;
        if (baseFuel > 0) {
          const localMoisture = tileMoisture ? clamp(tileMoisture[idx] ?? 0.5, 0, 1) : 0.5;
          const expectedFuel = Math.max(0.01, baseFuel * (1 - localMoisture * 0.6));
          const fuelNow = clamp(sample.tileFuel[idx] ?? expectedFuel, 0, expectedFuel);
          const fuelDepletion = clamp(1 - fuelNow / expectedFuel, 0, 1);
          const liveFire = clamp(sample.tileFire?.[idx] ?? 0, 0, 1);
          const liveHeat = clamp(
            (sample.tileHeat?.[idx] ?? 0) / Math.max(0.01, sample.heatCap ?? 5),
            0,
            1
          );
          const activeBurnHold = clamp(
            smoothstep(0.02, 0.12, liveFire) * 0.92 + smoothstep(0.08, 0.32, liveHeat) * 0.42,
            0,
            1
          );
          const warmScorch = smoothstep(0.3, 0.85, fuelDepletion);
          const charScorch = smoothstep(0.62, 0.98, fuelDepletion);
          const warmMixBase = (typeId === forestId ? 0.46 : 0.34) * warmScorch;
          const charMixBase = (typeId === forestId ? 0.54 : 0.4) * charScorch;
          const warmMix = clamp(warmMixBase * (1 - activeBurnHold * 0.48) + activeBurnHold * 0.1, 0, 1);
          const charMix = clamp(charMixBase * (1 - activeBurnHold * 0.96), 0, 1);
          color = [
            color[0] * (1 - warmMix) + SCORCH_WARM_TINT[0] * warmMix,
            color[1] * (1 - warmMix) + SCORCH_WARM_TINT[1] * warmMix,
            color[2] * (1 - warmMix) + SCORCH_WARM_TINT[2] * warmMix
          ];
          color = [
            color[0] * (1 - charMix) + SCORCH_CHAR_TINT[0] * charMix,
            color[1] * (1 - charMix) + SCORCH_CHAR_TINT[1] * charMix,
            color[2] * (1 - charMix) + SCORCH_CHAR_TINT[2] * charMix
          ];
        }
      }
      if (!debugTypeColors && typeId === waterId && localRiverRatio >= deps.riverRatioMin) {
        const rockyColor = palette[TILE_TYPE_IDS.rocky] ?? color;
        const floodColor = palette[floodplainId] ?? palette[grassId] ?? color;
        const wetBankColor: [number, number, number] = [
          floodColor[0] * 0.72 + rockyColor[0] * 0.28,
          floodColor[1] * 0.76 + rockyColor[1] * 0.24,
          floodColor[2] * 0.8 + rockyColor[2] * 0.2
        ];
        const blend = clamp(localRiverRatio * 1.25 + localRiverCoverage * 0.35, 0, 0.9);
        const riverbedColor: [number, number, number] = [
          color[0] * (1 - blend) + wetBankColor[0] * blend,
          color[1] * (1 - blend) + wetBankColor[1] * blend,
          color[2] * (1 - blend) + wetBankColor[2] * blend
        ];
        const rockyStepBlend = clamp(localStepStrength * deps.stepRockyTintMax, 0, deps.stepRockyTintMax);
        color = [
          riverbedColor[0] * (1 - rockyStepBlend) + rockyColor[0] * rockyStepBlend,
          riverbedColor[1] * (1 - rockyStepBlend) + rockyColor[1] * rockyStepBlend,
          riverbedColor[2] * (1 - rockyStepBlend) + rockyColor[2] * rockyStepBlend
        ];
      }
      const height = heightAtSample(col, row);
      const baseNoise = deps.noiseAt(idx + 1);
      const fineNoise = (deps.noiseAt(idx * 3.7 + 17.7) - 0.5) * 0.04;
      const heightTone = clamp(0.88 + height * 0.08, 0.72, 1.05);
      const noise = (baseNoise - 0.5) * 0.08;
      const heightLeft = heightAtSample(col - 1, row);
      const heightRight = heightAtSample(col + 1, row);
      const heightUp = heightAtSample(col, row - 1);
      const heightDown = heightAtSample(col, row + 1);
      const dx = (heightRight - heightLeft) * heightScale;
      const dz = (heightDown - heightUp) * heightScale;
      const nx = -dx;
      const ny = 2;
      const nz = -dz;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      const light =
        (nx / nLen) * deps.sunDir.x + (ny / nLen) * deps.sunDir.y + (nz / nLen) * deps.sunDir.z;
      const shade = clamp(0.68 + light * 0.32, 0.55, 1);
      const slope = Math.sqrt(dx * dx + dz * dz);
      const occlusion = clamp(1 - slope * 0.06, 0.7, 1);
      const ashToneBoost = !debugTypeColors && typeId === ashId ? 1.18 : 1;
      const tone = heightTone * shade * occlusion * ashToneBoost;
      const rawR = color[0];
      const rawG = color[1];
      const rawB = color[2];
      const r = clamp((debugTypeColors ? rawR : (rawR + noise) * tone + fineNoise), 0, 1) * 255;
      const g = clamp((debugTypeColors ? rawG : (rawG + noise) * tone + fineNoise), 0, 1) * 255;
      const b = clamp((debugTypeColors ? rawB : (rawB + noise) * tone + fineNoise), 0, 1) * 255;
      const borderOpenOcean =
        touchesWorldBorder &&
        coastalDistanceToLand > deps.oceanBorderOpenWaterDistanceMin;
      const shouldCutForOcean =
        !debugTypeColors &&
        !riverDominant &&
        localOceanRatio >= deps.waterAlphaMinRatio &&
        (borderOpenOcean ||
          (typeId === waterId &&
            coastalDistanceToLand > deps.oceanSurfaceShoreClipBand &&
            !touchesWorldBorder));
      data[offset] = Math.round(r);
      data[offset + 1] = Math.round(g);
      data[offset + 2] = Math.round(b);
      data[offset + 3] = shouldCutForOcean ? 0 : 255;
      offset += 4;
    }
  }
  return createTexture(data, sampleCols, sampleRows);
};
