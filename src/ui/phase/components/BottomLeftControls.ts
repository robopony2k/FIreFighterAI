import type { UiAudioSettings } from "../../../audio/uiAudio.js";
import { getTimeSpeedOptions } from "../../../core/config.js";
import {
  formatTimeSpeedValue,
  TIME_SPEED_SLIDER_MAX,
  TIME_SPEED_SLIDER_MIN,
  TIME_SPEED_SLIDER_STEP
} from "../../../core/timeSpeed.js";
import type { SimTimeMode, TimeSpeedControlMode } from "../../../core/types.js";

type ChannelSettings = {
  muted: boolean;
  volume: number;
};

export type BottomControlsData = {
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

export type BottomControlsView = {
  element: HTMLElement;
  update: (data: BottomControlsData) => void;
  onAudioMuteToggle: (handler: () => void) => void;
  onAudioVolumeChange: (handler: (value: number) => void) => void;
  setAudioState: (settings: UiAudioSettings) => void;
  onWorldMuteToggle: (handler: () => void) => void;
  onWorldVolumeChange: (handler: (value: number) => void) => void;
  setWorldState: (settings: ChannelSettings) => void;
  onMusicMuteToggle: (handler: () => void) => void;
  onMusicVolumeChange: (handler: (value: number) => void) => void;
  setMusicState: (settings: ChannelSettings) => void;
};

export const createBottomLeftControls = (): BottomControlsView => {
  const getDisplayedIndices = (mode: SimTimeMode): number[] => {
    const options = getTimeSpeedOptions(mode);
    const last = Math.max(0, options.length - 1);
    return [...new Set([0, Math.min(1, last), Math.min(2, last), last])];
  };
  const element = document.createElement("div");
  element.className = "phase-panel phase-bottom-controls";
  element.dataset.panel = "bottomControls";

  const timeGroup = document.createElement("div");
  timeGroup.className = "phase-control-group phase-time-group";
  const titleRow = document.createElement("div");
  titleRow.className = "phase-control-title";
  titleRow.textContent = "Strategic Time";

  const buttonSpeedRow = document.createElement("div");
  buttonSpeedRow.className = "phase-control-row phase-time-speed-row";
  buttonSpeedRow.innerHTML = `
    <button data-action="pause" aria-label="Pause" title="Pause">||</button>
    <button data-role="time-speed"></button>
    <button data-role="time-speed"></button>
    <button data-role="time-speed"></button>
    <button data-role="time-speed"></button>
    <button data-action="time-skip-next-fire" aria-label="Skip to Next Fire" title="Skip to Next Fire">Next Fire</button>
  `;

  const sliderSpeedRow = document.createElement("div");
  sliderSpeedRow.className = "phase-control-row phase-time-slider-row is-hidden";
  sliderSpeedRow.innerHTML = `
    <button data-action="pause" aria-label="Pause" title="Pause">||</button>
    <label class="phase-time-slider-field">
      <span class="phase-time-slider-caption">Speed</span>
      <input
        type="range"
        min="${TIME_SPEED_SLIDER_MIN}"
        max="${TIME_SPEED_SLIDER_MAX}"
        step="${TIME_SPEED_SLIDER_STEP}"
        value="1"
        data-action="time-speed-slider-set"
        data-role="time-speed-slider"
        aria-label="Time speed slider"
      />
    </label>
    <span class="phase-time-slider-value">1x</span>
    <button data-action="time-skip-next-fire" aria-label="Skip to Next Fire" title="Skip to Next Fire">Next Fire</button>
  `;
  timeGroup.append(titleRow, buttonSpeedRow, sliderSpeedRow);

  const createAudioRow = (): {
    row: HTMLDivElement;
    muteButton: HTMLButtonElement;
    volumeLabel: HTMLSpanElement;
    volumeSlider: HTMLInputElement;
  } => {
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

  const sfxControls = createAudioRow();
  const worldControls = createAudioRow();
  const musicControls = createAudioRow();
  timeGroup.append(sfxControls.row, worldControls.row, musicControls.row);

  const status = document.createElement("div");
  status.className = "phase-control-status";

  element.append(timeGroup, status);

  const buttonPauseButton = buttonSpeedRow.querySelector('[data-action="pause"]') as HTMLButtonElement;
  const sliderPauseButton = sliderSpeedRow.querySelector('[data-action="pause"]') as HTMLButtonElement;
  const buttonNextFireButton = buttonSpeedRow.querySelector('[data-action="time-skip-next-fire"]') as HTMLButtonElement;
  const sliderNextFireButton = sliderSpeedRow.querySelector('[data-action="time-skip-next-fire"]') as HTMLButtonElement;
  const speedButtons = Array.from(buttonSpeedRow.querySelectorAll<HTMLButtonElement>('[data-role="time-speed"]'));
  const speedSlider = sliderSpeedRow.querySelector('[data-role="time-speed-slider"]') as HTMLInputElement;
  const speedSliderValue = sliderSpeedRow.querySelector(".phase-time-slider-value") as HTMLSpanElement;

  let audioState: ChannelSettings = { muted: false, volume: 0.65 };
  let worldState: ChannelSettings = { muted: false, volume: 0.55 };
  let musicState: ChannelSettings = { muted: false, volume: 0.35 };
  let onAudioMuteToggleHandler: (() => void) | null = null;
  let onAudioVolumeChangeHandler: ((value: number) => void) | null = null;
  let onWorldMuteToggleHandler: (() => void) | null = null;
  let onWorldVolumeChangeHandler: ((value: number) => void) | null = null;
  let onMusicMuteToggleHandler: (() => void) | null = null;
  let onMusicVolumeChangeHandler: ((value: number) => void) | null = null;

  const setAudioControlsEnabled = (): void => {
    const sfxEnabled = onAudioMuteToggleHandler !== null && onAudioVolumeChangeHandler !== null;
    sfxControls.muteButton.disabled = !sfxEnabled;
    sfxControls.volumeSlider.disabled = !sfxEnabled || audioState.muted;

    const worldEnabled = onWorldMuteToggleHandler !== null && onWorldVolumeChangeHandler !== null;
    worldControls.muteButton.disabled = !worldEnabled;
    worldControls.volumeSlider.disabled = !worldEnabled || worldState.muted;

    const musicEnabled = onMusicMuteToggleHandler !== null && onMusicVolumeChangeHandler !== null;
    musicControls.muteButton.disabled = !musicEnabled;
    musicControls.volumeSlider.disabled = !musicEnabled || musicState.muted;
  };

  const refreshAudioControls = (): void => {
    const sfxVolumePct = Math.round(Math.max(0, Math.min(1, audioState.volume)) * 100);
    sfxControls.muteButton.textContent = audioState.muted ? "Unmute SFX" : "Mute SFX";
    sfxControls.muteButton.setAttribute("aria-pressed", audioState.muted ? "true" : "false");
    sfxControls.muteButton.setAttribute("title", audioState.muted ? "Unmute UI SFX" : "Mute UI SFX");
    sfxControls.volumeLabel.textContent = `SFX ${sfxVolumePct}%`;
    sfxControls.volumeSlider.value = audioState.volume.toFixed(2);

    const worldVolumePct = Math.round(Math.max(0, Math.min(1, worldState.volume)) * 100);
    worldControls.muteButton.textContent = worldState.muted ? "Unmute World" : "Mute World";
    worldControls.muteButton.setAttribute("aria-pressed", worldState.muted ? "true" : "false");
    worldControls.muteButton.setAttribute("title", worldState.muted ? "Unmute world audio" : "Mute world audio");
    worldControls.volumeLabel.textContent = `World ${worldVolumePct}%`;
    worldControls.volumeSlider.value = worldState.volume.toFixed(2);

    const musicVolumePct = Math.round(Math.max(0, Math.min(1, musicState.volume)) * 100);
    musicControls.muteButton.textContent = musicState.muted ? "Unmute Music" : "Mute Music";
    musicControls.muteButton.setAttribute("aria-pressed", musicState.muted ? "true" : "false");
    musicControls.muteButton.setAttribute("title", musicState.muted ? "Unmute music" : "Mute music");
    musicControls.volumeLabel.textContent = `Music ${musicVolumePct}%`;
    musicControls.volumeSlider.value = musicState.volume.toFixed(2);

    setAudioControlsEnabled();
  };

  sfxControls.muteButton.addEventListener("click", (event) => {
    event.preventDefault();
    onAudioMuteToggleHandler?.();
  });
  sfxControls.volumeSlider.addEventListener("input", () => {
    const next = Number(sfxControls.volumeSlider.value);
    if (!Number.isFinite(next)) {
      return;
    }
    onAudioVolumeChangeHandler?.(next);
  });

  worldControls.muteButton.addEventListener("click", (event) => {
    event.preventDefault();
    onWorldMuteToggleHandler?.();
  });
  worldControls.volumeSlider.addEventListener("input", () => {
    const next = Number(worldControls.volumeSlider.value);
    if (!Number.isFinite(next)) {
      return;
    }
    onWorldVolumeChangeHandler?.(next);
  });

  musicControls.muteButton.addEventListener("click", (event) => {
    event.preventDefault();
    onMusicMuteToggleHandler?.();
  });
  musicControls.volumeSlider.addEventListener("input", () => {
    const next = Number(musicControls.volumeSlider.value);
    if (!Number.isFinite(next)) {
      return;
    }
    onMusicVolumeChangeHandler?.(next);
  });
  refreshAudioControls();

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
        button.dataset.action = `time-speed-${index}`;
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
      setAudioControlsEnabled();
    },
    onAudioVolumeChange: (handler) => {
      onAudioVolumeChangeHandler = handler;
      setAudioControlsEnabled();
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
      setAudioControlsEnabled();
    },
    onWorldVolumeChange: (handler) => {
      onWorldVolumeChangeHandler = handler;
      setAudioControlsEnabled();
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
      setAudioControlsEnabled();
    },
    onMusicVolumeChange: (handler) => {
      onMusicVolumeChangeHandler = handler;
      setAudioControlsEnabled();
    },
    setMusicState: (settings) => {
      musicState = {
        muted: settings.muted,
        volume: Math.max(0, Math.min(1, settings.volume))
      };
      refreshAudioControls();
    }
  };
};
