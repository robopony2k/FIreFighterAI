export type TreeGroundingSurface = {
  cols: number;
  rows: number;
  heightScale: number;
  heightAtTileCoord: (tileX: number, tileY: number) => number;
  toRenderedWorldX: (tileX: number) => number;
  toRenderedWorldZ: (tileY: number) => number;
};

export type TreeGroundingPoint = {
  tileX: number;
  tileY: number;
  x: number;
  y: number;
  z: number;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const resolveTreeGrounding = (
  surface: TreeGroundingSurface,
  tileX: number,
  tileY: number
): TreeGroundingPoint => {
  const groundedTileX = clamp(tileX, 0, Math.max(0, surface.cols - 1));
  const groundedTileY = clamp(tileY, 0, Math.max(0, surface.rows - 1));
  return {
    tileX: groundedTileX,
    tileY: groundedTileY,
    x: surface.toRenderedWorldX(groundedTileX),
    y: surface.heightAtTileCoord(groundedTileX, groundedTileY) * surface.heightScale,
    z: surface.toRenderedWorldZ(groundedTileY)
  };
};
