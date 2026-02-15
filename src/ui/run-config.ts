import type { CharacterId } from "../core/characters.js";
import type { MapSizeId } from "../core/config.js";
import { DEFAULT_FIRE_SETTINGS } from "../core/config.js";
import type { FireSettings, FuelProfile, TileType } from "../core/types.js";
import type { MapGenSettings } from "../mapgen/settings.js";
import { DEFAULT_MAP_GEN_SETTINGS } from "../mapgen/settings.js";

export type FuelProfileOverrides = Partial<Record<TileType, Partial<FuelProfile>>>;

export type RunOptions = {
  unlimitedMoney: boolean;
  mapGen: MapGenSettings;
  fire: FireSettings;
  fuelProfiles: FuelProfileOverrides;
};

export type NewRunConfig = {
  seed: number;
  mapSize: MapSizeId;
  characterId: CharacterId;
  callsign: string;
  options: RunOptions;
};

export const DEFAULT_RUN_SEED = 1337;
export const DEFAULT_MAP_SIZE: MapSizeId = "medium";
export const DEFAULT_RUN_OPTIONS: RunOptions = {
  unlimitedMoney: false,
  mapGen: { ...DEFAULT_MAP_GEN_SETTINGS },
  fire: { ...DEFAULT_FIRE_SETTINGS },
  fuelProfiles: {}
};

const toNumber = (value: unknown, fallback: number): number => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(parsed) ? Number(parsed) : fallback;
};

export const normalizeFireSettings = (settings?: Partial<FireSettings>): FireSettings => {
  const source = settings ?? {};
  return {
    ignitionChancePerDay: toNumber(source.ignitionChancePerDay, DEFAULT_FIRE_SETTINGS.ignitionChancePerDay),
    simSpeed: toNumber(source.simSpeed, DEFAULT_FIRE_SETTINGS.simSpeed),
    simTickSeconds: toNumber(source.simTickSeconds, DEFAULT_FIRE_SETTINGS.simTickSeconds),
    renderSmoothSeconds: toNumber(source.renderSmoothSeconds, DEFAULT_FIRE_SETTINGS.renderSmoothSeconds),
    seasonTaperDays: Math.max(0, Math.round(toNumber(source.seasonTaperDays, DEFAULT_FIRE_SETTINGS.seasonTaperDays))),
    seasonMinIntensity: toNumber(source.seasonMinIntensity, DEFAULT_FIRE_SETTINGS.seasonMinIntensity),
    dayFactorMin: toNumber(source.dayFactorMin, DEFAULT_FIRE_SETTINGS.dayFactorMin),
    dayFactorMax: toNumber(source.dayFactorMax, DEFAULT_FIRE_SETTINGS.dayFactorMax),
    diffusionCardinal: toNumber(source.diffusionCardinal, DEFAULT_FIRE_SETTINGS.diffusionCardinal),
    diffusionDiagonal: toNumber(source.diffusionDiagonal, DEFAULT_FIRE_SETTINGS.diffusionDiagonal),
    diffusionSecondary: toNumber(source.diffusionSecondary, DEFAULT_FIRE_SETTINGS.diffusionSecondary),
    diffusionMoisture: toNumber(source.diffusionMoisture, DEFAULT_FIRE_SETTINGS.diffusionMoisture),
    heatCap: toNumber(source.heatCap, DEFAULT_FIRE_SETTINGS.heatCap),
    conflagrationHeatBoost: toNumber(source.conflagrationHeatBoost, DEFAULT_FIRE_SETTINGS.conflagrationHeatBoost),
    conflagrationFuelBoost: toNumber(source.conflagrationFuelBoost, DEFAULT_FIRE_SETTINGS.conflagrationFuelBoost),
    boundsPadding: Math.max(0, Math.round(toNumber(source.boundsPadding, DEFAULT_FIRE_SETTINGS.boundsPadding)))
  };
};
