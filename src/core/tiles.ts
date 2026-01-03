import type { RNG, Tile } from "./types.js";
import { FUEL_PROFILES } from "./config.js";
import { clamp } from "./utils.js";

export function applyFuel(tile: Tile, moisture: number, rng: RNG): void {
  const profile = FUEL_PROFILES[tile.type];
  const variance = tile.type === "forest" || tile.type === "grass" ? (rng.next() - 0.5) * 0.35 : 0;
  const fuel = Math.max(0, profile.baseFuel * (1 + variance) * (1 - moisture * 0.6));
  tile.fuel = fuel;
  tile.fire = 0;
  tile.heat = 0;
  tile.ignitionPoint = clamp(profile.ignition + moisture * 0.35 + (tile.type === "forest" ? 0.08 : 0), 0.2, 1.4);
  tile.burnRate = profile.burnRate * (0.7 + (1 - moisture) * 0.8);
  tile.heatOutput = profile.heatOutput * (0.85 + fuel * 0.25);
}

