import type { WorldState } from "../../../core/state.js";
import { getVegetationFuelCapMultiplier, isVegetationType } from "../../../core/vegetation.js";
import { getFuelProfiles } from "../../../core/tiles.js";

const ANNUAL_FUEL_CATCHUP = 0.16;
export const NEW_CAMPAIGN_VEGETATION_FUEL_FRACTION = 0.6;

const getAgeAdjustedFuelCapacity = (state: WorldState, idx: number): number => {
  const tile = state.tiles[idx];
  if (!tile || !isVegetationType(tile.type)) return 0;
  const maturity = getVegetationFuelCapMultiplier(tile.type, tile.vegetationAgeYears);
  return Math.max(0, getFuelProfiles()[tile.type].baseFuel * maturity * (1 - tile.moisture * 0.6));
};

export const growAnnualVegetationFuel = (state: WorldState, idx: number): boolean => {
  const tile = state.tiles[idx];
  if (!tile || !isVegetationType(tile.type)) return false;
  const capacity = getAgeAdjustedFuelCapacity(state, idx);
  if (capacity <= tile.fuel + 1e-6) return false;
  tile.fuel = Math.min(capacity, tile.fuel + (capacity - tile.fuel) * ANNUAL_FUEL_CATCHUP);
  state.tileFuel[idx] = tile.fuel;
  return true;
};

export const initializeCampaignVegetationFuel = (state: WorldState): number => {
  let changed = 0;
  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    const tile = state.tiles[idx];
    if (!tile || !isVegetationType(tile.type)) continue;
    tile.fuel = getAgeAdjustedFuelCapacity(state, idx) * NEW_CAMPAIGN_VEGETATION_FUEL_FRACTION;
    state.tileFuel[idx] = tile.fuel;
    changed += 1;
  }
  return changed;
};
