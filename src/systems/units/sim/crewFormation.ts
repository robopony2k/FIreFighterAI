import type { BehaviourMode, Point, Unit } from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";
import { FIREFIGHTER_TETHER_DISTANCE } from "../../../core/config.js";
import { inBounds } from "../../../core/grid.js";
import { isPassable } from "../../../sim/pathing.js";
import { getUnitTile } from "../utils/unitLookup.js";
import { findNearestPassable } from "./unitPathing.js";

export const clampTargetToTruckRange = (state: WorldState, truck: Unit, target: Point): Point => {
  const truckTile = getUnitTile(truck);
  const dx = target.x - truckTile.x;
  const dy = target.y - truckTile.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= FIREFIGHTER_TETHER_DISTANCE) {
    return target;
  }
  const scale = FIREFIGHTER_TETHER_DISTANCE / Math.max(0.0001, dist);
  const rawX = Math.round(truckTile.x + dx * scale);
  const rawY = Math.round(truckTile.y + dy * scale);
  const clamped = findNearestPassable(state, rawX, rawY, 2);
  return clamped ?? truckTile;
};

export const getAverageHoseRange = (crew: Unit[]): number => {
  if (crew.length === 0) {
    return 0;
  }
  let total = 0;
  for (const member of crew) {
    total += Math.max(0, member.hoseRange);
  }
  return total / crew.length;
};

export const getStandoffDistance = (hoseRange: number, behaviourMode: BehaviourMode = "balanced"): number => {
  const base = Math.max(2.75, Math.min(Math.max(2.75, hoseRange - 0.5), hoseRange * 0.85));
  if (behaviourMode === "aggressive") {
    return Math.max(2.35, base - 0.65);
  }
  if (behaviourMode === "defensive") {
    return base + 0.9;
  }
  return base;
};

export const findPassableStandoffSlot = (
  state: WorldState,
  desiredX: number,
  desiredY: number,
  fireTarget: Point,
  attackDirX: number,
  attackDirY: number,
  radius = 2
): Point | null => {
  let best: Point | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let r = 0; r <= radius; r += 1) {
    const minX = Math.max(0, Math.floor(desiredX - r));
    const maxX = Math.min(state.grid.cols - 1, Math.ceil(desiredX + r));
    const minY = Math.max(0, Math.floor(desiredY - r));
    const maxY = Math.min(state.grid.rows - 1, Math.ceil(desiredY + r));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (r > 0 && Math.abs(x - desiredX) < r && Math.abs(y - desiredY) < r) {
          continue;
        }
        if (!inBounds(state.grid, x, y) || !isPassable(state, x, y)) {
          continue;
        }
        const fireSideDot = (x - fireTarget.x) * attackDirX + (y - fireTarget.y) * attackDirY;
        if (fireSideDot > 0.2) {
          continue;
        }
        const score = Math.hypot(x - desiredX, y - desiredY);
        if (score < bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }
    }
    if (best) {
      return best;
    }
  }
  return null;
};
