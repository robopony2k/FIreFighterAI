import { CHARACTERS, type CharacterId } from "../core/characters.js";
import { MAP_SIZE_PRESETS, type MapSizeId } from "../core/config.js";
import type { FireSettings } from "../core/types.js";
import { sanitizeFuelProfileOverrides } from "./fuelProfiles.js";
import { DEFAULT_MAP_SIZE, DEFAULT_RUN_OPTIONS, DEFAULT_RUN_SEED, normalizeFireSettings } from "../ui/run-config.js";
import type { NewRunConfig } from "../ui/run-config.js";
import { resolveTerrainProfile, sanitizeTerrainRecipe } from "../mapgen/terrainProfile.js";

const LAST_RUN_CONFIG_KEY = "fireline.lastRunConfig";
const CHARACTER_IDS = new Set<CharacterId>(CHARACTERS.map((character) => character.id));
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

const sanitizeSeed = (value: unknown): number => {
  const parsed = toFiniteNumber(value);
  return parsed === null ? DEFAULT_RUN_SEED : Math.floor(parsed);
};

const sanitizeMapSize = (value: unknown): MapSizeId =>
  typeof value === "string" && MAP_SIZE_IDS.has(value as MapSizeId) ? (value as MapSizeId) : DEFAULT_MAP_SIZE;

const sanitizeCharacterId = (value: unknown): CharacterId =>
  typeof value === "string" && CHARACTER_IDS.has(value as CharacterId)
    ? (value as CharacterId)
    : CHARACTERS[0].id;

const sanitizeCallsign = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, 24);
};

const sanitizeFireSettings = (value: unknown): FireSettings =>
  normalizeFireSettings(isRecord(value) ? (value as Partial<FireSettings>) : undefined);

const sanitizeNewRunConfig = (value: unknown): NewRunConfig | null => {
  if (!isRecord(value)) {
    return null;
  }
  const options = isRecord(value.options) ? value.options : {};
  return {
    seed: sanitizeSeed(value.seed),
    mapSize: sanitizeMapSize(value.mapSize),
    characterId: sanitizeCharacterId(value.characterId),
    callsign: sanitizeCallsign(value.callsign),
    options: {
      ...DEFAULT_RUN_OPTIONS,
      unlimitedMoney: typeof options.unlimitedMoney === "boolean" ? options.unlimitedMoney : DEFAULT_RUN_OPTIONS.unlimitedMoney,
      terrain: isRecord(options.terrain)
        ? sanitizeTerrainRecipe(options.terrain)
        : resolveTerrainProfile(isRecord(options.mapGen) ? options.mapGen : undefined, sanitizeMapSize(value.mapSize ?? DEFAULT_MAP_SIZE)).recipe,
      fire: sanitizeFireSettings(options.fire),
      fuelProfiles: sanitizeFuelProfileOverrides(options.fuelProfiles)
    }
  };
};

export function loadLastRunConfig(): NewRunConfig | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  const raw = localStorage.getItem(LAST_RUN_CONFIG_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return sanitizeNewRunConfig(parsed);
  } catch {
    return null;
  }
}

export function saveLastRunConfig(config: NewRunConfig): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  const sanitized = sanitizeNewRunConfig(config);
  if (!sanitized) {
    return;
  }
  localStorage.setItem(LAST_RUN_CONFIG_KEY, JSON.stringify(sanitized));
}
