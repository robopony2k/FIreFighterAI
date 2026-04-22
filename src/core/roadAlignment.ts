const ROAD_EDGE_N = 1 << 0;
const ROAD_EDGE_E = 1 << 1;
const ROAD_EDGE_S = 1 << 2;
const ROAD_EDGE_W = 1 << 3;
const ROAD_EDGE_NE = 1 << 4;
const ROAD_EDGE_NW = 1 << 5;
const ROAD_EDGE_SE = 1 << 6;
const ROAD_EDGE_SW = 1 << 7;

const noiseAt = (value: number): number => {
  const s = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};

const countBits = (mask: number): number => {
  let count = 0;
  for (let bits = mask; bits !== 0; bits &= bits - 1) {
    count += 1;
  }
  return count;
};

const EAST_WEST_FRONTAGE = [
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 }
] as const;
const NORTH_SOUTH_FRONTAGE = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 }
] as const;
const NE_SW_FRONTAGE = [
  { dx: -1, dy: -1 },
  { dx: 1, dy: 1 }
] as const;
const NW_SE_FRONTAGE = [
  { dx: 1, dy: -1 },
  { dx: -1, dy: 1 }
] as const;

type RoadAxisDescriptor = {
  count: number;
  frontage: readonly GridOffset[];
  rotation: number;
};

const describeRoadAxes = (mask: number): RoadAxisDescriptor[] =>
  [
    {
      count: Number((mask & ROAD_EDGE_E) > 0) + Number((mask & ROAD_EDGE_W) > 0),
      frontage: EAST_WEST_FRONTAGE,
      rotation: 0
    },
    {
      count: Number((mask & ROAD_EDGE_N) > 0) + Number((mask & ROAD_EDGE_S) > 0),
      frontage: NORTH_SOUTH_FRONTAGE,
      rotation: Math.PI * 0.5
    },
    {
      count: Number((mask & ROAD_EDGE_NE) > 0) + Number((mask & ROAD_EDGE_SW) > 0),
      frontage: NE_SW_FRONTAGE,
      rotation: -Math.PI * 0.25
    },
    {
      count: Number((mask & ROAD_EDGE_NW) > 0) + Number((mask & ROAD_EDGE_SE) > 0),
      frontage: NW_SE_FRONTAGE,
      rotation: Math.PI * 0.25
    }
  ].filter((descriptor) => descriptor.count > 0);

const pushUniqueOffset = (target: GridOffset[], offset: GridOffset): void => {
  if (target.some((existing) => existing.dx === offset.dx && existing.dy === offset.dy)) {
    return;
  }
  target.push(offset);
};

export type GridOffset = {
  dx: number;
  dy: number;
};

export type PlotRoadReference = {
  roadX: number;
  roadY: number;
  roadMask: number;
  offsetX: number;
  offsetY: number;
  matchesFrontage: boolean;
};

export const getRoadConnectionOffsets = (mask: number): GridOffset[] => {
  const offsets: GridOffset[] = [];
  if ((mask & ROAD_EDGE_N) > 0) {
    offsets.push({ dx: 0, dy: -1 });
  }
  if ((mask & ROAD_EDGE_E) > 0) {
    offsets.push({ dx: 1, dy: 0 });
  }
  if ((mask & ROAD_EDGE_S) > 0) {
    offsets.push({ dx: 0, dy: 1 });
  }
  if ((mask & ROAD_EDGE_W) > 0) {
    offsets.push({ dx: -1, dy: 0 });
  }
  if ((mask & ROAD_EDGE_NE) > 0) {
    offsets.push({ dx: 1, dy: -1 });
  }
  if ((mask & ROAD_EDGE_NW) > 0) {
    offsets.push({ dx: -1, dy: -1 });
  }
  if ((mask & ROAD_EDGE_SE) > 0) {
    offsets.push({ dx: 1, dy: 1 });
  }
  if ((mask & ROAD_EDGE_SW) > 0) {
    offsets.push({ dx: -1, dy: 1 });
  }
  return offsets;
};

export const getRoadFrontageOffsets = (mask: number): GridOffset[] => {
  const axes = describeRoadAxes(mask);
  if (axes.length <= 0) {
    return [...EAST_WEST_FRONTAGE, ...NORTH_SOUTH_FRONTAGE];
  }
  const strongestCount = axes.reduce((best, axis) => Math.max(best, axis.count), 0);
  const offsets: GridOffset[] = [];
  for (let i = 0; i < axes.length; i += 1) {
    const axis = axes[i]!;
    if (axis.count === strongestCount) {
      for (let j = 0; j < axis.frontage.length; j += 1) {
        pushUniqueOffset(offsets, axis.frontage[j]!);
      }
    }
  }
  for (let i = 0; i < axes.length; i += 1) {
    const axis = axes[i]!;
    if (axis.count >= strongestCount) {
      continue;
    }
    for (let j = 0; j < axis.frontage.length; j += 1) {
      pushUniqueOffset(offsets, axis.frontage[j]!);
    }
  }
  const hasOnlyDiagonalAxes = axes.every((axis) => axis.frontage === NE_SW_FRONTAGE || axis.frontage === NW_SE_FRONTAGE);
  if (hasOnlyDiagonalAxes) {
    for (let i = 0; i < EAST_WEST_FRONTAGE.length; i += 1) {
      pushUniqueOffset(offsets, EAST_WEST_FRONTAGE[i]!);
    }
    for (let i = 0; i < NORTH_SOUTH_FRONTAGE.length; i += 1) {
      pushUniqueOffset(offsets, NORTH_SOUTH_FRONTAGE[i]!);
    }
  }
  return offsets.length > 0 ? offsets : [...EAST_WEST_FRONTAGE, ...NORTH_SOUTH_FRONTAGE];
};

export const pickHouseRotationFromRoadMask = (mask: number, seed: number): number => {
  const axes = describeRoadAxes(mask);
  if (axes.length <= 0) {
    return noiseAt(seed + 9.1) < 0.5 ? 0 : Math.PI * 0.5;
  }
  const strongestCount = axes.reduce((best, axis) => Math.max(best, axis.count), 0);
  const contenders = axes.filter((axis) => axis.count === strongestCount);
  const choiceIndex =
    contenders.length <= 1 ? 0 : Math.floor(noiseAt(seed + 17.3) * contenders.length) % contenders.length;
  const chosen = contenders[choiceIndex] ?? contenders[0]!;
  const flip = noiseAt(seed + 21.4) < 0.5 ? 0 : Math.PI;
  return chosen.rotation + flip;
};

export const findBestRoadReferenceForPlot = (
  tileX: number,
  tileY: number,
  isStreetAt: (x: number, y: number) => boolean,
  getRoadMaskAt: (x: number, y: number) => number
): PlotRoadReference | null => {
  let best: PlotRoadReference | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let roadY = tileY - 1; roadY <= tileY + 1; roadY += 1) {
    for (let roadX = tileX - 1; roadX <= tileX + 1; roadX += 1) {
      if (roadX === tileX && roadY === tileY) {
        continue;
      }
      if (!isStreetAt(roadX, roadY)) {
        continue;
      }
      const roadMask = getRoadMaskAt(roadX, roadY);
      const offsetX = tileX - roadX;
      const offsetY = tileY - roadY;
      const matchesFrontage = getRoadFrontageOffsets(roadMask).some(
        (offset) => offset.dx === offsetX && offset.dy === offsetY
      );
      const manhattan = Math.abs(offsetX) + Math.abs(offsetY);
      const score =
        (matchesFrontage ? 0 : 10) +
        manhattan * 2 -
        Math.min(2, Math.max(0, countBits(roadMask))) * 0.2;
      if (
        score < bestScore ||
        (score === bestScore &&
          best &&
          (roadY < best.roadY || (roadY === best.roadY && roadX < best.roadX)))
      ) {
        bestScore = score;
        best = {
          roadX,
          roadY,
          roadMask,
          offsetX,
          offsetY,
          matchesFrontage
        };
      }
      if (!best) {
        best = {
          roadX,
          roadY,
          roadMask,
          offsetX,
          offsetY,
          matchesFrontage
        };
      }
    }
  }
  return best;
};
