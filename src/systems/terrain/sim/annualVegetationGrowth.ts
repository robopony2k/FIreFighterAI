import type { WorldState } from "../../../core/state.js";
import { syncTileSoAIndex } from "../../../core/state.js";
import type { RNG } from "../../../core/types.js";
import {
  DOMINANT_FOREST_TYPES,
  FOREST_RECRUIT_AGE_YEARS,
  clearVegetationState,
  computeForestTreeWeights,
  getVegetationMaturity01,
  pickWeightedTreeType,
  syncDerivedVegetationState
} from "../../../core/vegetation.js";
import { applyFuel } from "../../../core/tiles.js";
import { clamp } from "../../../core/utils.js";
import { hash2D } from "../../../mapgen/noise.js";
import {
  growAnnualVegetationFuel,
  initializeCampaignVegetationFuel,
  NEW_CAMPAIGN_VEGETATION_FUEL_FRACTION
} from "./annualVegetationFuel.js";
import {
  ASH_ANNUAL_RECOVERY_CHANCE,
  BARE_ANNUAL_RECOVERY_CHANCE,
  FIREBREAK_ANNUAL_RECOVERY_CHANCE,
  GRASS_FOREST_PRESSURE_CHANCE,
  GRASS_SHRUB_BACKGROUND_CHANCE,
  GRASS_SHRUB_PRESSURE_CHANCE,
  getAnnualEstablishmentProbability,
  getAnnualNeighborForestType,
  getAnnualWoodyPressure,
  isProtectedAnnualVegetationType,
  MATURE_ANNUAL_WOODY_THRESHOLD,
  MIN_ANNUAL_TREE_SUITABILITY,
  sampleAnnualVegetation,
  SHRUB_FOREST_BACKGROUND_CHANCE,
  SHRUB_FOREST_PRESSURE_CHANCE
} from "./annualVegetationSuccessionRules.js";
import {
  getRuntimeVegetationSuitabilityCacheDiagnostics,
  getRuntimeVegetationSuitabilitySnapshot,
  type RuntimeVegetationSuitabilityCacheDiagnostics
} from "./runtimeVegetationSuitabilityCache.js";
import { getTerrainResponsiveVegetationStructure } from "./vegetationStructure.js";

const FOREST_ANNUAL_AGE_GAIN = 0.7;
const SCRUB_ANNUAL_AGE_GAIN = 0.8;

export type AnnualVegetationGrowthResult = {
  sequence: number;
  recordedAtMs: number;
  year: number;
  timingsMs: {
    maskBuild: number;
    suitabilityCache: number;
    mutationScan: number;
    revisionFinalize: number;
    total: number;
  };
  cacheSource: RuntimeVegetationSuitabilityCacheDiagnostics["source"];
  terrainTypeRevisionDelta: number;
  vegetationRevisionDelta: number;
  tilesScanned: number;
  agedTiles: number;
  fuelTilesChanged: number;
  shrubExpandedTiles: number;
  forestExpandedTiles: number;
  recoveredTiles: number;
  fuelChanged: boolean;
  terrainTypeChanged: boolean;
  vegetationVisualChanged: boolean;
};

const latestGrowthTelemetry = new WeakMap<WorldState, AnnualVegetationGrowthResult>();

const nowMs = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();

export const getLatestAnnualVegetationGrowthTelemetry = (
  state: WorldState
): AnnualVegetationGrowthResult | null => {
  const result = latestGrowthTelemetry.get(state);
  return result ? { ...result, timingsMs: { ...result.timingsMs } } : null;
};

export const clearAnnualVegetationGrowthTelemetry = (state: WorldState): void => {
  latestGrowthTelemetry.delete(state);
};

const syncVegetationStructure = (state: WorldState, idx: number, siteQuality: number): void => {
  const tile = state.tiles[idx];
  const x = idx % state.grid.cols;
  const y = Math.floor(idx / state.grid.cols);
  syncDerivedVegetationState(tile, state.seed, x, y);
  const structure = getTerrainResponsiveVegetationStructure({
    worldSeed: state.seed,
    type: tile.type,
    ageYears: tile.vegetationAgeYears,
    x,
    y,
    siteQuality
  });
  tile.canopy = structure.canopyCover;
  tile.canopyCover = structure.canopyCover;
  tile.stemDensity = structure.stemDensity;
};

const refreshTileFireProfileWithoutResettingFuel = (state: WorldState, idx: number, rng: RNG): void => {
  const tile = state.tiles[idx];
  const retainedFuel = tile.fuel;
  applyFuel(tile, tile.moisture, rng);
  tile.fuel = retainedFuel;
};

const recoverTile = (
  state: WorldState,
  idx: number,
  type: "grass" | "scrub" | "floodplain",
  siteQuality: number,
  rng: RNG
): void => {
  const tile = state.tiles[idx];
  tile.type = type;
  tile.vegetationAgeYears = 0.2;
  tile.ashAge = 0;
  tile.dominantTreeType = null;
  tile.treeType = null;
  syncVegetationStructure(state, idx, siteQuality);
  applyFuel(tile, tile.moisture, rng);
  tile.fuel *= 0.25;
  syncTileSoAIndex(state, idx);
};

const expandShrub = (state: WorldState, idx: number, siteQuality: number, rng: RNG): void => {
  const tile = state.tiles[idx];
  tile.type = "scrub";
  tile.vegetationAgeYears = 0.35;
  tile.dominantTreeType = null;
  tile.treeType = null;
  refreshTileFireProfileWithoutResettingFuel(state, idx, rng);
  syncVegetationStructure(state, idx, siteQuality);
  syncTileSoAIndex(state, idx);
};

const expandForest = (
  state: WorldState,
  forestMask: Uint8Array,
  idx: number,
  siteQuality: number,
  rng: RNG
): void => {
  const tile = state.tiles[idx];
  const x = idx % state.grid.cols;
  const y = Math.floor(idx / state.grid.cols);
  tile.type = "forest";
  tile.vegetationAgeYears = FOREST_RECRUIT_AGE_YEARS;
  const neighborType = getAnnualNeighborForestType(state, forestMask, x, y);
  const weights = computeForestTreeWeights(tile.moisture, tile.elevation, x, y, state.seed + 9001);
  const treeType = neighborType ?? pickWeightedTreeType(
    hash2D(x, y, state.seed + 9011),
    DOMINANT_FOREST_TYPES,
    weights
  );
  tile.dominantTreeType = treeType;
  tile.treeType = treeType;
  refreshTileFireProfileWithoutResettingFuel(state, idx, rng);
  syncVegetationStructure(state, idx, siteQuality);
  syncTileSoAIndex(state, idx);
};

export const applyAnnualVegetationGrowth = (
  state: WorldState,
  year: number,
  rng: RNG
): AnnualVegetationGrowthResult => {
  const totalStartedAt = nowMs();
  const previousTelemetry = latestGrowthTelemetry.get(state);
  const terrainTypeRevisionBefore = state.terrainTypeRevision;
  const vegetationRevisionBefore = state.vegetationRevision;
  const result: AnnualVegetationGrowthResult = {
    sequence: (previousTelemetry?.sequence ?? 0) + 1,
    recordedAtMs: 0,
    year,
    timingsMs: {
      maskBuild: 0,
      suitabilityCache: 0,
      mutationScan: 0,
      revisionFinalize: 0,
      total: 0
    },
    cacheSource: "none",
    terrainTypeRevisionDelta: 0,
    vegetationRevisionDelta: 0,
    tilesScanned: state.grid.totalTiles,
    agedTiles: 0,
    fuelTilesChanged: 0,
    shrubExpandedTiles: 0,
    forestExpandedTiles: 0,
    recoveredTiles: 0,
    fuelChanged: false,
    terrainTypeChanged: false,
    vegetationVisualChanged: false
  };
  const maskStartedAt = nowMs();
  const forestMask = new Uint8Array(state.grid.totalTiles);
  const matureForestMask = new Uint8Array(state.grid.totalTiles);
  const shrubMask = new Uint8Array(state.grid.totalTiles);
  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    const tile = state.tiles[idx];
    if (tile?.type === "forest") {
      forestMask[idx] = 1;
      matureForestMask[idx] = getVegetationMaturity01("forest", tile.vegetationAgeYears) >= MATURE_ANNUAL_WOODY_THRESHOLD ? 1 : 0;
    } else if (tile?.type === "scrub") {
      shrubMask[idx] = 1;
    }
  }
  result.timingsMs.maskBuild = nowMs() - maskStartedAt;
  const suitabilityStartedAt = nowMs();
  const terrain = getRuntimeVegetationSuitabilitySnapshot(state);
  result.timingsMs.suitabilityCache = nowMs() - suitabilityStartedAt;
  result.cacheSource = getRuntimeVegetationSuitabilityCacheDiagnostics(state).source;

  const mutationStartedAt = nowMs();
  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    const tile = state.tiles[idx];
    if (!tile || tile.fire > 0 || isProtectedAnnualVegetationType(tile.type)) continue;
    const x = idx % state.grid.cols;
    const y = Math.floor(idx / state.grid.cols);
    const suitability = terrain.suitability[idx] ?? 0;
    const siteQuality = terrain.siteQuality[idx] ?? 0;

    if (tile.houseDestroyed) continue;
    const recoverySample = sampleAnnualVegetation(state, x, y, year, 101);
    if (tile.type === "ash") {
      tile.ashAge += 360;
      clearVegetationState(tile);
      if (recoverySample < ASH_ANNUAL_RECOVERY_CHANCE * clamp(0.35 + suitability, 0, 1)) {
        recoverTile(state, idx, "grass", siteQuality, rng);
        state.burnedTiles = Math.max(0, state.burnedTiles - 1);
        result.recoveredTiles += 1;
        result.terrainTypeChanged = true;
        result.vegetationVisualChanged = true;
      }
      continue;
    }
    if (tile.type === "firebreak") {
      clearVegetationState(tile);
      if (recoverySample < FIREBREAK_ANNUAL_RECOVERY_CHANCE * clamp(0.25 + suitability, 0, 1)) {
        recoverTile(state, idx, "grass", siteQuality, rng);
        result.recoveredTiles += 1;
        result.terrainTypeChanged = true;
        result.vegetationVisualChanged = true;
      }
      continue;
    }
    if (tile.type === "bare") {
      clearVegetationState(tile);
      if (suitability >= MIN_ANNUAL_TREE_SUITABILITY && recoverySample < BARE_ANNUAL_RECOVERY_CHANCE * suitability) {
        const type = tile.moisture >= 0.72 && tile.elevation < 0.52
          ? "floodplain"
          : tile.moisture < 0.32 ? "scrub" : "grass";
        recoverTile(state, idx, type, siteQuality, rng);
        result.recoveredTiles += 1;
        result.terrainTypeChanged = true;
        result.vegetationVisualChanged = true;
      }
      continue;
    }

    const preEventType = tile.type;
    const previousAge = tile.vegetationAgeYears;
    const previousCanopy = tile.canopyCover;
    const previousStems = tile.stemDensity;
    if (preEventType === "forest") {
      tile.vegetationAgeYears += FOREST_ANNUAL_AGE_GAIN * (0.75 + 0.5 * clamp(siteQuality, 0, 1));
      syncVegetationStructure(state, idx, siteQuality);
    } else if (preEventType === "scrub") {
      tile.vegetationAgeYears += SCRUB_ANNUAL_AGE_GAIN * (0.75 + 0.5 * clamp(siteQuality, 0, 1));
      syncVegetationStructure(state, idx, siteQuality);
    }
    if (
      tile.vegetationAgeYears > previousAge + 1e-6 ||
      Math.abs(tile.canopyCover - previousCanopy) >= 0.01 ||
      tile.stemDensity !== previousStems
    ) {
      result.agedTiles += 1;
      result.vegetationVisualChanged = true;
      syncTileSoAIndex(state, idx);
    }
    if (growAnnualVegetationFuel(state, idx)) {
      result.fuelTilesChanged += 1;
      result.fuelChanged = true;
    }
    if (suitability < MIN_ANNUAL_TREE_SUITABILITY) continue;

    const pressure = getAnnualWoodyPressure(state, matureForestMask, shrubMask, x, y);
    if (
      preEventType === "scrub" &&
      getVegetationMaturity01("scrub", tile.vegetationAgeYears) >= MATURE_ANNUAL_WOODY_THRESHOLD &&
      sampleAnnualVegetation(state, x, y, year, 419) <
        getAnnualEstablishmentProbability(
          (SHRUB_FOREST_BACKGROUND_CHANCE + SHRUB_FOREST_PRESSURE_CHANCE * pressure.forest) * suitability
        )
    ) {
      expandForest(state, forestMask, idx, siteQuality, rng);
      result.forestExpandedTiles += 1;
      result.terrainTypeChanged = true;
      result.vegetationVisualChanged = true;
      continue;
    }
    if (preEventType === "grass" || preEventType === "floodplain") {
      if (
        pressure.forest > 0 &&
        sampleAnnualVegetation(state, x, y, year, 521) <
          getAnnualEstablishmentProbability(GRASS_FOREST_PRESSURE_CHANCE * pressure.forest * suitability)
      ) {
        expandForest(state, forestMask, idx, siteQuality, rng);
        result.forestExpandedTiles += 1;
        result.terrainTypeChanged = true;
        result.vegetationVisualChanged = true;
      } else if (
        sampleAnnualVegetation(state, x, y, year, 631) <
        getAnnualEstablishmentProbability(
          (GRASS_SHRUB_BACKGROUND_CHANCE + GRASS_SHRUB_PRESSURE_CHANCE * pressure.woody) * suitability
        )
      ) {
        expandShrub(state, idx, siteQuality, rng);
        result.shrubExpandedTiles += 1;
        result.terrainTypeChanged = true;
        result.vegetationVisualChanged = true;
      }
    }
  }
  result.timingsMs.mutationScan = nowMs() - mutationStartedAt;

  const revisionStartedAt = nowMs();
  if (result.terrainTypeChanged) state.terrainTypeRevision += 1;
  if (result.vegetationVisualChanged) {
    state.vegetationRevision += 1;
    state.terrainDirty = true;
  }
  result.timingsMs.revisionFinalize = nowMs() - revisionStartedAt;
  result.terrainTypeRevisionDelta = state.terrainTypeRevision - terrainTypeRevisionBefore;
  result.vegetationRevisionDelta = state.vegetationRevision - vegetationRevisionBefore;
  result.recordedAtMs = nowMs();
  result.timingsMs.total = result.recordedAtMs - totalStartedAt;
  latestGrowthTelemetry.set(state, { ...result, timingsMs: { ...result.timingsMs } });
  return result;
};

export { initializeCampaignVegetationFuel, NEW_CAMPAIGN_VEGETATION_FUEL_FRACTION };
