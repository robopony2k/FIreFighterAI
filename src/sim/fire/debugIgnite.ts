import { inBounds, indexFor } from "../../core/grid.js";
import { setStatus } from "../../core/state.js";
import type { WorldState } from "../../core/state.js";
import { ensureTileSoA } from "../../core/tileCache.js";
import { ensureFireBlocks, markFireBlockActiveByTile } from "./activeBlocks.js";
import { markFireBounds } from "./bounds.js";

const DEBUG_IGNITE_SIM_KICK_SECONDS = 0.12;

export type DebugIgniteOptions = {
  random?: () => number;
  simKickSeconds?: number;
};

export const igniteDebugFireAt = (
  state: WorldState,
  tileX: number,
  tileY: number,
  options: DebugIgniteOptions = {}
): boolean => {
  if (!inBounds(state.grid, tileX, tileY)) {
    return false;
  }
  const idx = indexFor(state.grid, tileX, tileY);
  const target = state.tiles[idx];
  if (!target) {
    return false;
  }
  if (target.fuel <= 0) {
    setStatus(state, "Cannot ignite: no fuel.");
    return false;
  }
  if (state.tileSoaDirty) {
    ensureTileSoA(state);
  }
  ensureFireBlocks(state);
  const randomValue = options.random?.() ?? Math.random();
  const clampedRandom = Number.isFinite(randomValue) ? Math.max(0, Math.min(1, randomValue)) : 0;
  const newFire = Math.min(1, 0.65 + clampedRandom * 0.3);
  target.fire = newFire;
  target.heat = Math.max(target.heat, target.ignitionPoint * 1.4);
  state.tileFire[idx] = target.fire;
  state.tileHeat[idx] = target.heat;
  state.tileBurnAge[idx] = 0;
  state.tileHeatRelease[idx] = Math.max(state.tileHeatRelease[idx] ?? 0, target.fire * target.heatOutput);
  markFireBlockActiveByTile(state, idx);
  markFireBounds(state, tileX, tileY);
  state.lastActiveFires = Math.max(state.lastActiveFires, 1);
  state.fireSimAccumulator = Math.max(
    state.fireSimAccumulator,
    options.simKickSeconds ?? DEBUG_IGNITE_SIM_KICK_SECONDS
  );
  setStatus(state, `Debug ignition at ${tileX}, ${tileY}`);
  return true;
};
