import type { FireSettings } from "../../../core/types.js";
import { clamp } from "../../../core/utils.js";

export type TerrainAdjustedWind = {
  dx: number;
  dy: number;
  strength: number;
};

const finiteOr = (value: number | undefined, fallback: number): number =>
  Number.isFinite(value) ? Number(value) : fallback;

const sampleElevation = (
  elevation: Float32Array,
  x: number,
  y: number,
  dx: number,
  dy: number,
  cols: number,
  rows: number,
  fallback: number
): number => {
  const nx = x + dx;
  const ny = y + dy;
  if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
    return fallback;
  }
  const value = elevation[ny * cols + nx];
  return Number.isFinite(value) ? value : fallback;
};

export const getElevationHeatTransferMultiplier = (
  sourceElevation: number,
  targetElevation: number,
  distanceTiles: number,
  settings: FireSettings
): number => {
  const gain = Math.max(0, finiteOr(settings.elevationSpreadGain, 1.9));
  if (gain <= 0) {
    return 1;
  }
  const deadZone = Math.max(0, finiteOr(settings.elevationSpreadDeadZone, 0.008));
  const source = Number.isFinite(sourceElevation) ? sourceElevation : 0;
  const target = Number.isFinite(targetElevation) ? targetElevation : source;
  const distance = Math.max(1, distanceTiles || 1);
  const delta = (target - source) / distance;
  const magnitude = Math.max(0, Math.abs(delta) - deadZone);
  if (magnitude <= 0) {
    return 1;
  }
  if (delta > 0) {
    const maxBoost = Math.max(1, finiteOr(settings.elevationSpreadMaxBoost, 1.45));
    return clamp(1 + magnitude * gain, 1, maxBoost);
  }
  const maxPenalty = clamp(finiteOr(settings.elevationSpreadMaxPenalty, 0.72), 0.05, 1);
  return clamp(1 - magnitude * gain, maxPenalty, 1);
};

export const resolveTerrainAdjustedWind = (
  x: number,
  y: number,
  idx: number,
  cols: number,
  rows: number,
  elevation: Float32Array,
  windDx: number,
  windDy: number,
  windStrength: number,
  settings: FireSettings,
  out: TerrainAdjustedWind
): TerrainAdjustedWind => {
  out.dx = windDx;
  out.dy = windDy;
  out.strength = windStrength;

  if (windStrength <= 0) {
    return out;
  }

  const baseMagnitude = Math.hypot(windDx, windDy);
  if (baseMagnitude <= 0.0001) {
    return out;
  }

  const steerStrength = Math.max(0, finiteOr(settings.terrainWindSteerStrength, 0.34));
  const minSpeed = clamp(finiteOr(settings.terrainWindSpeedMin, 0.78), 0.05, 1);
  const maxSpeed = Math.max(1, finiteOr(settings.terrainWindSpeedMax, 1.22));
  const obstructionPenalty = Math.max(0, finiteOr(settings.terrainWindObstructionPenalty, 1.15));
  const funnelBonus = Math.max(0, finiteOr(settings.terrainWindFunnelBonus, 0.42));
  if (steerStrength <= 0 && obstructionPenalty <= 0 && funnelBonus <= 0) {
    return out;
  }

  const sourceElevation = Number.isFinite(elevation[idx]) ? elevation[idx] : 0;
  const dirX = windDx / baseMagnitude;
  const dirY = windDy / baseMagnitude;
  const stepX = dirX > 0.33 ? 1 : dirX < -0.33 ? -1 : 0;
  const stepY = dirY > 0.33 ? 1 : dirY < -0.33 ? -1 : 0;
  if (stepX === 0 && stepY === 0) {
    return out;
  }

  const leftX = -stepY;
  const leftY = stepX;
  const rightX = stepY;
  const rightY = -stepX;
  const downwindElevation = sampleElevation(elevation, x, y, stepX, stepY, cols, rows, sourceElevation);
  const leftElevation = sampleElevation(elevation, x, y, leftX, leftY, cols, rows, sourceElevation);
  const rightElevation = sampleElevation(elevation, x, y, rightX, rightY, cols, rows, sourceElevation);

  const downwindRise = downwindElevation - sourceElevation;
  const sideCorridorRise = Math.min(leftElevation - sourceElevation, rightElevation - sourceElevation);
  let speedMultiplier = 1;
  if (downwindRise > 0) {
    speedMultiplier -= downwindRise * obstructionPenalty;
  } else if (downwindRise < 0) {
    speedMultiplier += -downwindRise * funnelBonus * 0.5;
  }
  if (sideCorridorRise > 0) {
    speedMultiplier += sideCorridorRise * funnelBonus;
  }
  speedMultiplier = clamp(speedMultiplier, minSpeed, maxSpeed);

  const sideImbalance = leftElevation - rightElevation;
  const steerAmount = clamp(sideImbalance * steerStrength, -0.45, 0.45);
  let adjustedDirX = dirX - leftX * steerAmount;
  let adjustedDirY = dirY - leftY * steerAmount;
  const adjustedMagnitude = Math.hypot(adjustedDirX, adjustedDirY);
  if (adjustedMagnitude > 0.0001) {
    adjustedDirX = (adjustedDirX / adjustedMagnitude) * baseMagnitude;
    adjustedDirY = (adjustedDirY / adjustedMagnitude) * baseMagnitude;
  } else {
    adjustedDirX = windDx;
    adjustedDirY = windDy;
  }

  out.dx = adjustedDirX;
  out.dy = adjustedDirY;
  out.strength = windStrength * speedMultiplier;
  return out;
};
