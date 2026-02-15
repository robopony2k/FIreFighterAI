
import type { WorldState } from "../../core/state.js";

export function markFireBounds(state: WorldState, x: number, y: number): void {
  if (!state.fireBoundsActive) {
    state.fireBoundsActive = true;
    state.fireMinX = x;
    state.fireMaxX = x;
    state.fireMinY = y;
    state.fireMaxY = y;
    return;
  }
  state.fireMinX = Math.min(state.fireMinX, x);
  state.fireMaxX = Math.max(state.fireMaxX, x);
  state.fireMinY = Math.min(state.fireMinY, y);
  state.fireMaxY = Math.max(state.fireMaxY, y);
}

export function resetFireBounds(state: WorldState): void {
  state.fireBoundsActive = false;
  state.fireMinX = 0;
  state.fireMaxX = 0;
  state.fireMinY = 0;
  state.fireMaxY = 0;
}
