const TAU = Math.PI * 2;

export const SUMMER_MIDPOINT_T01 = 0.625;
export const EQUINOX_AZIMUTH_DEG = -100;

const ANALEMMA_BASE_ELEVATION_DEG = 36;
const ANALEMMA_AZIMUTH_BIAS_DEG = -3.5;
const DECLINATION_ELEVATION_SWING_DEG = 2.5;
const DECLINATION_LEAN_ELEVATION_SWING_DEG = -1.5;
const EQUATION_OF_TIME_ELEVATION_SWING_DEG = 2.5;
const SEASONAL_AZIMUTH_DRIFT_DEG = 17.5;
const DECLINATION_LEAN_AZIMUTH_SWING_DEG = 3.5;
const EQUATION_OF_TIME_AZIMUTH_SWING_DEG = 10;
const MIN_SUN_ELEVATION_DEG = 12;
const MAX_SUN_ELEVATION_DEG = 52;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const wrap01 = (value: number): number => ((value % 1) + 1) % 1;

export type SeasonalSunTrajectorySample = {
  sunAzimuthDeg: number;
  sunElevationDeg: number;
  summer01: number;
  winter01: number;
};

export const sampleSeasonalSunTrajectory = (seasonT01: number): SeasonalSunTrajectorySample => {
  const wrapped = wrap01(seasonT01);
  const phase = wrap01(wrapped - SUMMER_MIDPOINT_T01) * TAU;

  // The annual band keeps summer/winter elevation bias stable, while the
  // second harmonic adds the equation-of-time-style side-to-side loop.
  const declinationBand = Math.cos(phase);
  const declinationLean = Math.sin(phase);
  const equationOfTimeHarmonic = Math.cos(phase * 2);

  const summer01 = clamp((declinationBand + 1) * 0.5, 0, 1);
  const winter01 = clamp(1 - summer01, 0, 1);
  const sunElevationDeg = clamp(
    ANALEMMA_BASE_ELEVATION_DEG +
      declinationBand * DECLINATION_ELEVATION_SWING_DEG +
      declinationLean * DECLINATION_LEAN_ELEVATION_SWING_DEG +
      equationOfTimeHarmonic * EQUATION_OF_TIME_ELEVATION_SWING_DEG,
    MIN_SUN_ELEVATION_DEG,
    MAX_SUN_ELEVATION_DEG
  );
  const sunAzimuthDeg =
    EQUINOX_AZIMUTH_DEG +
    ANALEMMA_AZIMUTH_BIAS_DEG +
    declinationBand * SEASONAL_AZIMUTH_DRIFT_DEG +
    declinationLean * DECLINATION_LEAN_AZIMUTH_SWING_DEG +
    equationOfTimeHarmonic * EQUATION_OF_TIME_AZIMUTH_SWING_DEG;

  return {
    sunAzimuthDeg,
    sunElevationDeg,
    summer01,
    winter01
  };
};
