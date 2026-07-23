import type { InlandWaterfallSpan } from "./inlandWaterRenderSurface.js";

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
  riverMouthBlend: Float32Array;
  edgeMotionFactor: Float32Array;
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
  riverMouthBlend: number[];
  edgeMotionFactor: number[];
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
    lakeFactor: [],
    riverMouthBlend: [],
    edgeMotionFactor: []
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
    out.riverMouthBlend.push(mesh.riverMouthBlend?.[sourceIndex] ?? 0);
    out.edgeMotionFactor.push(mesh.edgeMotionFactor?.[sourceIndex] ?? 1);
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
