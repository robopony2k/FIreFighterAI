export {
  classifyTerrainVisualInvalidation,
  decideTerrainVisualSync,
  shouldDeferThreeTestTerrainSyncForFastTime,
  shouldRebuildThreeTestTreeTypeMap,
  shouldSyncThreeTestTerrain
} from "../systems/terrain/controllers/terrainVisualSyncController.js";
export type {
  TerrainVisualInvalidation,
  TerrainVisualSyncDecision,
  ThreeTestFastTimeTerrainSyncState,
  ThreeTestTerrainRevisionState,
  ThreeTestTreeTypeMapState
} from "../systems/terrain/controllers/terrainVisualSyncController.js";
