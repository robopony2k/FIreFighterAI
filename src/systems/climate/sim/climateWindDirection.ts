import { VIRTUAL_CLIMATE_PARAMS, u01 } from "../../../core/climate.js";
import { clamp } from "../../../core/utils.js";
import { generateWorldClimateSeed } from "./worldClimateSeed.js";

const TAU = Math.PI * 2;

export type ClimateWindDirection = {
  angleRad: number;
  dx: number;
  dy: number;
};

export const sampleClimateWindNoise = (
  x: number,
  y: number,
  seedValue: number
): number => {
  let hash = x * 374761393 + y * 668265263 + seedValue * 1447;
  hash = (hash ^ (hash >>> 13)) >>> 0;
  hash = Math.imul(hash, 1274126177);
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return hash / 4294967296;
};

export const sampleClimateWindDirection = (
  worldSeed: number,
  dayOfYear: number,
  yearIndex: number
): ClimateWindDirection => {
  const climateSeed = generateWorldClimateSeed(worldSeed);
  const yearDays = Math.max(1, Math.floor(VIRTUAL_CLIMATE_PARAMS.seasonLen));
  const dayPhase = (dayOfYear / yearDays) * TAU;
  const seasonalOffset = u01(worldSeed, 9029) * TAU - Math.PI;
  const variability = clamp(climateSeed.prevailingWindVariability, 0, 0.75);
  const seasonalDrift = Math.sin(dayPhase + seasonalOffset) * variability;
  const driftBucket = Math.floor(dayOfYear / 12);
  const driftNoise =
    (sampleClimateWindNoise(driftBucket, yearIndex, worldSeed + 731) * 2 - 1) *
    variability *
    0.42;
  const angleRad = climateSeed.prevailingWindAngleRad + seasonalDrift + driftNoise;

  return {
    angleRad,
    dx: Math.cos(angleRad),
    dy: Math.sin(angleRad)
  };
};
