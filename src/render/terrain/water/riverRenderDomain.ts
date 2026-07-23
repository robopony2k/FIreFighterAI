import { DEBUG_TERRAIN_RENDER } from "../../../core/config.js";
import type { InlandWaterRenderSurface } from "../../../systems/terrain/rendering/inlandWaterRenderSurface.js";
import type { InlandWaterTerrainSeam } from "../../../systems/terrain/rendering/inlandWaterTerrainSeam.js";
import { buildDistanceField } from "../shared/distanceField.js";

type RiverRenderDomainSample = {
  cols: number;
  rows: number;
  elevations: Float32Array;
  tileTypes?: Uint8Array;
  riverMask?: Uint8Array;
  lakeMask?: Uint16Array;
  riverSurface?: Float32Array;
  inlandWater?: InlandWaterRenderSurface;
};

export type RiverContourVertex = {
  x: number;
  y: number;
};

export type RiverContourEdge = {
  ax: number;
  ay: number;
  bx: number;
  by: number;
};

export type RiverContourPolygon = RiverContourVertex[];

export type RiverDomainDebugStats = {
  baseCount: number;
  renderCount: number;
  contourVertexCount: number;
  contourTriangleCount: number;
  boundaryEdgeCount: number;
  cutoutBoundaryEdgeCount: number;
  boundaryMismatchMean: number;
  boundaryMismatchMax: number;
  wallQuadCount: number;
  protrudingVertexRatio: number;
  waterfallAnchorErrorMean: number;
  waterfallAnchorErrorMax: number;
  waterfallWallQuadCounts: number[];
  wallTopGapMean: number;
  wallTopGapMax: number;
};

export type RiverRenderDomain = {
  cols: number;
  rows: number;
  baseSupport: Uint8Array;
  renderSupport: Uint8Array;
  vertexField: Float32Array;
  contourVertices: Float32Array;
  contourIndices: Uint32Array;
  boundaryEdges: Float32Array;
  riverMouthOpeningEdges?: Float32Array;
  terrainSeam?: InlandWaterTerrainSeam;
  distanceToBank: Int16Array;
  debugStats?: RiverDomainDebugStats;
};

const RIVER_DIAGONAL_FILL_MAX_ADDS_PER_CELL = 1;
const RIVER_WIDTH_EXPAND_MAX_PASSES = 1;
export const RIVER_FIELD_THRESHOLD = 0.5;
const RIVER_VERTEX_FIELD_BLUR_BLEND = 0;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const buildRenderRiverSupportMasks = (
  sample: RiverRenderDomainSample,
  waterId: number
): { base: Uint8Array; render: Uint8Array } | undefined => {
  const tileTypes = sample.tileTypes;
  const riverMask = sample.riverMask;
  const lakeMask = sample.lakeMask;
  if (!tileTypes || !riverMask) {
    return undefined;
  }
  const cols = sample.cols;
  const rows = sample.rows;
  if (cols < 2 || rows < 2) {
    return undefined;
  }
  const riverSurface = sample.riverSurface;
  const total = cols * rows;
  const base = new Uint8Array(total);
  let sourceCount = 0;
  for (let i = 0; i < total; i += 1) {
    const hasRiverSurface = !riverSurface || Number.isFinite(riverSurface[i]);
    const hasLake = (lakeMask?.[i] ?? 0) > 0;
    const hasInlandWater = sample.inlandWater
      ? sample.inlandWater.support[i] > 0
      : tileTypes[i] === waterId && ((riverMask[i] > 0 && hasRiverSurface) || hasLake);
    base[i] = hasInlandWater ? 1 : 0;
    if (base[i]) {
      sourceCount += 1;
    }
  }
  if (sourceCount === 0) {
    return undefined;
  }

  const render = new Uint8Array(base);
  const isValid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < cols && y < rows;
  const idxAt = (x: number, y: number): number => y * cols + x;
  const isNonRiverWaterCell = (idx: number): boolean => tileTypes[idx] === waterId && riverMask[idx] === 0;
  for (let pass = 0; pass < RIVER_WIDTH_EXPAND_MAX_PASSES; pass += 1) {
    const source = render;
    const additions = new Map<number, number>();
    const isSourceActive = (idx: number): boolean => source[idx] > 0;
    const isTaken = (idx: number): boolean => source[idx] > 0 || additions.has(idx);
    const canAdd = (idx: number): boolean => !isTaken(idx) && !isNonRiverWaterCell(idx);
    const neighborSupport = (x: number, y: number): number => {
      let support = 0;
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          if (ox === 0 && oy === 0) {
            continue;
          }
          const nx = x + ox;
          const ny = y + oy;
          if (!isValid(nx, ny)) {
            continue;
          }
          if (isSourceActive(idxAt(nx, ny))) {
            support += 1;
          }
        }
      }
      return support;
    };
    const bridgeScore = (candidateIdx: number, aIdx: number, bIdx: number): number => {
      const elev = sample.elevations[candidateIdx] ?? 0;
      const elevA = sample.elevations[aIdx] ?? elev;
      const elevB = sample.elevations[bIdx] ?? elev;
      const x = candidateIdx % cols;
      const y = Math.floor(candidateIdx / cols);
      const crowdedPenalty = neighborSupport(x, y) >= 5 ? 0.2 : 0;
      return Math.abs(elev - elevA) + Math.abs(elev - elevB) + crowdedPenalty;
    };
    const addCandidate = (idx: number, score: number): void => {
      if (!canAdd(idx)) {
        return;
      }
      const existing = additions.get(idx);
      if (existing === undefined || score < existing) {
        additions.set(idx, score);
      }
    };
    const addBridge = (firstIdx: number, secondIdx: number, leftIdx: number, rightIdx: number): void => {
      const canFirst = canAdd(firstIdx);
      const canSecond = canAdd(secondIdx);
      if (!canFirst && !canSecond) {
        return;
      }
      if (canFirst && !canSecond) {
        addCandidate(firstIdx, bridgeScore(firstIdx, leftIdx, rightIdx));
        return;
      }
      if (!canFirst && canSecond) {
        addCandidate(secondIdx, bridgeScore(secondIdx, leftIdx, rightIdx));
        return;
      }
      const firstScore = bridgeScore(firstIdx, leftIdx, rightIdx);
      const secondScore = bridgeScore(secondIdx, leftIdx, rightIdx);
      addCandidate(firstScore <= secondScore ? firstIdx : secondIdx, Math.min(firstScore, secondScore));
    };
    for (let y = 0; y < rows - 1; y += 1) {
      for (let x = 0; x < cols - 1; x += 1) {
        const a = idxAt(x, y);
        const b = idxAt(x + 1, y);
        const c = idxAt(x, y + 1);
        const d = idxAt(x + 1, y + 1);
        const aOn = isSourceActive(a);
        const bOn = isSourceActive(b);
        const cOn = isSourceActive(c);
        const dOn = isSourceActive(d);
        if (aOn && dOn && !bOn && !cOn) {
          addBridge(b, c, a, d);
        } else if (!aOn && !dOn && bOn && cOn) {
          addBridge(a, d, b, c);
        }
      }
    }
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const idx = idxAt(x, y);
        if (isSourceActive(idx) || additions.has(idx) || isNonRiverWaterCell(idx)) {
          continue;
        }
        const west = x > 0 && isSourceActive(idxAt(x - 1, y));
        const east = x < cols - 1 && isSourceActive(idxAt(x + 1, y));
        const north = y > 0 && isSourceActive(idxAt(x, y - 1));
        const south = y < rows - 1 && isSourceActive(idxAt(x, y + 1));
        if ((west && east) || (north && south)) {
          addCandidate(idx, 0.02);
        }
      }
    }
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const idx = idxAt(x, y);
        if (!isSourceActive(idx)) {
          continue;
        }
        const west = x > 0 && isSourceActive(idxAt(x - 1, y));
        const east = x < cols - 1 && isSourceActive(idxAt(x + 1, y));
        const north = y > 0 && isSourceActive(idxAt(x, y - 1));
        const south = y < rows - 1 && isSourceActive(idxAt(x, y + 1));
        const orthCount = (west ? 1 : 0) + (east ? 1 : 0) + (north ? 1 : 0) + (south ? 1 : 0);
        if (orthCount > 0) {
          continue;
        }
        const diagNeighbors: number[] = [];
        if (x > 0 && y > 0 && isSourceActive(idxAt(x - 1, y - 1))) {
          diagNeighbors.push(idxAt(x - 1, y - 1));
        }
        if (x < cols - 1 && y > 0 && isSourceActive(idxAt(x + 1, y - 1))) {
          diagNeighbors.push(idxAt(x + 1, y - 1));
        }
        if (x > 0 && y < rows - 1 && isSourceActive(idxAt(x - 1, y + 1))) {
          diagNeighbors.push(idxAt(x - 1, y + 1));
        }
        if (x < cols - 1 && y < rows - 1 && isSourceActive(idxAt(x + 1, y + 1))) {
          diagNeighbors.push(idxAt(x + 1, y + 1));
        }
        if (diagNeighbors.length === 0) {
          continue;
        }
        const bestDiag = diagNeighbors
          .slice()
          .sort((aIdx, bIdx) => {
            const da = Math.abs((sample.elevations[aIdx] ?? 0) - (sample.elevations[idx] ?? 0));
            const db = Math.abs((sample.elevations[bIdx] ?? 0) - (sample.elevations[idx] ?? 0));
            return da - db;
          })[0];
        const dx = (bestDiag % cols) - x;
        const dy = Math.floor(bestDiag / cols) - y;
        const bridgeA = idxAt(x + dx, y);
        const bridgeB = idxAt(x, y + dy);
        const canA = canAdd(bridgeA);
        const canB = canAdd(bridgeB);
        if (!canA && !canB) {
          continue;
        }
        if (canA && !canB) {
          addCandidate(bridgeA, bridgeScore(bridgeA, idx, bestDiag));
          continue;
        }
        if (!canA && canB) {
          addCandidate(bridgeB, bridgeScore(bridgeB, idx, bestDiag));
          continue;
        }
        const scoreA = bridgeScore(bridgeA, idx, bestDiag);
        const scoreB = bridgeScore(bridgeB, idx, bestDiag);
        addCandidate(scoreA <= scoreB ? bridgeA : bridgeB, Math.min(scoreA, scoreB));
      }
    }
    if (additions.size === 0) {
      break;
    }
    const maxAdds = Math.max(1, sourceCount * RIVER_DIAGONAL_FILL_MAX_ADDS_PER_CELL);
    const ranked = Array.from(additions.entries()).sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < ranked.length && i < maxAdds; i += 1) {
      render[ranked[i][0]] = 1;
    }
  }
  return { base, render };
};

export const buildRiverRenderDomain = (
  sample: RiverRenderDomainSample,
  waterId: number
): RiverRenderDomain | undefined => {
  const masks = buildRenderRiverSupportMasks(sample, waterId);
  if (!masks) {
    return undefined;
  }
  const cols = sample.cols;
  const rows = sample.rows;
  const { base: baseSupport, render: renderSupport } = masks;
  let renderCount = 0;
  for (let i = 0; i < renderSupport.length; i += 1) {
    if (renderSupport[i] > 0) {
      renderCount += 1;
    }
  }
  if (renderCount === 0) {
    return undefined;
  }

  const vertexField = new Float32Array((cols + 1) * (rows + 1));
  const vIdx = (x: number, y: number): number => y * (cols + 1) + x;
  const isValid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < cols && y < rows;
  const idxAt = (x: number, y: number): number => y * cols + x;
  for (let y = 0; y <= rows; y += 1) {
    for (let x = 0; x <= cols; x += 1) {
      let sum = 0;
      let count = 0;
      const cells = [{ x: x - 1, y: y - 1 }, { x, y: y - 1 }, { x: x - 1, y }, { x, y }];
      for (let i = 0; i < cells.length; i += 1) {
        const cell = cells[i];
        if (!isValid(cell.x, cell.y)) {
          continue;
        }
        sum += renderSupport[idxAt(cell.x, cell.y)] ? 1 : 0;
        count += 1;
      }
      vertexField[vIdx(x, y)] = count > 0 ? sum / count : 0;
    }
  }
  const riverMouthOpeningEdges = sample.inlandWater?.riverMouthOpeningEdges;
  if (riverMouthOpeningEdges) {
    for (let i = 0; i + 3 < riverMouthOpeningEdges.length; i += 4) {
      const ax = Math.round(riverMouthOpeningEdges[i] ?? 0);
      const ay = Math.round(riverMouthOpeningEdges[i + 1] ?? 0);
      const bx = Math.round(riverMouthOpeningEdges[i + 2] ?? 0);
      const by = Math.round(riverMouthOpeningEdges[i + 3] ?? 0);
      if (ax >= 0 && ay >= 0 && ax <= cols && ay <= rows) {
        vertexField[vIdx(ax, ay)] = Math.max(vertexField[vIdx(ax, ay)] ?? 0, RIVER_FIELD_THRESHOLD);
      }
      if (bx >= 0 && by >= 0 && bx <= cols && by <= rows) {
        vertexField[vIdx(bx, by)] = Math.max(vertexField[vIdx(bx, by)] ?? 0, RIVER_FIELD_THRESHOLD);
      }
    }
  }
  if (RIVER_VERTEX_FIELD_BLUR_BLEND > 0) {
    const smoothed = new Float32Array(vertexField.length);
    const vIsValid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x <= cols && y <= rows;
    for (let y = 0; y <= rows; y += 1) {
      for (let x = 0; x <= cols; x += 1) {
        let sum = 0;
        let wSum = 0;
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            const sx = x + ox;
            const sy = y + oy;
            if (!vIsValid(sx, sy)) {
              continue;
            }
            const w = ox === 0 && oy === 0 ? 4 : ox === 0 || oy === 0 ? 2 : 1;
            sum += vertexField[vIdx(sx, sy)] * w;
            wSum += w;
          }
        }
        const base = vertexField[vIdx(x, y)];
        const blur = wSum > 0 ? sum / wSum : base;
        const blended = base * (1 - RIVER_VERTEX_FIELD_BLUR_BLEND) + blur * RIVER_VERTEX_FIELD_BLUR_BLEND;
        smoothed[vIdx(x, y)] = Math.max(base, blended * 0.96);
      }
    }
    vertexField.set(smoothed);
  }

  type ScalarPoint = { v: RiverContourVertex; s: number };
  type EdgeCountRecord = { count: number; a: number; b: number };
  const contourVertices: number[] = [];
  const contourIndices: number[] = [];
  const vertexToIndex = new Map<string, number>();
  const edgeCounts = new Map<string, EdgeCountRecord>();
  const quantScale = 4096;

  const quantKey = (x: number, y: number): string => `${Math.round(x * quantScale)},${Math.round(y * quantScale)}`;
  const undirectedEdgeKey = (a: number, b: number): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const getOrCreateVertexIndex = (v: RiverContourVertex): number => {
    const key = quantKey(v.x, v.y);
    const existing = vertexToIndex.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const idx = contourVertices.length / 2;
    contourVertices.push(v.x, v.y);
    vertexToIndex.set(key, idx);
    return idx;
  };
  const registerOrientedEdge = (a: number, b: number): void => {
    if (a === b) {
      return;
    }
    const key = undirectedEdgeKey(a, b);
    const existing = edgeCounts.get(key);
    if (!existing) {
      edgeCounts.set(key, { count: 1, a, b });
      return;
    }
    existing.count += 1;
  };
  const polygonArea = (poly: RiverContourPolygon): number => {
    let area = 0;
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      area += a.x * b.y - b.x * a.y;
    }
    return area * 0.5;
  };
  const cleanPolygon = (poly: RiverContourPolygon): RiverContourPolygon => {
    const out: RiverContourPolygon = [];
    for (let i = 0; i < poly.length; i += 1) {
      const cur = poly[i];
      const prev = out.length > 0 ? out[out.length - 1] : null;
      if (!prev || Math.hypot(cur.x - prev.x, cur.y - prev.y) > 1e-5) {
        out.push(cur);
      }
    }
    if (out.length >= 3) {
      const first = out[0];
      const last = out[out.length - 1];
      if (Math.hypot(first.x - last.x, first.y - last.y) <= 1e-5) {
        out.pop();
      }
    }
    return out;
  };
  const addPolygon = (polygon: RiverContourPolygon): void => {
    const cleaned = cleanPolygon(polygon);
    if (cleaned.length < 3) {
      return;
    }
    const area = polygonArea(cleaned);
    if (Math.abs(area) <= 1e-6) {
      return;
    }
    const oriented = area > 0 ? cleaned : [...cleaned].reverse();
    const polyIndices = oriented.map((v) => getOrCreateVertexIndex(v));
    for (let i = 1; i < polyIndices.length - 1; i += 1) {
      contourIndices.push(polyIndices[0], polyIndices[i], polyIndices[i + 1]);
    }
    for (let i = 0; i < polyIndices.length; i += 1) {
      registerOrientedEdge(polyIndices[i], polyIndices[(i + 1) % polyIndices.length]);
    }
  };
  const interpolate = (a: ScalarPoint, b: ScalarPoint): ScalarPoint => {
    const delta = b.s - a.s;
    const t = Math.abs(delta) <= 1e-5 ? 0.5 : clamp((RIVER_FIELD_THRESHOLD - a.s) / delta, 0, 1);
    return {
      v: {
        x: a.v.x + (b.v.x - a.v.x) * t,
        y: a.v.y + (b.v.y - a.v.y) * t
      },
      s: RIVER_FIELD_THRESHOLD
    };
  };
  const clipTriangleInside = (v0: ScalarPoint, v1: ScalarPoint, v2: ScalarPoint): RiverContourPolygon => {
    let poly: ScalarPoint[] = [v0, v1, v2];
    const out: ScalarPoint[] = [];
    for (let i = 0; i < poly.length; i += 1) {
      const cur = poly[i];
      const nxt = poly[(i + 1) % poly.length];
      const curIn = cur.s >= RIVER_FIELD_THRESHOLD;
      const nxtIn = nxt.s >= RIVER_FIELD_THRESHOLD;
      if (curIn && nxtIn) {
        out.push(nxt);
      } else if (curIn && !nxtIn) {
        out.push(interpolate(cur, nxt));
      } else if (!curIn && nxtIn) {
        out.push(interpolate(cur, nxt));
        out.push(nxt);
      }
    }
    poly = out;
    return poly.length < 3 ? [] : poly.map((point) => point.v);
  };
  const emitTriangleClipped = (
    a: RiverContourVertex,
    sa: number,
    b: RiverContourVertex,
    sb: number,
    c: RiverContourVertex,
    sc: number
  ): void => {
    const poly = clipTriangleInside({ v: a, s: sa }, { v: b, s: sb }, { v: c, s: sc });
    if (poly.length >= 3) {
      addPolygon(poly);
    }
  };

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const a: RiverContourVertex = { x, y };
      const b: RiverContourVertex = { x: x + 1, y };
      const c: RiverContourVertex = { x: x + 1, y: y + 1 };
      const d: RiverContourVertex = { x, y: y + 1 };
      const sa = vertexField[vIdx(x, y)];
      const sb = vertexField[vIdx(x + 1, y)];
      const sc = vertexField[vIdx(x + 1, y + 1)];
      const sd = vertexField[vIdx(x, y + 1)];
      const caseMask = (sa >= RIVER_FIELD_THRESHOLD ? 1 : 0) |
        (sb >= RIVER_FIELD_THRESHOLD ? 2 : 0) |
        (sc >= RIVER_FIELD_THRESHOLD ? 4 : 0) |
        (sd >= RIVER_FIELD_THRESHOLD ? 8 : 0);
      if (caseMask === 0) {
        continue;
      }
      let splitAC = true;
      if (caseMask === 5 || caseMask === 10) {
        const centerInside = (sa + sb + sc + sd) * 0.25 >= RIVER_FIELD_THRESHOLD;
        splitAC = caseMask === 5 ? centerInside : !centerInside;
      }
      if (splitAC) {
        emitTriangleClipped(a, sa, b, sb, c, sc);
        emitTriangleClipped(a, sa, c, sc, d, sd);
      } else {
        emitTriangleClipped(a, sa, b, sb, d, sd);
        emitTriangleClipped(b, sb, c, sc, d, sd);
      }
    }
  }

  if (contourIndices.length === 0 || contourVertices.length < 6) {
    return undefined;
  }

  const boundaryEdges: number[] = [];
  edgeCounts.forEach((record) => {
    if (record.count !== 1) {
      return;
    }
    const aOffset = record.a * 2;
    const bOffset = record.b * 2;
    boundaryEdges.push(
      contourVertices[aOffset],
      contourVertices[aOffset + 1],
      contourVertices[bOffset],
      contourVertices[bOffset + 1]
    );
  });

  let baseCount = 0;
  for (let i = 0; i < baseSupport.length; i += 1) {
    if (baseSupport[i]) {
      baseCount += 1;
    }
  }

  return {
    cols,
    rows,
    baseSupport,
    renderSupport,
    vertexField,
    contourVertices: new Float32Array(contourVertices),
    contourIndices: new Uint32Array(contourIndices),
    boundaryEdges: new Float32Array(boundaryEdges),
    riverMouthOpeningEdges,
    distanceToBank: buildDistanceField(renderSupport, cols, rows, 0),
    debugStats: DEBUG_TERRAIN_RENDER
      ? {
          baseCount,
          renderCount,
          contourVertexCount: contourVertices.length / 2,
          contourTriangleCount: contourIndices.length / 3,
          boundaryEdgeCount: boundaryEdges.length / 4,
          cutoutBoundaryEdgeCount: 0,
          boundaryMismatchMean: 0,
          boundaryMismatchMax: 0,
          wallQuadCount: 0,
          protrudingVertexRatio: 0,
          waterfallAnchorErrorMean: 0,
          waterfallAnchorErrorMax: 0,
          waterfallWallQuadCounts: [],
          wallTopGapMean: 0,
          wallTopGapMax: 0
        }
      : undefined
  };
};

export const buildBoundaryEdgesFromIndexedContour = (
  contourVerticesXY: Float32Array,
  contourTriIndices: ArrayLike<number>
): Float32Array => {
  type BoundaryRecord = { count: number; a: number; b: number };
  const edgeMap = new Map<string, BoundaryRecord>();
  const addEdge = (a: number, b: number): void => {
    if (a === b) {
      return;
    }
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const existing = edgeMap.get(key);
    if (!existing) {
      edgeMap.set(key, { count: 1, a, b });
      return;
    }
    existing.count += 1;
  };
  for (let i = 0; i < contourTriIndices.length; i += 3) {
    const a = contourTriIndices[i] as number;
    const b = contourTriIndices[i + 1] as number;
    const c = contourTriIndices[i + 2] as number;
    if (a < 0 || b < 0 || c < 0) {
      continue;
    }
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }
  const edges: number[] = [];
  edgeMap.forEach((record) => {
    if (record.count !== 1) {
      return;
    }
    const aOff = record.a * 2;
    const bOff = record.b * 2;
    if (aOff + 1 >= contourVerticesXY.length || bOff + 1 >= contourVerticesXY.length) {
      return;
    }
    edges.push(
      contourVerticesXY[aOff],
      contourVerticesXY[aOff + 1],
      contourVerticesXY[bOff],
      contourVerticesXY[bOff + 1]
    );
  });
  return new Float32Array(edges);
};

export type CutoutConformingRiverContourMesh = {
  vertices: Float32Array;
  indices: Uint32Array;
  boundaryVertices: Uint8Array;
};

/** Inserts exact terrain-edge intersections without moving contour vertices. */
export const buildCutoutConformingRiverContourMesh = (
  riverDomain: RiverRenderDomain
): CutoutConformingRiverContourMesh => {
  const sourceIndices = Array.from(riverDomain.contourIndices);
  // The generated contour owns XZ. Terrain-intersection vertices may split its
  // boundary edges, but existing contour vertices must never be conformed.
  const vertices = Array.from(riverDomain.contourVertices);
  const vertexCount = vertices.length / 2;
  if (vertexCount === 0 || sourceIndices.length < 3) {
    return { vertices: new Float32Array(vertices), indices: new Uint32Array(sourceIndices), boundaryVertices: new Uint8Array(vertexCount) };
  }
  const cutoutEdges = riverDomain.terrainSeam?.boundaryEdges;
  if (!cutoutEdges || cutoutEdges.length < 4) {
    return { vertices: new Float32Array(vertices), indices: new Uint32Array(sourceIndices), boundaryVertices: new Uint8Array(vertexCount) };
  }

  type BoundaryRecord = { count: number; a: number; b: number };
  type EdgeInsertion = { vertexIndex: number; tFromMin: number };
  const edgeRecords = new Map<string, BoundaryRecord>();
  const edgeKey = (a: number, b: number): string => a < b ? `${a}|${b}` : `${b}|${a}`;
  const addEdge = (a: number, b: number): void => {
    const key = edgeKey(a, b);
    const existing = edgeRecords.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      edgeRecords.set(key, { count: 1, a: Math.min(a, b), b: Math.max(a, b) });
    }
  };
  for (let i = 0; i < sourceIndices.length; i += 3) {
    const a = sourceIndices[i] as number;
    const b = sourceIndices[i + 1] as number;
    const c = sourceIndices[i + 2] as number;
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }
  const boundaryRecords = Array.from(edgeRecords.values()).filter((record) => record.count === 1);
  const insertionsByEdge = new Map<string, EdgeInsertion[]>();
  const insertedVertexByPosition = new Map<string, number>();
  const quantScale = 8192;
  const positionKey = (x: number, y: number): string => `${Math.round(x * quantScale)},${Math.round(y * quantScale)}`;
  for (let i = 0; i < vertexCount; i += 1) {
    insertedVertexByPosition.set(positionKey(vertices[i * 2], vertices[i * 2 + 1]), i);
  }
  const cutoutEndpoints = new Map<string, { x: number; y: number }>();
  for (let i = 0; i + 3 < cutoutEdges.length; i += 4) {
    cutoutEndpoints.set(positionKey(cutoutEdges[i], cutoutEdges[i + 1]), { x: cutoutEdges[i], y: cutoutEdges[i + 1] });
    cutoutEndpoints.set(positionKey(cutoutEdges[i + 2], cutoutEdges[i + 3]), { x: cutoutEdges[i + 2], y: cutoutEdges[i + 3] });
  }
  cutoutEndpoints.forEach((point, key) => {
    if (insertedVertexByPosition.has(key)) {
      return;
    }
    let bestRecord: BoundaryRecord | undefined;
    let bestT = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const record of boundaryRecords) {
      const ax = vertices[record.a * 2];
      const ay = vertices[record.a * 2 + 1];
      const bx = vertices[record.b * 2];
      const by = vertices[record.b * 2 + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const lengthSq = dx * dx + dy * dy;
      if (lengthSq <= 1e-10) continue;
      const t = clamp(((point.x - ax) * dx + (point.y - ay) * dy) / lengthSq, 0, 1);
      const distance = Math.hypot(point.x - (ax + dx * t), point.y - (ay + dy * t));
      if (distance < bestDistance) {
        bestDistance = distance;
        bestRecord = record;
        bestT = t;
      }
    }
    if (!bestRecord || bestDistance > 2 / quantScale) return;
    const newVertexIndex = vertices.length / 2;
    vertices.push(point.x, point.y);
    insertedVertexByPosition.set(key, newVertexIndex);
    const keyForEdge = edgeKey(bestRecord.a, bestRecord.b);
    const bucket = insertionsByEdge.get(keyForEdge) ?? [];
    bucket.push({ vertexIndex: newVertexIndex, tFromMin: bestT });
    insertionsByEdge.set(keyForEdge, bucket);
  });
  insertionsByEdge.forEach((insertions) => insertions.sort((a, b) => a.tFromMin - b.tFromMin));

  const outIndices: number[] = [];
  const appendOrientedEdge = (polygon: number[], a: number, b: number): void => {
    polygon.push(a);
    const insertions = insertionsByEdge.get(edgeKey(a, b));
    if (!insertions || insertions.length === 0) return;
    const ascending = a < b;
    const ordered = ascending ? insertions : insertions.slice().reverse();
    for (const insertion of ordered) polygon.push(insertion.vertexIndex);
  };
  for (let i = 0; i < sourceIndices.length; i += 3) {
    const a = sourceIndices[i] as number;
    const b = sourceIndices[i + 1] as number;
    const c = sourceIndices[i + 2] as number;
    const polygon: number[] = [];
    appendOrientedEdge(polygon, a, b);
    appendOrientedEdge(polygon, b, c);
    appendOrientedEdge(polygon, c, a);
    for (let p = 1; p < polygon.length - 1; p += 1) {
      const ia = polygon[0];
      const ib = polygon[p];
      const ic = polygon[p + 1];
      if (ia !== ib && ib !== ic && ic !== ia) outIndices.push(ia, ib, ic);
    }
  }
  const boundaryVertices = new Uint8Array(vertices.length / 2);
  for (const record of boundaryRecords) {
    boundaryVertices[record.a] = 1;
    boundaryVertices[record.b] = 1;
  }
  insertionsByEdge.forEach((insertions) => {
    for (const insertion of insertions) boundaryVertices[insertion.vertexIndex] = 1;
  });
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(outIndices), boundaryVertices };
};
