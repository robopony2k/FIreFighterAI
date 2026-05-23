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

const FAST_TIME_TERRAIN_SYNC_SPEED_THRESHOLD = 10;

export type ThreeTestFastTimeTerrainSyncState = {
  simTimeMode: string;
  timeSpeedValue: number;
  simulationPaused: boolean;
  activeFireTerrainPressure: boolean;
  immediateTerrainSyncChange?: boolean;
};

export const shouldDeferThreeTestTerrainSyncForFastTime = (
  state: ThreeTestFastTimeTerrainSyncState
): boolean =>
  state.simTimeMode === "strategic" &&
  !state.simulationPaused &&
  !state.activeFireTerrainPressure &&
  !state.immediateTerrainSyncChange &&
  state.timeSpeedValue > FAST_TIME_TERRAIN_SYNC_SPEED_THRESHOLD;
