import { clamp, u01, VIRTUAL_CLIMATE_PARAMS } from "../../../core/climate.js";
import type { ClimateForecastRainPeriod } from "../../../core/types.js";
import type { SeasonalRainEvent, SeasonalRainState } from "../types/seasonalRain.js";

export const SEASONAL_RAIN_EXTINGUISH_THRESHOLD = 0.72;

const SEASON_COUNT = 4;
const AUTUMN_SEASON_INDEX = 3;
const DEFAULT_YEAR_DAYS = Math.max(1, Math.floor(VIRTUAL_CLIMATE_PARAMS.seasonLen));
const MIN_DURATION_DAYS = 8;
const MAX_DURATION_DAYS = 12;
const MID_AUTUMN_JITTER_DAYS = 10;

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

const buildEventId = (worldSeed: number, yearIndex: number): string => `${worldSeed}:${yearIndex}:autumn-rain`;

export const createInactiveSeasonalRainState = (): SeasonalRainState => ({
  event: null,
  yearIndex: 0,
  dayOfYear: 1,
  intensity01: 0,
  visualIntensity01: 0,
  active: false,
  hasExtinguished: false,
  hasStartPauseHandled: false
});

export const buildSeasonalRainEvent = (
  worldSeed: number,
  yearIndex: number,
  yearDays = DEFAULT_YEAR_DAYS
): SeasonalRainEvent => {
  const seasonLength = Math.max(1, Math.floor(yearDays / SEASON_COUNT));
  const autumnStart = AUTUMN_SEASON_INDEX * seasonLength + 1;
  const autumnEnd = yearDays;
  const autumnMid = Math.round((autumnStart + autumnEnd) * 0.5);
  const seedBase = Math.imul(yearIndex + 1, 7919);
  const jitter = Math.round((u01(worldSeed, 46001 + seedBase) * 2 - 1) * MID_AUTUMN_JITTER_DAYS);
  const duration = MIN_DURATION_DAYS + Math.floor(u01(worldSeed, 46017 + seedBase) * (MAX_DURATION_DAYS - MIN_DURATION_DAYS + 1));
  const halfDuration = duration * 0.5;
  const peak = clamp(autumnMid + jitter, autumnStart + Math.ceil(halfDuration), autumnEnd - Math.ceil(halfDuration));
  const start = Math.max(autumnStart, Math.round(peak - halfDuration));
  const end = Math.min(autumnEnd, start + duration);
  const safePeak = clamp(peak, start + 1, Math.max(start + 1, end - 1));

  return {
    id: buildEventId(worldSeed, yearIndex),
    yearIndex,
    seed: Math.floor(u01(worldSeed, 46031 + seedBase) * 0x7fffffff),
    startDayOfYear: start,
    peakDayOfYear: safePeak,
    extinguishDayOfYear: safePeak,
    endDayOfYear: end,
    durationDays: Math.max(1, end - start)
  };
};

export const sampleSeasonalRainEvent = (event: SeasonalRainEvent, dayOfYear: number): { intensity01: number; active: boolean } => {
  if (dayOfYear < event.startDayOfYear || dayOfYear > event.endDayOfYear) {
    return { intensity01: 0, active: false };
  }

  const fadeIn = smoothstep(event.startDayOfYear, event.peakDayOfYear, dayOfYear);
  const fadeOut = 1 - smoothstep(event.peakDayOfYear, event.endDayOfYear, dayOfYear);
  const intensity01 = clamp(Math.min(fadeIn, fadeOut) * 1.18, 0, 1);
  return {
    intensity01,
    active: intensity01 > 0.001
  };
};

export const sampleSeasonalRainState = (
  worldSeed: number,
  careerDay: number,
  previous: SeasonalRainState | null = null,
  yearDays = DEFAULT_YEAR_DAYS
): SeasonalRainState => {
  const safeCareerDay = Math.max(0, careerDay);
  const dayIndex = Math.floor(safeCareerDay);
  const yearIndex = Math.floor(dayIndex / yearDays);
  const dayOfYear = (dayIndex % yearDays) + 1;
  const event = buildSeasonalRainEvent(worldSeed, yearIndex, yearDays);
  const sample = sampleSeasonalRainEvent(event, dayOfYear);
  const sameEvent = previous?.event?.id === event.id;
  const hasExtinguished = sameEvent ? previous.hasExtinguished : false;
  const hasStartPauseHandled = sameEvent ? previous.hasStartPauseHandled : false;

  return {
    event,
    yearIndex,
    dayOfYear,
    intensity01: sample.intensity01,
    visualIntensity01: sample.active ? sample.intensity01 : 0,
    active: sample.active,
    hasExtinguished,
    hasStartPauseHandled
  };
};

export const buildSeasonalRainForecastPeriods = (
  worldSeed: number,
  windowStartDay: number,
  windowDays: number,
  yearDays = DEFAULT_YEAR_DAYS
): ClimateForecastRainPeriod[] => {
  const safeWindowStart = Math.max(0, Math.floor(windowStartDay));
  const safeWindowDays = Math.max(0, Math.floor(windowDays));
  if (safeWindowDays <= 0) {
    return [];
  }
  const safeYearDays = Math.max(1, Math.floor(yearDays));
  const windowEndDay = safeWindowStart + safeWindowDays;
  const firstYearIndex = Math.floor(safeWindowStart / safeYearDays);
  const lastYearIndex = Math.floor(Math.max(safeWindowStart, windowEndDay - 1) / safeYearDays);
  const periods: ClimateForecastRainPeriod[] = [];
  for (let yearIndex = firstYearIndex; yearIndex <= lastYearIndex; yearIndex += 1) {
    const event = buildSeasonalRainEvent(worldSeed, yearIndex, safeYearDays);
    const yearStartDay = yearIndex * safeYearDays;
    const startDay = yearStartDay + event.startDayOfYear - 1;
    const peakDay = yearStartDay + event.peakDayOfYear - 1;
    const endDay = yearStartDay + event.endDayOfYear;
    if (startDay >= windowEndDay || endDay <= safeWindowStart) {
      continue;
    }
    periods.push({
      eventId: event.id,
      yearIndex,
      startDay,
      peakDay,
      endDay
    });
  }
  return periods;
};
