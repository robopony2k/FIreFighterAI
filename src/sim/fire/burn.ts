
import type { WorldState } from "../../core/state.js";
import type { Tile } from "../../core/types.js";
import { clearVegetationState } from "../../core/vegetation.js";
import { getFuelProfiles } from "../../core/tiles.js";
import { destroyHouse } from "../../core/towns.js";
import { clamp } from "../../core/utils.js";
import { markTileSoADirty } from "../../core/tileCache.js";
import { recordTownHouseLoss } from "../towns.js";

const MIN_IGNITION_POINT = 0.0001;

export function burnTile(state: WorldState, tile: Tile, fireDelta: number): boolean {
  const fuelProfiles = getFuelProfiles();
  const conflagrationHeatBoost = state.fireSettings.conflagrationHeatBoost;
  const conflagrationFuelBoost = state.fireSettings.conflagrationFuelBoost;
  const ignitionPoint = Math.max(tile.ignitionPoint, MIN_IGNITION_POINT);
  const heatRatio = tile.heat / (ignitionPoint * 1.6);
  const overheatFactor = Math.max(0, (tile.heat - ignitionPoint) / ignitionPoint);
  const growth = fireDelta * tile.burnRate * (heatRatio - 0.45 + overheatFactor * conflagrationHeatBoost);
  tile.fire = clamp(tile.fire + growth, 0, 1);
  const fuelDrain = fireDelta * tile.burnRate * (0.6 + tile.fire * 0.9 + overheatFactor * conflagrationFuelBoost);
  tile.fuel = Math.max(0, tile.fuel - fuelDrain);
  const tileIndex = state.tiles.indexOf(tile);
  if (tile.fuel <= 0.02 && tile.type !== "ash") {
    if (tile.type === "house" && !tile.houseDestroyed) {
      const townId = tileIndex >= 0 ? state.tileTownId[tileIndex] ?? -1 : -1;
      if (townId >= 0) {
        recordTownHouseLoss(state, townId);
      }
      if (tileIndex < 0 || !destroyHouse(state, tileIndex)) {
        state.totalPropertyValue = Math.max(0, state.totalPropertyValue - Math.max(0, tile.houseValue));
        state.totalPopulation = Math.max(0, state.totalPopulation - Math.max(0, tile.houseResidents));
      }
      tile.houseDestroyed = true;
      state.destroyedHouses += 1;
      state.lostPropertyValue += tile.houseValue;
      state.lostResidents += tile.houseResidents;
      state.yearPropertyLost += tile.houseValue;
      state.yearLivesLost += tile.houseResidents;
    }
    tile.type = "ash";
    tile.fuel = 0;
    tile.ashAge = 0;
    clearVegetationState(tile);
    tile.dominantTreeType = null;
    tile.treeType = null;
    tile.heat *= 0.4;
    if (!tile.isBase) {
      state.burnedTiles += 1;
      state.yearBurnedTiles += 1;
    }
    state.terrainDirty = true;
    state.terrainTypeRevision += 1;
    state.vegetationRevision += 1;
    const ashProfile = fuelProfiles.ash;
    tile.spreadBoost = ashProfile.spreadBoost;
    tile.heatTransferCap = ashProfile.heatTransferCap;
    tile.heatRetention = ashProfile.heatRetention;
    tile.windFactor = ashProfile.windFactor;
    markTileSoADirty(state);
    return true;
  }
  return false;
}
