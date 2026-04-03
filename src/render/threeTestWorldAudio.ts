import * as THREE from "three";
import type { RenderSim } from "./simView.js";
import type { FireAudioClusterSnapshot } from "./threeTestFireFx.js";
import type { TerrainRenderSurface } from "./threeTestTerrain.js";
import {
  assignFireAudioEmitterSlots,
  clamp01,
  computeDistanceAttenuation,
  computeFireDistanceGain,
  computeTerrainOcclusion01,
  computeWindLoudnessGain,
  selectPrioritizedFireAudioClusters,
  smoothstep,
  type FireAudioClusterCandidate,
  type FireAudioEmitterMemory,
  type HeightOcclusionSample
} from "./threeTestWorldAudioMath.js";

type WorldAudioSettings = {
  muted: boolean;
  volume: number;
};

export type WorldAudioChannelControls = {
  getSettings: () => WorldAudioSettings;
  toggleMuted: () => void;
  setVolume: (value: number) => void;
  onChange: (listener: (settings: WorldAudioSettings) => void) => () => void;
};

export type ThreeTestWorldAudio = {
  setRunning: (active: boolean) => void;
  update: (
    timeMs: number,
    deltaSeconds: number,
    world: RenderSim,
    terrainSurface: TerrainRenderSurface | null,
    fireClusters: readonly FireAudioClusterSnapshot[],
    simulationAlpha: number
  ) => void;
  dispose: () => void;
};

const MAX_FIRE_EMITTERS = 10;
const MAX_SIREN_EMITTERS = 3;
const FIRE_LAYER_SWITCH_SECONDS = 0.12;
const FIRE_LAYER_FADE_SECONDS = 0.18;
const FIRE_HEARING_DISTANCE_TILES = 68;
const FIRE_CONTINUITY_DISTANCE_TILES = 12;
const SIREN_HEARING_DISTANCE_TILES = 90;
const TERRAIN_OCCLUSION_SAMPLES = 8;
const TERRAIN_OCCLUSION_CLEARANCE_TILES = 0.65;
const FIRE_TRANSIENT_RATE = 1.2;
const FIRE_TRANSIENT_GAIN = 0.3;
const FIRE_TRANSIENT_HIGH_GAIN = 0.44;
const FIRE_OCCLUSION_FALL_RATE = 3.4;
const FIRE_OCCLUSION_RISE_RATE = 7.2;
const SIREN_OCCLUSION_FALL_RATE = 2.8;
const SIREN_OCCLUSION_RISE_RATE = 5.2;
const FIRE_POSITION_RESPONSE = 7;
const FIRE_INTENSITY_RESPONSE = 5.5;
const SIREN_GAIN_RESPONSE = 6.5;
const WORLD_AUDIO_ROLL_OFF_MIN = 900;
const WORLD_AUDIO_ROLL_OFF_MAX = 18000;
const SIREN_Y_OFFSET = 0.16;
const SIREN_LOOP_START_SECONDS = 0;
const SIREN_LOOP_END_SECONDS = 26.4;
const FIRE_Y_OFFSET = 0.06;
const FIRE_BASE_GAIN = 0.64;
const FIRE_MID_GAIN = 0.42;
const FIRE_HIGH_GAIN = 0.34;
const FIRE_BUS_GAIN = 0.96;
const SIREN_BUS_GAIN = 0.54;
const FIRE_SMALL_LOOP = "/assets/audio/fire_small_01.wav";
const FIRE_MEDIUM_LOOP = "/assets/audio/fire_medium_01.wav";
const FIRE_LARGE_LOOP = "/assets/audio/fire_large_01.wav";
const FIRE_MEDIUM_ACCENT = "/assets/audio/fire_medium_02.wav";
const FIRE_LARGE_ACCENT = "/assets/audio/fire_large_02.wav";
const FIRE_CRACKLE_SOURCES = ["/assets/audio/fire_crack_01.wav", "/assets/audio/fire_crack_02.wav"] as const;
const FIRE_SIREN_LOOP = "/assets/audio/firetruck_siren_loop.wav";
const WORLD_AUDIO_SOURCES = [
  FIRE_SMALL_LOOP,
  FIRE_MEDIUM_LOOP,
  FIRE_LARGE_LOOP,
  FIRE_MEDIUM_ACCENT,
  FIRE_LARGE_ACCENT,
  ...FIRE_CRACKLE_SOURCES,
  FIRE_SIREN_LOOP
] as const;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const hash01 = (value: number): number => {
  const x = Math.sin(value * 127.1) * 43758.5453123;
  return x - Math.floor(x);
};
const smoothApproach = (current: number, target: number, riseRate: number, fallRate: number, dtSeconds: number): number => {
  const rate = target >= current ? riseRate : fallRate;
  const alpha = 1 - Math.exp(-Math.max(0, rate) * Math.max(0, dtSeconds));
  return current + (target - current) * alpha;
};
const getAudioContextCtor = (): typeof AudioContext | null => {
  if (typeof window === "undefined") {
    return null;
  }
  const withWebkit = window as typeof window & { webkitAudioContext?: typeof AudioContext };
  return window.AudioContext ?? withWebkit.webkitAudioContext ?? null;
};
const getTileSpan = (terrainSurface: TerrainRenderSurface): number =>
  Math.max(
    terrainSurface.width / Math.max(1, terrainSurface.cols),
    terrainSurface.depth / Math.max(1, terrainSurface.rows)
  );
const worldToTileX = (terrainSurface: TerrainRenderSurface, worldX: number): number =>
  (worldX / Math.max(1e-5, terrainSurface.width) + 0.5) * terrainSurface.cols;
const worldToTileY = (terrainSurface: TerrainRenderSurface, worldZ: number): number =>
  (worldZ / Math.max(1e-5, terrainSurface.depth) + 0.5) * terrainSurface.rows;
const resolveDistanceCutoff = (distance01: number): number =>
  lerp(WORLD_AUDIO_ROLL_OFF_MAX, WORLD_AUDIO_ROLL_OFF_MIN, Math.pow(clamp01(1 - distance01), 0.5));
const pickFireBaseLoop = (size01: number): string =>
  size01 < 0.28 ? FIRE_SMALL_LOOP : size01 < 0.62 ? FIRE_MEDIUM_LOOP : FIRE_LARGE_LOOP;
const pickFireAccentLoop = (size01: number): string => (size01 < 0.58 ? FIRE_MEDIUM_ACCENT : FIRE_LARGE_ACCENT);
const pickFireHighLoop = (size01: number): string => (size01 < 0.72 ? FIRE_LARGE_LOOP : FIRE_LARGE_ACCENT);
const getEmitterSize01 = (tileCount: number): number => clamp01(1 - Math.exp(-tileCount / 14));

const buildTerrainOcclusionSamples = (
  terrainSurface: TerrainRenderSurface,
  from: THREE.Vector3,
  to: THREE.Vector3
): HeightOcclusionSample[] => {
  const samples: HeightOcclusionSample[] = [];
  for (let i = 1; i <= TERRAIN_OCCLUSION_SAMPLES; i += 1) {
    const t = i / (TERRAIN_OCCLUSION_SAMPLES + 1);
    const worldX = lerp(from.x, to.x, t);
    const worldY = lerp(from.y, to.y, t);
    const worldZ = lerp(from.z, to.z, t);
    const tileX = worldToTileX(terrainSurface, worldX);
    const tileY = worldToTileY(terrainSurface, worldZ);
    const terrainY = terrainSurface.heightAtTileCoord(tileX, tileY) * terrainSurface.heightScale;
    samples.push({ terrainY, lineY: worldY });
  }
  return samples;
};

const rawAudioCache = new Map<string, Promise<ArrayBuffer | null>>();
const warnedAudioSources = new Set<string>();

const getRawAudioAsset = (source: string): Promise<ArrayBuffer | null> => {
  const existing = rawAudioCache.get(source);
  if (existing) {
    return existing;
  }
  const created = fetch(source)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.arrayBuffer();
    })
    .catch((error) => {
      if (!warnedAudioSources.has(source)) {
        warnedAudioSources.add(source);
        console.warn(`[threeTestWorldAudio] Failed to preload "${source}".`, error);
      }
      return null;
    });
  rawAudioCache.set(source, created);
  return created;
};

export const preloadThreeTestWorldAudioAssets = async (): Promise<void> => {
  await Promise.all(WORLD_AUDIO_SOURCES.map((source) => getRawAudioAsset(source)));
};

type EmitterLayerState = {
  activeGain: GainNode;
  levelGain: GainNode;
  source: AudioBufferSourceNode | null;
  sourcePath: string | null;
  requestId: number;
};

type FireEmitterSlot = {
  slotIndex: number;
  mixGain: GainNode;
  filter: BiquadFilterNode;
  panner: StereoPannerNode;
  distanceGain: GainNode;
  baseLayer: EmitterLayerState;
  midLayer: EmitterLayerState;
  highLayer: EmitterLayerState;
  currentX: number;
  currentY: number;
  currentZ: number;
  currentTileCount: number;
  smoothedIntensity: number;
  occlusion01: number;
  nextTransientAt: number;
  seed: number;
};

type SirenEmitterSlot = {
  slotIndex: number;
  gain: GainNode;
  filter: BiquadFilterNode;
  panner: StereoPannerNode;
  distanceGain: GainNode;
  source: AudioBufferSourceNode | null;
  currentTruckId: number | null;
  currentX: number;
  currentY: number;
  currentZ: number;
  occlusion01: number;
  seed: number;
};

const connectLoopLayer = (audioContext: AudioContext, mixGain: GainNode): EmitterLayerState => {
  const activeGain = audioContext.createGain();
  const levelGain = audioContext.createGain();
  activeGain.gain.value = 0;
  levelGain.gain.value = 0;
  activeGain.connect(levelGain);
  levelGain.connect(mixGain);
  return {
    activeGain,
    levelGain,
    source: null,
    sourcePath: null,
    requestId: 0
  };
};

export const createThreeTestWorldAudio = (
  camera: THREE.Camera,
  controls: WorldAudioChannelControls
): ThreeTestWorldAudio => {
  let settings = controls.getSettings();
  let running = false;
  let disposed = false;
  let context: AudioContext | null = null;
  let worldGain: GainNode | null = null;
  let fireBusGain: GainNode | null = null;
  let sirenBusGain: GainNode | null = null;
  let gestureBound = false;
  let gestureUnlockHandler: (() => void) | null = null;
  let resumeWarned = false;
  let lastFireAssignments: Array<FireAudioClusterCandidate | null> = Array.from(
    { length: MAX_FIRE_EMITTERS },
    () => null as FireAudioClusterCandidate | null
  );
  let fireSlots: FireEmitterSlot[] = [];
  let sirenSlots: SirenEmitterSlot[] = [];
  const decodedBufferCache = new Map<string, Promise<AudioBuffer | null>>();
  const tmpCameraRight = new THREE.Vector3();
  const tmpCameraPosition = new THREE.Vector3();
  const firePoint = new THREE.Vector3();
  const truckPoint = new THREE.Vector3();

  const syncMasterGain = (): void => {
    if (!context || !worldGain) {
      return;
    }
    const target = running && !document.hidden && !settings.muted ? settings.volume : 0;
    worldGain.gain.setTargetAtTime(target, context.currentTime, 0.08);
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
      worldGain = context.createGain();
      fireBusGain = context.createGain();
      sirenBusGain = context.createGain();
      fireBusGain.gain.value = FIRE_BUS_GAIN;
      sirenBusGain.gain.value = SIREN_BUS_GAIN;
      fireBusGain.connect(worldGain);
      sirenBusGain.connect(worldGain);
      worldGain.connect(context.destination);
      fireSlots = Array.from({ length: MAX_FIRE_EMITTERS }, (_, slotIndex) => {
        const mixGain = context!.createGain();
        const filter = context!.createBiquadFilter();
        const panner = context!.createStereoPanner();
        const distanceGain = context!.createGain();
        mixGain.gain.value = 1;
        filter.type = "lowpass";
        filter.frequency.value = WORLD_AUDIO_ROLL_OFF_MAX;
        distanceGain.gain.value = 0;
        mixGain.connect(filter);
        filter.connect(panner);
        panner.connect(distanceGain);
        distanceGain.connect(fireBusGain!);
        return {
          slotIndex,
          mixGain,
          filter,
          panner,
          distanceGain,
          baseLayer: connectLoopLayer(context!, mixGain),
          midLayer: connectLoopLayer(context!, mixGain),
          highLayer: connectLoopLayer(context!, mixGain),
          currentX: 0,
          currentY: 0,
          currentZ: 0,
          currentTileCount: 0,
          smoothedIntensity: 0,
          occlusion01: 0,
          nextTransientAt: 0,
          seed: hash01(slotIndex + 17)
        };
      });
      sirenSlots = Array.from({ length: MAX_SIREN_EMITTERS }, (_, slotIndex) => {
        const gain = context!.createGain();
        const filter = context!.createBiquadFilter();
        const panner = context!.createStereoPanner();
        const distanceGain = context!.createGain();
        gain.gain.value = 1;
        filter.type = "lowpass";
        filter.frequency.value = WORLD_AUDIO_ROLL_OFF_MAX;
        distanceGain.gain.value = 0;
        gain.connect(filter);
        filter.connect(panner);
        panner.connect(distanceGain);
        distanceGain.connect(sirenBusGain!);
        return {
          slotIndex,
          gain,
          filter,
          panner,
          distanceGain,
          source: null,
          currentTruckId: null,
          currentX: 0,
          currentY: 0,
          currentZ: 0,
          occlusion01: 0,
          seed: hash01(slotIndex + 71)
        };
      });
      syncMasterGain();
      return context;
    } catch (error) {
      console.warn("[threeTestWorldAudio] AudioContext creation failed.", error);
      context = null;
      worldGain = null;
      fireBusGain = null;
      sirenBusGain = null;
      return null;
    }
  };

  const getDecodedBuffer = (source: string): Promise<AudioBuffer | null> => {
    const existing = decodedBufferCache.get(source);
    if (existing) {
      return existing;
    }
    const created = (async () => {
      const audioContext = ensureContext();
      if (!audioContext) {
        return null;
      }
      const raw = await getRawAudioAsset(source);
      if (!raw) {
        return null;
      }
      try {
        return await audioContext.decodeAudioData(raw.slice(0));
      } catch (error) {
        if (!warnedAudioSources.has(`decode:${source}`)) {
          warnedAudioSources.add(`decode:${source}`);
          console.warn(`[threeTestWorldAudio] Failed to decode "${source}".`, error);
        }
        return null;
      }
    })();
    decodedBufferCache.set(source, created);
    return created;
  };

  const warmBuffers = async (): Promise<void> => {
    const audioContext = ensureContext();
    if (!audioContext) {
      return;
    }
    await Promise.all(WORLD_AUDIO_SOURCES.map((source) => getDecodedBuffer(source)));
  };

  const unlock = async (): Promise<void> => {
    const audioContext = ensureContext();
    if (!audioContext) {
      return;
    }
    void warmBuffers();
    if (audioContext.state !== "suspended") {
      return;
    }
    try {
      await audioContext.resume();
      syncMasterGain();
    } catch (error) {
      if (!resumeWarned) {
        resumeWarned = true;
        console.warn("[threeTestWorldAudio] AudioContext resume failed.", error);
      }
    }
  };

  const bindFirstGestureUnlock = (): void => {
    if (gestureBound || typeof window === "undefined") {
      return;
    }
    gestureBound = true;
    const onGesture = (): void => {
      void unlock();
    };
    gestureUnlockHandler = onGesture;
    window.addEventListener("pointerdown", onGesture, true);
    window.addEventListener("keydown", onGesture, true);
  };

  bindFirstGestureUnlock();
  void preloadThreeTestWorldAudioAssets();

  const stopLayerSource = (layer: EmitterLayerState): void => {
    if (!layer.source) {
      return;
    }
    try {
      layer.source.stop();
    } catch {
      // Ignore duplicate stops during disposal.
    }
    layer.source.disconnect();
    layer.source = null;
    layer.sourcePath = null;
  };

  const syncLayerLoop = (
    layer: EmitterLayerState,
    sourcePath: string,
    playbackRate: number,
    seed: number
  ): void => {
    const audioContext = ensureContext();
    if (!audioContext) {
      return;
    }
    const now = audioContext.currentTime;
    if (layer.source && layer.sourcePath === sourcePath) {
      layer.source.playbackRate.setTargetAtTime(playbackRate, now, 0.06);
      return;
    }
    layer.requestId += 1;
    const requestId = layer.requestId;
    layer.activeGain.gain.cancelScheduledValues(now);
    layer.activeGain.gain.setValueAtTime(layer.activeGain.gain.value, now);
    layer.activeGain.gain.linearRampToValueAtTime(0, now + FIRE_LAYER_SWITCH_SECONDS);
    if (layer.source) {
      const source = layer.source;
      const stopAt = now + FIRE_LAYER_SWITCH_SECONDS + 0.01;
      window.setTimeout(() => {
        if (disposed) {
          return;
        }
        try {
          source.stop();
        } catch {
          // Ignore duplicate stops.
        }
        source.disconnect();
      }, Math.round(Math.max(0, (stopAt - now) * 1000)));
      layer.source = null;
    }
    layer.sourcePath = sourcePath;
    void getDecodedBuffer(sourcePath).then((buffer) => {
      if (!buffer || !context || disposed || requestId !== layer.requestId) {
        return;
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.playbackRate.value = playbackRate;
      source.connect(layer.activeGain);
      const startAt = context.currentTime + FIRE_LAYER_SWITCH_SECONDS + 0.02;
      const offset = buffer.duration > 0 ? (seed * buffer.duration) % buffer.duration : 0;
      layer.activeGain.gain.cancelScheduledValues(context.currentTime);
      layer.activeGain.gain.setValueAtTime(0, context.currentTime);
      layer.activeGain.gain.setValueAtTime(0, startAt);
      layer.activeGain.gain.linearRampToValueAtTime(1, startAt + FIRE_LAYER_FADE_SECONDS);
      source.start(startAt, offset);
      layer.source = source;
    });
  };

  const playTransient = (slot: FireEmitterSlot, gain: number, playbackRate: number): void => {
    const audioContext = ensureContext();
    if (!audioContext || audioContext.state !== "running") {
      return;
    }
    const sourcePath =
      FIRE_CRACKLE_SOURCES[Math.floor(hash01(slot.seed * 113 + audioContext.currentTime * 17) * FIRE_CRACKLE_SOURCES.length)] ??
      FIRE_CRACKLE_SOURCES[0];
    void getDecodedBuffer(sourcePath).then((buffer) => {
      if (!buffer || !context || disposed) {
        return;
      }
      const source = context.createBufferSource();
      const transientGain = context.createGain();
      source.buffer = buffer;
      source.playbackRate.value = playbackRate;
      transientGain.gain.value = gain;
      source.connect(transientGain);
      transientGain.connect(slot.mixGain);
      const now = context.currentTime;
      source.start(now);
      transientGain.gain.setValueAtTime(gain, now);
      transientGain.gain.exponentialRampToValueAtTime(0.0001, now + Math.min(buffer.duration, 0.55));
      source.stop(now + Math.min(buffer.duration + 0.02, 0.7));
      source.onended = () => {
        transientGain.disconnect();
        source.disconnect();
      };
    });
  };

  const stopSirenSource = (slot: SirenEmitterSlot): void => {
    if (!slot.source) {
      return;
    }
    try {
      slot.source.stop();
    } catch {
      // Ignore duplicate stops.
    }
    slot.source.disconnect();
    slot.source = null;
  };

  const ensureSirenSource = (slot: SirenEmitterSlot): void => {
    const audioContext = ensureContext();
    if (!audioContext || slot.source) {
      return;
    }
    void getDecodedBuffer(FIRE_SIREN_LOOP).then((buffer) => {
      if (!buffer || !context || slot.source || disposed) {
        return;
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.loopStart = SIREN_LOOP_START_SECONDS;
      source.loopEnd = Math.max(
        SIREN_LOOP_START_SECONDS + 0.1,
        Math.min(buffer.duration, SIREN_LOOP_END_SECONDS)
      );
      source.playbackRate.value = 0.99 + (slot.seed - 0.5) * 0.03;
      source.connect(slot.gain);
      const loopDuration = Math.max(0.1, source.loopEnd - source.loopStart);
      const offset = source.loopStart + ((slot.seed * loopDuration) % loopDuration);
      source.start(context.currentTime, offset);
      slot.source = source;
    });
  };

  const removeSettingsListener = controls.onChange((next) => {
    settings = next;
    syncMasterGain();
    if (running && !settings.muted) {
      void warmBuffers();
      void unlock();
    }
  });

  const visibilityListener = (): void => {
    syncMasterGain();
    if (!context) {
      return;
    }
    if (document.hidden && context.state === "running") {
      void context.suspend().catch(() => {
        // Ignore background suspend failures.
      });
      return;
    }
    if (!document.hidden && running && !settings.muted) {
      void unlock();
    }
  };
  document.addEventListener("visibilitychange", visibilityListener);

  const updateFireEmitters = (
    timeMs: number,
    deltaSeconds: number,
    world: RenderSim,
    terrainSurface: TerrainRenderSurface,
    fireClusters: readonly FireAudioClusterSnapshot[]
  ): void => {
    const audioContext = ensureContext();
    if (!audioContext || fireSlots.length <= 0) {
      return;
    }
    camera.getWorldPosition(tmpCameraPosition);
    tmpCameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
    const tileSpan = getTileSpan(terrainSurface);
    const hearingDistance = tileSpan * FIRE_HEARING_DISTANCE_TILES;
    const continuityDistance = tileSpan * FIRE_CONTINUITY_DISTANCE_TILES;
    const clusterById = new Map(fireClusters.map((cluster) => [cluster.id, cluster] as const));
    const prioritizedCandidates = selectPrioritizedFireAudioClusters(
      fireClusters.map((cluster) => ({
        id: cluster.id,
        x: cluster.x,
        z: cluster.z,
        tileCount: cluster.tileCount,
        intensity01: cluster.intensity01
      })),
      tmpCameraPosition.x,
      tmpCameraPosition.z,
      hearingDistance,
      MAX_FIRE_EMITTERS
    );
    const slotMemory: FireAudioEmitterMemory[] = [];
    for (let i = 0; i < fireSlots.length; i += 1) {
      const slot = fireSlots[i]!;
      if ((lastFireAssignments[i] ?? null) === null && slot.smoothedIntensity <= 0.02) {
        continue;
      }
      slotMemory.push({
        slotIndex: slot.slotIndex,
        x: slot.currentX,
        z: slot.currentZ,
        tileCount: Math.max(1, slot.currentTileCount)
      });
    }
    const assignments = assignFireAudioEmitterSlots(slotMemory, prioritizedCandidates, MAX_FIRE_EMITTERS, continuityDistance);
    lastFireAssignments = assignments;
    for (let i = 0; i < fireSlots.length; i += 1) {
      const slot = fireSlots[i]!;
      const assignment = assignments[i];
      const cluster = assignment ? clusterById.get(assignment.id) ?? null : null;
      const targetIntensity = cluster ? clamp01(cluster.intensity01) : 0;
      slot.smoothedIntensity = smoothApproach(
        slot.smoothedIntensity,
        targetIntensity,
        FIRE_INTENSITY_RESPONSE,
        FIRE_INTENSITY_RESPONSE * 0.7,
        deltaSeconds
      );
      if (cluster) {
        slot.currentX = lerp(slot.currentX, cluster.x, clamp01(deltaSeconds * FIRE_POSITION_RESPONSE));
        slot.currentY = lerp(slot.currentY, cluster.y + FIRE_Y_OFFSET, clamp01(deltaSeconds * FIRE_POSITION_RESPONSE));
        slot.currentZ = lerp(slot.currentZ, cluster.z, clamp01(deltaSeconds * FIRE_POSITION_RESPONSE));
        slot.currentTileCount = cluster.tileCount;
      }
      firePoint.set(slot.currentX, slot.currentY, slot.currentZ);
      const dirX = firePoint.x - tmpCameraPosition.x;
      const dirY = firePoint.y - tmpCameraPosition.y;
      const dirZ = firePoint.z - tmpCameraPosition.z;
      const distance = Math.hypot(dirX, dirY, dirZ);
      const distanceGain = computeFireDistanceGain(distance, tileSpan * 4, hearingDistance);
      const distance01 = clamp01(distance / Math.max(1e-4, hearingDistance));
      const pan =
        distance > 1e-5
          ? clamp((dirX / distance) * tmpCameraRight.x + (dirZ / distance) * tmpCameraRight.z, -0.95, 0.95)
          : 0;
      const windGain = computeWindLoudnessGain(
        { x: dirX, z: dirZ },
        { x: world.wind.dx, z: world.wind.dy },
        world.wind.strength
      );
      const targetOcclusion01 =
        cluster && terrainSurface
          ? computeTerrainOcclusion01(
              buildTerrainOcclusionSamples(terrainSurface, tmpCameraPosition, firePoint),
              tileSpan * TERRAIN_OCCLUSION_CLEARANCE_TILES
            )
          : 0;
      slot.occlusion01 = smoothApproach(
        slot.occlusion01,
        targetOcclusion01,
        FIRE_OCCLUSION_RISE_RATE,
        FIRE_OCCLUSION_FALL_RATE,
        deltaSeconds
      );
      const occlusionGain = 1 - slot.occlusion01 * 0.42;
      const filterCutoff = lerp(resolveDistanceCutoff(distance01), 700, slot.occlusion01);
      slot.filter.frequency.setTargetAtTime(filterCutoff, audioContext.currentTime, 0.08);
      slot.panner.pan.setTargetAtTime(pan, audioContext.currentTime, 0.06);
      slot.distanceGain.gain.setTargetAtTime(
        distanceGain * windGain * occlusionGain,
        audioContext.currentTime,
        0.08
      );
      const size01 = getEmitterSize01(slot.currentTileCount);
      const baseSourcePath = pickFireBaseLoop(size01);
      const midSourcePath = pickFireAccentLoop(size01);
      const highSourcePath = pickFireHighLoop(size01);
      const pitchBase = clamp(1 + (slot.smoothedIntensity - 0.5) * 0.05 + (slot.seed - 0.5) * 0.03 - size01 * 0.02, 0.96, 1.06);
      const baseGain =
        slot.smoothedIntensity <= 0.001
          ? 0
          : (0.08 + slot.smoothedIntensity * 0.84) *
            (0.58 + size01 * 0.42) *
            FIRE_BASE_GAIN;
      const midGain =
        smoothstep(0.3, 0.82, slot.smoothedIntensity) *
        (0.3 + size01 * 0.4) *
        FIRE_MID_GAIN;
      const highGain =
        smoothstep(0.7, 1, slot.smoothedIntensity) *
        (0.22 + size01 * 0.25) *
        FIRE_HIGH_GAIN;
      slot.baseLayer.levelGain.gain.setTargetAtTime(baseGain, audioContext.currentTime, 0.08);
      slot.midLayer.levelGain.gain.setTargetAtTime(midGain, audioContext.currentTime, 0.08);
      slot.highLayer.levelGain.gain.setTargetAtTime(highGain, audioContext.currentTime, 0.08);
      if (cluster) {
        syncLayerLoop(slot.baseLayer, baseSourcePath, pitchBase, slot.seed * 1.13);
        syncLayerLoop(slot.midLayer, midSourcePath, clamp(pitchBase + 0.012, 0.96, 1.08), slot.seed * 1.71);
        syncLayerLoop(slot.highLayer, highSourcePath, clamp(pitchBase + 0.026, 0.97, 1.08), slot.seed * 2.19);
        const transientRate = FIRE_TRANSIENT_RATE * slot.smoothedIntensity;
        if (transientRate > 0.01) {
          if (slot.nextTransientAt <= 0) {
            slot.nextTransientAt = timeMs + (120 + hash01(slot.seed * 197) * 240);
          }
          if (timeMs >= slot.nextTransientAt && audioContext.state === "running") {
            playTransient(
              slot,
              FIRE_TRANSIENT_GAIN + smoothstep(0.7, 1, slot.smoothedIntensity) * FIRE_TRANSIENT_HIGH_GAIN,
              clamp(pitchBase + 0.08 + (hash01(timeMs * 0.013 + slot.seed * 31) - 0.5) * 0.08, 0.96, 1.18)
            );
            const jitter = Math.max(0.12, -Math.log(Math.max(1e-5, 1 - hash01(timeMs * 0.011 + slot.seed * 29)))) / transientRate;
            slot.nextTransientAt = timeMs + jitter * 1000;
          }
        } else {
          slot.nextTransientAt = 0;
        }
      } else {
        slot.baseLayer.levelGain.gain.setTargetAtTime(0, audioContext.currentTime, 0.08);
        slot.midLayer.levelGain.gain.setTargetAtTime(0, audioContext.currentTime, 0.08);
        slot.highLayer.levelGain.gain.setTargetAtTime(0, audioContext.currentTime, 0.08);
        slot.distanceGain.gain.setTargetAtTime(0, audioContext.currentTime, 0.08);
        slot.nextTransientAt = 0;
      }
    }
  };

  const isTruckResponding = (
    world: RenderSim,
    terrainSurface: TerrainRenderSurface,
    unit: RenderSim["units"][number],
    fireClusters: readonly FireAudioClusterSnapshot[],
    simulationAlpha: number,
    tileSpan: number
  ): { truckId: number; x: number; y: number; z: number } | null => {
    if (unit.kind !== "truck") {
      return null;
    }
    const activeTarget = unit.attackTarget ?? unit.sprayTarget ?? unit.target;
    const moving =
      unit.pathIndex < unit.path.length ||
      (activeTarget !== null && Math.hypot(activeTarget.x - unit.x, activeTarget.y - unit.y) > 0.35);
    const hasSuppressionTarget = unit.attackTarget !== null || unit.sprayTarget !== null;
    if (!moving && !hasSuppressionTarget) {
      return null;
    }
    if (fireClusters.length <= 0 || world.lastActiveFires <= 0) {
      return null;
    }
    const interpolatedX = lerp(unit.prevX, unit.x, simulationAlpha);
    const interpolatedY = lerp(unit.prevY, unit.y, simulationAlpha);
    const worldX = terrainSurface.toWorldX(interpolatedX);
    const worldZ = terrainSurface.toWorldZ(interpolatedY);
    const worldY = terrainSurface.heightAtTileCoord(interpolatedX, interpolatedY) * terrainSurface.heightScale + SIREN_Y_OFFSET;
    const targetWorldX = activeTarget ? terrainSurface.toWorldX(activeTarget.x) : worldX;
    const targetWorldZ = activeTarget ? terrainSurface.toWorldZ(activeTarget.y) : worldZ;
    const alertDistance = Math.max(tileSpan * 10, unit.hoseRange * tileSpan * 1.35);
    const nearFire = fireClusters.some((cluster) => {
      const truckDistance = Math.hypot(cluster.x - worldX, cluster.z - worldZ);
      const targetDistance = Math.hypot(cluster.x - targetWorldX, cluster.z - targetWorldZ);
      const threshold = Math.max(alertDistance, cluster.radius + tileSpan * 5.5);
      return truckDistance <= threshold || targetDistance <= threshold;
    });
    if (!nearFire) {
      return null;
    }
    return {
      truckId: unit.id,
      x: worldX,
      y: worldY,
      z: worldZ
    };
  };

  const updateSirenEmitters = (
    deltaSeconds: number,
    world: RenderSim,
    terrainSurface: TerrainRenderSurface,
    fireClusters: readonly FireAudioClusterSnapshot[],
    simulationAlpha: number
  ): void => {
    const audioContext = ensureContext();
    if (!audioContext || sirenSlots.length <= 0) {
      return;
    }
    camera.getWorldPosition(tmpCameraPosition);
    tmpCameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
    const tileSpan = getTileSpan(terrainSurface);
    const hearingDistance = tileSpan * SIREN_HEARING_DISTANCE_TILES;
    const responding = world.units
      .map((unit) => isTruckResponding(world, terrainSurface, unit, fireClusters, simulationAlpha, tileSpan))
      .filter((entry): entry is { truckId: number; x: number; y: number; z: number } => entry !== null)
      .sort(
        (a, b) =>
          Math.hypot(a.x - tmpCameraPosition.x, a.z - tmpCameraPosition.z) -
          Math.hypot(b.x - tmpCameraPosition.x, b.z - tmpCameraPosition.z)
      )
      .slice(0, MAX_SIREN_EMITTERS);
    const remaining = [...responding];
    for (let i = 0; i < sirenSlots.length; i += 1) {
      const slot = sirenSlots[i]!;
      const existingIndex = remaining.findIndex((entry) => entry.truckId === slot.currentTruckId);
      const target = existingIndex >= 0 ? remaining.splice(existingIndex, 1)[0] : remaining.shift() ?? null;
      slot.currentTruckId = target?.truckId ?? null;
      if (!target) {
        slot.distanceGain.gain.setTargetAtTime(0, audioContext.currentTime, 0.09);
        continue;
      }
      ensureSirenSource(slot);
      slot.currentX = lerp(slot.currentX, target.x, clamp01(deltaSeconds * FIRE_POSITION_RESPONSE));
      slot.currentY = lerp(slot.currentY, target.y, clamp01(deltaSeconds * FIRE_POSITION_RESPONSE));
      slot.currentZ = lerp(slot.currentZ, target.z, clamp01(deltaSeconds * FIRE_POSITION_RESPONSE));
      truckPoint.set(slot.currentX, slot.currentY, slot.currentZ);
      const dirX = truckPoint.x - tmpCameraPosition.x;
      const dirY = truckPoint.y - tmpCameraPosition.y;
      const dirZ = truckPoint.z - tmpCameraPosition.z;
      const distance = Math.hypot(dirX, dirY, dirZ);
      const distanceGain = computeDistanceAttenuation(distance, tileSpan * 5, hearingDistance);
      const distance01 = clamp01(distance / Math.max(1e-4, hearingDistance));
      const pan =
        distance > 1e-5
          ? clamp((dirX / distance) * tmpCameraRight.x + (dirZ / distance) * tmpCameraRight.z, -0.95, 0.95)
          : 0;
      const targetOcclusion01 = computeTerrainOcclusion01(
        buildTerrainOcclusionSamples(terrainSurface, tmpCameraPosition, truckPoint),
        tileSpan * TERRAIN_OCCLUSION_CLEARANCE_TILES
      );
      slot.occlusion01 = smoothApproach(
        slot.occlusion01,
        targetOcclusion01,
        SIREN_OCCLUSION_RISE_RATE,
        SIREN_OCCLUSION_FALL_RATE,
        deltaSeconds
      );
      const filterCutoff = lerp(resolveDistanceCutoff(distance01), 900, slot.occlusion01);
      slot.filter.frequency.setTargetAtTime(filterCutoff, audioContext.currentTime, 0.08);
      slot.panner.pan.setTargetAtTime(pan, audioContext.currentTime, 0.06);
      slot.distanceGain.gain.setTargetAtTime(
        smoothApproach(
          slot.distanceGain.gain.value,
          distanceGain * (1 - slot.occlusion01 * 0.3),
          SIREN_GAIN_RESPONSE,
          SIREN_GAIN_RESPONSE,
          deltaSeconds
        ),
        audioContext.currentTime,
        0.08
      );
    }
  };

  const setRunning = (active: boolean): void => {
    running = active;
    syncMasterGain();
    if (running && !settings.muted && !document.hidden) {
      void warmBuffers();
      void unlock();
      return;
    }
    if (context && context.state === "running") {
      void context.suspend().catch(() => {
        // Ignore suspend failures while tearing down UI.
      });
    }
  };

  const update = (
    timeMs: number,
    deltaSeconds: number,
    world: RenderSim,
    terrainSurface: TerrainRenderSurface | null,
    fireClusters: readonly FireAudioClusterSnapshot[],
    simulationAlpha: number
  ): void => {
    if (disposed || !running || settings.muted) {
      syncMasterGain();
      return;
    }
    const audioContext = ensureContext();
    if (!audioContext || !terrainSurface) {
      return;
    }
    if (audioContext.state !== "running") {
      void unlock();
      return;
    }
    updateFireEmitters(timeMs, deltaSeconds, world, terrainSurface, fireClusters);
    updateSirenEmitters(deltaSeconds, world, terrainSurface, fireClusters, simulationAlpha);
  };

  const dispose = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    removeSettingsListener();
    document.removeEventListener("visibilitychange", visibilityListener);
    if (gestureUnlockHandler && typeof window !== "undefined") {
      window.removeEventListener("pointerdown", gestureUnlockHandler, true);
      window.removeEventListener("keydown", gestureUnlockHandler, true);
    }
    gestureUnlockHandler = null;
    gestureBound = false;
    for (let i = 0; i < fireSlots.length; i += 1) {
      const slot = fireSlots[i]!;
      stopLayerSource(slot.baseLayer);
      stopLayerSource(slot.midLayer);
      stopLayerSource(slot.highLayer);
      slot.mixGain.disconnect();
      slot.filter.disconnect();
      slot.panner.disconnect();
      slot.distanceGain.disconnect();
    }
    for (let i = 0; i < sirenSlots.length; i += 1) {
      const slot = sirenSlots[i]!;
      stopSirenSource(slot);
      slot.gain.disconnect();
      slot.filter.disconnect();
      slot.panner.disconnect();
      slot.distanceGain.disconnect();
    }
    fireSlots = [];
    sirenSlots = [];
    if (worldGain) {
      worldGain.disconnect();
    }
    if (fireBusGain) {
      fireBusGain.disconnect();
    }
    if (sirenBusGain) {
      sirenBusGain.disconnect();
    }
    if (context) {
      void context.close().catch(() => {
        // Ignore close failures during shutdown.
      });
    }
    context = null;
    worldGain = null;
    fireBusGain = null;
    sirenBusGain = null;
  };

  return {
    setRunning,
    update,
    dispose
  };
};
