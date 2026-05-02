import type { FuelProfile, RNG, Tile, TileType } from "./types.js";
import { FUEL_PROFILES } from "./config.js";
import { getVegetationFuelCapMultiplier } from "./vegetation.js";
import { clamp } from "./utils.js";

const FUEL_PROFILE_FIELDS: (keyof FuelProfile)[] = [
  "baseFuel",
  "ignition",
  "burnRate",
  "heatOutput",
  "spreadBoost",
  "heatTransferCap",
  "heatRetention",
  "windFactor"
];

const cloneProfile = (profile: FuelProfile): FuelProfile => ({
  baseFuel: profile.baseFuel,
  ignition: profile.ignition,
  burnRate: profile.burnRate,
  heatOutput: profile.heatOutput,
  spreadBoost: profile.spreadBoost,
  heatTransferCap: profile.heatTransferCap,
  heatRetention: profile.heatRetention,
  windFactor: profile.windFactor
});

const ACTIVE_FUEL_PROFILES: Record<TileType, FuelProfile> = Object.keys(FUEL_PROFILES).reduce(
  (acc, key) => {
    const type = key as TileType;
    acc[type] = cloneProfile(FUEL_PROFILES[type]);
    return acc;
  },
  {} as Record<TileType, FuelProfile>
);

type FuelProfileOverrides = Partial<Record<TileType, Partial<FuelProfile>>>;

export function setFuelProfiles(overrides?: FuelProfileOverrides): void {
  const types = Object.keys(FUEL_PROFILES) as TileType[];
  for (const type of types) {
    const base = FUEL_PROFILES[type];
    const entry = overrides?.[type];
    const next = cloneProfile(base);
    if (entry) {
      for (const key of FUEL_PROFILE_FIELDS) {
        const value = entry[key];
        if (Number.isFinite(value)) {
          next[key] = Number(value);
        }
      }
    }
    ACTIVE_FUEL_PROFILES[type] = next;
  }
}

export function getFuelProfiles(): Record<TileType, FuelProfile> {
  return ACTIVE_FUEL_PROFILES;
}

export function applyFuel(tile: Tile, moisture: number, _rng: RNG): void {
  const profile = ACTIVE_FUEL_PROFILES[tile.type];
  const fuelCap = profile.baseFuel * getVegetationFuelCapMultiplier(tile.type, tile.vegetationAgeYears ?? 0);
  const fuel = Math.max(0, fuelCap * (1 - moisture * 0.6));
  tile.fuel = fuel;
  tile.fire = 0;
  tile.heat = 0;
  tile.ignitionPoint = clamp(profile.ignition + moisture * 0.35, 0.2, 1.4);
  tile.burnRate = profile.burnRate * (0.7 + (1 - moisture) * 0.8);
  tile.heatOutput = profile.heatOutput * (0.85 + fuel * 0.25);
  tile.spreadBoost = profile.spreadBoost;
  tile.heatTransferCap = profile.heatTransferCap;
  tile.heatRetention = profile.heatRetention;
  tile.windFactor = profile.windFactor;
}

