export type AudioSettingsRecord = {
  muted: boolean;
  volume: number;
};

export type WorldAudioSettings = AudioSettingsRecord;

const UI_AUDIO_SETTINGS_KEY = "fireline.uiAudio";
const MUSIC_AUDIO_SETTINGS_KEY = "fireline.musicAudio";
const WORLD_AUDIO_SETTINGS_KEY = "fireline.worldAudio";

const DEFAULT_UI_AUDIO_SETTINGS: AudioSettingsRecord = {
  muted: false,
  volume: 0.65
};
const DEFAULT_MUSIC_AUDIO_SETTINGS: AudioSettingsRecord = {
  muted: false,
  volume: 0.35
};
const DEFAULT_WORLD_AUDIO_SETTINGS: WorldAudioSettings = {
  muted: false,
  volume: 0.55
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const sanitizeAudioSettings = (value: unknown, defaults: AudioSettingsRecord): AudioSettingsRecord => {
  if (!isRecord(value)) {
    return { ...defaults };
  }
  const muted = typeof value.muted === "boolean" ? value.muted : defaults.muted;
  const parsedVolume = toFiniteNumber(value.volume);
  const volume = parsedVolume === null ? defaults.volume : clamp01(parsedVolume);
  return { muted, volume };
};

const loadSettings = (key: string, defaults: AudioSettingsRecord): AudioSettingsRecord => {
  if (typeof localStorage === "undefined") {
    return { ...defaults };
  }
  const raw = localStorage.getItem(key);
  if (!raw) {
    return { ...defaults };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return sanitizeAudioSettings(parsed, defaults);
  } catch {
    return { ...defaults };
  }
};

const saveSettings = (key: string, settings: AudioSettingsRecord, defaults: AudioSettingsRecord): void => {
  if (typeof localStorage === "undefined") {
    return;
  }
  const sanitized = sanitizeAudioSettings(settings, defaults);
  localStorage.setItem(key, JSON.stringify(sanitized));
};

export const loadAudioSettings = (): AudioSettingsRecord =>
  loadSettings(UI_AUDIO_SETTINGS_KEY, DEFAULT_UI_AUDIO_SETTINGS);

export const saveAudioSettings = (settings: AudioSettingsRecord): void =>
  saveSettings(UI_AUDIO_SETTINGS_KEY, settings, DEFAULT_UI_AUDIO_SETTINGS);

export const loadMusicAudioSettings = (): AudioSettingsRecord =>
  loadSettings(MUSIC_AUDIO_SETTINGS_KEY, DEFAULT_MUSIC_AUDIO_SETTINGS);

export const saveMusicAudioSettings = (settings: AudioSettingsRecord): void =>
  saveSettings(MUSIC_AUDIO_SETTINGS_KEY, settings, DEFAULT_MUSIC_AUDIO_SETTINGS);

export const loadWorldAudioSettings = (): WorldAudioSettings =>
  loadSettings(WORLD_AUDIO_SETTINGS_KEY, DEFAULT_WORLD_AUDIO_SETTINGS);

export const saveWorldAudioSettings = (settings: WorldAudioSettings): void =>
  saveSettings(WORLD_AUDIO_SETTINGS_KEY, settings, DEFAULT_WORLD_AUDIO_SETTINGS);
