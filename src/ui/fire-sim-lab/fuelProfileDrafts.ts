import { FUEL_PROFILES } from "../../core/config.js";
import type { FuelProfile, TileType } from "../../core/types.js";

export type FireSimLabFuelProfileDrafts = Partial<Record<TileType, FuelProfile>>;

const STORAGE_KEY = "fireline.fireSimLabFuelProfileDrafts.v2";
const TILE_TYPES = Object.keys(FUEL_PROFILES) as TileType[];
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

const sanitizeProfileField = (key: keyof FuelProfile, value: number): number =>
  key === "windFactor" ? Math.max(0, Math.min(1, value)) : Math.max(0, value);

const sanitizeFuelProfile = (type: TileType, value: unknown): FuelProfile | null => {
  if (!isRecord(value)) {
    return null;
  }
  const fallback = FUEL_PROFILES[type];
  return PROFILE_FIELDS.reduce(
    (profile, key) => {
      const parsed = toFiniteNumber(value[key]);
      profile[key] = parsed === null ? fallback[key] : sanitizeProfileField(key, parsed);
      return profile;
    },
    {} as FuelProfile
  );
};

export const sanitizeFireSimLabFuelProfileDrafts = (value: unknown): FireSimLabFuelProfileDrafts => {
  const source = isRecord(value) ? value : {};
  return TILE_TYPES.reduce(
    (drafts, type) => {
      const profile = sanitizeFuelProfile(type, source[type]);
      if (profile) {
        drafts[type] = profile;
      }
      return drafts;
    },
    {} as FireSimLabFuelProfileDrafts
  );
};

export const loadFireSimLabFuelProfileDrafts = (): FireSimLabFuelProfileDrafts => {
  if (typeof localStorage === "undefined") {
    return {};
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {};
  }
  try {
    return sanitizeFireSimLabFuelProfileDrafts(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
};

const saveFireSimLabFuelProfileDrafts = (drafts: FireSimLabFuelProfileDrafts): void => {
  if (typeof localStorage === "undefined") {
    return;
  }
  const sanitized = sanitizeFireSimLabFuelProfileDrafts(drafts);
  if (Object.keys(sanitized).length === 0) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
};

export const saveFireSimLabFuelProfileDraft = (type: TileType, profile: FuelProfile): void => {
  saveFireSimLabFuelProfileDrafts({
    ...loadFireSimLabFuelProfileDrafts(),
    [type]: profile
  });
};

export const clearFireSimLabFuelProfileDraft = (type: TileType): void => {
  const drafts = loadFireSimLabFuelProfileDrafts();
  delete drafts[type];
  saveFireSimLabFuelProfileDrafts(drafts);
};

export const clearAllFireSimLabFuelProfileDrafts = (): void => {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.removeItem(STORAGE_KEY);
};
