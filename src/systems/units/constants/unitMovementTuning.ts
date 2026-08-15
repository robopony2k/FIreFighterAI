import type { TileType } from "../../../core/types.js";

export const FOOT_MOVE_UPHILL_FACTOR = 2.1;
export const FOOT_MOVE_DOWNHILL_FACTOR = 0.8;
export const FOOT_MOVE_SLOPE_MIN = 0.65;
export const FOOT_MOVE_SLOPE_MAX = 2.2;

export const UNIT_TERRAIN_MOVE_COST: Record<TileType, number> = {
  water: 99,
  beach: 1.1,
  floodplain: 1.25,
  grass: 1.15,
  scrub: 1.3,
  forest: 1.5,
  rocky: 1.6,
  bare: 1.4,
  ash: 1.25,
  road: 1,
  base: 1.05,
  house: 1.2,
  firebreak: 1.05
};

export const VEHICLE_OFF_ROAD_COST_MULTIPLIER = 6;
export const VEHICLE_PREFERRED_SLOPE_ANGLE_DEG = 12;
export const VEHICLE_SOFT_SLOPE_ANGLE_DEG = 18;
export const VEHICLE_AVOID_SLOPE_ANGLE_DEG = 28;
export const VEHICLE_IMPASSABLE_SLOPE_ANGLE_DEG = 38;
export const VEHICLE_SOFT_SLOPE_MULTIPLIER = 2;
export const VEHICLE_AVOID_SLOPE_MULTIPLIER = 6;
export const VEHICLE_MAX_SLOPE_MULTIPLIER = 12;
