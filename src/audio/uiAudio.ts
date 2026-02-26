import { loadAudioSettings, saveAudioSettings, type AudioSettingsRecord } from "../persistence/audioSettings.js";

export type UiAudioCue = "hover" | "click" | "toggle" | "confirm";

export type UiAudioSettings = {
  muted: boolean;
  volume: number;
};

export type UiAudioController = {
  unlock: () => void;
  play: (cue: UiAudioCue) => void;
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
  toggleMuted: () => void;
  getSettings: () => UiAudioSettings;
  onChange: (listener: (settings: UiAudioSettings) => void) => () => void;
};

const DEFAULT_SETTINGS: UiAudioSettings = {
  muted: false,
  volume: 0.65
};

const CUE_FILES: Record<UiAudioCue, string[]> = {
  hover: ["/assets/audio/rollover4.ogg"],
  click: ["/assets/audio/mouseclick1.ogg", "/assets/audio/click3.ogg"],
  toggle: ["/assets/audio/switch1.ogg"],
  confirm: ["/assets/audio/correct.ogg"]
};

const CUE_GAIN: Record<UiAudioCue, number> = {
  hover: 0.38,
  click: 0.72,
  toggle: 0.8,
  confirm: 0.85
};

const CUE_COOLDOWN_MS: Record<UiAudioCue, number> = {
  hover: 180,
  click: 42,
  toggle: 55,
  confirm: 65
};

const GLOBAL_COOLDOWN_MS = 16;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const sanitizeSettings = (settings: AudioSettingsRecord | UiAudioSettings): UiAudioSettings => ({
  muted: Boolean(settings.muted),
  volume: clamp01(Number.isFinite(settings.volume) ? settings.volume : DEFAULT_SETTINGS.volume)
});

const getAudioContextCtor = (): typeof AudioContext | null => {
  if (typeof window === "undefined") {
    return null;
  }
  const withWebkit = window as typeof window & {
    webkitAudioContext?: typeof AudioContext;
  };
  return window.AudioContext ?? withWebkit.webkitAudioContext ?? null;
};

export const createUiAudioController = (): UiAudioController => {
  let settings = sanitizeSettings(loadAudioSettings());
  const listeners = new Set<(next: UiAudioSettings) => void>();
  const warnedSources = new Set<string>();
  const cueBuffers = new Map<string, Promise<AudioBuffer | null>>();
  const cuePlayedAt = new Map<UiAudioCue, number>();

  let lastAnyPlayAt = -Infinity;
  let context: AudioContext | null = null;
  let masterGain: GainNode | null = null;
  let firstGestureBound = false;
  let resumeWarned = false;

  const notify = (): void => {
    const snapshot = { ...settings };
    listeners.forEach((listener) => listener(snapshot));
  };

  const applyMasterGain = (): void => {
    if (!masterGain || !context) {
      return;
    }
    const nextGain = settings.muted ? 0 : settings.volume;
    masterGain.gain.setValueAtTime(nextGain, context.currentTime);
  };

  const ensureContext = (): AudioContext | null => {
    if (context) {
      return context;
    }
    const AudioContextCtor = getAudioContextCtor();
    if (!AudioContextCtor) {
      return null;
    }
    try {
      context = new AudioContextCtor();
      masterGain = context.createGain();
      masterGain.connect(context.destination);
      applyMasterGain();
      return context;
    } catch (error) {
      console.warn("[uiAudio] AudioContext creation failed.", error);
      context = null;
      masterGain = null;
      return null;
    }
  };

  const decodeCueBuffer = async (source: string): Promise<AudioBuffer | null> => {
    const audioContext = ensureContext();
    if (!audioContext) {
      return null;
    }
    try {
      const response = await fetch(source);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.arrayBuffer();
      return await audioContext.decodeAudioData(data.slice(0));
    } catch (error) {
      if (!warnedSources.has(source)) {
        warnedSources.add(source);
        console.warn(`[uiAudio] Failed to load cue source "${source}".`, error);
      }
      return null;
    }
  };

  const getCueBuffer = (source: string): Promise<AudioBuffer | null> => {
    const existing = cueBuffers.get(source);
    if (existing) {
      return existing;
    }
    const created = decodeCueBuffer(source);
    cueBuffers.set(source, created);
    return created;
  };

  const getCueSource = (cue: UiAudioCue): string => {
    const variants = CUE_FILES[cue];
    if (variants.length <= 1) {
      return variants[0];
    }
    const index = Math.floor(Math.random() * variants.length);
    return variants[index] ?? variants[0];
  };

  const unlock = (): void => {
    const audioContext = ensureContext();
    if (!audioContext || audioContext.state !== "suspended") {
      return;
    }
    void audioContext.resume().catch((error) => {
      if (!resumeWarned) {
        resumeWarned = true;
        console.warn("[uiAudio] AudioContext resume failed.", error);
      }
    });
  };

  const bindFirstGestureUnlock = (): void => {
    if (firstGestureBound || typeof window === "undefined") {
      return;
    }
    firstGestureBound = true;
    const onFirstGesture = (): void => {
      unlock();
      window.removeEventListener("pointerdown", onFirstGesture, true);
      window.removeEventListener("keydown", onFirstGesture, true);
    };
    window.addEventListener("pointerdown", onFirstGesture, true);
    window.addEventListener("keydown", onFirstGesture, true);
  };

  const isCueThrottled = (cue: UiAudioCue, now: number): boolean => {
    if (now - lastAnyPlayAt < GLOBAL_COOLDOWN_MS) {
      return true;
    }
    const lastCueAt = cuePlayedAt.get(cue) ?? -Infinity;
    if (now - lastCueAt < CUE_COOLDOWN_MS[cue]) {
      return true;
    }
    return false;
  };

  const play = (cue: UiAudioCue): void => {
    if (settings.muted || settings.volume <= 0) {
      return;
    }
    const now = performance.now();
    if (isCueThrottled(cue, now)) {
      return;
    }
    unlock();
    const audioContext = ensureContext();
    if (!audioContext || !masterGain) {
      return;
    }
    if (audioContext.state !== "running") {
      return;
    }
    cuePlayedAt.set(cue, now);
    lastAnyPlayAt = now;
    const cueSource = getCueSource(cue);
    void getCueBuffer(cueSource).then((buffer) => {
      if (!buffer || !context || !masterGain) {
        return;
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      const cueGain = context.createGain();
      cueGain.gain.value = CUE_GAIN[cue];
      source.connect(cueGain);
      cueGain.connect(masterGain);
      source.start(0);
    });
  };

  const setMuted = (muted: boolean): void => {
    const nextMuted = Boolean(muted);
    if (settings.muted === nextMuted) {
      return;
    }
    settings = { ...settings, muted: nextMuted };
    applyMasterGain();
    saveAudioSettings(settings);
    notify();
  };

  const setVolume = (volume: number): void => {
    const nextVolume = clamp01(volume);
    if (Math.abs(settings.volume - nextVolume) < 0.0001) {
      return;
    }
    settings = { ...settings, volume: nextVolume };
    applyMasterGain();
    saveAudioSettings(settings);
    notify();
  };

  const toggleMuted = (): void => {
    setMuted(!settings.muted);
  };

  const getSettings = (): UiAudioSettings => ({ ...settings });

  const onChange = (listener: (next: UiAudioSettings) => void): (() => void) => {
    listeners.add(listener);
    listener(getSettings());
    return () => {
      listeners.delete(listener);
    };
  };

  bindFirstGestureUnlock();

  return {
    unlock,
    play,
    setMuted,
    setVolume,
    toggleMuted,
    getSettings,
    onChange
  };
};
