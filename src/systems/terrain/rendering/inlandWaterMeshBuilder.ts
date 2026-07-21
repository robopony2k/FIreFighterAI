import type { InlandWaterfallSpan } from "./inlandWaterRenderSurface.js";

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export type InlandWaterTerrainSkirtQuad = {
  positions: number[];
  uvs: number[];
};

export type InlandWaterTerrainSkirtEdgeSample = {
  ax: number;
  ay: number;
  topA: number;
  uA: number;
  vA: number;
  bx: number;
  by: number;
  topB: number;
  uB: number;
  vB: number;
};

export type InlandWaterTerrainSkirtEdge = InlandWaterTerrainSkirtEdgeSample;

export const weldInlandWaterTerrainSkirtEdges = (
  samples: readonly InlandWaterTerrainSkirtEdgeSample[],
  quantScale = 8192
): InlandWaterTerrainSkirtEdge[] => {
  type WeldedVertex = { x: number; y: number; top: number; u: number; v: number; count: number };
  const vertices = new Map<string, WeldedVertex>();
  const edges = new Map<string, { a: string; b: string }>();
  const addVertex = (x: number, y: number, top: number, u: number, v: number): string => {
    const key = `${Math.round(x * quantScale)},${Math.round(y * quantScale)}`;
    const existing = vertices.get(key);
    if (existing) {
      existing.x += x;
      existing.y += y;
      existing.top += top;
      existing.u += u;
      existing.v += v;
      existing.count += 1;
    } else {
      vertices.set(key, { x, y, top, u, v, count: 1 });
    }
    return key;
  };
  for (const sample of samples) {
    const a = addVertex(sample.ax, sample.ay, sample.topA, sample.uA, sample.vA);
    const b = addVertex(sample.bx, sample.by, sample.topB, sample.uB, sample.vB);
    if (a === b) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (!edges.has(key)) edges.set(key, { a, b });
  }
  const resolve = (key: string): Omit<WeldedVertex, "count"> => {
    const vertex = vertices.get(key) as WeldedVertex;
    const inv = 1 / Math.max(1, vertex.count);
    return { x: vertex.x * inv, y: vertex.y * inv, top: vertex.top * inv, u: vertex.u * inv, v: vertex.v * inv };
  };
  return Array.from(edges.values(), ({ a: aKey, b: bKey }) => {
    const a = resolve(aKey);
    const b = resolve(bKey);
    return {
      ax: a.x,
      ay: a.y,
      topA: a.top,
      uA: a.u,
      vA: a.v,
      bx: b.x,
      by: b.y,
      topB: b.top,
      uB: b.u,
      vB: b.v
    };
  });
};

export const insetInlandWaterTerrainUv = (
  edgeUv: readonly [number, number],
  retainedInteriorUv: readonly [number, number],
  inset: number
): [number, number] => {
  const t = clamp(inset, 0, 1);
  return [
    edgeUv[0] + (retainedInteriorUv[0] - edgeUv[0]) * t,
    edgeUv[1] + (retainedInteriorUv[1] - edgeUv[1]) * t
  ];
};

export const buildInlandWaterTerrainSkirtQuad = (input: {
  worldAx: number;
  worldAz: number;
  worldBx: number;
  worldBz: number;
  topA: number;
  topB: number;
  bottomA: number;
  bottomB: number;
  uvA: readonly [number, number];
  uvB: readonly [number, number];
}): InlandWaterTerrainSkirtQuad => ({
  positions: [
    input.worldAx, input.topA, input.worldAz,
    input.worldBx, input.topB, input.worldBz,
    input.worldBx, input.bottomB, input.worldBz,
    input.worldAx, input.topA, input.worldAz,
    input.worldBx, input.bottomB, input.worldBz,
    input.worldAx, input.bottomA, input.worldAz,
    input.worldBx, input.bottomB, input.worldBz,
    input.worldBx, input.topB, input.worldBz,
    input.worldAx, input.topA, input.worldAz,
    input.worldAx, input.bottomA, input.worldAz,
    input.worldBx, input.bottomB, input.worldBz,
    input.worldAx, input.topA, input.worldAz
  ],
  uvs: [
    input.uvA[0], input.uvA[1],
    input.uvB[0], input.uvB[1],
    input.uvB[0], input.uvB[1],
    input.uvA[0], input.uvA[1],
    input.uvB[0], input.uvB[1],
    input.uvA[0], input.uvA[1],
    input.uvB[0], input.uvB[1],
    input.uvB[0], input.uvB[1],
    input.uvA[0], input.uvA[1],
    input.uvA[0], input.uvA[1],
    input.uvB[0], input.uvB[1],
    input.uvA[0], input.uvA[1]
  ]
});

export type InlandWaterfallMeshData = {
  waterfallPositions: Float32Array;
  waterfallUvs: Float32Array;
  waterfallIndices: Uint32Array;
  waterfallDropNorm: Float32Array;
  waterfallFallStyle: Float32Array;
};

export type InlandWaterMeshData = {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  waterfallWallPositions?: Float32Array;
  waterfallWallUvs?: Float32Array;
  waterfallWallIndices?: Uint32Array;
  waterfallWallDropNorm?: Float32Array;
  waterfallWallFallStyle?: Float32Array;
  bankDist: Float32Array;
  flowDir: Float32Array;
  flowSpeed: Float32Array;
  rapid: Float32Array;
  lakeFactor: Float32Array;
  level: number;
  cols: number;
  rows: number;
  width: number;
  depth: number;
};

export type InlandWaterSurfaceMeshAttributes = {
  positions: number[];
  uvs: number[];
  indices: number[];
  bankDist: number[];
  flowDir: number[];
  flowSpeed: number[];
  rapid: number[];
  lakeFactor: number[];
};

export const splitInlandWaterSurfaceAtWaterfalls = (
  mesh: InlandWaterSurfaceMeshAttributes,
  spans: readonly InlandWaterfallSpan[],
  baseLevelWorld: number
): InlandWaterSurfaceMeshAttributes => {
  if (spans.length === 0) return mesh;
  const out: InlandWaterSurfaceMeshAttributes = {
    positions: [],
    uvs: [],
    indices: [],
    bankDist: [],
    flowDir: [],
    flowSpeed: [],
    rapid: [],
    lakeFactor: []
  };
  const copyVertex = (sourceIndex: number, overrideY?: number): void => {
    const positionBase = sourceIndex * 3;
    const uvBase = sourceIndex * 2;
    const flowBase = sourceIndex * 2;
    out.positions.push(
      mesh.positions[positionBase] ?? 0,
      overrideY ?? mesh.positions[positionBase + 1] ?? 0,
      mesh.positions[positionBase + 2] ?? 0
    );
    out.uvs.push(mesh.uvs[uvBase] ?? 0, mesh.uvs[uvBase + 1] ?? 0);
    out.bankDist.push(mesh.bankDist[sourceIndex] ?? 0);
    out.flowDir.push(mesh.flowDir[flowBase] ?? 1, mesh.flowDir[flowBase + 1] ?? 0);
    out.flowSpeed.push(mesh.flowSpeed[sourceIndex] ?? 0.35);
    out.rapid.push(mesh.rapid[sourceIndex] ?? 0);
    out.lakeFactor.push(mesh.lakeFactor[sourceIndex] ?? 0);
    out.indices.push(out.positions.length / 3 - 1);
  };

  for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
    const triangle = [mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]];
    let matchedSpan: InlandWaterfallSpan | undefined;
    let alongValues: number[] = [];
    let crossing = false;
    for (const span of spans) {
      const values: number[] = [];
      let minAlong = Number.POSITIVE_INFINITY;
      let maxAlong = Number.NEGATIVE_INFINITY;
      let minLateral = Number.POSITIVE_INFINITY;
      let maxLateral = Number.NEGATIVE_INFINITY;
      const crossX = -span.flowWorldZ;
      const crossZ = span.flowWorldX;
      for (const vertexIndex of triangle) {
        const base = vertexIndex * 3;
        const dx = (mesh.positions[base] ?? 0) - span.centerWorldX;
        const dz = (mesh.positions[base + 2] ?? 0) - span.centerWorldZ;
        const along = dx * span.flowWorldX + dz * span.flowWorldZ;
        const lateral = dx * crossX + dz * crossZ;
        values.push(along);
        minAlong = Math.min(minAlong, along);
        maxAlong = Math.max(maxAlong, along);
        minLateral = Math.min(minLateral, lateral);
        maxLateral = Math.max(maxLateral, lateral);
      }
      const touchesChannel = maxLateral >= -span.halfWidthWorld && minLateral <= span.halfWidthWorld;
      if (!touchesChannel || minAlong > 1e-5 || maxAlong < -1e-5) continue;
      matchedSpan = span;
      alongValues = values;
      crossing = minAlong < -1e-5 && maxAlong > 1e-5;
      break;
    }
    // A crossing triangle would interpolate diagonally through the drop. The
    // bank-to-bank curtain fills this exact seam instead.
    if (crossing) continue;
    const centroidAlong = alongValues.length > 0
      ? alongValues.reduce((sum, value) => sum + value, 0) / alongValues.length
      : 0;
    for (let vertex = 0; vertex < 3; vertex += 1) {
      let overrideY: number | undefined;
      if (matchedSpan && Math.abs(alongValues[vertex] ?? 1) <= 1e-5) {
        overrideY = (centroidAlong <= 0 ? matchedSpan.topWorldY : matchedSpan.bottomWorldY) - baseLevelWorld;
      }
      copyVertex(triangle[vertex], overrideY);
    }
  }
  return out;
};

export const buildInlandWaterfallMeshData = (
  spans: readonly InlandWaterfallSpan[],
  baseLevelWorld: number
): InlandWaterfallMeshData => {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const dropNorm: number[] = [];
  const fallStyle: number[] = [];
  for (const span of spans) {
    if (span.dropWorld <= 0 || span.halfWidthWorld <= 0) continue;
    const base = positions.length / 3;
    positions.push(
      span.leftWorldX, span.topWorldY - baseLevelWorld, span.leftWorldZ,
      span.rightWorldX, span.topWorldY - baseLevelWorld, span.rightWorldZ,
      span.rightWorldX, span.bottomWorldY - baseLevelWorld, span.rightWorldZ,
      span.leftWorldX, span.bottomWorldY - baseLevelWorld, span.leftWorldZ
    );
    uvs.push(0, 1, 1, 1, 1, 0, 0, 0);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    const normalizedDrop = Math.min(1, span.dropWorld / 1.6);
    dropNorm.push(normalizedDrop, normalizedDrop, normalizedDrop, normalizedDrop);
    fallStyle.push(span.aspect, span.aspect, span.aspect, span.aspect);
  }
  return {
    waterfallPositions: new Float32Array(positions),
    waterfallUvs: new Float32Array(uvs),
    waterfallIndices: new Uint32Array(indices),
    waterfallDropNorm: new Float32Array(dropNorm),
    waterfallFallStyle: new Float32Array(fallStyle)
  };
};
