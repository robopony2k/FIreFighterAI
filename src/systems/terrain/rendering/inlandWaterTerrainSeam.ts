import type { InlandWaterContourSegment } from "./inlandWaterTerrainCutout.js";

export type InlandWaterTerrainBoundarySample = {
  ax: number;
  ay: number;
  terrainTopA: number;
  uA: number;
  vA: number;
  bx: number;
  by: number;
  terrainTopB: number;
  uB: number;
  vB: number;
  sourceContourSegmentId: number;
  sourceTerrainTriangleId: number;
  openToOcean: boolean;
};

export type InlandWaterTerrainSeamVertex = {
  id: number;
  edgeX: number;
  edgeY: number;
  originalEdgeX: number;
  originalEdgeY: number;
  renderedEdgeX: number;
  renderedEdgeY: number;
  forcedDisplacementCells: number;
  sourceContourVertexId?: number;
  sourceContourSegmentIds: number[];
  sourceTerrainTriangleIds: number[];
  terrainTopWorldY: number;
  rawTerrainTopWorldY: number;
  waterWorldY: number;
  skirtBottomWorldY: number;
  waterwardX: number;
  waterwardY: number;
  terrainU: number;
  terrainV: number;
  normalClassification: "retained-land";
  uvClassification: "retained-land";
};

export type InlandWaterTerrainSeamSegment = {
  id: number;
  a: number;
  b: number;
  sourceContourSegmentId: number;
  openToOcean: boolean;
  waterwardX: number;
  waterwardY: number;
};

export type InlandWaterTerrainSeamComponent = {
  vertexIds: number[];
  closed: boolean;
};

export type InlandWaterTerrainSeamDiagnostics = {
  originalBoundaryDisplacementMax: number;
  maximumPreConformanceError: number;
  unmatchedWaterVertexCount: number;
  tJunctionCount: number;
  unexpectedOpenEndCount: number;
  degenerateBoundaryTriangleCount: number;
  sharedSegmentCount: number;
  sourceProjectionErrorMax: number;
  segmentXzErrorMax: number;
  skirtJointGapMax: number;
  skirtTerrainTopErrorMax: number;
  waterAboveSeamMax: number;
  seamLiftMax: number;
  guardOverlapMin: number;
};

export type InlandWaterTerrainSeam = {
  quantScale: number;
  overlapWorld: number;
  guardOverlapCells: number;
  vertices: InlandWaterTerrainSeamVertex[];
  segments: InlandWaterTerrainSeamSegment[];
  components: InlandWaterTerrainSeamComponent[];
  boundaryEdges: Float32Array;
  diagnostics: InlandWaterTerrainSeamDiagnostics;
};

export type InlandWaterTerrainSkirtMesh = {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
};

type SplitPoint = {
  x: number;
  y: number;
  t: number;
  sourceContourVertexId?: number;
};

type VertexAccumulator = {
  x: number;
  y: number;
  rawTop: number;
  uSum: number;
  vSum: number;
  uvCount: number;
  sourceContourVertexId?: number;
  sourceContourSegmentIds: Set<number>;
  sourceTerrainTriangleIds: Set<number>;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
export const INLAND_WATER_GUARD_OVERLAP_CELLS = 0.04;
const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp((value - edge0) / Math.max(1e-9, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

const pointSegmentProjection = (
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): { x: number; y: number; t: number; distance: number } => {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 1e-12 ? clamp(((x - ax) * dx + (y - ay) * dy) / lengthSq, 0, 1) : 0;
  const projectedX = ax + dx * t;
  const projectedY = ay + dy * t;
  return { x: projectedX, y: projectedY, t, distance: Math.hypot(x - projectedX, y - projectedY) };
};

const buildLegacySegments = (edges: ArrayLike<number>): InlandWaterContourSegment[] => {
  const segments: InlandWaterContourSegment[] = [];
  for (let index = 0; index + 3 < edges.length; index += 4) {
    segments.push({
      id: segments.length,
      sourceA: segments.length * 2,
      sourceB: segments.length * 2 + 1,
      ax: edges[index] as number,
      ay: edges[index + 1] as number,
      bx: edges[index + 2] as number,
      by: edges[index + 3] as number,
      waterwardX: 0,
      waterwardY: 0
    });
  }
  return segments;
};

export const buildInlandWaterTerrainSeam = (input: {
  boundarySamples: readonly InlandWaterTerrainBoundarySample[];
  waterBoundarySegments?: readonly InlandWaterContourSegment[];
  waterBoundaryEdges?: ArrayLike<number>;
  heightScale: number;
  waterSurfaceLiftWorld: number;
  sampleWaterWorldYAtEdge: (edgeX: number, edgeY: number) => number;
  quantScale?: number;
}): InlandWaterTerrainSeam | undefined => {
  const sourceSegments = input.waterBoundarySegments ?? buildLegacySegments(input.waterBoundaryEdges ?? []);
  if (sourceSegments.length === 0) return undefined;
  const quantScale = Math.max(128, input.quantScale ?? 8192);
  const tolerance = 2 / quantScale;
  const overlapWorld = Math.max(0.003, input.heightScale * 0.00015);
  const keyOf = (x: number, y: number): string => `${Math.round(x * quantScale)},${Math.round(y * quantScale)}`;
  const samplesBySegment = new Map<number, InlandWaterTerrainBoundarySample[]>();
  for (const sample of input.boundarySamples) {
    const bucket = samplesBySegment.get(sample.sourceContourSegmentId) ?? [];
    bucket.push(sample);
    samplesBySegment.set(sample.sourceContourSegmentId, bucket);
  }

  const splitPointsBySegment = new Map<number, SplitPoint[]>();
  const sourceVertexIds = new Map<string, number>();
  for (const segment of sourceSegments) {
    sourceVertexIds.set(keyOf(segment.ax, segment.ay), segment.sourceA);
    sourceVertexIds.set(keyOf(segment.bx, segment.by), segment.sourceB);
    const points: SplitPoint[] = [
      { x: segment.ax, y: segment.ay, t: 0, sourceContourVertexId: segment.sourceA },
      { x: segment.bx, y: segment.by, t: 1, sourceContourVertexId: segment.sourceB }
    ];
    for (const sample of samplesBySegment.get(segment.id) ?? []) {
      for (const point of [[sample.ax, sample.ay], [sample.bx, sample.by]] as const) {
        const projection = pointSegmentProjection(point[0], point[1], segment.ax, segment.ay, segment.bx, segment.by);
        if (projection.distance <= tolerance) {
          points.push({ x: point[0], y: point[1], t: projection.t, sourceContourVertexId: sourceVertexIds.get(keyOf(point[0], point[1])) });
        }
      }
    }
    points.sort((a, b) => a.t - b.t);
    splitPointsBySegment.set(segment.id, points.filter((point, index) => index === 0 || keyOf(point.x, point.y) !== keyOf(points[index - 1].x, points[index - 1].y)));
  }

  const accumulators = new Map<string, VertexAccumulator>();
  const addPoint = (point: SplitPoint, segment: InlandWaterContourSegment): string => {
    const key = keyOf(point.x, point.y);
    let accumulator = accumulators.get(key);
    if (!accumulator) {
      accumulator = {
        x: point.x,
        y: point.y,
        rawTop: Number.NEGATIVE_INFINITY,
        uSum: 0,
        vSum: 0,
        uvCount: 0,
        sourceContourVertexId: point.sourceContourVertexId,
        sourceContourSegmentIds: new Set<number>(),
        sourceTerrainTriangleIds: new Set<number>()
      };
      accumulators.set(key, accumulator);
    }
    accumulator.sourceContourSegmentIds.add(segment.id);
    accumulator.sourceContourVertexId ??= point.sourceContourVertexId;
    for (const sample of samplesBySegment.get(segment.id) ?? []) {
      const projection = pointSegmentProjection(point.x, point.y, sample.ax, sample.ay, sample.bx, sample.by);
      if (projection.distance > tolerance) continue;
      accumulator.rawTop = Math.max(
        accumulator.rawTop,
        sample.terrainTopA + (sample.terrainTopB - sample.terrainTopA) * projection.t
      );
      accumulator.uSum += sample.uA + (sample.uB - sample.uA) * projection.t;
      accumulator.vSum += sample.vA + (sample.vB - sample.vA) * projection.t;
      accumulator.uvCount += 1;
      accumulator.sourceTerrainTriangleIds.add(sample.sourceTerrainTriangleId);
    }
    return key;
  };

  const segmentKeys: Array<{ aKey: string; bKey: string; source: InlandWaterContourSegment; openToOcean: boolean }> = [];
  for (const segment of sourceSegments) {
    const points = splitPointsBySegment.get(segment.id) ?? [];
    for (let index = 0; index + 1 < points.length; index += 1) {
      const aKey = addPoint(points[index], segment);
      const bKey = addPoint(points[index + 1], segment);
      if (aKey === bKey) continue;
      const midpointT = (points[index].t + points[index + 1].t) * 0.5;
      const openToOcean = (samplesBySegment.get(segment.id) ?? []).some((sample) => {
        if (!sample.openToOcean) return false;
        const sampleA = pointSegmentProjection(sample.ax, sample.ay, segment.ax, segment.ay, segment.bx, segment.by).t;
        const sampleB = pointSegmentProjection(sample.bx, sample.by, segment.ax, segment.ay, segment.bx, segment.by).t;
        return midpointT >= Math.min(sampleA, sampleB) - tolerance && midpointT <= Math.max(sampleA, sampleB) + tolerance;
      });
      segmentKeys.push({ aKey, bKey, source: segment, openToOcean });
    }
  }

  // A contour corner can coincide with a terrain edge while neither adjacent
  // retained polygon owns a non-zero boundary interval. Resolve only its
  // height/UV provenance from directly connected seam neighbours; XZ remains
  // the original contour coordinate.
  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false;
    for (const [key, accumulator] of accumulators) {
      if (Number.isFinite(accumulator.rawTop) && accumulator.uvCount > 0) continue;
      const neighbours: VertexAccumulator[] = [];
      for (const segment of segmentKeys) {
        const neighbourKey = segment.aKey === key ? segment.bKey : segment.bKey === key ? segment.aKey : undefined;
        if (!neighbourKey) continue;
        const neighbour = accumulators.get(neighbourKey);
        if (neighbour && Number.isFinite(neighbour.rawTop) && neighbour.uvCount > 0) neighbours.push(neighbour);
      }
      if (neighbours.length === 0) continue;
      accumulator.rawTop = Math.max(...neighbours.map((neighbour) => neighbour.rawTop));
      accumulator.uSum = neighbours.reduce((sum, neighbour) => sum + neighbour.uSum / neighbour.uvCount, 0);
      accumulator.vSum = neighbours.reduce((sum, neighbour) => sum + neighbour.vSum / neighbour.uvCount, 0);
      accumulator.uvCount = neighbours.length;
      for (const neighbour of neighbours) {
        for (const triangleId of neighbour.sourceTerrainTriangleIds) accumulator.sourceTerrainTriangleIds.add(triangleId);
      }
      changed = true;
    }
    if (!changed) break;
  }

  const vertices: InlandWaterTerrainSeamVertex[] = [];
  const vertexIdByKey = new Map<string, number>();
  let seamLiftMax = 0;
  let unmatchedWaterVertexCount = 0;
  for (const [key, accumulator] of accumulators) {
    const waterBase = input.sampleWaterWorldYAtEdge(accumulator.x, accumulator.y);
    const waterWorldY = Number.isFinite(waterBase) ? waterBase + input.waterSurfaceLiftWorld : 0;
    const hasTerrain = Number.isFinite(accumulator.rawTop) && accumulator.uvCount > 0;
    if (!hasTerrain) unmatchedWaterVertexCount += 1;
    const rawTerrainTopWorldY = hasTerrain ? accumulator.rawTop : waterWorldY + overlapWorld;
    const terrainTopWorldY = Math.max(rawTerrainTopWorldY, waterWorldY + overlapWorld);
    seamLiftMax = Math.max(seamLiftMax, terrainTopWorldY - rawTerrainTopWorldY);
    const id = vertices.length;
    vertices.push({
      id,
      edgeX: accumulator.x,
      edgeY: accumulator.y,
      originalEdgeX: accumulator.x,
      originalEdgeY: accumulator.y,
      renderedEdgeX: accumulator.x,
      renderedEdgeY: accumulator.y,
      forcedDisplacementCells: 0,
      sourceContourVertexId: accumulator.sourceContourVertexId,
      sourceContourSegmentIds: Array.from(accumulator.sourceContourSegmentIds),
      sourceTerrainTriangleIds: Array.from(accumulator.sourceTerrainTriangleIds),
      terrainTopWorldY,
      rawTerrainTopWorldY,
      waterWorldY,
      skirtBottomWorldY: waterWorldY - overlapWorld,
      waterwardX: 0,
      waterwardY: 0,
      terrainU: hasTerrain ? accumulator.uSum / accumulator.uvCount : 0,
      terrainV: hasTerrain ? accumulator.vSum / accumulator.uvCount : 0,
      normalClassification: "retained-land",
      uvClassification: "retained-land"
    });
    vertexIdByKey.set(key, id);
  }
  const segments: InlandWaterTerrainSeamSegment[] = segmentKeys.map((record, id) => ({
    id,
    a: vertexIdByKey.get(record.aKey) as number,
    b: vertexIdByKey.get(record.bKey) as number,
    sourceContourSegmentId: record.source.id,
    openToOcean: record.openToOcean,
    waterwardX: record.source.waterwardX,
    waterwardY: record.source.waterwardY
  }));

  // Build a waterward miter at every closed-bank joint. The miter is scaled so
  // its projection onto each incident segment normal is at least one guard
  // width, preventing pinholes between adjacent submerged guard quads.
  const incidentNormals = vertices.map(() => [] as Array<{ x: number; y: number }>);
  for (const segment of segments) {
    if (segment.openToOcean || Math.hypot(segment.waterwardX, segment.waterwardY) <= 1e-9) continue;
    const normal = { x: segment.waterwardX, y: segment.waterwardY };
    incidentNormals[segment.a].push(normal);
    incidentNormals[segment.b].push(normal);
  }
  vertices.forEach((vertex, vertexId) => {
    const normals = incidentNormals[vertexId];
    if (normals.length === 0) return;
    const sumX = normals.reduce((sum, normal) => sum + normal.x, 0);
    const sumY = normals.reduce((sum, normal) => sum + normal.y, 0);
    const sumLength = Math.hypot(sumX, sumY);
    const base = sumLength > 1e-6
      ? { x: sumX / sumLength, y: sumY / sumLength }
      : normals[0];
    const minimumProjection = Math.min(...normals.map((normal) => base.x * normal.x + base.y * normal.y));
    const miterScale = minimumProjection > 1e-3 ? Math.min(3, 1 / minimumProjection) : 1;
    vertex.waterwardX = base.x * miterScale;
    vertex.waterwardY = base.y * miterScale;
  });

  const adjacency = vertices.map(() => [] as number[]);
  segments.forEach((segment, index) => {
    if (segment.openToOcean) return;
    adjacency[segment.a].push(index);
    adjacency[segment.b].push(index);
  });
  const visited = new Uint8Array(segments.length);
  const components: InlandWaterTerrainSeamComponent[] = [];
  for (let seed = 0; seed < segments.length; seed += 1) {
    if (visited[seed] || segments[seed].openToOcean) continue;
    const stack = [seed];
    const componentSegments = new Set<number>();
    const componentVertices = new Set<number>();
    while (stack.length > 0) {
      const current = stack.pop() as number;
      if (visited[current]) continue;
      visited[current] = 1;
      componentSegments.add(current);
      const segment = segments[current];
      componentVertices.add(segment.a);
      componentVertices.add(segment.b);
      for (const vertexId of [segment.a, segment.b]) {
        for (const next of adjacency[vertexId]) if (!visited[next]) stack.push(next);
      }
    }
    const ends = Array.from(componentVertices).filter((vertexId) => adjacency[vertexId].length === 1);
    const start = ends[0] ?? segments[Array.from(componentSegments)[0]].a;
    const ordered = [start];
    let current = start;
    let previousSegment = -1;
    for (let guard = 0; guard <= componentSegments.size; guard += 1) {
      const nextSegment = adjacency[current].find((index) => index !== previousSegment && componentSegments.has(index));
      if (nextSegment === undefined) break;
      const segment = segments[nextSegment];
      current = segment.a === current ? segment.b : segment.a;
      ordered.push(current);
      previousSegment = nextSegment;
      if (current === start) break;
    }
    components.push({ vertexIds: ordered, closed: current === start });
  }
  const boundaryEdges = new Float32Array(segments.length * 4);
  segments.forEach((segment, index) => {
    const a = vertices[segment.a];
    const b = vertices[segment.b];
    boundaryEdges.set([a.edgeX, a.edgeY, b.edgeX, b.edgeY], index * 4);
  });
  const tJunctionCount = vertices.reduce((count, vertex) => count + (segments.some((segment) => {
    if (segment.a === vertex.id || segment.b === vertex.id) return false;
    const a = vertices[segment.a];
    const b = vertices[segment.b];
    const projection = pointSegmentProjection(vertex.edgeX, vertex.edgeY, a.edgeX, a.edgeY, b.edgeX, b.edgeY);
    return projection.distance <= tolerance && projection.t > tolerance && projection.t < 1 - tolerance;
  }) ? 1 : 0), 0);
  const intentionalOpenVertices = new Set<number>();
  segments.forEach((segment) => {
    if (!segment.openToOcean) return;
    intentionalOpenVertices.add(segment.a);
    intentionalOpenVertices.add(segment.b);
  });
  const originalBoundaryDisplacementMax = vertices.reduce((maximum, vertex) => Math.max(maximum, vertex.forcedDisplacementCells), 0);
  const guardOverlapMin = Math.min(...segments
    .filter((segment) => !segment.openToOcean)
    .flatMap((segment) => [segment.a, segment.b].map((vertexId) => {
      const vertex = vertices[vertexId];
      return Math.max(0, vertex.waterwardX * segment.waterwardX + vertex.waterwardY * segment.waterwardY)
        * INLAND_WATER_GUARD_OVERLAP_CELLS;
    })));
  return {
    quantScale,
    overlapWorld,
    guardOverlapCells: INLAND_WATER_GUARD_OVERLAP_CELLS,
    vertices,
    segments,
    components,
    boundaryEdges,
    diagnostics: {
      originalBoundaryDisplacementMax,
      maximumPreConformanceError: originalBoundaryDisplacementMax,
      unmatchedWaterVertexCount,
      tJunctionCount,
      unexpectedOpenEndCount: adjacency.reduce((count, incident, vertexId) =>
        count + (incident.length !== 2 && !intentionalOpenVertices.has(vertexId) ? 1 : 0), 0),
      degenerateBoundaryTriangleCount: 0,
      sharedSegmentCount: segments.length,
      sourceProjectionErrorMax: originalBoundaryDisplacementMax,
      segmentXzErrorMax: 0,
      skirtJointGapMax: 0,
      skirtTerrainTopErrorMax: 0,
      waterAboveSeamMax: Math.max(0, ...vertices.map((vertex) => vertex.waterWorldY - vertex.terrainTopWorldY)),
      seamLiftMax,
      guardOverlapMin: Number.isFinite(guardOverlapMin) ? guardOverlapMin : 0
    }
  };
};

export const findInlandWaterTerrainSeamVertex = (
  seam: InlandWaterTerrainSeam,
  edgeX: number,
  edgeY: number
): InlandWaterTerrainSeamVertex | undefined => {
  const keyX = Math.round(edgeX * seam.quantScale);
  const keyY = Math.round(edgeY * seam.quantScale);
  return seam.vertices.find((vertex) =>
    Math.round(vertex.edgeX * seam.quantScale) === keyX && Math.round(vertex.edgeY * seam.quantScale) === keyY
  );
};

export const getInlandWaterTerrainSeamVerticesAlongEdge = (
  seam: InlandWaterTerrainSeam,
  ax: number,
  ay: number,
  bx: number,
  by: number
): InlandWaterTerrainSeamVertex[] => {
  const tolerance = 2 / seam.quantScale;
  return seam.vertices
    .map((vertex) => ({ vertex, projection: pointSegmentProjection(vertex.edgeX, vertex.edgeY, ax, ay, bx, by) }))
    .filter(({ projection }) => projection.distance <= tolerance)
    .sort((a, b) => a.projection.t - b.projection.t)
    .map(({ vertex }) => vertex);
};

export const findNearestInlandWaterTerrainSeamSegment = (
  seam: InlandWaterTerrainSeam,
  edgeX: number,
  edgeY: number
): { segment: InlandWaterTerrainSeamSegment; distance: number; t: number } | undefined => {
  let best: { segment: InlandWaterTerrainSeamSegment; distance: number; t: number } | undefined;
  for (const segment of seam.segments) {
    const a = seam.vertices[segment.a];
    const b = seam.vertices[segment.b];
    const projection = pointSegmentProjection(edgeX, edgeY, a.edgeX, a.edgeY, b.edgeX, b.edgeY);
    if (!best || projection.distance < best.distance) best = { segment, distance: projection.distance, t: projection.t };
  }
  return best;
};

export const sampleInlandWaterEdgeMotionFactor = (
  seam: InlandWaterTerrainSeam | undefined,
  edgeX: number,
  edgeY: number,
  fadeDistanceCells = 1
): number => {
  if (!seam) return 1;
  let distance = Number.POSITIVE_INFINITY;
  for (const segment of seam.segments) {
    if (segment.openToOcean) continue;
    const a = seam.vertices[segment.a];
    const b = seam.vertices[segment.b];
    distance = Math.min(distance, pointSegmentProjection(edgeX, edgeY, a.edgeX, a.edgeY, b.edgeX, b.edgeY).distance);
  }
  if (!Number.isFinite(distance)) return 1;
  if (distance <= 2 / seam.quantScale) return 0;
  return smoothstep(0, Math.max(1e-4, fadeDistanceCells), distance);
};

export const buildInlandWaterTerrainSkirtMesh = (
  seam: InlandWaterTerrainSeam,
  edgeToWorldX: (edgeX: number) => number,
  edgeToWorldZ: (edgeY: number) => number
): InlandWaterTerrainSkirtMesh => {
  const positions: number[] = [];
  const uvs: number[] = [];
  seam.vertices.forEach((vertex, index) => {
    const worldX = edgeToWorldX(vertex.edgeX);
    const worldZ = edgeToWorldZ(vertex.edgeY);
    positions.push(worldX, vertex.terrainTopWorldY, worldZ, worldX, vertex.skirtBottomWorldY, worldZ);
    uvs.push(vertex.terrainU, vertex.terrainV, vertex.terrainU, vertex.terrainV);
  });
  const indices: number[] = [];
  for (const segment of seam.segments) {
    if (segment.openToOcean) continue;
    const topA = segment.a * 2;
    const bottomA = topA + 1;
    const topB = segment.b * 2;
    const bottomB = topB + 1;
    indices.push(topA, topB, bottomB, topA, bottomB, bottomA, bottomB, topB, topA, bottomA, bottomB, topA);

    // A coplanar shared edge can still expose a background pixel because the
    // independently rasterized water and wall primitives have different depth
    // gradients. Cover that edge with a fully submerged waterward strip in the
    // same terrain buffers and draw call. Mouth openings deliberately skip it.
    const a = seam.vertices[segment.a];
    const b = seam.vertices[segment.b];
    const outerA = positions.length / 3;
    const aWorldX = edgeToWorldX(a.edgeX);
    const aWorldZ = edgeToWorldZ(a.edgeY);
    const bWorldX = edgeToWorldX(b.edgeX);
    const bWorldZ = edgeToWorldZ(b.edgeY);
    const aInnerX = edgeToWorldX(a.edgeX + a.waterwardX * seam.guardOverlapCells);
    const aInnerZ = edgeToWorldZ(a.edgeY + a.waterwardY * seam.guardOverlapCells);
    const bInnerX = edgeToWorldX(b.edgeX + b.waterwardX * seam.guardOverlapCells);
    const bInnerZ = edgeToWorldZ(b.edgeY + b.waterwardY * seam.guardOverlapCells);
    positions.push(
      aWorldX, a.skirtBottomWorldY, aWorldZ,
      bWorldX, b.skirtBottomWorldY, bWorldZ,
      bInnerX, b.skirtBottomWorldY, bInnerZ,
      aInnerX, a.skirtBottomWorldY, aInnerZ
    );
    uvs.push(a.terrainU, a.terrainV, b.terrainU, b.terrainV, b.terrainU, b.terrainV, a.terrainU, a.terrainV);
    indices.push(
      outerA, outerA + 1, outerA + 2, outerA, outerA + 2, outerA + 3,
      outerA + 2, outerA + 1, outerA, outerA + 3, outerA + 2, outerA
    );
  }
  return { positions: new Float32Array(positions), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) };
};
