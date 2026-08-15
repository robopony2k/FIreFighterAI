import type { Point, Unit } from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";
import { advanceRouteMotion, type RouteMotionPoint, type RouteMotionTarget } from "../../../shared/movement/routeMotion.js";
import { MOVING_SPRAY_SPEED_FACTOR } from "../constants/runtimeConstants.js";
import { getRosterUnit, getUnitTile } from "../utils/unitLookup.js";
import { updateTruckCrewOrders, detachFromCarrier, stepTruckCrewAction } from "./crewRuntime.js";
import { getTruckCrewReadiness } from "./crewReadiness.js";
import { applyCommandIntentControl } from "./commandRuntime.js";
import { findNearestPassable, getUnitRouteResolution, routeUnitToTile } from "./unitPathing.js";
import { setUnitTarget } from "./unitDeployment.js";
import { syncCommandUnits } from "./commandUnits.js";
import { canTraverseUnitEdge, getUnitMoveSpeedMultiplier } from "./unitTraversalRules.js";
import {
  createRoadTruckOccupancy,
  syncRoadTruckOccupancy,
  tryReserveRoadTruckTile
} from "./unitRoadOccupancy.js";

const getUnitMotionTarget = (unit: Unit): RouteMotionTarget | null => {
  if (unit.pathIndex >= unit.path.length) {
    return null;
  }
  const next = unit.path[unit.pathIndex];
  return {
    index: unit.pathIndex,
    x: next.x + 0.5,
    y: next.y + 0.5
  };
};

const getUnitSegmentSpeedScale = (
  state: WorldState,
  unit: Unit,
  target: RouteMotionTarget,
  position: RouteMotionPoint
): number => {
  const next = unit.path[target.index];
  if (!next) {
    return 1;
  }
  const tileX = unit.kind === "truck"
    ? next.x - Math.sign(next.x + 0.5 - position.x)
    : Math.floor(position.x);
  const tileY = unit.kind === "truck"
    ? next.y - Math.sign(next.y + 0.5 - position.y)
    : Math.floor(position.y);
  let scale = getUnitMoveSpeedMultiplier(
    state,
    unit.kind === "truck" ? "vehicle" : "foot",
    tileX,
    tileY,
    next.x,
    next.y
  );
  if (unit.kind === "firefighter" && unit.sprayTarget) {
    const distToSpray = Math.hypot(unit.sprayTarget.x - position.x, unit.sprayTarget.y - position.y);
    if (distToSpray <= unit.hoseRange + Math.max(0.35, unit.radius * 0.35)) {
      scale *= MOVING_SPRAY_SPEED_FACTOR;
    }
  }
  return scale;
};

export function stepUnits(state: WorldState, delta: number): void {
  applyCommandIntentControl(state, delta);
  state.units.forEach((unit) => {
    unit.prevX = unit.x;
    unit.prevY = unit.y;
  });

  const unitsById = new Map<number, Unit>();
  state.units.forEach((unit) => {
    unitsById.set(unit.id, unit);
  });
  const roadTruckOccupancy = createRoadTruckOccupancy(state);

  const advanceUnit = (unit: Unit) => {
    if (unit.pathIndex >= unit.path.length) {
      return;
    }
    let blockedByRoadTruck = false;
    const result = advanceRouteMotion({
      x: unit.x,
      y: unit.y,
      movementBudget: unit.speed * Math.max(0, delta),
      getTarget: () => getUnitMotionTarget(unit),
      getSegmentSpeedScale: (target, position) => getUnitSegmentSpeedScale(state, unit, target, position),
      canEnterTarget: unit.kind === "truck"
        ? (target, position) => {
            const next = unit.path[target.index];
            if (!next) {
              return false;
            }
            const fromX = next.x - Math.sign(next.x + 0.5 - position.x);
            const fromY = next.y - Math.sign(next.y + 0.5 - position.y);
            if (!canTraverseUnitEdge(state, "vehicle", fromX, fromY, next.x, next.y)) {
              return false;
            }
            if (!tryReserveRoadTruckTile(state, roadTruckOccupancy, unit.id, next.x, next.y)) {
              blockedByRoadTruck = true;
              return false;
            }
            return true;
          }
        : undefined,
      onReachTarget: () => {
        unit.pathIndex += 1;
      },
      maxTargetsVisited: unit.path.length + 1
    });
    unit.x = result.x;
    unit.y = result.y;
    if (unit.kind === "truck") {
      syncRoadTruckOccupancy(state, roadTruckOccupancy, unit);
    }
    if (result.blocked && unit.kind === "truck" && !blockedByRoadTruck) {
      const requestedTarget = getUnitRouteResolution(unit)?.requestedTarget ?? unit.target;
      if (requestedTarget) {
        routeUnitToTile(state, unit, requestedTarget.x, requestedTarget.y, { silent: true });
      }
    }
  };

  state.units.forEach((unit) => {
    if (unit.kind === "truck") {
      updateTruckCrewOrders(state, unit);
      stepTruckCrewAction(state, unit, delta, "boarding");
      const readiness = getTruckCrewReadiness(state, unit);
      const isWaitingForCrew =
        !readiness.canDrive ||
        unit.crewMode === "boarding" ||
        unit.crewAction?.kind === "boarding" ||
        (unit.crewMode === "boarded" && unit.passengerIds.length < unit.crewIds.length);
      if (!isWaitingForCrew) {
        advanceUnit(unit);
      }
      const hasArrived = unit.pathIndex >= unit.path.length;
      if (hasArrived) {
        updateTruckCrewOrders(state, unit);
        stepTruckCrewAction(state, unit, delta, "disembarking");
        updateTruckCrewOrders(state, unit);
      }
    }
  });

  state.units.forEach((unit) => {
    if (unit.kind !== "firefighter") {
      return;
    }
    if (unit.carrierId !== null) {
      const carrier = unitsById.get(unit.carrierId);
      if (!carrier) {
        unit.carrierId = null;
      } else {
        unit.x = carrier.x;
        unit.y = carrier.y;
        if (unit.target) {
          const distToTarget = Math.hypot(unit.target.x + 0.5 - carrier.x, unit.target.y + 0.5 - carrier.y);
          if (distToTarget <= 0.8) {
            detachFromCarrier(state, unit);
            routeUnitToTile(state, unit, unit.target.x, unit.target.y, { silent: true });
          }
        }
      }
      return;
    }
    advanceUnit(unit);
  });

  if (state.phase !== "fire") {
    const returnedTruckIds = new Set<number>();
    state.units.forEach((unit) => {
      if (unit.kind !== "truck" || unit.pathIndex < unit.path.length) {
        return;
      }
      if (Math.hypot(unit.x - (state.basePoint.x + 0.5), unit.y - (state.basePoint.y + 0.5)) > 1.25) {
        return;
      }
      returnedTruckIds.add(unit.id);
      const rosterTruck = getRosterUnit(state, unit.rosterId);
      if (rosterTruck) {
        rosterTruck.status = "available";
      }
      unit.crewIds.forEach((crewId) => {
        const crew = state.units.find((entry) => entry.id === crewId) ?? null;
        const rosterCrew = getRosterUnit(state, crew?.rosterId ?? null);
        if (rosterCrew) {
          rosterCrew.status = "available";
        }
      });
    });
    if (returnedTruckIds.size > 0) {
      state.units = state.units.filter((unit) => {
        if (returnedTruckIds.has(unit.id)) {
          return false;
        }
        return unit.assignedTruckId === null || !returnedTruckIds.has(unit.assignedTruckId);
      });
      syncCommandUnits(state);
    }
  }
}

export function assignFormationTargets(state: WorldState, units: Unit[], start: Point, end: Point): void {
  if (units.length === 0) {
    return;
  }
  const count = units.length;
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const rawX = Math.round(start.x + (end.x - start.x) * t);
    const rawY = Math.round(start.y + (end.y - start.y) * t);
    const target = findNearestPassable(state, rawX, rawY, 2);
    if (target) {
      setUnitTarget(state, units[i], target.x, target.y, true);
    }
  }
}
