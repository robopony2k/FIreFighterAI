import type { WorldState } from "../core/state.js";
import type { Town } from "../core/types.js";
import { DEFAULT_MOISTURE_PARAMS } from "../core/climate.js";
import { clamp } from "../core/utils.js";

// Render-only view of simulation state (authoritative sim remains elsewhere).
export type RenderSim = WorldState;

export const asRenderSim = (state: WorldState): RenderSim => state;

export type RenderTerrainSample = {
  cols: number;
  rows: number;
  elevations: Float32Array;
  tileTypes?: Uint8Array;
  treeTypes?: Uint8Array;
  tileFuel?: Float32Array;
  tileMoisture?: Float32Array;
  riverMask?: Uint8Array;
  roadBridgeMask?: Uint8Array;
  roadEdges?: Uint8Array;
  roadWallEdges?: Uint8Array;
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
  structureRevision?: number;
  dynamicStructures?: boolean;
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
  fullResolution = false
): RenderTerrainSample => ({
  cols: state.grid.cols,
  rows: state.grid.rows,
  elevations: state.tileElevation,
  tileTypes: state.tileTypeId,
  treeTypes,
  tileFuel: state.tileFuel,
  tileMoisture: state.tileMoisture,
  riverMask: state.tileRiverMask,
  roadBridgeMask: state.tileRoadBridge,
  roadEdges: state.tileRoadEdges,
  roadWallEdges: state.tileRoadWallEdges,
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
  structureRevision: state.structureRevision,
  dynamicStructures: true
});
