
import type { RNG } from "../../core/types.js";
import type { WorldState } from "../../core/state.js";
import { indexFor } from "../../core/grid.js";
import { markFireBlockActiveByTile } from "./activeBlocks.js";
import { markFireBounds } from "./bounds.js";

export function igniteRandomFire(state: WorldState, rng: RNG, dayDelta: number, intensity: number): void {
  const ignitionChance = state.fireSettings.ignitionChancePerDay * dayDelta * intensity;
  if (rng.next() >= ignitionChance) {
    return;
  }
  let attempts = 0;
  while (attempts < 80) {
    attempts += 1;
    const x = Math.floor(rng.next() * state.grid.cols);
    const y = Math.floor(rng.next() * state.grid.rows);
    const idx = indexFor(state.grid, x, y);
    const tile = state.tiles[idx];
    if (state.tileFire[idx] > 0 || state.tileFuel[idx] <= 0) {
      continue;
    }
    if (
      tile.type === "water" ||
      tile.type === "beach" ||
      tile.type === "rocky" ||
      tile.type === "bare" ||
      tile.type === "base" ||
      tile.type === "ash" ||
      tile.type === "firebreak" ||
      tile.type === "road"
    ) {
      continue;
    }
    tile.fire = 0.35 + rng.next() * 0.25;
    tile.heat = Math.max(tile.heat, tile.ignitionPoint * 1.3);
    state.tileFire[idx] = tile.fire;
    state.tileHeat[idx] = tile.heat;
    markFireBounds(state, x, y);
    markFireBlockActiveByTile(state, idx);
    break;
  }
}
