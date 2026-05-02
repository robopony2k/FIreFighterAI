import type { CharacterId } from "../core/characters.js";
import type { MapSizeId } from "../core/config.js";
import { DEFAULT_FIRE_SETTINGS } from "../core/config.js";
import type { FireSettings, FuelProfile, TileType } from "../core/types.js";
import type { TerrainRecipe } from "../mapgen/terrainProfile.js";
import { createDefaultTerrainRecipe } from "../mapgen/terrainProfile.js";

export type FuelProfileOverrides = Partial<Record<TileType, Partial<FuelProfile>>>;

export type RunOptions = {
  unlimitedMoney: boolean;
  terrain: TerrainRecipe;
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
export const DEFAULT_MAP_SIZE: MapSizeId = "colossal";
export const DEFAULT_RUN_OPTIONS: RunOptions = {
  unlimitedMoney: false,
  terrain: createDefaultTerrainRecipe(DEFAULT_MAP_SIZE),
  fire: { ...DEFAULT_FIRE_SETTINGS },
  fuelProfiles: {}
};

const toNumber = (value: unknown, fallback: number): number => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(parsed) ? Number(parsed) : fallback;
};

export const normalizeFireSettings = (settings?: Partial<FireSettings>): FireSettings => {
  const source = settings ?? {};
  const legacySource = source as Partial<FireSettings> & {
    dayFactorMin?: unknown;
    dayFactorMax?: unknown;
  };
  void legacySource.dayFactorMin;
  void legacySource.dayFactorMax;
  return {
    ignitionChancePerDay: toNumber(source.ignitionChancePerDay, DEFAULT_FIRE_SETTINGS.ignitionChancePerDay),
    simSpeed: toNumber(source.simSpeed, DEFAULT_FIRE_SETTINGS.simSpeed),
    simTickSeconds: toNumber(source.simTickSeconds, DEFAULT_FIRE_SETTINGS.simTickSeconds),
    renderSmoothSeconds: toNumber(source.renderSmoothSeconds, DEFAULT_FIRE_SETTINGS.renderSmoothSeconds),
    seasonTaperDays: Math.max(0, Math.round(toNumber(source.seasonTaperDays, DEFAULT_FIRE_SETTINGS.seasonTaperDays))),
    seasonMinIntensity: toNumber(source.seasonMinIntensity, DEFAULT_FIRE_SETTINGS.seasonMinIntensity),
    diffusionCardinal: toNumber(source.diffusionCardinal, DEFAULT_FIRE_SETTINGS.diffusionCardinal),
    diffusionDiagonal: toNumber(source.diffusionDiagonal, DEFAULT_FIRE_SETTINGS.diffusionDiagonal),
    diffusionSecondary: toNumber(source.diffusionSecondary, DEFAULT_FIRE_SETTINGS.diffusionSecondary),
    rangedDiffusionMaxTiles: Math.max(
      1,
      Math.round(toNumber(source.rangedDiffusionMaxTiles, DEFAULT_FIRE_SETTINGS.rangedDiffusionMaxTiles))
    ),
    rangedDiffusionWindThreshold: toNumber(
      source.rangedDiffusionWindThreshold,
      DEFAULT_FIRE_SETTINGS.rangedDiffusionWindThreshold
    ),
    rangedDiffusionAlignmentThreshold: toNumber(
      source.rangedDiffusionAlignmentThreshold,
      DEFAULT_FIRE_SETTINGS.rangedDiffusionAlignmentThreshold
    ),
    rangedDiffusionHeatThreshold: toNumber(
      source.rangedDiffusionHeatThreshold,
      DEFAULT_FIRE_SETTINGS.rangedDiffusionHeatThreshold
    ),
    rangedDiffusionWeatherThreshold: toNumber(
      source.rangedDiffusionWeatherThreshold,
      DEFAULT_FIRE_SETTINGS.rangedDiffusionWeatherThreshold
    ),
    rangedDiffusionTwoTileThreshold: toNumber(
      source.rangedDiffusionTwoTileThreshold,
      DEFAULT_FIRE_SETTINGS.rangedDiffusionTwoTileThreshold
    ),
    rangedDiffusionThreeTileThreshold: toNumber(
      source.rangedDiffusionThreeTileThreshold,
      DEFAULT_FIRE_SETTINGS.rangedDiffusionThreeTileThreshold
    ),
    rangedDiffusionDistanceFalloff: toNumber(
      source.rangedDiffusionDistanceFalloff,
      DEFAULT_FIRE_SETTINGS.rangedDiffusionDistanceFalloff
    ),
    rangedDiffusionObstructionStrength: toNumber(
      source.rangedDiffusionObstructionStrength,
      DEFAULT_FIRE_SETTINGS.rangedDiffusionObstructionStrength
    ),
    diffusionMoisture: toNumber(source.diffusionMoisture, DEFAULT_FIRE_SETTINGS.diffusionMoisture),
    heatCap: toNumber(source.heatCap, DEFAULT_FIRE_SETTINGS.heatCap),
    conflagrationHeatBoost: toNumber(source.conflagrationHeatBoost, DEFAULT_FIRE_SETTINGS.conflagrationHeatBoost),
    conflagrationFuelBoost: toNumber(source.conflagrationFuelBoost, DEFAULT_FIRE_SETTINGS.conflagrationFuelBoost),
    boundsPadding: Math.max(0, Math.round(toNumber(source.boundsPadding, DEFAULT_FIRE_SETTINGS.boundsPadding))),
    elevationSpreadGain: toNumber(source.elevationSpreadGain, DEFAULT_FIRE_SETTINGS.elevationSpreadGain),
    elevationSpreadMaxBoost: toNumber(source.elevationSpreadMaxBoost, DEFAULT_FIRE_SETTINGS.elevationSpreadMaxBoost),
    elevationSpreadMaxPenalty: toNumber(source.elevationSpreadMaxPenalty, DEFAULT_FIRE_SETTINGS.elevationSpreadMaxPenalty),
    elevationSpreadDeadZone: toNumber(source.elevationSpreadDeadZone, DEFAULT_FIRE_SETTINGS.elevationSpreadDeadZone),
    terrainWindSteerStrength: toNumber(source.terrainWindSteerStrength, DEFAULT_FIRE_SETTINGS.terrainWindSteerStrength),
    terrainWindSpeedMin: toNumber(source.terrainWindSpeedMin, DEFAULT_FIRE_SETTINGS.terrainWindSpeedMin),
    terrainWindSpeedMax: toNumber(source.terrainWindSpeedMax, DEFAULT_FIRE_SETTINGS.terrainWindSpeedMax),
    terrainWindObstructionPenalty: toNumber(
      source.terrainWindObstructionPenalty,
      DEFAULT_FIRE_SETTINGS.terrainWindObstructionPenalty
    ),
    terrainWindFunnelBonus: toNumber(source.terrainWindFunnelBonus, DEFAULT_FIRE_SETTINGS.terrainWindFunnelBonus)
  };
};
