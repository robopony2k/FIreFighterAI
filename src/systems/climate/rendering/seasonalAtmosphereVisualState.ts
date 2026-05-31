export type AtmosphereRgb = {
  r: number;
  g: number;
  b: number;
};

export type SeasonalAtmosphereVisualInput = {
  seasonT01: number;
  risk01?: number;
  rainIntensity01?: number;
  wetSeason01?: number;
  stormIntensity01?: number;
};

export type SeasonalAtmosphereVisualState = {
  clearSky01: number;
  wetSky01: number;
  stormMood01: number;
  cloudCoverage01: number;
  cloudSoftness01: number;
  cloudDensity01: number;
  skyTopColor: AtmosphereRgb;
  skyHorizonColor: AtmosphereRgb;
  cloudBrightColor: AtmosphereRgb;
  cloudShadowColor: AtmosphereRgb;
  oceanShallowColor: AtmosphereRgb;
  oceanDeepColor: AtmosphereRgb;
};

type SeasonWeights = {
  winter: number;
  spring: number;
  summer: number;
  autumn: number;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const wrap01 = (value: number): number => ((value % 1) + 1) % 1;
const rgb = (r: number, g: number, b: number): AtmosphereRgb => ({ r, g, b });
const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp01((value - edge0) / Math.max(0.0001, edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const wrappedDistance01 = (a: number, b: number): number => {
  const delta = Math.abs(wrap01(a) - wrap01(b));
  return Math.min(delta, 1 - delta);
};

const mixRgb = (a: AtmosphereRgb, b: AtmosphereRgb, t: number): AtmosphereRgb => {
  const clamped = clamp01(t);
  return {
    r: a.r + (b.r - a.r) * clamped,
    g: a.g + (b.g - a.g) * clamped,
    b: a.b + (b.b - a.b) * clamped
  };
};

const scaleRgb = (color: AtmosphereRgb, scale: number): AtmosphereRgb => ({
  r: color.r * scale,
  g: color.g * scale,
  b: color.b * scale
});

const blendSeasonRgb = (
  winter: AtmosphereRgb,
  spring: AtmosphereRgb,
  summer: AtmosphereRgb,
  autumn: AtmosphereRgb,
  weights: SeasonWeights
): AtmosphereRgb => {
  const weightSum = Math.max(0.0001, weights.winter + weights.spring + weights.summer + weights.autumn);
  return {
    r:
      winter.r * (weights.winter / weightSum) +
      spring.r * (weights.spring / weightSum) +
      summer.r * (weights.summer / weightSum) +
      autumn.r * (weights.autumn / weightSum),
    g:
      winter.g * (weights.winter / weightSum) +
      spring.g * (weights.spring / weightSum) +
      summer.g * (weights.summer / weightSum) +
      autumn.g * (weights.autumn / weightSum),
    b:
      winter.b * (weights.winter / weightSum) +
      spring.b * (weights.spring / weightSum) +
      summer.b * (weights.summer / weightSum) +
      autumn.b * (weights.autumn / weightSum)
  };
};

const blendSeasonNumber = (
  winter: number,
  spring: number,
  summer: number,
  autumn: number,
  weights: SeasonWeights
): number => {
  const weightSum = Math.max(0.0001, weights.winter + weights.spring + weights.summer + weights.autumn);
  return (
    winter * (weights.winter / weightSum) +
    spring * (weights.spring / weightSum) +
    summer * (weights.summer / weightSum) +
    autumn * (weights.autumn / weightSum)
  );
};

export const getSeasonalAtmosphereWeights = (seasonT01: number): SeasonWeights => {
  const t = wrap01(seasonT01);
  const seasonalBell = (center: number, radius: number): number => {
    const local = clamp01(1 - wrappedDistance01(t, center) / radius);
    return local * local * (3 - 2 * local);
  };
  const winter = seasonalBell(0.02, 0.28);
  const spring = seasonalBell(0.32, 0.26);
  const summer = seasonalBell(0.57, 0.26);
  const autumn = seasonalBell(0.79, 0.25);
  const total = Math.max(0.0001, winter + spring + summer + autumn);
  return {
    winter: winter / total,
    spring: spring / total,
    summer: summer / total,
    autumn: autumn / total
  };
};

export const sampleSeasonalAtmosphereVisualState = (
  input: SeasonalAtmosphereVisualInput
): SeasonalAtmosphereVisualState => {
  const season = getSeasonalAtmosphereWeights(input.seasonT01);
  const rainIntensity01 = clamp01(input.rainIntensity01 ?? 0);
  const wetSeason01 = clamp01(input.wetSeason01 ?? 0);
  const stormIntensity01 = clamp01(input.stormIntensity01 ?? 0);
  const clearSky01 = clamp01(season.summer * 0.95 + season.spring * 0.58 + season.autumn * 0.26 - stormIntensity01 * 0.72);
  const wetSky01 = clamp01(season.winter * 0.72 + season.autumn * 0.28 + season.spring * 0.16 + wetSeason01 * 0.32);
  const stormMood01 = Math.max(rainIntensity01, stormIntensity01);

  const seasonalCloudCoverage = blendSeasonNumber(0.54, 0.22, 0.045, 0.32, season);
  const cloudCoverage01 = clamp01(seasonalCloudCoverage + wetSeason01 * 0.055 + stormMood01 * 0.3);
  const cloudDensity01 = clamp01(0.08 + cloudCoverage01 * 0.62 + stormMood01 * 0.32);
  const cloudSoftness01 = clamp01(0.78 - cloudCoverage01 * 0.2 + stormMood01 * 0.16);

  const baseSkyTop = blendSeasonRgb(
    rgb(150, 160, 172),
    rgb(102, 170, 226),
    rgb(44, 145, 238),
    rgb(128, 154, 186),
    season
  );
  const baseSkyHorizon = blendSeasonRgb(
    rgb(198, 204, 212),
    rgb(188, 224, 240),
    rgb(138, 213, 248),
    rgb(216, 198, 172),
    season
  );
  const stormSkyTop = rgb(94, 108, 124);
  const stormSkyHorizon = rgb(144, 154, 164);
  const skyTopColor = mixRgb(baseSkyTop, stormSkyTop, clamp01(wetSky01 * 0.18 + stormMood01 * 0.48));
  const skyHorizonColor = mixRgb(baseSkyHorizon, stormSkyHorizon, clamp01(wetSky01 * 0.16 + stormMood01 * 0.42));

  const baseCloudBright = blendSeasonRgb(
    rgb(214, 216, 220),
    rgb(246, 246, 244),
    rgb(255, 253, 248),
    rgb(230, 224, 216),
    season
  );
  const baseCloudShadow = blendSeasonRgb(
    rgb(158, 164, 172),
    rgb(210, 216, 220),
    rgb(222, 229, 234),
    rgb(184, 176, 168),
    season
  );
  const cloudBrightColor = mixRgb(baseCloudBright, rgb(158, 164, 170), clamp01(stormMood01 * 0.42 + wetSky01 * 0.1));
  const cloudShadowColor = mixRgb(baseCloudShadow, rgb(78, 84, 92), clamp01(stormMood01 * 0.58 + wetSky01 * 0.18));

  const baseOceanShallow = blendSeasonRgb(
    rgb(72, 116, 146),
    rgb(58, 146, 190),
    rgb(48, 150, 210),
    rgb(80, 120, 142),
    season
  );
  const baseOceanDeep = blendSeasonRgb(
    rgb(38, 70, 98),
    rgb(24, 94, 132),
    rgb(20, 92, 142),
    rgb(42, 70, 86),
    season
  );
  const oceanGreyShallow = rgb(78, 98, 112);
  const oceanGreyDeep = rgb(34, 48, 58);
  const oceanStorm01 = clamp01(cloudCoverage01 * 0.42 + wetSky01 * 0.12 + stormMood01 * 0.52);
  const oceanShallowColor = mixRgb(scaleRgb(baseOceanShallow, 1 + clearSky01 * 0.08), oceanGreyShallow, oceanStorm01);
  const oceanDeepColor = mixRgb(scaleRgb(baseOceanDeep, 1 + clearSky01 * 0.05), oceanGreyDeep, oceanStorm01);

  return {
    clearSky01,
    wetSky01,
    stormMood01,
    cloudCoverage01,
    cloudSoftness01,
    cloudDensity01,
    skyTopColor,
    skyHorizonColor,
    cloudBrightColor,
    cloudShadowColor,
    oceanShallowColor,
    oceanDeepColor
  };
};
