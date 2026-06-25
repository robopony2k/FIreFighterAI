import { TILE_TYPE_IDS } from "../../../core/state.js";

export type ThreeTestTerrainRevisionState = {
  terrainTypeRevision: number;
  vegetationRevision: number;
  structureRevision: number;
  debugTypeColors: boolean;
};

export type TerrainDirtyTileBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type TerrainTypeDiff = {
  terrainTypesChanged: boolean;
  geometryTerrainChanged: boolean;
  roadTerrainChanged: boolean;
  waterOrCoastChanged: boolean;
  changedTileCount: number;
  dirtyTileBounds?: TerrainDirtyTileBounds;
};

export type ThreeTestTreeTypeMapState = {
  cachedLength: number;
  totalTiles: number;
  cachedTerrainTypeRevision: number;
  cachedVegetationRevision: number;
};

export type TerrainVisualInvalidation = {
  geometry: boolean;
  surfaceColor: boolean;
  vegetation: boolean;
  roads: boolean;
  structure: boolean;
  debug: boolean;
  fireVisual: boolean;
  dirtyTileBounds?: TerrainDirtyTileBounds;
};

export type TerrainVisualSyncDecision = {
  shouldSync: boolean;
  skipped: boolean;
  visualBatched: boolean;
  deferredReason: 0 | 1 | 2;
  invalidation: TerrainVisualInvalidation;
};

export type TerrainVisualSyncUrgency = "none" | "deferred" | "immediate";

export const shouldRebuildThreeTestTreeTypeMap = (
  cache: ThreeTestTreeTypeMapState,
  next: Pick<ThreeTestTerrainRevisionState, "terrainTypeRevision" | "vegetationRevision">,
  forceRefresh = false
): boolean =>
  forceRefresh ||
  cache.cachedLength !== cache.totalTiles ||
  cache.cachedTerrainTypeRevision !== next.terrainTypeRevision;

export const shouldSyncThreeTestTerrain = (
  previous: ThreeTestTerrainRevisionState,
  next: ThreeTestTerrainRevisionState,
  force = false
): boolean =>
  force ||
  previous.terrainTypeRevision !== next.terrainTypeRevision ||
  previous.vegetationRevision !== next.vegetationRevision ||
  previous.structureRevision !== next.structureRevision ||
  previous.debugTypeColors !== next.debugTypeColors;

const GEOMETRY_TERRAIN_TYPES = new Set<number>([
  TILE_TYPE_IDS.water,
  TILE_TYPE_IDS.base,
  TILE_TYPE_IDS.house
]);

const ROAD_TERRAIN_TYPES = new Set<number>([
  TILE_TYPE_IDS.road,
  TILE_TYPE_IDS.base
]);

const WATER_OR_COAST_TERRAIN_TYPES = new Set<number>([
  TILE_TYPE_IDS.water,
  TILE_TYPE_IDS.beach,
  TILE_TYPE_IDS.rocky
]);

const isTerrainTypeInSet = (typeId: number, typeSet: ReadonlySet<number>): boolean => typeSet.has(typeId);

const includeDirtyTile = (
  bounds: TerrainDirtyTileBounds | undefined,
  x: number,
  y: number
): TerrainDirtyTileBounds => {
  if (!bounds) {
    return { minX: x, minY: y, maxX: x, maxY: y };
  }
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
  return bounds;
};

export const analyzeTerrainTypeDiff = (
  previous: Uint8Array | null,
  next: Uint8Array,
  cols: number
): TerrainTypeDiff => {
  if (!previous || previous.length !== next.length || cols <= 0) {
    return {
      terrainTypesChanged: true,
      geometryTerrainChanged: true,
      roadTerrainChanged: true,
      waterOrCoastChanged: true,
      changedTileCount: next.length
    };
  }

  let dirtyTileBounds: TerrainDirtyTileBounds | undefined;
  let geometryTerrainChanged = false;
  let roadTerrainChanged = false;
  let waterOrCoastChanged = false;
  let changedTileCount = 0;
  for (let i = 0; i < next.length; i += 1) {
    const prevType = previous[i] ?? -1;
    const nextType = next[i] ?? -1;
    if (prevType === nextType) {
      continue;
    }
    const x = i % cols;
    const y = Math.floor(i / cols);
    dirtyTileBounds = includeDirtyTile(dirtyTileBounds, x, y);
    changedTileCount += 1;
    geometryTerrainChanged ||= isTerrainTypeInSet(prevType, GEOMETRY_TERRAIN_TYPES) || isTerrainTypeInSet(nextType, GEOMETRY_TERRAIN_TYPES);
    roadTerrainChanged ||= isTerrainTypeInSet(prevType, ROAD_TERRAIN_TYPES) || isTerrainTypeInSet(nextType, ROAD_TERRAIN_TYPES);
    waterOrCoastChanged ||= isTerrainTypeInSet(prevType, WATER_OR_COAST_TERRAIN_TYPES) || isTerrainTypeInSet(nextType, WATER_OR_COAST_TERRAIN_TYPES);
  }

  return {
    terrainTypesChanged: changedTileCount > 0,
    geometryTerrainChanged,
    roadTerrainChanged,
    waterOrCoastChanged,
    changedTileCount,
    dirtyTileBounds
  };
};

export const classifyTerrainVisualInvalidation = (params: {
  previous: ThreeTestTerrainRevisionState;
  next: ThreeTestTerrainRevisionState;
  force?: boolean;
  geometryTerrainChanged: boolean;
  roadTerrainChanged?: boolean;
  dirtyTileBounds?: TerrainDirtyTileBounds;
  waterOrCoastChanged?: boolean;
  activeFireTerrainPressure: boolean;
  activeFireVisualRefresh?: boolean;
}): TerrainVisualInvalidation => {
  const terrainTypesChanged = params.previous.terrainTypeRevision !== params.next.terrainTypeRevision;
  const vegetationChanged = params.previous.vegetationRevision !== params.next.vegetationRevision;
  const structureChanged = params.previous.structureRevision !== params.next.structureRevision;
  const debugChanged = params.previous.debugTypeColors !== params.next.debugTypeColors;
  const geometry = Boolean(params.force) || params.geometryTerrainChanged;
  const surfaceColor = terrainTypesChanged && !geometry;
  const vegetation = vegetationChanged && !geometry;
  const roads = Boolean(params.roadTerrainChanged) && !geometry;
  const dirtyTileBounds =
    !geometry && !params.waterOrCoastChanged && (surfaceColor || roads) ? params.dirtyTileBounds : undefined;
  return {
    geometry,
    surfaceColor,
    vegetation,
    roads,
    structure: structureChanged,
    debug: debugChanged,
    dirtyTileBounds,
    fireVisual:
      params.activeFireTerrainPressure &&
      !geometry &&
      !structureChanged &&
      (surfaceColor || vegetation)
  };
};

export const getTerrainVisualSyncUrgency = (
  invalidation: TerrainVisualInvalidation,
  force = false
): TerrainVisualSyncUrgency => {
  if (force || invalidation.geometry || invalidation.structure || invalidation.debug) {
    return "immediate";
  }
  if (
    invalidation.surfaceColor ||
    invalidation.vegetation ||
    invalidation.roads ||
    invalidation.fireVisual
  ) {
    return "deferred";
  }
  return "none";
};

export const shouldHoldSimulationForTerrainInvalidation = (
  invalidation: TerrainVisualInvalidation,
  force = false
): boolean => getTerrainVisualSyncUrgency(invalidation, force) === "immediate";

export const decideTerrainVisualSync = (params: {
  previous: ThreeTestTerrainRevisionState;
  next: ThreeTestTerrainRevisionState;
  force?: boolean;
  geometryTerrainChanged: boolean;
  roadTerrainChanged?: boolean;
  dirtyTileBounds?: TerrainDirtyTileBounds;
  waterOrCoastChanged?: boolean;
  activeFireTerrainPressure: boolean;
  nowMs: number;
  lastSyncMs: number;
  cooldownMs: number;
  fireVisualCooldownMs: number;
  cameraInteracting: boolean;
  activeFireVisualRefresh?: boolean;
}): TerrainVisualSyncDecision => {
  const invalidation = classifyTerrainVisualInvalidation(params);
  const hasRevisionWork = shouldSyncThreeTestTerrain(params.previous, params.next, params.force);
  if (!hasRevisionWork) {
    return { shouldSync: false, skipped: false, visualBatched: false, deferredReason: 0, invalidation };
  }
  const immediate = getTerrainVisualSyncUrgency(invalidation, params.force) === "immediate";
  if (!immediate && params.cameraInteracting && !params.activeFireTerrainPressure) {
    return { shouldSync: false, skipped: true, visualBatched: false, deferredReason: 1, invalidation };
  }
  const cooldown = invalidation.fireVisual ? params.fireVisualCooldownMs : params.cooldownMs;
  if (!immediate && params.nowMs - params.lastSyncMs < cooldown) {
    return { shouldSync: false, skipped: true, visualBatched: invalidation.fireVisual, deferredReason: 0, invalidation };
  }
  return { shouldSync: true, skipped: false, visualBatched: invalidation.fireVisual, deferredReason: 0, invalidation };
};
