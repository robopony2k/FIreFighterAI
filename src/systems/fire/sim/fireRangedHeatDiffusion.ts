import type { FireSettings } from "../../../core/types.js";
import { clamp } from "../../../core/utils.js";

export type RangedHeatTransferInput = {
  settings: FireSettings;
  sourceX: number;
  sourceY: number;
  dx: number;
  dy: number;
  distanceTiles: number;
  cols: number;
  rows: number;
  windDx: number;
  windDy: number;
  windStrength: number;
  heatRelease: number;
  weatherSpread: number;
  targetMoisture: number;
  windbreakFactor: Float32Array;
};

const finiteOr = (value: number | undefined, fallback: number): number =>
  Number.isFinite(value) ? Number(value) : fallback;

export const getWindAlignment = (windDx: number, windDy: number, dx: number, dy: number): number => {
  const windLength = Math.hypot(windDx, windDy);
  const dirLength = Math.hypot(dx, dy);
  if (windLength <= 0.0001 || dirLength <= 0.0001) {
    return 0;
  }
  return clamp((windDx / windLength) * (dx / dirLength) + (windDy / windLength) * (dy / dirLength), -1, 1);
};

export const getPathWindbreakMultiplier = (
  sourceX: number,
  sourceY: number,
  dx: number,
  dy: number,
  distanceTiles: number,
  cols: number,
  rows: number,
  windbreakFactor: Float32Array,
  settings: FireSettings
): number => {
  const obstructionStrength = clamp(finiteOr(settings.rangedDiffusionObstructionStrength, 0.72), 0, 1);
  if (obstructionStrength <= 0 || distanceTiles <= 1) {
    return 1;
  }

  let strongestBlocker = 0;
  for (let step = 1; step < distanceTiles; step += 1) {
    const x = sourceX + dx * step;
    const y = sourceY + dy * step;
    if (x < 0 || y < 0 || x >= cols || y >= rows) {
      strongestBlocker = 1;
      break;
    }
    const idx = y * cols + x;
    strongestBlocker = Math.max(strongestBlocker, clamp(windbreakFactor[idx] ?? 0, 0, 1));
  }

  return clamp(1 - strongestBlocker * obstructionStrength, 0.08, 1);
};

export const getRangedHeatTransferScale = (input: RangedHeatTransferInput): number => {
  const settings = input.settings;
  const distance = Math.max(1, Math.floor(input.distanceTiles));
  const maxTiles = Math.max(1, Math.floor(finiteOr(settings.rangedDiffusionMaxTiles, 1)));
  if (distance < 2 || distance > maxTiles || input.heatRelease <= 0) {
    return 0;
  }

  const windThreshold = Math.max(0.0001, finiteOr(settings.rangedDiffusionWindThreshold, 0.55));
  const windStrength = Math.max(0, input.windStrength);
  if (windStrength < windThreshold) {
    return 0;
  }

  const alignment = getWindAlignment(input.windDx, input.windDy, input.dx, input.dy);
  const alignmentThreshold = clamp(finiteOr(settings.rangedDiffusionAlignmentThreshold, 0.35), -1, 1);
  if (alignment < alignmentThreshold) {
    return 0;
  }

  const heatThreshold = Math.max(0.0001, finiteOr(settings.rangedDiffusionHeatThreshold, 0.26));
  if (input.heatRelease < heatThreshold) {
    return 0;
  }

  const weatherThreshold = Math.max(0.0001, finiteOr(settings.rangedDiffusionWeatherThreshold, 1.08));
  if (input.weatherSpread < weatherThreshold) {
    return 0;
  }

  const pathMultiplier = getPathWindbreakMultiplier(
    input.sourceX,
    input.sourceY,
    input.dx,
    input.dy,
    distance,
    input.cols,
    input.rows,
    input.windbreakFactor,
    settings
  );
  const alignmentDrive = clamp((alignment - alignmentThreshold) / Math.max(0.0001, 1 - alignmentThreshold), 0, 1);
  const dryTarget = clamp(1 - input.targetMoisture * 0.55, 0.2, 1);
  const drive =
    (input.heatRelease / heatThreshold) *
    (windStrength / windThreshold) *
    alignmentDrive *
    (input.weatherSpread / weatherThreshold) *
    dryTarget *
    pathMultiplier;
  const distanceThreshold =
    distance >= 3
      ? Math.max(0.0001, finiteOr(settings.rangedDiffusionThreeTileThreshold, 1.08))
      : Math.max(0.0001, finiteOr(settings.rangedDiffusionTwoTileThreshold, 0.62));
  if (drive < distanceThreshold) {
    return 0;
  }

  const falloff = clamp(finiteOr(settings.rangedDiffusionDistanceFalloff, 0.42), 0.01, 1);
  const gate = clamp((drive - distanceThreshold) / Math.max(0.0001, distanceThreshold * 1.4), 0, 1);
  return gate * Math.pow(falloff, distance - 2) * pathMultiplier;
};
