import { getTimeSpeedOptions } from "./config.js";
import type { SimTimeMode, TimeSpeedControlMode } from "./types.js";

export const TIME_SPEED_SLIDER_MIN = 0;
export const TIME_SPEED_SLIDER_MAX = 80;
export const TIME_SPEED_SLIDER_STEP = 0.25;
export const TIME_SPEED_FAST_PATH_VALUE = TIME_SPEED_SLIDER_MAX;
export const DEFAULT_TIME_SPEED_SLIDER_VALUE = 1;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const roundToStep = (value: number): number => Math.round(value / TIME_SPEED_SLIDER_STEP) * TIME_SPEED_SLIDER_STEP;

export const clampTimeSpeedSliderValue = (value: number): number => {
  const finite = Number.isFinite(value) ? value : DEFAULT_TIME_SPEED_SLIDER_VALUE;
  const quantized = roundToStep(finite);
  return clamp(Number(quantized.toFixed(4)), TIME_SPEED_SLIDER_MIN, TIME_SPEED_SLIDER_MAX);
};

export const stepTimeSpeedSliderValue = (value: number, deltaSteps: number): number =>
  clampTimeSpeedSliderValue(value + deltaSteps * TIME_SPEED_SLIDER_STEP);

export const formatTimeSpeedValue = (value: number): string => {
  if (Number.isInteger(value)) {
    return `${value.toFixed(0)}x`;
  }
  if (Math.abs(value) >= 0.1) {
    return `${value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}x`;
  }
  return `${value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}x`;
};

export const getIndexedTimeSpeedValue = (mode: SimTimeMode, index: number): number => {
  const options = getTimeSpeedOptions(mode);
  const clampedIndex = clamp(index, 0, Math.max(0, options.length - 1));
  return options[clampedIndex] ?? 1;
};

export type TimeSpeedStateLike = {
  simTimeMode: SimTimeMode;
  timeSpeedIndex: number;
  timeSpeedSliderValue: number;
  timeSpeedControlMode: TimeSpeedControlMode;
};

export type TimeSpeedPauseStateLike = TimeSpeedStateLike & {
  paused: boolean;
  gameOver: boolean;
};

export const getResolvedTimeSpeedValue = (state: TimeSpeedStateLike): number =>
  state.timeSpeedControlMode === "slider"
    ? clampTimeSpeedSliderValue(state.timeSpeedSliderValue)
    : getIndexedTimeSpeedValue(state.simTimeMode, state.timeSpeedIndex);

export const isTimeSpeedStopped = (value: number): boolean => value <= TIME_SPEED_SLIDER_MIN + 1e-6;

export const isSimulationEffectivelyPaused = (state: TimeSpeedPauseStateLike): boolean =>
  state.gameOver || state.paused || isTimeSpeedStopped(getResolvedTimeSpeedValue(state));
