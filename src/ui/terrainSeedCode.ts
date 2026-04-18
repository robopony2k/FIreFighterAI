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

const SHARE_CODE_PREFIX_V1 = "MAP1";
const SHARE_CODE_PREFIX_V2 = "MAP2";
const SHARE_CODE_PREFIX_V3 = "MAP3";
const SHARE_CODE_PREFIX_V4 = "MAP4";
const SHARE_CODE_PREFIX = SHARE_CODE_PREFIX_V4;
const MAP_SIZE_ORDER: readonly MapSizeId[] = ["medium", "massive", "colossal", "gigantic", "titanic"];
const ARCHETYPE_ORDER: readonly TerrainArchetypeId[] = ["MASSIF", "LONG_SPINE", "TWIN_BAY", "SHELF"];
const LEGACY_TOWN_LAYOUT_ORDER = ["auto", "coastal_ring", "bridge_chain", "inland_valley", "hub_spokes"] as const;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const encodePercent = (value: number): string =>
  Math.round(clamp01(value) * 100).toString(36).toUpperCase().padStart(2, "0");

const decodePercent = (token: string): number | null => {
  if (token.length !== 2) {
    return null;
  }
  const parsed = Number.parseInt(token, 36);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
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
    encodePercent(terrain.waterLevel),
    encodePercent(terrain.riverIntensity),
    encodePercent(terrain.vegetationDensity),
    encodePercent(terrain.townDensity),
    encodePercent(terrain.bridgeAllowance),
    encodePercent(advanced.interiorRise ?? 0),
    encodePercent(advanced.maxHeight ?? 0),
    encodePercent(advanced.embayment ?? 0),
    encodePercent(advanced.anisotropy ?? 0),
    encodePercent(advanced.asymmetry ?? 0),
    encodePercent(advanced.ridgeAlignment ?? 0),
    encodePercent(advanced.uplandDistribution ?? 0),
    encodePercent(advanced.islandCompactness ?? 0),
    encodePercent(advanced.ridgeFrequency ?? 0),
    encodePercent(advanced.basinStrength ?? 0),
    encodePercent(advanced.coastalShelfWidth ?? 0),
    encodePercent(advanced.riverBudget ?? 0),
    encodePercent(advanced.settlementSpacing ?? 0),
    encodeSmallInt(advanced.settlementPreGrowthYears ?? 20),
    encodePercent(advanced.roadStrictness ?? 0),
    encodePercent(advanced.forestPatchiness ?? 0)
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
  if (
    prefix !== SHARE_CODE_PREFIX_V1 &&
    prefix !== SHARE_CODE_PREFIX_V2 &&
    prefix !== SHARE_CODE_PREFIX_V3 &&
    prefix !== SHARE_CODE_PREFIX_V4
  ) {
    return null;
  }
  if (parts.length < 3 || parts.length > 4) {
    return null;
  }
  const seed = Number.parseInt(parts[1] ?? "", 36);
  const body = parts[2] ?? "";
  const nameToken = parts[3] ?? "";
  const hasNameToken =
    prefix === SHARE_CODE_PREFIX_V2 || prefix === SHARE_CODE_PREFIX_V3 || prefix === SHARE_CODE_PREFIX_V4;
  const name = hasNameToken ? decodeNameToken(nameToken, coerceNonNegativeSeed(seed)) : undefined;
  const expectedBodyLength = prefix === SHARE_CODE_PREFIX_V4 ? 52 : prefix === SHARE_CODE_PREFIX_V3 ? 50 : 40;
  if (!Number.isFinite(seed) || seed < 0 || body.length !== expectedBodyLength) {
    return null;
  }
  if (hasNameToken && nameToken.length > 0 && name === undefined) {
    return null;
  }
  const mapSize = readDiscreteValue(MAP_SIZE_ORDER, body.slice(0, 1));
  const archetype = readDiscreteValue(ARCHETYPE_ORDER, body.slice(1, 2));
  const townLayout = readDiscreteValue(LEGACY_TOWN_LAYOUT_ORDER, body.slice(2, 3));
  const skipCarving = body.slice(3, 4) === "1";
  if (!mapSize || !archetype || !townLayout) {
    return null;
  }
  const values: number[] = [];
  const bodyValueLimit = prefix === SHARE_CODE_PREFIX_V4 ? 46 : body.length;
  for (let index = 4; index < bodyValueLimit; index += 2) {
    const decoded = decodePercent(body.slice(index, index + 2));
    if (decoded === null) {
      return null;
    }
    values.push(decoded);
  }
  const decodedPreGrowthYears =
    prefix === SHARE_CODE_PREFIX_V4 ? decodeSmallInt(body.slice(46, 48)) : 20;
  if (prefix === SHARE_CODE_PREFIX_V4 && decodedPreGrowthYears === null) {
    return null;
  }
  const preGrowthYears = decodedPreGrowthYears ?? 20;
  if (
    (prefix === SHARE_CODE_PREFIX_V4 && values.length !== 21) ||
    (prefix === SHARE_CODE_PREFIX_V3 && values.length !== 23) ||
    (prefix !== SHARE_CODE_PREFIX_V3 && prefix !== SHARE_CODE_PREFIX_V4 && values.length !== 18)
  ) {
    return null;
  }
  const advancedOverrides =
    prefix === SHARE_CODE_PREFIX_V4
      ? (() => {
          const roadStrictness = decodePercent(body.slice(48, 50));
          const forestPatchiness = decodePercent(body.slice(50, 52));
          if (roadStrictness === null || forestPatchiness === null) {
            return null;
          }
          return {
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
          skipCarving,
          riverBudget: values[19],
          settlementSpacing: values[20],
          settlementPreGrowthYears: preGrowthYears,
          roadStrictness,
          forestPatchiness
        };
        })()
      : prefix === SHARE_CODE_PREFIX_V3
      ? {
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
          skipCarving,
          riverBudget: values[19],
          settlementSpacing: values[20],
          settlementPreGrowthYears: 20,
          roadStrictness: values[21],
          forestPatchiness: values[22]
        }
      : {
          interiorRise: values[8],
          maxHeight: values[9],
          islandCompactness: values[10],
          ridgeFrequency: values[11],
          basinStrength: values[12],
          coastalShelfWidth: values[13],
          skipCarving,
          riverBudget: values[14],
          settlementSpacing: values[15],
          settlementPreGrowthYears: 20,
          roadStrictness: values[16],
          forestPatchiness: values[17]
        };
  if (!advancedOverrides) {
    return null;
  }
  const terrain = cloneTerrainRecipe({
    archetype,
    mapSize,
    relief: values[0],
    ruggedness: values[1],
    coastComplexity: values[2],
    waterLevel: values[3],
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
