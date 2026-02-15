import type { WorldState } from "./state.js";
import { syncTileSoA, syncTileSoAIndex } from "./state.js";

export const markTileSoADirty = (state: WorldState): void => {
  state.tileSoaDirty = true;
};

export const ensureTileSoA = (state: WorldState): void => {
  if (
    state.tileFire.length !== state.grid.totalTiles ||
    state.tileSoaDirty
  ) {
    syncTileSoA(state);
  }
};

export { syncTileSoA, syncTileSoAIndex };
