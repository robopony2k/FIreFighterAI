export type TerrainRenderCoordinateMapper = {
  toRenderedWorldX: (tileX: number) => number;
  toRenderedWorldZ: (tileY: number) => number;
  renderedWorldToTileX: (worldX: number) => number;
  renderedWorldToTileY: (worldZ: number) => number;
};

export type TerrainRenderCoordinateMapperInput = {
  cols: number;
  rows: number;
  width: number;
  depth: number;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const tileCoordToWorld = (tileCoord: number, tileCount: number, worldSpan: number): number => {
  if (tileCount <= 1) {
    return 0;
  }
  return (tileCoord / (tileCount - 1) - 0.5) * worldSpan;
};

const worldToTileCoord = (worldCoord: number, tileCount: number, worldSpan: number): number => {
  if (tileCount <= 1 || Math.abs(worldSpan) <= 1e-5) {
    return 0;
  }
  return clamp((worldCoord / worldSpan + 0.5) * (tileCount - 1), 0, tileCount - 1);
};

export const createTerrainRenderCoordinateMapper = ({
  cols,
  rows,
  width,
  depth
}: TerrainRenderCoordinateMapperInput): TerrainRenderCoordinateMapper => {
  const safeCols = Math.max(1, cols);
  const safeRows = Math.max(1, rows);
  const safeWidth = Math.max(1e-5, width);
  const safeDepth = Math.max(1e-5, depth);
  return {
    toRenderedWorldX: (tileX: number): number => tileCoordToWorld(tileX, safeCols, safeWidth),
    toRenderedWorldZ: (tileY: number): number => tileCoordToWorld(tileY, safeRows, safeDepth),
    renderedWorldToTileX: (worldX: number): number => worldToTileCoord(worldX, safeCols, safeWidth),
    renderedWorldToTileY: (worldZ: number): number => worldToTileCoord(worldZ, safeRows, safeDepth)
  };
};
