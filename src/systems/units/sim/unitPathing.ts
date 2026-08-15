import type { Point, Unit } from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";
import { inBounds } from "../../../core/grid.js";
import { setStatus } from "../../../core/state.js";
import type { UnitPathResult, UnitRouteResolution } from "../types/unitPathTypes.js";
import { findUnitPath } from "./unitPathfinder.js";
import { isUnitTilePassable } from "./unitTraversalRules.js";

const routeResolutionByUnit = new WeakMap<Unit, UnitRouteResolution>();

export const getUnitRouteResolution = (unit: Unit): UnitRouteResolution | null =>
  routeResolutionByUnit.get(unit) ?? null;

export const findNearestPassable = (state: WorldState, x: number, y: number, radius = 2): Point | null => {
  if (inBounds(state.grid, x, y) && isUnitTilePassable(state, x, y)) {
    return { x, y };
  }
  for (let r = 1; r <= radius; r += 1) {
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) {
          continue;
        }
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(state.grid, nx, ny)) {
          continue;
        }
        if (isUnitTilePassable(state, nx, ny)) {
          return { x: nx, y: ny };
        }
      }
    }
  }
  return null;
};

export const routeUnitToTile = (
  state: WorldState,
  unit: Unit,
  tileX: number,
  tileY: number,
  options?: { silent?: boolean; statusMessage?: string }
): UnitPathResult => {
  const requestedTarget = { x: tileX, y: tileY };
  const result = findUnitPath(
    state,
    { x: Math.floor(unit.x), y: Math.floor(unit.y) },
    requestedTarget,
    unit.kind === "truck" ? "vehicle" : "foot"
  );
  unit.target = result.resolvedTarget ? { ...result.resolvedTarget } : null;
  unit.path = result.path;
  unit.pathIndex = 0;
  if (result.resolvedTarget) {
    routeResolutionByUnit.set(unit, {
      status: result.status === "exact" ? "exact" : "nearest",
      requestedTarget,
      resolvedTarget: { ...result.resolvedTarget }
    });
  } else {
    routeResolutionByUnit.delete(unit);
  }
  if (!options?.silent) {
    if (result.status === "nearest") {
      setStatus(state, "Exact vehicle destination is unreachable. Routing to the closest reachable location.");
    } else if (result.status === "none") {
      setStatus(state, "No route is available to that location.");
    } else if (options?.statusMessage) {
      setStatus(state, options.statusMessage);
    }
  }
  return result;
};

export const setAttackTarget = (unit: Unit, target: Point | null): void => {
  unit.attackTarget = target ? { x: target.x, y: target.y } : null;
};

export const setSprayTarget = (unit: Unit, target: Point | null): void => {
  unit.sprayTarget = target ? { x: target.x, y: target.y } : null;
};

export const clearSuppressionTargets = (unit: Unit): void => {
  setAttackTarget(unit, null);
  setSprayTarget(unit, null);
};

export const setUnitTargetIfNeeded = (
  state: WorldState,
  unit: Unit,
  tileX: number,
  tileY: number,
  options?: { silent?: boolean; statusMessage?: string },
  tolerance = 0.7
): void => {
  const resolution = getUnitRouteResolution(unit);
  if (resolution &&
    resolution.requestedTarget.x === tileX &&
    resolution.requestedTarget.y === tileY &&
    resolution.status === "nearest") {
    return;
  }
  if (unit.target && unit.target.x === tileX && unit.target.y === tileY && unit.pathIndex < unit.path.length) {
    return;
  }
  const distToTarget = Math.hypot(unit.x - (tileX + 0.5), unit.y - (tileY + 0.5));
  if (distToTarget <= tolerance && (!unit.target || unit.pathIndex >= unit.path.length)) {
    unit.target = { x: tileX, y: tileY };
    unit.path = [];
    unit.pathIndex = 0;
    return;
  }
  routeUnitToTile(state, unit, tileX, tileY, options);
};
