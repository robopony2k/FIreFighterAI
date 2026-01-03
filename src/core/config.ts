import type { FuelProfile, Point, TileType, UnitKind, Wind } from "./types.js";

export const TILE_SIZE = 10;
export const ZOOM_MIN = 0.7;
export const ZOOM_MAX = 2.5;
export const ZOOM_STEP = 0.1;
export const ISO_TILE_WIDTH = TILE_SIZE * 2;
export const ISO_TILE_HEIGHT = TILE_SIZE;
export const HEIGHT_SCALE = TILE_SIZE * 6.5;
export const HEIGHT_WATER_DROP = TILE_SIZE * 0.7;

export const CAREER_YEARS = 20;
export const DAYS_PER_SECOND = 4;
export const GROWTH_SPEED_MULTIPLIER = 3;
export const FIREBREAK_COST_PER_TILE = 45;
export const BASE_BUDGET = 320;
export const APPROVAL_MIN = 0.2;
export const FIRE_IGNITION_CHANCE_PER_DAY = 0.08;
export const FIRE_SIM_SPEED = 2.6;
export const FIRE_SEASON_TAPER_DAYS = 22;
export const FIRE_SEASON_MIN_INTENSITY = 0.2;
export const FIRE_DAY_FACTOR_MIN = 0.65;
export const FIRE_DAY_FACTOR_MAX = 1.35;
export const FIRE_JUMP_WIND_THRESHOLD = 0.7;
export const FIRE_JUMP_BASE_CHANCE = 0.25;
export const FIRE_JUMP_HEAT_BOOST = 0.4;
export const FIRE_JUMP_DOT_THRESHOLD = 0.2;

export const FIRE_COLORS = ["#d34b2a", "#f09a3e", "#f2c94c"];

export const TILE_COLORS: Record<TileType, string> = {
  water: "#2a6f97",
  grass: "#5a8f4e",
  forest: "#2f5d31",
  ash: "#4a4a4a",
  road: "#bdb49c",
  base: "#a12f1d",
  house: "#c08a5a",
  firebreak: "#d6c6a6"
};

const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const clean = hex.replace("#", "");
  const value = parseInt(clean, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255
  };
};

export const TILE_COLOR_RGB: Record<TileType, { r: number; g: number; b: number }> = {
  water: hexToRgb(TILE_COLORS.water),
  grass: hexToRgb(TILE_COLORS.grass),
  forest: hexToRgb(TILE_COLORS.forest),
  ash: hexToRgb(TILE_COLORS.ash),
  road: hexToRgb(TILE_COLORS.road),
  base: hexToRgb(TILE_COLORS.base),
  house: hexToRgb(TILE_COLORS.house),
  firebreak: hexToRgb(TILE_COLORS.firebreak)
};

export const ELEVATION_TINT_LOW = { r: 74, g: 102, b: 93 };
export const ELEVATION_TINT_HIGH = { r: 201, g: 174, b: 129 };
export const DRY_TINT = { r: 166, g: 152, b: 111 };
export const WET_TINT = { r: 55, g: 98, b: 72 };
export const CONTOUR_STEP = 0.08;
export const CONTOUR_BAND = 0.012;
export const LIGHT_DIR = { x: 0.6, y: -0.8 };

export const UNIT_CONFIG: Record<UnitKind, { cost: number; speed: number; radius: number; power: number; color: string }> = {
  firefighter: { cost: 50, speed: 4.2, radius: 1.1, power: 0.5, color: "#f0b33b" },
  truck: { cost: 120, speed: 2.8, radius: 2.2, power: 0.75, color: "#c0462c" }
};

export const WATER_PARTICLE_COLOR = "#7ad4ff";

export const FUEL_PROFILES: Record<TileType, FuelProfile> = {
  water: { baseFuel: 0, ignition: 9, burnRate: 0, heatOutput: 0 },
  grass: { baseFuel: 0.75, ignition: 0.28, burnRate: 0.32, heatOutput: 1.0 },
  forest: { baseFuel: 1.35, ignition: 0.42, burnRate: 0.24, heatOutput: 1.35 },
  road: { baseFuel: 0, ignition: 9, burnRate: 0, heatOutput: 0 },
  base: { baseFuel: 1.1, ignition: 0.38, burnRate: 0.3, heatOutput: 1.15 },
  house: { baseFuel: 1.2, ignition: 0.32, burnRate: 0.28, heatOutput: 1.4 },
  firebreak: { baseFuel: 0, ignition: 9, burnRate: 0, heatOutput: 0 },
  ash: { baseFuel: 0, ignition: 9, burnRate: 0, heatOutput: 0 }
};

export const NEIGHBOR_DIRS: Point[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 }
];

export const WIND_DIRS: Wind[] = [
  { name: "N", dx: 0, dy: -1, strength: 0.7 },
  { name: "NE", dx: 1, dy: -1, strength: 0.7 },
  { name: "E", dx: 1, dy: 0, strength: 0.7 },
  { name: "SE", dx: 1, dy: 1, strength: 0.7 },
  { name: "S", dx: 0, dy: 1, strength: 0.7 },
  { name: "SW", dx: -1, dy: 1, strength: 0.7 },
  { name: "W", dx: -1, dy: 0, strength: 0.7 },
  { name: "NW", dx: -1, dy: -1, strength: 0.7 }
];

export const LEADERBOARD_KEY = "fireline.leaderboard";

