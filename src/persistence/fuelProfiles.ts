import type { FuelProfile, TileType } from "../core/types.js";
import { FUEL_PROFILES } from "../core/config.js";
import type { FuelProfileOverrides } from "../ui/run-config.js";

const FUEL_PROFILE_KEY = "fireline.fuelProfiles";

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

const TILE_TYPES = Object.keys(FUEL_PROFILES) as TileType[];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toNumberOrNull = (value: unknown): number | null => {
  const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

const sanitizeOverrides = (input: unknown): FuelProfileOverrides => {
  if (!isRecord(input)) {
    return {};
  }
  const result: FuelProfileOverrides = {};
  for (const type of TILE_TYPES) {
    const entry = input[type];
    if (!isRecord(entry)) {
      continue;
    }
    const cleaned: Partial<FuelProfile> = {};
    for (const key of FUEL_PROFILE_FIELDS) {
      const numeric = toNumberOrNull(entry[key]);
      if (numeric !== null) {
        cleaned[key] = numeric;
      }
    }
    if (Object.keys(cleaned).length > 0) {
      result[type] = cleaned;
    }
  }
  return result;
};

export function loadFuelProfileOverrides(): FuelProfileOverrides {
  const raw = localStorage.getItem(FUEL_PROFILE_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return sanitizeOverrides(parsed);
  } catch {
    return {};
  }
}

export function saveFuelProfileOverrides(overrides: FuelProfileOverrides): void {
  const sanitized = sanitizeOverrides(overrides);
  localStorage.setItem(FUEL_PROFILE_KEY, JSON.stringify(sanitized));
}
