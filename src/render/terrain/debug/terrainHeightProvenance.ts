import { TILE_TYPE_IDS } from "../../../core/state.js";
import type { TerrainRenderSurface } from "../../threeTestTerrain.js";

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export type TerrainRenderHeightMode = "raw" | "final";

export type TerrainRenderDebugOptions = {
  enableHeightProvenance?: boolean;
  logHeightAnomalies?: boolean;
  terrainHeightMode?: TerrainRenderHeightMode;
  disableRiverWater?: boolean;
  disableRiverCutout?: boolean;
  disableBridges?: boolean;
  anomalyLogLimit?: number;
};

export type TerrainHeightContributor = {
  x: number;
  y: number;
  elevation: number;
  typeId: number | null;
  riverMask: number;
  oceanMask: number;
  seaLevel: number | null;
};

export type TerrainHeightNeighborhoodCell = TerrainHeightContributor;

export type TerrainHeightVertexProvenance = {
  label: "nw" | "ne" | "sw" | "se";
  sampleX: number;
  sampleY: number;
  rawHeight: number;
  finalHeight: number;
  displayedHeight: number;
  sampleTypeId: number | null;
  waterRatio: number;
  oceanRatio: number;
  riverRatio: number;
  waterSupport: number;
  coastClass: number;
  coastDistance: number;
  contributorWaterCount: number;
  contributorRiverCount: number;
  contributorOceanCount: number;
  maxContributorElevation: number;
  contributors: TerrainHeightContributor[];
};

export type TerrainHeightInterpolation = {
  tileCoordX: number;
  tileCoordY: number;
  sampleCoordX: number;
  sampleCoordY: number;
  tx: number;
  ty: number;
  rawHeight: number;
  finalHeight: number;
  displayedHeight: number;
};

export type TerrainHeightProvenance = {
  tileX: number;
  tileY: number;
  step: number;
  authoritativeElevation: number;
  rawCenterHeight: number;
  finalCenterHeight: number;
  displayedCenterHeight: number;
  riverMask: number;
  oceanMask: number;
  seaLevel: number | null;
  vertices: TerrainHeightVertexProvenance[];
  neighborhood: TerrainHeightNeighborhoodCell[];
  interpolation: TerrainHeightInterpolation;
};

export type TerrainHeightAnomalyStage =
  | "raw_vertex_synthesis"
  | "final_terrain_mutation"
  | "terrain_interpolation";

export type TerrainHeightAnomaly = {
  stage: TerrainHeightAnomalyStage;
  sampleX: number;
  sampleY: number;
  tileX: number;
  tileY: number;
  value: number;
  baseline: number;
  delta: number;
  sampleTypeId: number | null;
  waterSupport: number;
  riverRatio: number;
  oceanRatio: number;
  contributorMaxElevation?: number;
};

const getHeightAtSample = (
  heights: Float32Array,
  sampleCols: number,
  sampleRows: number,
  x: number,
  y: number
): number => {
  const clampedX = Math.max(0, Math.min(sampleCols - 1, x));
  const clampedY = Math.max(0, Math.min(sampleRows - 1, y));
  return heights[clampedY * sampleCols + clampedX] ?? 0;
};

const bilinearHeightAtTileCoord = (
  heights: Float32Array,
  sampleCols: number,
  sampleRows: number,
  step: number,
  tileX: number,
  tileY: number
): number => {
  const sx = clamp(tileX / step, 0, sampleCols - 1);
  const sy = clamp(tileY / step, 0, sampleRows - 1);
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(sampleCols - 1, x0 + 1);
  const y1 = Math.min(sampleRows - 1, y0 + 1);
  const tx = sx - x0;
  const ty = sy - y0;
  const h00 = getHeightAtSample(heights, sampleCols, sampleRows, x0, y0);
  const h10 = getHeightAtSample(heights, sampleCols, sampleRows, x1, y0);
  const h01 = getHeightAtSample(heights, sampleCols, sampleRows, x0, y1);
  const h11 = getHeightAtSample(heights, sampleCols, sampleRows, x1, y1);
  const hx0 = h00 * (1 - tx) + h10 * tx;
  const hx1 = h01 * (1 - tx) + h11 * tx;
  return hx0 * (1 - ty) + hx1 * ty;
};

const collectVertexContributors = (
  surface: TerrainRenderSurface,
  sampleX: number,
  sampleY: number
): TerrainHeightContributor[] => {
  const { cols, rows, step, sample } = surface;
  if (sampleX < 0 || sampleY < 0 || sampleX >= surface.sampleCols || sampleY >= surface.sampleRows) {
    return [];
  }
  if (step <= 1) {
    const minX = Math.max(0, sampleX - 1);
    const maxX = Math.min(cols - 1, sampleX);
    const minY = Math.max(0, sampleY - 1);
    const maxY = Math.min(rows - 1, sampleY);
    const contributors: TerrainHeightContributor[] = [];
    for (let y = minY; y <= maxY; y += 1) {
      const rowBase = y * cols;
      for (let x = minX; x <= maxX; x += 1) {
        const idx = rowBase + x;
        contributors.push({
          x,
          y,
          elevation: sample.elevations[idx] ?? 0,
          typeId: sample.tileTypes?.[idx] ?? null,
          riverMask: sample.riverMask?.[idx] ?? 0,
          oceanMask: sample.oceanMask?.[idx] ?? 0,
          seaLevel: sample.seaLevel?.[idx] ?? null
        });
      }
    }
    return contributors;
  }
  const tileX = Math.min(cols - 1, sampleX * step);
  const tileY = Math.min(rows - 1, sampleY * step);
  const endX = Math.min(cols, tileX + step);
  const endY = Math.min(rows, tileY + step);
  const contributors: TerrainHeightContributor[] = [];
  for (let y = tileY; y < endY; y += 1) {
    const rowBase = y * cols;
    for (let x = tileX; x < endX; x += 1) {
      const idx = rowBase + x;
      contributors.push({
        x,
        y,
        elevation: sample.elevations[idx] ?? 0,
        typeId: sample.tileTypes?.[idx] ?? null,
        riverMask: sample.riverMask?.[idx] ?? 0,
        oceanMask: sample.oceanMask?.[idx] ?? 0,
        seaLevel: sample.seaLevel?.[idx] ?? null
      });
    }
  }
  return contributors;
};

const buildVertexProvenance = (
  surface: TerrainRenderSurface,
  sampleX: number,
  sampleY: number,
  label: TerrainHeightVertexProvenance["label"]
): TerrainHeightVertexProvenance => {
  const rawHeights = surface.rawSampleHeights ?? surface.sampleHeights;
  const finalHeights = surface.finalSampleHeights ?? surface.sampleHeights;
  const idx = clamp(sampleY, 0, surface.sampleRows - 1) * surface.sampleCols + clamp(sampleX, 0, surface.sampleCols - 1);
  const contributors = collectVertexContributors(surface, sampleX, sampleY);
  let contributorWaterCount = 0;
  let contributorRiverCount = 0;
  let contributorOceanCount = 0;
  let maxContributorElevation = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < contributors.length; i += 1) {
    const contributor = contributors[i]!;
    if ((contributor.typeId ?? -1) === TILE_TYPE_IDS.water) {
      contributorWaterCount += 1;
    }
    if (contributor.riverMask > 0) {
      contributorRiverCount += 1;
    }
    if (contributor.oceanMask > 0) {
      contributorOceanCount += 1;
    }
    if (contributor.elevation > maxContributorElevation) {
      maxContributorElevation = contributor.elevation;
    }
  }
  if (!Number.isFinite(maxContributorElevation)) {
    maxContributorElevation = 0;
  }
  return {
    label,
    sampleX,
    sampleY,
    rawHeight: getHeightAtSample(rawHeights, surface.sampleCols, surface.sampleRows, sampleX, sampleY),
    finalHeight: getHeightAtSample(finalHeights, surface.sampleCols, surface.sampleRows, sampleX, sampleY),
    displayedHeight: getHeightAtSample(surface.sampleHeights, surface.sampleCols, surface.sampleRows, sampleX, sampleY),
    sampleTypeId: surface.sampleTypes[idx] ?? null,
    waterRatio: surface.waterRatios.water[idx] ?? 0,
    oceanRatio: surface.waterRatios.ocean[idx] ?? 0,
    riverRatio: surface.waterRatios.river[idx] ?? 0,
    waterSupport: surface.waterSupportMask[idx] ?? 0,
    coastClass: surface.sampleCoastClass?.[idx] ?? 0,
    coastDistance: surface.sampleCoastDistance?.[idx] ?? 0,
    contributorWaterCount,
    contributorRiverCount,
    contributorOceanCount,
    maxContributorElevation,
    contributors
  };
};

const buildNeighborhood = (
  surface: TerrainRenderSurface,
  tileX: number,
  tileY: number
): TerrainHeightNeighborhoodCell[] => {
  const cells: TerrainHeightNeighborhoodCell[] = [];
  const { cols, rows, sample } = surface;
  for (let oy = -1; oy <= 1; oy += 1) {
    const y = tileY + oy;
    if (y < 0 || y >= rows) {
      continue;
    }
    const rowBase = y * cols;
    for (let ox = -1; ox <= 1; ox += 1) {
      const x = tileX + ox;
      if (x < 0 || x >= cols) {
        continue;
      }
      const idx = rowBase + x;
      cells.push({
        x,
        y,
        elevation: sample.elevations[idx] ?? 0,
        typeId: sample.tileTypes?.[idx] ?? null,
        riverMask: sample.riverMask?.[idx] ?? 0,
        oceanMask: sample.oceanMask?.[idx] ?? 0,
        seaLevel: sample.seaLevel?.[idx] ?? null
      });
    }
  }
  return cells;
};

export const buildTerrainHeightProvenance = (
  surface: TerrainRenderSurface,
  tileX: number,
  tileY: number
): TerrainHeightProvenance | null => {
  if (tileX < 0 || tileY < 0 || tileX >= surface.cols || tileY >= surface.rows) {
    return null;
  }
  const rawHeights = surface.rawSampleHeights ?? surface.sampleHeights;
  const finalHeights = surface.finalSampleHeights ?? surface.sampleHeights;
  const centerTileCoordX = tileX + 0.5;
  const centerTileCoordY = tileY + 0.5;
  const sx = clamp(centerTileCoordX / surface.step, 0, surface.sampleCols - 1);
  const sy = clamp(centerTileCoordY / surface.step, 0, surface.sampleRows - 1);
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(surface.sampleCols - 1, x0 + 1);
  const y1 = Math.min(surface.sampleRows - 1, y0 + 1);
  const idx = tileY * surface.cols + tileX;
  return {
    tileX,
    tileY,
    step: surface.step,
    authoritativeElevation: surface.sample.elevations[idx] ?? 0,
    rawCenterHeight: bilinearHeightAtTileCoord(rawHeights, surface.sampleCols, surface.sampleRows, surface.step, centerTileCoordX, centerTileCoordY),
    finalCenterHeight: bilinearHeightAtTileCoord(finalHeights, surface.sampleCols, surface.sampleRows, surface.step, centerTileCoordX, centerTileCoordY),
    displayedCenterHeight: surface.heightAtTile(tileX, tileY),
    riverMask: surface.sample.riverMask?.[idx] ?? 0,
    oceanMask: surface.sample.oceanMask?.[idx] ?? 0,
    seaLevel: surface.sample.seaLevel?.[idx] ?? null,
    vertices: [
      buildVertexProvenance(surface, x0, y0, "nw"),
      buildVertexProvenance(surface, x1, y0, "ne"),
      buildVertexProvenance(surface, x0, y1, "sw"),
      buildVertexProvenance(surface, x1, y1, "se")
    ],
    neighborhood: buildNeighborhood(surface, tileX, tileY),
    interpolation: {
      tileCoordX: centerTileCoordX,
      tileCoordY: centerTileCoordY,
      sampleCoordX: sx,
      sampleCoordY: sy,
      tx: sx - x0,
      ty: sy - y0,
      rawHeight: bilinearHeightAtTileCoord(rawHeights, surface.sampleCols, surface.sampleRows, surface.step, centerTileCoordX, centerTileCoordY),
      finalHeight: bilinearHeightAtTileCoord(finalHeights, surface.sampleCols, surface.sampleRows, surface.step, centerTileCoordX, centerTileCoordY),
      displayedHeight: surface.heightAtTile(tileX, tileY)
    }
  };
};

export const collectTerrainHeightAnomalies = (
  surface: TerrainRenderSurface,
  limit = 5
): TerrainHeightAnomaly[] => {
  const rawHeights = surface.rawSampleHeights ?? surface.sampleHeights;
  const finalHeights = surface.finalSampleHeights ?? surface.sampleHeights;
  const anomalies: TerrainHeightAnomaly[] = [];
  for (let sampleY = 0; sampleY < surface.sampleRows; sampleY += 1) {
    for (let sampleX = 0; sampleX < surface.sampleCols; sampleX += 1) {
      const vertex = buildVertexProvenance(surface, sampleX, sampleY, "nw");
      if (vertex.rawHeight > vertex.maxContributorElevation + 0.002) {
        anomalies.push({
          stage: "raw_vertex_synthesis",
          sampleX,
          sampleY,
          tileX: Math.max(0, Math.min(surface.cols - 1, sampleX)),
          tileY: Math.max(0, Math.min(surface.rows - 1, sampleY)),
          value: vertex.rawHeight,
          baseline: vertex.maxContributorElevation,
          delta: vertex.rawHeight - vertex.maxContributorElevation,
          sampleTypeId: vertex.sampleTypeId,
          waterSupport: vertex.waterSupport,
          riverRatio: vertex.riverRatio,
          oceanRatio: vertex.oceanRatio,
          contributorMaxElevation: vertex.maxContributorElevation
        });
        continue;
      }
      if (vertex.finalHeight > vertex.rawHeight + 0.002) {
        anomalies.push({
          stage: "final_terrain_mutation",
          sampleX,
          sampleY,
          tileX: Math.max(0, Math.min(surface.cols - 1, sampleX)),
          tileY: Math.max(0, Math.min(surface.rows - 1, sampleY)),
          value: vertex.finalHeight,
          baseline: vertex.rawHeight,
          delta: vertex.finalHeight - vertex.rawHeight,
          sampleTypeId: vertex.sampleTypeId,
          waterSupport: vertex.waterSupport,
          riverRatio: vertex.riverRatio,
          oceanRatio: vertex.oceanRatio,
          contributorMaxElevation: vertex.maxContributorElevation
        });
      }
    }
  }

  for (let tileY = 0; tileY < surface.rows; tileY += 1) {
    const rowBase = tileY * surface.cols;
    for (let tileX = 0; tileX < surface.cols; tileX += 1) {
      const idx = rowBase + tileX;
      if ((surface.sample.riverMask?.[idx] ?? 0) > 0 || (surface.sample.oceanMask?.[idx] ?? 0) > 0) {
        continue;
      }
      const authoritative = surface.sample.elevations[idx] ?? 0;
      const finalCenter = bilinearHeightAtTileCoord(finalHeights, surface.sampleCols, surface.sampleRows, surface.step, tileX + 0.5, tileY + 0.5);
      const delta = Math.abs(finalCenter - authoritative);
      if (delta <= 0.004) {
        continue;
      }
      const sampleX = Math.max(0, Math.min(surface.sampleCols - 1, Math.floor((tileX + 0.5) / surface.step)));
      const sampleY = Math.max(0, Math.min(surface.sampleRows - 1, Math.floor((tileY + 0.5) / surface.step)));
      anomalies.push({
        stage: "terrain_interpolation",
        sampleX,
        sampleY,
        tileX,
        tileY,
        value: finalCenter,
        baseline: authoritative,
        delta,
        sampleTypeId: surface.sample.tileTypes?.[idx] ?? null,
        waterSupport: surface.waterSupportMask[sampleY * surface.sampleCols + sampleX] ?? 0,
        riverRatio: surface.waterRatios.river[sampleY * surface.sampleCols + sampleX] ?? 0,
        oceanRatio: surface.waterRatios.ocean[sampleY * surface.sampleCols + sampleX] ?? 0
      });
    }
  }

  anomalies.sort((left, right) => right.delta - left.delta);
  return anomalies.slice(0, Math.max(0, limit));
};
