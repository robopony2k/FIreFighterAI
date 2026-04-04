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
