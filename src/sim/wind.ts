import type { RNG } from "../core/types.js";
import type { WorldState } from "../core/state.js";
import { WIND_DIRS } from "../core/config.js";

export function randomizeWind(state: WorldState, rng: RNG): void {
  const base = WIND_DIRS[Math.floor(rng.next() * WIND_DIRS.length)];
  state.wind = {
    name: base.name,
    dx: base.dx,
    dy: base.dy,
    strength: 0.4 + rng.next() * 0.6
  };
  state.windTimer = 6 + rng.next() * 8;
}

export function stepWind(state: WorldState, delta: number, rng: RNG): void {
  state.windTimer -= delta;
  if (state.windTimer <= 0) {
    randomizeWind(state, rng);
  }
}

