import * as THREE from "three";
import { createRiverSpaceTransform } from "./waterSampling.js";

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const createDataTexture = (
  data: Uint8Array,
  width: number,
  height: number,
  magFilter: THREE.MagnificationTextureFilter,
  minFilter: THREE.MinificationTextureFilter
): THREE.DataTexture => {
  const flipped = new Uint8Array(data.length);
  const rowStride = width * 4;
  for (let y = 0; y < height; y += 1) {
    const src = y * rowStride;
    const dst = (height - 1 - y) * rowStride;
    flipped.set(data.subarray(src, src + rowStride), dst);
  }
  const texture = new THREE.DataTexture(flipped, width, height, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.magFilter = magFilter;
  texture.minFilter = minFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.generateMipmaps = false;
  return texture;
};

type WaterfallCandidate = {
  sampleCol: number;
  sampleRow: number;
  x: number;
  z: number;
  top: number;
  drop: number;
  dropCap: number;
  dirX: number;
  dirZ: number;
  width: number;
};

type BuildWaterfallResult = {
  instances?: Float32Array;
  debug: WaterfallDebugData;
};

type WaterfallDebugStats = {
  waterfallAnchorErrorMean: number;
  waterfallAnchorErrorMax: number;
};

export type WaterfallRiverDomainInput = {
  cols: number;
  rows: number;
  boundaryEdges: Float32Array;
  cutoutBoundaryEdges: Float32Array;
  debugStats?: WaterfallDebugStats;
};

const WATERFALL_MAX_INSTANCES = 48;
export const WATERFALL_MIN_DROP_NORM = 0.007;
const WATERFALL_MIN_RIVER_RATIO = 0.28;
const WATERFALL_MAX_DROP = 1.6;
const WATERFALL_MAX_OCEAN_RATIO = 0.08;
const WATERFALL_MIN_STEP_STRENGTH = 0.12;
const WATERFALL_MIN_ORTH_RIVER_NEIGHBORS = 2;
const WATERFALL_MIN_LOCAL_RIVER_NEIGHBORS = 3;
export const WATERFALL_VERTICALITY_MIN = 0.58;
export const WATERFALL_TOP_OFFSET = 0.04;
const WATERFALL_DROP_PADDING = 0.05;
const WATERFALL_ANCHOR_ERR_WARN = 0.03;
const ENABLE_TERRAIN_WATERFALL_INSTANCES = false;

export const WATERFALL_DEBUG_FLAG_WATER = 1 << 0;
export const WATERFALL_DEBUG_FLAG_RIVER = 1 << 1;
export const WATERFALL_DEBUG_FLAG_OCEANISH = 1 << 2;
export const WATERFALL_DEBUG_FLAG_STEP_OK = 1 << 3;
export const WATERFALL_DEBUG_FLAG_BEST_DROP_OK = 1 << 4;
export const WATERFALL_DEBUG_FLAG_LOCAL_DROP_OK = 1 << 5;
export const WATERFALL_DEBUG_FLAG_CANDIDATE = 1 << 6;
export const WATERFALL_DEBUG_FLAG_EMITTED = 1 << 7;

export type WaterfallDebugData = {
  sampleCols: number;
  sampleRows: number;
  sampleStep: number;
  minDrop: number;
  stepThreshold: number;
  localDropThreshold: number;
  candidateCount: number;
  clusterCount: number;
  emittedCount: number;
  lowVerticalityRejectedCount: number;
  longRunRejectedCount: number;
  flags: Uint8Array;
  stepStrength: Float32Array;
  bestNeighborDrop: Float32Array;
  localDrop: Float32Array;
  immediateDrop: Float32Array;
  totalDrop: Float32Array;
  runToPool: Float32Array;
  verticality: Float32Array;
  runLimit: Float32Array;
};

export const describeWaterfallShape = (
  drop: number,
  halfWidth: number
): {
  fallStyle: number;
  rapidness: number;
  run: number;
  plungeForward: number;
} => {
  const aspect = drop / Math.max(0.12, halfWidth * 1.8);
  const fallStyle = clamp((aspect - 0.2) / 0.48, 0, 1);
  const rapidness = 1 - fallStyle;
  const apronRun = Math.max(halfWidth * 0.16, drop * 0.12);
  const curtainRun = Math.max(halfWidth * 0.06, drop * 0.035);
  const run = lerp(apronRun, curtainRun, fallStyle);
  return {
    fallStyle,
    rapidness,
    run,
    plungeForward: run * lerp(0.78, 0.96, fallStyle)
  };
};

export const buildWaterfallInstances = (
  waterHeights: Float32Array,
  supportMask: Uint8Array,
  oceanRatio: Float32Array,
  sampleCols: number,
  sampleRows: number,
  sampleStep: number,
  riverRatio: Float32Array,
  riverStepStrength: Float32Array | undefined,
  minDrop: number,
  width: number,
  depth: number,
  riverDomain?: WaterfallRiverDomainInput
): BuildWaterfallResult => {
  const candidates: WaterfallCandidate[] = [];
  const total = sampleCols * sampleRows;
  const cellWorldX = width / Math.max(1, sampleCols);
  const cellWorldZ = depth / Math.max(1, sampleRows);
  const cellWorld = Math.max(1e-4, Math.min(cellWorldX, cellWorldZ));
  const localDropThreshold = minDrop * 0.95;
  const flags = new Uint8Array(total);
  const stepStrengthDebug = new Float32Array(total).fill(-1);
  const bestNeighborDropDebug = new Float32Array(total).fill(-1);
  const localDropDebug = new Float32Array(total).fill(-1);
  const immediateDropDebug = new Float32Array(total).fill(Number.NaN);
  const totalDropDebug = new Float32Array(total).fill(Number.NaN);
  const runToPoolDebug = new Float32Array(total).fill(Number.NaN);
  const verticalityDebug = new Float32Array(total).fill(Number.NaN);
  const runLimitDebug = new Float32Array(total).fill(Number.NaN);
  const debug: WaterfallDebugData = {
    sampleCols,
    sampleRows,
    sampleStep,
    minDrop,
    stepThreshold: WATERFALL_MIN_STEP_STRENGTH,
    localDropThreshold,
    candidateCount: 0,
    clusterCount: 0,
    emittedCount: 0,
    lowVerticalityRejectedCount: 0,
    longRunRejectedCount: 0,
    flags,
    stepStrength: stepStrengthDebug,
    bestNeighborDrop: bestNeighborDropDebug,
    localDrop: localDropDebug,
    immediateDrop: immediateDropDebug,
    totalDrop: totalDropDebug,
    runToPool: runToPoolDebug,
    verticality: verticalityDebug,
    runLimit: runLimitDebug
  };
  if (!ENABLE_TERRAIN_WATERFALL_INSTANCES) {
    return { debug };
  }
  const isWaterCell = (idx: number): boolean => (supportMask[idx] ?? 0) > 0;
  const isRiverCell = (idx: number): boolean => (riverRatio[idx] ?? 0) >= WATERFALL_MIN_RIVER_RATIO;
  const isOceanish = (idx: number): boolean => (oceanRatio[idx] ?? 0) >= WATERFALL_MAX_OCEAN_RATIO;
  const isValidCoord = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < sampleCols && y < sampleRows;
  const countLocalRiverSupport = (col: number, row: number): { orth: number; total: number } => {
    let orth = 0;
    let total = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) {
          continue;
        }
        const nx = col + dx;
        const ny = row + dy;
        if (!isValidCoord(nx, ny)) {
          continue;
        }
        const nIdx = ny * sampleCols + nx;
        if (!isWaterCell(nIdx) || !isRiverCell(nIdx) || isOceanish(nIdx)) {
          continue;
        }
        total += 1;
        if (dx === 0 || dy === 0) {
          orth += 1;
        }
      }
    }
    return { orth, total };
  };
  const toWorldX = (x: number): number => ((x + 0.5) / Math.max(1, sampleCols) - 0.5) * width;
  const toWorldZ = (y: number): number => ((y + 0.5) / Math.max(1, sampleRows) - 0.5) * depth;
  const sampleWaterHeight = (fx: number, fy: number): number => {
    const x = clamp(fx, 0, sampleCols - 1);
    const y = clamp(fy, 0, sampleRows - 1);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(sampleCols - 1, x0 + 1);
    const y1 = Math.min(sampleRows - 1, y0 + 1);
    const tx = x - x0;
    const ty = y - y0;
    const h00 = waterHeights[y0 * sampleCols + x0] ?? 0;
    const h10 = waterHeights[y0 * sampleCols + x1] ?? h00;
    const h01 = waterHeights[y1 * sampleCols + x0] ?? h00;
    const h11 = waterHeights[y1 * sampleCols + x1] ?? h10;
    const hx0 = h00 * (1 - tx) + h10 * tx;
    const hx1 = h01 * (1 - tx) + h11 * tx;
    return hx0 * (1 - ty) + hx1 * ty;
  };
  const sampleRiverHeight = (fx: number, fy: number): number => {
    const x = clamp(fx, 0, sampleCols - 1);
    const y = clamp(fy, 0, sampleRows - 1);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(sampleCols - 1, x0 + 1);
    const y1 = Math.min(sampleRows - 1, y0 + 1);
    const tx = x - x0;
    const ty = y - y0;
    const samples = [
      { x: x0, y: y0, w: (1 - tx) * (1 - ty) },
      { x: x1, y: y0, w: tx * (1 - ty) },
      { x: x0, y: y1, w: (1 - tx) * ty },
      { x: x1, y: y1, w: tx * ty }
    ];
    let weighted = 0;
    let wSum = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const s = samples[i];
      const idx = s.y * sampleCols + s.x;
      if (!isWaterCell(idx) || !isRiverCell(idx) || isOceanish(idx)) {
        continue;
      }
      const h = waterHeights[idx];
      if (!Number.isFinite(h)) {
        continue;
      }
      weighted += h * s.w;
      wSum += s.w;
    }
    if (wSum > 1e-5) {
      return weighted / wSum;
    }
    const nearestX = clamp(Math.round(x), 0, sampleCols - 1);
    const nearestY = clamp(Math.round(y), 0, sampleRows - 1);
    let bestIdx = -1;
    let bestDistSq = Number.POSITIVE_INFINITY;
    for (let radius = 1; radius <= 4 && bestIdx < 0; radius += 1) {
      const minX = Math.max(0, nearestX - radius);
      const maxX = Math.min(sampleCols - 1, nearestX + radius);
      const minY = Math.max(0, nearestY - radius);
      const maxY = Math.min(sampleRows - 1, nearestY + radius);
      for (let sy = minY; sy <= maxY; sy += 1) {
        for (let sx = minX; sx <= maxX; sx += 1) {
          const idx = sy * sampleCols + sx;
          if (!isWaterCell(idx) || !isRiverCell(idx) || isOceanish(idx)) {
            continue;
          }
          const h = waterHeights[idx];
          if (!Number.isFinite(h)) {
            continue;
          }
          const dx = sx - x;
          const dy = sy - y;
          const distSq = dx * dx + dy * dy;
          if (distSq < bestDistSq) {
            bestDistSq = distSq;
            bestIdx = idx;
          }
        }
      }
    }
    if (bestIdx >= 0) {
      return waterHeights[bestIdx];
    }
    return sampleWaterHeight(fx, fy);
  };
  const worldToGridX = (worldX: number): number => (worldX / Math.max(1e-4, width) + 0.5) * sampleCols - 0.5;
  const worldToGridY = (worldZ: number): number => (worldZ / Math.max(1e-4, depth) + 0.5) * sampleRows - 0.5;
  const sampleRiverOccupancy = (fx: number, fy: number): number => {
    const x = clamp(fx, 0, sampleCols - 1);
    const y = clamp(fy, 0, sampleRows - 1);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(sampleCols - 1, x0 + 1);
    const y1 = Math.min(sampleRows - 1, y0 + 1);
    const tx = x - x0;
    const ty = y - y0;
    const sampleValue = (sx: number, sy: number): number => {
      const idx = sy * sampleCols + sx;
      if (!isWaterCell(idx) || !isRiverCell(idx) || isOceanish(idx)) {
        return 0;
      }
      return 1;
    };
    const s00 = sampleValue(x0, y0);
    const s10 = sampleValue(x1, y0);
    const s01 = sampleValue(x0, y1);
    const s11 = sampleValue(x1, y1);
    const sx0 = s00 * (1 - tx) + s10 * tx;
    const sx1 = s01 * (1 - tx) + s11 * tx;
    return sx0 * (1 - ty) + sx1 * ty;
  };
  const measureWorldCrossSection = (
    centerX: number,
    centerZ: number,
    flowX: number,
    flowZ: number
  ): { halfWidth: number; shiftX: number; shiftZ: number } => {
    let perpX = -flowZ;
    let perpZ = flowX;
    const len = Math.hypot(perpX, perpZ);
    if (len <= 1e-5) {
      perpX = 1;
      perpZ = 0;
    } else {
      perpX /= len;
      perpZ /= len;
    }
    const stepDist = Math.max(0.05, cellWorld * 0.32);
    const maxDist = Math.max(cellWorld * 8.0, 0.6);
    const sampleSpan = (sign: number): number => {
      let span = 0;
      for (let dist = stepDist; dist <= maxDist; dist += stepDist) {
        const wx = centerX + perpX * sign * dist;
        const wz = centerZ + perpZ * sign * dist;
        const occ = sampleRiverOccupancy(worldToGridX(wx), worldToGridY(wz));
        if (occ < 0.42) {
          break;
        }
        span = dist;
      }
      return span;
    };
    const neg = sampleSpan(-1);
    const pos = sampleSpan(1);
    const shift = clamp((pos - neg) * 0.5, -cellWorld * 1.2, cellWorld * 1.2);
    const halfWidth = clamp(Math.max(cellWorld * 0.45, (neg + pos) * 0.5 + cellWorld * 0.2), cellWorld * 0.45, cellWorld * 4.2);
    return { halfWidth, shiftX: perpX * shift, shiftZ: perpZ * shift };
  };
  const measureTrueFallProfileAtWorld = (
    centerX: number,
    centerZ: number,
    dirX: number,
    dirZ: number,
    lipHeight: number,
    halfWidth: number
  ): {
    immediateDrop: number;
    totalDrop: number;
    runToPool: number;
    verticality: number;
    runLimit: number;
  } => {
    let immediateMin = lipHeight;
    let poolMin = lipHeight;
    let poolDist = Math.max(cellWorld * 0.25, 0.05);
    const stepDist = Math.max(cellWorld * 0.25, 0.05);
    const immediateWindow = Math.max(cellWorld * 0.9, halfWidth * 0.4);
    const maxDist = Math.max(cellWorld * 5.5, halfWidth * 1.8, 0.9);
    let seenSample = false;
    let stableSamples = 0;
    for (let dist = stepDist; dist <= maxDist; dist += stepDist) {
      const wx = centerX + dirX * dist;
      const wz = centerZ + dirZ * dist;
      const h = sampleRiverHeight(worldToGridX(wx), worldToGridY(wz));
      if (!Number.isFinite(h)) {
        continue;
      }
      seenSample = true;
      if (dist <= immediateWindow + stepDist * 0.5) {
        immediateMin = Math.min(immediateMin, h);
      }
      if (h < poolMin - 1e-4) {
        poolMin = h;
        poolDist = dist;
        stableSamples = 0;
      } else if (dist >= immediateWindow && h >= poolMin - 0.0025) {
        stableSamples += 1;
        if (stableSamples >= 2) {
          break;
        }
      }
    }
    const totalDrop = seenSample ? clamp(lipHeight - poolMin, 0, WATERFALL_MAX_DROP) : 0;
    const immediateDrop = seenSample
      ? clamp(lipHeight - Math.min(immediateMin, poolMin), 0, WATERFALL_MAX_DROP)
      : 0;
    const runLimit = Math.max(cellWorld * 1.5, halfWidth * 0.85);
    return {
      immediateDrop,
      totalDrop,
      runToPool: seenSample ? poolDist : runLimit + cellWorld,
      verticality: totalDrop > 1e-4 ? clamp(immediateDrop / totalDrop, 0, 1) : 0,
      runLimit
    };
  };
  const measureCrossSection = (
    centerCol: number,
    centerRow: number,
    flowX: number,
    flowY: number
  ): { halfWidth: number; centerShift: number } => {
    let perpX = -flowY;
    let perpY = flowX;
    const perpLen = Math.hypot(perpX, perpY);
    if (perpLen <= 1e-5) {
      perpX = 1;
      perpY = 0;
    } else {
      perpX /= perpLen;
      perpY /= perpLen;
    }
    const sampleSpan = (sign: number): number => {
      let span = 0;
      const maxSteps = 8;
      for (let s = 1; s <= maxSteps; s += 1) {
        const sx = Math.round(centerCol + perpX * sign * s);
        const sy = Math.round(centerRow + perpY * sign * s);
        if (!isValidCoord(sx, sy)) {
          break;
        }
        const sIdx = sy * sampleCols + sx;
        if (!isWaterCell(sIdx) || !isRiverCell(sIdx) || isOceanish(sIdx)) {
          break;
        }
        span = s;
      }
      return span;
    };
    const negSpan = sampleSpan(-1);
    const posSpan = sampleSpan(1);
    const halfCells = 0.5 + 0.5 * (negSpan + posSpan);
    const shiftCells = (posSpan - negSpan) * 0.5;
    return {
      halfWidth: clamp(halfCells * cellWorld, cellWorld * 0.45, cellWorld * 3.4),
      centerShift: shiftCells * cellWorld
    };
  };
  for (let row = 1; row < sampleRows - 1; row += 1) {
    for (let col = 1; col < sampleCols - 1; col += 1) {
      const idx = row * sampleCols + col;
      if (!isWaterCell(idx)) {
        continue;
      }
      flags[idx] |= WATERFALL_DEBUG_FLAG_WATER;
      if (!isRiverCell(idx)) {
        continue;
      }
      flags[idx] |= WATERFALL_DEBUG_FLAG_RIVER;
      if (isOceanish(idx)) {
        flags[idx] |= WATERFALL_DEBUG_FLAG_OCEANISH;
      }
      const support = countLocalRiverSupport(col, row);
      if (
        support.orth < WATERFALL_MIN_ORTH_RIVER_NEIGHBORS ||
        support.total < WATERFALL_MIN_LOCAL_RIVER_NEIGHBORS
      ) {
        continue;
      }
      const rawStepStrength = riverStepStrength ? riverStepStrength[idx] : 0;
      const stepStrength = Number.isFinite(rawStepStrength) ? clamp(rawStepStrength as number, 0, 1) : 0;
      stepStrengthDebug[idx] = stepStrength;
      if (stepStrength < WATERFALL_MIN_STEP_STRENGTH) {
        continue;
      }
      flags[idx] |= WATERFALL_DEBUG_FLAG_STEP_OK;
      if (isOceanish(idx)) {
        continue;
      }
      const center = waterHeights[idx] ?? 0;
      if (!Number.isFinite(center)) {
        continue;
      }
      let bestDrop = 0;
      let bestDx = 0;
      let bestDy = 0;
      const dirs = [
        { dx: -1, dy: 0 },
        { dx: 1, dy: 0 },
        { dx: 0, dy: -1 },
        { dx: 0, dy: 1 }
      ];
      dirs.forEach((dir) => {
        const nx = col + dir.dx;
        const ny = row + dir.dy;
        if (!isValidCoord(nx, ny)) {
          return;
        }
        const nIdx = ny * sampleCols + nx;
        if (nIdx < 0 || nIdx >= total || !isWaterCell(nIdx)) {
          return;
        }
        if (!isRiverCell(nIdx) || isOceanish(nIdx)) {
          return;
        }
        const neighborHeight = waterHeights[nIdx] ?? 0;
        if (!Number.isFinite(neighborHeight)) {
          return;
        }
        const drop = center - neighborHeight;
        if (drop > bestDrop) {
          bestDrop = drop;
          bestDx = dir.dx;
          bestDy = dir.dy;
        }
      });
      bestNeighborDropDebug[idx] = bestDrop;
      if (bestDrop < minDrop) {
        continue;
      }
      flags[idx] |= WATERFALL_DEBUG_FLAG_BEST_DROP_OK;
      const nx1 = col + bestDx;
      const ny1 = row + bestDy;
      const nx2 = col + bestDx * 2;
      const ny2 = row + bestDy * 2;
      if (!isValidCoord(nx1, ny1) || !isValidCoord(nx2, ny2)) {
        continue;
      }
      const idx1 = ny1 * sampleCols + nx1;
      const idx2 = ny2 * sampleCols + nx2;
      if (!isWaterCell(idx1) || !isWaterCell(idx2) || !isRiverCell(idx1) || !isRiverCell(idx2)) {
        continue;
      }
      if (isOceanish(idx1) || isOceanish(idx2)) {
        continue;
      }
      const h2 = waterHeights[idx2] ?? 0;
      if (!Number.isFinite(h2)) {
        continue;
      }
      let downstreamMin = h2;
      for (let stepMul = 3; stepMul <= 5; stepMul += 1) {
        const nx = col + bestDx * stepMul;
        const ny = row + bestDy * stepMul;
        if (!isValidCoord(nx, ny)) {
          break;
        }
        const nIdx = ny * sampleCols + nx;
        if (!isWaterCell(nIdx) || !isRiverCell(nIdx) || isOceanish(nIdx)) {
          break;
        }
        const h = waterHeights[nIdx] ?? Number.NaN;
        if (!Number.isFinite(h)) {
          break;
        }
        downstreamMin = Math.min(downstreamMin, h);
      }
      const localDrop = center - downstreamMin;
      localDropDebug[idx] = localDrop;
      if (localDrop < localDropThreshold) {
        continue;
      }
      flags[idx] |= WATERFALL_DEBUG_FLAG_LOCAL_DROP_OK;
      const x0 = toWorldX(col);
      const z0 = toWorldZ(row);
      const x1 = toWorldX(nx2);
      const z1 = toWorldZ(ny2);
      let dirX = x1 - x0;
      let dirZ = z1 - z0;
      const len = Math.hypot(dirX, dirZ) || 1;
      dirX /= len;
      dirZ /= len;
      const lipX = x0 + dirX * (cellWorldX * Math.abs(bestDx) * 0.5);
      const lipZ = z0 + dirZ * (cellWorldZ * Math.abs(bestDy) * 0.5);
      const cross = measureCrossSection(col, row, dirX, dirZ);
      const halfWidth = clamp(cross.halfWidth * (0.96 + stepStrength * 0.08), cellWorld * 0.45, cellWorld * 2.8);
      const centerX = lipX + (-dirZ) * cross.centerShift;
      const centerZ = lipZ + dirX * cross.centerShift;
      const lipHeight = sampleRiverHeight(worldToGridX(centerX), worldToGridY(centerZ));
      const profile = measureTrueFallProfileAtWorld(centerX, centerZ, dirX, dirZ, lipHeight, halfWidth);
      immediateDropDebug[idx] = profile.immediateDrop;
      totalDropDebug[idx] = profile.totalDrop;
      runToPoolDebug[idx] = profile.runToPool;
      verticalityDebug[idx] = profile.verticality;
      runLimitDebug[idx] = profile.runLimit;
      if (profile.totalDrop < minDrop) {
        continue;
      }
      if (profile.verticality < WATERFALL_VERTICALITY_MIN) {
        debug.lowVerticalityRejectedCount += 1;
        continue;
      }
      if (profile.runToPool > profile.runLimit) {
        debug.longRunRejectedCount += 1;
        continue;
      }
      const dropCap = Math.max(
        minDrop * 1.05,
        localDrop + WATERFALL_DROP_PADDING * 0.5 + stepStrength * minDrop * 0.35
      );
      const candidateDrop = Math.min(
        WATERFALL_MAX_DROP,
        profile.totalDrop + WATERFALL_DROP_PADDING + stepStrength * minDrop * 0.7,
        dropCap
      );
      flags[idx] |= WATERFALL_DEBUG_FLAG_CANDIDATE;
      candidates.push({
        sampleCol: col,
        sampleRow: row,
        x: centerX,
        z: centerZ,
        top: lipHeight + WATERFALL_TOP_OFFSET,
        drop: candidateDrop,
        dropCap,
        dirX,
        dirZ,
        width: halfWidth
      });
    }
  }
  debug.candidateCount = candidates.length;
  if (candidates.length === 0) {
    return { debug };
  }
  candidates.sort((a, b) => b.drop - a.drop);

  type Cluster = {
    x: number;
    z: number;
    top: number;
    drop: number;
    dropCap: number;
    dirX: number;
    dirZ: number;
    width: number;
    weight: number;
    minCol: number;
    maxCol: number;
    minRow: number;
    maxRow: number;
    anchorCol: number;
    anchorRow: number;
    count: number;
  };
  const clusters: Cluster[] = [];
  const minSampleSpacing = 2;
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const candidateWeight = Math.max(0.05, candidate.drop);
    let bestCluster = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let j = 0; j < clusters.length; j += 1) {
      const cluster = clusters[j];
      const dirDot = candidate.dirX * cluster.dirX + candidate.dirZ * cluster.dirZ;
      if (dirDot < 0.7) {
        continue;
      }
      const dx = Math.abs(candidate.sampleCol - Math.round((cluster.minCol + cluster.maxCol) * 0.5));
      const dy = Math.abs(candidate.sampleRow - Math.round((cluster.minRow + cluster.maxRow) * 0.5));
      if (dx > minSampleSpacing || dy > minSampleSpacing) {
        continue;
      }
      const worldDist = Math.hypot(candidate.x - cluster.x, candidate.z - cluster.z);
      const maxWorldDist = Math.max(0.8, (candidate.width + cluster.width) * 1.65);
      if (worldDist > maxWorldDist) {
        continue;
      }
      if (worldDist < bestScore) {
        bestScore = worldDist;
        bestCluster = j;
      }
    }
    if (bestCluster < 0) {
      clusters.push({
        x: candidate.x,
        z: candidate.z,
        top: candidate.top,
        drop: candidate.drop,
        dropCap: candidate.dropCap,
        dirX: candidate.dirX,
        dirZ: candidate.dirZ,
        width: candidate.width,
        weight: candidateWeight,
        minCol: candidate.sampleCol,
        maxCol: candidate.sampleCol,
        minRow: candidate.sampleRow,
        maxRow: candidate.sampleRow,
        anchorCol: candidate.sampleCol,
        anchorRow: candidate.sampleRow,
        count: 1
      });
      continue;
    }
    const cluster = clusters[bestCluster];
    const nextCount = cluster.count + 1;
    const totalWeight = cluster.weight + candidateWeight;
    cluster.x = (cluster.x * cluster.weight + candidate.x * candidateWeight) / totalWeight;
    cluster.z = (cluster.z * cluster.weight + candidate.z * candidateWeight) / totalWeight;
    cluster.top = (cluster.top * cluster.weight + candidate.top * candidateWeight) / totalWeight;
    cluster.drop = Math.max(cluster.drop, candidate.drop);
    cluster.dropCap = Math.max(cluster.dropCap, candidate.dropCap);
    cluster.width = Math.max(cluster.width, candidate.width);
    const dirLen = Math.hypot(cluster.dirX + candidate.dirX, cluster.dirZ + candidate.dirZ) || 1;
    cluster.dirX = (cluster.dirX + candidate.dirX) / dirLen;
    cluster.dirZ = (cluster.dirZ + candidate.dirZ) / dirLen;
    cluster.weight = totalWeight;
    cluster.minCol = Math.min(cluster.minCol, candidate.sampleCol);
    cluster.maxCol = Math.max(cluster.maxCol, candidate.sampleCol);
    cluster.minRow = Math.min(cluster.minRow, candidate.sampleRow);
    cluster.maxRow = Math.max(cluster.maxRow, candidate.sampleRow);
    cluster.anchorCol = Math.round((cluster.anchorCol * cluster.count + candidate.sampleCol) / nextCount);
    cluster.anchorRow = Math.round((cluster.anchorRow * cluster.count + candidate.sampleRow) / nextCount);
    cluster.count = nextCount;
  }

  debug.clusterCount = clusters.length;
  if (clusters.length === 0) {
    return { debug };
  }

  clusters.sort((a, b) => b.drop - a.drop);
  const contourEdges =
    riverDomain?.cutoutBoundaryEdges && riverDomain.cutoutBoundaryEdges.length >= 4
      ? riverDomain.cutoutBoundaryEdges
      : riverDomain?.boundaryEdges;
  const contourCols = riverDomain?.cols ?? sampleCols;
  const contourRows = riverDomain?.rows ?? sampleRows;
  const contourSpace = createRiverSpaceTransform(contourCols, contourRows, width, depth, sampleCols, sampleRows);
  const debugStats = riverDomain?.debugStats;
  let anchorErrSum = 0;
  let anchorErrMax = 0;
  let anchorErrCount = 0;
  const snapClusterToContour = (cluster: Cluster): Cluster | null => {
    const snapped = { ...cluster };
    if (contourEdges && contourEdges.length >= 4) {
      const pX = contourSpace.worldToEdgeX(cluster.x);
      const pY = contourSpace.worldToEdgeY(cluster.z);
      let bestDistSq = Number.POSITIVE_INFINITY;
      let bestEdgeX = pX;
      let bestEdgeY = pY;
      let bestSegmentLenWorld = 0;
      let bestTanX = cluster.dirX;
      let bestTanZ = cluster.dirZ;
      for (let i = 0; i < contourEdges.length; i += 4) {
        const ax = contourEdges[i];
        const ay = contourEdges[i + 1];
        const bx = contourEdges[i + 2];
        const by = contourEdges[i + 3];
        const abX = bx - ax;
        const abY = by - ay;
        const abLenSq = abX * abX + abY * abY;
        if (abLenSq <= 1e-6) {
          continue;
        }
        const t = clamp(((pX - ax) * abX + (pY - ay) * abY) / abLenSq, 0, 1);
        const qx = ax + abX * t;
        const qy = ay + abY * t;
        const dx = pX - qx;
        const dy = pY - qy;
        const distSq = dx * dx + dy * dy;
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          bestEdgeX = qx;
          bestEdgeY = qy;
          const segWorldX = (abX / Math.max(1, contourCols)) * width;
          const segWorldZ = (abY / Math.max(1, contourRows)) * depth;
          bestSegmentLenWorld = Math.hypot(segWorldX, segWorldZ);
          if (bestSegmentLenWorld > 1e-6) {
            bestTanX = segWorldX / bestSegmentLenWorld;
            bestTanZ = segWorldZ / bestSegmentLenWorld;
          }
        }
      }
      if (Number.isFinite(bestDistSq) && bestDistSq <= 4) {
        snapped.x = contourSpace.edgeToWorldX(bestEdgeX);
        snapped.z = contourSpace.edgeToWorldY(bestEdgeY);
        if (bestSegmentLenWorld > 0) {
          const tangentDot = bestTanX * snapped.dirX + bestTanZ * snapped.dirZ;
          if (Math.abs(tangentDot) >= 0.35) {
            if (tangentDot < 0) {
              bestTanX = -bestTanX;
              bestTanZ = -bestTanZ;
            }
            snapped.dirX = bestTanX;
            snapped.dirZ = bestTanZ;
          }
        }
      }
    }

    const localCross = measureWorldCrossSection(snapped.x, snapped.z, snapped.dirX, snapped.dirZ);
    snapped.x += localCross.shiftX;
    snapped.z += localCross.shiftZ;
    snapped.width = clamp(Math.max(snapped.width * 0.82, localCross.halfWidth), cellWorld * 0.45, cellWorld * 4.2);

    // Waterfall candidates are derived from the sampled water field in its own
    // cell-centered grid space. Re-sampling through the contour transform uses
    // a vertex-space mapping and can shift the anchor across a sharp drop.
    const sampleX = worldToGridX(snapped.x);
    const sampleY = worldToGridY(snapped.z);
    const sampledHeight = sampleRiverHeight(sampleX, sampleY);
    if (Number.isFinite(sampledHeight)) {
      snapped.top = sampledHeight + WATERFALL_TOP_OFFSET;
      snapped.anchorCol = clamp(Math.round(sampleX), 0, sampleCols - 1);
      snapped.anchorRow = clamp(Math.round(sampleY), 0, sampleRows - 1);
      const profile = measureTrueFallProfileAtWorld(snapped.x, snapped.z, snapped.dirX, snapped.dirZ, sampledHeight, snapped.width);
      if (
        profile.totalDrop < minDrop ||
        profile.verticality < WATERFALL_VERTICALITY_MIN ||
        profile.runToPool > profile.runLimit
      ) {
        return null;
      }
      snapped.drop = clamp(
        Math.min(profile.totalDrop + WATERFALL_DROP_PADDING * 0.85, snapped.dropCap),
        minDrop * 0.8,
        WATERFALL_MAX_DROP
      );
      return snapped;
    }
    return null;
  };

  const emitted: Cluster[] = [];
  for (let i = 0; i < clusters.length && emitted.length < WATERFALL_MAX_INSTANCES; i += 1) {
    const cluster = snapClusterToContour(clusters[i]);
    if (!cluster) {
      continue;
    }
    emitted.push(cluster);
  }
  if (emitted.length === 0) {
    return { debug };
  }
  const mergedEmitted: Cluster[] = [];
  for (let i = 0; i < emitted.length; i += 1) {
    const cluster = emitted[i];
    const clusterWeight = Math.max(0.1, cluster.weight);
    let bestMergeIndex = -1;
    let bestMergeScore = Number.POSITIVE_INFINITY;
    for (let j = 0; j < mergedEmitted.length; j += 1) {
      const existing = mergedEmitted[j];
      const dirDot = cluster.dirX * existing.dirX + cluster.dirZ * existing.dirZ;
      if (dirDot < 0.82) {
        continue;
      }
      const dx = cluster.x - existing.x;
      const dz = cluster.z - existing.z;
      const along = Math.abs(dx * existing.dirX + dz * existing.dirZ);
      const perp = Math.abs(dx * -existing.dirZ + dz * existing.dirX);
      const topDiff = Math.abs(cluster.top - existing.top);
      const widthLimit = Math.max(cluster.width, existing.width);
      const lateralLimit = Math.max(cellWorld * 0.9, widthLimit * 0.8);
      const alongLimit = Math.max(cellWorld * 1.6, widthLimit * 0.95);
      const topLimit = Math.max(cellWorld * 0.9, Math.min(cluster.drop, existing.drop) * 0.42, 0.06);
      if (perp > lateralLimit || along > alongLimit || topDiff > topLimit) {
        continue;
      }
      const score =
        perp / Math.max(1e-4, lateralLimit) +
        along / Math.max(1e-4, alongLimit) +
        topDiff / Math.max(1e-4, topLimit) +
        (1 - clamp(dirDot, -1, 1));
      if (score >= bestMergeScore) {
        continue;
      }
      bestMergeScore = score;
      bestMergeIndex = j;
    }
    if (bestMergeIndex < 0) {
      mergedEmitted.push({ ...cluster });
      continue;
    }
    const existing = mergedEmitted[bestMergeIndex];
    const existingWeight = Math.max(0.1, existing.weight);
    const totalWeight = existingWeight + clusterWeight;
    existing.x = (existing.x * existingWeight + cluster.x * clusterWeight) / totalWeight;
    existing.z = (existing.z * existingWeight + cluster.z * clusterWeight) / totalWeight;
    existing.top = (existing.top * existingWeight + cluster.top * clusterWeight) / totalWeight;
    existing.drop = Math.max(existing.drop, cluster.drop);
    existing.width = Math.max(existing.width, cluster.width);
    const dirX = existing.dirX * existingWeight + cluster.dirX * clusterWeight;
    const dirZ = existing.dirZ * existingWeight + cluster.dirZ * clusterWeight;
    const dirLen = Math.hypot(dirX, dirZ) || 1;
    existing.dirX = dirX / dirLen;
    existing.dirZ = dirZ / dirLen;
    existing.weight = totalWeight;
    existing.minCol = Math.min(existing.minCol, cluster.minCol);
    existing.maxCol = Math.max(existing.maxCol, cluster.maxCol);
    existing.minRow = Math.min(existing.minRow, cluster.minRow);
    existing.maxRow = Math.max(existing.maxRow, cluster.maxRow);
    existing.anchorCol = Math.round((existing.anchorCol * existingWeight + cluster.anchorCol * clusterWeight) / totalWeight);
    existing.anchorRow = Math.round((existing.anchorRow * existingWeight + cluster.anchorRow * clusterWeight) / totalWeight);
    existing.count += cluster.count;
  }
  const finalEmitted = mergedEmitted.slice(0, WATERFALL_MAX_INSTANCES);

  const out = new Float32Array(finalEmitted.length * 7);
  for (let i = 0; i < finalEmitted.length; i += 1) {
    const cluster = finalEmitted[i];
    const clusteredWidth = clamp(cluster.width, cellWorld * 0.45, cellWorld * 3.8);
    const base = i * 7;
    out[base] = cluster.x;
    out[base + 1] = cluster.z;
    out[base + 2] = cluster.top;
    out[base + 3] = cluster.drop;
    out[base + 4] = cluster.dirX;
    out[base + 5] = cluster.dirZ;
    out[base + 6] = clusteredWidth;
    const emittedCol = clamp(cluster.anchorCol, 0, sampleCols - 1);
    const emittedRow = clamp(cluster.anchorRow, 0, sampleRows - 1);
    flags[emittedRow * sampleCols + emittedCol] |= WATERFALL_DEBUG_FLAG_EMITTED;
    const sampledSurface = sampleRiverHeight(worldToGridX(cluster.x), worldToGridY(cluster.z));
    if (Number.isFinite(sampledSurface)) {
      const anchorError = Math.abs(cluster.top - WATERFALL_TOP_OFFSET - sampledSurface);
      anchorErrSum += anchorError;
      anchorErrMax = Math.max(anchorErrMax, anchorError);
      anchorErrCount += 1;
    }
  }
  if (debugStats) {
    debugStats.waterfallAnchorErrorMean = anchorErrCount > 0 ? anchorErrSum / anchorErrCount : 0;
    debugStats.waterfallAnchorErrorMax = anchorErrMax;
    if (debugStats.waterfallAnchorErrorMax > WATERFALL_ANCHOR_ERR_WARN) {
      console.warn(
        `[threeTestTerrain] waterfall anchor warning mean=${debugStats.waterfallAnchorErrorMean.toFixed(4)} max=${debugStats.waterfallAnchorErrorMax.toFixed(4)}`
      );
    }
  }
  debug.emittedCount = finalEmitted.length;
  return { instances: out, debug };
};

export const buildWaterfallInfluenceMap = (
  sampleCols: number,
  sampleRows: number,
  width: number,
  depth: number,
  supportMask: Uint8Array,
  waterHeights?: Float32Array,
  riverStepStrength?: Float32Array,
  waterfallInstances?: Float32Array
): THREE.DataTexture => {
  const total = sampleCols * sampleRows;
  const lipField = new Float32Array(total);
  const plungeField = new Float32Array(total);
  const seamField = new Float32Array(total);
  const cellWorldX = width / Math.max(1, sampleCols - 1);
  const cellWorldZ = depth / Math.max(1, sampleRows - 1);
  const cellWorld = Math.max(0.001, Math.min(cellWorldX, cellWorldZ));
  const stamp = (cx: number, cy: number, radius: number, target: Float32Array, strengthScale: number): void => {
    const minY = Math.max(0, cy - radius);
    const maxY = Math.min(sampleRows - 1, cy + radius);
    const minX = Math.max(0, cx - radius);
    const maxX = Math.min(sampleCols - 1, cx + radius);
    for (let y = minY; y <= maxY; y += 1) {
      const rowBase = y * sampleCols;
      for (let xCell = minX; xCell <= maxX; xCell += 1) {
        const idx = rowBase + xCell;
        if (!supportMask[idx]) {
          continue;
        }
        const dx = xCell - cx;
        const dy = y - cy;
        const dist = Math.hypot(dx, dy);
        if (dist > radius) {
          continue;
        }
        const t = 1 - dist / Math.max(1, radius);
        const influence = t * t * strengthScale;
        target[idx] = Math.max(target[idx], influence);
      }
    }
  };
  const stampWorld = (
    cxWorld: number,
    czWorld: number,
    radius: number,
    target: Float32Array,
    strengthScale: number
  ): void => {
    const u = clamp(cxWorld / Math.max(1e-4, width) + 0.5, 0, 1);
    const v = clamp(czWorld / Math.max(1e-4, depth) + 0.5, 0, 1);
    const cx = Math.round(u * Math.max(1, sampleCols - 1));
    const cy = Math.round(v * Math.max(1, sampleRows - 1));
    stamp(cx, cy, radius, target, strengthScale);
  };
  if (waterfallInstances && waterfallInstances.length >= 7) {
    const waterfallCount = Math.floor(waterfallInstances.length / 7);
    for (let i = 0; i < waterfallCount; i += 1) {
      const base = i * 7;
      const x = waterfallInstances[base];
      const z = waterfallInstances[base + 1];
      const drop = Math.max(0.06, waterfallInstances[base + 3]);
      const dirX = waterfallInstances[base + 4];
      const dirZ = waterfallInstances[base + 5];
      const halfWidth = Math.max(0.08, waterfallInstances[base + 6]);
      const shape = describeWaterfallShape(drop, halfWidth);
      const influenceStrength = clamp(drop / 1.6, 0, 1);
      const streamLen = Math.max(halfWidth * 0.9, shape.run);
      const lipX = x;
      const lipZ = z;
      const plungeX = x + dirX * shape.plungeForward;
      const plungeZ = z + dirZ * shape.plungeForward;
      const lipRadius = Math.max(
        1,
        Math.round((halfWidth * lerp(2.35, 1.75, shape.fallStyle) + drop * 0.15) / cellWorld)
      );
      const seamRadius = Math.max(
        1,
        Math.round((halfWidth * lerp(1.25, 0.9, shape.fallStyle) + drop * 0.08) / cellWorld)
      );
      const plungeRadius = Math.max(
        1,
        Math.round((halfWidth * lerp(1.4, 2.25, shape.fallStyle) + drop * lerp(0.18, 0.55, shape.fallStyle)) / cellWorld)
      );
      stampWorld(lipX, lipZ, lipRadius, lipField, 1.15 * influenceStrength);
      const seamSteps = Math.max(1, Math.min(6, Math.round(streamLen / Math.max(cellWorld * 0.8, halfWidth * 0.42))));
      for (let step = 1; step <= seamSteps; step += 1) {
        const t = step / seamSteps;
        const seamX = x + dirX * streamLen * t;
        const seamZ = z + dirZ * streamLen * t;
        stampWorld(
          seamX,
          seamZ,
          seamRadius,
          seamField,
          lerp(0.78, 0.24, t) * lerp(1.0, 0.72, shape.fallStyle) * influenceStrength
        );
      }
      stampWorld(plungeX, plungeZ, plungeRadius, plungeField, lerp(0.86, 1.28, shape.fallStyle) * influenceStrength);
    }
  }
  if (waterHeights && riverStepStrength) {
    const dirs = [
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 }
    ];
    for (let y = 1; y < sampleRows - 1; y += 1) {
      for (let x = 1; x < sampleCols - 1; x += 1) {
        const idx = y * sampleCols + x;
        if (!supportMask[idx]) {
          continue;
        }
        const rawStep = riverStepStrength[idx];
        const stepStrength = Number.isFinite(rawStep) ? clamp(rawStep, 0, 1) : 0;
        if (stepStrength < WATERFALL_MIN_STEP_STRENGTH * 0.72) {
          continue;
        }
        const center = waterHeights[idx];
        if (!Number.isFinite(center)) {
          continue;
        }
        let bestDrop = 0;
        let bestDx = 0;
        let bestDy = 0;
        for (let i = 0; i < dirs.length; i += 1) {
          const dir = dirs[i];
          const nIdx = (y + dir.dy) * sampleCols + (x + dir.dx);
          if (!supportMask[nIdx]) {
            continue;
          }
          const neighbor = waterHeights[nIdx];
          if (!Number.isFinite(neighbor)) {
            continue;
          }
          const drop = center - neighbor;
          if (drop > bestDrop) {
            bestDrop = drop;
            bestDx = dir.dx;
            bestDy = dir.dy;
          }
        }
        if (bestDrop <= 1e-4) {
          continue;
        }
        const seamStrength = clamp(stepStrength * (0.58 + bestDrop * 26), 0, 1);
        const seamRadius = Math.max(1, Math.round(lerp(1.05, 1.7, stepStrength)));
        stamp(x, y, seamRadius, seamField, seamStrength * 0.82);
        const seamSteps = Math.max(1, Math.min(3, Math.round(lerp(1.0, 2.8, seamStrength))));
        for (let step = 1; step <= seamSteps; step += 1) {
          const seamX = x + bestDx * step;
          const seamY = y + bestDy * step;
          if (seamX < 0 || seamY < 0 || seamX >= sampleCols || seamY >= sampleRows) {
            break;
          }
          const seamIdx = seamY * sampleCols + seamX;
          if (!supportMask[seamIdx]) {
            break;
          }
          const t = step / Math.max(1, seamSteps);
          stamp(seamX, seamY, seamRadius, seamField, seamStrength * lerp(0.68, 0.24, t));
        }
      }
    }
  }
  const data = new Uint8Array(total * 4);
  for (let i = 0; i < total; i += 1) {
    const base = i * 4;
    const lip = clamp(lipField[i], 0, 1);
    const plunge = clamp(plungeField[i], 0, 1);
    const seam = clamp(seamField[i], 0, 1);
    const combined = clamp(lip * 0.72 + plunge * 1.0, 0, 1);
    data[base] = Math.round(lip * 255);
    data[base + 1] = Math.round(plunge * 255);
    data[base + 2] = Math.round(combined * 255);
    data[base + 3] = Math.round(seam * 255);
  }
  return createDataTexture(data, sampleCols, sampleRows, THREE.LinearFilter, THREE.LinearFilter);
};
