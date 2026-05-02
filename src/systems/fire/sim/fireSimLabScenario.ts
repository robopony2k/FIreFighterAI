import { FUEL_PROFILES } from "../../../core/config.js";
import { clamp } from "../../../core/utils.js";
import { TreeType, type FuelProfile, type Tile, type TileType } from "../../../core/types.js";
import { FIRE_SIM_LAB_GRID, type FireSimLabScenarioId } from "../types/fireSimLabTypes.js";

export const cloneFuelProfile = (profile: FuelProfile): FuelProfile => ({
  baseFuel: profile.baseFuel,
  ignition: profile.ignition,
  burnRate: profile.burnRate,
  heatOutput: profile.heatOutput,
  spreadBoost: profile.spreadBoost,
  heatTransferCap: profile.heatTransferCap,
  heatRetention: profile.heatRetention,
  windFactor: profile.windFactor
});

export const createFuelProfiles = (
  initialProfiles: Partial<Record<TileType, FuelProfile>> = {}
): Record<TileType, FuelProfile> =>
  (Object.keys(FUEL_PROFILES) as TileType[]).reduce(
    (profiles, type) => {
      profiles[type] = cloneFuelProfile(initialProfiles[type] ?? FUEL_PROFILES[type]);
      return profiles;
    },
    {} as Record<TileType, FuelProfile>
  );

export const getScenarioDefaultType = (scenarioId: FireSimLabScenarioId, x: number, y: number): TileType => {
  const { cols, rows } = FIRE_SIM_LAB_GRID;
  if (scenarioId === "straight-road") {
    return x === Math.floor(cols * 0.52) ? "road" : "grass";
  }
  if (scenarioId === "fuel-strips") {
    const band = Math.floor((y / rows) * 5);
    return (["grass", "scrub", "forest", "floodplain", "house"] as const)[clamp(band, 0, 4)];
  }
  if (scenarioId === "wind-break") {
    if (Math.abs(x - y * 0.9 - 10) <= 1.1) {
      return "firebreak";
    }
    if (x > cols * 0.58 && y > rows * 0.25 && y < rows * 0.82) {
      return "forest";
    }
    return x < cols * 0.36 ? "grass" : "scrub";
  }
  if (x < cols * 0.48 && y < rows * 0.5) {
    return "grass";
  }
  if (x >= cols * 0.48 && y < rows * 0.5) {
    return "scrub";
  }
  if (x < cols * 0.48) {
    return "floodplain";
  }
  return "forest";
};

export const createLabTile = (type: TileType): Tile => ({
  type,
  fuel: 0,
  fire: 0,
  isBase: false,
  elevation: 0.08,
  heat: 0,
  ignitionPoint: 0,
  burnRate: 0,
  heatOutput: 0,
  spreadBoost: 0,
  heatTransferCap: 0,
  heatRetention: 0,
  windFactor: 0,
  moisture: 0,
  waterDist: type === "water" ? 0 : 10,
  vegetationAgeYears: type === "forest" ? 22 : type === "scrub" ? 8 : 3,
  canopy: type === "forest" ? 0.85 : type === "scrub" ? 0.36 : 0,
  canopyCover: type === "forest" ? 0.85 : type === "scrub" ? 0.36 : 0,
  stemDensity: type === "forest" ? 8 : type === "scrub" ? 5 : 1,
  dominantTreeType: type === "forest" ? TreeType.Pine : type === "scrub" ? TreeType.Scrub : null,
  treeType: type === "forest" ? TreeType.Pine : type === "scrub" ? TreeType.Scrub : null,
  houseValue: type === "house" ? 180 : 0,
  houseResidents: type === "house" ? 2 : 0,
  houseDestroyed: false,
  ashAge: 0
});

export const applyProfileToTile = (
  tile: Tile,
  profile: FuelProfile,
  moisture: number,
  resetFuel: boolean
): void => {
  tile.moisture = clamp(moisture, 0, 1);
  tile.ignitionPoint = profile.baseFuel <= 0
    ? profile.ignition
    : clamp(profile.ignition + tile.moisture * 0.35, 0.1, 9);
  tile.burnRate = profile.burnRate * (0.7 + (1 - tile.moisture) * 0.8);
  tile.spreadBoost = profile.spreadBoost;
  tile.heatTransferCap = profile.heatTransferCap;
  tile.heatRetention = profile.heatRetention;
  tile.windFactor = profile.windFactor;
  if (resetFuel) {
    tile.fuel = Math.max(0, profile.baseFuel * (1 - tile.moisture * 0.55));
  }
  tile.heatOutput = profile.heatOutput * (0.85 + Math.max(0, tile.fuel) * 0.25);
};

export const shouldResetFuelOnProfileApply = (tile: Tile): boolean =>
  tile.fire <= 0.001 && tile.heat <= 0.02 && tile.type !== "ash";
