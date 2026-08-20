import { ambientTemp, clamp, u01, VIRTUAL_CLIMATE_PARAMS } from "../../../core/climate.js";
import type { WorldState } from "../../../core/state.js";
import type { ConvectiveStormEvent, ConvectiveStormSample } from "../types/convectiveStormTypes.js";
import { sampleClimateWindDirection } from "./climateWindDirection.js";
import { generateWorldClimateSeed } from "./worldClimateSeed.js";

const YEAR_DAYS = Math.max(1, Math.floor(VIRTUAL_CLIMATE_PARAMS.seasonLen));
const STORM_SALT = 0x53544f52;
const timelineCache = new WeakMap<WorldState, Map<number, { seed: number; timelineSeed: number; events: ConvectiveStormEvent[] }>>();

const getRisk = (state: WorldState, day: number): number => {
  const timeline = state.climateTimeline;
  if (!timeline || timeline.totalDays <= 0) {
    return clamp((state.climateSpreadMultiplier - 0.6) / 1.4, 0, 1);
  }
  const index = clamp(Math.floor(day), 0, timeline.totalDays - 1);
  return clamp(timeline.risk[index] ?? 0, 0, 1);
};

export const buildConvectiveStormTimeline = (state: WorldState, yearIndex: number): ConvectiveStormEvent[] => {
  const events: ConvectiveStormEvent[] = [];
  const climateSeed = generateWorldClimateSeed(state.seed);
  const yearStart = yearIndex * YEAR_DAYS;
  let lastEnd = yearStart - 10;
  for (let dayOfYear = 1; dayOfYear <= YEAR_DAYS; dayOfYear += 1) {
    const day = yearStart + dayOfYear - 1;
    const risk = getRisk(state, day);
    const temperature = ambientTemp(dayOfYear, yearIndex, state.seed, VIRTUAL_CLIMATE_PARAMS);
    if (temperature < 24 || risk < 0.48 || day < lastEnd + 5) {
      continue;
    }
    const salt = STORM_SALT ^ Math.imul(yearIndex + 1, 4099) ^ Math.imul(dayOfYear, 131);
    const likelihood = 0.007 + Math.max(0, risk - 0.48) * 0.04 + Math.max(0, temperature - 28) * 0.0012;
    if (u01(state.seed, salt) >= likelihood) {
      continue;
    }
    const duration = 0.8 + u01(state.seed, salt + 1) * 1.8;
    const prevailingWind = sampleClimateWindDirection(state.seed, dayOfYear, yearIndex);
    const angle = prevailingWind.angleRad + (u01(state.seed, salt + 2) * 2 - 1) * 0.24;
    const travel = (0.1 + u01(state.seed, salt + 3) * 0.18) * (0.75 + climateSeed.prevailingWindStrength * 0.65);
    const startX = u01(state.seed, salt + 4);
    const startY = u01(state.seed, salt + 5);
    const event: ConvectiveStormEvent = {
      id: (yearIndex + 1) * 1000 + dayOfYear,
      seed: (state.seed ^ salt) >>> 0,
      startDay: day + u01(state.seed, salt + 6) * 0.65,
      endDay: day + duration,
      electricalIntensity: clamp(0.5 + risk * 0.35 + u01(state.seed, salt + 7) * 0.2, 0, 1),
      startX,
      startY,
      endX: clamp(startX + Math.cos(angle) * travel, 0, 1),
      endY: clamp(startY + Math.sin(angle) * travel, 0, 1),
      radiusX: 0.1 + u01(state.seed, salt + 8) * 0.16,
      radiusY: 0.07 + u01(state.seed, salt + 9) * 0.11,
      angle
    };
    event.endDay = Math.max(event.startDay + 0.25, event.endDay);
    events.push(event);
    lastEnd = event.endDay;
  }
  return events;
};

export const getConvectiveStormTimeline = (state: WorldState, yearIndex: number): ConvectiveStormEvent[] => {
  let stateCache = timelineCache.get(state);
  if (!stateCache) {
    stateCache = new Map();
    timelineCache.set(state, stateCache);
  }
  const cached = stateCache.get(yearIndex);
  if (cached && cached.seed === state.seed && cached.timelineSeed === state.climateTimelineSeed) {
    return cached.events;
  }
  const events = buildConvectiveStormTimeline(state, yearIndex);
  stateCache.set(yearIndex, { seed: state.seed, timelineSeed: state.climateTimelineSeed, events });
  return events;
};

export const sampleConvectiveStorm = (
  state: WorldState,
  day: number,
  events = getConvectiveStormTimeline(state, Math.floor(day / YEAR_DAYS))
): ConvectiveStormSample | null => {
  const event = events.find((candidate) => day >= candidate.startDay && day <= candidate.endDay);
  if (!event) {
    return null;
  }
  const progress = clamp((day - event.startDay) / Math.max(0.001, event.endDay - event.startDay), 0, 1);
  return {
    ...event,
    day,
    centerX: event.startX + (event.endX - event.startX) * progress,
    centerY: event.startY + (event.endY - event.startY) * progress,
    activeIntensity: event.electricalIntensity * Math.sin(Math.PI * Math.max(0.05, progress))
  };
};

export const findNextConvectiveStorm = (state: WorldState, afterDay: number): ConvectiveStormEvent | null => {
  const firstYear = Math.max(0, Math.floor(afterDay / YEAR_DAYS));
  for (let year = firstYear; year <= firstYear + 2; year += 1) {
    const event = getConvectiveStormTimeline(state, year).find((candidate) => candidate.endDay > afterDay);
    if (event) {
      return event;
    }
  }
  return null;
};
