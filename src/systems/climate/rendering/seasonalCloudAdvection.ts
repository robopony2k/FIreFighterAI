import { u01 } from "../../../core/climate.js";
import { generateWorldClimateSeed } from "../sim/worldClimateSeed.js";

const DAYS_PER_YEAR = 360;
const TAU = Math.PI * 2;

const hash01 = (seed: number, salt: number): number => {
  const value = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
};

export type SeasonalCloudAdvectionInput = {
  careerDay: number;
  weatherSeed: number;
  worldSeed?: number;
  nearDriftPerDay: number;
  farDriftPerDay: number;
};

export type SeasonalCloudAdvectionState = {
  nearX: number;
  nearY: number;
  farX: number;
  farY: number;
  morphTimeDays: number;
};

export const createSeasonalCloudAdvectionState = (): SeasonalCloudAdvectionState => ({
  nearX: 0,
  nearY: 0,
  farX: 0,
  farY: 0,
  morphTimeDays: 0
});

/**
 * Integrates the prevailing and seasonal components of gameplay wind.
 *
 * The bounded short-term gust component remains a gameplay-wind detail; omitting
 * it here avoids either storing render state or reprojecting historical travel.
 */
export const sampleSeasonalCloudAdvectionInto = (
  input: SeasonalCloudAdvectionInput,
  output: SeasonalCloudAdvectionState
): SeasonalCloudAdvectionState => {
  const careerDay = Math.max(0, input.careerDay);
  const stableSeed = input.worldSeed ?? input.weatherSeed;
  const climate = generateWorldClimateSeed(stableSeed);
  const directionX = Math.cos(climate.prevailingWindAngleRad);
  const directionY = Math.sin(climate.prevailingWindAngleRad);
  const crosswindX = -directionY;
  const crosswindY = directionX;
  const seasonalOffset = u01(stableSeed, 9029) * TAU - Math.PI;
  const angularRate = TAU / DAYS_PER_YEAR;
  const initialPhase = angularRate + seasonalOffset;
  const currentPhase = (careerDay + 1) * angularRate + seasonalOffset;
  const crosswindDays =
    climate.prevailingWindVariability *
    (Math.cos(initialPhase) - Math.cos(currentPhase)) /
    angularRate;
  const longitudinalDays =
    careerDay * (1 - climate.prevailingWindVariability ** 2 * 0.22);
  const travelScale = 0.72 + climate.prevailingWindStrength * 0.48;
  const seedX = hash01(stableSeed, 41.19) * 0.74;
  const seedY = hash01(stableSeed, 73.57) * 0.74;
  const travelX =
    (directionX * longitudinalDays + crosswindX * crosswindDays) * travelScale;
  const travelY =
    (directionY * longitudinalDays + crosswindY * crosswindDays) * travelScale;

  output.nearX = seedX - travelX * input.nearDriftPerDay;
  output.nearY = seedY - travelY * input.nearDriftPerDay;
  output.farX = seedX * 0.61 - travelX * input.farDriftPerDay + 0.19;
  output.farY = seedY * 0.61 - travelY * input.farDriftPerDay - 0.11;
  output.morphTimeDays = careerDay + hash01(stableSeed, 95.83) * 23;
  return output;
};

export const sampleSeasonalCloudAdvection = (
  input: SeasonalCloudAdvectionInput
): SeasonalCloudAdvectionState =>
  sampleSeasonalCloudAdvectionInto(input, createSeasonalCloudAdvectionState());
