import type { Point, RNG } from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";
import { FIREBREAK_COST_PER_TILE } from "../../../core/config.js";
import { getCharacterFirebreakCost } from "../../../core/characters.js";
import { inBounds, indexFor } from "../../../core/grid.js";
import { setStatus } from "../../../core/state.js";
import { syncTileSoAIndex } from "../../../core/tileCache.js";
import { applyFuel } from "../../../core/tiles.js";
import { formatCurrency } from "../../../core/utils.js";
import { clearVegetationState } from "../../../core/vegetation.js";

export const getFirebreakCostForState = (state: WorldState): number =>
  Math.max(
    1,
    Math.round(
      getCharacterFirebreakCost(state.campaign.characterId, FIREBREAK_COST_PER_TILE) *
        state.progression.resolved.firebreakCostMultiplier
    )
  );

export function clearFuelAt(state: WorldState, rng: RNG, tileX: number, tileY: number, showStatus = true): boolean {
  if (state.phase !== "maintenance") {
    if (showStatus) {
      setStatus(state, "Fuel breaks can only be cut during maintenance.");
    }
    return false;
  }
  if (!inBounds(state.grid, tileX, tileY)) {
    return false;
  }
  const firebreakCost = getFirebreakCostForState(state);
  const tileIndex = indexFor(state.grid, tileX, tileY);
  const tile = state.tiles[tileIndex];
  if (tile.type === "water" || tile.type === "base" || tile.type === "house" || tile.type === "road") {
    if (showStatus) {
      setStatus(state, "That location cannot be cleared.");
    }
    return false;
  }
  if (tile.type === "firebreak") {
    if (showStatus) {
      setStatus(state, "Fuel break already established.");
    }
    return false;
  }
  if (state.budget < firebreakCost) {
    if (showStatus) {
      setStatus(state, "Insufficient budget.");
    }
    return false;
  }
  if (tile.type === "ash") {
    state.burnedTiles = Math.max(0, state.burnedTiles - 1);
  }
  tile.type = "firebreak";
  state.terrainTypeRevision += 1;
  state.vegetationRevision += 1;
  clearVegetationState(tile);
  tile.dominantTreeType = null;
  tile.treeType = null;
  tile.ashAge = 0;
  applyFuel(tile, tile.moisture, rng);
  state.terrainDirty = true;
  syncTileSoAIndex(state, tileIndex);
  state.budget -= firebreakCost;
  if (showStatus) {
    setStatus(state, "Fuel break established.");
  }
  return true;
}

export function clearFuelLine(state: WorldState, rng: RNG, start: Point, end: Point): void {
  if (state.phase !== "maintenance") {
    setStatus(state, "Fuel breaks can only be cut during maintenance.");
    return;
  }
  if (
    !Number.isFinite(start.x) ||
    !Number.isFinite(start.y) ||
    !Number.isFinite(end.x) ||
    !Number.isFinite(end.y)
  ) {
    setStatus(state, "Invalid fuel break coordinates.");
    return;
  }
  const firebreakCost = getFirebreakCostForState(state);
  if (state.budget < firebreakCost) {
    setStatus(state, "Insufficient budget.");
    return;
  }
  let x0 = start.x;
  let y0 = start.y;
  const x1 = end.x;
  const y1 = end.y;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let cleared = 0;
  let spent = 0;
  let steps = 0;
  const maxSteps = state.grid.totalTiles + 1;

  while (true) {
    steps += 1;
    if (steps > maxSteps) {
      console.warn("Fuel break line traversal aborted due to unexpected path length.", { start, end, maxSteps });
      setStatus(state, "Fuel break line aborted due to an invalid path.");
      return;
    }
    if (state.budget < firebreakCost) {
      break;
    }
    if (clearFuelAt(state, rng, x0, y0, false)) {
      cleared += 1;
      spent += firebreakCost;
    }
    if (x0 === x1 && y0 === y1) {
      break;
    }
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }

  if (cleared > 0) {
    setStatus(state, `Fuel break carved across ${cleared} tiles for ${formatCurrency(spent)}.`);
  } else {
    setStatus(state, "No valid tiles to clear along that line.");
  }
}
