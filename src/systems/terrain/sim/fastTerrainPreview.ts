import { COAST_CLASS_NONE, TILE_TYPE_IDS } from "../../../core/state.js";
import type { MapGenSettings } from "../../../mapgen/settings.js";
import { buildNoiseLandmassCore } from "./noiseLandmass.js";

export type FastTerrainPreviewMode = "noise" | "shape" | "relief" | "water";

export type FastTerrainPreviewInput = {
  seed: number;
  cols: number;
  rows: number;
  settings: MapGenSettings;
  mode?: FastTerrainPreviewMode;
};

export type FastTerrainPreviewResult = {
  cols: number;
  rows: number;
  constraintCols: number;
  constraintRows: number;
  constraintMap: Float32Array;
  elevationMap: Float32Array;
  tileTypes: Uint8Array;
  oceanMask: Uint8Array;
  seaLevelMap: Float32Array;
  coastDistance: Uint16Array;
  coastClass: Uint8Array;
  riverMask: Uint8Array;
  flowMap: Float32Array;
  debugScalarField?: Float32Array;
  timingsMs: {
    constraints: number;
    elevation: number;
    ocean: number;
    rivers: number;
    total: number;
  };
};

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function buildFastTerrainPreview(input: FastTerrainPreviewInput): FastTerrainPreviewResult {
  const startedAt = now();
  const mode = input.mode ?? "water";
  const landmass = buildNoiseLandmassCore({
    seed: input.seed,
    cols: input.cols,
    rows: input.rows,
    settings: input.settings,
    includeRivers: false,
    previewMode: mode
  });
  const finishedAt = now();
  const total = finishedAt - startedAt;
  const totalTiles = input.cols * input.rows;
  const isNoisePreview = mode === "noise";
  const flatElevationMap = new Float32Array(totalTiles);
  const flatTileTypes = new Uint8Array(totalTiles);
  const emptyMask = new Uint8Array(totalTiles);
  const emptyDistance = new Uint16Array(totalTiles);
  const emptyCoastClass = new Uint8Array(totalTiles);
  const flatSeaLevelMap = new Float32Array(totalTiles);
  if (isNoisePreview) {
    flatTileTypes.fill(TILE_TYPE_IDS.grass);
    emptyCoastClass.fill(COAST_CLASS_NONE);
  }

  return {
    cols: input.cols,
    rows: input.rows,
    constraintCols: input.cols,
    constraintRows: input.rows,
    constraintMap: isNoisePreview ? landmass.rawNoiseMap : landmass.islandMask,
    elevationMap: isNoisePreview ? flatElevationMap : landmass.elevationFloatMap,
    tileTypes: isNoisePreview ? flatTileTypes : landmass.tileTypes,
    oceanMask: isNoisePreview ? emptyMask : landmass.oceanMask,
    seaLevelMap: isNoisePreview ? flatSeaLevelMap : landmass.seaLevelMap,
    coastDistance: isNoisePreview ? emptyDistance : landmass.coastDistance,
    coastClass: isNoisePreview ? emptyCoastClass : landmass.coastClass,
    riverMask: isNoisePreview ? emptyMask : landmass.riverMask,
    flowMap: landmass.flowMap,
    debugScalarField: isNoisePreview ? landmass.rawNoiseMap : undefined,
    timingsMs: {
      constraints: total * 0.18,
      elevation: mode === "water" ? total * 0.52 : total * 0.82,
      ocean: mode === "water" ? total * 0.3 : 0,
      rivers: 0,
      total
    }
  };
}
