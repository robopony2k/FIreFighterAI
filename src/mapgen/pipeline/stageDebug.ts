import type { WorldState } from "../../core/state.js";
import { TILE_TYPE_IDS } from "../../core/state.js";
import type { MapGenDebugPhase } from "../mapgenTypes.js";
import type { MapGenContext } from "./MapGenContext.js";

const buildTypeIdsFromState = (state: WorldState): Uint8Array => {
  const ids = new Uint8Array(state.grid.totalTiles);
  for (let i = 0; i < state.grid.totalTiles; i += 1) {
    ids[i] = TILE_TYPE_IDS[state.tiles[i]?.type ?? "grass"];
  }
  return ids;
};

export const emitStageSnapshot = async (ctx: MapGenContext, phase: MapGenDebugPhase): Promise<void> => {
  ctx.checkCancelled();
  if (!ctx.debug || !ctx.elevationMap) {
    return;
  }
  await ctx.debug.onPhase({
    phase,
    elevations: Float32Array.from(ctx.elevationMap),
    tileTypes: buildTypeIdsFromState(ctx.state),
    riverMask: ctx.riverMask ? Uint8Array.from(ctx.riverMask) : undefined,
    oceanMask: ctx.oceanMask ? Uint8Array.from(ctx.oceanMask) : undefined,
    seaLevel: ctx.seaLevelMap ? Float32Array.from(ctx.seaLevelMap) : undefined,
    coastDistance: ctx.state.tileCoastDistance.length > 0 ? Uint16Array.from(ctx.state.tileCoastDistance) : undefined,
    coastClass: ctx.state.tileCoastClass.length > 0 ? Uint8Array.from(ctx.state.tileCoastClass) : undefined,
    rawMoisture: ctx.moistureMap ? Float32Array.from(ctx.moistureMap) : undefined,
    elevationStress: ctx.elevationStressMap ? Float32Array.from(ctx.elevationStressMap) : undefined,
    slopeStress: ctx.slopeStressMap ? Float32Array.from(ctx.slopeStressMap) : undefined,
    treeSuitability: ctx.treeSuitabilityMap ? Float32Array.from(ctx.treeSuitabilityMap) : undefined,
    treeProbability: ctx.treeProbabilityMap ? Float32Array.from(ctx.treeProbabilityMap) : undefined,
    lakeMask: ctx.lakeMask ? Uint16Array.from(ctx.lakeMask) : undefined,
    lakeSurface: ctx.lakeSurfaceMap ? Float32Array.from(ctx.lakeSurfaceMap) : undefined,
    lakeOutletMask: ctx.lakeOutletMask ? Uint8Array.from(ctx.lakeOutletMask) : undefined,
    rainfall: ctx.rainfallMap ? Float32Array.from(ctx.rainfallMap) : undefined,
    runoff: ctx.runoffMap ? Float32Array.from(ctx.runoffMap) : undefined,
    riverLakeEntryMask: ctx.riverLakeEntryMask ? Uint8Array.from(ctx.riverLakeEntryMask) : undefined,
    riverLakeExitMask: ctx.riverLakeExitMask ? Uint8Array.from(ctx.riverLakeExitMask) : undefined,
    waterfallSourceMask: ctx.waterfallSourceMask ? Uint8Array.from(ctx.waterfallSourceMask) : undefined,
    waterfallTarget: ctx.waterfallTargetMap ? Int32Array.from(ctx.waterfallTargetMap) : undefined,
    waterfallDrop: ctx.waterfallDropMap ? Float32Array.from(ctx.waterfallDropMap) : undefined
  });
  if (ctx.debug.waitForStep) {
    await ctx.debug.waitForStep();
  }
  ctx.checkCancelled();
};

export const resolveStageLimit = (phase: MapGenDebugPhase | undefined): MapGenDebugPhase | null => {
  switch (phase) {
    case "terrain:relief":
    case "terrain:landmass":
    case "terrain:mountains":
    case "terrain:carving":
    case "terrain:flooding":
    case "terrain:elevation":
      return "terrain:elevation";
    case "terrain:erosion":
      return "terrain:erosion";
    case "hydro:solve":
      return "hydro:solve";
    case "terrain:shoreline":
      return "terrain:shoreline";
    case "hydro:rivers":
      return "hydro:rivers";
    case "biome:fields":
      return "biome:fields";
    case "biome:spread":
      return "biome:spread";
    case "biome:classify":
      return "biome:classify";
    case "settlement:place":
      return "settlement:place";
    case "roads:connect":
      return "roads:connect";
    case "reconcile:postSettlement":
      return "reconcile:postSettlement";
    case "map:finalize":
      return "map:finalize";
    default:
      return null;
  }
};
