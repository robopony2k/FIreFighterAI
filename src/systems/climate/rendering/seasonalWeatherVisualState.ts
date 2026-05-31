export type SeasonalWeatherVisualInput = {
  careerDay: number;
  seasonT01: number;
  rainIntensity01?: number;
  rainSeed?: number;
  worldSeed?: number;
  windDx?: number;
  windDy?: number;
  windStrength?: number;
};

export type SeasonalWeatherVisualState = {
  cloudTimeDays: number;
  rainTimeSeconds: number;
  wetSeason01: number;
  stormIntensity01: number;
  windDirX: number;
  windDirY: number;
  windStrength01: number;
  weatherSeed: number;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const wrap01 = (value: number): number => ((value % 1) + 1) % 1;
const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp01((value - edge0) / Math.max(0.0001, edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const hashSeed = (seed: number): number => {
  let value = Number.isFinite(seed) ? Math.floor(seed) : 0;
  value = Math.imul(value ^ (value >>> 16), 2246822519);
  value = Math.imul(value ^ (value >>> 13), 3266489917);
  return (value ^ (value >>> 16)) >>> 0;
};

export const sampleSeasonalWeatherVisualState = (
  input: SeasonalWeatherVisualInput
): SeasonalWeatherVisualState => {
  const careerDay = Math.max(0, Number.isFinite(input.careerDay) ? input.careerDay : 0);
  const seasonT01 = wrap01(Number.isFinite(input.seasonT01) ? input.seasonT01 : 0);
  const rainIntensity01 = clamp01(input.rainIntensity01 ?? 0);
  const winter01 = clamp01(1 - smoothstep(0.08, 0.18, seasonT01) + smoothstep(0.88, 0.96, seasonT01));
  const spring01 = smoothstep(0.18, 0.28, seasonT01) * (1 - smoothstep(0.42, 0.52, seasonT01));
  const autumnWet01 = smoothstep(0.66, 0.76, seasonT01) * (1 - smoothstep(0.9, 0.98, seasonT01));
  const wetSeason01 = clamp01(winter01 * 0.86 + spring01 * 0.42 + autumnWet01 * 0.32);
  const stormIntensity01 = clamp01(rainIntensity01 * 0.92 + wetSeason01 * 0.34);

  const windDx = Number.isFinite(input.windDx) ? input.windDx ?? 0 : 0;
  const windDy = Number.isFinite(input.windDy) ? input.windDy ?? 0 : 0;
  const windLength = Math.hypot(windDx, windDy);
  const windDirX = windLength > 0.0001 ? windDx / windLength : 0.42;
  const windDirY = windLength > 0.0001 ? windDy / windLength : -0.91;
  const windStrength01 = clamp01(input.windStrength ?? 0);
  const weatherSeed = hashSeed((input.rainSeed ?? 0) ^ (input.worldSeed ?? 0));
  const seedPhase = (weatherSeed % 10000) / 10000;

  return {
    cloudTimeDays: careerDay + seedPhase * 23,
    rainTimeSeconds: careerDay * 46 + seedPhase * 19,
    wetSeason01,
    stormIntensity01,
    windDirX,
    windDirY,
    windStrength01,
    weatherSeed
  };
};
