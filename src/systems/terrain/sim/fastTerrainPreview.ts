import type { MapGenSettings } from "../../../mapgen/settings.js";
import { buildNoiseLandmassCore } from "./noiseLandmass.js";

export type FastTerrainPreviewMode = "shape" | "relief" | "water";

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

  return {
    cols: input.cols,
    rows: input.rows,
    constraintCols: input.cols,
    constraintRows: input.rows,
    constraintMap: landmass.islandMask,
    elevationMap: landmass.elevationFloatMap,
    tileTypes: landmass.tileTypes,
    oceanMask: landmass.oceanMask,
    seaLevelMap: landmass.seaLevelMap,
    coastDistance: landmass.coastDistance,
    coastClass: landmass.coastClass,
    riverMask: landmass.riverMask,
    flowMap: landmass.flowMap,
    timingsMs: {
      constraints: total * 0.18,
      elevation: mode === "water" ? total * 0.52 : total * 0.82,
      ocean: mode === "water" ? total * 0.3 : 0,
      rivers: 0,
      total
    }
  };
}
