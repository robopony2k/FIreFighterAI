import { MAP_SIZE_PRESETS, type MapSizeId } from "../core/config.js";
import { DEFAULT_MAP_SIZE, DEFAULT_RUN_SEED } from "../ui/run-config.js";
import { sanitizeTerrainRecipe, type TerrainRecipe } from "../mapgen/terrainProfile.js";

export type MapScenario = {
  id: string;
  name: string;
  seed: number;
  mapSize: MapSizeId;
  terrain: TerrainRecipe;
  createdAt: string;
  updatedAt: string;
};

const MAP_SCENARIOS_KEY = "fireline.mapScenarios.v2";
const LEGACY_MAP_SCENARIOS_KEY = "fireline.mapScenarios";
const MAP_SIZE_IDS = new Set<MapSizeId>(Object.keys(MAP_SIZE_PRESETS) as MapSizeId[]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const sanitizeMapSize = (value: unknown): MapSizeId =>
  typeof value === "string" && MAP_SIZE_IDS.has(value as MapSizeId) ? (value as MapSizeId) : DEFAULT_MAP_SIZE;

const sanitizeSeed = (value: unknown): number => {
  const parsed = toFiniteNumber(value);
  return parsed === null ? DEFAULT_RUN_SEED : Math.floor(parsed);
};

const sanitizeScenarioName = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, 40);
};

const sanitizeTimestamp = (value: unknown): string => {
  if (typeof value !== "string") {
    return new Date().toISOString();
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : new Date().toISOString();
};

export const sanitizeMapScenario = (value: unknown): MapScenario | null => {
  if (!isRecord(value)) {
    return null;
  }
  const id = typeof value.id === "string" && value.id.trim().length > 0 ? value.id.trim() : "";
  const name = sanitizeScenarioName(value.name);
  if (!id || !name) {
    return null;
  }
  return {
    id,
    name,
    seed: sanitizeSeed(value.seed),
    mapSize: sanitizeMapSize(value.mapSize),
    terrain: sanitizeTerrainRecipe(isRecord(value.terrain) ? value.terrain : { mapSize: sanitizeMapSize(value.mapSize) }),
    createdAt: sanitizeTimestamp(value.createdAt),
    updatedAt: sanitizeTimestamp(value.updatedAt)
  };
};

const sortScenarios = (scenarios: readonly MapScenario[]): MapScenario[] =>
  [...scenarios].sort((a, b) => {
    const byName = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    if (byName !== 0) {
      return byName;
    }
    return a.createdAt.localeCompare(b.createdAt);
  });

export const loadMapScenarios = (): MapScenario[] => {
  if (typeof localStorage === "undefined") {
    return [];
  }
  const raw = localStorage.getItem(MAP_SCENARIOS_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return sortScenarios(parsed.map((entry) => sanitizeMapScenario(entry)).filter((entry): entry is MapScenario => entry !== null));
  } catch {
    return [];
  }
};

export const hasLegacyMapScenarios = (): boolean => {
  if (typeof localStorage === "undefined") {
    return false;
  }
  const raw = localStorage.getItem(LEGACY_MAP_SCENARIOS_KEY);
  if (!raw) {
    return false;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return true;
  }
};

const saveMapScenarios = (scenarios: readonly MapScenario[]): void => {
  if (typeof localStorage === "undefined") {
    return;
  }
  const sanitized = sortScenarios(
    scenarios.map((scenario) => sanitizeMapScenario(scenario)).filter((entry): entry is MapScenario => entry !== null)
  );
  localStorage.setItem(MAP_SCENARIOS_KEY, JSON.stringify(sanitized));
};

export const createMapScenarioId = (): string =>
  `scenario-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const upsertMapScenario = (scenario: MapScenario): MapScenario[] => {
  const current = loadMapScenarios();
  const sanitized = sanitizeMapScenario(scenario);
  if (!sanitized) {
    return current;
  }
  const next = current.filter((entry) => entry.id !== sanitized.id);
  next.push(sanitized);
  saveMapScenarios(next);
  return loadMapScenarios();
};

export const deleteMapScenario = (scenarioId: string): MapScenario[] => {
  const current = loadMapScenarios();
  const next = current.filter((scenario) => scenario.id !== scenarioId);
  saveMapScenarios(next);
  return loadMapScenarios();
};
