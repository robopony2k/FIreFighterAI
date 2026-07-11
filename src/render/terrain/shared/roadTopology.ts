export const ROAD_EDGE_N = 1 << 0;
export const ROAD_EDGE_E = 1 << 1;
export const ROAD_EDGE_S = 1 << 2;
export const ROAD_EDGE_W = 1 << 3;
export const ROAD_EDGE_NE = 1 << 4;
export const ROAD_EDGE_NW = 1 << 5;
export const ROAD_EDGE_SE = 1 << 6;
export const ROAD_EDGE_SW = 1 << 7;
export const ROAD_EDGE_CARDINAL_MASK = ROAD_EDGE_N | ROAD_EDGE_E | ROAD_EDGE_S | ROAD_EDGE_W;
export const ROAD_EDGE_DIAGONAL_MASK = ROAD_EDGE_NE | ROAD_EDGE_NW | ROAD_EDGE_SE | ROAD_EDGE_SW;

export type RoadEdgeDirection = {
  dx: number;
  dy: number;
  bit: number;
  diagonal: boolean;
};

export const ROAD_EDGE_DIRS: RoadEdgeDirection[] = [
  { dx: 0, dy: -1, bit: ROAD_EDGE_N, diagonal: false },
  { dx: 1, dy: 0, bit: ROAD_EDGE_E, diagonal: false },
  { dx: 0, dy: 1, bit: ROAD_EDGE_S, diagonal: false },
  { dx: -1, dy: 0, bit: ROAD_EDGE_W, diagonal: false },
  { dx: 1, dy: -1, bit: ROAD_EDGE_NE, diagonal: true },
  { dx: -1, dy: -1, bit: ROAD_EDGE_NW, diagonal: true },
  { dx: 1, dy: 1, bit: ROAD_EDGE_SE, diagonal: true },
  { dx: -1, dy: 1, bit: ROAD_EDGE_SW, diagonal: true }
];

export const resolveAuthoritativeRoadEdgeMask = (
  roadEdges: ArrayLike<number> | undefined,
  cols: number,
  rows: number,
  x: number,
  y: number,
  isRoadLike: (tileX: number, tileY: number) => boolean
): number | null => {
  const total = cols * rows;
  if (!roadEdges || roadEdges.length !== total || x < 0 || y < 0 || x >= cols || y >= rows) {
    return null;
  }
  const stored = roadEdges[y * cols + x] ?? 0;
  let sanitized = 0;
  for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
    const dir = ROAD_EDGE_DIRS[i]!;
    if ((stored & dir.bit) === 0) {
      continue;
    }
    const nx = x + dir.dx;
    const ny = y + dir.dy;
    if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && isRoadLike(nx, ny)) {
      sanitized |= dir.bit;
    }
  }
  return sanitized;
};
