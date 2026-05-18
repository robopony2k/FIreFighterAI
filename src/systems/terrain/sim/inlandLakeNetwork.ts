import type { WorldState } from "../../../core/state.js";
import type { MapGenSettings } from "../../../mapgen/settings.js";
import { clearVegetationState } from "../../../core/vegetation.js";
import { clamp } from "../../../core/utils.js";
import { hash2D } from "../../../mapgen/noise.js";
import {
  buildOceanDistanceField,
  buildStaticHydrologyFields
} from "./staticHydrologyFields.js";
import type {
  StaticHydrologyLake,
  StaticHydrologyRejectReason,
  StaticHydrologyRejectSummary,
  StaticHydrologyResult,
  StaticHydrologyWaterfall
} from "../types/staticHydrologyTypes.js";

const NEIGHBORS_4 = [
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 }
] as const;

const NEIGHBORS_8 = [
  ...NEIGHBORS_4,
  { dx: -1, dy: -1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: 1 },
  { dx: 1, dy: 1 }
] as const;

type LakeCandidate = {
  index: number;
  score: number;
  riverDistance: number;
};

type FloodedLakeCandidate = {
  tiles: number[];
  surfaceLevel: number;
  outletIndex: number;
  outletTargetIndex: number;
  inflowRiverTiles: number[];
  maxDepth: number;
};

type LakeBasinMetrics = {
  minElevation: number;
  maxDepth: number;
  boundaryEdges: number;
  rimEdges: number;
  lowEscapeEdges: number;
};

const incrementReject = (summary: StaticHydrologyRejectSummary, reason: StaticHydrologyRejectReason): void => {
  summary[reason] = (summary[reason] ?? 0) + 1;
};

const buildDistanceToMask = (
  cols: number,
  rows: number,
  mask: Uint8Array,
  maxDistance: number
): Uint16Array => {
  const total = cols * rows;
  const unvisited = 0xffff;
  const maxDist = Math.max(1, Math.min(unvisited - 1, Math.floor(maxDistance)));
  const dist = new Uint16Array(total);
  dist.fill(unvisited);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < total; i += 1) {
    if (mask[i] > 0) {
      dist[i] = 0;
      queue[tail] = i;
      tail += 1;
    }
  }
  while (head < tail) {
    const idx = queue[head];
    head += 1;
    const current = dist[idx] ?? maxDist;
    if (current >= maxDist) {
      continue;
    }
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    const push = (nIdx: number): void => {
      if (dist[nIdx] !== unvisited) {
        return;
      }
      dist[nIdx] = current + 1;
      queue[tail] = nIdx;
      tail += 1;
    };
    if (x > 0) {
      push(idx - 1);
    }
    if (x < cols - 1) {
      push(idx + 1);
    }
    if (y > 0) {
      push(idx - cols);
    }
    if (y < rows - 1) {
      push(idx + cols);
    }
  }
  for (let i = 0; i < total; i += 1) {
    if (dist[i] === unvisited) {
      dist[i] = maxDist;
    }
  }
  return dist;
};

const isLocalRunoffPeak = (
  idx: number,
  cols: number,
  rows: number,
  flow: Float32Array
): boolean => {
  const x = idx % cols;
  const y = Math.floor(idx / cols);
  const center = flow[idx] ?? 0;
  for (const dir of NEIGHBORS_8) {
    const nx = x + dir.dx;
    const ny = y + dir.dy;
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
      continue;
    }
    if ((flow[ny * cols + nx] ?? 0) > center) {
      return false;
    }
  }
  return true;
};

const localDepressionScore = (
  idx: number,
  cols: number,
  rows: number,
  elevationMap: ArrayLike<number>
): number => {
  const x = idx % cols;
  const y = Math.floor(idx / cols);
  const center = elevationMap[idx] ?? 0;
  let sum = 0;
  let count = 0;
  for (const dir of NEIGHBORS_8) {
    const nx = x + dir.dx;
    const ny = y + dir.dy;
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
      continue;
    }
    sum += elevationMap[ny * cols + nx] ?? center;
    count += 1;
  }
  if (count === 0) {
    return 0;
  }
  return clamp((sum / count - center) / 0.035, 0, 1);
};

const collectLakeCandidates = (
  state: WorldState,
  elevationMap: ArrayLike<number>,
  riverMask: Uint8Array,
  oceanMask: Uint8Array,
  oceanDistance: Uint16Array,
  riverDistance: Uint16Array,
  settings: MapGenSettings,
  rainfall: Float32Array,
  flow: Float32Array,
  rejected: StaticHydrologyRejectSummary
): LakeCandidate[] => {
  const cols = state.grid.cols;
  const rows = state.grid.rows;
  const candidates: LakeCandidate[] = [];
  const maxRiverDistance = Math.max(1, settings.maxRiverRerouteDistanceTiles);
  const minOceanDistance = Math.max(1, settings.minDistanceFromOceanTiles);
  const chance = clamp(settings.lakeChance, 0, 1);
  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    if (oceanMask[idx] > 0 || (oceanDistance[idx] ?? 0) < minOceanDistance) {
      incrementReject(rejected, "ocean-proximity");
      continue;
    }
    const elevation = elevationMap[idx] ?? 0;
    if (elevation < settings.lakeElevationMin || elevation > settings.lakeElevationMax) {
      incrementReject(rejected, "elevation-range");
      continue;
    }
    if ((rainfall[idx] ?? 0) < settings.minRainfallForLake * 0.72) {
      incrementReject(rejected, "weak-rainfall");
      continue;
    }
    if ((flow[idx] ?? 0) < settings.minCatchmentRunoffForLake * 0.68) {
      incrementReject(rejected, "weak-runoff");
      continue;
    }
    const rDist = riverDistance[idx] ?? maxRiverDistance + 1;
    const onRiverPath = riverMask[idx] > 0 || rDist <= maxRiverDistance;
    if (!onRiverPath && !isLocalRunoffPeak(idx, cols, rows, flow)) {
      continue;
    }
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    const chanceRoll = hash2D(x, y, state.seed + 45_211);
    const riverAffinity = clamp(1 - rDist / Math.max(1, maxRiverDistance), 0, 1);
    if (chanceRoll > chance && riverAffinity < 0.5) {
      continue;
    }
    const basin = localDepressionScore(idx, cols, rows, elevationMap);
    const score =
      (flow[idx] ?? 0) * 0.42 +
      (rainfall[idx] ?? 0) * 0.22 +
      riverAffinity * settings.preferLakesOnRiverPaths * 0.24 +
      basin * 0.18 -
      chanceRoll * 0.04;
    candidates.push({ index: idx, score, riverDistance: rDist });
  }
  candidates.sort((a, b) => b.score - a.score || a.riverDistance - b.riverDistance || a.index - b.index);
  return candidates.slice(0, Math.max(settings.maxLakeCount * 48, 64));
};

const smoothLakeTiles = (
  tiles: number[],
  cols: number,
  rows: number,
  settings: MapGenSettings,
  blockedMask: Uint8Array
): number[] => {
  if (settings.lakeShapeSmoothingPasses <= 0 || tiles.length === 0) {
    return tiles;
  }
  const total = cols * rows;
  let mask = new Uint8Array(total);
  for (const idx of tiles) {
    mask[idx] = 1;
  }
  for (let pass = 0; pass < settings.lakeShapeSmoothingPasses; pass += 1) {
    const next = new Uint8Array(mask);
    for (const idx of tiles) {
      const x = idx % cols;
      const y = Math.floor(idx / cols);
      let support = 0;
      for (const dir of NEIGHBORS_8) {
        const nx = x + dir.dx;
        const ny = y + dir.dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
          continue;
        }
        if (mask[ny * cols + nx] > 0) {
          support += 1;
        }
      }
      if (support <= 1) {
        next[idx] = 0;
      }
    }
    for (const idx of tiles) {
      const x = idx % cols;
      const y = Math.floor(idx / cols);
      for (const dir of NEIGHBORS_4) {
        const nx = x + dir.dx;
        const ny = y + dir.dy;
        if (nx <= 0 || ny <= 0 || nx >= cols - 1 || ny >= rows - 1) {
          continue;
        }
        const nIdx = ny * cols + nx;
        if (next[nIdx] > 0 || blockedMask[nIdx] > 0) {
          continue;
        }
        let support = 0;
        for (const supportDir of NEIGHBORS_8) {
          const sx = nx + supportDir.dx;
          const sy = ny + supportDir.dy;
          if (sx < 0 || sy < 0 || sx >= cols || sy >= rows) {
            continue;
          }
          if (mask[sy * cols + sx] > 0) {
            support += 1;
          }
        }
        if (support >= 6) {
          next[nIdx] = 1;
        }
      }
    }
    mask = next;
  }
  const smoothed: number[] = [];
  for (let i = 0; i < total; i += 1) {
    if (mask[i] > 0) {
      smoothed.push(i);
    }
  }
  return smoothed;
};

const measureLakeBasin = (
  tiles: number[],
  cols: number,
  rows: number,
  elevationMap: ArrayLike<number>,
  surfaceLevel: number,
  settings: MapGenSettings
): LakeBasinMetrics => {
  const total = cols * rows;
  const tileSet = new Uint8Array(total);
  for (const idx of tiles) {
    tileSet[idx] = 1;
  }
  let minElevation = Number.POSITIVE_INFINITY;
  let boundaryEdges = 0;
  let rimEdges = 0;
  let lowEscapeEdges = 0;
  const rimThreshold = surfaceLevel - Math.max(0.002, settings.minLakeDepth * 0.35);
  const lowEscapeThreshold = surfaceLevel - Math.max(settings.minOutletDrop, settings.minLakeDepth * 0.45);
  for (const idx of tiles) {
    const elevation = elevationMap[idx] ?? surfaceLevel;
    minElevation = Math.min(minElevation, elevation);
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    for (const dir of NEIGHBORS_4) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
        boundaryEdges += 1;
        lowEscapeEdges += 1;
        continue;
      }
      const nIdx = ny * cols + nx;
      if (tileSet[nIdx] > 0) {
        continue;
      }
      boundaryEdges += 1;
      const nElevation = elevationMap[nIdx] ?? surfaceLevel;
      if (nElevation >= rimThreshold) {
        rimEdges += 1;
      } else if (nElevation <= lowEscapeThreshold) {
        lowEscapeEdges += 1;
      }
    }
  }
  return {
    minElevation: Number.isFinite(minElevation) ? minElevation : surfaceLevel,
    maxDepth: surfaceLevel - (Number.isFinite(minElevation) ? minElevation : surfaceLevel),
    boundaryEdges,
    rimEdges,
    lowEscapeEdges
  };
};

const hasCredibleLakeBasin = (metrics: LakeBasinMetrics): boolean => {
  if (metrics.boundaryEdges <= 0) {
    return false;
  }
  const rimRatio = metrics.rimEdges / metrics.boundaryEdges;
  const lowEscapeRatio = metrics.lowEscapeEdges / metrics.boundaryEdges;
  return rimRatio >= 0.24 && lowEscapeRatio <= 0.54;
};

const buildLakeShoreDistances = (
  tiles: number[],
  cols: number,
  rows: number
): Map<number, number> => {
  const total = cols * rows;
  const tileSet = new Uint8Array(total);
  const dist = new Int16Array(total);
  dist.fill(-1);
  const queue = new Int32Array(Math.max(1, tiles.length));
  let head = 0;
  let tail = 0;
  for (const idx of tiles) {
    tileSet[idx] = 1;
  }
  for (const idx of tiles) {
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    let shore = false;
    for (const dir of NEIGHBORS_4) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || tileSet[ny * cols + nx] === 0) {
        shore = true;
        break;
      }
    }
    if (shore) {
      dist[idx] = 0;
      queue[tail] = idx;
      tail += 1;
    }
  }
  while (head < tail) {
    const idx = queue[head];
    head += 1;
    const current = dist[idx] ?? 0;
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    for (const dir of NEIGHBORS_4) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
        continue;
      }
      const nIdx = ny * cols + nx;
      if (tileSet[nIdx] === 0 || dist[nIdx] >= 0) {
        continue;
      }
      dist[nIdx] = current + 1;
      queue[tail] = nIdx;
      tail += 1;
    }
  }
  const distances = new Map<number, number>();
  for (const idx of tiles) {
    distances.set(idx, Math.max(0, dist[idx] ?? 0));
  }
  return distances;
};

const floodLakeCandidate = (
  seedIdx: number,
  state: WorldState,
  elevationMap: ArrayLike<number>,
  riverMask: Uint8Array,
  oceanMask: Uint8Array,
  oceanDistance: Uint16Array,
  existingLakeMask: Uint16Array,
  settings: MapGenSettings,
  rejected: StaticHydrologyRejectSummary
): FloodedLakeCandidate | null => {
  const cols = state.grid.cols;
  const rows = state.grid.rows;
  const total = state.grid.totalTiles;
  const seedElevation = elevationMap[seedIdx] ?? 0;
  const surfaceLevel = clamp(
    seedElevation + settings.minLakeDepth + (settings.maxLakeDepth - settings.minLakeDepth) * 0.62,
    0,
    1
  );
  const maxRadius = Math.max(3, Math.ceil(Math.sqrt(settings.maxLakeAreaTiles) * 1.9));
  const seedX = seedIdx % cols;
  const seedY = Math.floor(seedIdx / cols);
  const queue = new Int32Array(Math.min(total, settings.maxLakeAreaTiles + 512));
  const visited = new Uint8Array(total);
  const tileSet = new Uint8Array(total);
  const tiles: number[] = [];
  let head = 0;
  let tail = 0;
  queue[tail] = seedIdx;
  tail += 1;
  visited[seedIdx] = 1;
  let overlapped = false;
  while (head < tail) {
    const idx = queue[head];
    head += 1;
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    if (Math.abs(x - seedX) > maxRadius || Math.abs(y - seedY) > maxRadius) {
      continue;
    }
    if (oceanMask[idx] > 0 || (oceanDistance[idx] ?? 0) < settings.minDistanceFromOceanTiles) {
      continue;
    }
    if (existingLakeMask[idx] > 0) {
      overlapped = true;
      continue;
    }
    const elevation = elevationMap[idx] ?? seedElevation;
    if (elevation > surfaceLevel) {
      continue;
    }
    tileSet[idx] = 1;
    tiles.push(idx);
    for (const dir of NEIGHBORS_4) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
        continue;
      }
      const nIdx = ny * cols + nx;
      if (visited[nIdx] > 0) {
        continue;
      }
      if (tail >= queue.length) {
        continue;
      }
      visited[nIdx] = 1;
      queue[tail] = nIdx;
      tail += 1;
    }
  }
  if (overlapped) {
    incrementReject(rejected, "overlap");
    return null;
  }
  let boundedTiles = tiles;
  if (boundedTiles.length > settings.maxLakeAreaTiles) {
    boundedTiles = boundedTiles
      .slice()
      .sort((a, b) => {
        const ax = a % cols;
        const ay = Math.floor(a / cols);
        const bx = b % cols;
        const by = Math.floor(b / cols);
        const aDist = Math.hypot(ax - seedX, ay - seedY);
        const bDist = Math.hypot(bx - seedX, by - seedY);
        return aDist - bDist || (elevationMap[a] ?? 0) - (elevationMap[b] ?? 0) || a - b;
      })
      .slice(0, settings.maxLakeAreaTiles);
  }
  const smoothedTiles = smoothLakeTiles(boundedTiles, cols, rows, settings, oceanMask);
  if (smoothedTiles.length < settings.minLakeAreaTiles) {
    incrementReject(rejected, "area-small");
    return null;
  }
  if (smoothedTiles.length > settings.maxLakeAreaTiles) {
    incrementReject(rejected, "area-large");
    return null;
  }
  const basinMetrics = measureLakeBasin(smoothedTiles, cols, rows, elevationMap, surfaceLevel, settings);
  if (!hasCredibleLakeBasin(basinMetrics)) {
    incrementReject(rejected, "weak-basin");
    return null;
  }
  if (basinMetrics.maxDepth < settings.minLakeDepth) {
    incrementReject(rejected, "depth-small");
    return null;
  }
  tileSet.fill(0);
  for (const idx of smoothedTiles) {
    tileSet[idx] = 1;
  }

  let outletIndex = -1;
  let outletTargetIndex = -1;
  let outletScore = Number.POSITIVE_INFINITY;
  const inflowSet = new Set<number>();
  for (const idx of smoothedTiles) {
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    if (riverMask[idx] > 0) {
      inflowSet.add(idx);
    }
    for (const dir of NEIGHBORS_4) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
        continue;
      }
      const nIdx = ny * cols + nx;
      if (riverMask[nIdx] > 0) {
        inflowSet.add(nIdx);
      }
      if (tileSet[nIdx] > 0 || oceanMask[nIdx] > 0) {
        continue;
      }
      if ((oceanDistance[nIdx] ?? 0) < settings.waterfallAvoidCoastTiles) {
        continue;
      }
      const nElevation = elevationMap[nIdx] ?? surfaceLevel;
      const drop = surfaceLevel - nElevation;
      if (drop < settings.minOutletDrop) {
        continue;
      }
      const score = nElevation + (riverMask[nIdx] > 0 ? -0.01 : 0) + hash2D(nx, ny, state.seed + 58_003) * 0.002;
      if (score < outletScore) {
        outletScore = score;
        outletIndex = idx;
        outletTargetIndex = nIdx;
      }
    }
  }
  if (outletIndex < 0 && !settings.allowEndorheicLakes) {
    incrementReject(rejected, "no-outlet");
    return null;
  }

  return {
    tiles: smoothedTiles,
    surfaceLevel,
    outletIndex,
    outletTargetIndex,
    inflowRiverTiles: Array.from(inflowSet).sort((a, b) => a - b),
    maxDepth: basinMetrics.maxDepth
  };
};

const stampLakeWater = (
  state: WorldState,
  elevationMap: number[],
  riverMask: Uint8Array,
  riverSurface: Float32Array,
  riverBed: Float32Array,
  riverStepStrength: Float32Array,
  lakeMask: Uint16Array,
  lakeSurface: Float32Array,
  lakeOutletMask: Uint8Array,
  riverLakeEntryMask: Uint8Array,
  riverLakeExitMask: Uint8Array,
  lake: StaticHydrologyLake,
  settings: MapGenSettings
): void => {
  const cols = state.grid.cols;
  const rows = state.grid.rows;
  const shoreDistances = buildLakeShoreDistances(lake.tiles, cols, rows);
  for (const idx of lake.tiles) {
    lakeMask[idx] = lake.id;
    lakeSurface[idx] = lake.surfaceLevel;
    const shoreDistance = shoreDistances.get(idx) ?? 0;
    const depthT = clamp(shoreDistance / 4, 0, 1);
    const bedDepth = settings.minLakeDepth * 0.75 + (settings.maxLakeDepth - settings.minLakeDepth) * 0.58 * depthT;
    const bedElevation = clamp(lake.surfaceLevel - bedDepth, 0, 1);
    elevationMap[idx] = bedElevation;
    state.tileElevation[idx] = bedElevation;
    const tile = state.tiles[idx];
    if (tile) {
      tile.type = "water";
      tile.elevation = bedElevation;
      tile.moisture = 1;
      tile.waterDist = 0;
      tile.fuel = 0;
      tile.fire = 0;
      tile.heat = 0;
      tile.isBase = false;
      clearVegetationState(tile);
      tile.dominantTreeType = null;
      tile.treeType = null;
    }
    state.tileLakeMask[idx] = lake.id;
    state.tileLakeSurface[idx] = lake.surfaceLevel;
    state.tileMoisture[idx] = 1;
    state.tileFuel[idx] = 0;
    state.tileFire[idx] = 0;
  }
  for (const idx of lake.inflowRiverTiles) {
    riverLakeEntryMask[idx] = 1;
  }
  if (lake.outletIndex >= 0) {
    lakeOutletMask[lake.outletIndex] = 1;
    riverLakeExitMask[lake.outletIndex] = 1;
    state.tileLakeOutletMask[lake.outletIndex] = 1;
  }
  if (lake.outletTargetIndex >= 0) {
    const target = lake.outletTargetIndex;
    riverMask[target] = 1;
    riverLakeExitMask[target] = 1;
    const targetElevation = elevationMap[target] ?? lake.surfaceLevel;
    const outletSurface = Math.max(targetElevation - 0.001, lake.surfaceLevel - settings.minOutletDrop);
    riverSurface[target] = Number.isFinite(riverSurface[target])
      ? Math.min(riverSurface[target], outletSurface)
      : outletSurface;
    riverBed[target] = Number.isFinite(riverBed[target])
      ? Math.min(riverBed[target], outletSurface - 0.006)
      : outletSurface - 0.006;
    riverStepStrength[target] = Math.max(riverStepStrength[target] ?? 0, 0.22);
    const tile = state.tiles[target];
    if (tile) {
      tile.type = "water";
      tile.moisture = 1;
      tile.waterDist = 0;
      tile.fuel = 0;
      tile.fire = 0;
      clearVegetationState(tile);
    }
  }
};

const farEnoughFromWaterfalls = (
  sourceIdx: number,
  cols: number,
  accepted: StaticHydrologyWaterfall[],
  spacing: number
): boolean => {
  const x = sourceIdx % cols;
  const y = Math.floor(sourceIdx / cols);
  for (const waterfall of accepted) {
    const ox = waterfall.sourceIndex % cols;
    const oy = Math.floor(waterfall.sourceIndex / cols);
    if (Math.hypot(x - ox, y - oy) < spacing) {
      return false;
    }
  }
  return true;
};

const addWaterfall = (
  waterfall: StaticHydrologyWaterfall,
  cols: number,
  settings: MapGenSettings,
  accepted: StaticHydrologyWaterfall[]
): boolean => {
  if (waterfall.drop < settings.waterfallMinDrop || waterfall.flowScore < settings.waterfallMinFlow) {
    return false;
  }
  if (!farEnoughFromWaterfalls(waterfall.sourceIndex, cols, accepted, settings.waterfallMinSpacingTiles)) {
    return false;
  }
  if (accepted.length >= settings.waterfallMaxPerRiver) {
    return false;
  }
  accepted.push(waterfall);
  return true;
};

const buildWaterfalls = (
  state: WorldState,
  riverMask: Uint8Array,
  oceanMask: Uint8Array,
  oceanDistance: Uint16Array,
  lakeMask: Uint16Array,
  lakes: StaticHydrologyLake[],
  riverSurface: Float32Array,
  riverStepStrength: Float32Array,
  flow: Float32Array,
  settings: MapGenSettings
): { waterfalls: StaticHydrologyWaterfall[]; rejected: number } => {
  const cols = state.grid.cols;
  const rows = state.grid.rows;
  const waterfalls: StaticHydrologyWaterfall[] = [];
  let rejected = 0;
  if (settings.waterfallAllowLakeOutlet) {
    for (const lake of lakes) {
      if (lake.outletIndex < 0 || lake.outletTargetIndex < 0) {
        continue;
      }
      if (
        oceanMask[lake.outletTargetIndex] > 0 ||
        (oceanDistance[lake.outletTargetIndex] ?? 0) < settings.waterfallAvoidCoastTiles
      ) {
        rejected += 1;
        continue;
      }
      const targetElevation = state.tiles[lake.outletTargetIndex]?.elevation ?? lake.surfaceLevel;
      const drop = lake.surfaceLevel - targetElevation;
      if (!addWaterfall(
        {
          sourceIndex: lake.outletIndex,
          targetIndex: lake.outletTargetIndex,
          drop,
          flowScore: Math.max(lake.runoffScore, flow[lake.outletTargetIndex] ?? 0),
          lakeId: lake.id
        },
        cols,
        settings,
        waterfalls
      )) {
        rejected += 1;
      }
    }
  }
  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    if (riverMask[idx] === 0 || lakeMask[idx] > 0 || oceanMask[idx] > 0) {
      continue;
    }
    if ((oceanDistance[idx] ?? 0) < settings.waterfallAvoidCoastTiles) {
      rejected += 1;
      continue;
    }
    const sourceSurface = riverSurface[idx];
    if (!Number.isFinite(sourceSurface)) {
      continue;
    }
    const stepStrength = riverStepStrength[idx] ?? 0;
    if (stepStrength < 0.18) {
      continue;
    }
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    let bestTarget = -1;
    let bestDrop = 0;
    for (const dir of NEIGHBORS_4) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
        continue;
      }
      const nIdx = ny * cols + nx;
      if (riverMask[nIdx] === 0 || lakeMask[nIdx] > 0 || oceanMask[nIdx] > 0) {
        continue;
      }
      const targetSurface = riverSurface[nIdx];
      if (!Number.isFinite(targetSurface)) {
        continue;
      }
      const drop = sourceSurface - targetSurface;
      if (drop > bestDrop) {
        bestDrop = drop;
        bestTarget = nIdx;
      }
    }
    if (bestTarget < 0) {
      continue;
    }
    if (!addWaterfall(
      {
        sourceIndex: idx,
        targetIndex: bestTarget,
        drop: bestDrop,
        flowScore: flow[idx] ?? 0,
        lakeId: 0
      },
      cols,
      settings,
      waterfalls
    )) {
      rejected += 1;
    }
  }
  return { waterfalls, rejected };
};

export const buildStaticInlandLakeNetwork = (input: {
  state: WorldState;
  elevationMap: number[];
  riverMask: Uint8Array;
  oceanMask: Uint8Array;
  settings: MapGenSettings;
}): StaticHydrologyResult => {
  const { state, elevationMap, riverMask, oceanMask, settings } = input;
  const total = state.grid.totalTiles;
  const fields = buildStaticHydrologyFields(state, elevationMap, oceanMask, settings);
  const lakeMask = new Uint16Array(total);
  const lakeSurface = new Float32Array(total).fill(Number.NaN);
  const lakeOutletMask = new Uint8Array(total);
  const riverLakeEntryMask = new Uint8Array(total);
  const riverLakeExitMask = new Uint8Array(total);
  const waterfallSourceMask = new Uint8Array(total);
  const waterfallTarget = new Int32Array(total).fill(-1);
  const waterfallDrop = new Float32Array(total);
  const rejectedLakeCandidates: StaticHydrologyRejectSummary = {};
  const oceanDistance = buildOceanDistanceField(
    state.grid.cols,
    state.grid.rows,
    oceanMask,
    Math.max(state.grid.cols, state.grid.rows)
  );
  const riverDistance = buildDistanceToMask(
    state.grid.cols,
    state.grid.rows,
    riverMask,
    Math.max(1, settings.maxRiverRerouteDistanceTiles + 2)
  );
  const candidates = collectLakeCandidates(
    state,
    elevationMap,
    riverMask,
    oceanMask,
    oceanDistance,
    riverDistance,
    settings,
    fields.rainfall,
    fields.flow,
    rejectedLakeCandidates
  );
  state.tileLakeMask.fill(0);
  state.tileLakeSurface.fill(Number.NaN);
  state.tileLakeOutletMask.fill(0);
  const riverSurface = state.tileRiverSurface;
  const riverBed = state.tileRiverBed;
  const riverStepStrength = state.tileRiverStepStrength;
  const lakes: StaticHydrologyLake[] = [];
  for (const candidate of candidates) {
    if (lakes.length >= settings.maxLakeCount) {
      break;
    }
    const flooded = floodLakeCandidate(
      candidate.index,
      state,
      elevationMap,
      riverMask,
      oceanMask,
      oceanDistance,
      lakeMask,
      settings,
      rejectedLakeCandidates
    );
    if (!flooded) {
      continue;
    }
    const lakeId = lakes.length + 1;
    const runoffScore =
      flooded.tiles.reduce((sum, idx) => sum + (fields.flow[idx] ?? 0), 0) / Math.max(1, flooded.tiles.length);
    const rainfallScore =
      flooded.tiles.reduce((sum, idx) => sum + (fields.rainfall[idx] ?? 0), 0) / Math.max(1, flooded.tiles.length);
    if (rainfallScore < settings.minRainfallForLake || runoffScore < settings.minCatchmentRunoffForLake) {
      incrementReject(
        rejectedLakeCandidates,
        rainfallScore < settings.minRainfallForLake ? "weak-rainfall" : "weak-runoff"
      );
      continue;
    }
    const lake: StaticHydrologyLake = {
      id: lakeId,
      tiles: flooded.tiles,
      surfaceLevel: flooded.surfaceLevel,
      outletIndex: flooded.outletIndex,
      outletTargetIndex: flooded.outletTargetIndex,
      inflowRiverTiles: flooded.inflowRiverTiles,
      outflowRiverTile: flooded.outletTargetIndex,
      basinSeedIndex: candidate.index,
      rainfallScore,
      runoffScore,
      maxDepth: flooded.maxDepth
    };
    stampLakeWater(
      state,
      elevationMap,
      riverMask,
      riverSurface,
      riverBed,
      riverStepStrength,
      lakeMask,
      lakeSurface,
      lakeOutletMask,
      riverLakeEntryMask,
      riverLakeExitMask,
      lake,
      settings
    );
    lakes.push(lake);
  }

  const waterfallBuild = buildWaterfalls(
    state,
    riverMask,
    oceanMask,
    oceanDistance,
    lakeMask,
    lakes,
    riverSurface,
    riverStepStrength,
    fields.flow,
    settings
  );
  for (const waterfall of waterfallBuild.waterfalls) {
    waterfallSourceMask[waterfall.sourceIndex] = 1;
    waterfallTarget[waterfall.sourceIndex] = waterfall.targetIndex;
    waterfallDrop[waterfall.sourceIndex] = waterfall.drop;
    state.tileWaterfallSourceMask[waterfall.sourceIndex] = 1;
    state.tileWaterfallTarget[waterfall.sourceIndex] = waterfall.targetIndex;
    state.tileWaterfallDrop[waterfall.sourceIndex] = waterfall.drop;
  }

  return {
    ...fields,
    lakeMask,
    lakeSurface,
    lakeOutletMask,
    riverLakeEntryMask,
    riverLakeExitMask,
    waterfallSourceMask,
    waterfallTarget,
    waterfallDrop,
    lakes,
    waterfalls: waterfallBuild.waterfalls,
    rejectedLakeCandidates,
    rejectedWaterfallCandidates: waterfallBuild.rejected
  };
};
