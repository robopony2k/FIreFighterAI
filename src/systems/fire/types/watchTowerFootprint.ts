export const WATCH_TOWER_GRID_ROTATION_RADIANS = 0;
export const WATCH_TOWER_LEG_HALF_SPAN_TILES = 0.5;

export type WatchTowerFootprintPoint = { x: number; y: number };

export const getWatchTowerLegOffsets = (): readonly WatchTowerFootprintPoint[] => [
  { x: -WATCH_TOWER_LEG_HALF_SPAN_TILES, y: -WATCH_TOWER_LEG_HALF_SPAN_TILES },
  { x: WATCH_TOWER_LEG_HALF_SPAN_TILES, y: -WATCH_TOWER_LEG_HALF_SPAN_TILES },
  { x: WATCH_TOWER_LEG_HALF_SPAN_TILES, y: WATCH_TOWER_LEG_HALF_SPAN_TILES },
  { x: -WATCH_TOWER_LEG_HALF_SPAN_TILES, y: WATCH_TOWER_LEG_HALF_SPAN_TILES }
];

export const getWatchTowerFootprintSampleOffsets = (): readonly WatchTowerFootprintPoint[] => {
  const legs = getWatchTowerLegOffsets();
  return [
    { x: 0, y: 0 },
    ...legs,
    { x: 0, y: -WATCH_TOWER_LEG_HALF_SPAN_TILES },
    { x: WATCH_TOWER_LEG_HALF_SPAN_TILES, y: 0 },
    { x: 0, y: WATCH_TOWER_LEG_HALF_SPAN_TILES },
    { x: -WATCH_TOWER_LEG_HALF_SPAN_TILES, y: 0 }
  ];
};
