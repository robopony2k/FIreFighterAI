import type { WorldState } from "../../../core/state.js";
import { inBounds, indexFor } from "../../../core/grid.js";
import { clamp } from "../../../core/utils.js";
import { computeRenderedSegmentSlopeAngleDeg } from "../../../shared/terrainSlope.js";
import {
  FOOT_MOVE_DOWNHILL_FACTOR,
  FOOT_MOVE_SLOPE_MAX,
  FOOT_MOVE_SLOPE_MIN,
  FOOT_MOVE_UPHILL_FACTOR,
  UNIT_TERRAIN_MOVE_COST,
  VEHICLE_AVOID_SLOPE_ANGLE_DEG,
  VEHICLE_AVOID_SLOPE_MULTIPLIER,
  VEHICLE_IMPASSABLE_SLOPE_ANGLE_DEG,
  VEHICLE_MAX_SLOPE_MULTIPLIER,
  VEHICLE_OFF_ROAD_COST_MULTIPLIER,
  VEHICLE_PREFERRED_SLOPE_ANGLE_DEG,
  VEHICLE_SOFT_SLOPE_ANGLE_DEG,
  VEHICLE_SOFT_SLOPE_MULTIPLIER
} from "../constants/unitMovementTuning.js";
import type { UnitMovementProfile } from "../types/unitPathTypes.js";

const ROAD_EDGE_N = 1 << 0;
const ROAD_EDGE_E = 1 << 1;
const ROAD_EDGE_S = 1 << 2;
const ROAD_EDGE_W = 1 << 3;
const ROAD_EDGE_NE = 1 << 4;
const ROAD_EDGE_NW = 1 << 5;
const ROAD_EDGE_SE = 1 << 6;
const ROAD_EDGE_SW = 1 << 7;

const getRoadEdgeBit = (dx: number, dy: number): number => {
  if (dx === 0 && dy < 0) return ROAD_EDGE_N;
  if (dx > 0 && dy === 0) return ROAD_EDGE_E;
  if (dx === 0 && dy > 0) return ROAD_EDGE_S;
  if (dx < 0 && dy === 0) return ROAD_EDGE_W;
  if (dx > 0 && dy < 0) return ROAD_EDGE_NE;
  if (dx < 0 && dy < 0) return ROAD_EDGE_NW;
  if (dx > 0 && dy > 0) return ROAD_EDGE_SE;
  if (dx < 0 && dy > 0) return ROAD_EDGE_SW;
  return 0;
};

const getOppositeRoadEdgeBit = (bit: number): number => {
  switch (bit) {
    case ROAD_EDGE_N: return ROAD_EDGE_S;
    case ROAD_EDGE_E: return ROAD_EDGE_W;
    case ROAD_EDGE_S: return ROAD_EDGE_N;
    case ROAD_EDGE_W: return ROAD_EDGE_E;
    case ROAD_EDGE_NE: return ROAD_EDGE_SW;
    case ROAD_EDGE_NW: return ROAD_EDGE_SE;
    case ROAD_EDGE_SE: return ROAD_EDGE_NW;
    case ROAD_EDGE_SW: return ROAD_EDGE_NE;
    default: return 0;
  }
};

const isBridgeTile = (state: WorldState, idx: number): boolean =>
  state.tiles[idx].type === "water" && state.tileRoadBridge[idx] > 0;

export const isVehicleRoadTile = (state: WorldState, x: number, y: number): boolean => {
  if (!inBounds(state.grid, x, y)) {
    return false;
  }
  const idx = indexFor(state.grid, x, y);
  return state.tiles[idx].type === "road" || isBridgeTile(state, idx);
};

const isRoadLikeTile = (state: WorldState, idx: number): boolean => {
  const type = state.tiles[idx].type;
  return type === "road" || type === "base" || isBridgeTile(state, idx);
};

const hasRoadConnection = (
  state: WorldState,
  fromIdx: number,
  toIdx: number,
  dx: number,
  dy: number,
  allowLegacyCardinalFallback: boolean
): boolean => {
  if (!isRoadLikeTile(state, fromIdx) || !isRoadLikeTile(state, toIdx)) {
    return false;
  }
  const bit = getRoadEdgeBit(dx, dy);
  const opposite = getOppositeRoadEdgeBit(bit);
  if (bit === 0 || opposite === 0) {
    return false;
  }
  const fromMask = state.tileRoadEdges[fromIdx] ?? 0;
  const toMask = state.tileRoadEdges[toIdx] ?? 0;
  if (allowLegacyCardinalFallback && fromMask === 0 && toMask === 0) {
    return dx === 0 || dy === 0;
  }
  return (fromMask & bit) !== 0 && (toMask & opposite) !== 0;
};

const interpolate = (value: number, from: number, to: number, fromValue: number, toValue: number): number => {
  const t = clamp((value - from) / Math.max(1e-6, to - from), 0, 1);
  return fromValue + (toValue - fromValue) * t;
};

export const getVehicleSlopeMultiplier = (angleDeg: number): number => {
  if (angleDeg >= VEHICLE_IMPASSABLE_SLOPE_ANGLE_DEG) {
    return Number.POSITIVE_INFINITY;
  }
  if (angleDeg <= VEHICLE_PREFERRED_SLOPE_ANGLE_DEG) {
    return 1;
  }
  if (angleDeg <= VEHICLE_SOFT_SLOPE_ANGLE_DEG) {
    return interpolate(
      angleDeg,
      VEHICLE_PREFERRED_SLOPE_ANGLE_DEG,
      VEHICLE_SOFT_SLOPE_ANGLE_DEG,
      1,
      VEHICLE_SOFT_SLOPE_MULTIPLIER
    );
  }
  if (angleDeg <= VEHICLE_AVOID_SLOPE_ANGLE_DEG) {
    return interpolate(
      angleDeg,
      VEHICLE_SOFT_SLOPE_ANGLE_DEG,
      VEHICLE_AVOID_SLOPE_ANGLE_DEG,
      VEHICLE_SOFT_SLOPE_MULTIPLIER,
      VEHICLE_AVOID_SLOPE_MULTIPLIER
    );
  }
  return interpolate(
    angleDeg,
    VEHICLE_AVOID_SLOPE_ANGLE_DEG,
    VEHICLE_IMPASSABLE_SLOPE_ANGLE_DEG,
    VEHICLE_AVOID_SLOPE_MULTIPLIER,
    VEHICLE_MAX_SLOPE_MULTIPLIER
  );
};

export const isUnitTilePassable = (state: WorldState, x: number, y: number): boolean => {
  if (!inBounds(state.grid, x, y)) {
    return false;
  }
  const idx = indexFor(state.grid, x, y);
  const type = state.tiles[idx].type;
  if ((type === "water" && state.tileRoadBridge[idx] === 0) || type === "house") {
    return false;
  }
  return state.structureMask[idx] === 0;
};

const getFootSlopeMultiplier = (fromElevation: number, toElevation: number): number => {
  const delta = toElevation - fromElevation;
  const factor = delta >= 0
    ? 1 + delta * FOOT_MOVE_UPHILL_FACTOR
    : 1 + delta * FOOT_MOVE_DOWNHILL_FACTOR;
  return clamp(factor, FOOT_MOVE_SLOPE_MIN, FOOT_MOVE_SLOPE_MAX);
};

const getTerrainCost = (state: WorldState, idx: number): number => {
  if (isBridgeTile(state, idx)) {
    return UNIT_TERRAIN_MOVE_COST.road;
  }
  return UNIT_TERRAIN_MOVE_COST[state.tiles[idx].type] ?? 1;
};

const getVehicleSegmentAngle = (
  state: WorldState,
  fromIdx: number,
  toIdx: number,
  dx: number,
  dy: number
): number => {
  if (isBridgeTile(state, fromIdx) || isBridgeTile(state, toIdx)) {
    return 0;
  }
  return computeRenderedSegmentSlopeAngleDeg(
    state.tiles[fromIdx].elevation,
    state.tiles[toIdx].elevation,
    dx,
    dy,
    state.grid.cols,
    state.grid.rows
  );
};

export const canTraverseUnitEdge = (
  state: WorldState,
  profile: UnitMovementProfile,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): boolean => {
  if (!isUnitTilePassable(state, toX, toY) || !inBounds(state.grid, fromX, fromY)) {
    return false;
  }
  const dx = toX - fromX;
  const dy = toY - fromY;
  const fromIdx = indexFor(state.grid, fromX, fromY);
  const toIdx = indexFor(state.grid, toX, toY);
  if (dx !== 0 && dy !== 0) {
    const allowExplicitRoadDiagonal = hasRoadConnection(state, fromIdx, toIdx, dx, dy, false);
    if (!allowExplicitRoadDiagonal &&
      (!isUnitTilePassable(state, fromX + dx, fromY) || !isUnitTilePassable(state, fromX, fromY + dy))) {
      return false;
    }
  }
  return profile !== "vehicle" ||
    getVehicleSegmentAngle(state, fromIdx, toIdx, dx, dy) < VEHICLE_IMPASSABLE_SLOPE_ANGLE_DEG;
};

export const getUnitTraversalCost = (
  state: WorldState,
  profile: UnitMovementProfile,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  baseCost: number
): number => {
  const fromIdx = indexFor(state.grid, fromX, fromY);
  const toIdx = indexFor(state.grid, toX, toY);
  if (profile === "foot") {
    const slope = isBridgeTile(state, fromIdx) || isBridgeTile(state, toIdx)
      ? 1
      : getFootSlopeMultiplier(state.tiles[fromIdx].elevation, state.tiles[toIdx].elevation);
    return baseCost * getTerrainCost(state, toIdx) * slope;
  }
  const dx = toX - fromX;
  const dy = toY - fromY;
  const onConnectedRoad = hasRoadConnection(state, fromIdx, toIdx, dx, dy, true);
  const terrain = onConnectedRoad ? 1 : getTerrainCost(state, toIdx) * VEHICLE_OFF_ROAD_COST_MULTIPLIER;
  const slope = getVehicleSlopeMultiplier(getVehicleSegmentAngle(state, fromIdx, toIdx, dx, dy));
  return baseCost * terrain * slope;
};

export const getUnitMoveSpeedMultiplier = (
  state: WorldState,
  profile: UnitMovementProfile,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): number => {
  if (!inBounds(state.grid, fromX, fromY) || !inBounds(state.grid, toX, toY)) {
    return 1;
  }
  if (!canTraverseUnitEdge(state, profile, fromX, fromY, toX, toY)) {
    return 0;
  }
  return 1 / getUnitTraversalCost(state, profile, fromX, fromY, toX, toY, 1);
};

export const getUnitHeuristicScale = (profile: UnitMovementProfile): number =>
  profile === "vehicle" ? 1 : FOOT_MOVE_SLOPE_MIN;
