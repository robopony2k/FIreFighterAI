import type { RNG } from "../core/types.js";
import type { WorldState } from "../core/state.js";
import type { MapGenDebug, MapGenDebugSnapshot, MapGenReporter } from "./mapgenTypes.js";
import type { MapGenSettings } from "./settings.js";
import { createYieldController } from "./runtime.js";
import { MapGenContext } from "./pipeline/MapGenContext.js";
import { TerrainPipeline } from "./pipeline/TerrainPipeline.js";
import { ElevationStage } from "./stages/ElevationStage.js";
import { ErosionStage } from "./stages/ErosionStage.js";
import { HydrologyStage } from "./stages/HydrologyStage.js";
import { BiomeFieldsStage } from "./stages/BiomeFieldsStage.js";
import { BiomeSpreadStage } from "./stages/BiomeSpreadStage.js";
import { BiomeClassificationStage } from "./stages/BiomeClassificationStage.js";
import { SettlementPlacementStage } from "./stages/SettlementPlacementStage.js";
import { RoadNetworkStage } from "./stages/RoadNetworkStage.js";
import { PostSettlementReconcileStage } from "./stages/PostSettlementReconcileStage.js";
import { FinalizeStage } from "./stages/FinalizeStage.js";

export type { MapGenDebug, MapGenDebugPhase, MapGenDebugSnapshot, MapGenReporter } from "./mapgenTypes.js";

const MAPGEN_PIPELINE = new TerrainPipeline([
  ElevationStage,
  ErosionStage,
  HydrologyStage,
  BiomeFieldsStage,
  BiomeSpreadStage,
  BiomeClassificationStage,
  SettlementPlacementStage,
  RoadNetworkStage,
  PostSettlementReconcileStage,
  FinalizeStage
]);

export async function generateMap(
  state: WorldState,
  rng: RNG,
  report?: MapGenReporter,
  settings?: MapGenSettings,
  debug?: MapGenDebug
): Promise<void> {
  const yieldIfNeeded = createYieldController();
  const context = new MapGenContext(state, rng, report, settings, debug, yieldIfNeeded);
  await MAPGEN_PIPELINE.run(context);
}
