import type { Phase } from "../ui/phase/types.js";

type MusicScene = "menu" | "growth" | "maintenance" | "fire" | "budget" | "victory" | "defeat";

type TrackId = "menu" | "growth" | "maintenance" | "fire" | "budget" | "victory" | "defeat";

type TrackConfig = {
  file: string;
  loop: boolean;
  gain: number;
};

type SourceCandidate = {
  url: string;
  mime: string;
};

export type MusicController = {
  unlock: () => void;
  setPhase: (phase: Phase) => void;
  setMenuActive: (active: boolean) => void;
  setGameOver: (outcome: "victory" | "defeat") => void;
  clearGameOver: () => void;
  stop: () => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  dispose: () => void;
};

const TRACKS: Record<TrackId, TrackConfig> = {
  menu: { file: "Creeping Ember Loop.mp3", loop: true, gain: 0.48 },
  growth: { file: "Creeping Ember Loop.mp3", loop: true, gain: 0.45 },
  maintenance: { file: "Creeping Ember Loop.mp3", loop: true, gain: 0.5 },
  fire: { file: "Creeping Ember Loop (1).mp3", loop: true, gain: 0.58 },
  budget: { file: "Creeping Ember Loop.mp3", loop: true, gain: 0.5 },
  victory: { file: "Creeping Ember Loop.mp3", loop: true, gain: 0.52 },
  defeat: { file: "Creeping Ember Loop (1).mp3", loop: true, gain: 0.5 }
};

const SCENE_TO_TRACK: Record<MusicScene, TrackId> = {
  menu: "menu",
  growth: "growth",
  maintenance: "maintenance",
  fire: "fire",
  budget: "budget",
  victory: "victory",
  defeat: "defeat"
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const toEncodedMusicPath = (fileName: string): string => {
  const encodedFile = encodeURIComponent(fileName).replace(/%2F/gi, "/");
  return `/assets/audio/music/${encodedFile}`;
};

const getFileExtension = (fileName: string): string => {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot < 0 || lastDot === fileName.length - 1) {
    return "";
  }
  return fileName.slice(lastDot + 1).toLowerCase();
};

const extensionMimeMap: Record<string, string> = {
  mid: "audio/midi",
  midi: "audio/midi",
  ogg: "audio/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav"
};

const isMidExtension = (extension: string): boolean => extension === "mid" || extension === "midi";

const buildTrackSources = (fileName: string): SourceCandidate[] => {
  const ext = getFileExtension(fileName);
  const mime = extensionMimeMap[ext];
  if (mime) {
    return [{ url: toEncodedMusicPath(fileName), mime }];
  }
  return [{ url: toEncodedMusicPath(fileName), mime: "audio/*" }];
};

const canPlayMime = (probe: HTMLAudioElement, mime: string): boolean => {
  try {
    const verdict = probe.canPlayType(mime);
    return verdict === "probably" || verdict === "maybe";
  } catch {
    return false;
  }
};

export const createMusicController = (): MusicController => {
  const audioByTrack = new Map<TrackId, HTMLAudioElement>();
  const warnedTracks = new Set<TrackId>();
  const trackSourceById = new Map<TrackId, SourceCandidate>();
  const probe = typeof Audio !== "undefined" ? new Audio() : null;
  let musicDisabled = false;
  let unsupportedMidiWarned = false;

  let currentTrackId: TrackId | null = null;
  let currentScene: MusicScene | null = null;
  let pendingTrackId: TrackId | null = null;
  let menuActive = true;
  let gameOutcome: "victory" | "defeat" | null = null;
  let phase: Phase = "maintenance";

  let unlocked = false;
  let muted = false;
  let volume = 0.35;
  let bindUnlock = true;

  const disableMusic = (reason: string): void => {
    if (musicDisabled) {
      return;
    }
    musicDisabled = true;
    pendingTrackId = null;
    currentTrackId = null;
    currentScene = null;
    if (!unsupportedMidiWarned) {
      unsupportedMidiWarned = true;
      console.warn(`[music] ${reason}`);
    }
  };

  const applyElementVolume = (trackId: TrackId): void => {
    const audio = audioByTrack.get(trackId);
    if (!audio) {
      return;
    }
    const gain = TRACKS[trackId].gain;
    audio.volume = muted ? 0 : clamp01(volume * gain);
    audio.muted = muted;
  };

  const resolveTrackSource = (trackId: TrackId): SourceCandidate | null => {
    const cached = trackSourceById.get(trackId);
    if (cached) {
      return cached;
    }
    const track = TRACKS[trackId];
    const candidates = buildTrackSources(track.file);
    if (!probe) {
      const fallback = candidates[0] ?? null;
      if (fallback) {
        trackSourceById.set(trackId, fallback);
      }
      return fallback;
    }
    const supported = candidates.find((candidate) => canPlayMime(probe, candidate.mime)) ?? null;
    if (supported) {
      trackSourceById.set(trackId, supported);
    }
    return supported;
  };

  const ensureAudio = (trackId: TrackId): HTMLAudioElement | null => {
    const existing = audioByTrack.get(trackId);
    if (existing) {
      return existing;
    }
    const source = resolveTrackSource(trackId);
    if (!source) {
      const track = TRACKS[trackId];
      const ext = getFileExtension(track.file);
      if (isMidExtension(ext)) {
        disableMusic("Browser does not support MIDI audio playback. Convert music tracks to .ogg/.mp3 for web playback.");
      } else if (!warnedTracks.has(trackId)) {
        warnedTracks.add(trackId);
        console.warn(`[music] No playable source for "${trackId}" (${track.file}).`);
      }
      return null;
    }
    const track = TRACKS[trackId];
    const audio = new Audio(source.url);
    audio.loop = track.loop;
    audio.preload = "auto";
    audio.crossOrigin = "anonymous";
    applyElementVolume(trackId);
    audioByTrack.set(trackId, audio);
    return audio;
  };

  const pauseTrack = (trackId: TrackId): void => {
    const audio = audioByTrack.get(trackId);
    if (!audio) {
      return;
    }
    audio.pause();
    audio.currentTime = 0;
  };

  const tryPlayTrack = (trackId: TrackId): void => {
    if (musicDisabled) {
      return;
    }
    const audio = ensureAudio(trackId);
    if (!audio) {
      return;
    }
    applyElementVolume(trackId);
    if (!unlocked) {
      pendingTrackId = trackId;
      return;
    }
    const requestedTrackId = trackId;
    void audio.play().catch((error) => {
      if (musicDisabled) {
        return;
      }
      const namedError = error as { name?: string };
      if (namedError?.name === "AbortError") {
        return;
      }
      if (currentTrackId !== requestedTrackId) {
        return;
      }
      pendingTrackId = requestedTrackId;
      if (!warnedTracks.has(trackId)) {
        warnedTracks.add(trackId);
        console.warn(`[music] Unable to play track "${trackId}" (${TRACKS[trackId].file}).`, error);
      }
      if (namedError?.name === "NotSupportedError") {
        const ext = getFileExtension(TRACKS[trackId].file);
        if (isMidExtension(ext)) {
          disableMusic("MIDI files are not supported by this browser audio pipeline. Convert tracks to .ogg/.mp3.");
        }
      }
    });
  };

  const setTrack = (trackId: TrackId): void => {
    if (musicDisabled) {
      return;
    }
    if (currentTrackId === trackId) {
      applyElementVolume(trackId);
      return;
    }
    if (currentTrackId) {
      pauseTrack(currentTrackId);
    }
    currentTrackId = trackId;
    tryPlayTrack(trackId);
  };

  const resolveScene = (): MusicScene => {
    if (menuActive) {
      return "menu";
    }
    if (gameOutcome) {
      return gameOutcome;
    }
    return phase;
  };

  const syncScene = (): void => {
    if (musicDisabled) {
      return;
    }
    const nextScene = resolveScene();
    if (nextScene === currentScene) {
      return;
    }
    currentScene = nextScene;
    setTrack(SCENE_TO_TRACK[nextScene]);
  };

  const unlock = (): void => {
    if (musicDisabled) {
      return;
    }
    if (unlocked) {
      return;
    }
    unlocked = true;
    if (pendingTrackId) {
      const pending = pendingTrackId;
      pendingTrackId = null;
      tryPlayTrack(pending);
    } else if (currentTrackId) {
      tryPlayTrack(currentTrackId);
    } else {
      syncScene();
    }
  };

  const onFirstGesture = (): void => {
    unlock();
    if (!bindUnlock) {
      return;
    }
    bindUnlock = false;
    window.removeEventListener("pointerdown", onFirstGesture, true);
    window.removeEventListener("keydown", onFirstGesture, true);
  };

  if (typeof window !== "undefined") {
    window.addEventListener("pointerdown", onFirstGesture, true);
    window.addEventListener("keydown", onFirstGesture, true);
  }

  syncScene();

  return {
    unlock,
    setPhase: (nextPhase) => {
      phase = nextPhase;
      if (!gameOutcome) {
        syncScene();
      }
    },
    setMenuActive: (active) => {
      if (menuActive === active) {
        return;
      }
      menuActive = active;
      syncScene();
    },
    setGameOver: (outcome) => {
      if (musicDisabled) {
        return;
      }
      gameOutcome = outcome;
      syncScene();
    },
    clearGameOver: () => {
      if (musicDisabled) {
        return;
      }
      gameOutcome = null;
      syncScene();
    },
    stop: () => {
      if (currentTrackId) {
        pauseTrack(currentTrackId);
      }
      currentTrackId = null;
      currentScene = null;
      pendingTrackId = null;
    },
    setVolume: (nextVolume) => {
      volume = clamp01(nextVolume);
      if (musicDisabled) {
        return;
      }
      if (currentTrackId) {
        applyElementVolume(currentTrackId);
      }
    },
    setMuted: (nextMuted) => {
      muted = nextMuted;
      if (musicDisabled) {
        return;
      }
      if (currentTrackId) {
        applyElementVolume(currentTrackId);
      }
    },
    dispose: () => {
      if (bindUnlock && typeof window !== "undefined") {
        bindUnlock = false;
        window.removeEventListener("pointerdown", onFirstGesture, true);
        window.removeEventListener("keydown", onFirstGesture, true);
      }
      audioByTrack.forEach((audio) => {
        audio.pause();
      });
      audioByTrack.clear();
      currentTrackId = null;
      currentScene = null;
      pendingTrackId = null;
    }
  };
};
