import type { MapGenSettings } from "../../../mapgen/settings.js";

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const clamp01 = (value: number): number => clamp(value, 0, 1);
const mix = (a: number, b: number, t: number): number => a + (b - a) * clamp01(t);

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  if (Math.abs(edge1 - edge0) < 1e-6) {
    return value < edge0 ? 0 : 1;
  }
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

type CoastlineEnvelopeSettings = Pick<
  MapGenSettings,
  | "coastComplexity"
  | "landCoverageTarget"
  | "islandCompactness"
  | "coastalShelfWidth"
  | "asymmetry"
  | "anisotropy"
  | "embayment"
  | "ridgeAlignment"
>;

export type CoastlineEnvelopeFields = {
  islandShape01: number;
  borderSafety01: number;
  seaPressure01: number;
};

const getSquareEdgeDistance01 = (x: number, y: number, cols: number, rows: number): number => {
  if (cols <= 1 || rows <= 1) {
    return 0;
  }
  const nx = x / (cols - 1);
  const ny = y / (rows - 1);
  return clamp01(Math.min(nx, ny, 1 - nx, 1 - ny) * 2);
};

const angularWave = (angle: number, frequency: number, phase: number): number =>
  Math.sin(angle * frequency + phase);

const wave2D = (x: number, y: number, fx: number, fy: number, phase: number): number =>
  Math.sin((x * fx + y * fy) * Math.PI * 2 + phase);

const hashUnit = (seed: number, salt: number): number => {
  const value = Math.sin((seed + salt * 374.761) * 12.9898) * 43_758.5453;
  return value - Math.floor(value);
};

const edgeInlet01 = (distanceFromEdge01: number, alongEdge01: number, seed: number, salt: number, depthScale: number): number => {
  if (distanceFromEdge01 > 0.38) {
    return 0;
  }
  const phaseA = hashUnit(seed, salt) * Math.PI * 2;
  const phaseB = hashUnit(seed, salt + 17) * Math.PI * 2;
  const phaseC = hashUnit(seed, salt + 31) * Math.PI * 2;
  const wave =
    Math.sin(alongEdge01 * Math.PI * 2 * 2.7 + phaseA) * 0.52
    + Math.sin(alongEdge01 * Math.PI * 2 * 6.2 + phaseB) * 0.3
    + Math.sin(alongEdge01 * Math.PI * 2 * 13.4 + phaseC) * 0.18;
  const localDepth = mix(0.016, 0.25, wave * 0.5 + 0.5) * depthScale;
  return 1 - smoothstep(localDepth * 0.42, localDepth, distanceFromEdge01);
};

export const getCoastlineEnvelopeFields = (
  x: number,
  y: number,
  cols: number,
  rows: number,
  seed: number,
  settings: CoastlineEnvelopeSettings
): CoastlineEnvelopeFields => {
  if (x <= 0 || y <= 0 || x >= cols - 1 || y >= rows - 1 || cols <= 1 || rows <= 1) {
    return { islandShape01: 0, borderSafety01: 1, seaPressure01: 1 };
  }

  const nx = x / (cols - 1);
  const ny = y / (rows - 1);
  const px = nx * 2 - 1;
  const py = ny * 2 - 1;
  const landCoverage = clamp(settings.landCoverageTarget, 0.32, 0.82);
  const coastComplexity = clamp01(settings.coastComplexity);
  const compactness = clamp01(settings.islandCompactness);
  const shelf = clamp01(settings.coastalShelfWidth);
  const asymmetry = clamp01(settings.asymmetry);
  const anisotropy = clamp01(settings.anisotropy);
  const embayment = clamp01(settings.embayment);
  const centerDrift = mix(0.015, 0.09, asymmetry);
  const centerX = (hashUnit(seed, 78_101) * 2 - 1) * centerDrift;
  const centerY = (hashUnit(seed, 78_131) * 2 - 1) * centerDrift;
  const dx = px - centerX;
  const dy = py - centerY;
  const warpStrength = mix(0.045, 0.16, coastComplexity) * mix(1.18, 0.72, compactness);
  const warpedDx =
    dx
    + (
      wave2D(dx, dy, 0.72, -1.08, hashUnit(seed, 78_139) * Math.PI * 2) * 0.58
      + wave2D(dx, dy, -1.64, -0.5, hashUnit(seed, 78_151) * Math.PI * 2) * 0.42
    ) * warpStrength;
  const warpedDy =
    dy
    + (
      wave2D(dx, dy, 1.16, 0.82, hashUnit(seed, 78_163) * Math.PI * 2) * 0.56
      + wave2D(dx, dy, -0.62, 1.76, hashUnit(seed, 78_167) * Math.PI * 2) * 0.44
    ) * warpStrength;
  const angle = (settings.ridgeAlignment - 0.5) * Math.PI + (hashUnit(seed, 78_173) - 0.5) * Math.PI;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const along = warpedDx * cos + warpedDy * sin;
  const across = -warpedDx * sin + warpedDy * cos;
  const aspectMajor = mix(1, 1.42, anisotropy);
  const aspectMinor = mix(1, 0.78, anisotropy);
  const scaledAlong = along / aspectMajor;
  const scaledAcross = across / aspectMinor;
  const ellipticalDistance = Math.hypot(scaledAlong, scaledAcross);
  const polarAngle = Math.atan2(scaledAcross, scaledAlong);
  const broad =
    wave2D(warpedDx, warpedDy, 0.8, 1.15, hashUnit(seed, 78_211) * Math.PI * 2) * 0.62
    + wave2D(warpedDx, warpedDy, -1.2, 0.72, hashUnit(seed, 78_223) * Math.PI * 2) * 0.38;
  const medium =
    wave2D(warpedDx, warpedDy, 2.4, -1.85, hashUnit(seed, 78_293) * Math.PI * 2) * 0.56
    + wave2D(warpedDx, warpedDy, -2.95, -2.1, hashUnit(seed, 78_307) * Math.PI * 2) * 0.44;
  const bayField = smoothstep(
    0.18,
    0.78,
    wave2D(warpedDx, warpedDy, 1.35, -2.05, hashUnit(seed, 78_347) * Math.PI * 2) * 0.28
      + wave2D(warpedDx, warpedDy, -2.7, 1.1, hashUnit(seed, 78_359) * Math.PI * 2) * 0.22
      + 0.5
  );
  const angularLobes =
    angularWave(polarAngle, 3, hashUnit(seed, 78_383) * Math.PI * 2) * 0.48
    + angularWave(polarAngle, 5, hashUnit(seed, 78_419) * Math.PI * 2) * 0.32
    + angularWave(polarAngle, 7, hashUnit(seed, 78_457) * Math.PI * 2) * 0.2;
  const lobeNoise = broad * 0.34 + medium * 0.28 + angularLobes * 0.38;
  const baseRadius = mix(0.72, 2, landCoverage) * mix(0.93, 1.03, shelf);
  const lobeAmplitude = mix(0.52, 0.2, compactness) * mix(1, 1.82, coastComplexity);
  const bayCut = bayField * mix(embayment, coastComplexity, 0.42) * mix(0.1, 0.32, coastComplexity);
  const shapeField = 1 - ellipticalDistance / baseRadius + lobeNoise * lobeAmplitude - bayCut;
  const islandShape = smoothstep(-0.08, 0.14, shapeField);
  const organicSea = 1 - smoothstep(-0.16, 0.1, shapeField);
  const inletDepthScale =
    mix(0.95, 1.7, coastComplexity)
    * mix(0.86, 1.34, embayment)
    * mix(1.25, 0.35, landCoverage);
  const edgeInlet = Math.max(
    edgeInlet01(ny, nx, seed, 11, inletDepthScale),
    edgeInlet01(1 - ny, nx, seed, 23, inletDepthScale),
    edgeInlet01(nx, ny, seed, 37, inletDepthScale),
    edgeInlet01(1 - nx, ny, seed, 53, inletDepthScale)
  );
  const borderSafety = 1 - smoothstep(0.004, 0.045, getSquareEdgeDistance01(x, y, cols, rows));
  const seaPressure = clamp01(Math.max(organicSea * 0.26, borderSafety, edgeInlet * 0.52));
  return {
    islandShape01: clamp01(islandShape * (1 - borderSafety) * (1 - edgeInlet * 0.96)),
    borderSafety01: borderSafety,
    seaPressure01: seaPressure
  };
};

export const getCoastlineEnvelopeDistance01 = (
  x: number,
  y: number,
  cols: number,
  rows: number,
  seed: number,
  settings: CoastlineEnvelopeSettings
): number => {
  return getCoastlineEnvelopeFields(x, y, cols, rows, seed, settings).islandShape01;
};

export const getCoastlineEdgeBias01 = (
  x: number,
  y: number,
  cols: number,
  rows: number,
  seed: number,
  settings: CoastlineEnvelopeSettings
): number => getCoastlineEnvelopeFields(x, y, cols, rows, seed, settings).seaPressure01;

export const getCoastlineSeaLevel = (
  seaLevelBase: number,
  x: number,
  y: number,
  cols: number,
  rows: number,
  seed: number,
  settings: CoastlineEnvelopeSettings & Pick<MapGenSettings, "edgeWaterBias">,
  clampSeaLevel: (value: number) => number
): number =>
  clampSeaLevel(
    seaLevelBase + getCoastlineEdgeBias01(x, y, cols, rows, seed, settings) * settings.edgeWaterBias
  );
