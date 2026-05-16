import type { CommandIntent, CommandUnitAlert, Point, Unit } from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";
import { inBounds, indexFor } from "../../../core/grid.js";
import { markFireBlockActiveByTile } from "../../../sim/fire/activeBlocks.js";
import {
  BACKBURN_IGNITE_RADIUS,
  BACKBURN_IGNITE_INTERVAL_DAYS,
  THREAT_FIRE_EPS,
  TRUCK_SUPPORT_POSITION_TOLERANCE,
  TRUCK_WATER_CRITICAL_RATIO,
  TRUCK_WATER_LOW_RATIO
} from "../constants/runtimeConstants.js";
import { commandIntentsEqual } from "../utils/commandIntent.js";
import { getTruckSortKey, getUnitById, getUnitTile } from "../utils/unitLookup.js";
import {
  getCommandUnitTruckIds,
  getEffectiveTruckIntent,
  syncCommandUnits,
  updateCommandUnitStatuses
} from "./commandUnits.js";
import { findNearestThreatForTarget, getCommandTargetBounds, resolveIntentSlotTarget } from "./commandTargeting.js";
import { clearSuppressionTargets, findNearestPassable, setAttackTarget, setUnitTargetIfNeeded } from "./unitPathing.js";
import { setTruckCrewMode, updateTruckCrewOrders } from "./crewRuntime.js";
import { findFireTargetNear } from "./threatAssessment.js";
import { setUnitTarget } from "./unitDeployment.js";
import { updateTruckWater } from "./unitWater.js";

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
