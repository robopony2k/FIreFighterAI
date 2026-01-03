import { WIND_DIRS } from "../core/config.js";
export function randomizeWind(state, rng) {
    const base = WIND_DIRS[Math.floor(rng.next() * WIND_DIRS.length)];
    state.wind = {
        name: base.name,
        dx: base.dx,
        dy: base.dy,
        strength: 0.4 + rng.next() * 0.6
    };
    state.windTimer = 6 + rng.next() * 8;
}
export function stepWind(state, delta, rng) {
    state.windTimer -= delta;
    if (state.windTimer <= 0) {
        randomizeWind(state, rng);
    }
}
