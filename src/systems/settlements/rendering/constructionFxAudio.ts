import * as THREE from "three";

export type ConstructionFxAudioControls = {
  getSettings: () => { muted: boolean; volume: number };
};

export type ConstructionFxAudioCue = {
  timeMs: number;
  worldX: number;
  worldY: number;
  worldZ: number;
  tileSpan: number;
  gainScale: number;
  seed: number;
};

export type ConstructionFxAudioEmitter = {
  resume: () => void;
  play: (cue: ConstructionFxAudioCue) => void;
  dispose: () => void;
};

const MIN_SOUND_GAP_MS = 520;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const clamp01 = (value: number): number => clamp(value, 0, 1);
const fract = (value: number): number => value - Math.floor(value);
const hash01 = (value: number): number => fract(Math.sin(value * 12.9898 + 78.233) * 43758.5453);

const getAudioContextCtor = (): typeof AudioContext | null => {
  if (typeof window === "undefined") {
    return null;
  }
  const withWebkit = window as typeof window & { webkitAudioContext?: typeof AudioContext };
  return window.AudioContext ?? withWebkit.webkitAudioContext ?? null;
};

export const createConstructionFxAudioEmitter = (
  camera: THREE.Camera,
  audioControls: ConstructionFxAudioControls | null
): ConstructionFxAudioEmitter => {
  let audioContext: AudioContext | null = null;
  let noiseBuffer: AudioBuffer | null = null;
  let lastSoundAtMs = -Infinity;
  const cameraForward = new THREE.Vector3();
  const cameraRight = new THREE.Vector3();
  const cameraUp = new THREE.Vector3(0, 1, 0);
  const soundPosition = new THREE.Vector3();

  const ensureAudioContext = (): AudioContext | null => {
    if (!audioControls) {
      return null;
    }
    if (audioContext) {
      return audioContext;
    }
    const AudioContextCtor = getAudioContextCtor();
    if (!AudioContextCtor) {
      return null;
    }
    try {
      audioContext = new AudioContextCtor();
    } catch (error) {
      console.warn("[constructionFx] AudioContext creation failed.", error);
      audioContext = null;
    }
    return audioContext;
  };

  const getNoiseBuffer = (context: AudioContext): AudioBuffer => {
    if (noiseBuffer && noiseBuffer.sampleRate === context.sampleRate) {
      return noiseBuffer;
    }
    const durationSeconds = 0.24;
    const length = Math.max(1, Math.floor(context.sampleRate * durationSeconds));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let i = 0; i < length; i += 1) {
      const decay = 1 - i / length;
      previous = previous * 0.72 + (Math.random() * 2 - 1) * 0.28;
      data[i] = previous * decay;
    }
    noiseBuffer = buffer;
    return buffer;
  };

  const play = (cue: ConstructionFxAudioCue): void => {
    if (!audioControls || cue.timeMs - lastSoundAtMs < MIN_SOUND_GAP_MS) {
      return;
    }
    const settings = audioControls.getSettings();
    if (settings.muted || settings.volume <= 0.001) {
      return;
    }
    const context = ensureAudioContext();
    if (!context || context.state !== "running") {
      return;
    }
    soundPosition.set(cue.worldX, cue.worldY, cue.worldZ);
    const distance = soundPosition.distanceTo(camera.position);
    const distanceGain = clamp01(1 - distance / Math.max(cue.tileSpan * 36, 1));
    if (distanceGain <= 0.02) {
      return;
    }
    camera.getWorldDirection(cameraForward);
    cameraRight.crossVectors(cameraForward, cameraUp).normalize();
    const pan = clamp(
      soundPosition.clone().sub(camera.position).dot(cameraRight) / Math.max(cue.tileSpan * 16, 1),
      -0.75,
      0.75
    );
    const source = context.createBufferSource();
    source.buffer = getNoiseBuffer(context);
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 420 + hash01(cue.seed + cue.timeMs * 0.001) * 320;
    filter.Q.value = 0.82;
    const gain = context.createGain();
    const now = context.currentTime;
    const volume = clamp(settings.volume, 0, 1) * distanceGain * cue.gainScale * 0.038;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    const panner = typeof context.createStereoPanner === "function" ? context.createStereoPanner() : null;
    if (panner) {
      panner.pan.value = pan;
      source.connect(filter).connect(gain).connect(panner).connect(context.destination);
    } else {
      source.connect(filter).connect(gain).connect(context.destination);
    }
    source.start(now);
    source.stop(now + 0.22);
    lastSoundAtMs = cue.timeMs;
  };

  return {
    resume: (): void => {
      const context = ensureAudioContext();
      if (context?.state === "suspended") {
        void context.resume().catch((error) => {
          console.warn("[constructionFx] AudioContext resume failed.", error);
        });
      }
    },
    play,
    dispose: (): void => {
      if (audioContext) {
        void audioContext.close().catch(() => undefined);
        audioContext = null;
      }
    }
  };
};
