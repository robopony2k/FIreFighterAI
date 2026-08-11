export {
  analyzeTerrainTypeDiff,
  classifyTerrainVisualInvalidation,
  decideTerrainVisualSync,
  getTerrainVisualSyncUrgency,
  shouldRebuildThreeTestTreeTypeMap,
  shouldRebuildThreeTestVegetationInstances,
  shouldHoldSimulationForTerrainInvalidation,
  shouldSyncThreeTestTerrain
} from "../systems/terrain/controllers/terrainVisualSyncController.js";
export type {
  TerrainVisualInvalidation,
  TerrainVisualSyncDecision,
  TerrainVisualSyncUrgency,
  TerrainDirtyTileBounds,
  TerrainTypeDiff,
  ThreeTestTerrainRevisionState,
  ThreeTestTreeTypeMapState
} from "../systems/terrain/controllers/terrainVisualSyncController.js";
