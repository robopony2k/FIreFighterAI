import type { UiAudioSettings } from "../../../audio/uiAudio.js";
import { getTimeSpeedOptions } from "../../../core/config.js";
import {
  formatTimeSpeedValue,
  TIME_SPEED_SLIDER_MAX,
  TIME_SPEED_SLIDER_MIN,
  TIME_SPEED_SLIDER_STEP
} from "../../../core/timeSpeed.js";
import {
  AUDIO_CONTROL_CHANNELS,
  PHASE_DOM_SETTINGS_WIDGET_CONTAINER,
  SIMULATION_TOGGLE_SPECS,
  TIME_CONTROL_ACTIONS,
  getRuntimeWidgetTitle,
  getRuntimeWidgetsForContainer,
  getTimeSpeedAction
} from "../../runtime/widgets/registry.js";
import type {
  AudioChannelState,
  SimulationSettingsWidgetModel,
  TimeControlsWidgetModel
} from "../../runtime/widgets/models.js";
import type { AudioChannelId } from "../../runtime/widgets/types.js";

export type BottomControlsData = TimeControlsWidgetModel;

export type BottomControlsView = {
  element: HTMLElement;
  update: (data: BottomControlsData) => void;
  onAudioMuteToggle: (handler: () => void) => void;
  onAudioVolumeChange: (handler: (value: number) => void) => void;
  setAudioState: (settings: UiAudioSettings) => void;
  onWorldMuteToggle: (handler: () => void) => void;
  onWorldVolumeChange: (handler: (value: number) => void) => void;
  setWorldState: (settings: AudioChannelState) => void;
  onMusicMuteToggle: (handler: () => void) => void;
  onMusicVolumeChange: (handler: (value: number) => void) => void;
  setMusicState: (settings: AudioChannelState) => void;
  onRandomFireIgnitionToggle: (handler: (enabled: boolean) => void) => void;
  onAnnualReportToggle: (handler: (enabled: boolean) => void) => void;
  setSimulationToggleState: (settings: SimulationSettingsWidgetModel) => void;
};

type AudioRowControls = {
  row: HTMLDivElement;
  muteButton: HTMLButtonElement;
  volumeLabel: HTMLSpanElement;
  volumeSlider: HTMLInputElement;
};

type ToggleRowControls = {
  row: HTMLLabelElement;
  input: HTMLInputElement;
};

export const createBottomLeftControls = (): BottomControlsView => {
  const getDisplayedIndices = (mode: BottomControlsData["simTimeMode"]): number[] => {
    const options = getTimeSpeedOptions(mode);
    const last = Math.max(0, options.length - 1);
    return [...new Set([0, Math.min(1, last), Math.min(2, last), last])];
  };

  const element = document.createElement("div");
  element.className = "phase-panel phase-bottom-controls";
  element.dataset.panel = "bottomControls";
  element.dataset.runtimeWidgetContainer = PHASE_DOM_SETTINGS_WIDGET_CONTAINER;

  const timeGroup = document.createElement("div");
  timeGroup.className = "phase-control-group phase-time-group";
  timeGroup.dataset.runtimeWidget = "timeControls";
  const titleRow = document.createElement("div");
  titleRow.className = "phase-control-title";
  titleRow.textContent = getRuntimeWidgetTitle("timeControls", "phaseDom");

  const buttonSpeedRow = document.createElement("div");
  buttonSpeedRow.className = "phase-control-row phase-time-speed-row";
  buttonSpeedRow.innerHTML = `
    <button data-action="${TIME_CONTROL_ACTIONS.pause.action}" aria-label="Pause" title="Pause">||</button>
    <button data-role="time-speed"></button>
    <button data-role="time-speed"></button>
    <button data-role="time-speed"></button>
    <button data-role="time-speed"></button>
    <button data-action="${TIME_CONTROL_ACTIONS.skipToNextFire.action}" aria-label="Skip to Next Fire" title="Skip to Next Fire">Next Fire</button>
  `;

  const sliderSpeedRow = document.createElement("div");
  sliderSpeedRow.className = "phase-control-row phase-time-slider-row is-hidden";
  sliderSpeedRow.innerHTML = `
    <button data-action="${TIME_CONTROL_ACTIONS.pause.action}" aria-label="Pause" title="Pause">||</button>
    <label class="phase-time-slider-field">
      <span class="phase-time-slider-caption">Speed</span>
      <input
        type="range"
        min="${TIME_SPEED_SLIDER_MIN}"
        max="${TIME_SPEED_SLIDER_MAX}"
        step="${TIME_SPEED_SLIDER_STEP}"
        value="1"
        data-action="${TIME_CONTROL_ACTIONS.sliderSet.action}"
        data-role="time-speed-slider"
        aria-label="Time speed slider"
      />
    </label>
    <span class="phase-time-slider-value">1x</span>
    <button data-action="${TIME_CONTROL_ACTIONS.skipToNextFire.action}" aria-label="Skip to Next Fire" title="Skip to Next Fire">Next Fire</button>
  `;
  timeGroup.append(titleRow, buttonSpeedRow, sliderSpeedRow);

  const buildAudioRow = (): AudioRowControls => {
    const row = document.createElement("div");
    row.className = "phase-control-row phase-audio-row";
    const muteButton = document.createElement("button");
    muteButton.type = "button";
    muteButton.className = "phase-audio-mute";
    const volumeWrap = document.createElement("label");
    volumeWrap.className = "phase-audio-volume";
    const volumeLabel = document.createElement("span");
    volumeLabel.className = "phase-audio-label";
    const volumeSlider = document.createElement("input");
    volumeSlider.type = "range";
    volumeSlider.className = "phase-audio-slider";
    volumeSlider.min = "0";
    volumeSlider.max = "1";
    volumeSlider.step = "0.01";
    volumeWrap.append(volumeLabel, volumeSlider);
    row.append(muteButton, volumeWrap);
    return { row, muteButton, volumeLabel, volumeSlider };
  };

  const audioGroup = document.createElement("div");
  audioGroup.className = "phase-control-group phase-audio-group";
  audioGroup.dataset.runtimeWidget = "audioControls";
  const audioTitle = document.createElement("div");
  audioTitle.className = "phase-control-title";
  audioTitle.textContent = getRuntimeWidgetTitle("audioControls", "phaseDom");
  audioGroup.appendChild(audioTitle);

  const audioRows = new Map<AudioChannelId, AudioRowControls>();
  AUDIO_CONTROL_CHANNELS.forEach((channel) => {
    const controls = buildAudioRow();
    controls.row.dataset.audioChannel = channel.id;
    audioRows.set(channel.id, controls);
    audioGroup.appendChild(controls.row);
  });

  const buildToggleRow = (labelText: string, descriptionText: string): ToggleRowControls => {
    const row = document.createElement("label");
    row.className = "phase-control-toggle";
    const copy = document.createElement("span");
    copy.className = "phase-control-toggle-copy";
    const label = document.createElement("span");
    label.className = "phase-control-toggle-label";
    label.textContent = labelText;
    const description = document.createElement("span");
    description.className = "phase-control-toggle-description";
    description.textContent = descriptionText;
    copy.append(label, description);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "phase-control-toggle-input";
    row.append(copy, input);
    return { row, input };
  };

  const simulationGroup = document.createElement("div");
  simulationGroup.className = "phase-control-group phase-testing-group";
  simulationGroup.dataset.runtimeWidget = "simulationSettings";
  const simulationTitle = document.createElement("div");
  simulationTitle.className = "phase-control-title";
  simulationTitle.textContent = getRuntimeWidgetTitle("simulationSettings", "phaseDom");
  simulationGroup.appendChild(simulationTitle);

  const toggleRows = new Map<keyof SimulationSettingsWidgetModel, ToggleRowControls>();
  SIMULATION_TOGGLE_SPECS.forEach((toggle) => {
    const controls = buildToggleRow(toggle.title, toggle.description);
    controls.row.dataset.runtimeSetting = toggle.setting;
    toggleRows.set(toggle.setting, controls);
    simulationGroup.appendChild(controls.row);
  });

  const status = document.createElement("div");
  status.className = "phase-control-status";

  const widgetGroups = new Map<"timeControls" | "audioControls" | "simulationSettings", HTMLElement>([
    ["timeControls", timeGroup],
    ["audioControls", audioGroup],
    ["simulationSettings", simulationGroup]
  ]);
  getRuntimeWidgetsForContainer("phaseDom", PHASE_DOM_SETTINGS_WIDGET_CONTAINER).forEach((spec) => {
    const group = widgetGroups.get(spec.id as "timeControls" | "audioControls" | "simulationSettings");
    if (group) {
      element.appendChild(group);
    }
  });
  element.appendChild(status);

  const buttonPauseButton = buttonSpeedRow.querySelector(`[data-action="${TIME_CONTROL_ACTIONS.pause.action}"]`) as HTMLButtonElement;
  const sliderPauseButton = sliderSpeedRow.querySelector(`[data-action="${TIME_CONTROL_ACTIONS.pause.action}"]`) as HTMLButtonElement;
  const buttonNextFireButton = buttonSpeedRow.querySelector(
    `[data-action="${TIME_CONTROL_ACTIONS.skipToNextFire.action}"]`
  ) as HTMLButtonElement;
  const sliderNextFireButton = sliderSpeedRow.querySelector(
    `[data-action="${TIME_CONTROL_ACTIONS.skipToNextFire.action}"]`
  ) as HTMLButtonElement;
  const speedButtons = Array.from(buttonSpeedRow.querySelectorAll<HTMLButtonElement>('[data-role="time-speed"]'));
  const speedSlider = sliderSpeedRow.querySelector('[data-role="time-speed-slider"]') as HTMLInputElement;
  const speedSliderValue = sliderSpeedRow.querySelector(".phase-time-slider-value") as HTMLSpanElement;

  const defaultAudioState: Record<AudioChannelId, AudioChannelState> = AUDIO_CONTROL_CHANNELS.reduce(
    (result, channel) => ({
      ...result,
      [channel.id]: {
        muted: false,
        volume: channel.defaultVolume
      }
    }),
    {} as Record<AudioChannelId, AudioChannelState>
  );

  let audioState = defaultAudioState.sfx;
  let worldState = defaultAudioState.world;
  let musicState = defaultAudioState.music;
  let onAudioMuteToggleHandler: (() => void) | null = null;
  let onAudioVolumeChangeHandler: ((value: number) => void) | null = null;
  let onWorldMuteToggleHandler: (() => void) | null = null;
  let onWorldVolumeChangeHandler: ((value: number) => void) | null = null;
  let onMusicMuteToggleHandler: (() => void) | null = null;
  let onMusicVolumeChangeHandler: ((value: number) => void) | null = null;
  let simulationToggleState: SimulationSettingsWidgetModel = {
    randomFireIgnition: true,
    annualReportEnabled: true
  };
  let onRandomFireIgnitionToggleHandler: ((enabled: boolean) => void) | null = null;
  let onAnnualReportToggleHandler: ((enabled: boolean) => void) | null = null;

  const getAudioControlState = (channelId: AudioChannelId): AudioChannelState => {
    if (channelId === "world") {
      return worldState;
    }
    if (channelId === "music") {
      return musicState;
    }
    return audioState;
  };

  const getAudioHandlers = (
    channelId: AudioChannelId
  ): { mute: (() => void) | null; volume: ((value: number) => void) | null } => {
    if (channelId === "world") {
      return {
        mute: onWorldMuteToggleHandler,
        volume: onWorldVolumeChangeHandler
      };
    }
    if (channelId === "music") {
      return {
        mute: onMusicMuteToggleHandler,
        volume: onMusicVolumeChangeHandler
      };
    }
    return {
      mute: onAudioMuteToggleHandler,
      volume: onAudioVolumeChangeHandler
    };
  };

  const refreshAudioControls = (): void => {
    AUDIO_CONTROL_CHANNELS.forEach((channel) => {
      const controls = audioRows.get(channel.id);
      if (!controls) {
        return;
      }
      const settings = getAudioControlState(channel.id);
      const handlers = getAudioHandlers(channel.id);
      const volumePct = Math.round(Math.max(0, Math.min(1, settings.volume)) * 100);
      controls.muteButton.textContent = settings.muted ? `Unmute ${channel.label}` : `Mute ${channel.label}`;
      controls.muteButton.setAttribute("aria-pressed", settings.muted ? "true" : "false");
      controls.muteButton.setAttribute("title", settings.muted ? channel.mutedTitle : channel.unmutedTitle);
      controls.muteButton.setAttribute("aria-label", settings.muted ? channel.mutedAriaLabel : channel.unmutedAriaLabel);
      controls.volumeLabel.textContent = `${channel.label} ${volumePct}%`;
      controls.volumeSlider.value = settings.volume.toFixed(2);
      controls.muteButton.disabled = handlers.mute === null || handlers.volume === null;
      controls.volumeSlider.disabled = handlers.volume === null || settings.muted;
    });
  };

  const refreshSimulationToggles = (): void => {
    SIMULATION_TOGGLE_SPECS.forEach((toggle) => {
      const controls = toggleRows.get(toggle.setting);
      if (!controls) {
        return;
      }
      const enabled = simulationToggleState[toggle.setting];
      controls.input.checked = enabled;
      controls.input.disabled =
        toggle.setting === "randomFireIgnition"
          ? onRandomFireIgnitionToggleHandler === null
          : onAnnualReportToggleHandler === null;
    });
  };

  audioRows.get("sfx")?.muteButton.addEventListener("click", (event) => {
    event.preventDefault();
    onAudioMuteToggleHandler?.();
  });
  audioRows.get("sfx")?.volumeSlider.addEventListener("input", () => {
    const next = Number(audioRows.get("sfx")?.volumeSlider.value ?? Number.NaN);
    if (!Number.isFinite(next)) {
      return;
    }
    onAudioVolumeChangeHandler?.(next);
  });

  audioRows.get("world")?.muteButton.addEventListener("click", (event) => {
    event.preventDefault();
    onWorldMuteToggleHandler?.();
  });
  audioRows.get("world")?.volumeSlider.addEventListener("input", () => {
    const next = Number(audioRows.get("world")?.volumeSlider.value ?? Number.NaN);
    if (!Number.isFinite(next)) {
      return;
    }
    onWorldVolumeChangeHandler?.(next);
  });

  audioRows.get("music")?.muteButton.addEventListener("click", (event) => {
    event.preventDefault();
    onMusicMuteToggleHandler?.();
  });
  audioRows.get("music")?.volumeSlider.addEventListener("input", () => {
    const next = Number(audioRows.get("music")?.volumeSlider.value ?? Number.NaN);
    if (!Number.isFinite(next)) {
      return;
    }
    onMusicVolumeChangeHandler?.(next);
  });

  toggleRows.get("randomFireIgnition")?.input.addEventListener("change", () => {
    onRandomFireIgnitionToggleHandler?.(Boolean(toggleRows.get("randomFireIgnition")?.input.checked));
  });
  toggleRows.get("annualReportEnabled")?.input.addEventListener("change", () => {
    onAnnualReportToggleHandler?.(Boolean(toggleRows.get("annualReportEnabled")?.input.checked));
  });

  refreshAudioControls();
  refreshSimulationToggles();

  return {
    element,
    update: (data) => {
      const usingSlider = data.timeSpeedControlMode === "slider";
      timeGroup.classList.toggle("is-hidden", !data.showTimeControls);
      buttonSpeedRow.classList.toggle("is-hidden", !data.showSpeedControl || usingSlider);
      sliderSpeedRow.classList.toggle("is-hidden", !data.showSpeedControl || !usingSlider);
      titleRow.textContent = data.simTimeMode === "incident" ? "Incident Time" : "Strategic Time";

      const displayedIndices = getDisplayedIndices(data.simTimeMode);
      const activeOptions = getTimeSpeedOptions(data.simTimeMode);
      speedButtons.forEach((button, slot) => {
        const index = displayedIndices[slot];
        if (index === undefined || index < 0 || index >= activeOptions.length) {
          button.classList.add("is-hidden");
          button.disabled = true;
          return;
        }
        const speedLabel = formatTimeSpeedValue(activeOptions[index] ?? 1);
        button.classList.remove("is-hidden");
        button.disabled = false;
        button.dataset.speedIndex = String(index);
        button.dataset.action = getTimeSpeedAction(index).action;
        button.textContent = slot === speedButtons.length - 1 && index === activeOptions.length - 1 ? "MAX" : speedLabel;
        button.setAttribute("title", `Speed ${speedLabel}`);
        button.setAttribute("aria-label", `Speed ${speedLabel}`);
        button.classList.toggle("is-active", data.timeSpeedIndex === index);
      });

      speedSlider.value = `${data.timeSpeedValue}`;
      speedSlider.setAttribute(
        "title",
        `${data.simTimeMode === "incident" ? "Incident" : "Strategic"} time ${formatTimeSpeedValue(data.timeSpeedValue)}`
      );
      speedSliderValue.textContent = formatTimeSpeedValue(data.timeSpeedValue);

      const nextFireDisabled = data.skipToNextFireActive || !data.canSkipToNextFire;
      [buttonNextFireButton, sliderNextFireButton].forEach((nextFireButton) => {
        nextFireButton.disabled = nextFireDisabled;
        nextFireButton.textContent = data.skipToNextFireActive ? "Seeking..." : "Next Fire";
        if (data.skipToNextFireActive) {
          nextFireButton.setAttribute("title", "Advancing time to next fire incident.");
          nextFireButton.setAttribute("aria-label", "Seeking next fire");
        } else if (data.canSkipToNextFire) {
          nextFireButton.setAttribute("title", "Advance time until the next fire starts.");
          nextFireButton.setAttribute("aria-label", "Skip to next fire");
        } else {
          nextFireButton.setAttribute("title", "Available when no active or holdover fires remain.");
          nextFireButton.setAttribute("aria-label", "Skip to next fire unavailable");
        }
      });

      const pauseLabel = data.paused ? "Resume" : "Pause";
      [buttonPauseButton, sliderPauseButton].forEach((pauseButton) => {
        pauseButton.textContent = data.paused ? ">" : "||";
        pauseButton.setAttribute("aria-label", pauseLabel);
        pauseButton.setAttribute("title", pauseLabel);
      });

      status.textContent = data.status ?? "";
      refreshAudioControls();
    },
    onAudioMuteToggle: (handler) => {
      onAudioMuteToggleHandler = handler;
      refreshAudioControls();
    },
    onAudioVolumeChange: (handler) => {
      onAudioVolumeChangeHandler = handler;
      refreshAudioControls();
    },
    setAudioState: (settings) => {
      audioState = {
        muted: settings.muted,
        volume: Math.max(0, Math.min(1, settings.volume))
      };
      refreshAudioControls();
    },
    onWorldMuteToggle: (handler) => {
      onWorldMuteToggleHandler = handler;
      refreshAudioControls();
    },
    onWorldVolumeChange: (handler) => {
      onWorldVolumeChangeHandler = handler;
      refreshAudioControls();
    },
    setWorldState: (settings) => {
      worldState = {
        muted: settings.muted,
        volume: Math.max(0, Math.min(1, settings.volume))
      };
      refreshAudioControls();
    },
    onMusicMuteToggle: (handler) => {
      onMusicMuteToggleHandler = handler;
      refreshAudioControls();
    },
    onMusicVolumeChange: (handler) => {
      onMusicVolumeChangeHandler = handler;
      refreshAudioControls();
    },
    setMusicState: (settings) => {
      musicState = {
        muted: settings.muted,
        volume: Math.max(0, Math.min(1, settings.volume))
      };
      refreshAudioControls();
    },
    onRandomFireIgnitionToggle: (handler) => {
      onRandomFireIgnitionToggleHandler = handler;
      refreshSimulationToggles();
    },
    onAnnualReportToggle: (handler) => {
      onAnnualReportToggleHandler = handler;
      refreshSimulationToggles();
    },
    setSimulationToggleState: (settings) => {
      simulationToggleState = {
        randomFireIgnition: Boolean(settings.randomFireIgnition),
        annualReportEnabled: Boolean(settings.annualReportEnabled)
      };
      refreshSimulationToggles();
    }
  };
};
