import type { MapSizeId } from "../core/config.js";
import {
  cloneTerrainRecipe,
  createDefaultTerrainRecipe,
  type TerrainArchetypeId,
  type TerrainRecipe
} from "../mapgen/terrainProfile.js";
import { TERRAIN_RUN_GROUPS, type TerrainControlField } from "./terrain-schema.js";

const UINT32_RANGE = 0x1_0000_0000;

const sampleUnit = (random: () => number): number => {
  const sample = random();
  if (!Number.isFinite(sample)) {
    return 0;
  }
  return Math.max(0, Math.min(1 - Number.EPSILON, sample));
};

const pickIndex = (count: number, random: () => number): number =>
  Math.floor(sampleUnit(random) * Math.max(1, count));

const decimalPlaces = (value: number): number => {
  const text = `${value}`;
  const separator = text.indexOf(".");
  return separator < 0 ? 0 : text.length - separator - 1;
};

const randomSliderValue = (
  field: Extract<TerrainControlField, { type: "slider" }>,
  random: () => number
): number => {
  const stepCount = Math.max(0, Math.round((field.max - field.min) / field.step));
  const stepIndex = pickIndex(stepCount + 1, random);
  return Number((field.min + stepIndex * field.step).toFixed(decimalPlaces(field.step)));
};

export const createRandomTerrainSeed = (
  random: () => number = Math.random
): number => Math.floor(sampleUnit(random) * UINT32_RANGE);

export const createRandomTerrainRecipe = (
  mapSize: MapSizeId,
  random: () => number = Math.random
): TerrainRecipe => {
  const fields = TERRAIN_RUN_GROUPS.flatMap((group) => group.fields);
  const archetypeField = fields.find(
    (field): field is Extract<TerrainControlField, { type: "select" }> =>
      field.type === "select" && field.key === "archetype"
  );
  const archetypeOptions = archetypeField?.options ?? [];
  const archetype = (archetypeOptions[pickIndex(archetypeOptions.length, random)]?.value
    ?? "MASSIF") as TerrainArchetypeId;
  const terrain = createDefaultTerrainRecipe(mapSize, archetype);
  const advanced = { ...(terrain.advancedOverrides ?? {}) };

  fields.forEach((field) => {
    if (field.type === "select") {
      return;
    }
    if (field.type === "checkbox") {
      (advanced as Record<string, unknown>)[field.key] = sampleUnit(random) >= 0.5;
      return;
    }
    const value = randomSliderValue(field, random);
    if (field.scope === "recipe") {
      (terrain as unknown as Record<string, unknown>)[field.key] = value;
    } else {
      (advanced as Record<string, unknown>)[field.key] = value;
    }
  });

  terrain.advancedOverrides = advanced;
  return cloneTerrainRecipe({
    ...terrain,
    mapSize
  });
};
