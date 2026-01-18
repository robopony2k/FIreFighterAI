import { TILE_FUEL_PROFILES } from "./generated/fuelProfiles.js";
export const TILE_SIZE = 10;
export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 4.5;
export const ZOOM_STEP = 0.1;
export const ISO_TILE_WIDTH = TILE_SIZE * 2;
export const ISO_TILE_HEIGHT = TILE_SIZE;
export const HEIGHT_SCALE = TILE_SIZE * 6.5;
export const HEIGHT_WATER_DROP = TILE_SIZE * 0.7;
export const MAP_SCALE = 0.65;
export const MAP_SIZE_PRESETS = {
    medium: 64,
    massive: 128,
    colossal: 256,
    gigantic: 512,
    titanic: 1024
};
export const CAREER_YEARS = 20;
export const DAYS_PER_SECOND = 4;
export const GROWTH_SPEED_MULTIPLIER = 3;
export const DEBUG_GROWTH_METRICS = false;
export const FIREBREAK_COST_PER_TILE = 45;
export const BASE_BUDGET = 320;
export const APPROVAL_MIN = 0.2;
export const FIRE_IGNITION_CHANCE_PER_DAY = 0.08;
export const FIRE_SIM_SPEED = 1.8;
export const FIRE_SIM_TICK_SECONDS = 2;
export const FIRE_SIM_ROWS_PER_SLICE = 8;
export const FIRE_PHASE_TIME_SCALE = 0.125;
export const FIRE_RENDER_SMOOTH_SECONDS = 0.5;
export const FIRE_SEASON_TAPER_DAYS = 22;
export const FIRE_SEASON_MIN_INTENSITY = 0.2;
export const FIRE_DAY_FACTOR_MIN = 0.65;
export const FIRE_DAY_FACTOR_MAX = 1.35;
export const FIRE_JUMP_WIND_THRESHOLD = 0.7;
export const FIRE_JUMP_BASE_CHANCE = 0.25;
export const FIRE_JUMP_HEAT_BOOST = 0.4;
export const FIRE_JUMP_DOT_THRESHOLD = 0.2;
export const HECTARES_PER_TILE = 1;
export const RECRUIT_FIREFIGHTER_COST = 140;
export const RECRUIT_TRUCK_COST = 320;
export const TRAINING_COST = 90;
export const MAX_TRAINING_LEVEL = 5;
export const TRAINING_SPEED_GAIN = 0.08;
export const TRAINING_POWER_GAIN = 0.12;
export const TRAINING_RANGE_GAIN = 0.1;
export const TRAINING_RESILIENCE_GAIN = 0.12;
export const UNIT_LOSS_FIRE_THRESHOLD = 0.55;
export const TRUCK_CAPACITY = 3;
export const TRUCK_BOARD_RADIUS = 1.6;
export const FIREFIGHTER_TETHER_DISTANCE = 10;
export const FORMATION_SPACING = {
    narrow: 1.5,
    medium: 2.5,
    wide: 4.0
};
export const MOVE_UPHILL_FACTOR = 2.1;
export const MOVE_DOWNHILL_FACTOR = 0.8;
export const MOVE_SLOPE_MIN = 0.65;
export const MOVE_SLOPE_MAX = 2.2;
export const MOVE_TERRAIN_COST = {
    water: 99,
    grass: 1.15,
    forest: 1.5,
    ash: 1.25,
    road: 1,
    base: 1.05,
    house: 1.2,
    firebreak: 1.05
};
export const FIRE_COLORS = ["#d34b2a", "#f09a3e", "#f2c94c"];
export const TILE_COLORS = {
    water: "#2a6f97",
    grass: "#5a8f4e",
    forest: "#2f5d31",
    ash: "#4a4a4a",
    road: "#bdb49c",
    base: "#a12f1d",
    house: "#c08a5a",
    firebreak: "#d6c6a6",
    ON_FIRE_GRASS: "#8a765a"
};
const hexToRgb = (hex) => {
    const clean = hex.replace("#", "");
    const value = parseInt(clean, 16);
    return {
        r: (value >> 16) & 255,
        g: (value >> 8) & 255,
        b: value & 255
    };
};
export const TILE_COLOR_RGB = {
    water: hexToRgb(TILE_COLORS.water),
    grass: hexToRgb(TILE_COLORS.grass),
    forest: hexToRgb(TILE_COLORS.forest),
    ash: hexToRgb(TILE_COLORS.ash),
    road: hexToRgb(TILE_COLORS.road),
    base: hexToRgb(TILE_COLORS.base),
    house: hexToRgb(TILE_COLORS.house),
    firebreak: hexToRgb(TILE_COLORS.firebreak),
    ON_FIRE_GRASS: hexToRgb(TILE_COLORS.ON_FIRE_GRASS)
};
export const ELEVATION_TINT_LOW = { r: 74, g: 102, b: 93 };
export const ELEVATION_TINT_HIGH = { r: 201, g: 174, b: 129 };
export const DRY_TINT = { r: 166, g: 152, b: 111 };
export const WET_TINT = { r: 55, g: 98, b: 72 };
export const CONTOUR_STEP = 0.08;
export const CONTOUR_BAND = 0.012;
export const LIGHT_DIR = { x: 0.6, y: -0.8 };
export const TIME_SPEED_OPTIONS = [1, 2, 3, 5];
export const UNIT_CONFIG = {
    firefighter: { cost: 50, speed: 3.2, radius: 1.1, power: 0.5, color: "#f0b33b" },
    truck: { cost: 120, speed: 5.4, radius: 2.2, power: 0.75, color: "#c0462c" }
};
export const WATER_PARTICLE_COLOR = "#7ad4ff";
export const FUEL_PROFILES = TILE_FUEL_PROFILES;
export const NEIGHBOR_DIRS = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: -1, y: 1 }
];
export const WIND_DIRS = [
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
