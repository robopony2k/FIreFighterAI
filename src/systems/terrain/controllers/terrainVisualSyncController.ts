export type ThreeTestTerrainRevisionState = {
  terrainTypeRevision: number;
  vegetationRevision: number;
  structureRevision: number;
  debugTypeColors: boolean;
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
};

export type TerrainVisualSyncDecision = {
  shouldSync: boolean;
  skipped: boolean;
  visualBatched: boolean;
  deferredReason: 0 | 1 | 2;
  invalidation: TerrainVisualInvalidation;
};

export const shouldRebuildThreeTestTreeTypeMap = (
  cache: ThreeTestTreeTypeMapState,
  next: Pick<ThreeTestTerrainRevisionState, "terrainTypeRevision" | "vegetationRevision">,
  forceRefresh = false
): boolean =>
  forceRefresh ||
  cache.cachedLength !== cache.totalTiles ||
  cache.cachedTerrainTypeRevision !== next.terrainTypeRevision ||
  cache.cachedVegetationRevision !== next.vegetationRevision;

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

export const classifyTerrainVisualInvalidation = (params: {
  previous: ThreeTestTerrainRevisionState;
  next: ThreeTestTerrainRevisionState;
  force?: boolean;
  geometryTerrainChanged: boolean;
  roadTerrainChanged?: boolean;
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
  return {
    geometry,
    surfaceColor,
    vegetation,
    roads,
    structure: structureChanged,
    debug: debugChanged,
    fireVisual:
      params.activeFireTerrainPressure &&
      !geometry &&
      !structureChanged &&
      (surfaceColor || vegetation || Boolean(params.activeFireVisualRefresh))
  };
};

export const decideTerrainVisualSync = (params: {
  previous: ThreeTestTerrainRevisionState;
  next: ThreeTestTerrainRevisionState;
  force?: boolean;
  geometryTerrainChanged: boolean;
  roadTerrainChanged?: boolean;
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
  const hasFireVisualWork = Boolean(params.activeFireVisualRefresh) && invalidation.fireVisual;
  if (!hasRevisionWork && !hasFireVisualWork) {
    return { shouldSync: false, skipped: false, visualBatched: false, deferredReason: 0, invalidation };
  }
  const immediate = Boolean(params.force) || invalidation.debug || invalidation.structure || invalidation.geometry;
  if (!immediate && params.cameraInteracting && !params.activeFireTerrainPressure) {
    return { shouldSync: false, skipped: true, visualBatched: false, deferredReason: 1, invalidation };
  }
  const cooldown = invalidation.fireVisual ? params.fireVisualCooldownMs : params.cooldownMs;
  if (!immediate && params.nowMs - params.lastSyncMs < cooldown) {
    return { shouldSync: false, skipped: true, visualBatched: invalidation.fireVisual, deferredReason: 0, invalidation };
  }
  return { shouldSync: true, skipped: false, visualBatched: invalidation.fireVisual, deferredReason: 0, invalidation };
};
