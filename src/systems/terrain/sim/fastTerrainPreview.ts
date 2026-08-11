import { COAST_CLASS_NONE, TILE_TYPE_IDS } from "../../../core/state.js";
import type { MapGenSettings } from "../../../mapgen/settings.js";
import { buildNoiseLandmassCore } from "./noiseLandmass.js";

export type FastTerrainPreviewMode = "noise" | "uplift" | "shape" | "surface" | "water";

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
  archetypeUpliftMap: Float32Array;
  archetypeBasinMap: Float32Array;
  coastlineEnvelopeMap: Float32Array;
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

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp01((value - edge0) / Math.max(0.000001, edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const buildUpliftPresentation = (
  cols: number,
  rows: number,
  uplift: Float32Array,
  basin: Float32Array,
  coastlineEnvelope: Float32Array
): { elevations: Float32Array; scalarField: Float32Array } => {
  const elevations = new Float32Array(cols * rows);
  const scalarField = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y += 1) {
    const ny = rows <= 1 ? 0 : y / (rows - 1) * 2 - 1;
    for (let x = 0; x < cols; x += 1) {
      const nx = cols <= 1 ? 0 : x / (cols - 1) * 2 - 1;
      const idx = y * cols + x;
      const commonContext = 1 - smoothstep(0.7, 0.98, Math.hypot(nx, ny));
      const contextEnvelope = smoothstep(0.1, 0.58, coastlineEnvelope[idx] ?? 0);
      const upliftValue = uplift[idx] ?? 0;
      const basinValue = basin[idx] ?? 0;
      elevations[idx] = clamp01(
        0.28
        + commonContext * 0.012
        + commonContext * (upliftValue * 0.5 - basinValue * 0.15)
      );
      scalarField[idx] = clamp01(
        0.42
        + contextEnvelope * 0.08
        + contextEnvelope * (upliftValue * 0.48 - basinValue * 0.42)
      );
    }
  }
  return { elevations, scalarField };
};

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
  const isUpliftPreview = mode === "uplift";
  const upliftPresentation = isUpliftPreview
    ? buildUpliftPresentation(
        input.cols,
        input.rows,
        landmass.archetypeUpliftMap,
        landmass.archetypeBasinMap,
        landmass.coastlineEnvelopeMap
      )
    : null;
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
    elevationMap: isNoisePreview
      ? flatElevationMap
      : upliftPresentation?.elevations ?? landmass.elevationFloatMap,
    archetypeUpliftMap: isNoisePreview ? flatElevationMap : landmass.archetypeUpliftMap,
    archetypeBasinMap: isNoisePreview ? flatElevationMap : landmass.archetypeBasinMap,
    coastlineEnvelopeMap: isNoisePreview ? flatElevationMap : landmass.coastlineEnvelopeMap,
    tileTypes: isNoisePreview ? flatTileTypes : landmass.tileTypes,
    oceanMask: isNoisePreview ? emptyMask : landmass.oceanMask,
    seaLevelMap: isNoisePreview ? flatSeaLevelMap : landmass.seaLevelMap,
    coastDistance: isNoisePreview ? emptyDistance : landmass.coastDistance,
    coastClass: isNoisePreview ? emptyCoastClass : landmass.coastClass,
    riverMask: isNoisePreview ? emptyMask : landmass.riverMask,
    flowMap: landmass.flowMap,
    debugScalarField: isNoisePreview
      ? landmass.rawNoiseMap
      : upliftPresentation?.scalarField,
    timingsMs: {
      constraints: total * 0.18,
      elevation: mode === "water" ? total * 0.52 : total * 0.82,
      ocean: mode === "water" ? total * 0.3 : 0,
      rivers: 0,
      total
    }
  };
}
