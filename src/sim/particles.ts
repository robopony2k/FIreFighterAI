import type { RNG, Point, Unit } from "../core/types.js";
import type { WorldState } from "../core/state.js";
import type { EffectsState } from "../core/effectsState.js";

const MAX_WATER_PARTICLES = 2400;
const MAX_SMOKE_PARTICLES = 12000;

export function emitWaterSpray(
  state: WorldState,
  effects: EffectsState,
  rng: RNG,
  unit: Unit,
  target: Point | null
): void {
  const count = unit.kind === "truck" ? 8 : 5;
  const available = Math.max(0, MAX_WATER_PARTICLES - effects.waterParticles.length);
  if (available <= 0) {
    return;
  }
  const spawnCount = Math.min(count, available);
  const baseSpeed = unit.kind === "truck" ? 8 : 6;
  const spread = unit.kind === "truck" ? 0.55 : 0.7;
  let baseAngle = rng.next() * Math.PI * 2;
  if (target) {
    baseAngle = Math.atan2(target.y - unit.y, target.x - unit.x);
  }

  for (let i = 0; i < spawnCount; i += 1) {
    const jitter = (rng.next() - 0.5) * spread;
    const speed = baseSpeed * (0.7 + rng.next() * 0.6);
    effects.waterParticles.push({
      x: unit.x,
      y: unit.y,
      vx: Math.cos(baseAngle + jitter) * speed,
      vy: Math.sin(baseAngle + jitter) * speed,
      life: 0.5 + rng.next() * 0.25,
      maxLife: 0.75,
      size: 1.6 + rng.next() * 1.4,
      alpha: 1
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
      particle.vx *= 0.96;
      particle.vy *= 0.96;
      particle.alpha = particle.life / particle.maxLife;
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

