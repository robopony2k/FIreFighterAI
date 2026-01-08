// Generated from config/tile-profiles.yml. Do not edit directly.
import type { FuelProfile, TileType } from "../types.js";

export const TILE_FUEL_PROFILES: Record<TileType, FuelProfile> = {
  water: {
    baseFuel: 0,
    ignition: 9,
    burnRate: 0,
    heatOutput: 0,
    spreadBoost: 0,
    heatTransferCap: 0,
    heatRetention: 0.4,
    windFactor: 0
  },
  grass: {
    baseFuel: 0.5,
    ignition: 0.1,
    burnRate: 0.95,
    heatOutput: 1,
    spreadBoost: 1.12,
    heatTransferCap: 0.4,
    heatRetention: 0.75,
    windFactor: 0.5
  },
  forest: {
    baseFuel: 1.35,
    ignition: 0.6,
    burnRate: 0.64,
    heatOutput: 1.35,
    spreadBoost: 1.25,
    heatTransferCap: 5,
    heatRetention: 1,
    windFactor: 0.5
  },
  road: {
    baseFuel: 0,
    ignition: 9,
    burnRate: 0,
    heatOutput: 0,
    spreadBoost: 0,
    heatTransferCap: 0,
    heatRetention: 0.4,
    windFactor: 0
  },
  base: {
    baseFuel: 1.1,
    ignition: 0.38,
    burnRate: 0.3,
    heatOutput: 1.15,
    spreadBoost: 1,
    heatTransferCap: 4,
    heatRetention: 0.9,
    windFactor: 0.7
  },
  house: {
    baseFuel: 1.2,
    ignition: 0.32,
    burnRate: 0.28,
    heatOutput: 1.4,
    spreadBoost: 1.1,
    heatTransferCap: 4.2,
    heatRetention: 0.85,
    windFactor: 0.75
  },
  firebreak: {
    baseFuel: 0,
    ignition: 9,
    burnRate: 0,
    heatOutput: 0,
    spreadBoost: 0,
    heatTransferCap: 0,
    heatRetention: 0.4,
    windFactor: 0
  },
  ash: {
    baseFuel: 0,
    ignition: 9,
    burnRate: 0,
    heatOutput: 0,
    spreadBoost: 0,
    heatTransferCap: 0,
    heatRetention: 0.55,
    windFactor: 0
  },
};
