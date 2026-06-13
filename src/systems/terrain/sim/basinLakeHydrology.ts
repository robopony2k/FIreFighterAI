import type { WorldState } from "../../../core/state.js";
import { clearVegetationState } from "../../../core/vegetation.js";
import { clamp } from "../../../core/utils.js";
import type { MapGenSettings } from "../../../mapgen/settings.js";
import { buildOceanDistanceField, buildStaticHydrologyFields } from "./staticHydrologyFields.js";
import { buildLakeOverflowRiverPaths } from "./lakeOverflowRiverRouting.js";
import {
  HYDROLOGY_FEATURE_CLASS_CODE,
  classifyHydrologyFeatures,
  type HydrologyFeatureClassification
} from "./hydrologyFeatureClassifier.js";
import { buildLakeSpillContour } from "./lakeSpillContour.js";
import { solveDepressionBasins, type DepressionBasin } from "./depressionBasinSolver.js";
import type {
  StaticHydrologyLake,
  StaticHydrologyDebugHooks,
  StaticHydrologyRejectReason,
  StaticHydrologyRejectSummary,
  StaticHydrologyResult,
  StaticHydrologyWaterfall,
  StaticHydrologyWaterfallRejectReason
} from "../types/staticHydrologyTypes.js";
import type { LakeOverflowRiverPath } from "./lakeOverflowRiverRouting.js";

const NEIGHBORS_4 = [
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 }
] as const;

const MIN_VISIBLE_LAKE_OUTLET_TILES = 4;
const MAX_LAKE_LAND_COVERAGE = 0.12;
const LAKE_OUTLET_WATERFALL_MIN_DROP_SCALE = 0.5;
const LAKE_OUTLET_WATERFALL_MIN_DROP_FLOOR = 0.01;

type AcceptedBasinLake = StaticHydrologyLake & {
  basin: DepressionBasin;
};

type RiverConnectionStampOptions = {
  bedDepthScale?: number;
  carveScale?: number;
  valleyScale?: number;
};

const idxAt = (x: number, y: number, cols: number): number => y * cols + x;

const incrementReject = (summary: StaticHydrologyRejectSummary, reason: StaticHydrologyRejectReason): void => {
  summary[reason] = (summary[reason] ?? 0) + 1;
};

const outletCarveScale = (settings: MapGenSettings): number => {
  const intensity = clamp(settings.riverIntensity, 0, 1);
  return clamp(0.04 + Math.pow(intensity, 0.85) * 0.96, 0.04, 1);
};

const resetStaticHydrologyState = (state: WorldState): void => {
  state.tileLakeMask.fill(0);
  state.tileLakeSurface.fill(Number.NaN);
  state.tileLakeOutletMask.fill(0);
  state.tileWaterfallSourceMask.fill(0);
  state.tileWaterfallTarget.fill(-1);
  state.tileWaterfallDrop.fill(0);
};

const buildLakeShoreDistances = (tiles: readonly number[], cols: number, rows: number): Map<number, number> => {
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
    const shore = NEIGHBORS_4.some((dir) => {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      return nx < 0 || ny < 0 || nx >= cols || ny >= rows || tileSet[idxAt(nx, ny, cols)] === 0;
    });
    if (shore) {
      dist[idx] = 0;
      queue[tail] = idx;
      tail += 1;
    }
  }
  while (head < tail) {
    const idx = queue[head];
    head += 1;
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    const current = dist[idx] ?? 0;
    for (const dir of NEIGHBORS_4) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
        continue;
      }
      const nIdx = idxAt(nx, ny, cols);
      if (tileSet[nIdx] === 0 || dist[nIdx] >= 0) {
        continue;
      }
      dist[nIdx] = current + 1;
      queue[tail] = nIdx;
      tail += 1;
    }
  }
  const result = new Map<number, number>();
  for (const idx of tiles) {
    result.set(idx, Math.max(0, dist[idx] ?? 0));
  }
  return result;
};

const collectInflowRiverTiles = (
  tiles: readonly number[],
  cols: number,
  rows: number,
  riverMask: Uint8Array
): number[] => {
  const inflow = new Set<number>();
  const tileSet = new Set<number>(tiles);
  for (const idx of tiles) {
    if (riverMask[idx] > 0) {
      inflow.add(idx);
    }
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    for (const dir of NEIGHBORS_4) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
        continue;
      }
      const nIdx = idxAt(nx, ny, cols);
      if (!tileSet.has(nIdx) && riverMask[nIdx] > 0) {
        inflow.add(nIdx);
      }
    }
  }
  return Array.from(inflow).sort((a, b) => a - b);
};

const candidateRejectReason = (
  basin: DepressionBasin,
  footprintTiles: readonly number[],
  state: WorldState,
  lakeMask: Uint16Array,
  oceanDistance: Uint16Array,
  landTileCount: number,
  settings: MapGenSettings
): StaticHydrologyRejectReason | null => {
  if (basin.area < settings.minLakeAreaTiles || footprintTiles.length < settings.minLakeAreaTiles) {
    return "area-small";
  }
  if (footprintTiles.length > settings.maxLakeAreaTiles) {
    return "area-large";
  }
  const relativeAreaLimit = Math.max(settings.minLakeAreaTiles, Math.floor(landTileCount * MAX_LAKE_LAND_COVERAGE));
  if (footprintTiles.length > relativeAreaLimit) {
    return "area-large";
  }
  if (basin.maxDepth < settings.minLakeDepth) {
    return "depth-small";
  }
  if (basin.spillElevation < settings.lakeElevationMin || basin.spillElevation > settings.lakeElevationMax) {
    return "elevation-range";
  }
  for (const idx of footprintTiles) {
    if (lakeMask[idx] > 0) {
      return "overlap";
    }
    if ((oceanDistance[idx] ?? 0) < settings.minDistanceFromOceanTiles) {
      return "ocean-proximity";
    }
  }
  if (basin.outletIndex < 0 || basin.outletTargetIndex < 0) {
    return settings.allowEndorheicLakes ? null : "no-outlet";
  }
  const deepBasin = basin.maxDepth >= settings.minLakeDepth * 1.45;
  if (!deepBasin && basin.rainfallScore < settings.minRainfallForLake) {
    return "weak-rainfall";
  }
  if (!deepBasin && basin.runoffScore < settings.minCatchmentRunoffForLake) {
    return "weak-runoff";
  }
  if (state.tileOceanMask[basin.outletTargetIndex] > 0) {
    return "ocean-connected";
  }
  return null;
};

const scoreBasin = (basin: DepressionBasin, settings: MapGenSettings): number => {
  const depthScore = clamp(basin.maxDepth / Math.max(0.0001, settings.maxLakeDepth), 0, 1);
  const areaScore = clamp(
    (basin.area - settings.minLakeAreaTiles) /
      Math.max(1, settings.maxLakeAreaTiles - settings.minLakeAreaTiles),
    0,
    1
  );
  const runoffScore = clamp(basin.runoffScore, 0, 1);
  const rainfallScore = clamp(basin.rainfallScore, 0, 1);
  return depthScore * 0.34 + runoffScore * 0.32 + rainfallScore * 0.18 + areaScore * 0.16;
};

const setWaterTile = (state: WorldState, idx: number, elevation: number): void => {
  const tile = state.tiles[idx];
  if (!tile) {
    return;
  }
  tile.type = "water";
  tile.elevation = elevation;
  tile.moisture = 1;
  tile.waterDist = 0;
  tile.fuel = 0;
  tile.fire = 0;
  tile.heat = 0;
  tile.isBase = false;
  clearVegetationState(tile);
  tile.dominantTreeType = null;
  tile.treeType = null;
  state.tileElevation[idx] = elevation;
  state.tileMoisture[idx] = 1;
  state.tileFuel[idx] = 0;
  state.tileFire[idx] = 0;
};

const stampRiverConnectionTile = (
  state: WorldState,
  elevationMap: number[],
  riverMask: Uint8Array,
  oceanMask: Uint8Array,
  lakeMask: Uint16Array,
  markerMask: Uint8Array,
  idx: number,
  surfaceLevel: number,
  stepStrength: number,
  settings: MapGenSettings,
  options: RiverConnectionStampOptions = {}
): void => {
  if (idx < 0 || idx >= state.grid.totalTiles || oceanMask[idx] > 0 || lakeMask[idx] > 0) {
    return;
  }
  const bedDepthScale = options.bedDepthScale ?? 0.55;
  const carveScale = options.carveScale ?? 1;
  const valleyScale = options.valleyScale ?? 1;
  const existingSurface = riverMask[idx] > 0 && Number.isFinite(state.tileRiverSurface[idx])
    ? state.tileRiverSurface[idx] as number
    : Number.NaN;
  const terrainCap = Number.isFinite(existingSurface)
    ? Math.max(existingSurface, surfaceLevel)
    : (elevationMap[idx] ?? surfaceLevel) - 0.001;
  const surface = clamp(Math.min(surfaceLevel, terrainCap), 0, 1);
  const bedDepthFloor = 0.00035 + 0.00365 * clamp(carveScale, 0, 1);
  const bed = clamp(surface - Math.max(bedDepthFloor, settings.minLakeDepth * bedDepthScale * carveScale), 0, 1);
  riverMask[idx] = 1;
  state.tileRiverMask[idx] = 1;
  markerMask[idx] = 1;
  state.tileRiverSurface[idx] = Number.isFinite(state.tileRiverSurface[idx])
    ? Math.min(state.tileRiverSurface[idx] as number, surface)
    : surface;
  state.tileRiverBed[idx] = Number.isFinite(state.tileRiverBed[idx])
    ? Math.min(state.tileRiverBed[idx] as number, bed)
    : bed;
  state.tileRiverStepStrength[idx] = Math.max(state.tileRiverStepStrength[idx] ?? 0, stepStrength);
  const previousElevation = elevationMap[idx] ?? bed;
  elevationMap[idx] = Math.min(previousElevation, bed);
  if (state.valleyMap.length === state.grid.totalTiles) {
    state.valleyMap[idx] = Math.max(state.valleyMap[idx] ?? 0, Math.max(0, previousElevation - bed) * valleyScale * carveScale);
  }
  setWaterTile(state, idx, elevationMap[idx] ?? bed);
};

const stampAcceptedLake = (
  lake: AcceptedBasinLake,
  state: WorldState,
  elevationMap: number[],
  riverMask: Uint8Array,
  oceanMask: Uint8Array,
  lakeMask: Uint16Array,
  lakeSurface: Float32Array,
  lakeOutletMask: Uint8Array,
  riverLakeEntryMask: Uint8Array,
  riverLakeExitMask: Uint8Array,
  settings: MapGenSettings
): void => {
  const { cols, rows } = state.grid;
  const shoreDistances = buildLakeShoreDistances(lake.tiles, cols, rows);
  const coreTiles = new Set<number>(lake.basin.tiles);
  for (const idx of lake.tiles) {
    lakeMask[idx] = lake.id;
    lakeSurface[idx] = lake.surfaceLevel;
    state.tileLakeMask[idx] = lake.id;
    state.tileLakeSurface[idx] = lake.surfaceLevel;
    const shoreDistance = shoreDistances.get(idx) ?? 0;
    const currentElevation = elevationMap[idx] ?? lake.surfaceLevel;
    const isCoreTile = coreTiles.has(idx);
    const depthT = clamp(shoreDistance / 4, 0, 1);
    const coreBedDepth = settings.minLakeDepth * 0.75 + (lake.maxDepth - settings.minLakeDepth * 0.35) * depthT;
    const shallowDepth = Math.max(
      0.0015,
      Math.min(settings.minLakeDepth * 0.45, Math.max(0, lake.surfaceLevel - currentElevation) + settings.minLakeDepth * 0.15)
    );
    const bedDepth = isCoreTile ? coreBedDepth : shallowDepth;
    const bedElevation = clamp(Math.min(currentElevation, lake.surfaceLevel - bedDepth), 0, 1);
    elevationMap[idx] = bedElevation;
    setWaterTile(state, idx, bedElevation);
  }

  for (const idx of lake.inflowRiverTiles) {
    riverLakeEntryMask[idx] = 1;
  }

  if (lake.outletIndex >= 0) {
    lakeOutletMask[lake.outletIndex] = 1;
    riverLakeExitMask[lake.outletIndex] = 1;
    state.tileLakeOutletMask[lake.outletIndex] = 1;
  }

};

type LakeAdjacentRiverCandidate = {
  idx: number;
  lakeId: number;
};

const LAKE_ADJACENT_RIVER_CLEANUP_MAX_PASSES = 64;
const LAKE_ADJACENT_RIVER_SURFACE_MARGIN = 0.002;

const collectAdjacentIndexes = (idx: number, cols: number, rows: number): number[] => {
  const x = idx % cols;
  const y = Math.floor(idx / cols);
  const result: number[] = [];
  for (const dir of NEIGHBORS_4) {
    const nx = x + dir.dx;
    const ny = y + dir.dy;
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
      continue;
    }
    result.push(idxAt(nx, ny, cols));
  }
  return result;
};

const findAdjacentRiverTarget = (
  idx: number,
  cols: number,
  rows: number,
  riverMask: Uint8Array,
  lakeMask: Uint16Array,
  oceanMask: Uint8Array
): number => {
  for (const nIdx of collectAdjacentIndexes(idx, cols, rows)) {
    if (riverMask[nIdx] > 0 && lakeMask[nIdx] === 0 && oceanMask[nIdx] === 0) {
      return nIdx;
    }
  }
  return -1;
};

const absorbLakeAdjacentRiverTiles = (
  lakes: AcceptedBasinLake[],
  state: WorldState,
  elevationMap: number[],
  riverMask: Uint8Array,
  oceanMask: Uint8Array,
  lakeMask: Uint16Array,
  lakeSurface: Float32Array,
  lakeOutletMask: Uint8Array,
  riverLakeEntryMask: Uint8Array,
  riverLakeExitMask: Uint8Array,
  classification: HydrologyFeatureClassification,
  settings: MapGenSettings
): void => {
  const { cols, rows, totalTiles } = state.grid;
  const lakeById = new Map<number, AcceptedBasinLake>(lakes.map((lake) => [lake.id, lake]));
  const absorbedByLake = new Map<number, number[]>();
  const maxAbsorbDepth = Math.max(0.01, settings.minLakeDepth * 0.75);

  for (let pass = 0; pass < LAKE_ADJACENT_RIVER_CLEANUP_MAX_PASSES; pass += 1) {
    const candidates: LakeAdjacentRiverCandidate[] = [];
    for (let idx = 0; idx < totalTiles; idx += 1) {
      if (riverMask[idx] === 0 || lakeMask[idx] > 0 || oceanMask[idx] > 0) {
        continue;
      }
      let adjacentLakeId = 0;
      let adjacentLakeSurface = Number.NaN;
      let adjacentRiver = false;
      for (const nIdx of collectAdjacentIndexes(idx, cols, rows)) {
        const nLakeId = lakeMask[nIdx] ?? 0;
        if (nLakeId > 0 && adjacentLakeId === 0) {
          adjacentLakeId = nLakeId;
          adjacentLakeSurface = lakeSurface[nIdx] ?? Number.NaN;
        }
        if (riverMask[nIdx] > 0 && lakeMask[nIdx] === 0 && oceanMask[nIdx] === 0) {
          adjacentRiver = true;
        }
      }
      if (adjacentLakeId === 0 || !adjacentRiver) {
        continue;
      }
      const riverSurface = state.tileRiverSurface[idx] ?? Number.NaN;
      if (
        Number.isFinite(adjacentLakeSurface) &&
        Number.isFinite(riverSurface) &&
        riverSurface <= adjacentLakeSurface + LAKE_ADJACENT_RIVER_SURFACE_MARGIN &&
        adjacentLakeSurface - riverSurface <= maxAbsorbDepth
      ) {
        candidates.push({ idx, lakeId: adjacentLakeId });
      }
    }
    if (candidates.length === 0) {
      break;
    }

    for (const candidate of candidates) {
      const lake = lakeById.get(candidate.lakeId);
      if (!lake) {
        continue;
      }
      const surface = lake.surfaceLevel;
      const shallowDepth = Math.max(0.001, settings.minLakeDepth * 0.22);
      riverMask[candidate.idx] = 0;
      state.tileRiverMask[candidate.idx] = 0;
      state.tileRiverSurface[candidate.idx] = Number.NaN;
      state.tileRiverBed[candidate.idx] = Number.NaN;
      state.tileRiverStepStrength[candidate.idx] = 0;
      riverLakeEntryMask[candidate.idx] = 0;
      riverLakeExitMask[candidate.idx] = 0;
      lakeMask[candidate.idx] = candidate.lakeId;
      lakeSurface[candidate.idx] = surface;
      state.tileLakeMask[candidate.idx] = candidate.lakeId;
      state.tileLakeSurface[candidate.idx] = surface;
      classification.featureClass[candidate.idx] = HYDROLOGY_FEATURE_CLASS_CODE.lake;
      elevationMap[candidate.idx] = clamp(Math.min(elevationMap[candidate.idx] ?? surface, surface - shallowDepth), 0, 1);
      setWaterTile(state, candidate.idx, elevationMap[candidate.idx] ?? surface - shallowDepth);
      if (!lake.tiles.includes(candidate.idx)) {
        lake.tiles.push(candidate.idx);
      }
      const absorbed = absorbedByLake.get(candidate.lakeId) ?? [];
      absorbed.push(candidate.idx);
      absorbedByLake.set(candidate.lakeId, absorbed);
    }
  }

  for (const [lakeId, absorbed] of absorbedByLake) {
    const lake = lakeById.get(lakeId);
    if (!lake) {
      continue;
    }
    lake.tiles.sort((a, b) => a - b);
    const currentTarget = lake.outletIndex >= 0
      ? findAdjacentRiverTarget(lake.outletIndex, cols, rows, riverMask, lakeMask, oceanMask)
      : -1;
    if (currentTarget >= 0) {
      lake.outletTargetIndex = currentTarget;
      lake.outflowRiverTile = currentTarget;
      lake.overflowTargetIndex = currentTarget;
      continue;
    }
    let bestOutlet = -1;
    let bestTarget = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    const oldOutlet = lake.outletIndex;
    const oldX = oldOutlet >= 0 ? oldOutlet % cols : 0;
    const oldY = oldOutlet >= 0 ? Math.floor(oldOutlet / cols) : 0;
    for (const idx of absorbed) {
      const target = findAdjacentRiverTarget(idx, cols, rows, riverMask, lakeMask, oceanMask);
      if (target < 0) {
        continue;
      }
      const x = idx % cols;
      const y = Math.floor(idx / cols);
      const dist = oldOutlet >= 0 ? Math.hypot(x - oldX, y - oldY) : 0;
      if (bestOutlet < 0 || dist < bestDistance || (dist === bestDistance && idx < bestOutlet)) {
        bestOutlet = idx;
        bestTarget = target;
        bestDistance = dist;
      }
    }
    if (bestOutlet < 0 || bestTarget < 0) {
      continue;
    }
    if (lake.outletIndex >= 0) {
      lakeOutletMask[lake.outletIndex] = 0;
      riverLakeExitMask[lake.outletIndex] = 0;
      state.tileLakeOutletMask[lake.outletIndex] = 0;
    }
    lake.outletIndex = bestOutlet;
    lake.outletTargetIndex = bestTarget;
    lake.outflowRiverTile = bestTarget;
    lake.overflowTargetIndex = bestTarget;
    lakeOutletMask[bestOutlet] = 1;
    riverLakeExitMask[bestOutlet] = 1;
    state.tileLakeOutletMask[bestOutlet] = 1;
    classification.featureClass[bestOutlet] = HYDROLOGY_FEATURE_CLASS_CODE["lake-outlet"];
  }
  classification.featureCounts = {
    none: 0,
    "sheet-flow": 0,
    channel: 0,
    river: 0,
    lake: 0,
    "lake-outlet": 0,
    "waterfall-lip": 0,
    "waterfall-runout": 0,
    "river-mouth": 0,
    "failed-overflow": 0
  };
  for (let idx = 0; idx < classification.featureClass.length; idx += 1) {
    const code = classification.featureClass[idx] ?? 0;
    const key = code === HYDROLOGY_FEATURE_CLASS_CODE["sheet-flow"] ? "sheet-flow"
      : code === HYDROLOGY_FEATURE_CLASS_CODE.channel ? "channel"
        : code === HYDROLOGY_FEATURE_CLASS_CODE.river ? "river"
          : code === HYDROLOGY_FEATURE_CLASS_CODE.lake ? "lake"
            : code === HYDROLOGY_FEATURE_CLASS_CODE["lake-outlet"] ? "lake-outlet"
              : code === HYDROLOGY_FEATURE_CLASS_CODE["waterfall-lip"] ? "waterfall-lip"
                : code === HYDROLOGY_FEATURE_CLASS_CODE["waterfall-runout"] ? "waterfall-runout"
                  : code === HYDROLOGY_FEATURE_CLASS_CODE["river-mouth"] ? "river-mouth"
                    : code === HYDROLOGY_FEATURE_CLASS_CODE["failed-overflow"] ? "failed-overflow"
                      : "none";
    classification.featureCounts[key] += 1;
  }
};

const buildClassifiedLakeOverflowRoutes = async (
  lakes: AcceptedBasinLake[],
  state: WorldState,
  riverMask: Uint8Array,
  oceanMask: Uint8Array,
  lakeMask: Uint16Array,
  elevationMap: ArrayLike<number>,
  flowTarget: Int32Array,
  flow: Float32Array,
  settings: MapGenSettings,
  debug?: StaticHydrologyDebugHooks
): Promise<HydrologyFeatureClassification> => {
  const { cols, rows } = state.grid;
  const minVisibleLength = Math.max(MIN_VISIBLE_LAKE_OUTLET_TILES, Math.min(10, settings.lakeOutletSearchRadius));
  const routes: LakeOverflowRiverPath[] = [];
  const classifiedRiverMask = Uint8Array.from(riverMask);

  for (const lake of lakes) {
    debug?.checkCancelled?.();
    const route = (await buildLakeOverflowRiverPaths({
      cols,
      rows,
      elevationMap,
      riverMask: classifiedRiverMask,
      oceanMask,
      lakeMask,
      flowTarget,
      lakes: [lake],
      maxSteps: Math.max(cols + rows, minVisibleLength),
      minVisibleLength,
      debug
    }))[0];
    if (!route) {
      continue;
    }
    routes.push(route);
    if (route.terminalReached) {
      for (const idx of route.tiles) {
        if (idx >= 0 && idx < classifiedRiverMask.length && oceanMask[idx] === 0 && lakeMask[idx] === 0) {
          classifiedRiverMask[idx] = 1;
        }
      }
    }
    await debug?.yieldIfNeeded?.();
  }

  const classification = classifyHydrologyFeatures({
    cols,
    rows,
    elevationMap,
    oceanMask,
    lakeMask,
    lakes,
    routes,
    flow,
    settings
  });
  await debug?.emit?.({
    kind: "hydrology:classification",
    counts: classification.featureCounts,
    terminalRoutes: classification.terminalRoutes,
    failedRoutes: classification.failedRoutes,
    waterfallCandidates: classification.waterfallCandidates.length
  });
  return classification;
};

const stampClassifiedHydrologyFeatures = (
  classification: HydrologyFeatureClassification,
  lakes: AcceptedBasinLake[],
  state: WorldState,
  elevationMap: number[],
  preCarveElevationMap: ArrayLike<number>,
  riverMask: Uint8Array,
  oceanMask: Uint8Array,
  lakeMask: Uint16Array,
  lakeOutletMask: Uint8Array,
  riverLakeEntryMask: Uint8Array,
  riverLakeExitMask: Uint8Array,
  settings: MapGenSettings,
  debug?: StaticHydrologyDebugHooks
): Promise<void> => {
  const run = async (): Promise<void> => {
  const lakeById = new Map<number, AcceptedBasinLake>(lakes.map((lake) => [lake.id, lake]));

  for (const route of classification.routes) {
    debug?.checkCancelled?.();
    const lake = lakeById.get(route.lakeId);
    if (!lake) {
      continue;
    }
    if (!route.terminalReached) {
      if (lake.outletIndex >= 0) {
        lakeOutletMask[lake.outletIndex] = 0;
        riverLakeExitMask[lake.outletIndex] = 0;
        state.tileLakeOutletMask[lake.outletIndex] = 0;
      }
      lake.outletIndex = -1;
      lake.outletTargetIndex = -1;
      lake.outflowRiverTile = -1;
      lake.overflowTargetIndex = -1;
      continue;
    }
    if (route.tiles.length === 0) {
      continue;
    }
    const pathDenom = Math.max(1, route.tiles.length);
    const routeElevations = route.tiles.map((idx) => preCarveElevationMap[idx] ?? lake.surfaceLevel);
    let previousSurface = lake.surfaceLevel;
    const carveScale = outletCarveScale(settings);
    route.tiles.forEach((idx, pathIndex) => {
      const progress = (pathIndex + 1) / pathDenom;
      const targetElevation = routeElevations[pathIndex] ?? lake.surfaceLevel;
      const upstreamElevation = pathIndex === 0
        ? lake.surfaceLevel
        : routeElevations[pathIndex - 1] ?? lake.surfaceLevel;
      const localDrop = Math.max(0, upstreamElevation - targetElevation);
      const featureCode = classification.featureClass[idx] ?? HYDROLOGY_FEATURE_CLASS_CODE.none;
      const isWaterfallRunout = featureCode === HYDROLOGY_FEATURE_CLASS_CODE["waterfall-runout"];
      const isWaterfallLip = featureCode === HYDROLOGY_FEATURE_CLASS_CODE["waterfall-lip"];
      const isRiverMouth = featureCode === HYDROLOGY_FEATURE_CLASS_CODE["river-mouth"];
      const isChannel = featureCode === HYDROLOGY_FEATURE_CLASS_CODE.channel;
      const minimumSegmentDrop = isWaterfallRunout
        ? Math.max(settings.minOutletDrop * 0.18 * carveScale, localDrop * 0.14 * carveScale)
        : Math.max(settings.minOutletDrop * 0.28 * carveScale, localDrop * 0.38 * carveScale);
      const progressSurface = lake.surfaceLevel - settings.minOutletDrop * carveScale * (0.5 + progress * (isWaterfallRunout ? 1.1 : 2));
      const localSurface = previousSurface - minimumSegmentDrop;
      const bankSurface = targetElevation - 0.001;
      const surface = Math.min(progressSurface, localSurface, bankSurface);
      const strongDrop = localDrop >= settings.waterfallMinDrop * 0.65;
      const bedDepthScale = isWaterfallRunout
        ? 0.24
        : isWaterfallLip
          ? 0.18
          : isRiverMouth
            ? 0.34
            : isChannel
              ? 0.42
              : 0.5;
      stampRiverConnectionTile(
        state,
        elevationMap,
        riverMask,
        oceanMask,
        lakeMask,
        riverLakeExitMask,
        idx,
        surface,
        Math.max(pathIndex === 0 ? 0.36 : 0.2, strongDrop || isWaterfallRunout ? 0.72 : 0),
        settings,
        {
          bedDepthScale,
          carveScale,
          valleyScale: isWaterfallRunout ? 0.35 : 0.8
        }
      );
      previousSurface = Number.isFinite(state.tileRiverSurface[idx])
        ? state.tileRiverSurface[idx] as number
        : surface;
    });

    const finalTile = route.tiles[route.tiles.length - 1];
    if (route.reachedLakeId > 0 && finalTile !== undefined) {
      riverLakeEntryMask[finalTile] = 1;
      const targetLake = lakeById.get(route.reachedLakeId);
      if (targetLake && !targetLake.inflowRiverTiles.includes(finalTile)) {
        targetLake.inflowRiverTiles.push(finalTile);
        targetLake.inflowRiverTiles.sort((a, b) => a - b);
      }
    }
    await debug?.yieldIfNeeded?.();
  }
  };
  return run();
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
  accepted: StaticHydrologyWaterfall[],
  minDrop = settings.waterfallMinDrop
): StaticHydrologyWaterfallRejectReason | null => {
  if (waterfall.drop < minDrop) {
    return "drop-small";
  }
  if (waterfall.flowScore < settings.waterfallMinFlow) {
    return "flow-small";
  }
  if (!farEnoughFromWaterfalls(waterfall.sourceIndex, cols, accepted, settings.waterfallMinSpacingTiles)) {
    return "spacing";
  }
  if (accepted.length >= settings.waterfallMaxPerRiver) {
    return "max-count";
  }
  accepted.push(waterfall);
  return null;
};

const buildWaterfalls = (
  classification: HydrologyFeatureClassification,
  cols: number,
  oceanMask: Uint8Array,
  oceanDistance: Uint16Array,
  settings: MapGenSettings,
  debug?: StaticHydrologyDebugHooks
): Promise<{ waterfalls: StaticHydrologyWaterfall[]; rejected: number }> => {
  const run = async (): Promise<{ waterfalls: StaticHydrologyWaterfall[]; rejected: number }> => {
  const waterfalls: StaticHydrologyWaterfall[] = [];
  let rejected = 0;

  for (const waterfall of classification.waterfallCandidates) {
    debug?.checkCancelled?.();
    const avoidCoast = waterfall.targetIndex < 0 ||
      waterfall.targetIndex >= oceanMask.length ||
      oceanMask[waterfall.targetIndex] > 0 ||
      (oceanDistance[waterfall.targetIndex] ?? 0) < settings.waterfallAvoidCoastTiles;
    if (avoidCoast) {
      rejected += 1;
      await debug?.emit?.({ kind: "hydrology:waterfall", accepted: false, waterfall, reason: "coast-proximity" });
      continue;
    }
    if (!settings.waterfallAllowLakeOutlet && waterfall.lakeId > 0) {
      rejected += 1;
      await debug?.emit?.({ kind: "hydrology:waterfall", accepted: false, waterfall, reason: "drop-small" });
      continue;
    }
    const reason = addWaterfall(
      waterfall,
      cols,
      settings,
      waterfalls,
      waterfall.lakeId > 0
        ? Math.max(
            LAKE_OUTLET_WATERFALL_MIN_DROP_FLOOR,
            settings.waterfallMinDrop * LAKE_OUTLET_WATERFALL_MIN_DROP_SCALE
          )
        : settings.waterfallMinDrop
    );
    await debug?.emit?.({ kind: "hydrology:waterfall", accepted: !reason, waterfall, reason: reason ?? undefined });
    if (reason) {
      rejected += 1;
    }
    await debug?.yieldIfNeeded?.();
  }

  return { waterfalls, rejected };
  };
  return run();
};

export const buildBasinLakeHydrology = async (input: {
  state: WorldState;
  elevationMap: number[];
  riverMask: Uint8Array;
  oceanMask: Uint8Array;
  settings: MapGenSettings;
  debug?: StaticHydrologyDebugHooks;
}): Promise<StaticHydrologyResult> => {
  const { state, elevationMap, riverMask, oceanMask, settings, debug } = input;
  const { cols, rows, totalTiles } = state.grid;
  const baseFields = buildStaticHydrologyFields(state, elevationMap, oceanMask, settings);
  const solve = solveDepressionBasins({
    cols,
    rows,
    elevationMap,
    oceanMask,
    rainfall: baseFields.rainfall,
    minDepth: settings.minLakeDepth
  });
  const lakeMask = new Uint16Array(totalTiles);
  const lakeSurface = new Float32Array(totalTiles).fill(Number.NaN);
  const lakeOutletMask = new Uint8Array(totalTiles);
  const riverLakeEntryMask = new Uint8Array(totalTiles);
  const riverLakeExitMask = new Uint8Array(totalTiles);
  const waterfallSourceMask = new Uint8Array(totalTiles);
  const waterfallTarget = new Int32Array(totalTiles).fill(-1);
  const waterfallDrop = new Float32Array(totalTiles);
  const rejectedLakeCandidates: StaticHydrologyRejectSummary = {};
  const oceanDistance = buildOceanDistanceField(cols, rows, oceanMask, Math.max(cols, rows));
  const lakes: AcceptedBasinLake[] = [];
  let landTileCount = 0;
  for (let idx = 0; idx < totalTiles; idx += 1) {
    if (oceanMask[idx] === 0) {
      landTileCount += 1;
    }
  }

  resetStaticHydrologyState(state);

  if (settings.lakeChance > 0 && settings.maxLakeCount > 0) {
    debug?.checkCancelled?.();
    const scored = solve.basins
      .map((basin) => ({ basin, score: scoreBasin(basin, settings) }))
      .sort((a, b) => b.score - a.score || b.basin.catchmentRunoff - a.basin.catchmentRunoff || a.basin.floorIndex - b.basin.floorIndex);
    const scoreThreshold = 0.16 + (1 - clamp(settings.lakeChance, 0, 1)) * 0.34;
    for (const candidate of scored) {
      debug?.checkCancelled?.();
      if (lakes.length >= settings.maxLakeCount) {
        break;
      }
      const basin = candidate.basin;
      const contourTiles = buildLakeSpillContour({
        cols,
        rows,
        basin,
        elevationMap,
        filledElevation: solve.filledElevation,
        oceanMask,
        exclude: basin.outletTargetIndex >= 0 ? [basin.outletTargetIndex] : undefined,
        spillTolerance: Math.max(0.0025, settings.minLakeDepth * 0.3),
        surfaceMargin: 0.0001
      });
      await debug?.emit?.({
        kind: "hydrology:candidate",
        basinSeedIndex: basin.floorIndex,
        area: basin.area,
        footprintTiles: contourTiles.length,
        maxDepth: basin.maxDepth,
        spillElevation: basin.spillElevation,
        rainfallScore: basin.rainfallScore,
        runoffScore: basin.runoffScore,
        score: candidate.score,
        outletIndex: basin.outletIndex,
        outletTargetIndex: basin.outletTargetIndex
      });
      const reason = candidateRejectReason(basin, contourTiles, state, lakeMask, oceanDistance, landTileCount, settings);
      if (reason) {
        incrementReject(rejectedLakeCandidates, reason);
        await debug?.emit?.({
          kind: "hydrology:reject",
          basinSeedIndex: basin.floorIndex,
          reason,
          score: candidate.score,
          footprintTiles: contourTiles.length
        });
        continue;
      }
      if (candidate.score < scoreThreshold) {
        incrementReject(rejectedLakeCandidates, "weak-basin");
        await debug?.emit?.({
          kind: "hydrology:reject",
          basinSeedIndex: basin.floorIndex,
          reason: "weak-basin",
          score: candidate.score,
          footprintTiles: contourTiles.length
        });
        continue;
      }
      const lakeId = lakes.length + 1;
      const inflowRiverTiles = collectInflowRiverTiles(contourTiles, cols, rows, riverMask);
      const lake: AcceptedBasinLake = {
        id: lakeId,
        tiles: contourTiles,
        surfaceLevel: basin.spillElevation,
        outletIndex: basin.outletIndex,
        outletTargetIndex: basin.outletTargetIndex,
        inflowRiverTiles,
        outflowRiverTile: basin.outletTargetIndex,
        basinSeedIndex: basin.floorIndex,
        rainfallScore: basin.rainfallScore,
        runoffScore: basin.runoffScore,
        maxDepth: basin.maxDepth,
        spillElevation: basin.spillElevation,
        basinAreaTiles: contourTiles.length,
        catchmentRunoff: basin.catchmentRunoff,
        overflowTargetIndex: basin.outletTargetIndex,
        basin
      };
      stampAcceptedLake(
        lake,
        state,
        elevationMap,
        riverMask,
        oceanMask,
        lakeMask,
        lakeSurface,
        lakeOutletMask,
        riverLakeEntryMask,
        riverLakeExitMask,
        settings
      );
      lakes.push(lake);
      await debug?.emit?.({
        kind: "hydrology:lake",
        lake: {
          ...lake,
          tiles: [...lake.tiles],
          inflowRiverTiles: [...lake.inflowRiverTiles]
        }
      });
      await debug?.yieldIfNeeded?.();
    }
  }

  const preOverflowElevationMap = elevationMap.slice();
  const hydrologyClassification = await buildClassifiedLakeOverflowRoutes(
    lakes,
    state,
    riverMask,
    oceanMask,
    lakeMask,
    preOverflowElevationMap,
    solve.flowTarget,
    solve.flow,
    settings,
    debug
  );

  await stampClassifiedHydrologyFeatures(
    hydrologyClassification,
    lakes,
    state,
    elevationMap,
    preOverflowElevationMap,
    riverMask,
    oceanMask,
    lakeMask,
    lakeOutletMask,
    riverLakeEntryMask,
    riverLakeExitMask,
    settings,
    debug
  );
  absorbLakeAdjacentRiverTiles(
    lakes,
    state,
    elevationMap,
    riverMask,
    oceanMask,
    lakeMask,
    lakeSurface,
    lakeOutletMask,
    riverLakeEntryMask,
    riverLakeExitMask,
    hydrologyClassification,
    settings
  );

  const waterfallBuild = await buildWaterfalls(
    hydrologyClassification,
    cols,
    oceanMask,
    oceanDistance,
    settings,
    debug
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
    rainfall: baseFields.rainfall,
    runoff: solve.runoffAccumulation,
    flow: solve.flow,
    lakeMask,
    lakeSurface,
    lakeOutletMask,
    riverLakeEntryMask,
    riverLakeExitMask,
    waterfallSourceMask,
    waterfallTarget,
    waterfallDrop,
    hydrologyFeatureClass: hydrologyClassification.featureClass,
    hydrologyFeatureCounts: hydrologyClassification.featureCounts,
    lakes: lakes.map(({ basin, ...lake }) => lake),
    waterfalls: waterfallBuild.waterfalls,
    rejectedLakeCandidates,
    rejectedWaterfallCandidates: waterfallBuild.rejected
  };
};
