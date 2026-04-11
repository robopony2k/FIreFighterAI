import { DISABLE_INLAND_LAKES } from "../../core/config.js";
import { indexFor } from "../../core/grid.js";
import { COAST_CLASS_NONE } from "../../core/state.js";
import type { Tile } from "../../core/types.js";
import { clamp } from "../../core/utils.js";
import type { PipelineStage } from "../pipeline/TerrainPipeline.js";
import { emitStageSnapshot } from "../pipeline/stageDebug.js";
import {
  buildLargestWaterMask,
  buildOceanMask,
  buildOceanMaskFromElevation,
  clampSeaLevel,
  computeOceanLevel,
  countMaskTiles,
  enforceEdgeOceanMask,
  expandOceanMaskByElevation,
  persistSeaLevelMapToState
} from "../runtime.js";

const createBlankTile = (elevation: number): Tile => ({
  type: "grass",
  fuel: 0,
  fire: 0,
  isBase: false,
  elevation,
  heat: 0,
  ignitionPoint: 0,
  burnRate: 0,
  heatOutput: 0,
  spreadBoost: 0,
  heatTransferCap: 0,
  heatRetention: 1,
  windFactor: 0,
  moisture: 0,
  waterDist: 0,
  vegetationAgeYears: 0,
  canopy: 0,
  canopyCover: 0,
  stemDensity: 0,
  dominantTreeType: null,
  treeType: null,
  houseValue: 0,
  houseResidents: 0,
  houseDestroyed: false,
  ashAge: 0
});

export const HydrologyStage: PipelineStage = {
  id: "hydro:solve",
  weight: 16,
  run: async (ctx) => {
    const { state, settings, cellSizeM, edgeDenomM } = ctx;
    const elevationMap = ctx.elevationMap;
    const riverMask = ctx.riverMask;
    if (!elevationMap || !riverMask) {
      throw new Error("Hydrology stage missing elevation/river inputs.");
    }

    const totalTiles = state.grid.totalTiles;
    const seaLevelMap = new Float32Array(totalTiles);
    ctx.seaLevelMap = seaLevelMap;

    for (let y = 0; y < state.grid.rows; y += 1) {
      for (let x = 0; x < state.grid.cols; x += 1) {
        const idx = indexFor(state.grid, x, y);
        const edgeDistM = Math.min(x, y, state.grid.cols - 1 - x, state.grid.rows - 1 - y) * cellSizeM;
        const edgeFactor = clamp(edgeDistM / edgeDenomM, 0, 1);
        const seaLevel = clampSeaLevel(ctx.seaLevelBase + (1 - edgeFactor) * settings.edgeWaterBias, settings);
        seaLevelMap[idx] = seaLevel;
        const elevation = elevationMap[idx] ?? 0;
        const tile = createBlankTile(elevation);
        tile.type = elevation < seaLevel ? "water" : "grass";
        state.tiles[idx] = tile;
      }
      if (await ctx.yieldIfNeeded()) {
        await ctx.reportStage("Solving coastlines...", (y + 1) / state.grid.rows * 0.7);
      }
    }
    persistSeaLevelMapToState(state, seaLevelMap);

    for (let i = 0; i < riverMask.length; i += 1) {
      if (riverMask[i] > 0) {
        state.tiles[i].type = "water";
      }
    }

    let oceanMask = buildOceanMask(state);
    let oceanMaskCount = countMaskTiles(oceanMask);
    if (oceanMaskCount === 0) {
      oceanMask = buildOceanMaskFromElevation(state, elevationMap, seaLevelMap);
      oceanMaskCount = countMaskTiles(oceanMask);
    }
    if (oceanMaskCount === 0) {
      oceanMask = buildLargestWaterMask(state);
      oceanMaskCount = countMaskTiles(oceanMask);
    }
    oceanMask = enforceEdgeOceanMask(state, elevationMap, seaLevelMap, oceanMask, riverMask);
    oceanMaskCount = countMaskTiles(oceanMask);
    const oceanLevel = oceanMaskCount > 0 ? computeOceanLevel(elevationMap, oceanMask, riverMask) : null;
    if (oceanLevel !== null) {
      oceanMask = expandOceanMaskByElevation(state, elevationMap, seaLevelMap, oceanMask, riverMask, oceanLevel);
      for (let i = 0; i < state.tiles.length; i += 1) {
        if (oceanMask[i]) {
          state.tiles[i].type = "water";
        }
      }
    }

    if (DISABLE_INLAND_LAKES && oceanMaskCount > 0) {
      for (let i = 0; i < state.tiles.length; i += 1) {
        if (oceanMask[i] || riverMask[i] > 0) {
          continue;
        }
        const tile = state.tiles[i];
        const belowOceanLevel = oceanLevel !== null && (elevationMap[i] ?? 0) < oceanLevel;
        if (tile.type !== "water" && !belowOceanLevel) {
          continue;
        }
        const seaLevel = seaLevelMap[i] ?? 0;
        const floorLevel = oceanLevel !== null ? Math.max(seaLevel, oceanLevel) : seaLevel;
        const nextElevation = Math.max(elevationMap[i] ?? seaLevel, floorLevel + 0.002);
        elevationMap[i] = nextElevation;
        tile.elevation = nextElevation;
        tile.type = "grass";
      }
    }

    ctx.oceanMask = oceanMask;
    for (let i = 0; i < totalTiles; i += 1) {
      state.tileOceanMask[i] = oceanMask[i] > 0 ? 1 : 0;
      state.tileCoastDistance[i] = 0;
      state.tileCoastClass[i] = COAST_CLASS_NONE;
    }
    state.tileRiverMask = riverMask;
    await ctx.reportStage("Hydrology solved.", 1);
    await emitStageSnapshot(ctx, "hydro:solve");
  }
};
