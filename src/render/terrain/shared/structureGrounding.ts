export type StructureGroundingSurface = {
  cols: number;
  rows: number;
  elevations: ArrayLike<number>;
};

export type StructureGrounding = {
  padMin: number;
  padMax: number;
  padHeight: number;
  terrainMin: number;
  terrainMax: number;
  foundationBottom: number;
  foundationTop: number;
};

export type StructureGroundingInput = {
  surface: StructureGroundingSurface;
  minTileX: number;
  maxTileX: number;
  minTileY: number;
  maxTileY: number;
  heightScale: number;
  heightAtTileCoord: (tileX: number, tileY: number) => number;
  foundationClearance?: number;
  maxPadLift?: number;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const tileIndex = (cols: number, x: number, y: number): number => y * cols + x;

const defaultMaxPadLift = (heightScale: number): number => Math.min(0.35, Math.max(0.12, heightScale * 0.012));

const readTileElevationWorld = (
  surface: StructureGroundingSurface,
  tileX: number,
  tileY: number,
  heightScale: number,
  heightAtTileCoord: (tileX: number, tileY: number) => number
): number => {
  const x = clamp(tileX, 0, surface.cols - 1);
  const y = clamp(tileY, 0, surface.rows - 1);
  const stored = surface.elevations[tileIndex(surface.cols, x, y)];
  if (Number.isFinite(stored)) {
    return stored * heightScale;
  }
  return heightAtTileCoord(x + 0.5, y + 0.5) * heightScale;
};

export const resolveStructureGrounding = (input: StructureGroundingInput): StructureGrounding => {
  const { surface, minTileX, maxTileX, minTileY, maxTileY, heightScale, heightAtTileCoord } = input;
  let padMin = Number.POSITIVE_INFINITY;
  let padMax = Number.NEGATIVE_INFINITY;

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const worldHeight = readTileElevationWorld(surface, tileX, tileY, heightScale, heightAtTileCoord);
      padMin = Math.min(padMin, worldHeight);
      padMax = Math.max(padMax, worldHeight);
    }
  }

  if (!Number.isFinite(padMin) || !Number.isFinite(padMax)) {
    const fallbackPad = heightAtTileCoord((minTileX + maxTileX + 1) * 0.5, (minTileY + maxTileY + 1) * 0.5) * heightScale;
    padMin = fallbackPad;
    padMax = fallbackPad;
  }

  let terrainMin = Number.POSITIVE_INFINITY;
  let terrainMax = Number.NEGATIVE_INFINITY;
  for (let tileY = minTileY; tileY <= maxTileY + 1; tileY += 1) {
    const clampedY = clamp(tileY, 0, surface.rows);
    for (let tileX = minTileX; tileX <= maxTileX + 1; tileX += 1) {
      const clampedX = clamp(tileX, 0, surface.cols);
      const worldHeight = heightAtTileCoord(clampedX, clampedY) * heightScale;
      terrainMin = Math.min(terrainMin, worldHeight);
      terrainMax = Math.max(terrainMax, worldHeight);
    }
  }

  if (!Number.isFinite(terrainMin) || !Number.isFinite(terrainMax)) {
    terrainMin = padMin;
    terrainMax = padMax;
  }

  const padHeight = padMax;
  const liftCap = input.maxPadLift ?? defaultMaxPadLift(heightScale);
  const foundationBottom = Math.min(terrainMin, padHeight);
  const foundationTop = padHeight + Math.min(Math.max(0, terrainMax - padHeight), liftCap) + (input.foundationClearance ?? 0.01);

  return {
    padMin,
    padMax,
    padHeight,
    terrainMin,
    terrainMax,
    foundationBottom,
    foundationTop
  };
};
