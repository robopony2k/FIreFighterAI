import type { WorldState } from "../../../core/state.js";
import type { MapGenSettings } from "../../../mapgen/settings.js";
import type { StaticHydrologyDebugHooks, StaticHydrologyResult } from "../types/staticHydrologyTypes.js";
import { buildBasinLakeHydrology } from "./basinLakeHydrology.js";

export const buildStaticInlandLakeNetwork = (input: {
  state: WorldState;
  elevationMap: number[];
  riverMask: Uint8Array;
  oceanMask: Uint8Array;
  settings: MapGenSettings;
  debug?: StaticHydrologyDebugHooks;
}): Promise<StaticHydrologyResult> => buildBasinLakeHydrology(input);
