import type { WorldState } from "../../../../core/state.js";

export const isExternallyIgnitableType = (type: WorldState["tiles"][number]["type"]): boolean =>
  type !== "water" &&
  type !== "beach" &&
  type !== "rocky" &&
  type !== "bare" &&
  type !== "ash" &&
  type !== "firebreak" &&
  type !== "road";

export const isDynamicIgnitionCandidate = (state: WorldState, index: number): boolean => {
  const tile = state.tiles[index];
  return Boolean(
    tile &&
    isExternallyIgnitableType(tile.type) &&
    state.tileFuel[index] > 0 &&
    state.tileFire[index] <= 0
  );
};
