import { ASH_REGROW_DELAY } from "../core/time.js";
import { FUEL_PROFILES } from "../core/config.js";
import { clamp } from "../core/utils.js";
import { applyFuel } from "../core/tiles.js";
import { indexFor } from "../core/grid.js";
export function stepGrowth(state, dayDelta, rng) {
    const regrowChance = dayDelta * 0.015;
    const firebreakRecovery = dayDelta * 0.01;
    const fuelGrowth = dayDelta * 0.02;
    for (let y = 0; y < state.grid.rows; y += 1) {
        for (let x = 0; x < state.grid.cols; x += 1) {
            const idx = indexFor(state.grid, x, y);
            const tile = state.tiles[idx];
            if (tile.type === "ash" && !tile.houseDestroyed) {
                tile.ashAge += dayDelta;
                if (tile.ashAge < ASH_REGROW_DELAY) {
                    continue;
                }
                if (rng.next() < regrowChance * (0.4 + tile.moisture)) {
                    tile.type = "grass";
                    tile.canopy = 0.2 + tile.moisture * 0.3;
                    tile.ashAge = 0;
                    applyFuel(tile, tile.moisture, rng);
                    state.burnedTiles = Math.max(0, state.burnedTiles - 1);
                }
                continue;
            }
            if (tile.type === "firebreak") {
                if (!tile.houseDestroyed && rng.next() < firebreakRecovery * (0.3 + tile.moisture)) {
                    tile.type = "grass";
                    tile.canopy = 0.15 + tile.moisture * 0.2;
                    applyFuel(tile, tile.moisture, rng);
                }
                continue;
            }
            if (tile.type === "grass" || tile.type === "forest") {
                const profile = FUEL_PROFILES[tile.type];
                const maxFuel = profile.baseFuel * 1.15;
                tile.fuel = clamp(tile.fuel + fuelGrowth * (0.4 + tile.moisture), 0, maxFuel);
                tile.canopy = clamp(tile.canopy + dayDelta * 0.01 * (tile.type === "forest" ? 1.1 : 0.6), 0, 1);
            }
        }
    }
}
