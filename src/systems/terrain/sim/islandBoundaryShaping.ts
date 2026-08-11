const SEA_FLOOR = 0.02;
const ISLAND_BLEND = 0.5;
const DETAIL_FADE_START = 0.94;
const BORDER_SAFETY_START = 0.985;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const mix = (a: number, b: number, t: number): number => a + (b - a) * clamp01(t);

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp01((value - edge0) / Math.max(0.000001, edge1 - edge0));
  return t * t * (3 - 2 * t);
};

export type IslandBoundarySample = {
  distance01: number;
  perturbedDistance01: number;
  macroHeight: number;
  detailFade: number;
};

export const getSquareBumpDistance01 = (nx: number, ny: number): number => {
  const x = clamp01(Math.abs(nx));
  const y = clamp01(Math.abs(ny));
  return clamp01(1 - (1 - x * x) * (1 - y * y));
};

export const shapeIslandBoundary = (
  macroHeight: number,
  nx: number,
  ny: number,
  contourNoise: number,
  coastComplexity: number
): IslandBoundarySample => {
  const distance01 = getSquareBumpDistance01(nx, ny);
  const perturbationEnvelope = 4 * distance01 * (1 - distance01);
  const perturbation = Math.max(-1, Math.min(1, contourNoise))
    * mix(0.012, 0.05, coastComplexity)
    * perturbationEnvelope;
  const perturbedDistance01 = clamp01(distance01 + perturbation);
  const targetHeight = SEA_FLOOR + (1 - SEA_FLOOR) * (1 - perturbedDistance01);
  const convertedHeight = mix(clamp01(macroHeight), targetHeight, ISLAND_BLEND);
  const borderSafety = smoothstep(BORDER_SAFETY_START, 1, distance01);
  return {
    distance01,
    perturbedDistance01,
    macroHeight: clamp01(mix(convertedHeight, Math.min(convertedHeight, SEA_FLOOR), borderSafety)),
    detailFade: 1 - smoothstep(DETAIL_FADE_START, 1, distance01)
  };
};

