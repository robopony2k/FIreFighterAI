import * as THREE from "three";
import {
  buildBoundaryEdgesFromIndexedContour,
  buildSnappedRiverContourVertices,
  type RiverContourEdge,
  type RiverContourVertex,
  type RiverDomainDebugStats,
  type RiverRenderDomain
} from "./riverRenderDomain.js";
import {
  WATERFALL_TOP_OFFSET,
  buildWaterfallInfluenceMap,
  describeWaterfallShape
} from "./waterfallBuilder.js";
import { createRiverSpaceTransform } from "./waterSampling.js";
import {
  buildRapidMapTexture,
  buildRiverBankMapTexture,
  buildRiverFlowTexture,
  buildWaterSupportMapTexture,
  type WaterSampleRatios
} from "./waterTextures.js";

export type RiverWaterData = {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  wallPositions?: Float32Array;
  wallUvs?: Float32Array;
  wallIndices?: Uint32Array;
  waterfallWallPositions?: Float32Array;
  waterfallWallUvs?: Float32Array;
  waterfallWallIndices?: Uint32Array;
  waterfallWallDropNorm?: Float32Array;
  waterfallWallFallStyle?: Float32Array;
  bankDist: Float32Array;
  flowDir: Float32Array;
  flowSpeed: Float32Array;
  rapid: Float32Array;
  supportMap: THREE.DataTexture;
  flowMap: THREE.DataTexture;
  rapidMap: THREE.DataTexture;
  riverBankMap: THREE.DataTexture;
  waterfallInfluenceMap: THREE.DataTexture;
  level: number;
  cols: number;
  rows: number;
  width: number;
  depth: number;
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
};

type RiverMeshDataBuildDeps = {
  riverSurfaceBankClearance: number;
  waterSurfaceLiftRiver: number;
};

const RIVER_MIN_DEPTH_NORM = 0.006;
const RIVER_MIN_VISUAL_WIDTH_CELLS = 1.35;
const BANK_INSET = 0.004;
const WALL_MIN_HEIGHT = 0.02;
const WALL_RISE_GUARD = 0.001;
const WALL_TOP_OVERLAP = 0.0012;
const WALL_TOP_MAX_UNDERCUT = 0.0004;
const WALL_WATER_OVERLAP = 0.002;
const RIVER_EDGE_SURFACE_UNDERSHOOT = 0.002;
const WALL_TOP_GAP_WARN = 0.05;
const ENABLE_RIVER_WATERFALL_GEOMETRY = false;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  if (edge0 === edge1) {
    return x < edge0 ? 0 : 1;
  }
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

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
  waterfallInstances: Float32Array | undefined,
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

  const riverRatio = new Float32Array(total);
  const riverTypes = new Uint8Array(total);
  const surfaceNorm = new Float32Array(total);
  const rapidAttrCenter = new Float32Array(total);
  const flowSpeedCenter = new Float32Array(total);
  const flowDirX = new Float32Array(total);
  const flowDirY = new Float32Array(total);
  const surfaceWorld = new Float32Array(total).fill(Number.NaN);
  const lipSurfaceOverride = new Float32Array(total).fill(Number.NaN);
  const riverBed = sample.riverBed;
  const riverStepStrength = sample.riverStepStrength;
  const minDepthWorld = RIVER_MIN_DEPTH_NORM * heightScale;
  const riverCellWorldX = width / Math.max(1, cols - 1);
  const riverCellWorldZ = depth / Math.max(1, rows - 1);
  const riverCellWorld = Math.max(1e-4, Math.min(riverCellWorldX, riverCellWorldZ));
  type WaterfallWallProfile = {
    centerX: number;
    centerZ: number;
    topOffset: number;
    lipOffset: number;
    drop: number;
    flowX: number;
    flowZ: number;
    crossX: number;
    crossZ: number;
    halfWidth: number;
    fallStyle: number;
    dropNorm: number;
    lipBandBack: number;
    lipBandForward: number;
    lateralLimit: number;
    topTolerance: number;
    heightTolerance: number;
  };
  const waterfallWallProfiles: WaterfallWallProfile[] = [];

  for (let i = 0; i < total; i += 1) {
    if (!renderSupport[i]) {
      continue;
    }
    riverRatio[i] = 1;
    riverTypes[i] = waterId;
  }

  const sampleSurfaceWorld = (idx: number): number => {
    if (!renderSupport[idx]) {
      return (sample.elevations[idx] ?? 0) * heightScale;
    }
    const source = riverSupportBase[idx] > 0;
    let surfaceY = (sample.elevations[idx] ?? 0) * heightScale;
    let bedY = surfaceY - minDepthWorld;
    if (source) {
      const surface = Number.isFinite(riverSurface?.[idx]) ? clamp(riverSurface?.[idx] as number, 0, 1) : sample.elevations[idx] ?? 0;
      const bed = Number.isFinite(riverBed?.[idx]) ? clamp(riverBed?.[idx] as number, 0, 1) : surface - RIVER_MIN_DEPTH_NORM;
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
          const nSurface = Number.isFinite(riverSurface?.[nIdx]) ? clamp(riverSurface?.[nIdx] as number, 0, 1) : sample.elevations[nIdx] ?? 0;
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
          minBankWorld = Math.min(minBankWorld, (sample.elevations[nIdx] ?? 0) * heightScale);
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
  }

  if (ENABLE_RIVER_WATERFALL_GEOMETRY && waterfallInstances && waterfallInstances.length >= 7) {
    const instanceCount = Math.floor(waterfallInstances.length / 7);
    for (let i = 0; i < instanceCount; i += 1) {
      const base = i * 7;
      const centerX = waterfallInstances[base];
      const centerZ = waterfallInstances[base + 1];
      const topOffset = waterfallInstances[base + 2];
      const drop = Math.max(0.1, waterfallInstances[base + 3]);
      const dirX = waterfallInstances[base + 4];
      const dirZ = waterfallInstances[base + 5];
      const halfWidth = Math.max(0.08, waterfallInstances[base + 6]);
      const dirLen = Math.hypot(dirX, dirZ);
      if (dirLen <= 1e-5) {
        continue;
      }
      const flowX = dirX / dirLen;
      const flowZ = dirZ / dirLen;
      const shape = describeWaterfallShape(drop, halfWidth);
      const lipSurface = waterLevelWorld + topOffset - WATERFALL_TOP_OFFSET;
      const poolSurface = lipSurface - drop + Math.min(0.018, drop * 0.12);
      const lipShelfLen = Math.max(riverCellWorld * 0.42, halfWidth * lerp(0.18, 0.3, shape.fallStyle));
      const descentLen = clamp(
        Math.max(riverCellWorld * lerp(0.08, 0.16, shape.fallStyle), halfWidth * lerp(0.03, 0.06, shape.fallStyle)),
        riverCellWorld * 0.08,
        riverCellWorld * 0.2
      );
      const plungePoolLen = Math.max(riverCellWorld * lerp(0.6, 0.9, shape.fallStyle), halfWidth * lerp(0.32, 0.48, shape.fallStyle));
      const recoveryLen = Math.max(riverCellWorld * lerp(0.46, 0.72, shape.fallStyle), halfWidth * 0.28);
      const downstreamLen = descentLen + plungePoolLen + recoveryLen;
      waterfallWallProfiles.push({
        centerX,
        centerZ,
        topOffset,
        lipOffset: lipSurface - waterLevelWorld,
        drop,
        flowX,
        flowZ,
        crossX: -flowZ,
        crossZ: flowX,
        halfWidth,
        fallStyle: shape.fallStyle,
        dropNorm: clamp(drop / 1.6, 0, 1),
        lipBandBack: Math.max(riverCellWorld * 0.45, halfWidth * 0.22),
        lipBandForward: Math.max(riverCellWorld * 0.65, halfWidth * 0.28),
        lateralLimit: Math.max(halfWidth * 1.22, halfWidth + riverCellWorld * 0.55),
        topTolerance: Math.max(riverCellWorld * 0.9, drop * 0.45, 0.05),
        heightTolerance: Math.max(riverCellWorld * 1.3, drop * 0.9, 0.06)
      });
      const radiusWorld = Math.max(lipShelfLen, downstreamLen, halfWidth * 1.45);
      const radiusCells = Math.max(1, Math.ceil(radiusWorld / riverCellWorld));
      const u = clamp(centerX / Math.max(1e-4, width) + 0.5, 0, 1);
      const v = clamp(centerZ / Math.max(1e-4, depth) + 0.5, 0, 1);
      const cx = Math.round(u * Math.max(1, cols - 1));
      const cy = Math.round(v * Math.max(1, rows - 1));
      const minY = Math.max(0, cy - radiusCells);
      const maxY = Math.min(rows - 1, cy + radiusCells);
      const minX = Math.max(0, cx - radiusCells);
      const maxX = Math.min(cols - 1, cx + radiusCells);
      for (let y = minY; y <= maxY; y += 1) {
        const rowBase = y * cols;
        for (let x = minX; x <= maxX; x += 1) {
          const idx = rowBase + x;
          if (!renderSupport[idx] || !Number.isFinite(surfaceWorld[idx])) {
            continue;
          }
          const wx = ((x + 0.5) / Math.max(1, cols) - 0.5) * width - centerX;
          const wz = ((y + 0.5) / Math.max(1, rows) - 0.5) * depth - centerZ;
          const along = wx * flowX + wz * flowZ;
          const perp = Math.abs(wx * -flowZ + wz * flowX);
          if (along < -lipShelfLen || along > downstreamLen) {
            continue;
          }
          const crossLimit = Math.max(riverCellWorld * lerp(1.05, 0.9, shape.fallStyle), halfWidth * lerp(1.28, 1.06, shape.fallStyle));
          if (perp > crossLimit) {
            continue;
          }
          const baseSurface = surfaceWorld[idx];
          const crossFade = 1 - smoothstep(crossLimit * 0.62, crossLimit, perp);
          if (crossFade <= 1e-3) {
            continue;
          }
          if (along <= 0) {
            const shelfT = clamp((along + lipShelfLen) / Math.max(riverCellWorld * 0.3, lipShelfLen), 0, 1);
            const shelfDip = Math.min(0.006, drop * 0.04) * smoothstep(0.0, 1.0, shelfT);
            const shelfSurface = lipSurface - shelfDip;
            const maxLipLift = Math.max(0.025, Math.min(0.22, drop * 0.36));
            const clampedUpstream = clamp(shelfSurface, baseSurface, baseSurface + maxLipLift);
            surfaceWorld[idx] = lerp(baseSurface, Math.max(baseSurface, clampedUpstream), crossFade * 0.92);
            const prevLip = lipSurfaceOverride[idx];
            lipSurfaceOverride[idx] = Number.isFinite(prevLip)
              ? Math.max(prevLip, clampedUpstream)
              : clampedUpstream;
            continue;
          }
          if (along <= descentLen) {
            const t = clamp(along / Math.max(riverCellWorld * 0.25, descentLen), 0, 1);
            const dropT = smoothstep(0.46, 0.54, t);
            const targetSurface = lerp(lipSurface, poolSurface, dropT);
            surfaceWorld[idx] = lerp(baseSurface, targetSurface, crossFade * 0.96);
            continue;
          }
          if (along <= descentLen + plungePoolLen) {
            const poolT = clamp((along - descentLen) / Math.max(riverCellWorld * 0.35, plungePoolLen), 0, 1);
            const poolRise = smoothstep(0.0, 1.0, poolT) * Math.min(0.012, drop * lerp(0.03, 0.06, shape.fallStyle));
            const targetPoolSurface = poolSurface + poolRise;
            surfaceWorld[idx] = lerp(baseSurface, Math.min(baseSurface, targetPoolSurface), crossFade * 0.92);
            continue;
          }
          const recoveryT = clamp((along - descentLen - plungePoolLen) / Math.max(riverCellWorld * 0.35, recoveryLen), 0, 1);
          const recoveryRise = smoothstep(0.0, 1.0, recoveryT) * Math.min(0.01, drop * 0.04);
          const recoverySurface = poolSurface + recoveryRise;
          surfaceWorld[idx] = lerp(baseSurface, Math.min(baseSurface, recoverySurface), crossFade * 0.82);
        }
      }
    }
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
    waterfallInstances
  );

  const positions: number[] = [];
  const uvs: number[] = [];
  const bankDist: number[] = [];
  const flowDir: number[] = [];
  const flowSpeed: number[] = [];
  const rapid: number[] = [];
  const contourQuantScale = 8192;
  const contourKeyOf = (x: number, y: number): string =>
    `${Math.round(x * contourQuantScale)},${Math.round(y * contourQuantScale)}`;
  const contourWaterOffsetByKey = new Map<string, number>();
  const contourBoundaryTerrainWorldByKey = new Map<string, number>();
  const indices = Array.from(riverDomain.contourIndices);
  const distToNonRiver = riverDomain.distanceToBank;
  const renderContourVertices = buildSnappedRiverContourVertices(riverDomain, indices);
  const packedCutoutWallEdges = riverDomain.cutoutBoundaryWallEdges;
  if (packedCutoutWallEdges && packedCutoutWallEdges.length >= 6) {
    const registerBoundaryTerrainHeight = (x: number, y: number, worldY: number): void => {
      if (!Number.isFinite(worldY)) {
        return;
      }
      const key = contourKeyOf(x, y);
      const existing = contourBoundaryTerrainWorldByKey.get(key);
      if (existing === undefined || worldY > existing) {
        contourBoundaryTerrainWorldByKey.set(key, worldY);
      }
    };
    for (let i = 0; i + 5 < packedCutoutWallEdges.length; i += 6) {
      registerBoundaryTerrainHeight(
        packedCutoutWallEdges[i],
        packedCutoutWallEdges[i + 1],
        packedCutoutWallEdges[i + 2]
      );
      registerBoundaryTerrainHeight(
        packedCutoutWallEdges[i + 3],
        packedCutoutWallEdges[i + 4],
        packedCutoutWallEdges[i + 5]
      );
    }
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
    const lip = sampleFromCells(fx, fy, (idx) => lipSurfaceOverride[idx]);
    let topWorld = Number.isFinite(lip) ? Math.max(surface, lip) : surface;
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
      minBankWorld = Math.min(minBankWorld, (sample.elevations[idx] ?? 0) * heightScale);
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
  const addVertex = (v: RiverContourVertex): void => {
    const flow = sampleFlow(v.x, v.y);
    let waterOffset = sampleSurfaceOffset(v.x, v.y);
    const boundaryTerrainWorld = contourBoundaryTerrainWorldByKey.get(contourKeyOf(v.x, v.y));
    if (Number.isFinite(boundaryTerrainWorld)) {
      // Keep boundary water strictly below the cutout terrain top so wall top can always cover it.
      const maxBoundarySurfaceOffset = (boundaryTerrainWorld as number) - waterLevelWorld - WALL_WATER_OVERLAP;
      if (Number.isFinite(maxBoundarySurfaceOffset)) {
        waterOffset = Math.min(waterOffset, maxBoundarySurfaceOffset);
      }
    }
    positions.push(worldXEdge(v.x), waterOffset, worldZEdge(v.y));
    uvs.push(v.x / Math.max(1, cols), v.y / Math.max(1, rows));
    bankDist.push(sampleBankDist(v.x, v.y));
    flowDir.push(flow.x, flow.y);
    flowSpeed.push(sampleFlowSpeed(v.x, v.y));
    rapid.push(sampleRapid(v.x, v.y));
    contourWaterOffsetByKey.set(contourKeyOf(v.x, v.y), waterOffset);
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

  const wallPositions: number[] = [];
  const wallUvs: number[] = [];
  const wallIndices: number[] = [];
  const waterfallWallPositions: number[] = [];
  const waterfallWallUvs: number[] = [];
  const waterfallWallIndices: number[] = [];
  const waterfallWallDropNorm: number[] = [];
  const waterfallWallFallStyle: number[] = [];
  const sampleTerrainWorld = (fx: number, fy: number): number => {
    const sx = clamp(fx - 0.5, 0, cols - 1);
    const sy = clamp(fy - 0.5, 0, rows - 1);
    const x0 = Math.floor(sx);
    const y0 = Math.floor(sy);
    const x1 = Math.min(cols - 1, x0 + 1);
    const y1 = Math.min(rows - 1, y0 + 1);
    const tx = sx - x0;
    const ty = sy - y0;
    const h00 = (sample.elevations[idxAt(x0, y0)] ?? 0) * heightScale;
    const h10 = (sample.elevations[idxAt(x1, y0)] ?? 0) * heightScale;
    const h01 = (sample.elevations[idxAt(x0, y1)] ?? 0) * heightScale;
    const h11 = (sample.elevations[idxAt(x1, y1)] ?? 0) * heightScale;
    const hx0 = h00 * (1 - tx) + h10 * tx;
    const hx1 = h01 * (1 - tx) + h11 * tx;
    return hx0 * (1 - ty) + hx1 * ty;
  };
  const sampleOutsideBank = (
    fx: number,
    fy: number,
    outX: number,
    outY: number,
    fallback: number,
    inset: number = BANK_INSET
  ): number => {
    let nearest = Number.NaN;
    let sum = 0;
    let count = 0;
    const rayStep = 0.16;
    for (let step = 1; step <= 4; step += 1) {
      const px = fx + outX * rayStep * step;
      const py = fy + outY * rayStep * step;
      if (px < 0 || py < 0 || px > cols || py > rows) {
        continue;
      }
      const cellX = clamp(Math.floor(px), 0, cols - 1);
      const cellY = clamp(Math.floor(py), 0, rows - 1);
      const idx = idxAt(cellX, cellY);
      if (renderSupport[idx]) {
        continue;
      }
      const bank = sampleTerrainWorld(px, py) - waterLevelWorld - inset;
      if (!Number.isFinite(bank)) {
        continue;
      }
      if (!Number.isFinite(nearest)) {
        nearest = bank;
      }
      sum += bank;
      count += 1;
    }
    if (!Number.isFinite(nearest)) {
      return fallback;
    }
    const avg = sum / Math.max(1, count);
    // Bias toward the nearest outside sample so the wall follows the cut edge closely.
    return nearest * 0.72 + avg * 0.28;
  };
  const sampleSupportValue = (fx: number, fy: number): number => {
    const sx = clamp(fx - 0.5, 0, cols - 1);
    const sy = clamp(fy - 0.5, 0, rows - 1);
    const x0 = Math.floor(sx);
    const y0 = Math.floor(sy);
    const x1 = Math.min(cols - 1, x0 + 1);
    const y1 = Math.min(rows - 1, y0 + 1);
    const tx = sx - x0;
    const ty = sy - y0;
    const s00 = renderSupport[idxAt(x0, y0)] ? 1 : 0;
    const s10 = renderSupport[idxAt(x1, y0)] ? 1 : 0;
    const s01 = renderSupport[idxAt(x0, y1)] ? 1 : 0;
    const s11 = renderSupport[idxAt(x1, y1)] ? 1 : 0;
    const sx0 = s00 * (1 - tx) + s10 * tx;
    const sx1 = s01 * (1 - tx) + s11 * tx;
    return sx0 * (1 - ty) + sx1 * ty;
  };
  const resolveOutward = (
    midX: number,
    midY: number,
    candidateX: number,
    candidateY: number
  ): { x: number; y: number } => {
    const probe = 0.28;
    const plus = sampleSupportValue(midX + candidateX * probe, midY + candidateY * probe);
    const minus = sampleSupportValue(midX - candidateX * probe, midY - candidateY * probe);
    // Outward should move away from river support.
    if (plus > minus + 1e-4) {
      return { x: -candidateX, y: -candidateY };
    }
    return { x: candidateX, y: candidateY };
  };
  const sampleAnyOutsideBank = (fx: number, fy: number, fallback: number): number => {
    let best = Number.NaN;
    const dirs = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]
    ];
    for (let i = 0; i < dirs.length; i += 1) {
      const dir = dirs[i];
      const bank = sampleOutsideBank(fx, fy, dir[0], dir[1], Number.NaN);
      if (!Number.isFinite(bank)) {
        continue;
      }
      if (!Number.isFinite(best)) {
        best = bank;
      } else {
        best = Math.min(best, bank);
      }
    }
    return Number.isFinite(best) ? best : fallback;
  };
  let wallTopGapSum = 0;
  let wallTopGapMax = 0;
  let wallTopGapCount = 0;
  const packedWallBoundaryEdges =
    riverDomain.cutoutBoundaryWallEdges && riverDomain.cutoutBoundaryWallEdges.length >= 6
      ? riverDomain.cutoutBoundaryWallEdges
      : undefined;
  const wallBoundaryEdgesFromContour = buildBoundaryEdgesFromIndexedContour(renderContourVertices, indices);
  const wallBoundaryEdgesFallback =
    wallBoundaryEdgesFromContour.length >= 4
      ? wallBoundaryEdgesFromContour
      : riverDomain.cutoutBoundaryEdges && riverDomain.cutoutBoundaryEdges.length >= 4
        ? riverDomain.cutoutBoundaryEdges
        : riverDomain.boundaryEdges;
  type WallEdgeProfile = RiverContourEdge & {
    outX: number;
    outY: number;
    terrainWorldA?: number;
    terrainWorldB?: number;
  };
  type WallVertexProfile = { top: number; bottom: number; terrainTop: number };
  const wallQuantScale = 8192;
  const wallKeyOf = (x: number, y: number): string => `${Math.round(x * wallQuantScale)},${Math.round(y * wallQuantScale)}`;
  const cutoutBoundaryTerrainByKey = new Map<string, number>();
  const packedBoundaryHeights = riverDomain.cutoutBoundaryVertexHeights;
  if (packedBoundaryHeights && packedBoundaryHeights.length >= 3) {
    for (let i = 0; i + 2 < packedBoundaryHeights.length; i += 3) {
      const hx = packedBoundaryHeights[i];
      const hy = packedBoundaryHeights[i + 1];
      const hWorld = packedBoundaryHeights[i + 2];
      cutoutBoundaryTerrainByKey.set(wallKeyOf(hx, hy), hWorld);
    }
  }
  const wallEdges: WallEdgeProfile[] = [];
  const wallVertexOutward = new Map<string, { x: number; y: number; outX: number; outY: number; count: number }>();
  const addVertexOutward = (x: number, y: number, outX: number, outY: number): void => {
    const key = wallKeyOf(x, y);
    const existing = wallVertexOutward.get(key);
    if (existing) {
      existing.outX += outX;
      existing.outY += outY;
      existing.count += 1;
      return;
    }
    wallVertexOutward.set(key, { x, y, outX, outY, count: 1 });
  };
  if (packedWallBoundaryEdges) {
    for (let i = 0; i < packedWallBoundaryEdges.length; i += 6) {
      const ax = packedWallBoundaryEdges[i];
      const ay = packedWallBoundaryEdges[i + 1];
      const az = packedWallBoundaryEdges[i + 2];
      const bx = packedWallBoundaryEdges[i + 3];
      const by = packedWallBoundaryEdges[i + 4];
      const bz = packedWallBoundaryEdges[i + 5];
      const ex = bx - ax;
      const ey = by - ay;
      const eLen = Math.hypot(ex, ey);
      if (eLen <= 1e-5) {
        continue;
      }
      // Polygon winding is stabilized as CCW, so outward is to the right of edge direction.
      const candX = ey / eLen;
      const candY = -ex / eLen;
      const midX = (ax + bx) * 0.5;
      const midY = (ay + by) * 0.5;
      const resolved = resolveOutward(midX, midY, candX, candY);
      wallEdges.push({
        ax,
        ay,
        bx,
        by,
        outX: resolved.x,
        outY: resolved.y,
        terrainWorldA: Number.isFinite(az) ? az : undefined,
        terrainWorldB: Number.isFinite(bz) ? bz : undefined
      });
      addVertexOutward(ax, ay, resolved.x, resolved.y);
      addVertexOutward(bx, by, resolved.x, resolved.y);
    }
  } else {
    for (let i = 0; i < wallBoundaryEdgesFallback.length; i += 4) {
      const ax = wallBoundaryEdgesFallback[i];
      const ay = wallBoundaryEdgesFallback[i + 1];
      const bx = wallBoundaryEdgesFallback[i + 2];
      const by = wallBoundaryEdgesFallback[i + 3];
      const ex = bx - ax;
      const ey = by - ay;
      const eLen = Math.hypot(ex, ey);
      if (eLen <= 1e-5) {
        continue;
      }
      // Polygon winding is stabilized as CCW, so outward is to the right of edge direction.
      const candX = ey / eLen;
      const candY = -ex / eLen;
      const midX = (ax + bx) * 0.5;
      const midY = (ay + by) * 0.5;
      const resolved = resolveOutward(midX, midY, candX, candY);
      wallEdges.push({
        ax,
        ay,
        bx,
        by,
        outX: resolved.x,
        outY: resolved.y
      });
      addVertexOutward(ax, ay, resolved.x, resolved.y);
      addVertexOutward(bx, by, resolved.x, resolved.y);
    }
  }
  const wallVertexProfiles = new Map<string, WallVertexProfile>();
  const resolveWallVertexProfile = (
    x: number,
    y: number,
    fallbackOutX: number,
    fallbackOutY: number,
    exactTerrainWorld?: number
  ): WallVertexProfile => {
    const waterFromContour = contourWaterOffsetByKey.get(wallKeyOf(x, y));
    const waterSurface = Number.isFinite(waterFromContour) ? (waterFromContour as number) : sampleSurfaceOffset(x, y);
    if (Number.isFinite(exactTerrainWorld)) {
      const terrainTop = (exactTerrainWorld as number) - waterLevelWorld;
      const top = terrainTop + WALL_TOP_OVERLAP;
      let bottom = top - WALL_MIN_HEIGHT;
      if (Number.isFinite(waterSurface)) {
        bottom = Math.min(bottom, waterSurface - WALL_WATER_OVERLAP);
      }
      bottom = Math.min(bottom, terrainTop - WALL_RISE_GUARD);
      return { top, bottom, terrainTop };
    }
    const key = wallKeyOf(x, y);
    const cached = wallVertexProfiles.get(key);
    if (cached) {
      return cached;
    }
    const accum = wallVertexOutward.get(key);
    let outX = accum?.outX ?? fallbackOutX;
    let outY = accum?.outY ?? fallbackOutY;
    const len = Math.hypot(outX, outY);
    if (len > 1e-5) {
      outX /= len;
      outY /= len;
    } else {
      outX = fallbackOutX;
      outY = fallbackOutY;
    }
    const boundaryTerrainWorld = cutoutBoundaryTerrainByKey.get(key);
    const terrainTop = (Number.isFinite(boundaryTerrainWorld) ? (boundaryTerrainWorld as number) : sampleTerrainWorld(x, y)) - waterLevelWorld;
    const maxTop = terrainTop + WALL_TOP_OVERLAP;
    let top = maxTop;
    if (Number.isFinite(waterSurface)) {
      top = clamp(
        (waterSurface as number) + WALL_WATER_OVERLAP,
        terrainTop - WALL_TOP_MAX_UNDERCUT,
        maxTop
      );
    }
    let bottom = top - WALL_MIN_HEIGHT;
    if (Number.isFinite(waterSurface)) {
      bottom = Math.min(bottom, waterSurface - WALL_WATER_OVERLAP);
    }
    bottom = Math.min(bottom, terrainTop - WALL_RISE_GUARD);
    const profile: WallVertexProfile = { top, bottom, terrainTop };
    wallVertexProfiles.set(key, profile);
    return profile;
  };
  type WaterfallWallMatch = {
    profileIndex: number;
    profile: WaterfallWallProfile;
    score: number;
    uA: number;
    uB: number;
    vTopA: number;
    vTopB: number;
    vBottomA: number;
    vBottomB: number;
  };
  type PreparedWallEdge = {
    edge: WallEdgeProfile;
    profileA: WallVertexProfile;
    profileB: WallVertexProfile;
    axWorld: number;
    azWorld: number;
    bxWorld: number;
    bzWorld: number;
    tangentDirX: number;
    tangentDirZ: number;
    outwardWorldX: number;
    outwardWorldZ: number;
    outwardLen: number;
    midWorldX: number;
    midWorldZ: number;
    wallTopMid: number;
    wallBottomMid: number;
    wallHeight: number;
    vertexKeyA: string;
    vertexKeyB: string;
  };
  const evaluateWallEdgeAgainstProfile = (
    prepared: PreparedWallEdge,
    profileIndex: number,
    relaxed = false
  ): WaterfallWallMatch | undefined => {
    if (profileIndex < 0 || profileIndex >= waterfallWallProfiles.length) {
      return undefined;
    }
    const profile = waterfallWallProfiles[profileIndex];
    const dx = prepared.midWorldX - profile.centerX;
    const dz = prepared.midWorldZ - profile.centerZ;
    const along = dx * profile.flowX + dz * profile.flowZ;
    const alongBackLimit = profile.lipBandBack * (relaxed ? 1.5 : 1.35);
    const alongForwardLimit = profile.lipBandForward * (relaxed ? 2.25 : 1.9);
    if (along < -alongBackLimit || along > alongForwardLimit) {
      return undefined;
    }
    const lateralMid = dx * profile.crossX + dz * profile.crossZ;
    const lateralLimit = profile.lateralLimit * (relaxed ? 1.75 : 1.25);
    if (Math.abs(lateralMid) > lateralLimit) {
      return undefined;
    }
    const tangentAlign = Math.abs(prepared.tangentDirX * profile.crossX + prepared.tangentDirZ * profile.crossZ);
    if (tangentAlign < (relaxed ? 0.16 : 0.3)) {
      return undefined;
    }
    const outwardAlign =
      prepared.outwardLen > 1e-5
        ? Math.abs(prepared.outwardWorldX * profile.flowX + prepared.outwardWorldZ * profile.flowZ)
        : 1;
    if (outwardAlign < (relaxed ? 0.02 : 0.1)) {
      return undefined;
    }
    const topTolerance = profile.topTolerance * (relaxed ? 1.4 : 1);
    const topDiff = Math.abs(prepared.wallTopMid - profile.lipOffset);
    if (topDiff > topTolerance) {
      return undefined;
    }
    const heightDiff = Math.abs(prepared.wallHeight - profile.drop);
    const alongPenalty =
      along < 0
        ? -along / Math.max(1e-4, alongBackLimit)
        : along / Math.max(1e-4, alongForwardLimit);
    const heightScale = Math.max(
      profile.heightTolerance * (relaxed ? 5.5 : 4),
      profile.drop * (relaxed ? 1.8 : 1.5),
      riverCellWorld * (relaxed ? 2.8 : 2.2)
    );
    const score =
      Math.abs(lateralMid) / Math.max(1e-4, lateralLimit) * 1.25 +
      alongPenalty * 0.95 +
      (1 - tangentAlign) * 0.95 +
      (1 - clamp(outwardAlign, 0, 1)) * 0.7 +
      topDiff / Math.max(1e-4, topTolerance) * 0.65 +
      heightDiff / Math.max(1e-4, heightScale) * 0.35;
    if (relaxed && score > 2.55) {
      return undefined;
    }
    const lateralScale = Math.max(profile.halfWidth * 2, riverCellWorld * 0.75);
    const aLateral =
      ((prepared.axWorld - profile.centerX) * profile.crossX + (prepared.azWorld - profile.centerZ) * profile.crossZ) /
      lateralScale;
    const bLateral =
      ((prepared.bxWorld - profile.centerX) * profile.crossX + (prepared.bzWorld - profile.centerZ) * profile.crossZ) /
      lateralScale;
    const fallBottom = profile.lipOffset - profile.drop;
    const fallHeight = Math.max(0.05, profile.drop);
    return {
      profileIndex,
      profile,
      score,
      uA: clamp(0.5 + aLateral, 0, 1),
      uB: clamp(0.5 + bLateral, 0, 1),
      vTopA: clamp((prepared.profileA.top - fallBottom) / fallHeight, 0, 1),
      vTopB: clamp((prepared.profileB.top - fallBottom) / fallHeight, 0, 1),
      vBottomA: clamp((prepared.profileA.bottom - fallBottom) / fallHeight, 0, 1),
      vBottomB: clamp((prepared.profileB.bottom - fallBottom) / fallHeight, 0, 1)
    };
  };
  const classifyWallEdge = (prepared: PreparedWallEdge): WaterfallWallMatch | undefined => {
    if (waterfallWallProfiles.length === 0) {
      return undefined;
    }
    let bestMatch: WaterfallWallMatch | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < waterfallWallProfiles.length; i += 1) {
      const match = evaluateWallEdgeAgainstProfile(prepared, i, false);
      if (!match || match.score >= bestScore) {
        continue;
      }
      bestScore = match.score;
      bestMatch = match;
    }
    return bestMatch;
  };
  const preparedWallEdges: PreparedWallEdge[] = [];
  const wallEdgeIndicesByVertex = new Map<string, number[]>();
  const registerWallEdgeVertex = (key: string, edgeIndex: number): void => {
    const bucket = wallEdgeIndicesByVertex.get(key);
    if (bucket) {
      bucket.push(edgeIndex);
      return;
    }
    wallEdgeIndicesByVertex.set(key, [edgeIndex]);
  };
  for (let i = 0; i < wallEdges.length; i += 1) {
    const edge = wallEdges[i];
    const profileA = resolveWallVertexProfile(edge.ax, edge.ay, edge.outX, edge.outY, edge.terrainWorldA);
    const profileB = resolveWallVertexProfile(edge.bx, edge.by, edge.outX, edge.outY, edge.terrainWorldB);
    const gapA = Math.abs(profileA.terrainTop - profileA.top);
    const gapB = Math.abs(profileB.terrainTop - profileB.top);
    wallTopGapSum += gapA + gapB;
    wallTopGapMax = Math.max(wallTopGapMax, gapA, gapB);
    wallTopGapCount += 2;
    const axWorld = worldXEdge(edge.ax);
    const azWorld = worldZEdge(edge.ay);
    const bxWorld = worldXEdge(edge.bx);
    const bzWorld = worldZEdge(edge.by);
    const tangentX = bxWorld - axWorld;
    const tangentZ = bzWorld - azWorld;
    const tangentLen = Math.hypot(tangentX, tangentZ);
    if (tangentLen <= 1e-5) {
      continue;
    }
    let outwardWorldX = edge.outX * riverCellWorldX;
    let outwardWorldZ = edge.outY * riverCellWorldZ;
    const outwardLen = Math.hypot(outwardWorldX, outwardWorldZ);
    if (outwardLen > 1e-5) {
      outwardWorldX /= outwardLen;
      outwardWorldZ /= outwardLen;
    }
    const prepared: PreparedWallEdge = {
      edge,
      profileA,
      profileB,
      axWorld,
      azWorld,
      bxWorld,
      bzWorld,
      tangentDirX: tangentX / tangentLen,
      tangentDirZ: tangentZ / tangentLen,
      outwardWorldX,
      outwardWorldZ,
      outwardLen,
      midWorldX: (axWorld + bxWorld) * 0.5,
      midWorldZ: (azWorld + bzWorld) * 0.5,
      wallTopMid: (profileA.top + profileB.top) * 0.5,
      wallBottomMid: (profileA.bottom + profileB.bottom) * 0.5,
      wallHeight: Math.max(WALL_MIN_HEIGHT, ((profileA.top - profileA.bottom) + (profileB.top - profileB.bottom)) * 0.5),
      vertexKeyA: wallKeyOf(edge.ax, edge.ay),
      vertexKeyB: wallKeyOf(edge.bx, edge.by)
    };
    const edgeIndex = preparedWallEdges.length;
    preparedWallEdges.push(prepared);
    registerWallEdgeVertex(prepared.vertexKeyA, edgeIndex);
    registerWallEdgeVertex(prepared.vertexKeyB, edgeIndex);
  }
  type WaterfallWallSeed = {
    edgeIndex: number;
    match: WaterfallWallMatch;
  };
  const WATERFALL_WALL_MIN_STRICT_SEEDS = 2;
  const seedMatchesByProfile = Array.from({ length: waterfallWallProfiles.length }, () => [] as WaterfallWallSeed[]);
  const relaxedSeedByProfile = new Array<WaterfallWallSeed | undefined>(waterfallWallProfiles.length);
  for (let edgeIndex = 0; edgeIndex < preparedWallEdges.length; edgeIndex += 1) {
    const prepared = preparedWallEdges[edgeIndex];
    for (let profileIndex = 0; profileIndex < waterfallWallProfiles.length; profileIndex += 1) {
      const strictMatch = evaluateWallEdgeAgainstProfile(prepared, profileIndex, false);
      if (strictMatch) {
        seedMatchesByProfile[profileIndex].push({ edgeIndex, match: strictMatch });
      }
      const relaxedMatch = strictMatch ?? evaluateWallEdgeAgainstProfile(prepared, profileIndex, true);
      const bestRelaxed = relaxedSeedByProfile[profileIndex];
      if (!relaxedMatch) {
        continue;
      }
      if (!bestRelaxed || relaxedMatch.score < bestRelaxed.match.score) {
        relaxedSeedByProfile[profileIndex] = { edgeIndex, match: relaxedMatch };
      }
    }
  }
  const assignedProfileByEdge = new Int32Array(preparedWallEdges.length).fill(-1);
  const assignedMatchByEdge = new Array<WaterfallWallMatch | undefined>(preparedWallEdges.length);
  const waterfallWallQuadCounts = new Array(waterfallWallProfiles.length).fill(0);
  const profileOrder = seedMatchesByProfile
    .map((seedMatches, profileIndex) => {
      const sortedSeedMatches = seedMatches.slice().sort((a, b) => a.match.score - b.match.score);
      const selectedSeeds = sortedSeedMatches.slice(0, 6);
      if (
        selectedSeeds.length < WATERFALL_WALL_MIN_STRICT_SEEDS &&
        selectedSeeds.length === 0 &&
        relaxedSeedByProfile[profileIndex]
      ) {
        selectedSeeds.push(relaxedSeedByProfile[profileIndex] as WaterfallWallSeed);
      }
      return {
        profileIndex,
        seedMatches: selectedSeeds,
        bestScore: selectedSeeds.length > 0 ? selectedSeeds[0].match.score : Number.POSITIVE_INFINITY
      };
    })
    .filter(
      (entry) =>
        entry.seedMatches.length >= WATERFALL_WALL_MIN_STRICT_SEEDS ||
        (entry.seedMatches.length === 1 && entry.bestScore < 0.45)
    )
    .sort((a, b) => a.bestScore - b.bestScore);
  for (let i = 0; i < profileOrder.length; i += 1) {
    const { profileIndex, seedMatches } = profileOrder[i];
    const queue = seedMatches.map((seed) => seed.edgeIndex);
    const queued = new Uint8Array(preparedWallEdges.length);
    const queuedMatchByEdge = new Map<number, WaterfallWallMatch>();
    for (let q = 0; q < queue.length; q += 1) {
      queued[queue[q]] = 1;
      queuedMatchByEdge.set(queue[q], seedMatches[q]?.match ?? evaluateWallEdgeAgainstProfile(preparedWallEdges[queue[q]], profileIndex, true)!);
    }
    for (let head = 0; head < queue.length; head += 1) {
      const edgeIndex = queue[head];
      if (assignedProfileByEdge[edgeIndex] !== -1) {
        continue;
      }
      const match = queuedMatchByEdge.get(edgeIndex) ?? evaluateWallEdgeAgainstProfile(preparedWallEdges[edgeIndex], profileIndex, true);
      if (!match) {
        continue;
      }
      assignedProfileByEdge[edgeIndex] = profileIndex;
      assignedMatchByEdge[edgeIndex] = match;
      waterfallWallQuadCounts[profileIndex] += 1;
      const current = preparedWallEdges[edgeIndex];
      const neighborIndices = [
        ...(wallEdgeIndicesByVertex.get(current.vertexKeyA) ?? []),
        ...(wallEdgeIndicesByVertex.get(current.vertexKeyB) ?? [])
      ];
      for (let n = 0; n < neighborIndices.length; n += 1) {
        const neighborIndex = neighborIndices[n];
        if (neighborIndex === edgeIndex || assignedProfileByEdge[neighborIndex] !== -1 || queued[neighborIndex]) {
          continue;
        }
        const neighbor = preparedWallEdges[neighborIndex];
        const tangentAdj =
          Math.abs(current.tangentDirX * neighbor.tangentDirX + current.tangentDirZ * neighbor.tangentDirZ);
        if (tangentAdj < 0.15) {
          continue;
        }
        const expanded = evaluateWallEdgeAgainstProfile(neighbor, profileIndex, true);
        if (!expanded) {
          continue;
        }
        queued[neighborIndex] = 1;
        queuedMatchByEdge.set(neighborIndex, expanded);
        queue.push(neighborIndex);
      }
    }
  }
  for (let i = 0; i < preparedWallEdges.length; i += 1) {
    const prepared = preparedWallEdges[i];
    const match = assignedMatchByEdge[i];
    if (match) {
      const vBase = waterfallWallPositions.length / 3;
      waterfallWallPositions.push(
        prepared.axWorld, prepared.profileA.top, prepared.azWorld,
        prepared.bxWorld, prepared.profileB.top, prepared.bzWorld,
        prepared.bxWorld, prepared.profileB.bottom, prepared.bzWorld,
        prepared.axWorld, prepared.profileA.bottom, prepared.azWorld
      );
      waterfallWallUvs.push(
        match.uA, match.vTopA,
        match.uB, match.vTopB,
        match.uB, match.vBottomB,
        match.uA, match.vBottomA
      );
      waterfallWallDropNorm.push(
        match.profile.dropNorm,
        match.profile.dropNorm,
        match.profile.dropNorm,
        match.profile.dropNorm
      );
      waterfallWallFallStyle.push(
        match.profile.fallStyle,
        match.profile.fallStyle,
        match.profile.fallStyle,
        match.profile.fallStyle
      );
      waterfallWallIndices.push(
        vBase, vBase + 1, vBase + 2,
        vBase, vBase + 2, vBase + 3
      );
      continue;
    }
    const vBase = wallPositions.length / 3;
    wallPositions.push(
      prepared.axWorld, prepared.profileA.top, prepared.azWorld,
      prepared.bxWorld, prepared.profileB.top, prepared.bzWorld,
      prepared.bxWorld, prepared.profileB.bottom, prepared.bzWorld,
      prepared.axWorld, prepared.profileA.bottom, prepared.azWorld
    );
    const edgeWorldLen = Math.hypot(prepared.bxWorld - prepared.axWorld, prepared.bzWorld - prepared.azWorld);
    wallUvs.push(
      0, 0,
      edgeWorldLen, 0,
      edgeWorldLen, prepared.wallHeight,
      0, prepared.wallHeight
    );
    wallIndices.push(
      vBase, vBase + 1, vBase + 2,
      vBase, vBase + 2, vBase + 3
    );
  }

  if (wallPositions.length === 0 && waterfallWallPositions.length === 0 && wallEdges.length > 0) {
    for (let i = 0; i < wallEdges.length; i += 1) {
      const edge = wallEdges[i];
      const profileA = resolveWallVertexProfile(edge.ax, edge.ay, edge.outX, edge.outY, edge.terrainWorldA);
      const profileB = resolveWallVertexProfile(edge.bx, edge.by, edge.outX, edge.outY, edge.terrainWorldB);
      const axWorld = worldXEdge(edge.ax);
      const azWorld = worldZEdge(edge.ay);
      const bxWorld = worldXEdge(edge.bx);
      const bzWorld = worldZEdge(edge.by);
      const edgeWorldLen = Math.hypot(bxWorld - axWorld, bzWorld - azWorld);
      if (edgeWorldLen <= 1e-5) {
        continue;
      }
      const wallHeight = Math.max(
        WALL_MIN_HEIGHT,
        ((profileA.top - profileA.bottom) + (profileB.top - profileB.bottom)) * 0.5
      );
      const vBase = wallPositions.length / 3;
      wallPositions.push(
        axWorld, profileA.top, azWorld,
        bxWorld, profileB.top, bzWorld,
        bxWorld, profileB.bottom, bzWorld,
        axWorld, profileA.bottom, azWorld
      );
      wallUvs.push(
        0, 0,
        edgeWorldLen, 0,
        edgeWorldLen, wallHeight,
        0, wallHeight
      );
      wallIndices.push(
        vBase, vBase + 1, vBase + 2,
        vBase, vBase + 2, vBase + 3
      );
    }
  }

  if (riverDomain.debugStats && positions.length >= 3) {
    let protruding = 0;
    for (let i = 0; i < positions.length; i += 3) {
      const vx = renderContourVertices[(i / 3) * 2];
      const vy = renderContourVertices[(i / 3) * 2 + 1];
      const bank = sampleAnyOutsideBank(vx, vy, positions[i + 1] + WALL_MIN_HEIGHT);
      if (Number.isFinite(bank) && positions[i + 1] > bank + WALL_RISE_GUARD) {
        protruding += 1;
      }
    }
    riverDomain.debugStats.wallQuadCount = (wallIndices.length + waterfallWallIndices.length) / 6;
    riverDomain.debugStats.protrudingVertexRatio = protruding / Math.max(1, positions.length / 3);
    riverDomain.debugStats.waterfallWallQuadCounts = waterfallWallQuadCounts.slice();
    riverDomain.debugStats.wallTopGapMean = wallTopGapCount > 0 ? wallTopGapSum / wallTopGapCount : 0;
    riverDomain.debugStats.wallTopGapMax = wallTopGapMax;
    if (riverDomain.debugStats.protrudingVertexRatio > 0.04) {
      console.warn(
        `[threeTestTerrain] river domain wall alignment warning protrudingRatio=${riverDomain.debugStats.protrudingVertexRatio.toFixed(3)}`
      );
    }
    if (riverDomain.debugStats.wallTopGapMax > WALL_TOP_GAP_WARN) {
      console.warn(
        `[threeTestTerrain] river wall top-gap warning mean=${riverDomain.debugStats.wallTopGapMean.toFixed(4)} max=${riverDomain.debugStats.wallTopGapMax.toFixed(4)}`
      );
    }
  }

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
    wallPositions: wallPositions.length > 0 ? new Float32Array(wallPositions) : undefined,
    wallUvs: wallUvs.length > 0 ? new Float32Array(wallUvs) : undefined,
    wallIndices: wallIndices.length > 0 ? new Uint32Array(wallIndices) : undefined,
    waterfallWallPositions:
      waterfallWallPositions.length > 0
        ? new Float32Array(waterfallWallPositions)
        : undefined,
    waterfallWallUvs: waterfallWallUvs.length > 0 ? new Float32Array(waterfallWallUvs) : undefined,
    waterfallWallIndices:
      waterfallWallIndices.length > 0
        ? new Uint32Array(waterfallWallIndices)
        : undefined,
    waterfallWallDropNorm:
      waterfallWallDropNorm.length > 0
        ? new Float32Array(waterfallWallDropNorm)
        : undefined,
    waterfallWallFallStyle:
      waterfallWallFallStyle.length > 0
        ? new Float32Array(waterfallWallFallStyle)
        : undefined,
    bankDist: new Float32Array(bankDist),
    flowDir: new Float32Array(flowDir),
    flowSpeed: new Float32Array(flowSpeed),
    rapid: new Float32Array(rapid),
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

