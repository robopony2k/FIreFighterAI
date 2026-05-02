import type { FuelProfile, TileType } from "../core/types.js";

export const TILE_FUEL_PROFILES: Record<TileType, FuelProfile> = {
  "water": {
    "baseFuel": 0,
    "ignition": 9,
    "burnRate": 0,
    "heatOutput": 0,
    "spreadBoost": 0,
    "heatTransferCap": 0,
    "heatRetention": 0.4,
    "windFactor": 0
  },
  "beach": {
    "baseFuel": 0,
    "ignition": 9,
    "burnRate": 0,
    "heatOutput": 0,
    "spreadBoost": 0,
    "heatTransferCap": 0,
    "heatRetention": 0.4,
    "windFactor": 0
  },
  "floodplain": {
    "baseFuel": 0.28,
    "ignition": 0.3,
    "burnRate": 0.7,
    "heatOutput": 0.65,
    "spreadBoost": 0.8,
    "heatTransferCap": 0.3,
    "heatRetention": 0.6,
    "windFactor": 0
  },
  "grass": {
    "baseFuel": 0.3,
    "ignition": 0.24,
    "burnRate": 0.78,
    "heatOutput": 0.82,
    "spreadBoost": 0.95,
    "heatTransferCap": 0.55,
    "heatRetention": 0.58,
    "windFactor": 0
  },
  "scrub": {
    "baseFuel": 0.45,
    "ignition": 0.35,
    "burnRate": 0.66,
    "heatOutput": 0.86,
    "spreadBoost": 0.98,
    "heatTransferCap": 0.65,
    "heatRetention": 0.64,
    "windFactor": 0.2
  },
  "forest": {
    "baseFuel": 1,
    "ignition": 0.66,
    "burnRate": 0.32,
    "heatOutput": 1.05,
    "spreadBoost": 1,
    "heatTransferCap": 1.25,
    "heatRetention": 0.78,
    "windFactor": 0.45
  },
  "rocky": {
    "baseFuel": 0,
    "ignition": 9,
    "burnRate": 0,
    "heatOutput": 0,
    "spreadBoost": 0,
    "heatTransferCap": 0,
    "heatRetention": 0.4,
    "windFactor": 0
  },
  "bare": {
    "baseFuel": 0,
    "ignition": 9,
    "burnRate": 0,
    "heatOutput": 0,
    "spreadBoost": 0,
    "heatTransferCap": 0,
    "heatRetention": 0.4,
    "windFactor": 0
  },
  "road": {
    "baseFuel": 0,
    "ignition": 9,
    "burnRate": 0,
    "heatOutput": 0,
    "spreadBoost": 0,
    "heatTransferCap": 0,
    "heatRetention": 0.4,
    "windFactor": 0
  },
  "base": {
    "baseFuel": 0.9,
    "ignition": 0.38,
    "burnRate": 0.3,
    "heatOutput": 1.15,
    "spreadBoost": 1,
    "heatTransferCap": 3.4,
    "heatRetention": 0.85,
    "windFactor": 0.7
  },
  "house": {
    "baseFuel": 1.2,
    "ignition": 0.9,
    "burnRate": 0.22,
    "heatOutput": 1.65,
    "spreadBoost": 1.05,
    "heatTransferCap": 3.8,
    "heatRetention": 0.84,
    "windFactor": 0.8
  },
  "firebreak": {
    "baseFuel": 0,
    "ignition": 9,
    "burnRate": 0,
    "heatOutput": 0,
    "spreadBoost": 0,
    "heatTransferCap": 0,
    "heatRetention": 0.4,
    "windFactor": 0
  },
  "ash": {
    "baseFuel": 0,
    "ignition": 9,
    "burnRate": 0,
    "heatOutput": 0,
    "spreadBoost": 0,
    "heatTransferCap": 0,
    "heatRetention": 0.55,
    "windFactor": 0
  }
};
