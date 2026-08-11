const NEIGHBORS_4 = [
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 }
] as const;

export type LakeFootprintPromotionInput = {
  cols: number;
  rows: number;
  footprintTiles: readonly number[];
  basinTiles: readonly number[];
  elevationMap: ArrayLike<number>;
  oceanMask: Uint8Array;
  surfaceLevel: number;
  targetTiles: number;
  maximumShoreRaise: number;
  exclude?: Iterable<number>;
};

export type LakeFootprintTargetInput = {
  minimumTiles: number;
  maximumTiles: number;
  mapTileCount: number;
  riverIntensity: number;
  basinStrength: number;
  lakeChance: number;
  runoffScore: number;
  rainfallScore: number;
};

type ShoreCandidate = {
  index: number;
  shoreRaise: number;
};

const idxAt = (x: number, y: number, cols: number): number => y * cols + x;
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export const resolveLakeFootprintTarget = ({
  minimumTiles,
  maximumTiles,
  mapTileCount,
  riverIntensity,
  basinStrength,
  lakeChance,
  runoffScore,
  rainfallScore
}: LakeFootprintTargetInput): number => {
  const minimum = Math.max(1, Math.floor(minimumTiles));
  const maximum = Math.max(minimum, Math.floor(maximumTiles));
  const mapScale = Math.max(0.75, Math.min(4, Math.sqrt(Math.max(1, mapTileCount) / 4096)));
  const waterPressure = clamp01(
    clamp01(riverIntensity) * 0.58 + clamp01(basinStrength) * 0.27 + clamp01(lakeChance) * 0.15
  );
  const basinQuality = clamp01(clamp01(runoffScore) * 0.72 + clamp01(rainfallScore) * 0.28);
  const additionalTiles = Math.round(
    12 * mapScale * Math.pow(waterPressure, 1.15) * (0.55 + basinQuality * 0.6)
  );
  return Math.min(maximum, minimum + additionalTiles);
};

export const resolveLakeShoreRaiseLimit = (
  minLakeDepth: number,
  riverIntensity: number,
  basinStrength: number,
  runoffScore: number
): number => {
  const waterPressure = clamp01(clamp01(riverIntensity) * 0.7 + clamp01(basinStrength) * 0.3);
  const qualityScale = 0.82 + clamp01(runoffScore) * 0.36;
  return Math.max(0.0015, minLakeDepth * (0.65 + Math.pow(waterPressure, 1.1) * 1.75) * qualityScale);
};

/**
 * Broadens a credible depression toward its deterministic readable target.
 * Added tiles must be connected to the solved
 * footprint and close to its spill elevation, so this cannot manufacture a
 * lake away from an existing priority-flood basin.
 */
export const promoteLakeFootprint = ({
  cols,
  rows,
  footprintTiles,
  basinTiles,
  elevationMap,
  oceanMask,
  surfaceLevel,
  targetTiles,
  maximumShoreRaise,
  exclude
}: LakeFootprintPromotionInput): number[] => {
  const total = cols * rows;
  const targetSize = Math.max(0, Math.floor(targetTiles));
  const selected = new Uint8Array(total);
  const excluded = new Uint8Array(total);
  const result: number[] = [];

  if (exclude) {
    for (const index of exclude) {
      if (index >= 0 && index < total) {
        excluded[index] = 1;
      }
    }
  }

  const addInitial = (index: number): void => {
    if (
      index < 0 ||
      index >= total ||
      selected[index] > 0 ||
      excluded[index] > 0 ||
      oceanMask[index] > 0
    ) {
      return;
    }
    selected[index] = 1;
    result.push(index);
  };

  for (const index of footprintTiles) {
    addInitial(index);
  }
  if (result.length === 0) {
    for (const index of basinTiles) {
      const elevation = elevationMap[index] ?? surfaceLevel;
      if (elevation < surfaceLevel) {
        addInitial(index);
      }
    }
  }

  const maxRaise = Math.max(0, maximumShoreRaise);
  while (result.length > 0 && result.length < targetSize) {
    const frontier = new Map<number, ShoreCandidate>();
    for (const index of result) {
      const x = index % cols;
      const y = Math.floor(index / cols);
      for (const direction of NEIGHBORS_4) {
        const nx = x + direction.dx;
        const ny = y + direction.dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
          continue;
        }
        const neighbor = idxAt(nx, ny, cols);
        if (selected[neighbor] > 0 || excluded[neighbor] > 0 || oceanMask[neighbor] > 0) {
          continue;
        }
        const elevation = elevationMap[neighbor] ?? surfaceLevel;
        const shoreRaise = Math.max(0, elevation - surfaceLevel);
        if (shoreRaise <= maxRaise) {
          frontier.set(neighbor, { index: neighbor, shoreRaise });
        }
      }
    }
    const next = Array.from(frontier.values()).sort(
      (a, b) => a.shoreRaise - b.shoreRaise || a.index - b.index
    )[0];
    if (!next) {
      break;
    }
    selected[next.index] = 1;
    result.push(next.index);
  }

  return result.sort((a, b) => a - b);
};
