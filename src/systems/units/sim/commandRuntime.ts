import type {
  AreaTarget,
  CommandIntent,
  CommandTarget,
  CommandUnitAlert,
  CommandUnitStatus,
  LineTarget,
  Point,
  Unit
} from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";
import { inBounds, indexFor } from "../../../core/grid.js";
import { markFireBlockActiveByTile } from "../../../sim/fire/activeBlocks.js";
import {
  BACKBURN_IGNITE_RADIUS,
  BACKBURN_IGNITE_INTERVAL_DAYS,
  FIREFIGHTER_WATER_USE_RATE,
  THREAT_FIRE_EPS,
  TRUCK_RIVER_REFILL_RADIUS,
  TRUCK_SUPPORT_POSITION_TOLERANCE,
  TRUCK_WATER_CRITICAL_RATIO,
  TRUCK_WATER_LOW_RATIO,
  TRUCK_WATER_USE_RATE
} from "../constants/runtimeConstants.js";
import { commandIntentsEqual } from "../utils/commandIntent.js";
import { getCommandUnitTruckIds, getTruckSortKey, getUnitById, getUnitTile } from "../utils/unitLookup.js";
import { syncCommandUnits, getEffectiveTruckIntent } from "../controllers/commandSelectionController.js";
import { clearSuppressionTargets, findNearestPassable, setAttackTarget, setUnitTargetIfNeeded } from "./unitPathing.js";
import { setTruckCrewMode, updateTruckCrewOrders } from "./crewRuntime.js";
import { findFireTargetNear } from "./threatAssessment.js";
import { setUnitTarget } from "./unitDeployment.js";

const getCommandTargetBounds = (target: CommandTarget): { minX: number; maxX: number; minY: number; maxY: number } => {
  if (target.kind === "point") {
    return {
      minX: target.point.x,
      maxX: target.point.x,
      minY: target.point.y,
      maxY: target.point.y
    };
  }
  return {
    minX: Math.min(target.start.x, target.end.x),
    maxX: Math.max(target.start.x, target.end.x),
    minY: Math.min(target.start.y, target.end.y),
    maxY: Math.max(target.start.y, target.end.y)
  };
};

const getCommandTargetCenter = (target: CommandTarget): Point => {
  if (target.kind === "point") {
    return target.point;
  }
  return {
    x: Math.round((target.start.x + target.end.x) * 0.5),
    y: Math.round((target.start.y + target.end.y) * 0.5)
  };
};

const pointToSegmentDistance = (point: Point, start: Point, end: Point): number => {
  const abX = end.x - start.x;
  const abY = end.y - start.y;
  const abLenSq = abX * abX + abY * abY;
  if (abLenSq <= 1e-6) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * abX + (point.y - start.y) * abY) / abLenSq));
  const qx = start.x + abX * t;
  const qy = start.y + abY * t;
  return Math.hypot(point.x - qx, point.y - qy);
};

const pointInCommandTarget = (point: Point, target: CommandTarget): boolean => {
  if (target.kind === "point") {
    return Math.abs(point.x - target.point.x) <= 2 && Math.abs(point.y - target.point.y) <= 2;
  }
  if (target.kind === "line") {
    return pointToSegmentDistance(point, target.start, target.end) <= 3.5;
  }
  const bounds = getCommandTargetBounds(target);
  return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;
};

const resolveLooseSlotTarget = (state: WorldState, target: Point, count: number, index: number): Point => {
  if (count <= 1) {
    return target;
  }
  const angle = (Math.PI * 2 * index) / count;
  const radius = count <= 2 ? 1 : count <= 4 ? 2 : 3;
  const rawX = Math.round(target.x + Math.cos(angle) * radius);
  const rawY = Math.round(target.y + Math.sin(angle) * radius);
  return findNearestPassable(state, rawX, rawY, 2) ?? target;
};

const resolveAreaSlotTarget = (state: WorldState, target: AreaTarget, count: number, index: number): Point => {
  const bounds = getCommandTargetBounds(target);
  const width = Math.max(1, bounds.maxX - bounds.minX + 1);
  const height = Math.max(1, bounds.maxY - bounds.minY + 1);
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / columns));
  const column = index % columns;
  const row = Math.floor(index / columns);
  const rawX = Math.round(bounds.minX + ((column + 0.5) / columns) * width);
  const rawY = Math.round(bounds.minY + ((row + 0.5) / rows) * height);
  return findNearestPassable(state, rawX, rawY, 2) ?? getCommandTargetCenter(target);
};

const resolveLineSlotTarget = (state: WorldState, target: LineTarget, count: number, index: number): Point => {
  const t = count <= 1 ? 0.5 : index / Math.max(1, count - 1);
  const rawX = Math.round(target.start.x + (target.end.x - target.start.x) * t);
  const rawY = Math.round(target.start.y + (target.end.y - target.start.y) * t);
  return findNearestPassable(state, rawX, rawY, 2) ?? getCommandTargetCenter(target);
};

const resolveIntentSlotTarget = (state: WorldState, intent: CommandIntent, count: number, index: number): Point => {
  if (intent.formation === "area" && intent.target.kind === "area") {
    return resolveAreaSlotTarget(state, intent.target, count, index);
  }
  if (intent.formation === "line" && intent.target.kind === "line") {
    return resolveLineSlotTarget(state, intent.target, count, index);
  }
  return resolveLooseSlotTarget(state, getCommandTargetCenter(intent.target), count, index);
};

const findNearestThreatForTarget = (state: WorldState, origin: Point, target: CommandTarget): Point | null => {
  let best: Point | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const bounds = getCommandTargetBounds(target);
  const minX = Math.max(0, bounds.minX - 4);
  const maxX = Math.min(state.grid.cols - 1, bounds.maxX + 4);
  const minY = Math.max(0, bounds.minY - 4);
  const maxY = Math.min(state.grid.rows - 1, bounds.maxY + 4);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const point = { x, y };
      const idx = indexFor(state.grid, x, y);
      const fireValue = state.tileFire[idx] ?? 0;
      const heatValue = state.tileHeat[idx] ?? 0;
      if (fireValue <= THREAT_FIRE_EPS && heatValue <= 0.08) {
        continue;
      }
      const nearTarget = pointInCommandTarget(point, target);
      const score = Math.hypot(origin.x - x, origin.y - y) + (nearTarget ? 0 : 6) - fireValue * 4 - heatValue * 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = point;
      }
    }
  }
  return best;
};

const isTruckUnsafe = (state: WorldState, truck: Unit): boolean => {
  const tile = getUnitTile(truck);
  const idx = indexFor(state.grid, tile.x, tile.y);
  return (state.tileFire[idx] ?? 0) >= 0.2 || (state.tileHeat[idx] ?? 0) >= 0.45;
};

const moveTruckAwayFromThreat = (state: WorldState, truck: Unit, threatPoint: Point): void => {
  const tile = getUnitTile(truck);
  const dx = tile.x - threatPoint.x;
  const dy = tile.y - threatPoint.y;
  const scale = Math.max(1, Math.hypot(dx, dy));
  const retreatX = Math.round(tile.x + (dx / scale) * 3);
  const retreatY = Math.round(tile.y + (dy / scale) * 3);
  const retreatTile = findNearestPassable(state, retreatX, retreatY, 3) ?? tile;
  setUnitTargetIfNeeded(state, truck, retreatTile.x, retreatTile.y, { silent: true }, 0.8);
  truck.currentStatus = "retreating";
};

const igniteBackburnTile = (state: WorldState, tileX: number, tileY: number): boolean => {
  if (!inBounds(state.grid, tileX, tileY)) {
    return false;
  }
  const idx = indexFor(state.grid, tileX, tileY);
  const target = state.tiles[idx];
  if (!target || target.fuel <= 0 || target.type === "water" || target.type === "road" || target.type === "base" || target.type === "house") {
    return false;
  }
  if ((state.tileFire[idx] ?? 0) > THREAT_FIRE_EPS) {
    return false;
  }
  target.fire = Math.min(1, 0.4 + target.fuel * 0.2);
  target.heat = Math.max(target.heat, target.ignitionPoint * 1.1);
  state.tileFire[idx] = target.fire;
  state.tileHeat[idx] = target.heat;
  state.tileBurnAge[idx] = 0;
  state.tileHeatRelease[idx] = Math.max(state.tileHeatRelease[idx] ?? 0, target.fire * target.heatOutput);
  markFireBlockActiveByTile(state, idx);
  return true;
};

const maybeIgniteBackburn = (state: WorldState, truck: Unit, intent: CommandIntent, slotTarget: Point): void => {
  if (intent.type !== "backburn" || intent.target.kind !== "area") {
    return;
  }
  if (truck.pathIndex < truck.path.length) {
    return;
  }
  if (state.careerDay - truck.lastBackburnAt < BACKBURN_IGNITE_INTERVAL_DAYS) {
    return;
  }
  const bounds = getCommandTargetBounds(intent.target);
  let best: Point | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let y = Math.max(0, bounds.minY); y <= Math.min(state.grid.rows - 1, bounds.maxY); y += 1) {
    for (let x = Math.max(0, bounds.minX); x <= Math.min(state.grid.cols - 1, bounds.maxX); x += 1) {
      const point = { x, y };
      if (Math.hypot(point.x - slotTarget.x, point.y - slotTarget.y) > BACKBURN_IGNITE_RADIUS) {
        continue;
      }
      const idx = indexFor(state.grid, x, y);
      const fireValue = state.tileFire[idx] ?? 0;
      if (fireValue > THREAT_FIRE_EPS) {
        continue;
      }
      const tile = state.tiles[idx];
      if (!tile || tile.fuel <= 0 || tile.type === "water" || tile.type === "road" || tile.type === "base" || tile.type === "house") {
        continue;
      }
      const score = Math.hypot(x - slotTarget.x, y - slotTarget.y);
      if (score < bestScore) {
        bestScore = score;
        best = point;
      }
    }
  }
  if (!best) {
    return;
  }
  if (igniteBackburnTile(state, best.x, best.y)) {
    truck.lastBackburnAt = state.careerDay;
  }
};

const updateTruckAlerts = (state: WorldState, truck: Unit): void => {
  const alerts: CommandUnitAlert[] = [];
  const waterRatio = truck.waterCapacity > 0 ? truck.water / truck.waterCapacity : 1;
  if (waterRatio <= 0) {
    alerts.push("empty");
  } else if (waterRatio <= TRUCK_WATER_CRITICAL_RATIO) {
    alerts.push("critical");
  } else if (waterRatio <= TRUCK_WATER_LOW_RATIO) {
    alerts.push("low");
  }
  if (truck.crewIds.length <= 1) {
    alerts.push("crew_low");
  }
  if (isTruckUnsafe(state, truck)) {
    alerts.push("danger");
  }
  truck.currentAlerts = alerts;
};

const isTruckNearRiverWaterSource = (state: WorldState, truck: Unit): boolean => {
  const tile = getUnitTile(truck);
  for (let dy = -TRUCK_RIVER_REFILL_RADIUS; dy <= TRUCK_RIVER_REFILL_RADIUS; dy += 1) {
    for (let dx = -TRUCK_RIVER_REFILL_RADIUS; dx <= TRUCK_RIVER_REFILL_RADIUS; dx += 1) {
      const nx = tile.x + dx;
      const ny = tile.y + dy;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const idx = indexFor(state.grid, nx, ny);
      if (state.tileRiverMask[idx] > 0) {
        return true;
      }
    }
  }
  return false;
};

const isTruckGroupActivelySpraying = (state: WorldState, truck: Unit): boolean => {
  if (truck.water <= 0.01) {
    return false;
  }
  if (truck.sprayTarget) {
    return true;
  }
  return state.units.some(
    (unit) =>
      unit.kind === "firefighter" &&
      unit.carrierId === null &&
      unit.assignedTruckId === truck.id &&
      unit.sprayTarget !== null
  );
};

const updateTruckWater = (state: WorldState, truck: Unit, delta: number): void => {
  if (truck.kind !== "truck" || truck.waterCapacity <= 0) {
    return;
  }
  const tile = getUnitTile(truck);
  const idx = indexFor(state.grid, tile.x, tile.y);
  if (state.tiles[idx]?.type === "base") {
    truck.water = Math.max(0, Math.min(truck.waterCapacity, truck.water + truck.waterRefillRate * delta));
    return;
  }
  if (isTruckNearRiverWaterSource(state, truck) && !isTruckGroupActivelySpraying(state, truck)) {
    truck.water = Math.max(0, Math.min(truck.waterCapacity, truck.water + TRUCK_WATER_USE_RATE * delta));
  }
};

const getUnitWaterSourceTruck = (state: WorldState, unit: Unit): Unit | null => {
  if (unit.kind === "truck") {
    return unit;
  }
  if (unit.assignedTruckId === null) {
    return null;
  }
  const truck = getUnitById(state, unit.assignedTruckId);
  return truck && truck.kind === "truck" ? truck : null;
};

export const canUnitSpray = (state: WorldState, unit: Unit): boolean => {
  const truck = getUnitWaterSourceTruck(state, unit);
  if (!truck || truck.waterCapacity <= 0) {
    return true;
  }
  return truck.water > 0.01;
};

export const spendUnitWater = (state: WorldState, unit: Unit, delta: number): void => {
  const truck = getUnitWaterSourceTruck(state, unit);
  if (!truck || truck.waterCapacity <= 0) {
    return;
  }
  const useRate = unit.kind === "truck" ? TRUCK_WATER_USE_RATE : FIREFIGHTER_WATER_USE_RATE;
  const spend = delta * useRate;
  truck.water = Math.max(0, Math.min(truck.waterCapacity, truck.water - spend));
  const truckTile = getUnitTile(truck);
  const truckIdx = indexFor(state.grid, truckTile.x, truckTile.y);
  if (state.tiles[truckIdx]?.type !== "base" && isTruckNearRiverWaterSource(state, truck)) {
    truck.water = Math.max(0, Math.min(truck.waterCapacity, truck.water + spend));
  }
};

const applyTruckCommandIntent = (state: WorldState, truck: Unit, selectedTrucks: Unit[], selectedIndex: number): void => {
  const intent = getEffectiveTruckIntent(state, truck);
  if (!intent) {
    truck.behaviourMode = "balanced";
    updateTruckAlerts(state, truck);
    if (truck.pathIndex < truck.path.length) {
      truck.currentStatus = "moving";
    } else if (truck.attackTarget || truck.sprayTarget) {
      truck.currentStatus = "suppressing";
    } else {
      truck.currentStatus = "holding";
    }
    return;
  }

  truck.behaviourMode = intent.behaviourMode;
  const slotTarget = resolveIntentSlotTarget(state, intent, selectedTrucks.length, selectedIndex);
  const nearbyThreat = findNearestThreatForTarget(state, slotTarget, intent.target);

  if (intent.type === "move") {
    clearSuppressionTargets(truck);
    truck.autonomous = false;
    setTruckCrewMode(state, truck.id, "boarded", { silent: true });
    setUnitTargetIfNeeded(state, truck, slotTarget.x, slotTarget.y, { silent: true }, 0.8);
    truck.currentStatus = truck.pathIndex < truck.path.length ? "moving" : "holding";
    updateTruckAlerts(state, truck);
    return;
  }

  truck.autonomous = true;
  setAttackTarget(truck, nearbyThreat ? { x: nearbyThreat.x + 0.5, y: nearbyThreat.y + 0.5 } : null);
  if (intent.behaviourMode === "defensive" && nearbyThreat && isTruckUnsafe(state, truck)) {
    moveTruckAwayFromThreat(state, truck, nearbyThreat);
    updateTruckAlerts(state, truck);
    return;
  }
  if (truck.pathIndex >= truck.path.length) {
    const distToSlot = Math.hypot(truck.x - (slotTarget.x + 0.5), truck.y - (slotTarget.y + 0.5));
    if (distToSlot > TRUCK_SUPPORT_POSITION_TOLERANCE * 0.75) {
      setTruckCrewMode(state, truck.id, "boarded", { silent: true });
      setUnitTargetIfNeeded(state, truck, slotTarget.x, slotTarget.y, { silent: true }, 0.8);
    }
  } else {
    setTruckCrewMode(state, truck.id, "boarded", { silent: true });
  }
  if (intent.type === "backburn") {
    maybeIgniteBackburn(state, truck, intent, slotTarget);
  }
  if (truck.pathIndex < truck.path.length) {
    truck.currentStatus = "moving";
  } else if (nearbyThreat) {
    truck.currentStatus = intent.behaviourMode === "defensive" && isTruckUnsafe(state, truck) ? "retreating" : "suppressing";
  } else {
    truck.currentStatus = "holding";
  }
  updateTruckAlerts(state, truck);
};

const updateCommandUnitStatuses = (state: WorldState): void => {
  state.commandUnits.forEach((commandUnit) => {
    const trucks = commandUnit.truckIds
      .map((truckId) => getUnitById(state, truckId))
      .filter((truck): truck is Unit => !!truck && truck.kind === "truck");
    const priority: CommandUnitStatus[] = ["retreating", "suppressing", "moving", "holding"];
    commandUnit.status = priority.find((status) => trucks.some((truck) => truck.currentStatus === status)) ?? "holding";
  });
};

export const applyCommandIntentControl = (state: WorldState, delta: number): void => {
  syncCommandUnits(state);
  state.units.forEach((unit) => {
    if (unit.kind === "truck") {
      updateTruckWater(state, unit, delta);
    }
  });
  const trucks = state.units
    .filter((unit) => unit.kind === "truck")
    .sort((left, right) => getTruckSortKey(left) - getTruckSortKey(right));
  trucks.forEach((truck) => {
    const cohort = truck.truckOverrideIntent
      ? trucks.filter((entry) => entry.truckOverrideIntent && commandIntentsEqual(entry.truckOverrideIntent, truck.truckOverrideIntent))
      : truck.commandUnitId !== null
        ? getCommandUnitTruckIds(state, truck.commandUnitId)
            .map((truckId) => getUnitById(state, truckId))
            .filter((entry): entry is Unit => !!entry && entry.kind === "truck")
            .sort((left, right) => getTruckSortKey(left) - getTruckSortKey(right))
        : [truck];
    const selectedIndex = Math.max(0, cohort.findIndex((entry) => entry.id === truck.id));
    applyTruckCommandIntent(state, truck, cohort, selectedIndex);
  });
  updateCommandUnitStatuses(state);
};

export function autoAssignTargets(state: WorldState): void {
  applyCommandIntentControl(state, 0);
  state.units.forEach((unit) => {
    if (unit.kind === "truck") {
      updateTruckCrewOrders(state, unit);
    }
  });

  for (const unit of state.units) {
    if (!unit.autonomous) {
      continue;
    }
    if (unit.kind === "firefighter" && unit.assignedTruckId !== null) {
      continue;
    }
    if (unit.target && unit.pathIndex < unit.path.length) {
      continue;
    }
    const scanRadius = unit.kind === "truck" ? 8 : 6;
    const threatFocus = findFireTargetNear(state, { x: unit.x, y: unit.y }, scanRadius, unit.attackTarget ?? unit.sprayTarget ?? null);
    if (threatFocus) {
      const best = findNearestPassable(state, Math.floor(threatFocus.x), Math.floor(threatFocus.y), 2);
      if (best) {
        setUnitTarget(state, unit, best.x, best.y, false, { silent: true });
      }
    }
  }
}
