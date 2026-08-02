import { getSeasonalAtmosphereWeights } from "./seasonalAtmosphereVisualState.js";

export type SeasonalCloudProfile = {
  baseHeight: number;
  topHeight: number;
  cumulus01: number;
  footprintScale: number;
  volumeScale: number;
  erosionStrength: number;
  shadowStrength: number;
  footprintThresholdBias: number;
};

type CloudProfileInput = {
  seasonT01: number;
  stormIntensity01: number;
};

const WINTER_PROFILE: SeasonalCloudProfile = {
  baseHeight: 1.05,
  topHeight: 4.05,
  cumulus01: 0.18,
  footprintScale: 0.72,
  volumeScale: 0.9,
  erosionStrength: 0.42,
  shadowStrength: 0.92,
  footprintThresholdBias: -0.02
};

const SPRING_PROFILE: SeasonalCloudProfile = {
  baseHeight: 1.55,
  topHeight: 4.45,
  cumulus01: 0.82,
  footprintScale: 0.86,
  volumeScale: 1.08,
  erosionStrength: 0.72,
  shadowStrength: 0.48,
  footprintThresholdBias: -0.045
};

const SUMMER_PROFILE: SeasonalCloudProfile = {
  baseHeight: 1.65,
  topHeight: 4.65,
  cumulus01: 0.96,
  footprintScale: 0.8,
  volumeScale: 1.12,
  erosionStrength: 0.78,
  shadowStrength: 0.42,
  footprintThresholdBias: 0.015
};

const AUTUMN_PROFILE: SeasonalCloudProfile = {
  baseHeight: 1.35,
  topHeight: 3.75,
  cumulus01: 0.42,
  footprintScale: 0.8,
  volumeScale: 0.98,
  erosionStrength: 0.56,
  shadowStrength: 0.66,
  footprintThresholdBias: 0.025
};

const STORM_PROFILE: SeasonalCloudProfile = {
  baseHeight: 0.85,
  topHeight: 3.95,
  cumulus01: 0.08,
  footprintScale: 0.66,
  volumeScale: 0.86,
  erosionStrength: 0.3,
  shadowStrength: 1,
  footprintThresholdBias: -0.04
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp01((value - edge0) / Math.max(0.0001, edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const blendProfile = (
  a: SeasonalCloudProfile,
  b: SeasonalCloudProfile,
  t: number
): SeasonalCloudProfile => ({
  baseHeight: lerp(a.baseHeight, b.baseHeight, t),
  topHeight: lerp(a.topHeight, b.topHeight, t),
  cumulus01: lerp(a.cumulus01, b.cumulus01, t),
  footprintScale: lerp(a.footprintScale, b.footprintScale, t),
  volumeScale: lerp(a.volumeScale, b.volumeScale, t),
  erosionStrength: lerp(a.erosionStrength, b.erosionStrength, t),
  shadowStrength: lerp(a.shadowStrength, b.shadowStrength, t),
  footprintThresholdBias: lerp(
    a.footprintThresholdBias,
    b.footprintThresholdBias,
    t
  )
});

export const sampleSeasonalCloudProfile = (
  input: CloudProfileInput
): SeasonalCloudProfile => {
  const season = getSeasonalAtmosphereWeights(input.seasonT01);
  const seasonalProfile: SeasonalCloudProfile = {
    baseHeight:
      WINTER_PROFILE.baseHeight * season.winter +
      SPRING_PROFILE.baseHeight * season.spring +
      SUMMER_PROFILE.baseHeight * season.summer +
      AUTUMN_PROFILE.baseHeight * season.autumn,
    topHeight:
      WINTER_PROFILE.topHeight * season.winter +
      SPRING_PROFILE.topHeight * season.spring +
      SUMMER_PROFILE.topHeight * season.summer +
      AUTUMN_PROFILE.topHeight * season.autumn,
    cumulus01:
      WINTER_PROFILE.cumulus01 * season.winter +
      SPRING_PROFILE.cumulus01 * season.spring +
      SUMMER_PROFILE.cumulus01 * season.summer +
      AUTUMN_PROFILE.cumulus01 * season.autumn,
    footprintScale:
      WINTER_PROFILE.footprintScale * season.winter +
      SPRING_PROFILE.footprintScale * season.spring +
      SUMMER_PROFILE.footprintScale * season.summer +
      AUTUMN_PROFILE.footprintScale * season.autumn,
    volumeScale:
      WINTER_PROFILE.volumeScale * season.winter +
      SPRING_PROFILE.volumeScale * season.spring +
      SUMMER_PROFILE.volumeScale * season.summer +
      AUTUMN_PROFILE.volumeScale * season.autumn,
    erosionStrength:
      WINTER_PROFILE.erosionStrength * season.winter +
      SPRING_PROFILE.erosionStrength * season.spring +
      SUMMER_PROFILE.erosionStrength * season.summer +
      AUTUMN_PROFILE.erosionStrength * season.autumn,
    shadowStrength:
      WINTER_PROFILE.shadowStrength * season.winter +
      SPRING_PROFILE.shadowStrength * season.spring +
      SUMMER_PROFILE.shadowStrength * season.summer +
      AUTUMN_PROFILE.shadowStrength * season.autumn,
    footprintThresholdBias:
      WINTER_PROFILE.footprintThresholdBias * season.winter +
      SPRING_PROFILE.footprintThresholdBias * season.spring +
      SUMMER_PROFILE.footprintThresholdBias * season.summer +
      AUTUMN_PROFILE.footprintThresholdBias * season.autumn
  };
  const stormBlend = smoothstep(0.38, 0.88, clamp01(input.stormIntensity01));
  return blendProfile(seasonalProfile, STORM_PROFILE, stormBlend);
};
