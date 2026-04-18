import * as THREE from "three";
import { TIME_SPEED_FAST_PATH_VALUE } from "../core/timeSpeed.js";
import { mixRgb, type RGB } from "./color.js";
import {
  SEASONAL_SKY_BASELINE,
  buildSeasonalSkyState,
  type SeasonalSkyInput,
  type SeasonalSkyState
} from "./seasonalSky.js";

const SHADOW_NORMAL_REFRESH_MS = 160;
const SHADOW_FAST_REFRESH_MS = 90;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const rgb = (r: number, g: number, b: number): RGB => ({ r, g, b });

export type LightingDirectorInput = SeasonalSkyInput & {
  timeSpeedValue: number;
};

export type LightingDirectorState = SeasonalSkyState & {
  fillDirection: THREE.Vector3;
  fillColor: RGB;
  fillIntensity: number;
  ambientIntensity: number;
  fogColor: RGB;
  fogDensity: number;
  hazeStrength: number;
  smokeTint: RGB;
  waterSunColor: RGB;
  shadowRefreshMinMs: number;
};

export const buildLightingDirectorState = (input: LightingDirectorInput): LightingDirectorState => {
  const risk01 = clamp01(input.risk01);
  const sky = buildSeasonalSkyState(input);
  const fillDirection = new THREE.Vector3(
    -sky.sunDirection.x * 0.8,
    clamp(sky.sunDirection.y * 0.52 + 0.18 + sky.overcastStrength * 0.08, 0.22, 0.74),
    -sky.sunDirection.z * 0.8
  ).normalize();
  const fillColorBase = mixRgb(sky.skyTopColor, sky.skyHorizonColor, 0.56);
  const fillColor = mixRgb(fillColorBase, rgb(202, 208, 214), sky.overcastStrength * 0.18 + sky.winter01 * 0.06);
  const fillIntensity = clamp(0.16 + sky.ambientSoftness * 0.3 + sky.overcastStrength * 0.12, 0.14, 0.46);
  const ambientIntensity = clamp(0.1 + sky.ambientSoftness * 0.42 + sky.overcastStrength * 0.12, 0.11, 0.5);
  const fogBase = mixRgb(sky.skyHorizonColor, sky.skyTopColor, 0.34);
  const fogColor = mixRgb(fogBase, rgb(154, 160, 166), sky.overcastStrength * 0.2 + sky.winter01 * 0.12);
  const fogDensity = clamp(0.0028 + sky.overcastStrength * 0.0035 + sky.winter01 * 0.0011 + (1 - risk01) * 0.0002, 0.0026, 0.0094);
  const smokeTint = mixRgb(rgb(118, 122, 128), rgb(168, 150, 130), sky.overcastStrength * 0.2 + risk01 * 0.18);
  const waterSunColor = mixRgb(sky.sunColor, rgb(255, 250, 232), 0.24);
  const shadowRefreshMinMs =
    input.timeSpeedValue >= TIME_SPEED_FAST_PATH_VALUE ? SHADOW_FAST_REFRESH_MS : SHADOW_NORMAL_REFRESH_MS;

  return {
    ...sky,
    fillDirection,
    fillColor,
    fillIntensity,
    ambientIntensity,
    fogColor,
    fogDensity,
    hazeStrength: sky.hazeStrength,
    smokeTint,
    waterSunColor,
    shadowRefreshMinMs
  };
};

export const LIGHTING_DIRECTOR_BASELINE = {
  equinoxAzimuthDeg: SEASONAL_SKY_BASELINE.equinoxAzimuthDeg
} as const;
