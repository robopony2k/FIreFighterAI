import * as THREE from "three";
import { TIME_SPEED_OPTIONS } from "../core/config.js";
import { mixRgb, type RGB } from "./color.js";

const TAU = Math.PI * 2;
const SUMMER_MIDPOINT_T01 = 0.625;
const WINTER_MIDPOINT_T01 = 0.125;
const EQUINOX_ELEVATION_DEG = 51;
const WINTER_ELEVATION_DEG = 39;
const SUMMER_ELEVATION_DEG = 63;
const AZIMUTH_DRIFT_DEG = 18;
const SHADOW_NORMAL_REFRESH_MS = 160;
const SHADOW_FAST_REFRESH_MS = 90;
const MAX_SPEED_INDEX = Math.max(0, TIME_SPEED_OPTIONS.length - 1);
const MORNING_AZIMUTH_OFFSET_DEG = -5;
// Preserve the old scene readability, but bias the anchor a little earlier in the morning.
const EQUINOX_AZIMUTH_DEG = Math.atan2(0.35, 0.45) * (180 / Math.PI) + MORNING_AZIMUTH_OFFSET_DEG;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const rgb = (r: number, g: number, b: number): RGB => ({ r, g, b });
const wrap01 = (value: number): number => ((value % 1) + 1) % 1;
const degToRad = (degrees: number): number => degrees * (Math.PI / 180);

export type LightingDirectorInput = {
  seasonT01: number;
  risk01: number;
  fireLoad01: number;
  timeSpeedIndex: number;
};

export type LightingDirectorState = {
  sunDirection: THREE.Vector3;
  sunColor: RGB;
  sunIntensity: number;
  fillDirection: THREE.Vector3;
  fillColor: RGB;
  fillIntensity: number;
  ambientIntensity: number;
  fogColor: RGB;
  fogDensity: number;
  hazeStrength: number;
  smokeTint: RGB;
  waterSunColor: RGB;
  sunAzimuthDeg: number;
  sunElevationDeg: number;
  shadowRefreshMinMs: number;
};

export const buildLightingDirectorState = (input: LightingDirectorInput): LightingDirectorState => {
  const seasonT01 = wrap01(input.seasonT01);
  const risk01 = clamp01(input.risk01);
  const fireLoad01 = clamp01(input.fireLoad01);
  const smokePressure01 = clamp01(risk01 * 0.45 + fireLoad01 * 0.55);
  const annualBand = Math.cos((seasonT01 - SUMMER_MIDPOINT_T01) * TAU);
  const summer01 = clamp01((annualBand + 1) * 0.5);
  const winter01 = clamp01(1 - summer01);
  const sunElevationDeg = clamp(
    lerp(EQUINOX_ELEVATION_DEG, annualBand >= 0 ? SUMMER_ELEVATION_DEG : WINTER_ELEVATION_DEG, Math.abs(annualBand)),
    WINTER_ELEVATION_DEG,
    SUMMER_ELEVATION_DEG
  );
  const sunAzimuthDeg = EQUINOX_AZIMUTH_DEG + annualBand * AZIMUTH_DRIFT_DEG;
  const azimuthRad = degToRad(sunAzimuthDeg);
  const elevationRad = degToRad(sunElevationDeg);
  const horizontal = Math.cos(elevationRad);
  const sunDirection = new THREE.Vector3(
    horizontal * Math.cos(azimuthRad),
    Math.sin(elevationRad),
    horizontal * Math.sin(azimuthRad)
  ).normalize();
  const fillDirection = new THREE.Vector3(
    -sunDirection.x * 0.82,
    clamp(sunDirection.y * 0.48 + 0.16, 0.2, 0.72),
    -sunDirection.z * 0.82
  ).normalize();

  const lowAngleWarmth01 = clamp01((SUMMER_ELEVATION_DEG - sunElevationDeg) / (SUMMER_ELEVATION_DEG - WINTER_ELEVATION_DEG));
  const sunColorBase = mixRgb(rgb(248, 243, 232), rgb(255, 223, 184), lowAngleWarmth01 * 0.92);
  const sunColor = mixRgb(sunColorBase, rgb(225, 193, 158), smokePressure01 * 0.24 + fireLoad01 * 0.08);
  const waterSunColor = mixRgb(sunColor, rgb(255, 244, 224), 0.28);

  const fillColorBase = mixRgb(rgb(118, 150, 188), rgb(144, 154, 168), summer01 * 0.18 + smokePressure01 * 0.16);
  const fillColor = mixRgb(fillColorBase, rgb(166, 132, 98), fireLoad01 * 0.12);
  const ambientIntensity = clamp(0.22 + winter01 * 0.11 - summer01 * 0.035 - smokePressure01 * 0.05, 0.15, 0.34);
  const fillIntensity = clamp(0.24 + winter01 * 0.12 - summer01 * 0.05 - fireLoad01 * 0.05, 0.16, 0.42);
  const sunIntensity = clamp(0.9 + summer01 * 0.18 - smokePressure01 * 0.06 + winter01 * 0.02, 0.78, 1.12);

  const fogSeason = mixRgb(rgb(124, 138, 154), rgb(168, 146, 122), summer01 * 0.55);
  const fogSmoke = mixRgb(fogSeason, rgb(120, 96, 74), smokePressure01 * 0.48 + fireLoad01 * 0.18);
  const fogColor = mixRgb(fogSmoke, rgb(148, 108, 76), fireLoad01 * 0.12);
  const hazeStrength = clamp(0.045 + summer01 * 0.04 + risk01 * 0.018 + fireLoad01 * 0.038, 0.03, 0.16);
  const fogDensity = clamp(0.0048 + summer01 * 0.0009 + risk01 * 0.0013 + fireLoad01 * 0.0024, 0.0042, 0.0115);
  const smokeTint = mixRgb(rgb(118, 110, 104), rgb(174, 126, 84), clamp01(risk01 * 0.38 + fireLoad01 * 0.62));
  const shadowRefreshMinMs = input.timeSpeedIndex >= MAX_SPEED_INDEX ? SHADOW_FAST_REFRESH_MS : SHADOW_NORMAL_REFRESH_MS;

  return {
    sunDirection,
    sunColor,
    sunIntensity,
    fillDirection,
    fillColor,
    fillIntensity,
    ambientIntensity,
    fogColor,
    fogDensity,
    hazeStrength,
    smokeTint,
    waterSunColor,
    sunAzimuthDeg,
    sunElevationDeg,
    shadowRefreshMinMs
  };
};

export const LIGHTING_DIRECTOR_BASELINE = {
  winterMidpointT01: WINTER_MIDPOINT_T01,
  summerMidpointT01: SUMMER_MIDPOINT_T01,
  equinoxAzimuthDeg: EQUINOX_AZIMUTH_DEG
} as const;
