export {
  analyzeTerrainTypeDiff,
  classifyTerrainVisualInvalidation,
  decideTerrainVisualSync,
  getTerrainVisualSyncUrgency,
  shouldRebuildThreeTestTreeTypeMap,
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
