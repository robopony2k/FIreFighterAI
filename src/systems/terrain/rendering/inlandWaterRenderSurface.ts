export const INLAND_WATER_KIND_NONE = 0;
export const INLAND_WATER_KIND_RIVER = 1;
export const INLAND_WATER_KIND_LAKE = 2;

export type InlandWaterKind =
  | typeof INLAND_WATER_KIND_NONE
  | typeof INLAND_WATER_KIND_RIVER
  | typeof INLAND_WATER_KIND_LAKE;

export type InlandWaterfallSpan = {
  sourceIndex: number;
  targetIndex: number;
  centerWorldX: number;
  centerWorldZ: number;
  leftWorldX: number;
  leftWorldZ: number;
  rightWorldX: number;
  rightWorldZ: number;
  flowWorldX: number;
  flowWorldZ: number;
  topWorldY: number;
  bottomWorldY: number;
  dropWorld: number;
  halfWidthWorld: number;
  aspect: number;
};

export type InlandWaterRenderDiagnostics = {
  terrainWaterXzErrorMax: number;
  uncoveredBoundaryLengthWorld: number;
  riverLakeJoinDeltaMax: number;
  waterfallLipRunoutErrorMax: number;
  orphanMarkerCount: number;
};

export type InlandWaterRenderSurface = {
  cols: number;
  rows: number;
  width: number;
  depth: number;
  heightScale: number;
  support: Uint8Array;
  riverSupport: Uint8Array;
  lakeSupport: Uint8Array;
  kind: Uint8Array;
  surfaceWorldY: Float32Array;
  bedWorldY: Float32Array;
  stepStrength: Float32Array;
  waterfalls: InlandWaterfallSpan[];
  diagnostics: InlandWaterRenderDiagnostics;
  edgeToWorldX: (edgeX: number) => number;
  edgeToWorldZ: (edgeY: number) => number;
  cellCenterToWorldX: (cellX: number) => number;
  cellCenterToWorldZ: (cellY: number) => number;
  worldToEdgeX: (worldX: number) => number;
  worldToEdgeY: (worldZ: number) => number;
  sampleTerrainWorldYAtEdge: (edgeX: number, edgeY: number) => number;
  sampleWaterWorldYAtEdge: (edgeX: number, edgeY: number) => number;
};

export type InlandWaterRenderSurfaceInput = {
  cols: number;
  rows: number;
  width: number;
  depth: number;
  heightScale: number;
  terrainSampleCols: number;
  terrainSampleRows: number;
  terrainHeights: Float32Array;
  riverMask?: Uint8Array;
  lakeMask?: Uint16Array;
  oceanMask?: Uint8Array;
  riverSurface?: Float32Array;
  riverBed?: Float32Array;
  riverStepStrength?: Float32Array;
  lakeSurface?: Float32Array;
  waterfallSourceMask?: Uint8Array;
  waterfallTarget?: Int32Array;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const bilinear = (
  values: ArrayLike<number>,
  cols: number,
  rows: number,
  x: number,
  y: number
): number => {
  const sx = clamp(x, 0, Math.max(0, cols - 1));
  const sy = clamp(y, 0, Math.max(0, rows - 1));
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(cols - 1, x0 + 1);
  const y1 = Math.min(rows - 1, y0 + 1);
  const tx = sx - x0;
  const ty = sy - y0;
  const h00 = values[y0 * cols + x0] ?? 0;
  const h10 = values[y0 * cols + x1] ?? h00;
  const h01 = values[y1 * cols + x0] ?? h00;
  const h11 = values[y1 * cols + x1] ?? h10;
  return (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty;
};

const areAdjacent = (source: number, target: number, cols: number): boolean => {
  const sx = source % cols;
  const sy = Math.floor(source / cols);
  const tx = target % cols;
  const ty = Math.floor(target / cols);
  return Math.max(Math.abs(sx - tx), Math.abs(sy - ty)) === 1;
};

export const buildInlandWaterRenderSurface = (
  input: InlandWaterRenderSurfaceInput
): InlandWaterRenderSurface | undefined => {
  const { cols, rows, width, depth, heightScale } = input;
  const total = cols * rows;
  if (cols < 1 || rows < 1 || input.terrainHeights.length !== input.terrainSampleCols * input.terrainSampleRows) {
    return undefined;
  }
  const support = new Uint8Array(total);
  const riverSupport = new Uint8Array(total);
  const lakeSupport = new Uint8Array(total);
  const kind = new Uint8Array(total);
  const surfaceWorldY = new Float32Array(total).fill(Number.NaN);
  const bedWorldY = new Float32Array(total).fill(Number.NaN);
  const stepStrength = new Float32Array(total);
  let count = 0;
  for (let i = 0; i < total; i += 1) {
    if ((input.oceanMask?.[i] ?? 0) > 0) {
      continue;
    }
    const lake = (input.lakeMask?.[i] ?? 0) > 0 && Number.isFinite(input.lakeSurface?.[i]);
    const river = (input.riverMask?.[i] ?? 0) > 0 && Number.isFinite(input.riverSurface?.[i]);
    if (!lake && !river) {
      continue;
    }
    const surface = lake ? input.lakeSurface?.[i] : input.riverSurface?.[i];
    if (!Number.isFinite(surface)) {
      continue;
    }
    support[i] = 1;
    riverSupport[i] = river ? 1 : 0;
    lakeSupport[i] = lake ? 1 : 0;
    kind[i] = lake ? INLAND_WATER_KIND_LAKE : INLAND_WATER_KIND_RIVER;
    surfaceWorldY[i] = (surface as number) * heightScale;
    const riverBed = input.riverBed?.[i];
    const bedNorm = river && Number.isFinite(riverBed) ? (riverBed as number) : (surface as number) - 0.006;
    bedWorldY[i] = bedNorm * heightScale;
    stepStrength[i] = lake ? 0 : clamp(input.riverStepStrength?.[i] ?? 0, 0, 1);
    count += 1;
  }
  if (count === 0) {
    return undefined;
  }

  const edgeToWorldX = (edgeX: number): number => (edgeX / Math.max(1, cols) - 0.5) * width;
  const edgeToWorldZ = (edgeY: number): number => (edgeY / Math.max(1, rows) - 0.5) * depth;
  const worldToEdgeX = (worldX: number): number => (worldX / Math.max(1e-6, width) + 0.5) * cols;
  const worldToEdgeY = (worldZ: number): number => (worldZ / Math.max(1e-6, depth) + 0.5) * rows;
  const cellCenterToWorldX = (cellX: number): number => edgeToWorldX(cellX + 0.5);
  const cellCenterToWorldZ = (cellY: number): number => edgeToWorldZ(cellY + 0.5);
  const sampleTerrainWorldYAtEdge = (edgeX: number, edgeY: number): number =>
    bilinear(
      input.terrainHeights,
      input.terrainSampleCols,
      input.terrainSampleRows,
      edgeX / Math.max(1, cols) * Math.max(0, input.terrainSampleCols - 1),
      edgeY / Math.max(1, rows) * Math.max(0, input.terrainSampleRows - 1)
    ) * heightScale;
  const sampleWaterWorldYAtEdge = (edgeX: number, edgeY: number): number => {
    const cx = edgeX - 0.5;
    const cy = edgeY - 0.5;
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    let sum = 0;
    let weight = 0;
    for (let oy = 0; oy <= 1; oy += 1) {
      for (let ox = 0; ox <= 1; ox += 1) {
        const x = x0 + ox;
        const y = y0 + oy;
        if (x < 0 || y < 0 || x >= cols || y >= rows) {
          continue;
        }
        const idx = y * cols + x;
        if (!support[idx] || !Number.isFinite(surfaceWorldY[idx])) {
          continue;
        }
        const w = Math.max(0, 1 - Math.abs(cx - x)) * Math.max(0, 1 - Math.abs(cy - y));
        sum += surfaceWorldY[idx] * w;
        weight += w;
      }
    }
    if (weight > 1e-6) return sum / weight;
    const nearestX = clamp(Math.round(cx), 0, cols - 1);
    const nearestY = clamp(Math.round(cy), 0, rows - 1);
    let nearest = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let radius = 1; radius <= 3 && nearest < 0; radius += 1) {
      for (let y = Math.max(0, nearestY - radius); y <= Math.min(rows - 1, nearestY + radius); y += 1) {
        for (let x = Math.max(0, nearestX - radius); x <= Math.min(cols - 1, nearestX + radius); x += 1) {
          const idx = y * cols + x;
          if (!support[idx]) continue;
          const distance = Math.hypot(x - cx, y - cy);
          if (distance < nearestDistance) {
            nearest = idx;
            nearestDistance = distance;
          }
        }
      }
    }
    return nearest >= 0 ? surfaceWorldY[nearest] : Number.NaN;
  };

  let riverLakeJoinDeltaMax = 0;
  const waterfallEdgeKeys = new Set<string>();
  if (input.waterfallSourceMask && input.waterfallTarget) {
    for (let source = 0; source < Math.min(total, input.waterfallSourceMask.length); source += 1) {
      if (!input.waterfallSourceMask[source]) continue;
      const target = input.waterfallTarget[source] ?? -1;
      if (target >= 0 && target < total) {
        waterfallEdgeKeys.add(source < target ? `${source}|${target}` : `${target}|${source}`);
      }
    }
  }
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const idx = y * cols + x;
      if (!support[idx]) continue;
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= cols || ny >= rows) continue;
        const nIdx = ny * cols + nx;
        if (!support[nIdx] || kind[idx] === kind[nIdx]) continue;
        const edgeKey = idx < nIdx ? `${idx}|${nIdx}` : `${nIdx}|${idx}`;
        if (waterfallEdgeKeys.has(edgeKey)) continue;
        riverLakeJoinDeltaMax = Math.max(riverLakeJoinDeltaMax, Math.abs(surfaceWorldY[idx] - surfaceWorldY[nIdx]));
      }
    }
  }

  const waterfalls: InlandWaterfallSpan[] = [];
  let orphanMarkerCount = 0;
  const sourceMask = input.waterfallSourceMask;
  const targetMap = input.waterfallTarget;
  if (sourceMask && targetMap) {
    const cellWorld = Math.min(width / Math.max(1, cols), depth / Math.max(1, rows));
    for (let source = 0; source < Math.min(total, sourceMask.length); source += 1) {
      if (!sourceMask[source]) continue;
      const target = targetMap[source] ?? -1;
      if (
        target < 0 || target >= total || !areAdjacent(source, target, cols) ||
        !support[source] || !support[target] ||
        !Number.isFinite(surfaceWorldY[source]) || !Number.isFinite(surfaceWorldY[target]) ||
        surfaceWorldY[source] <= surfaceWorldY[target]
      ) {
        orphanMarkerCount += 1;
        continue;
      }
      const sx = source % cols;
      const sy = Math.floor(source / cols);
      const tx = target % cols;
      const ty = Math.floor(target / cols);
      const sourceX = cellCenterToWorldX(sx);
      const sourceZ = cellCenterToWorldZ(sy);
      const targetX = cellCenterToWorldX(tx);
      const targetZ = cellCenterToWorldZ(ty);
      const centerWorldX = (sourceX + targetX) * 0.5;
      const centerWorldZ = (sourceZ + targetZ) * 0.5;
      const flowLength = Math.hypot(targetX - sourceX, targetZ - sourceZ);
      const flowWorldX = (targetX - sourceX) / Math.max(1e-6, flowLength);
      const flowWorldZ = (targetZ - sourceZ) / Math.max(1e-6, flowLength);
      const crossX = -flowWorldZ;
      const crossZ = flowWorldX;
      const isSupportedAt = (worldX: number, worldZ: number): boolean => {
        const edgeX = worldToEdgeX(worldX);
        const edgeY = worldToEdgeY(worldZ);
        const x = Math.floor(edgeX);
        const y = Math.floor(edgeY);
        return x >= 0 && y >= 0 && x < cols && y < rows && support[y * cols + x] > 0;
      };
      const scanSide = (sign: number): number => {
        let last = cellWorld * 0.45;
        for (let distance = cellWorld * 0.25; distance <= cellWorld * 4; distance += cellWorld * 0.25) {
          const px = centerWorldX + crossX * distance * sign;
          const pz = centerWorldZ + crossZ * distance * sign;
          const upstream = isSupportedAt(px - flowWorldX * cellWorld * 0.2, pz - flowWorldZ * cellWorld * 0.2);
          const downstream = isSupportedAt(px + flowWorldX * cellWorld * 0.2, pz + flowWorldZ * cellWorld * 0.2);
          if (!upstream && !downstream) break;
          last = distance;
        }
        return last;
      };
      const leftExtent = scanSide(-1);
      const rightExtent = scanSide(1);
      const topWorldY = surfaceWorldY[source];
      const bottomWorldY = surfaceWorldY[target];
      const halfWidthWorld = (leftExtent + rightExtent) * 0.5;
      waterfalls.push({
        sourceIndex: source,
        targetIndex: target,
        centerWorldX,
        centerWorldZ,
        leftWorldX: centerWorldX - crossX * leftExtent,
        leftWorldZ: centerWorldZ - crossZ * leftExtent,
        rightWorldX: centerWorldX + crossX * rightExtent,
        rightWorldZ: centerWorldZ + crossZ * rightExtent,
        flowWorldX,
        flowWorldZ,
        topWorldY,
        bottomWorldY,
        dropWorld: topWorldY - bottomWorldY,
        halfWidthWorld,
        aspect: clamp((topWorldY - bottomWorldY) / Math.max(cellWorld, halfWidthWorld * 2), 0, 1)
      });
    }
  }

  return {
    cols,
    rows,
    width,
    depth,
    heightScale,
    support,
    riverSupport,
    lakeSupport,
    kind,
    surfaceWorldY,
    bedWorldY,
    stepStrength,
    waterfalls,
    diagnostics: {
      terrainWaterXzErrorMax: 0,
      uncoveredBoundaryLengthWorld: 0,
      riverLakeJoinDeltaMax,
      waterfallLipRunoutErrorMax: 0,
      orphanMarkerCount
    },
    edgeToWorldX,
    edgeToWorldZ,
    cellCenterToWorldX,
    cellCenterToWorldZ,
    worldToEdgeX,
    worldToEdgeY,
    sampleTerrainWorldYAtEdge,
    sampleWaterWorldYAtEdge
  };
};
