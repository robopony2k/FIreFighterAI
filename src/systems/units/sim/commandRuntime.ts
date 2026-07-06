import type { CommandIntent, CommandUnitAlert, Point, Unit } from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";
import { inBounds, indexFor } from "../../../core/grid.js";
import { markFireBlockActiveByTile } from "../../../sim/fire/activeBlocks.js";
import {
  BACKBURN_IGNITE_RADIUS,
  BACKBURN_IGNITE_INTERVAL_DAYS,
  THREAT_FIRE_EPS,
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
import { getTruckCrewReadiness, getTruckCrewUnits } from "./crewReadiness.js";
import { getAverageHoseRange } from "./crewFormation.js";
import { findFireTargetNear } from "./threatAssessment.js";
import { setUnitTarget } from "./unitDeployment.js";
import { updateTruckWater } from "./unitWater.js";
import { FIREFIGHTER_TETHER_DISTANCE } from "../../../core/config.js";

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

const clearTruckFireTaskTargets = (state: WorldState, truck: Unit): void => {
  clearSuppressionTargets(truck);
  state.units.forEach((unit) => {
    if (unit.kind === "firefighter" && unit.assignedTruckId === truck.id) {
      clearSuppressionTargets(unit);
    }
  });
};

const hasActiveHoseTask = (intent: CommandIntent | null): boolean =>
  !!intent && (intent.fireTask === "suppress" || intent.fireTask === "contain");

const getReachableFireTaskTarget = (state: WorldState, truck: Unit, intent: CommandIntent | null): Point | null => {
  if (!intent || !hasActiveHoseTask(intent)) {
    return null;
  }
  const truckTile = getUnitTile(truck);
  const crew = getTruckCrewUnits(state, truck);
  const engagementRadius = FIREFIGHTER_TETHER_DISTANCE + getAverageHoseRange(crew);
  if (engagementRadius <= 0) {
    return null;
  }
  const targetThreat = findNearestThreatForTarget(state, truckTile, intent.target);
  if (!targetThreat) {
    return null;
  }
  if (Math.hypot(targetThreat.x - truckTile.x, targetThreat.y - truckTile.y) > engagementRadius) {
    return null;
  }
  return findFireTargetNear(state, truckTile, engagementRadius, { x: targetThreat.x + 0.5, y: targetThreat.y + 0.5 });
};

const maybeIgniteBackburn = (state: WorldState, truck: Unit, intent: CommandIntent): boolean => {
  if (intent.fireTask !== "backburn" || intent.target.kind !== "area" || truck.crewMode !== "deployed" || truck.crewAction !== null) {
    return false;
  }
  if (truck.pathIndex < truck.path.length) {
    return false;
  }
  if (state.careerDay - truck.lastBackburnAt < BACKBURN_IGNITE_INTERVAL_DAYS) {
    return false;
  }
  const bounds = getCommandTargetBounds(intent.target);
  const truckTile = getUnitTile(truck);
  let best: Point | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let y = Math.max(0, bounds.minY); y <= Math.min(state.grid.rows - 1, bounds.maxY); y += 1) {
    for (let x = Math.max(0, bounds.minX); x <= Math.min(state.grid.cols - 1, bounds.maxX); x += 1) {
      const point = { x, y };
      if (Math.hypot(point.x - truckTile.x, point.y - truckTile.y) > BACKBURN_IGNITE_RADIUS) {
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
      const score = Math.hypot(x - truckTile.x, y - truckTile.y);
      if (score < bestScore) {
        bestScore = score;
        best = point;
      }
    }
  }
  if (!best) {
    return false;
  }
  if (igniteBackburnTile(state, best.x, best.y)) {
    truck.lastBackburnAt = state.careerDay;
    return true;
  }
  return false;
};

const updateTruckAlerts = (state: WorldState, truck: Unit): void => {
  const alerts: CommandUnitAlert[] = [];
  const waterRatio = truck.waterCapacity > 0 ? truck.water / truck.waterCapacity : 1;
  const readiness = getTruckCrewReadiness(state, truck);
  const intent = getEffectiveTruckIntent(state, truck);
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
  if (!readiness.canDrive) {
    alerts.push("driver_missing");
  }
  if (truck.crewAction !== null || truck.crewMode === "boarding" || truck.crewMode === "disembarking") {
    alerts.push("crew_transition");
  }
  if (intent?.fireTask === "hold_fire") {
    alerts.push("holding_fire");
  }
  if (intent && hasActiveHoseTask(intent) && truck.crewMode !== "deployed" && intent.placementMode !== "deploy" && intent.placementMode !== "relocate") {
    alerts.push("deploy_required");
  }
  if (intent && hasActiveHoseTask(intent) && truck.crewMode === "deployed" && truck.crewAction === null && !getReachableFireTaskTarget(state, truck, intent)) {
    alerts.push("out_of_range");
  }
  if (readiness.hoseSlots <= 0 && intent && hasActiveHoseTask(intent)) {
    alerts.push("hose_unstaffed");
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
    truck.currentStatus =
      truck.crewMode === "boarding" || truck.crewAction?.kind === "boarding"
        ? "boarding"
        : truck.crewMode === "disembarking" || truck.crewAction?.kind === "disembarking"
          ? "deploying"
          : truck.pathIndex < truck.path.length
            ? "moving"
            : state.units.some((unit) => unit.kind === "firefighter" && unit.assignedTruckId === truck.id && unit.sprayTarget !== null)
              ? "suppressing"
              : "holding";
    updateTruckAlerts(state, truck);
    return;
  }

  truck.behaviourMode = intent.behaviourMode;
  const slotTarget = resolveIntentSlotTarget(state, intent, selectedTrucks.length, selectedIndex);
  const reachableFireTarget = getReachableFireTaskTarget(state, truck, intent);
  const hasFireTask = intent.fireTask !== "hold_fire";

  truck.autonomous = false;
  if (intent.fireTask === "hold_fire" || !hasFireTask) {
    clearTruckFireTaskTargets(state, truck);
  }
  if (hasActiveHoseTask(intent)) {
    setAttackTarget(truck, reachableFireTarget);
    if (!reachableFireTarget) {
      clearTruckFireTaskTargets(state, truck);
    }
  } else {
    setAttackTarget(truck, null);
  }

  if (intent.behaviourMode === "defensive" && isTruckUnsafe(state, truck)) {
    const threatPoint = findNearestThreatForTarget(state, getUnitTile(truck), intent.target) ?? getUnitTile(truck);
    setTruckCrewMode(state, truck.id, "boarded", { silent: true });
    moveTruckAwayFromThreat(state, truck, threatPoint);
    updateTruckAlerts(state, truck);
    return;
  }

  if (intent.placementMode === "recall") {
    clearTruckFireTaskTargets(state, truck);
    setTruckCrewMode(state, truck.id, "boarded", { silent: true });
    truck.currentStatus =
      truck.crewMode === "boarding" || truck.crewAction?.kind === "boarding"
        ? "boarding"
        : truck.pathIndex < truck.path.length
          ? "moving"
          : "holding";
    updateTruckAlerts(state, truck);
    return;
  }

  const movesToSlot = intent.placementMode === "move" || intent.placementMode === "deploy" || intent.placementMode === "relocate";
  const distToSlot = movesToSlot ? Math.hypot(truck.x - (slotTarget.x + 0.5), truck.y - (slotTarget.y + 0.5)) : 0;
  const needsMove = movesToSlot && distToSlot > 0.75;
  if (intent.placementMode === "move" || intent.placementMode === "relocate" || needsMove) {
    setTruckCrewMode(state, truck.id, "boarded", { silent: true });
    if (needsMove) {
      setUnitTargetIfNeeded(state, truck, slotTarget.x, slotTarget.y, { silent: true }, 0.8);
    }
  }

  const arrivedAtPlacement = movesToSlot && truck.pathIndex >= truck.path.length && distToSlot <= 0.95;
  const shouldDeploy =
    arrivedAtPlacement &&
    truck.crewAction?.kind !== "boarding" &&
    (intent.placementMode === "deploy" || (intent.placementMode === "relocate" && intent.fireTask !== "hold_fire"));
  if (shouldDeploy) {
    setTruckCrewMode(state, truck.id, "deployed", { silent: true });
  }

  if (intent.fireTask === "backburn") {
    maybeIgniteBackburn(state, truck, intent);
  }
  truck.currentStatus =
    truck.crewMode === "boarding" || truck.crewAction?.kind === "boarding"
      ? "boarding"
      : truck.crewMode === "disembarking" || truck.crewAction?.kind === "disembarking"
        ? "deploying"
        : truck.pathIndex < truck.path.length
          ? "moving"
          : hasActiveHoseTask(intent) && truck.crewMode === "deployed" && reachableFireTarget
            ? "suppressing"
            : "holding";
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
    if (unit.kind === "truck") {
      continue;
    }
    if (unit.kind === "firefighter" && unit.assignedTruckId !== null) {
      continue;
    }
    if (unit.target && unit.pathIndex < unit.path.length) {
      continue;
    }
    const scanRadius = 6;
    const threatFocus = findFireTargetNear(state, { x: unit.x, y: unit.y }, scanRadius, unit.attackTarget ?? unit.sprayTarget ?? null);
    if (threatFocus) {
      const best = findNearestPassable(state, Math.floor(threatFocus.x), Math.floor(threatFocus.y), 2);
      if (best) {
        setUnitTarget(state, unit, best.x, best.y, false, { silent: true });
      }
    }
  }
}
