export type TerrainBridgeTileDebug = {
  idx: number;
  x: number;
  y: number;
};

export type TerrainBridgeBoundsDebug = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type TerrainBridgeComponentDebug = {
  componentIndex: number;
  componentTileCount: number;
  connectorCount: number;
  componentBounds: TerrainBridgeBoundsDebug;
  bridgeTiles: TerrainBridgeTileDebug[];
  connectors: Array<{
    bridge: TerrainBridgeTileDebug;
    road: TerrainBridgeTileDebug;
  }>;
};

export type TerrainBridgeAnchorDebug = {
  edgeX: number;
  edgeY: number;
  roadContactEdgeX: number;
  roadContactEdgeY: number;
  bankContactEdgeX: number;
  bankContactEdgeY: number;
  terrainY: number;
  roadY: number;
  waterY: number | null;
  baseY: number;
  searchDistance: number;
  fallback: boolean;
};

export type TerrainBridgeAbutmentDebug = {
  length: number;
  minHeight: number;
  maxHeight: number;
  suppressed: boolean;
};

export type TerrainBridgeSpanDebug = TerrainBridgeComponentDebug & {
  spanIndex: number;
  routeMode: "tile_path" | "single_tile_direct";
  bridgePath: TerrainBridgeTileDebug[];
  startRoad: TerrainBridgeTileDebug;
  endRoad: TerrainBridgeTileDebug;
  startAnchor: TerrainBridgeAnchorDebug;
  endAnchor: TerrainBridgeAnchorDebug;
  startAbutment: TerrainBridgeAbutmentDebug;
  endAbutment: TerrainBridgeAbutmentDebug;
  worldSpanLength: number;
  minDeckY: number;
  maxDeckY: number;
  minTerrainClearance: number;
  minWaterClearance: number | null;
};

export type TerrainBridgeDebug = {
  totalBridgeTiles: number;
  componentCount: number;
  renderedSpanCount: number;
  orphanComponentCount: number;
  spans: TerrainBridgeSpanDebug[];
  orphanComponents: TerrainBridgeComponentDebug[];
};
