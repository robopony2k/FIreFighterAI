import type { WorldState } from "../core/state.js";
import type { Point } from "../core/types.js";

const expFactor = (rate: number, dtSeconds: number): number =>
  1 - Math.exp(-Math.max(0, rate) * Math.max(0, dtSeconds));

const normalizeAngle = (angle: number): number => {
  let normalized = angle % (Math.PI * 2);
  if (normalized > Math.PI) {
    normalized -= Math.PI * 2;
  } else if (normalized < -Math.PI) {
    normalized += Math.PI * 2;
  }
  return normalized;
};

export const approachAngleExp = (
  current: number,
  target: number,
  rate: number,
  dtSeconds: number
): number => {
  const delta = normalizeAngle(target - current);
  return normalizeAngle(current + delta * expFactor(rate, dtSeconds));
};

export const resolveUnitFacingTarget = (
  unit: WorldState["units"][number],
  x: number,
  y: number
): Point | null => {
  if (unit.kind === "firefighter" && unit.sprayTarget) {
    const sprayRange = unit.hoseRange + Math.max(0.35, unit.radius * 0.35);
    const sprayDist = Math.hypot(unit.sprayTarget.x - x, unit.sprayTarget.y - y);
    if (sprayDist <= sprayRange || unit.pathIndex >= unit.path.length) {
      return {
        x: unit.sprayTarget.x,
        y: unit.sprayTarget.y
      };
    }
  }

  if (unit.pathIndex < unit.path.length) {
    const waypoint = unit.path[unit.pathIndex];
    return waypoint
      ? {
          x: waypoint.x + 0.5,
          y: waypoint.y + 0.5
        }
      : null;
  }

  if (unit.target) {
    return {
      x: unit.target.x + 0.5,
      y: unit.target.y + 0.5
    };
  }

  if (unit.kind === "firefighter" && unit.attackTarget) {
    return {
      x: unit.attackTarget.x,
      y: unit.attackTarget.y
    };
  }

  const motionX = unit.x - unit.prevX;
  const motionY = unit.y - unit.prevY;
  if (motionX * motionX + motionY * motionY > 1e-8) {
    return {
      x: x + motionX,
      y: y + motionY
    };
  }

  return null;
};

export const resolveDesiredUnitYaw = (
  unit: WorldState["units"][number],
  x: number,
  y: number,
  fallbackYaw: number
): number => {
  const target = resolveUnitFacingTarget(unit, x, y);
  if (!target) {
    return fallbackYaw;
  }
  const dirX = target.x - x;
  const dirY = target.y - y;
  if (dirX * dirX + dirY * dirY <= 1e-8) {
    return fallbackYaw;
  }
  return Math.atan2(dirX, dirY);
};
