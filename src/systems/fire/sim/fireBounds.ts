import type { WorldState } from "../../../core/state.js";

export const markFireBounds = (state: WorldState, x: number, y: number): void => {
  if (!state.fireBoundsActive) {
    state.fireBoundsActive = true;
    state.fireMinX = state.fireMaxX = x;
    state.fireMinY = state.fireMaxY = y;
    return;
  }
  state.fireMinX = Math.min(state.fireMinX, x);
  state.fireMaxX = Math.max(state.fireMaxX, x);
  state.fireMinY = Math.min(state.fireMinY, y);
  state.fireMaxY = Math.max(state.fireMaxY, y);
};

export const resetFireBounds = (state: WorldState): void => {
  state.fireBoundsActive = false;
  state.fireMinX = state.fireMaxX = 0;
  state.fireMinY = state.fireMaxY = 0;
};
