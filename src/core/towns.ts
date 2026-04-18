import type { TileType } from "./types.js";
import type { WorldState } from "./state.js";
import { syncTileSoAIndex } from "./tileCache.js";
import { clearVegetationState, syncDerivedVegetationState } from "./vegetation.js";

export const STRUCTURE_NONE = 0;
export const STRUCTURE_RESIDENTIAL_LOW = 1;
export const STRUCTURE_RESIDENTIAL_MID = 2;
export const STRUCTURE_RESIDENTIAL_HIGH = 3;
export const STRUCTURE_HOUSE = STRUCTURE_RESIDENTIAL_LOW;

const DEFAULT_HOUSE_VALUE = 160;
const DEFAULT_HOUSE_RESIDENTS = 2;

const isValidTownId = (state: WorldState, townId: number): boolean => {
  if (!Number.isInteger(townId) || townId < 0 || townId >= state.towns.length) {
    return false;
  }
  const town = state.towns[townId];
  return !!town && town.id === townId;
};

const getTownCenterX = (state: WorldState["towns"][number]): number => {
  return Number.isFinite(state.cx) ? state.cx : state.x;
};

const getTownCenterY = (state: WorldState["towns"][number]): number => {
  return Number.isFinite(state.cy) ? state.cy : state.y;
};

const pickRestoredTileType = (moisture: number, elevation: number): TileType => {
  if (elevation > 0.84) {
    return moisture > 0.42 ? "rocky" : "bare";
  }
  if (moisture >= 0.68) {
    return elevation < 0.48 ? "floodplain" : "forest";
  }
  if (moisture >= 0.46) {
    return "forest";
  }
  if (moisture >= 0.26) {
    return "grass";
  }
  return "scrub";
};

const applyRestoredBiomeState = (state: WorldState, idx: number): void => {
  const tile = state.tiles[idx];
  const nextType = pickRestoredTileType(tile.moisture, tile.elevation);
  tile.type = nextType;
  tile.houseValue = 0;
  tile.houseResidents = 0;
  tile.houseDestroyed = false;
  tile.houseConstructionYear = undefined;
  tile.houseDamage01 = 0;
  tile.ashAge = 0;
  tile.buildingClass = null;
  tile.dominantTreeType = null;
  tile.treeType = null;

  if (nextType === "forest") {
    tile.vegetationAgeYears = 8 + tile.moisture * 4;
  } else if (nextType === "grass" || nextType === "scrub" || nextType === "floodplain") {
    tile.vegetationAgeYears = 1.5 + tile.moisture * 1.5;
  } else {
    clearVegetationState(tile);
    return;
  }
  const x = idx % state.grid.cols;
  const y = Math.floor(idx / state.grid.cols);
  syncDerivedVegetationState(tile, state.seed, x, y);
};

const clearHouseAnchor = (state: WorldState, idx: number): void => {
  state.tileStructure[idx] = STRUCTURE_NONE;
  state.tileTownId[idx] = -1;
  state.structureMask[idx] = 0;
};

/*
 * Single source of truth for house ownership mutation:
 * - `tileStructure[idx] == STRUCTURE_HOUSE` means a house anchor exists on this tile.
 * - Every house anchor must have `tileTownId[idx]` pointing at a valid town.
 * - `town.houseCount` mirrors the number of house anchors owned by that town.
 */
export function placeHouse(state: WorldState, idx: number, townId: number, constructionYear?: number): boolean {
  if (idx < 0 || idx >= state.grid.totalTiles || !isValidTownId(state, townId)) {
    return false;
  }

  const tile = state.tiles[idx];
  if (!tile) {
    return false;
  }
  if (
    state.tileStructure[idx] !== STRUCTURE_NONE ||
    state.structureMask[idx] !== 0 ||
    tile.type === "water" ||
    tile.type === "base"
  ) {
    return false;
  }

  const prevType = tile.type;
  const houseValue =
    Number.isFinite(tile.houseValue) && tile.houseValue > 0 ? Math.floor(tile.houseValue) : DEFAULT_HOUSE_VALUE;
  const houseResidents =
    Number.isFinite(tile.houseResidents) && tile.houseResidents > 0
      ? Math.floor(tile.houseResidents)
      : DEFAULT_HOUSE_RESIDENTS;

  tile.type = "house";
  tile.isBase = false;
  clearVegetationState(tile);
  tile.dominantTreeType = null;
  tile.treeType = null;
  tile.houseValue = houseValue;
  tile.houseResidents = houseResidents;
  tile.houseDestroyed = false;
  tile.houseConstructionYear = Number.isFinite(constructionYear) ? constructionYear : state.year;
  tile.houseDamage01 = 0;
  tile.ashAge = 0;
  tile.buildingClass = "residential_low";

  state.tileStructure[idx] = STRUCTURE_HOUSE;
  state.tileTownId[idx] = townId;
  state.structureMask[idx] = 1;
  state.towns[townId].houseCount += 1;
  state.totalHouses += 1;
  state.totalPropertyValue += houseValue;
  state.totalPopulation += houseResidents;

  if (prevType !== "house") {
    state.terrainTypeRevision += 1;
  }
  state.structureRevision += 1;
  state.terrainDirty = true;
  syncTileSoAIndex(state, idx);
  return true;
}

export function removeHouse(state: WorldState, idx: number): boolean {
  if (idx < 0 || idx >= state.grid.totalTiles || state.tileStructure[idx] !== STRUCTURE_HOUSE) {
    return false;
  }
  const townId = state.tileTownId[idx];
  if (!isValidTownId(state, townId)) {
    return false;
  }
  const tile = state.tiles[idx];
  if (!tile || tile.type !== "house" || tile.houseDestroyed) {
    return false;
  }

  state.towns[townId].houseCount = Math.max(0, state.towns[townId].houseCount - 1);
  state.totalHouses = Math.max(0, state.totalHouses - 1);
  state.totalPropertyValue = Math.max(0, state.totalPropertyValue - Math.max(0, tile.houseValue));
  state.totalPopulation = Math.max(0, state.totalPopulation - Math.max(0, tile.houseResidents));

  clearHouseAnchor(state, idx);
  tile.buildingClass = null;

  const prevType = tile.type;
  applyRestoredBiomeState(state, idx);
  if (prevType !== state.tiles[idx].type) {
    state.terrainTypeRevision += 1;
  }
  state.structureRevision += 1;
  state.terrainDirty = true;
  syncTileSoAIndex(state, idx);
  return true;
}

export function destroyHouse(state: WorldState, idx: number): boolean {
  if (idx < 0 || idx >= state.grid.totalTiles || state.tileStructure[idx] !== STRUCTURE_HOUSE) {
    return false;
  }
  const townId = state.tileTownId[idx];
  if (!isValidTownId(state, townId)) {
    return false;
  }
  const tile = state.tiles[idx];
  if (!tile || tile.type !== "house" || tile.houseDestroyed) {
    return false;
  }

  state.towns[townId].houseCount = Math.max(0, state.towns[townId].houseCount - 1);
  // Keep totalHouses unchanged so fire-loss metrics remain stable via destroyedHouses.
  state.totalPropertyValue = Math.max(0, state.totalPropertyValue - Math.max(0, tile.houseValue));
  state.totalPopulation = Math.max(0, state.totalPopulation - Math.max(0, tile.houseResidents));

  clearHouseAnchor(state, idx);
  tile.houseDestroyed = true;
  tile.houseDamage01 = 1;
  tile.houseConstructionYear = tile.houseConstructionYear ?? state.year;
  tile.buildingClass = null;
  state.structureRevision += 1;
  state.terrainDirty = true;
  syncTileSoAIndex(state, idx);
  return true;
}

export function resolveNearestTownId(state: WorldState, x: number, y: number): number {
  if (state.towns.length === 0) {
    return -1;
  }
  let bestTownId = -1;
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (let i = 0; i < state.towns.length; i += 1) {
    const town = state.towns[i];
    const tx = getTownCenterX(town);
    const ty = getTownCenterY(town);
    const dx = x - tx;
    const dy = y - ty;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq || (distSq === bestDistSq && town.id < bestTownId)) {
      bestDistSq = distSq;
      bestTownId = town.id;
    }
  }
  return bestTownId;
}

export function recountTownHouses(state: WorldState): void {
  for (let i = 0; i < state.towns.length; i += 1) {
    state.towns[i].houseCount = 0;
  }
  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    if (state.tileStructure[idx] !== STRUCTURE_HOUSE) {
      continue;
    }
    const tile = state.tiles[idx];
    if (!tile || tile.type !== "house") {
      state.tileStructure[idx] = STRUCTURE_NONE;
      state.tileTownId[idx] = -1;
      if (state.structureMask[idx] > 0) {
        state.structureMask[idx] = 0;
      }
      continue;
    }
    let townId = state.tileTownId[idx];
    if (!isValidTownId(state, townId)) {
      const x = idx % state.grid.cols;
      const y = Math.floor(idx / state.grid.cols);
      townId = resolveNearestTownId(state, x, y);
      if (!isValidTownId(state, townId)) {
        state.tileStructure[idx] = STRUCTURE_NONE;
        state.tileTownId[idx] = -1;
        if (state.structureMask[idx] > 0) {
          state.structureMask[idx] = 0;
        }
        continue;
      }
      state.tileTownId[idx] = townId;
    }
    state.towns[townId].houseCount += 1;
  }
}

export function validateTownInvariants(state: WorldState): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const counts = new Int32Array(state.towns.length);
  const maxErrors = 64;
  const pushError = (message: string): void => {
    if (errors.length < maxErrors) {
      errors.push(message);
    }
  };

  for (let townIndex = 0; townIndex < state.towns.length; townIndex += 1) {
    if (state.towns[townIndex].id !== townIndex) {
      pushError(`town id mismatch at index ${townIndex}: id=${state.towns[townIndex].id}`);
    }
  }

  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    const structure = state.tileStructure[idx];
    const townId = state.tileTownId[idx];
    const tile = state.tiles[idx];

    if (structure === STRUCTURE_HOUSE) {
      if (!isValidTownId(state, townId)) {
        pushError(`house tile ${idx} has invalid town id ${townId}`);
      } else {
        counts[townId] += 1;
      }
      if (!tile || tile.type !== "house") {
        pushError(`tile ${idx} has house structure flag but type ${tile?.type ?? "missing"}`);
      }
      continue;
    }

    if (tile?.type === "house") {
      pushError(`tile ${idx} has type house but no house structure flag`);
    }
    if (townId !== -1) {
      pushError(`tile ${idx} has town id ${townId} without house structure`);
    }
  }

  for (let i = 0; i < state.towns.length; i += 1) {
    if (counts[i] !== state.towns[i].houseCount) {
      pushError(`town ${i} count mismatch expected=${counts[i]} actual=${state.towns[i].houseCount}`);
    }
  }

  if (errors.length === maxErrors) {
    errors.push("additional invariant errors omitted");
  }

  return { ok: errors.length === 0, errors };
}
