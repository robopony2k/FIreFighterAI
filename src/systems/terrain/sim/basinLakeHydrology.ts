import type { WorldState } from "../../../core/state.js";
import { clearVegetationState } from "../../../core/vegetation.js";
import { clamp } from "../../../core/utils.js";
import type { MapGenSettings } from "../../../mapgen/settings.js";
import { buildOceanDistanceField, buildStaticHydrologyFields } from "./staticHydrologyFields.js";
import { buildLakeOverflowRiverPaths } from "./lakeOverflowRiverRouting.js";
import { buildLakeSpillContour } from "./lakeSpillContour.js";
import { solveDepressionBasins, type DepressionBasin } from "./depressionBasinSolver.js";
import type {
  StaticHydrologyLake,
  StaticHydrologyDebugHooks,
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

const MIN_VISIBLE_LAKE_OUTLET_TILES = 4;
const MAX_LAKE_LAND_COVERAGE = 0.12;

type AcceptedBasinLake = StaticHydrologyLake & {
  basin: DepressionBasin;
};

const idxAt = (x: number, y: number, cols: number): number => y * cols + x;

const incrementReject = (summary: StaticHydrologyRejectSummary, reason: StaticHydrologyRejectReason): void => {
  summary[reason] = (summary[reason] ?? 0) + 1;
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
  settings: MapGenSettings
): void => {
  if (idx < 0 || idx >= state.grid.totalTiles || oceanMask[idx] > 0 || lakeMask[idx] > 0) {
    return;
  }
  const existingSurface = riverMask[idx] > 0 && Number.isFinite(state.tileRiverSurface[idx])
    ? state.tileRiverSurface[idx] as number
    : Number.NaN;
  const terrainCap = Number.isFinite(existingSurface)
    ? Math.max(existingSurface, surfaceLevel)
    : (elevationMap[idx] ?? surfaceLevel) - 0.001;
  const surface = clamp(Math.min(surfaceLevel, terrainCap), 0, 1);
  const bed = clamp(surface - Math.max(0.006, settings.minLakeDepth * 0.55), 0, 1);
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
    state.valleyMap[idx] = Math.max(state.valleyMap[idx] ?? 0, Math.max(0, previousElevation - bed));
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

const stampLakeOverflowRivers = (
  lakes: AcceptedBasinLake[],
  state: WorldState,
  elevationMap: number[],
  riverMask: Uint8Array,
  oceanMask: Uint8Array,
  lakeMask: Uint16Array,
  riverLakeEntryMask: Uint8Array,
  riverLakeExitMask: Uint8Array,
  flowTarget: Int32Array,
  settings: MapGenSettings,
  debug?: StaticHydrologyDebugHooks
): Promise<void> => {
  const run = async (): Promise<void> => {
  const { cols, rows } = state.grid;
  const lakeById = new Map<number, AcceptedBasinLake>(lakes.map((lake) => [lake.id, lake]));
  const minVisibleLength = Math.max(MIN_VISIBLE_LAKE_OUTLET_TILES, Math.min(10, settings.lakeOutletSearchRadius));

  for (const lake of lakes) {
    debug?.checkCancelled?.();
    const route = (await buildLakeOverflowRiverPaths({
      cols,
      rows,
      elevationMap,
      riverMask,
      oceanMask,
      lakeMask,
      flowTarget,
      lakes: [lake],
      maxSteps: Math.max(cols + rows, minVisibleLength),
      minVisibleLength,
      debug
    }))[0];
    if (!route || route.tiles.length === 0) {
      continue;
    }
    const pathDenom = Math.max(1, route.tiles.length);
    const routeElevations = route.tiles.map((idx) => elevationMap[idx] ?? lake.surfaceLevel);
    let previousSurface = lake.surfaceLevel;
    route.tiles.forEach((idx, pathIndex) => {
      const progress = (pathIndex + 1) / pathDenom;
      const targetElevation = routeElevations[pathIndex] ?? lake.surfaceLevel;
      const upstreamElevation = pathIndex === 0
        ? lake.surfaceLevel
        : routeElevations[pathIndex - 1] ?? lake.surfaceLevel;
      const localDrop = Math.max(0, upstreamElevation - targetElevation);
      const minimumSegmentDrop = Math.max(settings.minOutletDrop * 0.35, localDrop * 0.55);
      const progressSurface = lake.surfaceLevel - settings.minOutletDrop * (0.75 + progress * 2.5);
      const localSurface = previousSurface - minimumSegmentDrop;
      const bankSurface = targetElevation - 0.001;
      const surface = Math.min(progressSurface, localSurface, bankSurface);
      const strongDrop = localDrop >= settings.waterfallMinDrop * 0.65;
      stampRiverConnectionTile(
        state,
        elevationMap,
        riverMask,
        oceanMask,
        lakeMask,
        riverLakeExitMask,
        idx,
        surface,
        Math.max(pathIndex === 0 ? 0.36 : 0.2, strongDrop ? 0.72 : 0),
        settings
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
  flow: Float32Array,
  settings: MapGenSettings,
  debug?: StaticHydrologyDebugHooks
): Promise<{ waterfalls: StaticHydrologyWaterfall[]; rejected: number }> => {
  const run = async (): Promise<{ waterfalls: StaticHydrologyWaterfall[]; rejected: number }> => {
  const { cols, rows } = state.grid;
  const waterfalls: StaticHydrologyWaterfall[] = [];
  let rejected = 0;

  if (settings.waterfallAllowLakeOutlet) {
    for (const lake of lakes) {
      if (lake.outletIndex < 0 || lake.outletTargetIndex < 0) {
        continue;
      }
      debug?.checkCancelled?.();
      const waterfall: StaticHydrologyWaterfall = {
        sourceIndex: lake.outletIndex,
        targetIndex: lake.outletTargetIndex,
        drop: lake.surfaceLevel - (state.tiles[lake.outletTargetIndex]?.elevation ?? lake.surfaceLevel),
        flowScore: Math.max(lake.runoffScore, flow[lake.outletTargetIndex] ?? 0),
        lakeId: lake.id
      };
      if (oceanMask[lake.outletTargetIndex] > 0 || (oceanDistance[lake.outletTargetIndex] ?? 0) < settings.waterfallAvoidCoastTiles) {
        rejected += 1;
        await debug?.emit?.({ kind: "hydrology:waterfall", accepted: false, waterfall });
        continue;
      }
      const accepted = addWaterfall(waterfall, cols, settings, waterfalls);
      await debug?.emit?.({ kind: "hydrology:waterfall", accepted, waterfall });
      if (!accepted) {
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
    const sourceSurface = state.tileRiverSurface[idx];
    if (!Number.isFinite(sourceSurface) || (state.tileRiverStepStrength[idx] ?? 0) < 0.18) {
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
      const nIdx = idxAt(nx, ny, cols);
      if (riverMask[nIdx] === 0 || lakeMask[nIdx] > 0 || oceanMask[nIdx] > 0) {
        continue;
      }
      const targetSurface = state.tileRiverSurface[nIdx];
      if (!Number.isFinite(targetSurface)) {
        continue;
      }
      const drop = (sourceSurface as number) - (targetSurface as number);
      if (drop > bestDrop) {
        bestDrop = drop;
        bestTarget = nIdx;
      }
    }
    if (bestTarget < 0) {
      continue;
    }
    const waterfall: StaticHydrologyWaterfall = {
      sourceIndex: idx,
      targetIndex: bestTarget,
      drop: bestDrop,
      flowScore: flow[idx] ?? 0,
      lakeId: 0
    };
    const accepted = addWaterfall(waterfall, cols, settings, waterfalls);
    await debug?.emit?.({ kind: "hydrology:waterfall", accepted, waterfall });
    if (!accepted) {
      rejected += 1;
    }
    if (idx % Math.max(1, state.grid.cols * 8) === 0) {
      await debug?.yieldIfNeeded?.();
      debug?.checkCancelled?.();
    }
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

  await stampLakeOverflowRivers(
    lakes,
    state,
    elevationMap,
    riverMask,
    oceanMask,
    lakeMask,
    riverLakeEntryMask,
    riverLakeExitMask,
    solve.flowTarget,
    settings,
    debug
  );

  const waterfallBuild = await buildWaterfalls(
    state,
    riverMask,
    oceanMask,
    oceanDistance,
    lakeMask,
    lakes,
    solve.flow,
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
    lakes: lakes.map(({ basin, ...lake }) => lake),
    waterfalls: waterfallBuild.waterfalls,
    rejectedLakeCandidates,
    rejectedWaterfallCandidates: waterfallBuild.rejected
  };
};
