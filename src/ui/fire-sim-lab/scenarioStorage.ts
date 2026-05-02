import { FUEL_PROFILES } from "../../core/config.js";
import type { FuelProfile, TileType } from "../../core/types.js";
import {
  DEFAULT_FIRE_SIM_LAB_ENVIRONMENT,
  FIRE_SIM_LAB_GRID,
  normalizeFireSimLabSpeed,
  normalizeFireSimLabScenarioId,
  type FireSimLabEnvironment,
  type FireSimLabFirefighter,
  type FireSimLabScenarioSnapshot,
  type FireSimLabTileSnapshot
} from "../../systems/fire/types/fireSimLabTypes.js";

export type FireSimLabSavedScenario = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  snapshot: FireSimLabScenarioSnapshot;
};

const STORAGE_KEY = "fireline.fireSimLabScenarios.v1";
const TILE_TYPES = Object.keys(FUEL_PROFILES) as TileType[];
const TILE_TYPE_SET = new Set<TileType>(TILE_TYPES);
const PROFILE_FIELDS: Array<keyof FuelProfile> = [
  "baseFuel",
  "ignition",
  "burnRate",
  "heatOutput",
  "spreadBoost",
  "heatTransferCap",
  "heatRetention",
  "windFactor"
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toFiniteNumber = (value: unknown): number | null => {
  const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const sanitizeProfileField = (key: keyof FuelProfile, value: number): number =>
  key === "windFactor" ? clamp(value, 0, 1) : Math.max(0, value);

const sanitizeTimestamp = (value: unknown): string => {
  if (typeof value !== "string") {
    return new Date().toISOString();
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : new Date().toISOString();
};

const sanitizeName = (value: unknown): string =>
  typeof value === "string" ? value.trim().slice(0, 48) : "";

const sanitizeId = (value: unknown): string =>
  typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, 80) : "";

const sanitizeTileType = (value: unknown): TileType =>
  typeof value === "string" && TILE_TYPE_SET.has(value as TileType) ? (value as TileType) : "grass";

const sanitizeGrid = (value: unknown): { cols: number; rows: number } => {
  if (!isRecord(value)) {
    return { ...FIRE_SIM_LAB_GRID };
  }
  const cols = toFiniteNumber(value.cols);
  const rows = toFiniteNumber(value.rows);
  return {
    cols: cols === null ? FIRE_SIM_LAB_GRID.cols : Math.max(1, Math.min(512, Math.floor(cols))),
    rows: rows === null ? FIRE_SIM_LAB_GRID.rows : Math.max(1, Math.min(512, Math.floor(rows)))
  };
};

const sanitizeEnvironment = (value: unknown): FireSimLabEnvironment => {
  const source = isRecord(value) ? value : {};
  const read = (key: keyof FireSimLabEnvironment, fallback: number, min: number, max: number): number => {
    const parsed = toFiniteNumber(source[key]);
    return parsed === null ? fallback : clamp(parsed, min, max);
  };
  return {
    windDirectionDeg: read("windDirectionDeg", DEFAULT_FIRE_SIM_LAB_ENVIRONMENT.windDirectionDeg, 0, 359),
    windStrength: read("windStrength", DEFAULT_FIRE_SIM_LAB_ENVIRONMENT.windStrength, 0, 1.5),
    temperatureC: read("temperatureC", DEFAULT_FIRE_SIM_LAB_ENVIRONMENT.temperatureC, 0, 50),
    moisture: read("moisture", DEFAULT_FIRE_SIM_LAB_ENVIRONMENT.moisture, 0, 1),
    climateRisk: read("climateRisk", DEFAULT_FIRE_SIM_LAB_ENVIRONMENT.climateRisk, 0, 1),
    simSpeed: normalizeFireSimLabSpeed(read("simSpeed", DEFAULT_FIRE_SIM_LAB_ENVIRONMENT.simSpeed, 0, 1))
  };
};

const sanitizeFuelProfile = (type: TileType, value: unknown): FuelProfile => {
  const source = isRecord(value) ? value : {};
  const fallback = FUEL_PROFILES[type];
  return PROFILE_FIELDS.reduce(
    (profile, key) => {
      const parsed = toFiniteNumber(source[key]);
      profile[key] = parsed === null ? fallback[key] : sanitizeProfileField(key, parsed);
      return profile;
    },
    {} as FuelProfile
  );
};

const sanitizeProfiles = (value: unknown): Record<TileType, FuelProfile> => {
  const source = isRecord(value) ? value : {};
  return TILE_TYPES.reduce(
    (profiles, type) => {
      profiles[type] = sanitizeFuelProfile(type, source[type]);
      return profiles;
    },
    {} as Record<TileType, FuelProfile>
  );
};

const sanitizeTileSnapshot = (value: unknown): FireSimLabTileSnapshot => {
  const source = isRecord(value) ? value : {};
  const read = (key: keyof FireSimLabTileSnapshot, fallback: number, min: number, max: number): number => {
    const parsed = toFiniteNumber(source[key]);
    return parsed === null ? fallback : clamp(parsed, min, max);
  };
  return {
    type: sanitizeTileType(source.type),
    fuel: read("fuel", 0, 0, 50),
    fire: read("fire", 0, 0, 1),
    heat: read("heat", 0, 0, 50),
    burnAge: read("burnAge", 0, 0, 1000),
    heatRelease: read("heatRelease", 0, 0, 50),
    suppressionWetness: read("suppressionWetness", 0, 0, 10),
    ashAge: read("ashAge", 0, 0, 1000),
    houseDestroyed: Boolean(source.houseDestroyed)
  };
};

const sanitizeIgnitionOrigin = (value: unknown): { x: number; y: number } | null => {
  if (!isRecord(value)) {
    return null;
  }
  const x = toFiniteNumber(value.x);
  const y = toFiniteNumber(value.y);
  if (x === null || y === null) {
    return null;
  }
  return {
    x: Math.max(0, Math.floor(x)),
    y: Math.max(0, Math.floor(y))
  };
};

const sanitizeFirefighters = (value: unknown, grid: { cols: number; rows: number }): FireSimLabFirefighter[] => {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const firefighters: FireSimLabFirefighter[] = [];
  source.forEach((entry) => {
    if (!isRecord(entry)) {
      return;
    }
    const rawX = toFiniteNumber(entry.x);
    const rawY = toFiniteNumber(entry.y);
    if (rawX === null || rawY === null) {
      return;
    }
    const x = Math.max(0, Math.min(grid.cols - 1, Math.floor(rawX)));
    const y = Math.max(0, Math.min(grid.rows - 1, Math.floor(rawY)));
    const key = `${x}:${y}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    firefighters.push({ x, y });
  });
  return firefighters;
};

export const sanitizeFireSimLabScenarioSnapshot = (value: unknown): FireSimLabScenarioSnapshot | null => {
  if (!isRecord(value)) {
    return null;
  }
  const grid = sanitizeGrid(value.grid);
  const rawTiles = Array.isArray(value.tiles) ? value.tiles : [];
  if (rawTiles.length !== grid.cols * grid.rows) {
    return null;
  }
  return {
    version: 1,
    sourceScenarioId: normalizeFireSimLabScenarioId(
      typeof value.sourceScenarioId === "string" ? value.sourceScenarioId : null
    ),
    grid,
    environment: sanitizeEnvironment(value.environment),
    profiles: sanitizeProfiles(value.profiles),
    tiles: rawTiles.map(sanitizeTileSnapshot),
    firefighters: sanitizeFirefighters(value.firefighters, grid),
    elapsedDays: Math.max(0, toFiniteNumber(value.elapsedDays) ?? 0),
    ignitionOrigin: sanitizeIgnitionOrigin(value.ignitionOrigin)
  };
};

export const sanitizeFireSimLabSavedScenario = (value: unknown): FireSimLabSavedScenario | null => {
  if (!isRecord(value)) {
    return null;
  }
  const id = sanitizeId(value.id);
  const name = sanitizeName(value.name);
  const snapshot = sanitizeFireSimLabScenarioSnapshot(value.snapshot);
  if (!id || !name || !snapshot) {
    return null;
  }
  return {
    id,
    name,
    createdAt: sanitizeTimestamp(value.createdAt),
    updatedAt: sanitizeTimestamp(value.updatedAt),
    snapshot
  };
};

const sortScenarios = (scenarios: readonly FireSimLabSavedScenario[]): FireSimLabSavedScenario[] =>
  [...scenarios].sort((a, b) => {
    const byName = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    return byName !== 0 ? byName : a.createdAt.localeCompare(b.createdAt);
  });

const saveScenarios = (scenarios: readonly FireSimLabSavedScenario[]): void => {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sortScenarios(scenarios)));
};

export const loadFireSimLabSavedScenarios = (): FireSimLabSavedScenario[] => {
  if (typeof localStorage === "undefined") {
    return [];
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return sortScenarios(
      parsed
        .map((entry) => sanitizeFireSimLabSavedScenario(entry))
        .filter((entry): entry is FireSimLabSavedScenario => entry !== null)
    );
  } catch {
    return [];
  }
};

export const createFireSimLabSavedScenarioId = (): string =>
  `fire-sim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const upsertFireSimLabSavedScenario = (
  scenario: FireSimLabSavedScenario
): FireSimLabSavedScenario[] => {
  const current = loadFireSimLabSavedScenarios();
  const sanitized = sanitizeFireSimLabSavedScenario(scenario);
  if (!sanitized) {
    return current;
  }
  saveScenarios([...current.filter((entry) => entry.id !== sanitized.id), sanitized]);
  return loadFireSimLabSavedScenarios();
};

export const deleteFireSimLabSavedScenario = (scenarioId: string): FireSimLabSavedScenario[] => {
  const current = loadFireSimLabSavedScenarios();
  saveScenarios(current.filter((scenario) => scenario.id !== scenarioId));
  return loadFireSimLabSavedScenarios();
};
