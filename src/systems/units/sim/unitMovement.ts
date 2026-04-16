import type { Point, Unit } from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";
import { findPath, getMoveSpeedMultiplier } from "../../../sim/pathing.js";
import { MOVING_SPRAY_SPEED_FACTOR } from "../constants/runtimeConstants.js";
import { getUnitTile } from "../utils/unitLookup.js";
import { updateTruckCrewOrders, detachFromCarrier } from "./crewRuntime.js";
import { applyCommandIntentControl } from "./commandRuntime.js";
import { findNearestPassable } from "./unitPathing.js";
import { setUnitTarget } from "./unitDeployment.js";

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

  const advanceUnit = (unit: Unit) => {
    if (unit.pathIndex < unit.path.length) {
      const next = unit.path[unit.pathIndex];
      const targetX = next.x + 0.5;
      const targetY = next.y + 0.5;
      const dx = targetX - unit.x;
      const dy = targetY - unit.y;
      const dist = Math.hypot(dx, dy);
      const tile = getUnitTile(unit);
      const speedMultiplier = getMoveSpeedMultiplier(state, tile.x, tile.y, next.x, next.y);
      let step = unit.speed * speedMultiplier * delta;
      if (unit.kind === "firefighter" && unit.sprayTarget) {
        const distToSpray = Math.hypot(unit.sprayTarget.x - unit.x, unit.sprayTarget.y - unit.y);
        if (distToSpray <= unit.hoseRange + Math.max(0.35, unit.radius * 0.35)) {
          step *= MOVING_SPRAY_SPEED_FACTOR;
        }
      }
      if (dist <= step || dist < 0.01) {
        unit.x = targetX;
        unit.y = targetY;
        unit.pathIndex += 1;
      } else {
        unit.x += (dx / dist) * step;
        unit.y += (dy / dist) * step;
      }
    }
  };

  state.units.forEach((unit) => {
    if (unit.kind === "truck") {
      const isWaitingForCrew = unit.crewMode === "boarded" && unit.passengerIds.length < unit.crewIds.length;
      if (!isWaitingForCrew) {
        advanceUnit(unit);
      }
      const hasArrived = unit.pathIndex >= unit.path.length;
      if (hasArrived && unit.crewMode === "boarded") {
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
            unit.path = findPath(state, getUnitTile(unit), unit.target);
            unit.pathIndex = 0;
          }
        }
      }
      return;
    }
    advanceUnit(unit);
  });
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
