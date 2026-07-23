export type InlandWaterTerrainCutoutVertex = {
  edgeX: number;
  edgeY: number;
  worldX: number;
  worldY: number;
  worldZ: number;
  u: number;
  v: number;
  sourceTerrainTriangleId: number;
};

export type InlandWaterTerrainCutoutPolygon = {
  vertices: InlandWaterTerrainCutoutVertex[];
  sourceTerrainTriangleId: number;
};

export type InlandWaterContourSegment = {
  id: number;
  sourceA: number;
  sourceB: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  waterwardX: number;
  waterwardY: number;
};

export type InlandWaterTerrainCutoutDomain = {
  contourVertices: ArrayLike<number>;
  contourIndices: ArrayLike<number>;
  boundarySegments: InlandWaterContourSegment[];
  triangleBuckets: Map<number, number[]>;
  bucketCols: number;
  bucketRows: number;
};

const EPSILON = 1e-7;

const cross = (ax: number, ay: number, bx: number, by: number): number => ax * by - ay * bx;

const signedArea = (vertices: readonly InlandWaterTerrainCutoutVertex[]): number => {
  let area = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const a = vertices[index];
    const b = vertices[(index + 1) % vertices.length];
    area += a.edgeX * b.edgeY - b.edgeX * a.edgeY;
  }
  return area * 0.5;
};

const interpolateVertex = (
  a: InlandWaterTerrainCutoutVertex,
  b: InlandWaterTerrainCutoutVertex,
  t: number
): InlandWaterTerrainCutoutVertex => ({
  edgeX: a.edgeX + (b.edgeX - a.edgeX) * t,
  edgeY: a.edgeY + (b.edgeY - a.edgeY) * t,
  worldX: a.worldX + (b.worldX - a.worldX) * t,
  worldY: a.worldY + (b.worldY - a.worldY) * t,
  worldZ: a.worldZ + (b.worldZ - a.worldZ) * t,
  u: a.u + (b.u - a.u) * t,
  v: a.v + (b.v - a.v) * t,
  sourceTerrainTriangleId: a.sourceTerrainTriangleId
});

const cleanPolygon = (
  polygon: InlandWaterTerrainCutoutVertex[]
): InlandWaterTerrainCutoutVertex[] => {
  const deduped = polygon.filter((vertex, index) => {
    if (index === 0) return true;
    const previous = polygon[index - 1];
    return Math.hypot(vertex.edgeX - previous.edgeX, vertex.edgeY - previous.edgeY) > EPSILON;
  });
  if (
    deduped.length > 1 &&
    Math.hypot(
      deduped[0].edgeX - deduped[deduped.length - 1].edgeX,
      deduped[0].edgeY - deduped[deduped.length - 1].edgeY
    ) <= EPSILON
  ) {
    deduped.pop();
  }
  return deduped.length >= 3 && Math.abs(signedArea(deduped)) > EPSILON * EPSILON ? deduped : [];
};

const splitPolygonByLine = (
  polygon: readonly InlandWaterTerrainCutoutVertex[],
  ax: number,
  ay: number,
  bx: number,
  by: number
): { inside: InlandWaterTerrainCutoutVertex[]; outside: InlandWaterTerrainCutoutVertex[] } => {
  const inside: InlandWaterTerrainCutoutVertex[] = [];
  const outside: InlandWaterTerrainCutoutVertex[] = [];
  const dx = bx - ax;
  const dy = by - ay;
  let previous = polygon[polygon.length - 1];
  let previousDistance = cross(dx, dy, previous.edgeX - ax, previous.edgeY - ay);
  for (const current of polygon) {
    const currentDistance = cross(dx, dy, current.edgeX - ax, current.edgeY - ay);
    const previousInside = previousDistance >= -EPSILON;
    const currentInside = currentDistance >= -EPSILON;
    if (previousInside !== currentInside) {
      const denominator = previousDistance - currentDistance;
      const t = Math.abs(denominator) > EPSILON
        ? Math.min(1, Math.max(0, previousDistance / denominator))
        : 0.5;
      const intersection = interpolateVertex(previous, current, t);
      inside.push(intersection);
      outside.push(intersection);
    }
    (currentInside ? inside : outside).push(current);
    previous = current;
    previousDistance = currentDistance;
  }
  return { inside: cleanPolygon(inside), outside: cleanPolygon(outside) };
};

const subtractWaterTriangle = (
  subject: readonly InlandWaterTerrainCutoutVertex[],
  triangle: readonly [number, number, number, number, number, number]
): InlandWaterTerrainCutoutVertex[][] => {
  const area = cross(
    triangle[2] - triangle[0],
    triangle[3] - triangle[1],
    triangle[4] - triangle[0],
    triangle[5] - triangle[1]
  );
  const oriented = area >= 0
    ? triangle
    : [triangle[0], triangle[1], triangle[4], triangle[5], triangle[2], triangle[3]] as const;
  let remaining = cleanPolygon(Array.from(subject));
  const retained: InlandWaterTerrainCutoutVertex[][] = [];
  for (let edge = 0; edge < 3 && remaining.length >= 3; edge += 1) {
    const aOffset = edge * 2;
    const bOffset = ((edge + 1) % 3) * 2;
    const split = splitPolygonByLine(
      remaining,
      oriented[aOffset],
      oriented[aOffset + 1],
      oriented[bOffset],
      oriented[bOffset + 1]
    );
    if (split.outside.length >= 3) retained.push(split.outside);
    remaining = split.inside;
  }
  return retained;
};

const edgeKey = (a: number, b: number): string => a < b ? `${a}|${b}` : `${b}|${a}`;

export const buildInlandWaterTerrainCutoutDomain = (input: {
  contourVertices: ArrayLike<number>;
  contourIndices: ArrayLike<number>;
  cols: number;
  rows: number;
}): InlandWaterTerrainCutoutDomain => {
  const edgeUse = new Map<string, { count: number; a: number; b: number; opposite: number }>();
  const triangleBuckets = new Map<number, number[]>();
  const bucketCols = Math.max(1, Math.ceil(input.cols));
  const bucketRows = Math.max(1, Math.ceil(input.rows));
  const addBucket = (x: number, y: number, triangleId: number): void => {
    const key = y * bucketCols + x;
    const bucket = triangleBuckets.get(key) ?? [];
    bucket.push(triangleId);
    triangleBuckets.set(key, bucket);
  };
  for (let index = 0; index + 2 < input.contourIndices.length; index += 3) {
    const triangleId = Math.floor(index / 3);
    const ia = input.contourIndices[index] as number;
    const ib = input.contourIndices[index + 1] as number;
    const ic = input.contourIndices[index + 2] as number;
    for (const [a, b, opposite] of [[ia, ib, ic], [ib, ic, ia], [ic, ia, ib]] as const) {
      const key = edgeKey(a, b);
      const existing = edgeUse.get(key);
      if (existing) existing.count += 1;
      else edgeUse.set(key, { count: 1, a, b, opposite });
    }
    const ax = input.contourVertices[ia * 2] as number;
    const ay = input.contourVertices[ia * 2 + 1] as number;
    const bx = input.contourVertices[ib * 2] as number;
    const by = input.contourVertices[ib * 2 + 1] as number;
    const cx = input.contourVertices[ic * 2] as number;
    const cy = input.contourVertices[ic * 2 + 1] as number;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx) - EPSILON));
    const maxX = Math.min(bucketCols - 1, Math.floor(Math.max(ax, bx, cx) + EPSILON));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy) - EPSILON));
    const maxY = Math.min(bucketRows - 1, Math.floor(Math.max(ay, by, cy) + EPSILON));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) addBucket(x, y, triangleId);
    }
  }
  const boundarySegments: InlandWaterContourSegment[] = [];
  edgeUse.forEach((edge) => {
    if (edge.count !== 1) return;
    const ax = input.contourVertices[edge.a * 2] as number;
    const ay = input.contourVertices[edge.a * 2 + 1] as number;
    const bx = input.contourVertices[edge.b * 2] as number;
    const by = input.contourVertices[edge.b * 2 + 1] as number;
    const oppositeX = input.contourVertices[edge.opposite * 2] as number;
    const oppositeY = input.contourVertices[edge.opposite * 2 + 1] as number;
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);
    const interiorOnLeft = cross(dx, dy, oppositeX - ax, oppositeY - ay) >= 0;
    boundarySegments.push({
      id: boundarySegments.length,
      sourceA: edge.a,
      sourceB: edge.b,
      ax,
      ay,
      bx,
      by,
      waterwardX: length > EPSILON ? (interiorOnLeft ? -dy : dy) / length : 0,
      waterwardY: length > EPSILON ? (interiorOnLeft ? dx : -dx) / length : 0
    });
  });
  return {
    contourVertices: input.contourVertices,
    contourIndices: input.contourIndices,
    boundarySegments,
    triangleBuckets,
    bucketCols,
    bucketRows
  };
};

export const cutTerrainTriangleAgainstInlandWater = (
  domain: InlandWaterTerrainCutoutDomain,
  triangle: readonly [
    InlandWaterTerrainCutoutVertex,
    InlandWaterTerrainCutoutVertex,
    InlandWaterTerrainCutoutVertex
  ]
): InlandWaterTerrainCutoutPolygon[] => {
  const minX = Math.max(0, Math.floor(Math.min(...triangle.map((vertex) => vertex.edgeX)) - EPSILON));
  const maxX = Math.min(domain.bucketCols - 1, Math.floor(Math.max(...triangle.map((vertex) => vertex.edgeX)) + EPSILON));
  const minY = Math.max(0, Math.floor(Math.min(...triangle.map((vertex) => vertex.edgeY)) - EPSILON));
  const maxY = Math.min(domain.bucketRows - 1, Math.floor(Math.max(...triangle.map((vertex) => vertex.edgeY)) + EPSILON));
  const candidateIds = new Set<number>();
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      for (const triangleId of domain.triangleBuckets.get(y * domain.bucketCols + x) ?? []) {
        candidateIds.add(triangleId);
      }
    }
  }
  let polygons: InlandWaterTerrainCutoutVertex[][] = [Array.from(triangle)];
  for (const triangleId of candidateIds) {
    const indexOffset = triangleId * 3;
    const ia = domain.contourIndices[indexOffset] as number;
    const ib = domain.contourIndices[indexOffset + 1] as number;
    const ic = domain.contourIndices[indexOffset + 2] as number;
    const waterTriangle: [number, number, number, number, number, number] = [
      domain.contourVertices[ia * 2] as number,
      domain.contourVertices[ia * 2 + 1] as number,
      domain.contourVertices[ib * 2] as number,
      domain.contourVertices[ib * 2 + 1] as number,
      domain.contourVertices[ic * 2] as number,
      domain.contourVertices[ic * 2 + 1] as number
    ];
    const next: InlandWaterTerrainCutoutVertex[][] = [];
    for (const polygon of polygons) next.push(...subtractWaterTriangle(polygon, waterTriangle));
    polygons = next;
    if (polygons.length === 0) break;
  }
  return polygons.map((vertices) => ({ vertices, sourceTerrainTriangleId: triangle[0].sourceTerrainTriangleId }));
};

export const findInlandWaterContourSegment = (
  domain: InlandWaterTerrainCutoutDomain,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  tolerance = 2e-5
): InlandWaterContourSegment | undefined => {
  const midpointX = (ax + bx) * 0.5;
  const midpointY = (ay + by) * 0.5;
  let best: InlandWaterContourSegment | undefined;
  let bestError = Number.POSITIVE_INFINITY;
  for (const segment of domain.boundarySegments) {
    const dx = segment.bx - segment.ax;
    const dy = segment.by - segment.ay;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq <= EPSILON * EPSILON) continue;
    const errorAt = (x: number, y: number): number => {
      const t = Math.min(1, Math.max(0, ((x - segment.ax) * dx + (y - segment.ay) * dy) / lengthSq));
      return Math.hypot(x - (segment.ax + dx * t), y - (segment.ay + dy * t));
    };
    const error = Math.max(errorAt(ax, ay), errorAt(midpointX, midpointY), errorAt(bx, by));
    if (error < bestError) {
      bestError = error;
      best = segment;
    }
  }
  return bestError <= tolerance ? best : undefined;
};
