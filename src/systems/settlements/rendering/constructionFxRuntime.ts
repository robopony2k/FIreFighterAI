import * as THREE from "three";
import {
  getBuildingLifecycleStageFromId,
  getBuildingLifecycleVisualStepCount
} from "../sim/buildingLifecycle.js";
import type { BuildingLifecycleStage, RenderBuildingLot } from "../types/buildingTypes.js";
import {
  createConstructionFxAudioEmitter,
  type ConstructionFxAudioControls
} from "./constructionFxAudio.js";
import {
  CONSTRUCTION_STAGE_PROFILES,
  MAX_CONSTRUCTION_DUST_PARTICLES,
  MAX_CONSTRUCTION_DUST_SPAWNS_PER_FRAME,
  constructionDustFragmentShader,
  constructionDustVertexShader,
  type ConstructionStageProfile
} from "./constructionFxConfig.js";

export type ConstructionFxTerrainSurface = {
  cols: number;
  rows: number;
  heightScale: number;
  heightAtTileCoord: (tileX: number, tileY: number) => number;
  toWorldX: (tileX: number) => number;
  toWorldZ: (tileY: number) => number;
};

export type ConstructionFxSample = {
  cols: number;
  rows: number;
  worldSeed?: number;
  buildingLots?: readonly RenderBuildingLot[];
};

export type ConstructionFxRuntime = {
  update: (
    timeMs: number,
    dtSeconds: number,
    sample: ConstructionFxSample | null,
    surface: ConstructionFxTerrainSurface | null,
    animationRate?: number
  ) => void;
  setRunning: (running: boolean) => void;
  dispose: () => void;
};

type LotFxState = {
  accumulator: number;
  sequence: number;
  lastStageId: number;
  nextSoundAtMs: number;
};

const ACTIVE_STAGES = new Set<BuildingLifecycleStage>(["site_prep", "frame", "enclosed"]);

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const clamp01 = (value: number): number => clamp(value, 0, 1);
const fract = (value: number): number => value - Math.floor(value);
const hash01 = (value: number): number => fract(Math.sin(value * 12.9898 + 78.233) * 43758.5453);

const getStageProfile = (stage: BuildingLifecycleStage): ConstructionStageProfile | null => {
  if (stage === "site_prep" || stage === "frame" || stage === "enclosed") {
    return CONSTRUCTION_STAGE_PROFILES[stage];
  }
  return null;
};

const getStageProgress01 = (lot: RenderBuildingLot, stage: BuildingLifecycleStage): number => {
  const stepCount = getBuildingLifecycleVisualStepCount(stage);
  if (stepCount <= 1) {
    return 0.5;
  }
  return clamp01((lot.stageStep ?? 0) / Math.max(1, stepCount - 1));
};

const getTileSpan = (surface: ConstructionFxTerrainSurface): number => {
  const spanX = Math.abs(surface.toWorldX(1) - surface.toWorldX(0));
  const spanZ = Math.abs(surface.toWorldZ(1) - surface.toWorldZ(0));
  return Math.max(0.1, Math.max(spanX, spanZ));
};

export const createConstructionFxRuntime = (
  scene: THREE.Scene,
  camera: THREE.Camera,
  audioControls: ConstructionFxAudioControls | null = null
): ConstructionFxRuntime => {
  const positions = new Float32Array(MAX_CONSTRUCTION_DUST_PARTICLES * 3);
  const ages = new Float32Array(MAX_CONSTRUCTION_DUST_PARTICLES);
  const alphas = new Float32Array(MAX_CONSTRUCTION_DUST_PARTICLES);
  const seeds = new Float32Array(MAX_CONSTRUCTION_DUST_PARTICLES);
  const sizes = new Float32Array(MAX_CONSTRUCTION_DUST_PARTICLES);
  const lifeSeconds = new Float32Array(MAX_CONSTRUCTION_DUST_PARTICLES);
  const vx = new Float32Array(MAX_CONSTRUCTION_DUST_PARTICLES);
  const vy = new Float32Array(MAX_CONSTRUCTION_DUST_PARTICLES);
  const vz = new Float32Array(MAX_CONSTRUCTION_DUST_PARTICLES);
  const active = new Uint8Array(MAX_CONSTRUCTION_DUST_PARTICLES);
  const lotStates = new Map<number, LotFxState>();
  const activeLotIds = new Set<number>();
  const geometry = new THREE.BufferGeometry();
  const positionAttr = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  const ageAttr = new THREE.BufferAttribute(ages, 1).setUsage(THREE.DynamicDrawUsage);
  const alphaAttr = new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage);
  const seedAttr = new THREE.BufferAttribute(seeds, 1).setUsage(THREE.DynamicDrawUsage);
  const sizeAttr = new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttr);
  geometry.setAttribute("aAge01", ageAttr);
  geometry.setAttribute("aAlpha", alphaAttr);
  geometry.setAttribute("aSeed", seedAttr);
  geometry.setAttribute("aSize", sizeAttr);
  geometry.setDrawRange(0, 0);

  const material = new THREE.ShaderMaterial({
    vertexShader: constructionDustVertexShader,
    fragmentShader: constructionDustFragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    toneMapped: false
  });
  const points = new THREE.Points(geometry, material);
  points.name = "settlement-construction-dust";
  points.frustumCulled = false;
  points.renderOrder = 7;
  scene.add(points);

  let running = false;
  let nextParticleSlot = 0;
  let activeCount = 0;
  const audioEmitter = createConstructionFxAudioEmitter(camera, audioControls);

  const findParticleSlot = (): number => {
    for (let attempts = 0; attempts < MAX_CONSTRUCTION_DUST_PARTICLES; attempts += 1) {
      const slot = nextParticleSlot;
      nextParticleSlot = (nextParticleSlot + 1) % MAX_CONSTRUCTION_DUST_PARTICLES;
      if (active[slot] === 0) {
        activeCount += 1;
        return slot;
      }
    }
    const slot = nextParticleSlot;
    nextParticleSlot = (nextParticleSlot + 1) % MAX_CONSTRUCTION_DUST_PARTICLES;
    return slot;
  };

  const spawnDust = (
    lot: RenderBuildingLot,
    surface: ConstructionFxTerrainSurface,
    tileSpan: number,
    profile: ConstructionStageProfile,
    progress01: number,
    sequence: number
  ): void => {
    const slot = findParticleSlot();
    const tileX = clamp((lot.anchorIndex % surface.cols) + 0.5, 0.5, surface.cols - 0.5);
    const tileY = clamp(Math.floor(lot.anchorIndex / surface.cols) + 0.5, 0.5, surface.rows - 0.5);
    const seedBase = lot.id * 97.13 + lot.styleSeed * 0.007 + sequence * 11.31;
    const r0 = hash01(seedBase + 0.1);
    const r1 = hash01(seedBase + 1.7);
    const r2 = hash01(seedBase + 3.3);
    const r3 = hash01(seedBase + 5.9);
    const spread = tileSpan * profile.spread * (0.54 + progress01 * 0.32);
    const x = surface.toWorldX(tileX) + (r0 * 2 - 1) * spread;
    const z = surface.toWorldZ(tileY) + (r1 * 2 - 1) * spread;
    const y = surface.heightAtTileCoord(tileX, tileY) * surface.heightScale + tileSpan * (0.04 + r2 * 0.09);
    const i3 = slot * 3;
    positions[i3] = x;
    positions[i3 + 1] = y;
    positions[i3 + 2] = z;
    ages[slot] = 0;
    alphas[slot] = profile.dustAlpha * (0.72 + r3 * 0.28) * (1 - progress01 * 0.24);
    seeds[slot] = r2;
    sizes[slot] = tileSpan * profile.dustSize * (0.8 + r3 * 0.55);
    lifeSeconds[slot] = 1.25 + r2 * 1.15;
    vx[slot] = (r0 * 2 - 1) * tileSpan * 0.08;
    vy[slot] = tileSpan * profile.rise * (0.7 + r1 * 0.8);
    vz[slot] = (r1 * 2 - 1) * tileSpan * 0.08;
    active[slot] = 1;
  };

  const updateParticles = (dtSeconds: number): void => {
    if (activeCount <= 0) {
      geometry.setDrawRange(0, 0);
      return;
    }
    const dt = clamp(dtSeconds, 0, 0.08);
    let write = 0;
    for (let slot = 0; slot < MAX_CONSTRUCTION_DUST_PARTICLES; slot += 1) {
      if (active[slot] === 0) {
        continue;
      }
      ages[slot] += dt / Math.max(0.1, lifeSeconds[slot]);
      if (ages[slot] >= 1) {
        active[slot] = 0;
        activeCount = Math.max(0, activeCount - 1);
        continue;
      }
      const drag = Math.exp(-dt * 1.4);
      vx[slot] *= drag;
      vz[slot] *= drag;
      vy[slot] *= Math.exp(-dt * 0.72);
      const read3 = slot * 3;
      positions[read3] += vx[slot] * dt;
      positions[read3 + 1] += vy[slot] * dt;
      positions[read3 + 2] += vz[slot] * dt;
      if (write !== slot) {
        const write3 = write * 3;
        positions[write3] = positions[read3];
        positions[write3 + 1] = positions[read3 + 1];
        positions[write3 + 2] = positions[read3 + 2];
        ages[write] = ages[slot];
        alphas[write] = alphas[slot];
        seeds[write] = seeds[slot];
        sizes[write] = sizes[slot];
        lifeSeconds[write] = lifeSeconds[slot];
        vx[write] = vx[slot];
        vy[write] = vy[slot];
        vz[write] = vz[slot];
        active[write] = 1;
        active[slot] = 0;
      }
      write += 1;
    }
    activeCount = write;
    geometry.setDrawRange(0, activeCount);
    positionAttr.needsUpdate = true;
    ageAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;
    seedAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
  };

  const update = (
    timeMs: number,
    dtSeconds: number,
    sample: ConstructionFxSample | null,
    surface: ConstructionFxTerrainSurface | null,
    animationRate = 1
  ): void => {
    const rateScale = clamp(animationRate, 0, 2.5);
    updateParticles(running && rateScale > 0 ? dtSeconds : 0);
    if (!running || !sample || !surface || !sample.buildingLots || sample.buildingLots.length <= 0) {
      return;
    }
    if (rateScale <= 0) {
      return;
    }
    const tileSpan = getTileSpan(surface);
    let spawnedThisFrame = 0;
    activeLotIds.clear();
    for (let i = 0; i < sample.buildingLots.length && spawnedThisFrame < MAX_CONSTRUCTION_DUST_SPAWNS_PER_FRAME; i += 1) {
      const lot = sample.buildingLots[i]!;
      const stage = getBuildingLifecycleStageFromId(lot.stageId);
      if (!ACTIVE_STAGES.has(stage)) {
        continue;
      }
      const profile = getStageProfile(stage);
      if (!profile) {
        continue;
      }
      activeLotIds.add(lot.id);
      const progress01 = getStageProgress01(lot, stage);
      let state = lotStates.get(lot.id);
      if (!state) {
        state = {
          accumulator: 0,
          sequence: 0,
          lastStageId: lot.stageId,
          nextSoundAtMs: timeMs + 80 + hash01(lot.id + lot.styleSeed * 0.003) * 520
        };
        lotStates.set(lot.id, state);
      }
      if (state.lastStageId !== lot.stageId) {
        state.lastStageId = lot.stageId;
        state.accumulator += 2;
        state.nextSoundAtMs = timeMs + 80;
      }
      const intensity = clamp(0.72 + Math.sin(timeMs * 0.0027 + lot.id * 1.73) * 0.18 - progress01 * 0.12, 0.35, 1);
      state.accumulator += dtSeconds * rateScale * profile.spawnRate * intensity;
      const spawnCount = Math.min(MAX_CONSTRUCTION_DUST_SPAWNS_PER_FRAME - spawnedThisFrame, Math.floor(state.accumulator));
      if (spawnCount > 0) {
        state.accumulator -= spawnCount;
      }
      for (let spawn = 0; spawn < spawnCount; spawn += 1) {
        state.sequence += 1;
        spawnDust(lot, surface, tileSpan, profile, progress01, state.sequence);
        spawnedThisFrame += 1;
      }
      if (timeMs >= state.nextSoundAtMs) {
        const tileX = clamp((lot.anchorIndex % surface.cols) + 0.5, 0.5, surface.cols - 0.5);
        const tileY = clamp(Math.floor(lot.anchorIndex / surface.cols) + 0.5, 0.5, surface.rows - 0.5);
        audioEmitter.play({
          timeMs,
          worldX: surface.toWorldX(tileX),
          worldY: surface.heightAtTileCoord(tileX, tileY) * surface.heightScale + tileSpan * 0.18,
          worldZ: surface.toWorldZ(tileY),
          tileSpan,
          gainScale: profile.soundGain,
          seed: lot.id + lot.styleSeed * 0.01
        });
        state.nextSoundAtMs =
          timeMs + profile.soundIntervalMs * (0.78 + hash01(lot.id * 13.1 + timeMs * 0.001) * 0.58);
      }
    }
    lotStates.forEach((_state, lotId) => {
      if (!activeLotIds.has(lotId)) {
        lotStates.delete(lotId);
      }
    });
  };

  return {
    update,
    setRunning: (nextRunning: boolean): void => {
      running = nextRunning;
      if (!running) {
        return;
      }
      audioEmitter.resume();
    },
    dispose: (): void => {
      scene.remove(points);
      geometry.dispose();
      material.dispose();
      audioEmitter.dispose();
    }
  };
};
