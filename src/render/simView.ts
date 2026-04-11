import type { WorldState } from "../core/state.js";
import { ensureTileSoA } from "../core/tileCache.js";
import type { Town } from "../core/types.js";
import { DEFAULT_MOISTURE_PARAMS } from "../core/climate.js";
import { clamp } from "../core/utils.js";
import type { TerrainRenderDebugOptions } from "./terrain/debug/terrainHeightProvenance.js";

// Render-only view of simulation state (authoritative sim remains elsewhere).
export type RenderSim = WorldState;

export const asRenderSim = (state: WorldState): RenderSim => state;

export type RenderTerrainSample = {
  cols: number;
  rows: number;
  elevations: Float32Array;
  heightScaleMultiplier?: number;
  tileTypes?: Uint8Array;
  treeTypes?: Uint8Array;
  tileFire?: Float32Array;
  tileHeat?: Float32Array;
  tileFuel?: Float32Array;
  heatCap?: number;
  tileMoisture?: Float32Array;
  tileVegetationAge?: Float32Array;
  tileCanopyCover?: Float32Array;
  tileStemDensity?: Uint8Array;
  riverMask?: Uint8Array;
  oceanMask?: Uint8Array;
  seaLevel?: Float32Array;
  coastDistance?: Uint16Array;
  coastClass?: Uint8Array;
  roadBridgeMask?: Uint8Array;
  roadEdges?: Uint8Array;
  roadWallEdges?: Uint8Array;
  erosionWear?: Float32Array;
  riverBed?: Float32Array;
  riverSurface?: Float32Array;
  riverStepStrength?: Float32Array;
  climateDryness?: number;
  debugTypeColors?: boolean;
  treesEnabled?: boolean;
  fastUpdate?: boolean;
  fullResolution?: boolean;
  worldSeed?: number;
  towns?: Town[];
  vegetationRevision?: number;
  structureRevision?: number;
  dynamicStructures?: boolean;
  debugRenderOptions?: TerrainRenderDebugOptions;
};

const getClimateDryness = (state: RenderSim): number => {
  const denom = Math.max(0.0001, DEFAULT_MOISTURE_PARAMS.Mmax - DEFAULT_MOISTURE_PARAMS.Mmin);
  const moistureNorm = clamp((state.climateMoisture - DEFAULT_MOISTURE_PARAMS.Mmin) / denom, 0, 1);
  return clamp(1 - moistureNorm, 0, 1);
};

export const buildRenderTerrainSample = (
  state: RenderSim,
  treeTypes: Uint8Array,
  debugTypeColors: boolean,
  treesEnabled: boolean,
  fastUpdate = false,
  fullResolution = false,
  heightScaleMultiplier = 1
): RenderTerrainSample => {
  ensureTileSoA(state);
  return {
    cols: state.grid.cols,
    rows: state.grid.rows,
    elevations: state.tileElevation,
    heightScaleMultiplier,
    tileTypes: state.tileTypeId,
    treeTypes,
    tileFire: state.tileFire,
    tileHeat: state.tileHeat,
    tileFuel: state.tileFuel,
    heatCap: Math.max(0.01, state.fireSettings.heatCap),
    tileMoisture: state.tileMoisture,
    tileVegetationAge: state.tileVegetationAge,
    tileCanopyCover: state.tileCanopyCover,
    tileStemDensity: state.tileStemDensity,
    riverMask: state.tileRiverMask,
    oceanMask: state.tileOceanMask,
    seaLevel: state.tileSeaLevel,
    coastDistance: state.tileCoastDistance,
    coastClass: state.tileCoastClass,
    roadBridgeMask: state.tileRoadBridge,
    roadEdges: state.tileRoadEdges,
    roadWallEdges: state.tileRoadWallEdges,
    erosionWear: state.tileErosionWear,
    riverBed: state.tileRiverBed,
    riverSurface: state.tileRiverSurface,
    riverStepStrength: state.tileRiverStepStrength,
    climateDryness: getClimateDryness(state),
    debugTypeColors,
    treesEnabled,
    fastUpdate,
    fullResolution,
    worldSeed: state.seed,
    towns: state.towns,
    vegetationRevision: state.vegetationRevision,
    structureRevision: state.structureRevision,
    dynamicStructures: true
  };
};
