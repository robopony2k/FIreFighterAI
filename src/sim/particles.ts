import type { RNG, Point, Unit, WaterSprayMode } from "../core/types.js";
import type { WorldState } from "../core/state.js";
import type { EffectsState } from "../core/effectsState.js";

const MAX_WATER_PARTICLES = 2400;
const MAX_SMOKE_PARTICLES = 12000;
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

type WaterSprayProfile = {
  mode: WaterSprayMode;
  count: number;
  baseSpeed: number;
  spread: number;
  lifeMin: number;
  lifeMax: number;
  maxLife: number;
  sizeMin: number;
  sizeMax: number;
  volume: number;
  pulseHz: number;
};

const FIREFIGHTER_SPRAY_PROFILES: Record<Unit["formation"], WaterSprayProfile> = {
  // Precision stream: tighter pattern, stronger throw, brighter pulse.
  narrow: {
    mode: "precision",
    count: 6,
    baseSpeed: 8.6,
    spread: 0.24,
    lifeMin: 0.78,
    lifeMax: 1.02,
    maxLife: 1.08,
    sizeMin: 1.2,
    sizeMax: 2.0,
    volume: 0.94,
    pulseHz: 8.1
  },
  medium: {
    mode: "balanced",
    count: 5,
    baseSpeed: 6.9,
    spread: 0.58,
    lifeMin: 0.6,
    lifeMax: 0.84,
    maxLife: 0.9,
    sizeMin: 1.6,
    sizeMax: 2.5,
    volume: 0.76,
    pulseHz: 6.4
  },
  // Suppression fan: wider pattern, lower intensity, shorter throw.
  wide: {
    mode: "suppression",
    count: 7,
    baseSpeed: 5.3,
    spread: 1.06,
    lifeMin: 0.48,
    lifeMax: 0.72,
    maxLife: 0.78,
    sizeMin: 2.1,
    sizeMax: 3.3,
    volume: 0.54,
    pulseHz: 4.7
  }
};

const TRUCK_SPRAY_PROFILE: WaterSprayProfile = {
  mode: "balanced",
  count: 9,
  baseSpeed: 8.1,
  spread: 0.46,
  lifeMin: 0.72,
  lifeMax: 0.98,
  maxLife: 1.02,
  sizeMin: 1.8,
  sizeMax: 2.9,
  volume: 0.88,
  pulseHz: 6.8
};

const getWaterSprayProfile = (unit: Unit): WaterSprayProfile => {
  if (unit.kind === "firefighter") {
    return FIREFIGHTER_SPRAY_PROFILES[unit.formation] ?? FIREFIGHTER_SPRAY_PROFILES.medium;
  }
  return TRUCK_SPRAY_PROFILE;
};

export function emitWaterSpray(
  state: WorldState,
  effects: EffectsState,
  rng: RNG,
  unit: Unit,
  target: Point | null
): void {
  const profile = getWaterSprayProfile(unit);
  const available = Math.max(0, MAX_WATER_PARTICLES - effects.waterParticles.length);
  if (available <= 0) {
    return;
  }
  const spawnCount = Math.min(profile.count, available);
  let baseAngle = rng.next() * Math.PI * 2;
  if (target) {
    baseAngle = Math.atan2(target.y - unit.y, target.x - unit.x);
  }

  for (let i = 0; i < spawnCount; i += 1) {
    const jitter = (rng.next() - 0.5) * profile.spread;
    const speed = profile.baseSpeed * (0.72 + rng.next() * 0.56);
    const maxLife = profile.maxLife * (0.9 + rng.next() * 0.2);
    const life = profile.lifeMin + rng.next() * (profile.lifeMax - profile.lifeMin);
    const size = profile.sizeMin + rng.next() * (profile.sizeMax - profile.sizeMin);
    const volume = profile.volume * (0.84 + rng.next() * 0.3);
    effects.waterParticles.push({
      x: unit.x,
      y: unit.y,
      vx: Math.cos(baseAngle + jitter) * speed,
      vy: Math.sin(baseAngle + jitter) * speed,
      life: Math.min(life, maxLife),
      maxLife,
      size,
      alpha: 1,
      sprayMode: profile.mode,
      sprayVolume: clamp01(volume),
      spraySeed: rng.next(),
      sprayPulseHz: profile.pulseHz * (0.9 + rng.next() * 0.22),
      spraySpread: profile.spread,
      spraySourceId: unit.id
    });
  }
}

export function emitSmokeAt(
  state: WorldState,
  effects: EffectsState,
  rng: RNG,
  x: number,
  y: number,
  intensity: number
): void {
  const smokeRate = Math.max(0, state.simPerf.smokeRate ?? 1);
  if (smokeRate <= 0) {
    return;
  }
  const rawCount = (2 + Math.ceil(intensity * 3)) * smokeRate;
  const count = Math.max(0, Math.floor(rawCount + rng.next()));
  if (count <= 0) {
    return;
  }
  const available = Math.max(0, MAX_SMOKE_PARTICLES - effects.smokeParticles.length);
  if (available <= 0) {
    return;
  }
  const spawnCount = Math.min(count, available);
  const baseSpeed = 0.9 + state.wind.strength * 1.6;
  for (let i = 0; i < spawnCount; i += 1) {
    const jitter = (rng.next() - 0.5) * 0.6;
    const speed = baseSpeed * (0.6 + rng.next() * 0.8);
    const angle = Math.atan2(state.wind.dy, state.wind.dx) + jitter;
    effects.smokeParticles.push({
      x: x + (rng.next() - 0.5) * 0.3,
      y: y + (rng.next() - 0.5) * 0.3,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 2.2 + rng.next() * 1.8,
      maxLife: 3.4,
      size: 3 + rng.next() * 4,
      alpha: 0.95
    });
  }
}

export function stepParticles(state: WorldState, effects: EffectsState, delta: number): void {
  if (effects.waterParticles.length === 0 && effects.smokeParticles.length === 0) {
    return;
  }

  if (effects.waterParticles.length > 0) {
    const water = effects.waterParticles;
    let write = 0;
    for (let read = 0; read < water.length; read += 1) {
      const particle = water[read];
      particle.life -= delta;
      if (particle.life <= 0) {
        continue;
      }
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      const drag =
        particle.sprayMode === "precision"
          ? 0.972
          : particle.sprayMode === "suppression"
            ? 0.92
            : 0.95;
      particle.vx *= drag;
      particle.vy *= drag;
      const lifeAlpha = particle.life / particle.maxLife;
      const volume = particle.sprayVolume ?? 0.7;
      particle.alpha = clamp01(lifeAlpha * (0.72 + volume * 0.38));
      water[write] = particle;
      write += 1;
    }
    water.length = write;
  }

  if (effects.smokeParticles.length > 0) {
    const smoke = effects.smokeParticles;
    let write = 0;
    for (let read = 0; read < smoke.length; read += 1) {
      const particle = smoke[read];
      particle.life -= delta;
      if (particle.life <= 0) {
        continue;
      }
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.vx += state.wind.dx * 0.35 * delta;
      particle.vy += state.wind.dy * 0.35 * delta;
      particle.alpha = particle.life / particle.maxLife;
      smoke[write] = particle;
      write += 1;
    }
    smoke.length = write;
  }
}

