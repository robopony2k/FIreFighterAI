import { COAST_CLASS_BEACH, COAST_CLASS_CLIFF, COAST_CLASS_NONE } from "../../core/state.js";
import type { PipelineStage } from "../pipeline/TerrainPipeline.js";
import { emitStageSnapshot } from "../pipeline/stageDebug.js";
import {
  buildDistanceFromMask,
  buildSlopeMap,
  classifyCoastDryTileType,
  persistCoastMetadataToState
} from "../runtime.js";

export const CoastMetadataStage: PipelineStage = {
  id: "terrain:shoreline",
  weight: 2,
  run: async (ctx) => {
    const { state, elevationMap, seaLevelMap, oceanMask, riverMask } = ctx;
    if (!elevationMap || !seaLevelMap || !oceanMask || !riverMask) {
      throw new Error("Coast metadata stage missing hydrology fields.");
    }

    const { cols, rows, totalTiles } = state.grid;
    const landMask = new Uint8Array(totalTiles);
    for (let i = 0; i < totalTiles; i += 1) {
      if (oceanMask[i] === 0 && riverMask[i] === 0) {
        landMask[i] = 1;
      }
    }

    const slopeMap = buildSlopeMap(state, elevationMap);
    const distToOcean = buildDistanceFromMask(oceanMask, cols, rows);
    const distToLand = buildDistanceFromMask(landMask, cols, rows);
    persistCoastMetadataToState(
      state,
      oceanMask,
      distToOcean,
      distToLand,
      slopeMap,
      null,
      seaLevelMap
    );

    for (let i = 0; i < totalTiles; i += 1) {
      const tile = state.tiles[i];
      state.tileElevation[i] = elevationMap[i] ?? tile.elevation;
      if (oceanMask[i] > 0 || riverMask[i] > 0) {
        tile.type = "water";
        continue;
      }
      const coastClass = state.tileCoastClass[i] ?? COAST_CLASS_NONE;
      if (coastClass === COAST_CLASS_BEACH) {
        tile.type = "beach";
      } else if (coastClass === COAST_CLASS_CLIFF) {
        const seaLevel = seaLevelMap[i] ?? 0;
        tile.type = classifyCoastDryTileType(slopeMap[i] ?? 0, tile.elevation - seaLevel);
      } else {
        tile.type = "grass";
      }
    }

    await ctx.reportStage("Coast metadata derived.", 1);
    await emitStageSnapshot(ctx, "terrain:shoreline");
  }
};
