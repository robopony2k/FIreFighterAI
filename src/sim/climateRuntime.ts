import { clamp, CLIMATE_IGNITION_MAX, CLIMATE_IGNITION_MIN } from "../core/climate.js";
import type { WorldState } from "../core/state.js";

const CLIMATE_SPREAD_BASE = 0.6;
const CLIMATE_SPREAD_RANGE = 1.4;
const CLIMATE_RISK_WEIGHT_IGNITION = 0.55;
const CLIMATE_RISK_WEIGHT_SPREAD = 0.45;

export const getClimateRisk = (state: WorldState): number => {
  const ignitionRange = Math.max(0.0001, CLIMATE_IGNITION_MAX - CLIMATE_IGNITION_MIN);
  const ignitionNorm = clamp((state.climateIgnitionMultiplier - CLIMATE_IGNITION_MIN) / ignitionRange, 0, 1);
  const spreadNorm = clamp((state.climateSpreadMultiplier - CLIMATE_SPREAD_BASE) / CLIMATE_SPREAD_RANGE, 0, 1);
  return clamp(
    CLIMATE_RISK_WEIGHT_IGNITION * ignitionNorm + CLIMATE_RISK_WEIGHT_SPREAD * spreadNorm,
    0,
    1
  );
};

export const advanceCareerDay = (
  state: WorldState,
  calendarDelta: number,
  phaseYearDays: number,
  virtualYearDays: number,
  careerTotalDays: number
): void => {
  if (!Number.isFinite(calendarDelta) || calendarDelta <= 0) {
    return;
  }
  const scale = phaseYearDays > 0 ? virtualYearDays / phaseYearDays : 1;
  state.careerDay = Math.min(state.careerDay + calendarDelta * scale, careerTotalDays);
};
