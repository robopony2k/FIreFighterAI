import type { HouseFootprintBounds } from "../../../core/houseFootprints.js";
import { inBounds, indexFor } from "../../../core/grid.js";
import type { WorldState } from "../../../core/state.js";
import type { Point } from "../../../core/types.js";
import { clamp } from "../../../core/utils.js";
import { computeRenderedSlopeAngleDeg } from "../../../shared/terrainSlope.js";

export const SETTLEMENT_PREFERRED_ANGLE_DEG = 12;
export const SETTLEMENT_PLOT_MAX_ANGLE_DEG = 18;
export const SETTLEMENT_TOWN_FALLBACK_ANGLE_DEG = 24;

export type SettlementTerrainFitOptions = {
  heightScaleMultiplier?: number;
};

export type SettlementTerrainFit = {
  maxAngleDeg: number;
  meanAngleDeg: number;
  relief: number;
  score: number;
  viable: boolean;
};

export type SettlementFlattenResult = {
  before: SettlementTerrainFit;
  after: SettlementTerrainFit;
  targetElevation: number;
  elevationEdits: SettlementTerrainElevationEdit[];
};

export type SettlementTerrainElevationEdit = {
  index: number;
  elevation: number;
};

const DEFAULT_HEIGHT_SCALE_MULTIPLIER = 1;
const PLOT_RELIEF_LIMIT = 0.09;
const PLOT_ACCESS_BLEND_RADIUS = 1;
const PLOT_ROAD_STEP_UP_LIMIT = 0.028;
const PLOT_ROAD_STEP_DOWN_LIMIT = 0.018;

const getHeightScaleMultiplier = (options?: SettlementTerrainFitOptions): number =>
  Math.max(0.1, options?.heightScaleMultiplier ?? DEFAULT_HEIGHT_SCALE_MULTIPLIER);

const setTileElevation = (state: WorldState, idx: number, elevation: number): void => {
  const value = clamp(elevation, 0, 1);
  state.tiles[idx].elevation = value;
  if (state.tileElevation.length === state.grid.totalTiles) {
    state.tileElevation[idx] = value;
  }
  state.tileSoaDirty = true;
  state.terrainDirty = true;
};

export const computeSettlementTileAngleDeg = (
  state: WorldState,
  x: number,
  y: number,
  options?: SettlementTerrainFitOptions
): number => {
  if (!inBounds(state.grid, x, y)) {
    return Number.POSITIVE_INFINITY;
  }
  const idx = indexFor(state.grid, x, y);
  const center = state.tiles[idx]?.elevation ?? 0;
  let maxDiff = 0;
  if (x > 0) {
    maxDiff = Math.max(maxDiff, Math.abs(center - (state.tiles[idx - 1]?.elevation ?? center)));
  }
  if (x < state.grid.cols - 1) {
    maxDiff = Math.max(maxDiff, Math.abs(center - (state.tiles[idx + 1]?.elevation ?? center)));
  }
  if (y > 0) {
    maxDiff = Math.max(maxDiff, Math.abs(center - (state.tiles[idx - state.grid.cols]?.elevation ?? center)));
  }
  if (y < state.grid.rows - 1) {
    maxDiff = Math.max(maxDiff, Math.abs(center - (state.tiles[idx + state.grid.cols]?.elevation ?? center)));
  }
  return computeRenderedSlopeAngleDeg(maxDiff, state.grid.cols, state.grid.rows, getHeightScaleMultiplier(options));
};

export const scoreSettlementAngle = (angleDeg: number): number => {
  if (!Number.isFinite(angleDeg)) {
    return 0;
  }
  if (angleDeg <= SETTLEMENT_PREFERRED_ANGLE_DEG) {
    return 1;
  }
  if (angleDeg <= SETTLEMENT_PLOT_MAX_ANGLE_DEG) {
    const t = (angleDeg - SETTLEMENT_PREFERRED_ANGLE_DEG) / (SETTLEMENT_PLOT_MAX_ANGLE_DEG - SETTLEMENT_PREFERRED_ANGLE_DEG);
    return 1 - t * 0.58;
  }
  if (angleDeg <= SETTLEMENT_TOWN_FALLBACK_ANGLE_DEG) {
    const t = (angleDeg - SETTLEMENT_PLOT_MAX_ANGLE_DEG) / (SETTLEMENT_TOWN_FALLBACK_ANGLE_DEG - SETTLEMENT_PLOT_MAX_ANGLE_DEG);
    return 0.42 - t * 0.36;
  }
  return 0;
};

export const evaluateSettlementAreaFit = (
  state: WorldState,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  options?: SettlementTerrainFitOptions
): SettlementTerrainFit => {
  let minElevation = Number.POSITIVE_INFINITY;
  let maxElevation = Number.NEGATIVE_INFINITY;
  let maxAngleDeg = 0;
  let angleSum = 0;
  let count = 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (!inBounds(state.grid, x, y)) {
        return {
          maxAngleDeg: Number.POSITIVE_INFINITY,
          meanAngleDeg: Number.POSITIVE_INFINITY,
          relief: Number.POSITIVE_INFINITY,
          score: 0,
          viable: false
        };
      }
      const idx = indexFor(state.grid, x, y);
      const tile = state.tiles[idx];
      if (!tile || tile.type === "water") {
        return {
          maxAngleDeg: Number.POSITIVE_INFINITY,
          meanAngleDeg: Number.POSITIVE_INFINITY,
          relief: Number.POSITIVE_INFINITY,
          score: 0,
          viable: false
        };
      }
      minElevation = Math.min(minElevation, tile.elevation);
      maxElevation = Math.max(maxElevation, tile.elevation);
      const angleDeg = computeSettlementTileAngleDeg(state, x, y, options);
      maxAngleDeg = Math.max(maxAngleDeg, angleDeg);
      angleSum += angleDeg;
      count += 1;
    }
  }
  const meanAngleDeg = count > 0 ? angleSum / count : Number.POSITIVE_INFINITY;
  const relief = Number.isFinite(minElevation) && Number.isFinite(maxElevation) ? maxElevation - minElevation : Number.POSITIVE_INFINITY;
  const angleScore = scoreSettlementAngle(Math.max(maxAngleDeg, meanAngleDeg));
  const reliefScore = 1 - clamp(relief / PLOT_RELIEF_LIMIT, 0, 1);
  const viable = maxAngleDeg <= SETTLEMENT_TOWN_FALLBACK_ANGLE_DEG && meanAngleDeg <= SETTLEMENT_PLOT_MAX_ANGLE_DEG && relief <= PLOT_RELIEF_LIMIT;
  return {
    maxAngleDeg,
    meanAngleDeg,
    relief,
    score: clamp(angleScore * 0.72 + reliefScore * 0.28, 0, 1),
    viable
  };
};

export const evaluateSettlementFootprintFit = (
  state: WorldState,
  bounds: HouseFootprintBounds,
  options?: SettlementTerrainFitOptions
): SettlementTerrainFit =>
  evaluateSettlementAreaFit(state, bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, options);

export const evaluateSettlementSiteFit = (
  state: WorldState,
  center: Point,
  radius: number,
  options?: SettlementTerrainFitOptions
): SettlementTerrainFit => {
  const minX = Math.max(0, center.x - radius);
  const maxX = Math.min(state.grid.cols - 1, center.x + radius);
  const minY = Math.max(0, center.y - radius);
  const maxY = Math.min(state.grid.rows - 1, center.y + radius);
  return evaluateSettlementAreaFit(state, minX, maxX, minY, maxY, options);
};

const collectPadSamples = (state: WorldState, bounds: HouseFootprintBounds): number[] => {
  const samples: number[] = [];
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      if (!inBounds(state.grid, x, y)) {
        continue;
      }
      const tile = state.tiles[indexFor(state.grid, x, y)];
      if (tile && tile.type !== "water") {
        samples.push(tile.elevation);
      }
    }
  }
  samples.sort((a, b) => a - b);
  return samples;
};

const sampleRoadElevation = (state: WorldState, roadPoint: Point | null | undefined): number | null => {
  if (!roadPoint || !inBounds(state.grid, roadPoint.x, roadPoint.y)) {
    return null;
  }
  const tile = state.tiles[indexFor(state.grid, roadPoint.x, roadPoint.y)];
  return tile && tile.type !== "water" ? tile.elevation : null;
};

const resolvePlotPadTarget = (state: WorldState, bounds: HouseFootprintBounds, roadPoint?: Point | null): number => {
  const samples = collectPadSamples(state, bounds);
  if (samples.length === 0) {
    return 0;
  }
  const middle = Math.floor(samples.length / 2);
  const median =
    samples.length % 2 === 0
      ? ((samples[middle - 1] ?? samples[0]!) + (samples[middle] ?? samples[samples.length - 1]!)) * 0.5
      : samples[middle]!;
  const roadElevation = sampleRoadElevation(state, roadPoint);
  if (roadElevation === null) {
    return clamp(median, 0, 1);
  }
  const lowAccessible = roadElevation - PLOT_ROAD_STEP_DOWN_LIMIT;
  const highAccessible = roadElevation + PLOT_ROAD_STEP_UP_LIMIT;
  return clamp(Math.min(median, highAccessible), lowAccessible, highAccessible);
};

export const flattenSettlementFootprintForPlot = (
  state: WorldState,
  bounds: HouseFootprintBounds,
  options: SettlementTerrainFitOptions & { roadPoint?: Point | null } = {}
): SettlementFlattenResult => {
  const before = evaluateSettlementFootprintFit(state, bounds, options);
  const targetElevation = resolvePlotPadTarget(state, bounds, options.roadPoint);
  const elevationEdits: SettlementTerrainElevationEdit[] = [];
  const applyElevation = (idx: number, elevation: number): void => {
    const nextElevation = clamp(elevation, 0, 1);
    const tile = state.tiles[idx];
    if (!tile || Math.abs(tile.elevation - nextElevation) <= 1e-6) {
      return;
    }
    setTileElevation(state, idx, nextElevation);
    elevationEdits.push({ index: idx, elevation: nextElevation });
  };
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      if (!inBounds(state.grid, x, y)) {
        continue;
      }
      const idx = indexFor(state.grid, x, y);
      if (state.tiles[idx].type !== "water") {
        applyElevation(idx, targetElevation);
      }
    }
  }

  for (let y = bounds.minY - PLOT_ACCESS_BLEND_RADIUS; y <= bounds.maxY + PLOT_ACCESS_BLEND_RADIUS; y += 1) {
    for (let x = bounds.minX - PLOT_ACCESS_BLEND_RADIUS; x <= bounds.maxX + PLOT_ACCESS_BLEND_RADIUS; x += 1) {
      if (!inBounds(state.grid, x, y) || (x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY)) {
        continue;
      }
      const idx = indexFor(state.grid, x, y);
      const tile = state.tiles[idx];
      if (!tile || tile.type === "water" || tile.type === "house" || tile.type === "base") {
        continue;
      }
      const blend = tile.type === "road" ? 0.35 : 0.22;
      applyElevation(idx, tile.elevation * (1 - blend) + targetElevation * blend);
    }
  }

  return {
    before,
    after: evaluateSettlementFootprintFit(state, bounds, options),
    targetElevation,
    elevationEdits
  };
};
