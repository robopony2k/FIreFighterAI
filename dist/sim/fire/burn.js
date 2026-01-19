import { FUEL_PROFILES } from "../../core/config.js";
import { clamp } from "../../core/utils.js";
const MIN_IGNITION_POINT = 0.0001;
export function burnTile(state, tile, fireDelta) {
    const conflagrationHeatBoost = state.fireSettings.conflagrationHeatBoost;
    const conflagrationFuelBoost = state.fireSettings.conflagrationFuelBoost;
    const ignitionPoint = Math.max(tile.ignitionPoint, MIN_IGNITION_POINT);
    const heatRatio = tile.heat / (ignitionPoint * 1.6);
    const overheatFactor = Math.max(0, (tile.heat - ignitionPoint) / ignitionPoint);
    const growth = fireDelta * tile.burnRate * (heatRatio - 0.45 + overheatFactor * conflagrationHeatBoost);
    tile.fire = clamp(tile.fire + growth, 0, 1);
    const fuelDrain = fireDelta * tile.burnRate * (0.6 + tile.fire * 0.9 + overheatFactor * conflagrationFuelBoost);
    tile.fuel = Math.max(0, tile.fuel - fuelDrain);
    if (tile.fuel <= 0.02 && tile.type !== "ash") {
        if (tile.type === "house" && !tile.houseDestroyed) {
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
        tile.heat *= 0.4;
        if (!tile.isBase) {
            state.burnedTiles += 1;
            state.yearBurnedTiles += 1;
        }
        state.terrainDirty = true;
        const ashProfile = FUEL_PROFILES.ash;
        tile.spreadBoost = ashProfile.spreadBoost;
        tile.heatTransferCap = ashProfile.heatTransferCap;
        tile.heatRetention = ashProfile.heatRetention;
        tile.windFactor = ashProfile.windFactor;
        return true;
    }
    return false;
}
