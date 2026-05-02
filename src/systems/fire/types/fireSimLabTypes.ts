import { DEFAULT_INCIDENT_TIME_SPEED_INDEX, INCIDENT_TIME_SPEED_OPTIONS, UNIT_CONFIG } from "../../../core/config.js";
import type { FuelProfile, TileType } from "../../../core/types.js";

export type FireSimLabScenarioId =
  | "mixed-fuels"
  | "straight-road"
  | "fuel-strips"
  | "wind-break";

export type FireSimLabTool = "paint" | "ignite" | "cool" | "firefighter";

export type FireSimLabProfileField = keyof FuelProfile;

export type FireSimLabScenarioDefinition = {
  id: FireSimLabScenarioId;
  label: string;
};

export type FireSimLabEnvironment = {
  windDirectionDeg: number;
  windStrength: number;
  temperatureC: number;
  moisture: number;
  climateRisk: number;
  simSpeed: number;
};

export type FireSimLabStats = {
  elapsedDays: number;
  activeTiles: number;
  burnedTiles: number;
  burningArea: number;
  maxFire: number;
  maxHeat: number;
  downwindReach: number;
};

export type FireSimLabFirefighter = {
  x: number;
  y: number;
};

export type FireSimLabTileSnapshot = {
  type: TileType;
  fuel: number;
  fire: number;
  heat: number;
  burnAge: number;
  heatRelease: number;
  suppressionWetness: number;
  ashAge: number;
  houseDestroyed: boolean;
};

export type FireSimLabScenarioSnapshot = {
  version: 1;
  sourceScenarioId: FireSimLabScenarioId;
  grid: {
    cols: number;
    rows: number;
  };
  environment: FireSimLabEnvironment;
  profiles: Record<TileType, FuelProfile>;
  tiles: FireSimLabTileSnapshot[];
  firefighters: FireSimLabFirefighter[];
  elapsedDays: number;
  ignitionOrigin: { x: number; y: number } | null;
};

export type FireSimLabProfileFieldDefinition = {
  key: FireSimLabProfileField;
  label: string;
  min: number;
  max: number;
  step: number;
};

export const FIRE_SIM_LAB_GRID = {
  cols: 128,
  rows: 80
} as const;

export const FIRE_SIM_LAB_INCIDENT_TICK_SECONDS = 0.25;

export const FIRE_SIM_LAB_SPEED_OPTIONS = [
  ...INCIDENT_TIME_SPEED_OPTIONS,
  0.5,
  1
] as const;

export const DEFAULT_FIRE_SIM_LAB_SPEED =
  FIRE_SIM_LAB_SPEED_OPTIONS[DEFAULT_INCIDENT_TIME_SPEED_INDEX] ?? FIRE_SIM_LAB_SPEED_OPTIONS[1] ?? 0.03125;

export const FIRE_SIM_LAB_FIREFIGHTER_RADIUS = UNIT_CONFIG.firefighter.radius;
export const FIRE_SIM_LAB_FIREFIGHTER_COOLING_RADIUS = UNIT_CONFIG.firefighter.radius + 0.18;
export const FIRE_SIM_LAB_FIREFIGHTER_HOSE_RANGE = UNIT_CONFIG.firefighter.hoseRange;
export const FIRE_SIM_LAB_FIREFIGHTER_POWER = UNIT_CONFIG.firefighter.power;
export const FIRE_SIM_LAB_FIREFIGHTER_SYMBOL = "\u26D1";

export const normalizeFireSimLabSpeed = (value: number): number => {
  if (!Number.isFinite(value)) {
    return DEFAULT_FIRE_SIM_LAB_SPEED;
  }
  let nearest: number = FIRE_SIM_LAB_SPEED_OPTIONS[0] ?? DEFAULT_FIRE_SIM_LAB_SPEED;
  let nearestDiff = Math.abs(value - nearest);
  for (const option of FIRE_SIM_LAB_SPEED_OPTIONS) {
    const diff = Math.abs(value - option);
    if (diff < nearestDiff) {
      nearest = option;
      nearestDiff = diff;
    }
  }
  return nearest;
};

export const FIRE_SIM_LAB_SCENARIOS: readonly FireSimLabScenarioDefinition[] = [
  { id: "mixed-fuels", label: "Mixed Fuels" },
  { id: "straight-road", label: "Plain + Road" },
  { id: "fuel-strips", label: "Fuel Strips" },
  { id: "wind-break", label: "Wind Break" }
];

export const FIRE_SIM_LAB_TERRAIN_TYPES: readonly TileType[] = [
  "grass",
  "scrub",
  "forest",
  "floodplain",
  "house",
  "road",
  "firebreak",
  "bare",
  "rocky",
  "water"
];

export const FIRE_SIM_LAB_PROFILE_FIELDS: readonly FireSimLabProfileFieldDefinition[] = [
  { key: "baseFuel", label: "Fuel", min: 0, max: 2, step: 0.01 },
  { key: "ignition", label: "Ignition", min: 0.1, max: 2, step: 0.01 },
  { key: "burnRate", label: "Burn Rate", min: 0, max: 1.5, step: 0.01 },
  { key: "heatOutput", label: "Heat", min: 0, max: 2.5, step: 0.01 },
  { key: "spreadBoost", label: "Spread", min: 0, max: 2, step: 0.01 },
  { key: "heatTransferCap", label: "Transfer Cap", min: 0, max: 5, step: 0.01 },
  { key: "heatRetention", label: "Retention", min: 0, max: 1, step: 0.01 },
  { key: "windFactor", label: "Windbreak", min: 0, max: 1, step: 0.01 }
];

export const DEFAULT_FIRE_SIM_LAB_ENVIRONMENT: FireSimLabEnvironment = {
  windDirectionDeg: 65,
  windStrength: 0.65,
  temperatureC: 34,
  moisture: 0.26,
  climateRisk: 0.72,
  simSpeed: DEFAULT_FIRE_SIM_LAB_SPEED
};

export const normalizeFireSimLabScenarioId = (
  value: string | null | undefined
): FireSimLabScenarioId => {
  const normalized = (value ?? "").toLowerCase();
  return FIRE_SIM_LAB_SCENARIOS.find((scenario) => scenario.id === normalized)?.id ?? "mixed-fuels";
};
