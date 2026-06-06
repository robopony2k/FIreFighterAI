import type { WorldState } from "../../../core/state.js";
import type { MapGenSettings } from "../../../mapgen/settings.js";
import type { StaticHydrologyResult } from "../types/staticHydrologyTypes.js";
import { buildBasinLakeHydrology } from "./basinLakeHydrology.js";

export const buildStaticInlandLakeNetwork = (input: {
  state: WorldState;
  elevationMap: number[];
  riverMask: Uint8Array;
  oceanMask: Uint8Array;
  settings: MapGenSettings;
}): StaticHydrologyResult => buildBasinLakeHydrology(input);
