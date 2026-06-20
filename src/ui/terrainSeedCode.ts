import type { MapSizeId } from "../core/config.js";
import { RNG } from "../core/rng.js";
import {
  cloneTerrainRecipe,
  type TerrainArchetypeId,
  type TerrainRecipe
} from "../mapgen/terrainProfile.js";

export type TerrainSeedPayload = {
  seed: number;
  mapSize: MapSizeId;
  terrain: TerrainRecipe;
  name?: string;
};

const SHARE_CODE_PREFIX = "MAP6";
const MAP_SIZE_ORDER: readonly MapSizeId[] = ["medium", "massive", "colossal", "gigantic", "titanic"];
const ARCHETYPE_ORDER: readonly TerrainArchetypeId[] = ["MASSIF", "LONG_SPINE", "TWIN_BAY", "SHELF", "NONE"];

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const encodePercent = (value: number, max = 1): string =>
  Math.round(Math.max(0, Math.min(max, value)) * 100).toString(36).toUpperCase().padStart(2, "0");

const decodePercent = (token: string, max = 1): number | null => {
  if (token.length !== 2) {
    return null;
  }
  const parsed = Number.parseInt(token, 36);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > Math.round(max * 100)) {
    return null;
  }
  return parsed / 100;
};

const encodeSmallInt = (value: number): string =>
  Math.max(0, Math.min(63, Math.round(value))).toString(36).toUpperCase().padStart(2, "0");

const decodeSmallInt = (token: string): number | null => {
  if (token.length !== 2) {
    return null;
  }
  const parsed = Number.parseInt(token, 36);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 63) {
    return null;
  }
  return parsed;
};

const coerceNonNegativeSeed = (seed: number): number =>
  Number.isFinite(seed) ? Math.max(0, Math.floor(seed)) : 0;

const normalizeScenarioName = (value: string | undefined): string => value?.trim().slice(0, 40) ?? "";

const readDiscreteValue = <T>(values: readonly T[], token: string): T | null => {
  const index = Number.parseInt(token, 36);
  if (!Number.isFinite(index) || index < 0 || index >= values.length) {
    return null;
  }
  return values[index] ?? null;
};

const maskNameBytes = (bytes: Uint8Array, seed: number): Uint8Array => {
  const masked = new Uint8Array(bytes.length);
  const rng = new RNG((seed ^ 0x9e3779b9) >>> 0);
  for (let index = 0; index < bytes.length; index += 1) {
    masked[index] = bytes[index] ^ Math.floor(rng.next() * 256);
  }
  return masked;
};

const encodeNameToken = (name: string, seed: number): string => {
  const normalized = normalizeScenarioName(name);
  if (normalized.length === 0) {
    return "";
  }
  const bytes = new TextEncoder().encode(normalized);
  const masked = maskNameBytes(bytes, seed);
  let token = "";
  for (let index = 0; index < masked.length; index += 1) {
    token += masked[index]!.toString(16).toUpperCase().padStart(2, "0");
  }
  return token;
};

const decodeNameToken = (token: string, seed: number): string | undefined => {
  if (token.length === 0) {
    return undefined;
  }
  if (token.length % 2 !== 0) {
    return undefined;
  }
  const bytes = new Uint8Array(token.length / 2);
  for (let index = 0; index < token.length; index += 2) {
    const parsed = Number.parseInt(token.slice(index, index + 2), 16);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 255) {
      return undefined;
    }
    bytes[index / 2] = parsed;
  }
  try {
    return normalizeScenarioName(new TextDecoder().decode(maskNameBytes(bytes, seed))) || undefined;
  } catch {
    return undefined;
  }
};

export const coerceTerrainSeedNumber = (value: string, fallback: number): number => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return fallback;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
};

export const encodeTerrainSeedCode = (payload: TerrainSeedPayload): string => {
  const seed = coerceNonNegativeSeed(payload.seed);
  const mapSize = MAP_SIZE_ORDER.includes(payload.mapSize) ? payload.mapSize : "colossal";
  const terrain = cloneTerrainRecipe({
    ...payload.terrain,
    mapSize
  });
  const advanced = terrain.advancedOverrides ?? {};
  const body = [
    MAP_SIZE_ORDER.indexOf(mapSize).toString(36).toUpperCase(),
    ARCHETYPE_ORDER.indexOf(terrain.archetype).toString(36).toUpperCase(),
    "0",
    advanced.skipCarving ? "1" : "0",
    encodePercent(terrain.relief),
    encodePercent(terrain.ruggedness),
    encodePercent(terrain.coastComplexity),
    encodePercent(terrain.landCoverageTarget),
    encodePercent(terrain.riverIntensity),
    encodePercent(terrain.vegetationDensity),
    encodePercent(terrain.townDensity),
    encodePercent(terrain.bridgeAllowance),
    encodePercent(advanced.interiorRise ?? 0),
    encodePercent(advanced.maxHeight ?? 0, 1.5),
    encodePercent(advanced.embayment ?? 0),
    encodePercent(advanced.anisotropy ?? 0),
    encodePercent(advanced.asymmetry ?? 0),
    encodePercent(advanced.ridgeAlignment ?? 0),
    encodePercent(advanced.uplandDistribution ?? 0),
    encodePercent(advanced.islandCompactness ?? 0),
    encodePercent(advanced.ridgeFrequency ?? 0),
    encodePercent(advanced.basinStrength ?? 0),
    encodePercent(advanced.coastalShelfWidth ?? 0),
    encodePercent(advanced.seaLevelBias ?? 0.5),
    encodePercent(advanced.riverBudget ?? 0),
    encodePercent(advanced.settlementSpacing ?? 0),
    encodeSmallInt(advanced.vegetationPreGrowthYears ?? 20),
    encodePercent(advanced.roadStrictness ?? 0),
    encodePercent(advanced.roadMaxGrade ?? 0.38),
    encodePercent(advanced.forestPatchiness ?? 0),
    encodePercent(advanced.noiseFrequency ?? 0.5)
  ].join("");
  const nameToken = encodeNameToken(payload.name ?? "", seed);
  return nameToken.length > 0
    ? `${SHARE_CODE_PREFIX}-${seed.toString(36).toUpperCase()}-${body}-${nameToken}`
    : `${SHARE_CODE_PREFIX}-${seed.toString(36).toUpperCase()}-${body}`;
};

export const decodeTerrainSeedCode = (value: string): TerrainSeedPayload | null => {
  const trimmed = value.trim();
  const parts = trimmed.split("-");
  const prefix = (parts[0] ?? "").toUpperCase();
  if (prefix !== SHARE_CODE_PREFIX) {
    return null;
  }
  if (parts.length < 3 || parts.length > 4) {
    return null;
  }
  const seed = Number.parseInt(parts[1] ?? "", 36);
  const body = parts[2] ?? "";
  const nameToken = parts[3] ?? "";
  const name = decodeNameToken(nameToken, coerceNonNegativeSeed(seed));
  if (!Number.isFinite(seed) || seed < 0 || (body.length !== 56 && body.length !== 58)) {
    return null;
  }
  if (nameToken.length > 0 && name === undefined) {
    return null;
  }
  const mapSize = readDiscreteValue(MAP_SIZE_ORDER, body.slice(0, 1));
  const archetype = readDiscreteValue(ARCHETYPE_ORDER, body.slice(1, 2));
  const versionSlot = body.slice(2, 3);
  const skipCarving = body.slice(3, 4) === "1";
  if (!mapSize || !archetype || versionSlot !== "0") {
    return null;
  }
  const values: number[] = [];
  for (let index = 4; index < 48; index += 2) {
    const valueIndex = (index - 4) / 2;
    const decoded = decodePercent(body.slice(index, index + 2), valueIndex === 9 ? 1.5 : 1);
    if (decoded === null) {
      return null;
    }
    values.push(decoded);
  }
  const decodedPreGrowthYears = decodeSmallInt(body.slice(48, 50));
  if (decodedPreGrowthYears === null || values.length !== 22) {
    return null;
  }
  const hasRoadMaxGrade = body.length >= 58;
  const roadStrictness = decodePercent(body.slice(50, 52));
  const roadMaxGrade = hasRoadMaxGrade ? decodePercent(body.slice(52, 54)) : 0.38;
  const forestPatchiness = decodePercent(body.slice(hasRoadMaxGrade ? 54 : 52, hasRoadMaxGrade ? 56 : 54));
  const noiseFrequency = decodePercent(body.slice(hasRoadMaxGrade ? 56 : 54, hasRoadMaxGrade ? 58 : 56));
  if (roadStrictness === null || roadMaxGrade === null || forestPatchiness === null || noiseFrequency === null) {
    return null;
  }
  const advancedOverrides = {
    interiorRise: values[8],
    maxHeight: values[9],
    embayment: values[10],
    anisotropy: values[11],
    asymmetry: values[12],
    ridgeAlignment: values[13],
    uplandDistribution: values[14],
    islandCompactness: values[15],
    ridgeFrequency: values[16],
    basinStrength: values[17],
    coastalShelfWidth: values[18],
    seaLevelBias: values[19],
    skipCarving,
    riverBudget: values[20],
    settlementSpacing: values[21],
    vegetationPreGrowthYears: decodedPreGrowthYears,
    roadStrictness,
    roadMaxGrade,
    forestPatchiness,
    noiseFrequency
  };
  const terrain = cloneTerrainRecipe({
    archetype,
    mapSize,
    relief: values[0],
    ruggedness: values[1],
    coastComplexity: values[2],
    landCoverageTarget: values[3],
    waterLevel: undefined,
    riverIntensity: values[4],
    vegetationDensity: values[5],
    townDensity: values[6],
    bridgeAllowance: values[7],
    advancedOverrides
  });
  return {
    seed: coerceNonNegativeSeed(seed),
    mapSize,
    terrain,
    name
  };
};
