import type { MapGenContext } from "./pipeline/MapGenContext.js";
import type { RoadPathDebugEvent } from "../systems/roads/types/roadPathDebugTypes.js";
import type { RoadDiagnosticTuning } from "../systems/roads/types/roadDiagnosticTuning.js";
import type { StaticHydrologyDebugEvent } from "../systems/terrain/types/staticHydrologyTypes.js";

export type MapGenReporter = (message: string, progress: number) => void | Promise<void>;

export type MapGenDebugPhase =
  | "terrain:fastPreview"
  | "terrain:relief"
  | "terrain:landmass"
  | "terrain:mountains"
  | "terrain:carving"
  | "terrain:flooding"
  | "terrain:elevation"
  | "terrain:erosion"
  | "terrain:shoreline"
  | "hydro:solve"
  | "hydro:rivers"
  | "biome:fields"
  | "biome:spread"
  | "biome:classify"
  | "settlement:place"
  | "roads:connect"
  | "reconcile:postSettlement"
  | "map:finalize";

export type MapGenDebugSnapshot = {
  phase: MapGenDebugPhase;
  elevations: Float32Array;
  tileTypes?: Uint8Array;
  riverMask?: Uint8Array;
  oceanMask?: Uint8Array;
  seaLevel?: Float32Array;
  coastDistance?: Uint16Array;
  coastClass?: Uint8Array;
  rawMoisture?: Float32Array;
  elevationStress?: Float32Array;
  slopeStress?: Float32Array;
  treeSuitability?: Float32Array;
  treeProbability?: Float32Array;
  lakeMask?: Uint16Array;
  lakeSurface?: Float32Array;
  lakeOutletMask?: Uint8Array;
  rainfall?: Float32Array;
  runoff?: Float32Array;
  riverLakeEntryMask?: Uint8Array;
  riverLakeExitMask?: Uint8Array;
  waterfallSourceMask?: Uint8Array;
  waterfallTarget?: Int32Array;
  waterfallDrop?: Float32Array;
};

export type MapGenStageTiming = {
  phase: MapGenDebugPhase;
  durationMs: number;
};

export type MapGenCancelledDiagnosticEvent = {
  kind: "mapgen:cancelled";
  phase?: MapGenDebugPhase;
  message: string;
};

export type MapGenDiagnosticEvent =
  | StaticHydrologyDebugEvent
  | RoadPathDebugEvent
  | MapGenCancelledDiagnosticEvent;

export type MapGenDebug = {
  onPhase: (snapshot: MapGenDebugSnapshot) => void | Promise<void>;
  onStageTiming?: (timing: MapGenStageTiming) => void | Promise<void>;
  onDiagnosticEvent?: (event: MapGenDiagnosticEvent) => void | Promise<void>;
  roadTuning?: RoadDiagnosticTuning;
  waitForStep?: () => Promise<void>;
  shouldCancel?: () => boolean;
  stopAfterPhase?: MapGenDebugPhase;
};

export type MapGenStage = {
  id: MapGenDebugPhase;
  weight: number;
  run: (ctx: MapGenContext) => Promise<void>;
};
