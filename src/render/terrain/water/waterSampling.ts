export type RiverSpaceTransform = {
  worldToEdgeX: (worldX: number) => number;
  worldToEdgeY: (worldZ: number) => number;
  edgeToWorldX: (edgeX: number) => number;
  edgeToWorldY: (edgeY: number) => number;
  gridToEdgeX: (gridX: number) => number;
  gridToEdgeY: (gridY: number) => number;
  edgeToGridX: (edgeX: number) => number;
  edgeToGridY: (edgeY: number) => number;
};

export const createRiverSpaceTransform = (
  cols: number,
  rows: number,
  width: number,
  depth: number,
  sampleCols: number,
  sampleRows: number
): RiverSpaceTransform => {
  const safeCols = Math.max(1, cols);
  const safeRows = Math.max(1, rows);
  const safeWidth = Math.max(1e-5, width);
  const safeDepth = Math.max(1e-5, depth);
  const safeSampleCols = Math.max(1, sampleCols - 1);
  const safeSampleRows = Math.max(1, sampleRows - 1);
  return {
    worldToEdgeX: (worldX: number): number => (worldX / safeWidth + 0.5) * safeCols,
    worldToEdgeY: (worldZ: number): number => (worldZ / safeDepth + 0.5) * safeRows,
    edgeToWorldX: (edgeX: number): number => (edgeX / safeCols - 0.5) * safeWidth,
    edgeToWorldY: (edgeY: number): number => (edgeY / safeRows - 0.5) * safeDepth,
    gridToEdgeX: (gridX: number): number => (gridX / safeSampleCols) * safeCols,
    gridToEdgeY: (gridY: number): number => (gridY / safeSampleRows) * safeRows,
    edgeToGridX: (edgeX: number): number => (edgeX / safeCols) * safeSampleCols,
    edgeToGridY: (edgeY: number): number => (edgeY / safeRows) * safeSampleRows
  };
};

export const validateRiverSpaceTransform = (
  transform: RiverSpaceTransform,
  sampleCols: number,
  sampleRows: number
): { worldRoundTripMax: number; sampleRoundTripMax: number } => {
  let worldRoundTripMax = 0;
  let sampleRoundTripMax = 0;
  const samplePoints = [
    [0, 0],
    [sampleCols - 1, 0],
    [0, sampleRows - 1],
    [sampleCols - 1, sampleRows - 1],
    [(sampleCols - 1) * 0.5, (sampleRows - 1) * 0.5],
    [(sampleCols - 1) * 0.25, (sampleRows - 1) * 0.6],
    [(sampleCols - 1) * 0.73, (sampleRows - 1) * 0.19]
  ];
  for (let i = 0; i < samplePoints.length; i += 1) {
    const point = samplePoints[i];
    const gridX = point[0];
    const gridY = point[1];
    const edgeX = transform.gridToEdgeX(gridX);
    const edgeY = transform.gridToEdgeY(gridY);
    const worldX = transform.edgeToWorldX(edgeX);
    const worldY = transform.edgeToWorldY(edgeY);
    const edgeBackX = transform.worldToEdgeX(worldX);
    const edgeBackY = transform.worldToEdgeY(worldY);
    worldRoundTripMax = Math.max(worldRoundTripMax, Math.abs(edgeBackX - edgeX), Math.abs(edgeBackY - edgeY));
    const gridBackX = transform.edgeToGridX(edgeX);
    const gridBackY = transform.edgeToGridY(edgeY);
    sampleRoundTripMax = Math.max(sampleRoundTripMax, Math.abs(gridBackX - gridX), Math.abs(gridBackY - gridY));
  }
  return { worldRoundTripMax, sampleRoundTripMax };
};
