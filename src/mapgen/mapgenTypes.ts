import type { MapGenContext } from "./pipeline/MapGenContext.js";

export type MapGenReporter = (message: string, progress: number) => void | Promise<void>;

export type MapGenDebugPhase =
  | "terrain:elevation"
  | "terrain:erosion"
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
};

export type MapGenDebug = {
  onPhase: (snapshot: MapGenDebugSnapshot) => void | Promise<void>;
  waitForStep?: () => Promise<void>;
};

export type MapGenStage = {
  id: MapGenDebugPhase;
  weight: number;
  run: (ctx: MapGenContext) => Promise<void>;
};
