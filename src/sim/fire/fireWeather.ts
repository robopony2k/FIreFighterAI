import {
  ambientTemp,
  clamp,
  CLIMATE_IGNITION_MAX,
  CLIMATE_IGNITION_MIN,
  DEFAULT_MOISTURE_PARAMS,
  VIRTUAL_CLIMATE_PARAMS
} from "../../core/climate.js";
import { FIRE_WEATHER_BURNOUT_RISK } from "../../core/config.js";
import type { WorldState } from "../../core/state.js";

type SeasonBand = {
  ignition: [number, number];
  spread: [number, number];
  sustain: [number, number];
  cooling: [number, number];
  suppression: [number, number];
};

export interface FireClimateSample {
  careerDay: number;
  climateDayOfYear: number;
  climateYearIndex: number;
  climateRisk: number;
  climateTemp: number;
  climateMoisture: number;
  climateIgnitionMultiplier: number;
  climateSpreadMultiplier: number;
  seasonIndex: number;
}

export interface FireWeatherResponse extends FireClimateSample {
  ignition: number;
  spread: number;
  sustain: number;
  cooling: number;
  suppression: number;
  effectiveAmbient: number;
}

const SEASON_COUNT = 4;
const YEAR_DAYS = Math.max(1, Math.floor(VIRTUAL_CLIMATE_PARAMS.seasonLen));
const EPSILON = 0.0001;

const SEASON_BANDS: SeasonBand[] = [
  {
    ignition: [0, 0.1],
    spread: [0.15, 0.25],
    sustain: [0.15, 0.25],
    cooling: [2.0, 3.0],
    suppression: [1.05, 1.15]
  },
  {
    ignition: [0.4, 0.55],
    spread: [0.65, 0.8],
    sustain: [0.7, 0.8],
    cooling: [1.2, 1.4],
    suppression: [1.0, 1.05]
  },
  {
    ignition: [1.15, 1.35],
    spread: [1.15, 1.3],
    sustain: [1.05, 1.15],
    cooling: [0.85, 1.0],
    suppression: [0.95, 1.0]
  },
  {
    ignition: [0.45, 0.6],
    spread: [0.7, 0.85],
    sustain: [0.65, 0.8],
    cooling: [1.25, 1.45],
    suppression: [1.0, 1.05]
  }
];

const clamp01 = (value: number): number => clamp(value, 0, 1);
const lerp = (min: number, max: number, t: number): number => min + (max - min) * t;

const getTimelineRisk = (state: WorldState, dayIndex: number): number => {
  const timeline = state.climateTimeline;
  if (!timeline || timeline.totalDays <= 0) {
    const fallback = clamp01((state.climateSpreadMultiplier - 0.6) / 1.4);
    return fallback;
  }
  const clampedIndex = clamp(dayIndex, 0, Math.max(0, timeline.totalDays - 1));
  return clamp01(timeline.risk[clampedIndex] ?? 0);
};

export const getClimateSeasonIndexForCareerDay = (careerDay: number): number => {
  const wrapped = ((Math.floor(careerDay) % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;
  const seasonLength = Math.max(1, Math.floor(YEAR_DAYS / SEASON_COUNT));
  return Math.min(SEASON_COUNT - 1, Math.floor(wrapped / seasonLength));
};

export const sampleFireClimate = (state: WorldState, careerDay: number): FireClimateSample => {
  const timelineTotalDays = state.climateTimeline?.totalDays ?? YEAR_DAYS;
  const clampedCareerDay = clamp(careerDay, 0, Math.max(0, timelineTotalDays - EPSILON));
  const dayIndex = Math.max(0, Math.floor(clampedCareerDay));
  const dayOfYear = (dayIndex % YEAR_DAYS) + 1;
  const yearIndex = Math.floor(dayIndex / YEAR_DAYS);
  const climateRisk = getTimelineRisk(state, dayIndex);
  const climateTemp = ambientTemp(dayOfYear, yearIndex, state.seed, VIRTUAL_CLIMATE_PARAMS);
  const climateMoisture = DEFAULT_MOISTURE_PARAMS.Mmin + (DEFAULT_MOISTURE_PARAMS.Mmax - DEFAULT_MOISTURE_PARAMS.Mmin) * (1 - climateRisk);
  const climateIgnitionMultiplier = CLIMATE_IGNITION_MIN + (CLIMATE_IGNITION_MAX - CLIMATE_IGNITION_MIN) * climateRisk;
  const climateSpreadMultiplier = 0.6 + climateRisk * 1.4;
  return {
    careerDay: clampedCareerDay,
    climateDayOfYear: dayOfYear,
    climateYearIndex: yearIndex,
    climateRisk,
    climateTemp,
    climateMoisture,
    climateIgnitionMultiplier,
    climateSpreadMultiplier,
    seasonIndex: getClimateSeasonIndexForCareerDay(clampedCareerDay)
  };
};

export const buildFireWeatherResponse = (sample: FireClimateSample): FireWeatherResponse => {
  const band = SEASON_BANDS[sample.seasonIndex] ?? SEASON_BANDS[1];
  const warmBias = clamp01((sample.climateTemp - 20) / 16);
  const coolBias = clamp01((24 - sample.climateTemp) / 10);
  const bandT = clamp01(sample.climateRisk * 0.85 + warmBias * 0.15);
  const ignition = lerp(band.ignition[0], band.ignition[1], bandT);
  const spread = lerp(band.spread[0], band.spread[1], bandT);
  const sustain = lerp(band.sustain[0], band.sustain[1], bandT);
  const cooling = lerp(band.cooling[0], band.cooling[1], clamp01(sample.climateRisk * 0.8 + coolBias * 0.2));
  const suppression = lerp(band.suppression[0], band.suppression[1], clamp01((1 - sample.climateRisk) * 0.75 + coolBias * 0.25));
  let effectiveAmbient = sample.climateTemp;
  if (sample.seasonIndex === 0) {
    const overnightOffset = 8 + (1 - sample.climateRisk) * 6 + coolBias * 2;
    effectiveAmbient -= overnightOffset;
  }
  return {
    ...sample,
    ignition,
    spread,
    sustain,
    cooling,
    suppression,
    effectiveAmbient
  };
};

export const sampleFireWeatherResponse = (state: WorldState, careerDay: number): FireWeatherResponse =>
  buildFireWeatherResponse(sampleFireClimate(state, careerDay));

export const getBurnoutFactorForRisk = (climateRisk: number): number =>
  climateRisk < FIRE_WEATHER_BURNOUT_RISK
    ? clamp(1 - climateRisk / Math.max(EPSILON, FIRE_WEATHER_BURNOUT_RISK), 0, 1)
    : 0;

export const getAdaptiveFireSubstepMax = (
  activeFires: number,
  scheduledCount: number,
  fireBoundsActive: boolean,
  climateRisk: number
): number => {
  if (activeFires > 0) {
    return climateRisk >= 0.4 ? 0.125 : 0.25;
  }
  if (scheduledCount > 0 || fireBoundsActive) {
    return 0.5;
  }
  return 0.5;
};
