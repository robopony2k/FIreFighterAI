import { clamp } from "../../../core/utils.js";
import type { Wind } from "../../../core/types.js";
import type { FireWeatherResponse } from "../../../sim/fire/fireWeather.js";
import type { FireSimLabEnvironment } from "../types/fireSimLabTypes.js";

export const getWindFromFireSimLabEnvironment = (environment: FireSimLabEnvironment): Wind => {
  const radians = (environment.windDirectionDeg * Math.PI) / 180;
  return {
    name: `${Math.round(environment.windDirectionDeg)} deg`,
    dx: Math.sin(radians),
    dy: -Math.cos(radians),
    strength: environment.windStrength
  };
};

export const createFireSimLabWeather = (environment: FireSimLabEnvironment): FireWeatherResponse => {
  const risk = clamp(environment.climateRisk, 0, 1);
  const dry = clamp(1 - environment.moisture, 0, 1);
  const hot = clamp((environment.temperatureC - 18) / 24, 0, 1);
  const severity = clamp(risk * 0.45 + dry * 0.35 + hot * 0.2, 0, 1);
  return {
    careerDay: 0,
    climateDayOfYear: 220,
    climateYearIndex: 0,
    climateRisk: risk,
    climateTemp: environment.temperatureC,
    climateMoisture: environment.moisture,
    climateIgnitionMultiplier: 0.45 + severity * 1.35,
    climateSpreadMultiplier: 0.55 + severity * 1.45,
    seasonIndex: 2,
    ignition: 0.25 + severity * 1.15,
    spread: 0.45 + severity * 1.05,
    sustain: 0.45 + severity * 0.75,
    cooling: 1.85 - severity,
    suppression: 1.1 - severity * 0.16,
    effectiveAmbient: environment.temperatureC
  };
};
