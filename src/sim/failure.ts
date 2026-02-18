import type { WorldState } from "../core/state.js";

export const isBaseTileLost = (tile: WorldState["tiles"][number]): boolean => tile.fire > 0 || tile.type === "ash";
