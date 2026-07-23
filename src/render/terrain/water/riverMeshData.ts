import * as THREE from "three";
import {
  buildInlandWaterfallMeshData,
  splitInlandWaterSurfaceAtWaterfalls,
  type InlandWaterMeshData
} from "../../../systems/terrain/rendering/inlandWaterMeshBuilder.js";
import {
  INLAND_WATER_KIND_LAKE,
  type InlandWaterRenderSurface
} from "../../../systems/terrain/rendering/inlandWaterRenderSurface.js";
import {
  findInlandWaterTerrainSeamVertex,
  sampleInlandWaterEdgeMotionFactor
} from "../../../systems/terrain/rendering/inlandWaterTerrainSeam.js";
import {
  buildBoundaryEdgesFromIndexedContour,
  buildCutoutConformingRiverContourMesh,
  type RiverContourVertex,
  type RiverDomainDebugStats,
  type RiverRenderDomain
} from "./riverRenderDomain.js";
import { buildWaterfallInfluenceMap } from "./waterfallBuilder.js";
import { createRiverSpaceTransform } from "./waterSampling.js";
import {
  buildRapidMapTexture,
  buildRiverBankMapTexture,
  buildRiverFlowTexture,
  buildWaterSupportMapTexture,
  type WaterSampleRatios
} from "./waterTextures.js";

export type RiverWaterData = InlandWaterMeshData & {
  wallPositions?: Float32Array;
  wallUvs?: Float32Array;
  wallIndices?: Uint32Array;
  supportMap: THREE.DataTexture;
  flowMap: THREE.DataTexture;
  rapidMap: THREE.DataTexture;
  riverBankMap: THREE.DataTexture;
  waterfallInfluenceMap: THREE.DataTexture;
  debugRiverDomainStats?: RiverDomainDebugStats;
};

type RiverMeshDataSample = {
  cols: number;
  rows: number;
  elevations: Float32Array;
  tileTypes?: Uint8Array;
  riverSurface?: Float32Array;
  riverBed?: Float32Array;
  riverStepStrength?: Float32Array;
  inlandWater?: InlandWaterRenderSurface;
};

type RiverMeshDataBuildDeps = {
  riverSurfaceBankClearance: number;
  waterSurfaceLiftRiver: number;
};

const RIVER_MIN_DEPTH_NORM = 0.006;
const RIVER_MIN_VISUAL_WIDTH_CELLS = 1.35;
const RIVER_EDGE_SURFACE_UNDERSHOOT = 0.002;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const noiseAt = (value: number): number => {
  const s = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};
export const buildRiverMeshData = (
  sample: RiverMeshDataSample,
  waterId: number,
  heightScale: number,
  width: number,
  depth: number,
  waterLevelWorld: number,
  riverDomain: RiverRenderDomain | undefined,
  inlandWater: InlandWaterRenderSurface | undefined,
  deps: RiverMeshDataBuildDeps
): RiverWaterData | undefined => {
  if (!sample.tileTypes || !riverDomain) {
    return undefined;
  }
  const cols = sample.cols;
  const rows = sample.rows;
  if (cols < 2 || rows < 2) {
    return undefined;
  }
  if (riverDomain.contourIndices.length < 3 || riverDomain.contourVertices.length < 6) {
    return undefined;
  }
  const riverSurface = sample.riverSurface;
  const total = cols * rows;
  const riverSupportBase = riverDomain.baseSupport;
  const renderSupport = riverDomain.renderSupport;

  const isValid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < cols && y < rows;
  const idxAt = (x: number, y: number): number => y * cols + x;
  const renderedTerrainWorldAtCell = (x: number, y: number): number =>
    inlandWater?.sampleTerrainWorldYAtEdge(x + 0.5, y + 0.5) ??
    (sample.elevations[idxAt(x, y)] ?? 0) * heightScale;

  const riverRatio = new Float32Array(total);
  const riverTypes = new Uint8Array(total);
  const surfaceNorm = new Float32Array(total);
  const rapidAttrCenter = new Float32Array(total);
  const lakeFactorCenter = new Float32Array(total);
  const flowSpeedCenter = new Float32Array(total);
  const flowDirX = new Float32Array(total);
  const flowDirY = new Float32Array(total);
  const surfaceWorld = new Float32Array(total).fill(Number.NaN);
  const riverBed = sample.riverBed;
  const riverStepStrength = inlandWater?.stepStrength ?? sample.riverStepStrength;
  const minDepthWorld = RIVER_MIN_DEPTH_NORM * heightScale;

  for (let i = 0; i < total; i += 1) {
    if (!renderSupport[i]) {
      continue;
    }
    riverRatio[i] = 1;
    riverTypes[i] = waterId;
  }

  const sampleSurfaceWorld = (idx: number): number => {
    if (!renderSupport[idx]) {
      return renderedTerrainWorldAtCell(idx % cols, Math.floor(idx / cols));
    }
    const source = riverSupportBase[idx] > 0;
    let surfaceY = renderedTerrainWorldAtCell(idx % cols, Math.floor(idx / cols));
    let bedY = surfaceY - minDepthWorld;
    if (source) {
      const authoritativeSurface = inlandWater?.surfaceWorldY[idx];
      const authoritativeBed = inlandWater?.bedWorldY[idx];
      const surface = Number.isFinite(authoritativeSurface)
        ? (authoritativeSurface as number) / heightScale
        : Number.isFinite(riverSurface?.[idx])
          ? clamp(riverSurface?.[idx] as number, 0, 1)
          : sample.elevations[idx] ?? 0;
      const bed = Number.isFinite(authoritativeBed)
        ? (authoritativeBed as number) / heightScale
        : Number.isFinite(riverBed?.[idx])
          ? clamp(riverBed?.[idx] as number, 0, 1)
          : surface - RIVER_MIN_DEPTH_NORM;
      surfaceY = surface * heightScale;
      bedY = bed * heightScale;
    } else {
      let sum = 0;
      let count = 0;
      const x = idx % cols;
      const y = Math.floor(idx / cols);
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
          const nIdx = idxAt(nx, ny);
          if (!riverSupportBase[nIdx]) {
            continue;
          }
          const authoritativeNeighbor = inlandWater?.surfaceWorldY[nIdx];
          const nSurface = Number.isFinite(authoritativeNeighbor)
            ? (authoritativeNeighbor as number) / heightScale
            : Number.isFinite(riverSurface?.[nIdx])
              ? clamp(riverSurface?.[nIdx] as number, 0, 1)
              : sample.elevations[nIdx] ?? 0;
          sum += nSurface * heightScale;
          count += 1;
        }
      }
      if (count > 0) {
        surfaceY = sum / count;
      }
      bedY = surfaceY - minDepthWorld;
    }
    surfaceY = Math.max(surfaceY, bedY + minDepthWorld);
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    let minBankWorld = Number.POSITIVE_INFINITY;
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
          const nIdx = idxAt(nx, ny);
          if (renderSupport[nIdx]) {
            continue;
          }
          minBankWorld = Math.min(minBankWorld, renderedTerrainWorldAtCell(nx, ny));
      }
    }
    if (Number.isFinite(minBankWorld)) {
      surfaceY = Math.min(surfaceY, minBankWorld - deps.riverSurfaceBankClearance);
    }
    return surfaceY;
  };

  for (let i = 0; i < total; i += 1) {
    if (!renderSupport[i]) {
      continue;
    }
    surfaceWorld[i] = sampleSurfaceWorld(i);
    surfaceNorm[i] = clamp(surfaceWorld[i] / Math.max(1e-4, heightScale), 0, 1);
    const step = Number.isFinite(riverStepStrength?.[i]) ? clamp(riverStepStrength?.[i] as number, 0, 1) : 0;
    rapidAttrCenter[i] = step;
    lakeFactorCenter[i] = inlandWater?.kind[i] === INLAND_WATER_KIND_LAKE ? 1 : 0;
  }


  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const idx = idxAt(x, y);
      if (!renderSupport[idx]) {
        continue;
      }
      const center = surfaceWorld[idx];
      surfaceNorm[idx] = clamp(center / Math.max(1e-4, heightScale), 0, 1);
      const left = isValid(x - 1, y) && renderSupport[idxAt(x - 1, y)] ? surfaceWorld[idxAt(x - 1, y)] : center;
      const right = isValid(x + 1, y) && renderSupport[idxAt(x + 1, y)] ? surfaceWorld[idxAt(x + 1, y)] : center;
      const up = isValid(x, y - 1) && renderSupport[idxAt(x, y - 1)] ? surfaceWorld[idxAt(x, y - 1)] : center;
      const down = isValid(x, y + 1) && renderSupport[idxAt(x, y + 1)] ? surfaceWorld[idxAt(x, y + 1)] : center;
      let dx = left - right;
      let dy = up - down;
      const len = Math.hypot(dx, dy);
      if (len <= 1e-5) {
        const n = noiseAt(idx * 0.37 + 1.7) * Math.PI * 2;
        dx = Math.cos(n);
        dy = Math.sin(n);
      } else {
        dx /= len;
        dy /= len;
      }
      flowDirX[idx] = dx;
      flowDirY[idx] = dy;
      const grad = Math.hypot(right - left, down - up);
      rapidAttrCenter[idx] = clamp(rapidAttrCenter[idx] * 0.65 + grad * 0.42, 0, 1);
      flowSpeedCenter[idx] = clamp(0.35 + grad * 5.0 + rapidAttrCenter[idx] * 1.2, 0.25, 2.4);
    }
  }

  const riverSupportMap = buildWaterSupportMapTexture(cols, rows, renderSupport);
  const riverFlowMap = buildRiverFlowTexture(surfaceNorm, riverTypes, cols, rows, waterId, riverRatio);
  const riverRatios: WaterSampleRatios = { water: riverRatio, ocean: new Float32Array(total), river: riverRatio };
  const riverRapidMap = buildRapidMapTexture(surfaceNorm, cols, rows, riverRatios, riverStepStrength);
  const riverBankMap = buildRiverBankMapTexture(cols, rows, renderSupport, riverRatio);
  const riverWaterfallInfluence = buildWaterfallInfluenceMap(
    cols,
    rows,
    width,
    depth,
    renderSupport,
    surfaceNorm,
    riverStepStrength,
    undefined
  );

  const positions: number[] = [];
  const uvs: number[] = [];
  const bankDist: number[] = [];
  const flowDir: number[] = [];
  const flowSpeed: number[] = [];
  const rapid: number[] = [];
  const lakeFactor: number[] = [];
  const riverMouthBlend: number[] = [];
  const edgeMotionFactor: number[] = [];
  const conformingContourMesh = buildCutoutConformingRiverContourMesh(riverDomain);
  const indices = Array.from(conformingContourMesh.indices);
  const distToNonRiver = riverDomain.distanceToBank;
  const renderContourVertices = conformingContourMesh.vertices;
  if (inlandWater && riverDomain.terrainSeam) {
    const waterBoundary = buildBoundaryEdgesFromIndexedContour(renderContourVertices, indices);
    const seam = riverDomain.terrainSeam;
    let maxSegmentErrorWorld = 0;
    let uncoveredBoundaryLengthWorld = 0;
    // Render attributes are Float32; compare the canonical shared IDs at a
    // precision comfortably above their conversion error.
    const quantScale = Math.min(2048, seam.quantScale);
    const pointKey = (x: number, y: number): string => `${Math.round(x * quantScale)},${Math.round(y * quantScale)}`;
    const segmentKey = (ax: number, ay: number, bx: number, by: number): string => {
      const a = pointKey(ax, ay);
      const b = pointKey(bx, by);
      return a < b ? `${a}|${b}` : `${b}|${a}`;
    };
    const waterSegmentKeys = new Set<string>();
    const float32WorldTolerance = Math.max(
      inlandWater.width / Math.max(1, inlandWater.cols),
      inlandWater.depth / Math.max(1, inlandWater.rows)
    ) * 2e-5;
    for (let edge = 0; edge + 3 < waterBoundary.length; edge += 4) {
      waterSegmentKeys.add(segmentKey(
        waterBoundary[edge],
        waterBoundary[edge + 1],
        waterBoundary[edge + 2],
        waterBoundary[edge + 3]
      ));
    }
    const pointDistanceWorld = (x: number, y: number): number => {
        let best = Number.POSITIVE_INFINITY;
        for (let edge = 0; edge + 3 < waterBoundary.length; edge += 4) {
          const ax = waterBoundary[edge];
          const ay = waterBoundary[edge + 1];
          const bx = waterBoundary[edge + 2];
          const by = waterBoundary[edge + 3];
          const dx = bx - ax;
          const dy = by - ay;
          const lengthSq = dx * dx + dy * dy;
          const t = lengthSq > 1e-10 ? clamp(((x - ax) * dx + (y - ay) * dy) / lengthSq, 0, 1) : 0;
          const worldDx = inlandWater.edgeToWorldX(x) - inlandWater.edgeToWorldX(ax + dx * t);
          const worldDz = inlandWater.edgeToWorldZ(y) - inlandWater.edgeToWorldZ(ay + dy * t);
          best = Math.min(best, Math.hypot(worldDx, worldDz));
        }
        return best;
    };
    for (const segment of seam.segments) {
      const a = seam.vertices[segment.a];
      const b = seam.vertices[segment.b];
      if (waterSegmentKeys.has(segmentKey(a.edgeX, a.edgeY, b.edgeX, b.edgeY))) continue;
      const midpointX = (a.edgeX + b.edgeX) * 0.5;
      const midpointY = (a.edgeY + b.edgeY) * 0.5;
      const segmentError = Math.max(
        pointDistanceWorld(a.edgeX, a.edgeY),
        pointDistanceWorld(b.edgeX, b.edgeY),
        pointDistanceWorld(midpointX, midpointY)
      );
      if (segmentError <= float32WorldTolerance) continue;
      maxSegmentErrorWorld = Math.max(maxSegmentErrorWorld, segmentError);
      if (segmentError > 1e-5) {
        uncoveredBoundaryLengthWorld += Math.hypot(
          inlandWater.edgeToWorldX(b.edgeX) - inlandWater.edgeToWorldX(a.edgeX),
          inlandWater.edgeToWorldZ(b.edgeY) - inlandWater.edgeToWorldZ(a.edgeY)
        );
      }
    }
    seam.diagnostics.segmentXzErrorMax = maxSegmentErrorWorld;
    inlandWater.diagnostics.terrainWaterXzErrorMax = maxSegmentErrorWorld;
    inlandWater.diagnostics.segmentXzErrorMax = maxSegmentErrorWorld;
    inlandWater.diagnostics.uncoveredBoundaryLengthWorld = uncoveredBoundaryLengthWorld;
  }

  const riverSpace = createRiverSpaceTransform(cols, rows, width, depth, cols + 1, rows + 1);
  const worldXEdge = (x: number): number => riverSpace.edgeToWorldX(x);
  const worldZEdge = (y: number): number => riverSpace.edgeToWorldY(y);
  const sampleFromCells = (fx: number, fy: number, getter: (idx: number) => number): number => {
    const cx = fx - 0.5;
    const cy = fy - 0.5;
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    let sum = 0;
    let wSum = 0;
    for (let oy = 0; oy <= 1; oy += 1) {
      for (let ox = 0; ox <= 1; ox += 1) {
        const sx = x0 + ox;
        const sy = y0 + oy;
        if (!isValid(sx, sy)) {
          continue;
        }
        const idx = idxAt(sx, sy);
        if (!renderSupport[idx]) {
          continue;
        }
        const wx = 1 - Math.abs(cx - sx);
        const wy = 1 - Math.abs(cy - sy);
        const w = Math.max(0, wx) * Math.max(0, wy);
        if (w <= 1e-5) {
          continue;
        }
        const value = getter(idx);
        if (!Number.isFinite(value)) {
          continue;
        }
        sum += value * w;
        wSum += w;
      }
    }
    if (wSum > 1e-5) {
      return sum / wSum;
    }
    const nearestX = clamp(Math.round(cx), 0, cols - 1);
    const nearestY = clamp(Math.round(cy), 0, rows - 1);
    let bestIdx = -1;
    let bestDistSq = Number.POSITIVE_INFINITY;
    for (let radius = 0; radius <= 5 && bestIdx < 0; radius += 1) {
      const minX = Math.max(0, nearestX - radius);
      const maxX = Math.min(cols - 1, nearestX + radius);
      const minY = Math.max(0, nearestY - radius);
      const maxY = Math.min(rows - 1, nearestY + radius);
      for (let sy = minY; sy <= maxY; sy += 1) {
        for (let sx = minX; sx <= maxX; sx += 1) {
          const idx = idxAt(sx, sy);
          if (!renderSupport[idx]) {
            continue;
          }
          const dx = sx - cx;
          const dy = sy - cy;
          const distSq = dx * dx + dy * dy;
          if (distSq < bestDistSq) {
            bestDistSq = distSq;
            bestIdx = idx;
          }
        }
      }
    }
    if (bestIdx >= 0) {
      return getter(bestIdx);
    }
    return Number.NaN;
  };
  const sampleSurfaceOffset = (fx: number, fy: number): number => {
    const surface = sampleFromCells(fx, fy, (idx) => surfaceWorld[idx]);
    let topWorld = surface;
    let minBankWorld = Number.POSITIVE_INFINITY;
    const vx = Math.floor(fx);
    const vy = Math.floor(fy);
    const candidates = [
      { x: vx - 1, y: vy - 1 },
      { x: vx, y: vy - 1 },
      { x: vx - 1, y: vy },
      { x: vx, y: vy }
    ];
    for (let i = 0; i < candidates.length; i += 1) {
      const c = candidates[i];
      if (!isValid(c.x, c.y)) {
        continue;
      }
      const idx = idxAt(c.x, c.y);
      if (renderSupport[idx]) {
        continue;
      }
      minBankWorld = Math.min(minBankWorld, renderedTerrainWorldAtCell(c.x, c.y));
    }
    if (Number.isFinite(minBankWorld)) {
      topWorld = Math.min(topWorld, minBankWorld - RIVER_EDGE_SURFACE_UNDERSHOOT);
    }
    if (!Number.isFinite(topWorld)) {
      return deps.waterSurfaceLiftRiver;
    }
    return topWorld - waterLevelWorld + deps.waterSurfaceLiftRiver;
  };
  const sampleBankDist = (fx: number, fy: number): number => {
    const value = sampleFromCells(fx, fy, (idx) => (distToNonRiver[idx] >= 0 ? distToNonRiver[idx] : 0));
    return clamp((Number.isFinite(value) ? value : 0) / Math.max(2, RIVER_MIN_VISUAL_WIDTH_CELLS * 2.5), 0, 1);
  };
  const sampleFlow = (fx: number, fy: number): { x: number; y: number } => {
    const x = sampleFromCells(fx, fy, (idx) => flowDirX[idx]);
    const y = sampleFromCells(fx, fy, (idx) => flowDirY[idx]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { x: 1, y: 0 };
    }
    const len = Math.hypot(x, y) || 1;
    return { x: x / len, y: y / len };
  };
  const sampleRapid = (fx: number, fy: number): number => {
    const value = sampleFromCells(fx, fy, (idx) => rapidAttrCenter[idx]);
    return clamp(Number.isFinite(value) ? value : 0, 0, 1);
  };
  const sampleFlowSpeed = (fx: number, fy: number): number => {
    const value = sampleFromCells(fx, fy, (idx) => flowSpeedCenter[idx]);
    return clamp(Number.isFinite(value) ? value : 0.35, 0.25, 2.4);
  };
  const sampleLakeFactor = (fx: number, fy: number): number => {
    const value = sampleFromCells(fx, fy, (idx) => lakeFactorCenter[idx]);
    return clamp(Number.isFinite(value) ? value : 0, 0, 1);
  };
  const sampleRiverMouthBlend = (fx: number, fy: number): number => {
    const value = sampleFromCells(fx, fy, (idx) => inlandWater?.riverMouthBlend[idx] ?? 0);
    return clamp(Number.isFinite(value) ? value : 0, 0, 1);
  };
  const addVertex = (v: RiverContourVertex): void => {
    const flow = sampleFlow(v.x, v.y);
    let waterOffset = sampleSurfaceOffset(v.x, v.y);
    const seamVertex = riverDomain.terrainSeam
      ? findInlandWaterTerrainSeamVertex(riverDomain.terrainSeam, v.x, v.y)
      : undefined;
    if (seamVertex) {
      waterOffset = seamVertex.waterWorldY - waterLevelWorld;
    }
    positions.push(worldXEdge(v.x), waterOffset, worldZEdge(v.y));
    uvs.push(v.x / Math.max(1, cols), v.y / Math.max(1, rows));
    bankDist.push(sampleBankDist(v.x, v.y));
    flowDir.push(flow.x, flow.y);
    flowSpeed.push(sampleFlowSpeed(v.x, v.y));
    rapid.push(sampleRapid(v.x, v.y));
    lakeFactor.push(sampleLakeFactor(v.x, v.y));
    riverMouthBlend.push(sampleRiverMouthBlend(v.x, v.y));
    edgeMotionFactor.push(sampleInlandWaterEdgeMotionFactor(riverDomain.terrainSeam, v.x, v.y));
  };
  for (let i = 0; i < renderContourVertices.length; i += 2) {
    addVertex({
      x: renderContourVertices[i],
      y: renderContourVertices[i + 1]
    });
  }
  if (indices.length === 0 || positions.length / 3 !== renderContourVertices.length / 2) {
    return undefined;
  }
  const splitSurfaceMesh = splitInlandWaterSurfaceAtWaterfalls(
    { positions, uvs, indices, bankDist, flowDir, flowSpeed, rapid, lakeFactor, riverMouthBlend, edgeMotionFactor },
    inlandWater?.waterfalls ?? [],
    waterLevelWorld
  );
  const explicitWaterfallMesh = buildInlandWaterfallMeshData(inlandWater?.waterfalls ?? [], waterLevelWorld);
  if (riverDomain.debugStats) {
    riverDomain.debugStats.waterfallWallQuadCounts = (inlandWater?.waterfalls ?? []).map(() => 1);
    riverDomain.debugStats.waterfallAnchorErrorMean = 0;
    riverDomain.debugStats.waterfallAnchorErrorMax = 0;
  }
  return {
    positions: new Float32Array(splitSurfaceMesh.positions),
    uvs: new Float32Array(splitSurfaceMesh.uvs),
    indices: new Uint32Array(splitSurfaceMesh.indices),
    wallPositions: undefined,
    wallUvs: undefined,
    wallIndices: undefined,
    waterfallWallPositions:
      explicitWaterfallMesh.waterfallPositions.length > 0
        ? explicitWaterfallMesh.waterfallPositions
        : undefined,
    waterfallWallUvs: explicitWaterfallMesh.waterfallUvs.length > 0 ? explicitWaterfallMesh.waterfallUvs : undefined,
    waterfallWallIndices:
      explicitWaterfallMesh.waterfallIndices.length > 0
        ? explicitWaterfallMesh.waterfallIndices
        : undefined,
    waterfallWallDropNorm:
      explicitWaterfallMesh.waterfallDropNorm.length > 0
        ? explicitWaterfallMesh.waterfallDropNorm
        : undefined,
    waterfallWallFallStyle:
      explicitWaterfallMesh.waterfallFallStyle.length > 0
        ? explicitWaterfallMesh.waterfallFallStyle
        : undefined,
    bankDist: new Float32Array(splitSurfaceMesh.bankDist),
    flowDir: new Float32Array(splitSurfaceMesh.flowDir),
    flowSpeed: new Float32Array(splitSurfaceMesh.flowSpeed),
    rapid: new Float32Array(splitSurfaceMesh.rapid),
    lakeFactor: new Float32Array(splitSurfaceMesh.lakeFactor),
    riverMouthBlend: new Float32Array(splitSurfaceMesh.riverMouthBlend),
    edgeMotionFactor: new Float32Array(splitSurfaceMesh.edgeMotionFactor),
    supportMap: riverSupportMap,
    flowMap: riverFlowMap,
    rapidMap: riverRapidMap,
    riverBankMap,
    waterfallInfluenceMap: riverWaterfallInfluence,
    level: waterLevelWorld,
    cols,
    rows,
    width,
    depth,
    debugRiverDomainStats: riverDomain.debugStats
  };
};

