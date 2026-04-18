import type { UiAudioSettings } from "../../../audio/uiAudio.js";
import type { WorldState } from "../../../core/state.js";
import type { ClimateForecast, SimTimeMode, TimeSpeedControlMode } from "../../../core/types.js";
import type { RuntimeSettings } from "../../../persistence/runtimeSettings.js";

export type AudioChannelState = Pick<UiAudioSettings, "muted" | "volume">;

export type TimeControlsWidgetModel = {
  showTimeControls: boolean;
  showSpeedControl: boolean;
  paused: boolean;
  simTimeMode: SimTimeMode;
  timeSpeedControlMode: TimeSpeedControlMode;
  timeSpeedIndex: number;
  timeSpeedValue: number;
  skipToNextFireActive: boolean;
  canSkipToNextFire: boolean;
  status?: string;
};

export type AudioControlsWidgetModel = {
  sfx: AudioChannelState;
  world: AudioChannelState;
  music: AudioChannelState;
};

export type SimulationSettingsWidgetModel = Pick<RuntimeSettings, "randomFireIgnition" | "annualReportEnabled">;

export type ClimateWidgetModel = {
  forecast: ClimateForecast | null;
  forecastDay: number;
  forecastStartDay: number;
  forecastYearDays: number;
  forecastMeta: string | null;
};

export type MinimapWidgetModel = {
  world: WorldState | null;
};
