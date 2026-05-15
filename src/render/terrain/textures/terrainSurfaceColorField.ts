import { FUEL_PROFILES } from "../../../core/config.js";
import { TILE_ID_TO_TYPE, TILE_TYPE_IDS } from "../../../core/state.js";

type Rgb = { r: number; g: number; b: number };

type TerrainSurfaceColorSample = {
  cols: number;
  rows: number;
  treeTypes?: Uint8Array;
  riverMask?: Uint8Array;
  oceanMask?: Uint8Array;
  tileMoisture?: Float32Array;
  climateDryness?: number;
  tileFuel?: Float32Array;
  tileFire?: Float32Array;
  tileHeat?: Float32Array;
  heatCap?: number;
  worldSeed?: number;
  fastUpdate?: boolean;
  debugScalarField?: Float32Array;
};

type TerrainSurfaceColorFieldDeps = {
  palette: number[][];
  forestToneBase: Rgb;
  forestTintById: ArrayLike<Rgb | undefined>;
  riverRatioMin: number;
  stepRockyTintMax: number;
};

export type BuildTerrainSurfaceColorFieldOptions = {
  sample: TerrainSurfaceColorSample;
  sampleCols: number;
  sampleRows: number;
  step: number;
  grassId: number;
  scrubId: number;
  floodplainId: number;
  beachId: number;
  forestId: number;
  waterId: number;
  roadId: number | null;
  heightScale: number;
  sampleHeights: Float32Array;
  sampleTypes: Uint8Array;
  riverRatio: Float32Array | null;
  oceanRatio: Float32Array | null;
  sampledErosionWear: Float32Array | null;
  sampledRiverCoverage: Float32Array | null;
  riverStepStrength: Float32Array | null | undefined;
  debugTypeColors: boolean;
  deps: TerrainSurfaceColorFieldDeps;
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

const mixTriplet = (a: readonly number[], b: readonly number[], t: number): [number, number, number] => {
  const clampedT = clamp(t, 0, 1);
  return [
    a[0] * (1 - clampedT) + b[0] * clampedT,
    a[1] * (1 - clampedT) + b[1] * clampedT,
    a[2] * (1 - clampedT) + b[2] * clampedT
  ];
};

const scalarDebugColor = (value: number): [number, number, number] => {
  const t = clamp(value, 0, 1);
  if (t < 0.5) {
    const k = t / 0.5;
    return [0.08 + k * 0.12, 0.16 + k * 0.48, 0.42 - k * 0.26];
  }
  const k = (t - 0.5) / 0.5;
  return [0.2 + k * 0.72, 0.64 - k * 0.14, 0.16 - k * 0.08];
};

const hasMaskCoverage = (mask?: Uint8Array): boolean => {
  if (!mask) {
    return false;
  }
  for (let i = 0; i < mask.length; i += 1) {
    if ((mask[i] ?? 0) > 0) {
      return true;
    }
  }
  return false;
};

const srgbChannelToLinear = (value: number): number =>
  value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);

const toLinearTriplet = (color: readonly number[]): [number, number, number] => [
  srgbChannelToLinear(clamp(color[0], 0, 1)),
  srgbChannelToLinear(clamp(color[1], 0, 1)),
  srgbChannelToLinear(clamp(color[2], 0, 1))
];

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

const heightAtSample = (sampleHeights: Float32Array, sampleCols: number, sampleRows: number, x: number, y: number): number => {
  const clampedX = Math.max(0, Math.min(sampleCols - 1, x));
  const clampedY = Math.max(0, Math.min(sampleRows - 1, y));
  return sampleHeights[clampedY * sampleCols + clampedX] ?? 0;
};

const applyMacroVariation = (
  color: readonly number[],
  tileX: number,
  tileY: number,
  worldSeed: number,
  typeId: number,
  floodplainId: number,
  forestId: number,
  beachId: number
): [number, number, number] => {
  const primary = sampleValueNoise(tileX + 0.5, tileY + 0.5, 16, worldSeed + 17);
  const secondary = sampleValueNoise(tileX + 0.5, tileY + 0.5, 32, worldSeed + 71);
  const variation = clamp((primary - 0.5) * 1.05 + (secondary - 0.5) * 0.55, -0.8, 0.8);
  const coolTint =
    typeId === floodplainId || typeId === forestId
      ? [0.965, 1.04, 0.985]
      : typeId === beachId
        ? [0.985, 1.005, 1.015]
        : [0.975, 1.025, 0.99];
  const warmTint =
    typeId === beachId
      ? [1.045, 1.02, 0.955]
      : [1.03, 1.012, 0.968];
  const tint = mixTriplet(coolTint, warmTint, clamp(variation * 0.5 + 0.5, 0, 1));
  const valueScale = 1 + variation * 0.055;
  return [
    clamp(color[0] * tint[0] * valueScale, 0, 1),
    clamp(color[1] * tint[1] * valueScale, 0, 1),
    clamp(color[2] * tint[2] * valueScale, 0, 1)
  ];
};

const applySlopeTint = (
  color: readonly number[],
  slope: number,
  typeId: number,
  localMoisture: number,
  rockyColor: readonly number[],
  bareColor: readonly number[],
  beachId: number
): [number, number, number] => {
  if (
    typeId === TILE_TYPE_IDS.water ||
    typeId === TILE_TYPE_IDS.road ||
    typeId === TILE_TYPE_IDS.base ||
    typeId === TILE_TYPE_IDS.house ||
    typeId === TILE_TYPE_IDS.firebreak
  ) {
    return [color[0], color[1], color[2]];
  }
  const slopeMask =
    typeId === beachId
      ? smoothstep(0.04, 0.22, slope)
      : smoothstep(0.1, 0.38, slope);
  if (slopeMask <= 0.0001) {
    return [color[0], color[1], color[2]];
  }
  const luma = color[0] * 0.299 + color[1] * 0.587 + color[2] * 0.114;
  const desaturated = mixTriplet(color, [luma, luma, luma], slopeMask * 0.18);
  const rockyBlendColor = mixTriplet(rockyColor, bareColor, clamp(0.44 - localMoisture * 0.16, 0.2, 0.55));
  const tintMix =
    typeId === TILE_TYPE_IDS.rocky || typeId === TILE_TYPE_IDS.bare
      ? slopeMask * 0.08
      : slopeMask * 0.16;
  return mixTriplet(desaturated, rockyBlendColor, tintMix);
};

const applyFastPreviewReliefContrast = (
  color: readonly number[],
  height: number,
  minHeight: number,
  invHeightRange: number,
  slope: number,
  curvature: number,
  lightGradient: number,
  typeId: number,
  beachId: number
): [number, number, number] => {
  if (
    typeId === TILE_TYPE_IDS.water ||
    typeId === TILE_TYPE_IDS.road ||
    typeId === TILE_TYPE_IDS.base ||
    typeId === TILE_TYPE_IDS.house ||
    typeId === TILE_TYPE_IDS.firebreak
  ) {
    return [color[0], color[1], color[2]];
  }

  const height01 = clamp((height - minHeight) * invHeightRange, 0, 1);
  const lowlandTint: [number, number, number] = [0.32, 0.44, 0.25];
  const uplandTint: [number, number, number] = [0.43, 0.55, 0.31];
  const highlandTint: [number, number, number] = [0.61, 0.58, 0.42];
  const rockyTint: [number, number, number] = [0.53, 0.5, 0.43];
  const heightTint =
    height01 < 0.58
      ? mixTriplet(lowlandTint, uplandTint, height01 / 0.58)
      : mixTriplet(uplandTint, highlandTint, (height01 - 0.58) / 0.42);
  const slopeMask = typeId === beachId ? smoothstep(0.035, 0.18, slope) : smoothstep(0.07, 0.3, slope);
  const ridgeMask = smoothstep(0.004, -0.02, curvature);
  const valleyMask = smoothstep(0.004, 0.028, curvature);
  const reliefShade = clamp(
    0.87 + clamp(lightGradient, -0.28, 0.3) + height01 * 0.1 - valleyMask * 0.08,
    0.66,
    1.22
  );
  const rockyMix = clamp(slopeMask * 0.24 + ridgeMask * 0.16, 0, 0.36);
  let reliefColor = mixTriplet(color, heightTint, 0.46);
  reliefColor = mixTriplet(reliefColor, rockyTint, rockyMix);
  return [
    clamp(reliefColor[0] * reliefShade, 0, 1),
    clamp(reliefColor[1] * reliefShade, 0, 1),
    clamp(reliefColor[2] * reliefShade, 0, 1)
  ];
};

export const buildTerrainSurfaceColorField = (options: BuildTerrainSurfaceColorFieldOptions): Float32Array => {
  const {
    sample,
    sampleCols,
    sampleRows,
    step,
    grassId,
    scrubId,
    floodplainId,
    beachId,
    forestId,
    waterId,
    roadId,
    heightScale,
    sampleHeights,
    sampleTypes,
    riverRatio,
    oceanRatio,
    sampledErosionWear,
    sampledRiverCoverage,
    riverStepStrength,
    debugTypeColors,
    deps
  } = options;
  const { cols, rows } = sample;
  const treeTypes = sample.treeTypes;
  const riverMask = sample.riverMask;
  const tileMoisture = sample.tileMoisture;
  const debugScalarField = sample.debugScalarField;
  const climateDryness = clamp(sample.climateDryness ?? 0.35, 0, 1);
  const ashId = TILE_TYPE_IDS.ash;
  const rockyId = TILE_TYPE_IDS.rocky;
  const bareId = TILE_TYPE_IDS.bare;
  const worldSeed = Math.floor(sample.worldSeed ?? 0);
  const output = new Float32Array(sampleCols * sampleRows * 3);
  const fastDryPreview =
    sample.fastUpdate === true &&
    !hasMaskCoverage(sample.oceanMask) &&
    !hasMaskCoverage(sample.riverMask);
  let minPreviewHeight = 0;
  let invPreviewHeightRange = 1;
  if (fastDryPreview) {
    minPreviewHeight = Number.POSITIVE_INFINITY;
    let maxPreviewHeight = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < sampleHeights.length; i += 1) {
      const height = sampleHeights[i] ?? 0;
      minPreviewHeight = Math.min(minPreviewHeight, height);
      maxPreviewHeight = Math.max(maxPreviewHeight, height);
    }
    if (!Number.isFinite(minPreviewHeight) || !Number.isFinite(maxPreviewHeight)) {
      minPreviewHeight = 0;
      maxPreviewHeight = 1;
    }
    invPreviewHeightRange = 1 / Math.max(0.001, maxPreviewHeight - minPreviewHeight);
  }

  for (let row = 0; row < sampleRows; row += 1) {
    const tileY = Math.min(rows - 1, row * step);
    for (let col = 0; col < sampleCols; col += 1) {
      const tileX = Math.min(cols - 1, col * step);
      const idx = tileY * cols + tileX;
      const sampleIndex = row * sampleCols + col;
      const typeId = sampleTypes[sampleIndex] ?? grassId;
      const debugScalar = debugScalarField ? debugScalarField[idx] : undefined;
      let colorType = typeId;
      const localOceanRatio = oceanRatio ? clamp(oceanRatio[sampleIndex] ?? 0, 0, 1) : typeId === waterId ? 1 : 0;
      const localRiverRatio = riverRatio ? clamp(riverRatio[sampleIndex] ?? 0, 0, 1) : 0;
      const rawErosionWear = sampledErosionWear ? sampledErosionWear[sampleIndex] : 0;
      const localErosionWear = Number.isFinite(rawErosionWear) ? clamp(rawErosionWear as number, 0, 1) : 0;
      const localRiverCoverage = sampledRiverCoverage ? clamp(sampledRiverCoverage[sampleIndex] ?? 0, 0, 1) : localRiverRatio;
      const localMoisture = tileMoisture ? clamp(tileMoisture[idx] ?? 0.5, 0, 1) : 0.5;
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

      if (!debugTypeColors && !debugScalarField) {
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
          colorType = riverDominant ? floodplainId : beachId;
        }
      }

      let color = deps.palette[colorType] ?? deps.palette[grassId] ?? [0, 0, 0];
      if (debugScalarField && Number.isFinite(debugScalar)) {
        color = scalarDebugColor(debugScalar as number);
      } else if (!debugTypeColors && !debugScalarField && roadId !== null && typeId === roadId) {
        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        let count = 0;
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            if (ox === 0 && oy === 0) {
              continue;
            }
            const nRow = row + oy;
            const nCol = col + ox;
            if (nRow < 0 || nCol < 0 || nRow >= sampleRows || nCol >= sampleCols) {
              continue;
            }
            const neighborType = sampleTypes[nRow * sampleCols + nCol];
            if (neighborType === roadId) {
              continue;
            }
            const source = neighborType === waterId
              ? deps.palette[grassId]
              : deps.palette[neighborType] ?? deps.palette[grassId];
            if (!source) {
              continue;
            }
            sumR += source[0];
            sumG += source[1];
            sumB += source[2];
            count += 1;
          }
        }
        if (count > 0) {
          color = [sumR / count, sumG / count, sumB / count];
        }
      }

      if (!debugTypeColors && !debugScalarField && typeId === forestId) {
        const dominantId = treeTypes ? treeTypes[idx] : 255;
        const tint = deps.forestTintById[dominantId] ?? deps.forestToneBase;
        const tintColor: [number, number, number] = [tint.r / 255, tint.g / 255, tint.b / 255];
        color = mixTriplet(color, tintColor, 0.55);
      }

      if (!debugTypeColors && !debugScalarField && typeId === ashId) {
        const ashNoise = sampleValueNoise(tileX + 0.5, tileY + 0.5, 12, worldSeed + 103);
        const ashCool = sampleValueNoise(tileX + 0.5, tileY + 0.5, 24, worldSeed + 151);
        const ashBase = 0.18 + ashNoise * 0.18;
        color = [
          ashBase * 0.95,
          ashBase * 0.93,
          ashBase * (1.0 + ashCool * 0.08)
        ];
      }

      if (!debugTypeColors && !debugScalarField && (typeId === grassId || typeId === scrubId || typeId === floodplainId || typeId === forestId)) {
        const localDryness = 1 - localMoisture;
        const effectiveDryness = clamp(climateDryness * 0.72 + localDryness * 0.28, 0, 1);
        const dryTint = DRY_TINT_BY_TILE[typeId] ?? DRY_TINT_BY_TILE[grassId];
        const wetTint = WET_TINT_BY_TILE[typeId] ?? WET_TINT_BY_TILE[grassId];
        const dryWeight =
          (typeId === grassId ? 0.58 : typeId === scrubId ? 0.62 : typeId === floodplainId ? 0.34 : 0.26) *
          effectiveDryness;
        const wetWeight = (typeId === floodplainId ? 0.18 : 0.08) * (1 - effectiveDryness);
        color = mixTriplet(color, dryTint, dryWeight);
        if (wetWeight > 0.0001) {
          color = mixTriplet(color, wetTint, wetWeight);
        }
      }

      if (!debugTypeColors && !debugScalarField && sample.tileFuel && (typeId === grassId || typeId === scrubId || typeId === floodplainId || typeId === forestId)) {
        const baseFuel = BASE_FUEL_BY_TILE_ID[typeId] ?? 0;
        if (baseFuel > 0) {
          const expectedFuel = Math.max(0.01, baseFuel * (1 - localMoisture * 0.6));
          const fuelNow = clamp(sample.tileFuel[idx] ?? expectedFuel, 0, expectedFuel);
          const fuelDepletion = clamp(1 - fuelNow / expectedFuel, 0, 1);
          const liveFire = clamp(sample.tileFire?.[idx] ?? 0, 0, 1);
          const liveHeat = clamp((sample.tileHeat?.[idx] ?? 0) / Math.max(0.01, sample.heatCap ?? 5), 0, 1);
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
          color = mixTriplet(color, SCORCH_WARM_TINT, warmMix);
          color = mixTriplet(color, SCORCH_CHAR_TINT, charMix);
        }
      }

      if (!debugTypeColors && !debugScalarField && typeId === waterId && localRiverRatio >= deps.riverRatioMin) {
        const rockyColor = deps.palette[rockyId] ?? color;
        const floodColor = deps.palette[floodplainId] ?? deps.palette[grassId] ?? color;
        const wetBankColor: [number, number, number] = [
          floodColor[0] * 0.72 + rockyColor[0] * 0.28,
          floodColor[1] * 0.76 + rockyColor[1] * 0.24,
          floodColor[2] * 0.8 + rockyColor[2] * 0.2
        ];
        const blend = clamp(localRiverRatio * 1.25 + localRiverCoverage * 0.35, 0, 0.9);
        const riverbedColor = mixTriplet(color, wetBankColor, blend);
        const rockyStepBlend = clamp(localStepStrength * deps.stepRockyTintMax, 0, deps.stepRockyTintMax);
        color = mixTriplet(riverbedColor, rockyColor, rockyStepBlend);
      }

      const height = heightAtSample(sampleHeights, sampleCols, sampleRows, col, row);
      const heightLeft = heightAtSample(sampleHeights, sampleCols, sampleRows, col - 1, row);
      const heightRight = heightAtSample(sampleHeights, sampleCols, sampleRows, col + 1, row);
      const heightUp = heightAtSample(sampleHeights, sampleCols, sampleRows, col, row - 1);
      const heightDown = heightAtSample(sampleHeights, sampleCols, sampleRows, col, row + 1);
      const neighborAverage = (heightLeft + heightRight + heightUp + heightDown) * 0.25;
      const curvature = neighborAverage - height;
      const dx = (heightRight - heightLeft) * heightScale;
      const dz = (heightDown - heightUp) * heightScale;
      const slope = Math.sqrt(dx * dx + dz * dz);
      const previewLightGradient =
        ((heightLeft - heightRight) * 0.95 + (heightDown - heightUp) * 0.65) * heightScale;

      if (
        !debugTypeColors &&
        !debugScalarField &&
        localErosionWear > 0.001 &&
        (
          typeId === grassId ||
          typeId === scrubId ||
          typeId === floodplainId ||
          typeId === forestId ||
          typeId === beachId ||
          typeId === rockyId ||
          typeId === bareId
        )
      ) {
        const rockyColor = deps.palette[rockyId] ?? color;
        const floodColor = deps.palette[floodplainId] ?? deps.palette[grassId] ?? color;
        const beachColor = deps.palette[beachId] ?? rockyColor;
        const gravelColor: [number, number, number] = [
          floodColor[0] * 0.38 + beachColor[0] * 0.42 + rockyColor[0] * 0.2,
          floodColor[1] * 0.42 + beachColor[1] * 0.34 + rockyColor[1] * 0.24,
          floodColor[2] * 0.44 + beachColor[2] * 0.26 + rockyColor[2] * 0.3
        ];
        const depositionalMask =
          localErosionWear *
          smoothstep(0.0015, 0.012, curvature) *
          (1 - smoothstep(0.11, 0.42, slope)) *
          (0.35 + localMoisture * 0.65);
        const shoulderMask =
          localErosionWear *
          smoothstep(0.1, 0.34, slope) *
          smoothstep(-0.012, 0.002, -curvature);
        color = mixTriplet(color, gravelColor, clamp(depositionalMask * 0.28, 0, 0.28));
        color = mixTriplet(color, rockyColor, clamp(shoulderMask * 0.34, 0, 0.34));
      }

      if (!debugTypeColors && !debugScalarField) {
        color = applyMacroVariation(color, tileX, tileY, worldSeed, typeId, floodplainId, forestId, beachId);
        const rockyColor = deps.palette[rockyId] ?? color;
        const bareColor = deps.palette[bareId] ?? rockyColor;
        color = applySlopeTint(color, slope, typeId, localMoisture, rockyColor, bareColor, beachId);
        if (fastDryPreview) {
          color = applyFastPreviewReliefContrast(
            color,
            height,
            minPreviewHeight,
            invPreviewHeightRange,
            slope,
            curvature,
            previewLightGradient,
            typeId,
            beachId
          );
        }
      }

      const linearColor = toLinearTriplet(color);
      const outBase = sampleIndex * 3;
      output[outBase] = linearColor[0];
      output[outBase + 1] = linearColor[1];
      output[outBase + 2] = linearColor[2];
    }
  }

  return output;
};
