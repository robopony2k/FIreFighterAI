import type { UiAudioSettings } from "../../../audio/uiAudio.js";

type ChannelSettings = {
  muted: boolean;
  volume: number;
};

export type BottomControlsData = {
  showTimeControls: boolean;
  showSpeedControl: boolean;
  paused: boolean;
  timeSpeedIndex: number;
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
  onMusicMuteToggle: (handler: () => void) => void;
  onMusicVolumeChange: (handler: (value: number) => void) => void;
  setMusicState: (settings: ChannelSettings) => void;
};

export const createBottomLeftControls = (): BottomControlsView => {
  const element = document.createElement("div");
  element.className = "phase-panel phase-bottom-controls";
  element.dataset.panel = "bottomControls";

  const timeGroup = document.createElement("div");
  timeGroup.className = "phase-control-group phase-time-group";
  const titleRow = document.createElement("div");
  titleRow.className = "phase-control-title";
  titleRow.textContent = "Time";
  const speedRow = document.createElement("div");
  speedRow.className = "phase-control-row phase-time-speed-row";
  speedRow.innerHTML = `
    <button data-action="pause" aria-label="Pause" title="Pause">||</button>
    <button data-action="time-speed-0" data-speed-index="0" aria-label="Speed 0.5x" title="Speed 0.5x">0.5x</button>
    <button data-action="time-speed-1" data-speed-index="1" aria-label="Speed 1x" title="Speed 1x">1x</button>
    <button data-action="time-speed-2" data-speed-index="2" aria-label="Speed 2x" title="Speed 2x">2x</button>
    <button data-action="time-speed-8" data-speed-index="8" aria-label="Speed Max" title="Speed Max">MAX</button>
    <button data-action="time-skip-next-fire" aria-label="Skip to Next Fire" title="Skip to Next Fire">Next Fire</button>
  `;
  timeGroup.append(titleRow, speedRow);

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
  const musicControls = createAudioRow();
  timeGroup.append(sfxControls.row, musicControls.row);

  const status = document.createElement("div");
  status.className = "phase-control-status";

  element.append(timeGroup, status);

  const pauseButton = speedRow.querySelector('[data-action="pause"]') as HTMLButtonElement;
  const nextFireButton = speedRow.querySelector('[data-action="time-skip-next-fire"]') as HTMLButtonElement;
  const speedButtons = Array.from(speedRow.querySelectorAll<HTMLButtonElement>("[data-speed-index]"));
  let audioState: ChannelSettings = { muted: false, volume: 0.65 };
  let musicState: ChannelSettings = { muted: false, volume: 0.35 };
  let onAudioMuteToggleHandler: (() => void) | null = null;
  let onAudioVolumeChangeHandler: ((value: number) => void) | null = null;
  let onMusicMuteToggleHandler: (() => void) | null = null;
  let onMusicVolumeChangeHandler: ((value: number) => void) | null = null;

  const setAudioControlsEnabled = (): void => {
    const sfxEnabled = onAudioMuteToggleHandler !== null && onAudioVolumeChangeHandler !== null;
    sfxControls.muteButton.disabled = !sfxEnabled;
    sfxControls.volumeSlider.disabled = !sfxEnabled || audioState.muted;

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
      timeGroup.classList.toggle("is-hidden", !data.showTimeControls);
      speedRow.classList.toggle("is-hidden", !data.showSpeedControl);
      speedButtons.forEach((button) => {
        const index = Number(button.dataset.speedIndex ?? 0);
        button.classList.toggle("is-active", data.timeSpeedIndex === index);
      });
      const nextFireDisabled = data.skipToNextFireActive || !data.canSkipToNextFire;
      nextFireButton.disabled = nextFireDisabled;
      nextFireButton.textContent = data.skipToNextFireActive ? "Seeking..." : "Next Fire";
      if (data.skipToNextFireActive) {
        nextFireButton.setAttribute("title", "Advancing time to next fire incident.");
        nextFireButton.setAttribute("aria-label", "Seeking next fire");
      } else if (data.canSkipToNextFire) {
        nextFireButton.setAttribute("title", "Advance time until the next fire starts.");
        nextFireButton.setAttribute("aria-label", "Skip to next fire");
      } else {
        nextFireButton.setAttribute("title", "Available when no fires are currently active.");
        nextFireButton.setAttribute("aria-label", "Skip to next fire unavailable");
      }
      const pauseLabel = data.paused ? "Resume" : "Pause";
      pauseButton.textContent = data.paused ? ">" : "||";
      pauseButton.setAttribute("aria-label", pauseLabel);
      pauseButton.setAttribute("title", pauseLabel);
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
