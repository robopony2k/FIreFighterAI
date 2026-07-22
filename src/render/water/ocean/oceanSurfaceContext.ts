export type OceanSurfaceContextInput = {
  windDx?: number;
  windDy?: number;
  windStrength01?: number;
  rainIntensity01?: number;
};

export type OceanSurfaceContext = {
  windDirX: number;
  windDirY: number;
  waveEnergy01: number;
  foamEnergy01: number;
  shallowClarity01: number;
  rainIntensity01: number;
};

const FALLBACK_WIND_X = 0.42;
const FALLBACK_WIND_Y = -0.91;
const FALLBACK_WIND_LENGTH = Math.hypot(FALLBACK_WIND_X, FALLBACK_WIND_Y);

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const finiteOr = (value: number | undefined, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

export const DEFAULT_OCEAN_SURFACE_CONTEXT: Readonly<OceanSurfaceContext> = Object.freeze({
  windDirX: FALLBACK_WIND_X / FALLBACK_WIND_LENGTH,
  windDirY: FALLBACK_WIND_Y / FALLBACK_WIND_LENGTH,
  waveEnergy01: 0.2,
  foamEnergy01: 0.26,
  shallowClarity01: 0.82,
  rainIntensity01: 0
});

export const resolveOceanSurfaceContext = (input: OceanSurfaceContextInput): OceanSurfaceContext => {
  const windDx = finiteOr(input.windDx, 0);
  const windDy = finiteOr(input.windDy, 0);
  const windLength = Math.hypot(windDx, windDy);
  const windStrength01 = clamp01(finiteOr(input.windStrength01, 0));
  const rainIntensity01 = clamp01(finiteOr(input.rainIntensity01, 0));

  return {
    windDirX: windLength > 0.0001 ? windDx / windLength : DEFAULT_OCEAN_SURFACE_CONTEXT.windDirX,
    windDirY: windLength > 0.0001 ? windDy / windLength : DEFAULT_OCEAN_SURFACE_CONTEXT.windDirY,
    waveEnergy01: clamp01(0.2 + 0.52 * windStrength01 + 0.34 * rainIntensity01),
    foamEnergy01: clamp01(0.26 + 0.38 * windStrength01 + 0.56 * rainIntensity01),
    shallowClarity01: Math.max(0.36, Math.min(0.82, 0.82 - 0.2 * windStrength01 - 0.28 * rainIntensity01)),
    rainIntensity01
  };
};

export const oceanSurfaceContextsEqual = (a: OceanSurfaceContext, b: OceanSurfaceContext): boolean =>
  a.windDirX === b.windDirX &&
  a.windDirY === b.windDirY &&
  a.waveEnergy01 === b.waveEnergy01 &&
  a.foamEnergy01 === b.foamEnergy01 &&
  a.shallowClarity01 === b.shallowClarity01 &&
  a.rainIntensity01 === b.rainIntensity01;
